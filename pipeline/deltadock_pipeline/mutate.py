"""PDBFixer-based mutation builder — FoldX-free fallback for production.

Production runs on Fly.io, where the FoldX Linux binary isn't installed
(it's license-restricted and has to be vendored manually). We need to be
able to build mutant receptors in prod regardless, so this module wraps
PDBFixer's `applyMutations()` — which is already in our Docker image as
part of the OpenMM/PDBFixer conda package — to do the side-chain swap
ourselves.

Trade-offs vs FoldX:
  + Free, no license restrictions
  + Already in the prod image (zero new dependencies)
  + Fast: ~1-2s per mutation vs FoldX's ~30s
  - No ΔΔG calculation (no energy minimization, just geometric placement)
  - Less accurate side-chain rotamer than FoldX's library + minimization

For a tool that's primarily about Vina docking deltas (not folding stability
predictions), the trade is favorable: we get mutation-correct geometry for
docking, lose only the ddG annotation column (which we can show as "—").

Critically: this preserves the original PDB residue numbering — PDBFixer's
applyMutations works on residue-NAME identity, not topology indices.
"""

from __future__ import annotations

import logging
import shutil
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)


class MutateError(RuntimeError):
    pass


# 3-letter ↔ 1-letter (PDBFixer.applyMutations expects 3-letter NEW name).
_AA1_TO_3 = {
    "A": "ALA", "R": "ARG", "N": "ASN", "D": "ASP", "C": "CYS",
    "Q": "GLN", "E": "GLU", "G": "GLY", "H": "HIS", "I": "ILE",
    "L": "LEU", "K": "LYS", "M": "MET", "F": "PHE", "P": "PRO",
    "S": "SER", "T": "THR", "W": "TRP", "Y": "TYR", "V": "VAL",
}
_AA3_TO_1 = {v: k for k, v in _AA1_TO_3.items()}


@dataclass
class MutateResult:
    """Outcome of a PDBFixer mutation."""
    mutant_pdb: Path
    wt_reference_pdb: Path        # WT pre-strip — for parity with FoldXResult
    ddg_kcal_mol: float | None    # Always None (PDBFixer doesn't compute energy)


def parse_mutation(code: str) -> tuple[str, int, str]:
    """Parse 'T790M' → ('T', 790, 'M'). Same as foldx.parse_mutation."""
    code = code.strip().upper()
    if len(code) < 3:
        raise MutateError(f"Mutation code too short: {code!r}")
    orig = code[0]
    new = code[-1]
    try:
        resnum = int(code[1:-1])
    except ValueError as e:
        raise MutateError(f"Bad mutation code {code!r}: {e}") from e
    return orig, resnum, new


def _minimize_with_openmm(topology, positions, max_iterations: int = 200):
    """Quick local energy minimisation of a mutant receptor.

    Why this exists: PDBFixer.applyMutations swaps the residue identity but
    leaves the new side chain's atoms in the WT position with the new
    residue's atom names. For drastic substitutions (e.g. C → S, V → E,
    G → V) that can leave clashes — bond lengths off by 0.1-0.3 Å, atoms
    overlapping with neighbours by 0.5-1.0 Å — and the resulting "mutant"
    receptor is only nominally different from WT. The validation suite at
    /validation quantified the cost: 6 of 8 literature-anchored cases
    landed below the Vina noise floor because WT and mutant structures
    were too similar.

    A short vacuum minimisation with amber99sb-ildn relieves those
    artefacts without going so far that it reshapes the binding pocket.
    200 L-BFGS iterations is plenty (typical convergence in ~50 steps for
    a single-residue substitution; higher caps hit the same minimum).
    Vacuum is intentional — implicit solvent (OBC, GBN2) adds 5-10×
    wall-clock for marginal benefit on a brief minimisation, and a kinase
    receptor without a bound ligand has very few protein-water hydrogen
    bonds the pocket cares about.

    Returns the new positions (as Quantity[Vec3]) on success, or None on
    any failure — the caller falls back to the un-minimised structure
    with a warning. Failure modes we deliberately tolerate: forcefield
    parameter missing for an unusual residue (rare on amber99sb-ildn),
    SETTLE failures on water that PDBFixer happened to add, etc. The
    fallback gives a worse mutant but never blocks a job.
    """
    try:
        from openmm.app import ForceField, Simulation, CutoffNonPeriodic
        from openmm import VerletIntegrator, unit
    except ImportError as e:
        log.warning("OpenMM not available — skipping minimisation: %s", e)
        return None
    try:
        # amber99sb-ildn (Lindorff-Larsen 2010) is the canonical modern
        # protein FF — better χ1/χ2 sampling than plain ff99sb, mature
        # enough that virtually every published OpenMM kinase study uses it.
        forcefield = ForceField("amber99sbildn.xml")
        system = forcefield.createSystem(
            topology,
            # CutoffNonPeriodic with 1 nm matches the default OpenMM
            # implicit-solvent recipe; enough to model neighbour
            # interactions during minimisation, far cheaper than full
            # NoCutoff for a typical 4-5k atom kinase receptor.
            nonbondedMethod=CutoffNonPeriodic,
            nonbondedCutoff=1.0 * unit.nanometers,
        )
        # Verlet integrator is unused (we only call minimizeEnergy) but
        # OpenMM's Simulation requires one. 1 fs step is irrelevant.
        integrator = VerletIntegrator(0.001 * unit.picoseconds)
        sim = Simulation(topology, system, integrator)
        sim.context.setPositions(positions)
        sim.minimizeEnergy(maxIterations=max_iterations)
        state = sim.context.getState(getPositions=True)
        return state.getPositions()
    except Exception as e:
        # Don't take down the whole mutant build for a minimisation
        # failure. Log loudly so we notice patterns; return None so
        # the caller writes the un-minimised structure.
        log.warning("OpenMM minimisation failed (will use un-minimised structure): %s", e)
        return None


def build_mutant_pdbfixer(
    pdb_path: Path | str,
    chain: str,
    mutation_code: str,
    out_path: Path | str,
    minimize: bool = True,
) -> MutateResult:
    """Apply a single or combo mutation to a PDB using PDBFixer.applyMutations.

    Args:
        pdb_path:       cleaned WT PDB. Must already have HETATMs stripped and
                        original residue numbering preserved (use prep.fix_pdb).
        chain:          chain ID the mutation residue lives on (e.g. "A").
        mutation_code:  "T790M" or combo like "T790M+C797S".
        out_path:       where to write the mutant PDB.
        minimize:       run a short OpenMM amber99sb-ildn minimisation after
                        applyMutations to relieve clash artefacts from
                        residue substitution. Default True (added 2026-04-30
                        after the validation suite quantified the cost of
                        leaving the structure un-minimised: 6/8 cases
                        below the Vina noise floor). Set False via the
                        LIGANX_MINIMIZE_MUTANT=0 env var if a build
                        misbehaves and you want to bisect the cause.

    Returns:
        MutateResult with mutant_pdb path. ddg is always None.

    Raises:
        MutateError: if the wild-type residue at (chain, resnum) doesn't match
            what the mutation code expects, or if PDBFixer fails to build the
            substitution.
    """
    try:
        from pdbfixer import PDBFixer
        from openmm.app import PDBFile
    except ImportError as e:
        raise MutateError(f"PDBFixer/OpenMM not installed: {e}") from e

    pdb_path = Path(pdb_path)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if not pdb_path.exists():
        raise MutateError(f"WT PDB not found: {pdb_path}")

    # Parse all individual subs in the (possibly combo) mutation code
    individual = [c.strip() for c in mutation_code.split("+") if c.strip()]
    if not individual:
        raise MutateError(f"Empty mutation code: {mutation_code!r}")

    parsed: list[tuple[str, int, str]] = []
    for code in individual:
        parsed.append(parse_mutation(code))

    # Verify the WT identity at each position matches the mutation code's
    # expected original AA. If not, the user's mutation literature uses
    # different numbering than this PDB — fail loudly so they pick a
    # different reference structure.
    for (orig, resnum, new) in parsed:
        actual_3 = _residue_at(pdb_path, chain, resnum)
        if actual_3 is None:
            raise MutateError(
                f"Residue {chain}{resnum} (from {orig}{resnum}{new}) not found in "
                f"{pdb_path.name}. Wrong PDB or different numbering."
            )
        if _AA3_TO_1.get(actual_3) != orig:
            raise MutateError(
                f"{orig}{resnum}{new} expects {orig} at {chain}{resnum}, but the "
                f"PDB has {actual_3} ({_AA3_TO_1.get(actual_3, '?')}). "
                f"Wrong PDB or different numbering."
            )

    # PDBFixer.applyMutations expects a list of strings like 'ASP-835-VAL'.
    mutations_pdbfixer = []
    for (orig, resnum, new) in parsed:
        new_3 = _AA1_TO_3.get(new)
        if new_3 is None:
            raise MutateError(f"Unknown amino acid: {new!r}")
        # Format: "<original 3-letter>-<resnum>-<new 3-letter>"
        original_3 = _AA1_TO_3.get(orig)
        mutations_pdbfixer.append(f"{original_3}-{resnum}-{new_3}")

    log.info("PDBFixer applyMutations: %s on %s chain %s",
             mutations_pdbfixer, pdb_path.name, chain)

    fixer = PDBFixer(filename=str(pdb_path))
    try:
        # applyMutations(mutations, chain_id) — mutations is a list of strings
        fixer.applyMutations(mutations_pdbfixer, chain)
    except Exception as e:
        # Common failure: residue exists but with a different chain ID in the
        # PDBFixer topology than what the user passed.
        raise MutateError(
            f"PDBFixer.applyMutations({mutations_pdbfixer}, {chain!r}) failed: "
            f"{type(e).__name__}: {e}"
        ) from e

    # Re-add missing atoms for the newly-substituted side chain. Important:
    # set missingResidues={} explicitly so we don't accidentally insert any
    # gap-fillers (which would silently break residue numbering — see
    # prep.fix_pdb's docstring).
    fixer.missingResidues = {}
    fixer.findMissingAtoms()
    fixer.addMissingAtoms()

    # Optional local minimisation. Closes the rigid-receptor signal gap
    # the validation suite quantified — without this, the mutant
    # receptor differs from WT only at one side-chain identity (atoms
    # placed at WT positions with new residue's atom names) and Vina
    # docks against essentially the same structure twice. Fail-soft:
    # if minimisation errors, write the un-minimised structure with a
    # log warning and let the runner continue.
    #
    # Hydrogen handling: amber99sb-ildn requires hydrogens to assign
    # forcefield templates. PDBFixer.addMissingAtoms() only adds heavy
    # atoms, so we addMissingHydrogens() in-memory before minimising,
    # then strip them out of the output so the mutant PDB matches the
    # WT format (heavy atoms only — what obabel and the rest of the
    # pipeline expect downstream).
    minimized = False
    if minimize:
        try:
            fixer.addMissingHydrogens(pH=7.0)
        except Exception as e:
            log.warning("addMissingHydrogens failed; skipping minimisation: %s", e)
        else:
            relaxed = _minimize_with_openmm(fixer.topology, fixer.positions)
            if relaxed is not None:
                # Apply minimised positions back onto the topology so
                # writeFile picks them up.
                fixer.positions = relaxed
                minimized = True
                log.info("PDBFixer mutant relaxed via 200-step amber99sb-ildn minimisation")

    # Build a heavy-atoms-only copy of the topology for the final write.
    # If we added hydrogens for the minimisation, strip them now so the
    # downstream PDB has the same atom inventory as the WT.
    if minimize:
        from openmm.app import Modeller
        modeller = Modeller(fixer.topology, fixer.positions)
        h_atoms = [a for a in modeller.topology.atoms() if a.element is not None and a.element.symbol == "H"]
        if h_atoms:
            modeller.delete(h_atoms)
        with out_path.open("w") as fh:
            PDBFile.writeFile(modeller.topology, modeller.positions, fh, keepIds=True)
    else:
        with out_path.open("w") as fh:
            PDBFile.writeFile(fixer.topology, fixer.positions, fh, keepIds=True)
    if minimize and not minimized:
        log.info("Minimisation requested but did not run — saved un-minimised mutant")

    # Provide a WT reference next to the mutant — same input, just copied.
    wt_ref = out_path.with_suffix(".wt_ref.pdb")
    if not wt_ref.exists():
        shutil.copy(pdb_path, wt_ref)

    return MutateResult(
        mutant_pdb=out_path,
        wt_reference_pdb=wt_ref,
        ddg_kcal_mol=None,
    )


def _residue_at(pdb_path: Path, chain: str, resnum: int) -> str | None:
    """Return the 3-letter residue name at (chain, resnum), or None if absent."""
    with pdb_path.open() as f:
        for line in f:
            if not line.startswith("ATOM"):
                continue
            if len(line) < 27 or line[21] != chain:
                continue
            try:
                if int(line[22:26].strip()) == resnum:
                    return line[17:20].strip()
            except ValueError:
                continue
    return None
