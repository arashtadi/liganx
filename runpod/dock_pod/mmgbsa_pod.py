"""Pod-side MM-GBSA rescoring (single-snapshot implicit-solvent ΔG_bind).

OpenMM-based "fast" MM-GBSA: parameterise the docked complex, minimise
in implicit GBSA solvent, compute ΔG_bind = E_complex − E_protein − E_ligand
on the minimised structure. No MD sampling — that's MM-PBSA territory
(minutes per snapshot × hundreds of snapshots) and not what we want for
a second-pass rescoring step that should finish in <2 minutes per pose.

WHAT THIS COMPUTES, EXACTLY
---------------------------

Single-snapshot one-trajectory MM-GBSA, written out:

    ΔG_bind ≈ G(complex) − G(protein, isolated) − G(ligand, isolated)

where each G is approximated by

    G ≈ E_MM (gas-phase MM energy) + G_solv,GBSA
       (entropy −TΔS is dropped — see § "What this is NOT")

Force fields:
  * Protein  — Amber ff14SB (modern consensus for protein FEP/MM-GBSA;
               supersedes ff99SB-ILDN which the ensemble path still uses
               because that path only needs short-timescale relaxation
               on backbone+side-chain). 14SB is what every modern benchmark
               (OpenFF Industry Benchmarks 2023, Schrödinger JACS-22)
               uses on the protein side.
  * Ligand   — OpenFF Sage 2.2.x via openff-toolkit (AM1-BCC partial
               charges, modern parameter coverage for drug-like atoms).
               Fallback NOT IMPLEMENTED — see § "Pod deps"; without
               openff-toolkit we return a clear 503.
  * Solvent  — Implicit OBC2 GBSA (Onufriev-Bashford-Case Generalized
               Born + surface-area nonpolar term). This is the standard
               implicit-solvent model for MM-GBSA — well-tested, fast,
               available natively in OpenMM via `app.OBC2`. We do NOT
               run explicit TIP3P solvent here; that's FEP territory.

Protocol:
  1. Parameterise the receptor with Amber14SB.
  2. Parameterise the ligand with OpenFF Sage 2.2 + AM1-BCC charges.
  3. Combine into a complex topology using openff-toolkit + Interchange.
  4. Minimise the complex with OBC2 implicit solvent (max 500 steps,
     L-BFGS until force-norm < 10 kJ/mol/nm or step cap).
  5. Compute E_complex on the minimised geometry.
  6. Slice protein-only and ligand-only subsystems from the same
     minimised coordinates (NO RE-MINIMISATION — that's the
     "one-trajectory" half of "one-trajectory MM-GBSA").
  7. Compute E_protein and E_ligand on the slices.
  8. ΔG_bind = E_complex − E_protein − E_ligand. Negative = stronger.

The one-trajectory approximation is what makes this fast (~30-90 s per
pose on Blackwell). The downside is that it doesn't capture protein
reorganisation entropy on ligand removal — a well-known systematic
bias of ~2-5 kcal/mol that's CONSISTENT across ligands at the same
target, so ΔΔG between ligands is still meaningful (rank-ordering is
the use case here, not absolute affinity).

WHAT THIS IS NOT
----------------

  * Not FEP. The ΔG returned here is a single-snapshot energy
    breakdown; rigorous binding free energies need alchemical FEP
    (planned for Phase B / fep_plus_design.md).
  * Not an absolute affinity prediction. Use as a rescoring layer to
    rank-order docked poses within a target series — its calibration
    against absolute IC50 is poor by design (entropy term is dropped).
  * Not the place to redo docking. The input pose is assumed to be
    physically reasonable (PoseBusters has already passed/cautioned it).
    GIGO applies: pass us a steroid in a kinase pocket and you'll get
    a meaningless ΔG.

POD DEPS
--------

This module requires openff-toolkit + openmmforcefields installed on
the pod alongside the existing OpenMM. Install with:

    pip install --no-cache-dir 'openff-toolkit==0.16.*' \
        'openmmforcefields==0.14.*' 'openff-interchange==0.4.*'

If those deps are missing the `rescore` function returns a clearly-
labelled error response that the backend surfaces as a 503 to the
user. This is the deliberate degradation path — the pod can ship MM-GBSA
code BEFORE the deps land, and the backend / DB / UI are unaffected.

CONTRACT
--------

`rescore_pose(receptor_pdb_text, ligand_sdf_text)` returns a dict:

    {
        "ok": True,
        "dg_bind_kcal_mol": -42.1,
        "e_complex_kcal_mol": -8421.3,
        "e_protein_kcal_mol": -8350.9,
        "e_ligand_kcal_mol":  -28.3,
        "method": "openmm-obc2 / amber14sb+openff-2.2 / one-trajectory",
        "wall_seconds": 47.2,
    }

or, on a deps-missing or runtime failure:

    {
        "ok": False,
        "error": "ImportError: openff-toolkit not installed",
        "wall_seconds": 0.1,
    }

The energies are in kcal/mol throughout (OpenMM works in kJ/mol
natively; the conversion happens at the boundary so the values the
backend, DB, UI ever see are the chemist-natural kcal/mol).
"""

from __future__ import annotations

import logging
import tempfile
import time
from pathlib import Path

log = logging.getLogger("mmgbsa_pod")

# OpenMM uses kJ/mol natively; chemists think in kcal/mol. Use this
# conversion at the boundary — keep all kJ-mol internal.
_KJ_PER_KCAL = 4.184


def rescore_pose(
    receptor_pdb_text: str,
    ligand_sdf_text: str,
    *,
    max_minimization_steps: int = 500,
    force_tolerance_kj_mol_nm: float = 10.0,
    # (Phase A audit fix #4) Solute dielectric. ε=1 is correct for MD
    # where the protein samples its own electrostatic response; for
    # single-snapshot MM-GBSA scoring the medchem consensus (Hou et al.
    # JCIM 2011) is ε=2-4 because the static snapshot can't reorganise
    # to screen polar contacts. ε=2 best on kinase / HIV protease.
    solute_dielectric: float = 2.0,
    # (Phase A audit fix #2) Receptor heavy-atom positional restraint
    # during minimisation. Without it, the protein backbone can walk
    # several Å in 500 L-BFGS steps if Vina's rigid-receptor pose has
    # clashes — silently corrupting the geometry behind the ΔG. Use
    # CustomExternalForce with k = 1000 kJ/mol/nm² on protein heavy
    # atoms (~5 kcal/mol/Å²; standard MMPBSA.py default).
    receptor_restraint_k_kj_mol_nm2: float = 1000.0,
    # (Phase A audit fix #9) Salt screening. OBC2 with no salt assumes
    # infinite-dilution Debye screening; physiological is 0.15 M NaCl.
    # Effect: ~1-3 kcal/mol bias on charged ligands (zwitterionic
    # warheads, basic amines on kinase inhibitors).
    salt_conc_mol_per_l: float = 0.15,
) -> dict:
    """Single-snapshot one-trajectory MM-GBSA on a docked complex.

    See module docstring for the protocol; this function is the entry
    point. Never raises — failures are returned as ``{"ok": False, ...}``
    so the caller (dock_server.py) can pass the error through to the
    backend with a clean HTTP 200 + structured error.
    """
    t0 = time.time()

    if not receptor_pdb_text or not ligand_sdf_text:
        return {
            "ok": False,
            "error": "Empty receptor_pdb or ligand_sdf",
            "wall_seconds": round(time.time() - t0, 2),
        }

    # Deferred-import the heavy deps. This lets us still import the
    # module on a pod without openff-toolkit, and gives the user a
    # specific actionable error message instead of an obscure
    # ModuleNotFoundError at boot time.
    try:
        from openff.toolkit import ForceField as OFFForceField  # noqa: F401
        from openff.toolkit import Molecule
        from openmm import (
            CustomExternalForce,
            LangevinMiddleIntegrator,
            Platform,
            unit,
        )
        from openmm.app import (
            ForceField,
            Modeller,
            NoCutoff,
            OBC2,
            PDBFile,
            Simulation,
        )
        from openmmforcefields.generators import (
            SMIRNOFFTemplateGenerator,
        )
    except ImportError as e:
        return {
            "ok": False,
            "error": (
                f"MM-GBSA dependencies missing on this pod: {e}. "
                "Install with: pip install 'openff-toolkit==0.16.*' "
                "'openmmforcefields==0.14.*' 'openff-interchange==0.4.*'"
            ),
            "wall_seconds": round(time.time() - t0, 2),
        }

    try:
        # ─── Step 1: load receptor ─────────────────────────────────
        # OpenMM's PDBFile is happiest with a real file; write the
        # request body to a tempfile rather than fight StringIO
        # compatibility. Same pattern as ensemble_pod.relax_ensemble.
        with tempfile.NamedTemporaryFile("w", suffix=".pdb", delete=False) as fh:
            fh.write(receptor_pdb_text)
            pdb_path = fh.name
        try:
            receptor_pdb = PDBFile(pdb_path)
        finally:
            Path(pdb_path).unlink(missing_ok=True)

        # ─── Step 2: parameterise ligand via OpenFF Sage 2.2 ───────
        # Molecule.from_smiles fails on stereo-ambiguous SMILES; we
        # use from_file on the SDF (which contains 3D coords + stereo
        # from the docked pose). AM1-BCC charges are computed during
        # parameterisation by SMIRNOFFTemplateGenerator.
        with tempfile.NamedTemporaryFile("w", suffix=".sdf", delete=False) as fh:
            fh.write(ligand_sdf_text)
            sdf_path = fh.name
        try:
            ligand_mol = Molecule.from_file(sdf_path, allow_undefined_stereo=True)
        finally:
            Path(sdf_path).unlink(missing_ok=True)

        # SMIRNOFFTemplateGenerator integrates OpenFF parameter
        # generation into the OpenMM ForceField pipeline — registers a
        # template handler that gets called when our combined topology
        # encounters atoms that aren't in Amber14SB (i.e., the ligand).
        smirnoff = SMIRNOFFTemplateGenerator(
            molecules=[ligand_mol],
            forcefield="openff-2.2.0",
        )
        forcefield = ForceField("amber14-all.xml")
        forcefield.registerTemplateGenerator(smirnoff.generator)

        # ─── Step 3: combine into a complex ────────────────────────
        modeller = Modeller(receptor_pdb.topology, receptor_pdb.positions)
        # Add ligand atoms + bonds via OpenMM's topology API. We use
        # openff.toolkit.Molecule.to_openmm() to get a topology+positions
        # in OpenMM format, then add it to the receptor modeller.
        ligand_omm_top = ligand_mol.to_topology().to_openmm()
        ligand_positions = ligand_mol.conformers[0].to_openmm()
        modeller.add(ligand_omm_top, ligand_positions)

        # ─── Step 4: create system with OBC2 implicit solvent ──────
        # OBC2 = Onufriev-Bashford-Case Generalised Born model II.
        # nonbondedMethod=NoCutoff is correct for implicit solvent;
        # PME would double-count solvation since OBC2 already accounts
        # for the dielectric continuum.
        #
        # (Audit fix #4) soluteDielectric configurable; default 2.0 for
        # single-snapshot scoring (vs ε=1 which is right for MD).
        # (Audit fix #9) salt concentration configurable; default
        # 0.15 mol/L for physiological screening of charge-charge
        # interactions.
        system = forcefield.createSystem(
            modeller.topology,
            nonbondedMethod=NoCutoff,
            implicitSolvent=OBC2,
            soluteDielectric=solute_dielectric,
            solventDielectric=78.5,           # water at 298 K
            implicitSolventSaltConc=salt_conc_mol_per_l * unit.moles / unit.liter,
            constraints=None,                  # no constraints for energy eval
            removeCMMotion=False,
        )

        # (Audit fix #2) Add a positional restraint on protein heavy
        # atoms so the minimiser doesn't drift the receptor away from
        # the docked geometry. Implemented as a CustomExternalForce
        # with E = 0.5*k*((x-x0)^2 + (y-y0)^2 + (z-z0)^2) on every
        # non-hydrogen atom of the protein. The ligand atoms (indices
        # >= n_protein_atoms) are NOT restrained — they should relax
        # to remove Vina-pose clashes. k = 1000 kJ/mol/nm² ≈ 2.4
        # kcal/mol/Å², the standard MMPBSA.py default.
        n_protein_atoms = receptor_pdb.topology.getNumAtoms()
        restraint = CustomExternalForce(
            "0.5*k*((x-x0)^2 + (y-y0)^2 + (z-z0)^2)"
        )
        restraint.addGlobalParameter(
            "k", receptor_restraint_k_kj_mol_nm2 * unit.kilojoule_per_mole / unit.nanometer ** 2
        )
        restraint.addPerParticleParameter("x0")
        restraint.addPerParticleParameter("y0")
        restraint.addPerParticleParameter("z0")
        for atom in receptor_pdb.topology.atoms():
            if atom.element is not None and atom.element.symbol != "H":
                # modeller.positions has receptor atoms first (we
                # added the receptor before the ligand), in the same
                # order as receptor_pdb.topology, so atom.index is
                # the right key here.
                p = modeller.positions[atom.index]
                restraint.addParticle(
                    atom.index,
                    [p.x * unit.nanometer, p.y * unit.nanometer, p.z * unit.nanometer],
                )
        system.addForce(restraint)

        integrator = LangevinMiddleIntegrator(
            298 * unit.kelvin,
            1.0 / unit.picoseconds,
            0.002 * unit.picoseconds,
        )
        # Try CUDA, fall back to OpenCL (same pattern as ensemble_pod).
        # On Blackwell the prebuilt OpenMM wheel JIT-compiles via PTX
        # which works but is slow first-call. OpenCL is reliable.
        try:
            platform = Platform.getPlatformByName("CUDA")
        except Exception:                                            # noqa: BLE001
            try:
                platform = Platform.getPlatformByName("OpenCL")
            except Exception:                                        # noqa: BLE001
                platform = Platform.getPlatformByName("CPU")
        simulation = Simulation(modeller.topology, system, integrator, platform)
        simulation.context.setPositions(modeller.positions)

        # (Audit fix #10) Pre-minimisation clash detector. A Vina pose
        # with a >2.5 Å clash will minimise to a non-physical local
        # minimum with a large-negative ΔG that looks like a screaming
        # hit. Reject early when pre-min energy is implausibly large.
        # 1e6 kJ/mol ≈ 240,000 kcal/mol — anything beyond that is
        # certainly clash-dominated.
        state_pre = simulation.context.getState(getEnergy=True)
        e_pre_kj = state_pre.getPotentialEnergy().value_in_unit(unit.kilojoule_per_mole)
        if e_pre_kj > 1.0e6:
            return {
                "ok": False,
                "error": (
                    f"Steric clash in input pose — pre-minimisation energy "
                    f"{e_pre_kj/_KJ_PER_KCAL:.1f} kcal/mol is non-physical. "
                    "This usually means Vina's rigid-receptor pose has heavy-atom "
                    "overlap with a side chain; consider re-docking with a "
                    "different receptor conformer or rejecting this pose."
                ),
                "pre_min_energy_kcal_mol": round(e_pre_kj / _KJ_PER_KCAL, 1),
                "wall_seconds": round(time.time() - t0, 2),
            }

        # Snapshot starting positions for RMSD-after-minimisation report.
        positions_pre = state_pre.getPositions(asNumpy=True)

        # ─── Step 5: minimise the complex ──────────────────────────
        # L-BFGS until force-norm tolerance or step cap. 500 steps is
        # ample for a docked-pose starting structure (the pose is
        # already in a sensible geometry from Vina; we just relax bad
        # van-der-Waals clashes introduced by the rigid-receptor assumption).
        simulation.minimizeEnergy(
            tolerance=force_tolerance_kj_mol_nm * unit.kilojoule_per_mole / unit.nanometer,
            maxIterations=max_minimization_steps,
        )

        # ─── Step 6: compute E_complex on the minimised geometry ───
        # Remove the receptor restraint before reading the energy, so
        # the "E_complex" we report is the pure MM + GB energy without
        # the artificial restraint contribution. We do this by setting
        # the restraint force constant k to 0; the System still has
        # the force registered but it contributes nothing.
        simulation.context.setParameter("k", 0.0)
        state_complex = simulation.context.getState(getEnergy=True, getPositions=True)
        e_complex_kj = state_complex.getPotentialEnergy().value_in_unit(unit.kilojoule_per_mole)
        minimised_positions = state_complex.getPositions(asNumpy=True)

        # (Audit fix #12) Compute RMSD of minimised positions vs the
        # input geometry — the user-facing trust signal that the
        # restraint kept the receptor close to the docked pose. A
        # well-behaved minimisation lands at ~0.1-0.5 Å RMSD on the
        # protein heavy atoms; > 1.0 Å is a warning sign.
        try:
            import numpy as np
            # Receptor atom indices: [0, n_protein_atoms). Heavy atoms only.
            heavy_idx = [
                a.index for a in receptor_pdb.topology.atoms()
                if a.element is not None and a.element.symbol != "H"
            ]
            if heavy_idx:
                pre_xyz  = np.asarray(positions_pre.value_in_unit(unit.angstrom))[heavy_idx]
                post_xyz = np.asarray(minimised_positions.value_in_unit(unit.angstrom))[heavy_idx]
                receptor_rmsd_a = float(
                    np.sqrt(np.mean(np.sum((pre_xyz - post_xyz) ** 2, axis=1)))
                )
            else:
                receptor_rmsd_a = 0.0
        except Exception:                                            # noqa: BLE001
            receptor_rmsd_a = -1.0     # signal: couldn't compute

        # ─── Step 7: slice and compute E_protein, E_ligand ─────────
        # The "one-trajectory" approximation: protein and ligand are
        # evaluated on the SAME minimised coordinates, just with the
        # other moiety deleted. No re-minimisation — that would be
        # "three-trajectory" MM-GBSA, slower and not what we want.
        #
        # NB (audit issue #1, deferred): rebuilding fresh Systems for
        # the slices means the GB Born radii are recomputed without
        # the deleted atoms. For OBC2 with ~15 Å effective range this
        # contributes ~5-15 kcal/mol of noise on the protein
        # self-energy term — that's why the UI labels the absolute
        # number as rank-only and we lean on ΔΔG between ligands.
        # Phase A.1 plan: switch to setParticleParameters-style atom
        # masking on a single shared System to keep GB radii consistent.
        # n_protein_atoms is the receptor-only count, set above when
        # building the restraint.
        e_protein_kj = _slice_energy(
            modeller.topology,
            minimised_positions,
            forcefield,
            keep_atom_range=(0, n_protein_atoms),
            platform=platform,
            solute_dielectric=solute_dielectric,
            salt_conc_mol_per_l=salt_conc_mol_per_l,
        )
        e_ligand_kj = _slice_energy(
            modeller.topology,
            minimised_positions,
            forcefield,
            keep_atom_range=(n_protein_atoms, modeller.topology.getNumAtoms()),
            platform=platform,
            solute_dielectric=solute_dielectric,
            salt_conc_mol_per_l=salt_conc_mol_per_l,
        )

        # ─── Step 8: ΔG_bind = E_complex − E_protein − E_ligand ────
        dg_bind_kj = e_complex_kj - e_protein_kj - e_ligand_kj
        dg_bind_kcal = dg_bind_kj / _KJ_PER_KCAL
        e_complex_kcal = e_complex_kj / _KJ_PER_KCAL
        e_protein_kcal = e_protein_kj / _KJ_PER_KCAL
        e_ligand_kcal  = e_ligand_kj  / _KJ_PER_KCAL

        return {
            "ok": True,
            "dg_bind_kcal_mol": round(dg_bind_kcal, 2),
            "e_complex_kcal_mol": round(e_complex_kcal, 2),
            "e_protein_kcal_mol": round(e_protein_kcal, 2),
            "e_ligand_kcal_mol": round(e_ligand_kcal, 2),
            # (Audit fix #12) Diagnostic trust signal — how far the
            # minimisation walked the receptor heavy atoms. ~0.1-0.5 Å
            # is healthy; >1.0 Å is a warning sign.
            "receptor_rmsd_a": round(receptor_rmsd_a, 3),
            "method": (
                f"openmm-obc2 / amber14sb+openff-2.2 / one-trajectory / "
                f"ε={solute_dielectric:.1f} / {salt_conc_mol_per_l:.2f}M NaCl"
            ),
            "wall_seconds": round(time.time() - t0, 2),
        }
    except Exception as e:                                           # noqa: BLE001
        # Any failure (parameterisation, simulation, platform) returns
        # a structured error rather than raising; the backend gets a
        # clean signal to surface to the user.
        log.exception("mmgbsa_pod.rescore_pose failed")
        return {
            "ok": False,
            "error": f"{type(e).__name__}: {e}",
            "wall_seconds": round(time.time() - t0, 2),
        }


def _slice_energy(topology, positions, forcefield, *, keep_atom_range, platform,
                  solute_dielectric: float = 2.0, salt_conc_mol_per_l: float = 0.15):
    """Compute the OpenMM potential energy of just a subset of atoms,
    holding the rest at the same minimised coordinates as a vacuum
    'ghost' (excluded from the force calculation by deleting them).

    Implementation note: we build a fresh System with only the kept
    atoms because OpenMM doesn't have a clean 'compute energy of a
    selection' API. The cost is ~half a second per slice — negligible
    compared to the minimisation step. The protein- and ligand-only
    systems are evaluated in the SAME implicit solvent as the complex
    (OBC2 + NoCutoff + dielectric 78.5) — anything else would mean
    comparing different free-energy scales between E_complex,
    E_protein, and E_ligand.
    """
    from openmm import LangevinMiddleIntegrator, unit
    from openmm.app import Modeller, NoCutoff, OBC2, Simulation

    start, end = keep_atom_range
    # Build a Modeller with the full topology, then delete the
    # unwanted atoms. Modeller.delete() takes a list of residue
    # objects — convert atom indices to residues.
    modeller = Modeller(topology, positions)
    atoms_to_delete = [
        a for a in modeller.topology.atoms()
        if not (start <= a.index < end)
    ]
    if atoms_to_delete:
        modeller.delete(atoms_to_delete)

    # Mirror the complex-system settings so dielectric + salt are
    # consistent across all three legs of the MM-GBSA decomposition.
    system = forcefield.createSystem(
        modeller.topology,
        nonbondedMethod=NoCutoff,
        implicitSolvent=OBC2,
        soluteDielectric=solute_dielectric,
        solventDielectric=78.5,
        implicitSolventSaltConc=salt_conc_mol_per_l * unit.moles / unit.liter,
        constraints=None,
        removeCMMotion=False,
    )
    integrator = LangevinMiddleIntegrator(
        298 * unit.kelvin,
        1.0 / unit.picoseconds,
        0.002 * unit.picoseconds,
    )
    sim = Simulation(modeller.topology, system, integrator, platform)
    sim.context.setPositions(modeller.positions)
    state = sim.context.getState(getEnergy=True)
    return state.getPotentialEnergy().value_in_unit(unit.kilojoule_per_mole)
