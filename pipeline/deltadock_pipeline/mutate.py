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


def build_mutant_pdbfixer(
    pdb_path: Path | str,
    chain: str,
    mutation_code: str,
    out_path: Path | str,
) -> MutateResult:
    """Apply a single or combo mutation to a PDB using PDBFixer.applyMutations.

    Args:
        pdb_path:       cleaned WT PDB. Must already have HETATMs stripped and
                        original residue numbering preserved (use prep.fix_pdb).
        chain:          chain ID the mutation residue lives on (e.g. "A").
        mutation_code:  "T790M" or combo like "T790M+C797S".
        out_path:       where to write the mutant PDB.

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

    with out_path.open("w") as fh:
        PDBFile.writeFile(fixer.topology, fixer.positions, fh, keepIds=True)

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
