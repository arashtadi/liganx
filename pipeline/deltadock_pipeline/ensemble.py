"""Receptor conformer-ensemble generation via short restrained MD.

Why this exists
---------------
Single-conformation docking treats the protein as a rigid snapshot. That
is the source of the caveat the UI shows on so many results — "single-
conformation docking can't see geometric effects of mutations beyond the
box edge", "treat WT and mutant as effectively the same score". A bulky
ligand that needs the pocket to *breathe* to fit, or a side chain that
would rotate out of the way in reality, gets a misleadingly bad score.

Ensemble docking is the standard answer: generate a few physically
plausible pocket conformations, dock the ligand against all of them, and
keep the best. It doesn't make docking "right", but it removes the
artefact of a single arbitrary crystal snapshot.

Approach (v1 — "soft ensemble")
-------------------------------
Take the prepped (heavy-atom, cleaned) receptor and run a short restrained
MD in OpenMM:

  * Backbone atoms of every residue are harmonically restrained — the fold
    does not move.
  * Every atom of residues whose Cα is far from the docking box is also
    restrained — only the region around the pocket is allowed to relax.
  * Pocket side chains (residues with Cα within ``pocket_radius`` of the
    box centre) are left free to move at 300 K.

Snapshots are taken at evenly-spaced intervals. This captures side-chain
flexibility — which is most of what single-conformation docking misses —
cheaply, without an unrestrained MD that could drift the fold or melt a
loop.

Fail-soft contract
------------------
``generate_receptor_ensemble`` NEVER raises and NEVER blocks a dock. On
any failure (OpenMM missing, force-field template gap, integrator blow-up)
it returns just ``[receptor_pdb]`` — i.e. the caller falls back to exactly
today's single-conformation behaviour. The worst case is "ensemble mode
silently behaved like standard mode", never "the job crashed".
"""

from __future__ import annotations

import logging
import math
from pathlib import Path

log = logging.getLogger(__name__)

# Default knobs. Tuned for the production GPU path; the sandbox test
# overrides md_ps / n_relaxed down so a CPU run finishes quickly.
_DEFAULT_N_RELAXED = 4
_DEFAULT_MD_PS = 250.0          # total production MD length, picoseconds
_DEFAULT_POCKET_RADIUS_A = 12.0 # residues with Cα within this of box centre stay free
_DEFAULT_EQUIL_PS = 20.0        # discard this much before taking snapshots
_BACKBONE_K = 10.0              # backbone restraint, kcal/mol/Å²
_FARSHELL_K = 5.0               # far-from-pocket side-chain restraint, kcal/mol/Å²
_BACKBONE_ATOMS = {"N", "CA", "C", "O"}


def generate_receptor_ensemble(
    receptor_pdb: Path | str,
    box_center: tuple[float, float, float],
    *,
    n_relaxed: int = _DEFAULT_N_RELAXED,
    md_ps: float = _DEFAULT_MD_PS,
    equil_ps: float = _DEFAULT_EQUIL_PS,
    pocket_radius: float = _DEFAULT_POCKET_RADIUS_A,
    include_input: bool = True,
    platform: str | None = None,
    out_dir: Path | str | None = None,
) -> list[Path]:
    """Generate a receptor conformer ensemble by short restrained MD.

    Args:
        receptor_pdb:  cleaned WT/mutant receptor PDB (heavy atoms, original
                       numbering — i.e. the output of prep.fix_pdb / the
                       mutant builder). NOT a PDBQT.
        box_center:    (x, y, z) of the docking box centre, in PDB Å coords.
                       Defines which residues count as "pocket".
        n_relaxed:     how many MD snapshot conformers to produce.
        md_ps:         total MD length (picoseconds) AFTER equilibration;
                       snapshots are taken evenly across it.
        equil_ps:      equilibration run discarded before snapshotting.
        pocket_radius: residues with Cα within this distance (Å) of
                       box_center keep their side chains free; everything
                       else is restrained.
        include_input: if True, the original receptor_pdb is element 0 of
                       the returned list, so ensemble docking can never
                       score worse than standard single-conformation
                       docking (the unrelaxed structure is always a
                       candidate).
        platform:      OpenMM platform name ("CUDA" on the pod, "CPU" in
                       tests). None lets OpenMM pick the fastest available.
        out_dir:       where to write the conformer PDBs. Defaults to a
                       sibling dir next to receptor_pdb.

    Returns:
        A list of receptor PDB paths to dock against. Length is between 1
        and (1 + n_relaxed). ALWAYS contains at least [receptor_pdb] — on
        any failure that single-element list is what comes back, so the
        caller transparently degrades to today's behaviour.
    """
    receptor_pdb = Path(receptor_pdb)
    base: list[Path] = [receptor_pdb] if include_input else []
    if not receptor_pdb.exists():
        log.warning("ensemble: receptor PDB not found: %s", receptor_pdb)
        return base or [receptor_pdb]
    if n_relaxed <= 0:
        return base or [receptor_pdb]

    out_dir = Path(out_dir) if out_dir else receptor_pdb.parent / f"{receptor_pdb.stem}_ensemble"
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:  # noqa: BLE001
        log.warning("ensemble: can't create out_dir %s: %s", out_dir, e)
        return base or [receptor_pdb]

    try:
        relaxed = _run_restrained_md(
            receptor_pdb, box_center, n_relaxed, md_ps, equil_ps,
            pocket_radius, platform, out_dir,
        )
    except Exception as e:  # noqa: BLE001
        # The whole point of the fail-soft contract: a blown-up integrator,
        # a missing force-field template, an unparseable PDB — none of it
        # takes down the dock. We just lose the ensemble for this receptor.
        log.warning("ensemble: restrained MD failed, falling back to single conformer: %s", e)
        return base or [receptor_pdb]

    result = base + relaxed
    log.info("ensemble: generated %d conformer(s) for %s (1 input + %d relaxed)",
             len(result), receptor_pdb.name, len(relaxed))
    return result or [receptor_pdb]


def _run_restrained_md(
    receptor_pdb: Path,
    box_center: tuple[float, float, float],
    n_relaxed: int,
    md_ps: float,
    equil_ps: float,
    pocket_radius: float,
    platform: str | None,
    out_dir: Path,
) -> list[Path]:
    """Core OpenMM routine. May raise — generate_receptor_ensemble catches."""
    from openmm import (
        CustomExternalForce, LangevinMiddleIntegrator, Platform, unit,
    )
    from openmm.app import (
        ForceField, Modeller, NoCutoff, PDBFile, Simulation,
    )

    pdb = PDBFile(str(receptor_pdb))

    # amber99sb-ildn + the matching OBC implicit solvent. Implicit solvent
    # (not vacuum) matters here: this is a 250 ps MD, not a brief
    # minimisation, and in vacuum exposed side chains collapse onto the
    # protein. OBC keeps the relaxation physical at modest extra cost.
    forcefield = ForceField("amber99sbildn.xml", "amber99_obc.xml")
    modeller = Modeller(pdb.topology, pdb.positions)
    modeller.addHydrogens(forcefield, pH=7.0)

    system = forcefield.createSystem(
        modeller.topology,
        nonbondedMethod=NoCutoff,  # implicit solvent ⇒ no periodic box
        constraints=None,
    )

    # ── Restraints ────────────────────────────────────────────────────
    # CustomExternalForce pins selected atoms to their starting positions
    # with a harmonic spring. Two tiers:
    #   • backbone of every residue        → strong  (fold stays put)
    #   • all atoms of far-from-pocket res  → medium  (only pocket relaxes)
    # Pocket side chains get no restraint and are free to sample at 300 K.
    bb_k = _BACKBONE_K * unit.kilocalories_per_mole / unit.angstrom**2
    far_k = _FARSHELL_K * unit.kilocalories_per_mole / unit.angstrom**2
    restraint = CustomExternalForce(
        "0.5 * k * ((x - x0)^2 + (y - y0)^2 + (z - z0)^2)"
    )
    restraint.addPerParticleParameter("k")
    restraint.addPerParticleParameter("x0")
    restraint.addPerParticleParameter("y0")
    restraint.addPerParticleParameter("z0")

    bx, by, bz = (c / 10.0 for c in box_center)  # Å → nm
    pocket_r_nm = pocket_radius / 10.0
    positions = modeller.positions
    n_free = 0
    n_restrained = 0
    for atom in modeller.topology.atoms():
        res = atom.residue
        # Distance from this residue's Cα to the box centre decides whether
        # the residue is "pocket" (side chains free) or "far" (everything
        # restrained). We approximate per-residue membership by checking
        # the atom's own residue's CA each time we hit it — cheap enough.
        ca_pos = _residue_ca_position(res, positions)
        in_pocket = False
        if ca_pos is not None:
            dx, dy, dz = ca_pos[0] - bx, ca_pos[1] - by, ca_pos[2] - bz
            in_pocket = (dx * dx + dy * dy + dz * dz) <= pocket_r_nm * pocket_r_nm

        is_backbone = atom.name in _BACKBONE_ATOMS
        if is_backbone:
            k = bb_k
        elif not in_pocket:
            k = far_k
        else:
            # Pocket side-chain atom — leave it free.
            n_free += 1
            continue

        p = positions[atom.index]
        restraint.addParticle(
            atom.index,
            [k, p.x * unit.nanometer, p.y * unit.nanometer, p.z * unit.nanometer],
        )
        n_restrained += 1
    system.addForce(restraint)
    log.info("ensemble: %d atoms restrained, %d pocket side-chain atoms free",
             n_restrained, n_free)
    if n_free == 0:
        # Nothing would move — the box centre probably doesn't sit on the
        # protein. Bail to the fail-soft path rather than burn MD time
        # producing N copies of the input.
        raise RuntimeError("no free pocket atoms — box centre off the structure?")

    integrator = LangevinMiddleIntegrator(
        300 * unit.kelvin,
        1.0 / unit.picosecond,
        2.0 * unit.femtoseconds,
    )
    plat = Platform.getPlatformByName(platform) if platform else None
    simulation = Simulation(modeller.topology, system, integrator, plat)
    simulation.context.setPositions(modeller.positions)
    simulation.minimizeEnergy(maxIterations=500)
    simulation.context.setVelocitiesToTemperature(300 * unit.kelvin)

    steps_per_ps = 500  # 2 fs timestep
    equil_steps = int(equil_ps * steps_per_ps)
    if equil_steps > 0:
        simulation.step(equil_steps)

    # Snapshot evenly across the production segment.
    seg_steps = max(1, int((md_ps * steps_per_ps) / n_relaxed))
    out_paths: list[Path] = []
    for i in range(n_relaxed):
        simulation.step(seg_steps)
        try:
            snap = _write_heavy_atom_pdb(
                simulation, out_dir / f"{receptor_pdb.stem}_conf{i + 1}.pdb",
            )
            out_paths.append(snap)
        except Exception as e:  # noqa: BLE001
            # One bad snapshot shouldn't lose the others.
            log.warning("ensemble: snapshot %d failed: %s", i + 1, e)
    return out_paths


def _residue_ca_position(residue, positions):
    """(x, y, z) in nm of a residue's Cα, or None if it has no Cα."""
    for atom in residue.atoms():
        if atom.name == "CA":
            p = positions[atom.index]
            return (p.x, p.y, p.z)
    return None


def _write_heavy_atom_pdb(simulation, out_path: Path) -> Path:
    """Write the current frame as a heavy-atom-only PDB.

    Downstream prep (Meeko → PDBQT) expects the same heavy-atom inventory
    as the cleaned WT receptor, so we strip the hydrogens we added for the
    force field — exactly the pattern the mutant builder uses.
    """
    from openmm.app import Modeller, PDBFile

    state = simulation.context.getState(getPositions=True)
    modeller = Modeller(simulation.topology, state.getPositions())
    h_atoms = [
        a for a in modeller.topology.atoms()
        if a.element is not None and a.element.symbol == "H"
    ]
    if h_atoms:
        modeller.delete(h_atoms)
    with out_path.open("w") as fh:
        PDBFile.writeFile(modeller.topology, modeller.positions, fh, keepIds=True)
    return out_path


def conformer_rmsd(pdb_a: Path | str, pdb_b: Path | str, *, ca_only: bool = True) -> float | None:
    """Heavy-atom (or Cα-only) RMSD between two receptor PDBs, no superposition.

    Used to report how much structural spread an ensemble actually has —
    and in tests to confirm the relaxed conformers genuinely differ from
    the input while the backbone stayed put.

    Atoms are matched by (chain, residue number, atom name) and the RMSD
    is taken over the INTERSECTION — not by positional index. That makes
    it robust to the small atom-inventory differences you get between a
    PDBFixer-cleaned input and an OpenMM-Modeller-written conformer
    (terminal OXT, protonation-state heavy atoms, etc.). Returns None only
    when the two structures share essentially no atoms.

    NOT a structural-alignment RMSD: ensemble conformers come from the
    same MD trajectory in a common frame, so no superposition is needed.
    """
    try:
        coords_a = _read_coords(Path(pdb_a), ca_only)
        coords_b = _read_coords(Path(pdb_b), ca_only)
    except Exception as e:  # noqa: BLE001
        log.debug("conformer_rmsd: read failed: %s", e)
        return None
    shared = coords_a.keys() & coords_b.keys()
    if len(shared) < 3:
        return None
    sq = 0.0
    for key in shared:
        ax, ay, az = coords_a[key]
        bx, by, bz = coords_b[key]
        sq += (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2
    return math.sqrt(sq / len(shared))


def _read_coords(
    pdb_path: Path, ca_only: bool
) -> dict[tuple[str, str, str], tuple[float, float, float]]:
    """Map (chain, resSeq, atomName) → (x, y, z) from ATOM lines.

    Keyed (not positional) so two PDBs with different atom inventories
    can still be compared over what they share. Cα only when ca_only."""
    coords: dict[tuple[str, str, str], tuple[float, float, float]] = {}
    with pdb_path.open() as fh:
        for line in fh:
            if not line.startswith("ATOM"):
                continue
            atom_name = line[12:16].strip()
            if ca_only and atom_name != "CA":
                continue
            key = (line[21], line[22:26].strip(), atom_name)
            coords[key] = (
                float(line[30:38]), float(line[38:46]), float(line[46:54]),
            )
    return coords
