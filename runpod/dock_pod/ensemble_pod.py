"""Pod-side receptor conformer-ensemble generation (GPU restrained MD).

Standalone module — depends only on OpenMM + the stdlib. It mirrors the
restraint scheme of the backend's ``deltadock_pipeline/ensemble.py`` but
operates on PDB *text* (the HTTP boundary) and runs the short MD on the
pod GPU via OpenMM's OpenCL platform (the pip OpenMM wheel doesn't ship
the CUDA platform; OpenCL is GPU-accelerated all the same — verified
~2000 MD steps in 0.15 s on the pod's RTX 4090).

Contract: ``relax_ensemble`` NEVER raises. On any failure it returns
``[receptor_pdb]`` — i.e. the caller transparently falls back to
single-conformation docking, exactly today's behaviour.

Restraint scheme (same as the backend module):
  * backbone of every residue                         → strong restraint
  * every atom of residues far from the docking box   → medium restraint
  * pocket side chains (Cα within pocket_radius of box) → free at 300 K
"""

from __future__ import annotations

import io
import logging
import tempfile
from pathlib import Path

log = logging.getLogger("ensemble_pod")

_BACKBONE_ATOMS = {"N", "CA", "C", "O"}
_BACKBONE_K = 10.0   # kcal/mol/Å²
_FARSHELL_K = 5.0    # kcal/mol/Å²


def relax_ensemble(
    receptor_pdb: str,
    box_center,
    *,
    n_relaxed: int = 4,
    md_ps: float = 250.0,
    equil_ps: float = 20.0,
    pocket_radius: float = 12.0,
) -> list[str]:
    """Return [input_pdb] + up to n_relaxed MD-relaxed conformer PDB strings.

    Args:
        receptor_pdb:  cleaned receptor PDB as text (heavy atoms; the
                       backend already PDBFixer-cleaned it).
        box_center:    (x, y, z) docking-box centre in PDB Å — defines
                       which residues count as "pocket".
        n_relaxed:     number of MD-snapshot conformers to add.
        md_ps:         total MD length (ps) after equilibration.
        equil_ps:      equilibration discarded before snapshotting.
        pocket_radius: residues with Cα within this (Å) of box_center
                       keep their side chains free; everything else is
                       restrained.

    Returns:
        A list of PDB strings — element 0 is always the unrelaxed input,
        so ensemble docking can never score worse than standard docking.
        On any failure the list is just [receptor_pdb].
    """
    if not receptor_pdb:
        return []
    if n_relaxed <= 0:
        return [receptor_pdb]
    try:
        relaxed = _run_restrained_md(
            receptor_pdb, tuple(box_center), n_relaxed,
            md_ps, equil_ps, pocket_radius,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("relax_ensemble: MD failed, single-conformer fallback: %s", e)
        return [receptor_pdb]
    log.info("relax_ensemble: %d conformer(s) (1 input + %d relaxed)",
             1 + len(relaxed), len(relaxed))
    return [receptor_pdb] + relaxed


def _run_restrained_md(receptor_pdb, box_center, n_relaxed, md_ps,
                       equil_ps, pocket_radius) -> list[str]:
    """Core OpenMM routine. May raise — relax_ensemble catches."""
    from openmm import (
        CustomExternalForce, LangevinMiddleIntegrator, Platform, unit,
    )
    from openmm.app import (
        ForceField, Modeller, NoCutoff, PDBFile, Simulation,
    )

    # OpenMM's PDBFile is happiest with a real file; write the request
    # body to a tempfile rather than fight StringIO compatibility.
    with tempfile.NamedTemporaryFile("w", suffix=".pdb", delete=False) as fh:
        fh.write(receptor_pdb)
        in_path = fh.name
    try:
        pdb = PDBFile(in_path)
    finally:
        Path(in_path).unlink(missing_ok=True)

    # amber99sb-ildn + matching OBC implicit solvent — implicit solvent
    # (not vacuum) so exposed side chains don't collapse during a 250 ps run.
    forcefield = ForceField("amber99sbildn.xml", "amber99_obc.xml")
    modeller = Modeller(pdb.topology, pdb.positions)
    modeller.addHydrogens(forcefield, pH=7.0)
    system = forcefield.createSystem(
        modeller.topology, nonbondedMethod=NoCutoff, constraints=None,
    )

    bb_k = _BACKBONE_K * unit.kilocalories_per_mole / unit.angstrom**2
    far_k = _FARSHELL_K * unit.kilocalories_per_mole / unit.angstrom**2
    restraint = CustomExternalForce(
        "0.5 * k * ((x - x0)^2 + (y - y0)^2 + (z - z0)^2)"
    )
    for p in ("k", "x0", "y0", "z0"):
        restraint.addPerParticleParameter(p)

    bx, by, bz = (c / 10.0 for c in box_center)   # Å → nm
    pocket_r_nm = pocket_radius / 10.0
    positions = modeller.positions
    n_free = 0
    n_restrained = 0
    for atom in modeller.topology.atoms():
        ca = _residue_ca_position(atom.residue, positions)
        in_pocket = False
        if ca is not None:
            dx, dy, dz = ca[0] - bx, ca[1] - by, ca[2] - bz
            in_pocket = (dx * dx + dy * dy + dz * dz) <= pocket_r_nm * pocket_r_nm
        if atom.name in _BACKBONE_ATOMS:
            k = bb_k
        elif not in_pocket:
            k = far_k
        else:
            n_free += 1
            continue
        p = positions[atom.index]
        restraint.addParticle(
            atom.index,
            [k, p.x * unit.nanometer, p.y * unit.nanometer, p.z * unit.nanometer],
        )
        n_restrained += 1
    system.addForce(restraint)
    log.info("relax_ensemble: %d atoms restrained, %d pocket side-chain atoms free",
             n_restrained, n_free)
    if n_free == 0:
        raise RuntimeError("no free pocket atoms — box centre off the structure?")

    integrator = LangevinMiddleIntegrator(
        300 * unit.kelvin, 1.0 / unit.picosecond, 2.0 * unit.femtoseconds,
    )
    simulation = Simulation(modeller.topology, system, integrator, _best_platform())
    simulation.context.setPositions(modeller.positions)
    simulation.minimizeEnergy(maxIterations=500)
    simulation.context.setVelocitiesToTemperature(300 * unit.kelvin)

    steps_per_ps = 500   # 2 fs timestep
    if equil_ps > 0:
        simulation.step(int(equil_ps * steps_per_ps))

    seg_steps = max(1, int((md_ps * steps_per_ps) / n_relaxed))
    out: list[str] = []
    for i in range(n_relaxed):
        simulation.step(seg_steps)
        try:
            out.append(_heavy_atom_pdb_text(simulation))
        except Exception as e:  # noqa: BLE001
            log.warning("relax_ensemble: snapshot %d failed: %s", i + 1, e)
    return out


def _best_platform():
    """Fastest available OpenMM platform: CUDA → OpenCL → CPU.

    On the pod the pip OpenMM wheel exposes Reference / CPU / OpenCL —
    OpenCL is the GPU path. CUDA is tried first anyway in case a future
    pod image ships the CUDA plugin. Returns None (OpenMM auto-picks) if
    none of the named platforms resolve.
    """
    from openmm import Platform
    for name in ("CUDA", "OpenCL", "CPU"):
        try:
            return Platform.getPlatformByName(name)
        except Exception:  # noqa: BLE001
            continue
    return None


def _residue_ca_position(residue, positions):
    """(x, y, z) in nm of a residue's Cα, or None if it has no Cα."""
    for atom in residue.atoms():
        if atom.name == "CA":
            p = positions[atom.index]
            return (p.x, p.y, p.z)
    return None


def _heavy_atom_pdb_text(simulation) -> str:
    """Current frame as a heavy-atom-only PDB string.

    Strips the hydrogens added for the force field so the conformer has
    the same heavy-atom inventory as the cleaned WT receptor — what the
    downstream Meeko → PDBQT prep expects.
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
    buf = io.StringIO()
    PDBFile.writeFile(modeller.topology, modeller.positions, buf, keepIds=True)
    return buf.getvalue()
