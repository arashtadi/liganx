"""Conformational strain energy of a docked pose.

Vina (and most fast docking engines) optimize the protein-ligand interaction
energy without checking whether the ligand itself is sitting in a sane
conformation. The result is occasional "high-affinity" poses where the
ligand is bent into a high-strain shape just to fit a pocket — a textbook
false positive.

This module quantifies that strain:

    strain (kcal/mol) = E_MMFF(docked pose) - min E_MMFF(relaxed conformers)

Where the relaxed reference comes from generating N conformers from the
input SMILES via ETKDG, MMFF94s-minimizing each, and taking the lowest
energy. A reasonable rule of thumb (CSD torsion-library based work):

    < 3 kcal/mol  → OK            (likely a real binding mode)
    3-7 kcal/mol  → mild strain   (pose plausible but worth a second look)
    > 7 kcal/mol  → high strain   (likely a Vina junk pose)

We deliberately use SDF (which carries bond orders) rather than PDB to
avoid the AssignBondOrdersFromTemplate path that SIGSEGVs RDKit on certain
ligands (the same crash that limits our ProLIF re-templating). The SDF
comes from validate.py's existing PDBQT→SDF conversion, so this is free.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


def compute_strain(
    pose_sdf: Path | str,
    ligand_smiles: str,
    n_conformers: int = 20,
) -> dict[str, Any] | None:
    """Compute strain energy for a docked pose.

    Args:
        pose_sdf: Path to the pose SDF (output of obabel'ing the best mode of
                  Vina's PDBQT). Must have bond orders, which meeko's SDF
                  pipeline preserves.
        ligand_smiles: Original input SMILES — used to generate the relaxed
                  reference conformer ensemble.
        n_conformers: How many ETKDG conformers to generate for the reference.
                  20 is a reasonable trade-off (~1-2s per ligand) between
                  coverage and speed.

    Returns:
        dict {pose_kcal, relaxed_kcal, strain_kcal, verdict} or None if
        any RDKit step fails. Caller renders a chip from `verdict` and a
        tooltip from the kcal numbers.
    """
    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem
    except ImportError as e:
        log.warning("RDKit unavailable for strain calc: %s", e)
        return None

    pose_sdf = Path(pose_sdf)
    if not pose_sdf.exists() or pose_sdf.stat().st_size == 0:
        return None

    # 1. Load the docked pose with bond orders preserved.
    try:
        suppl = Chem.SDMolSupplier(str(pose_sdf), removeHs=False, sanitize=True)
        pose_mol = next((m for m in suppl if m is not None), None)
    except Exception as e:
        log.info("Strain: SDF load failed (%s)", e)
        return None
    if pose_mol is None:
        return None

    # MMFF needs hydrogens; meeko's SDF often already has them, but
    # AddHs(addCoords=True) is a no-op when they're present so this is safe.
    pose_mol = Chem.AddHs(pose_mol, addCoords=True)

    # 2. MMFF94s energy at docked coords. Critical detail: AddHs places the
    # new H atoms based on simple geometric heuristics, which routinely
    # generates H-H or H-heavy clashes that swamp the energy with junk
    # (we measured ~260 kcal/mol on a clean Gefitinib pose this way).
    # Mitigation: do a brief CONSTRAINED minimization where heavy atoms
    # are pinned (so the docked geometry is preserved) and only Hs relax.
    # This is the standard pre-strain-eval move in CSD-style work.
    e_pose = _mmff_energy_constrained(pose_mol, conf_id=0)
    if e_pose is None:
        return None

    # 3. Reference relaxed energy: ETKDG conformers from SMILES, MMFF-minimized.
    template = Chem.MolFromSmiles(ligand_smiles)
    if template is None:
        return None
    template = Chem.AddHs(template)
    try:
        embed_status = AllChem.EmbedMultipleConfs(
            template,
            numConfs=n_conformers,
            randomSeed=42,
            pruneRmsThresh=0.5,
        )
    except Exception as e:
        log.info("Strain: ETKDG embed failed (%s)", e)
        return None
    if not embed_status:
        return None

    relaxed_energies: list[float] = []
    for cid in range(template.GetNumConformers()):
        e = _mmff_energy(template, conf_id=cid, minimize=True)
        if e is not None:
            relaxed_energies.append(e)
    if not relaxed_energies:
        return None

    e_relaxed = min(relaxed_energies)
    strain = e_pose - e_relaxed

    if strain < 3.0:
        verdict = "ok"
    elif strain < 7.0:
        verdict = "mild"
    else:
        verdict = "high"

    return {
        "pose_kcal": round(e_pose, 1),
        "relaxed_kcal": round(e_relaxed, 1),
        "strain_kcal": round(strain, 1),
        "verdict": verdict,
    }


def _mmff_energy(mol, conf_id: int = 0, minimize: bool = False) -> float | None:
    """Single MMFF94s energy evaluation. Optionally minimize first.
    Returns None on any failure — caller treats as "couldn't compute"."""
    from rdkit.Chem import AllChem
    try:
        props = AllChem.MMFFGetMoleculeProperties(mol, mmffVariant="MMFF94s")
        if props is None:
            return None
        ff = AllChem.MMFFGetMoleculeForceField(mol, props, confId=conf_id)
        if ff is None:
            return None
        if minimize:
            ff.Minimize(maxIts=200)
        return ff.CalcEnergy()
    except Exception:
        return None


def _mmff_energy_constrained(mol, conf_id: int = 0) -> float | None:
    """MMFF94s energy with heavy-atom positions PINNED — only hydrogens
    relax. Used for the docked-pose energy so that artifacts from AddHs'
    heuristic H-placement don't swamp the strain measurement.

    The heavy-atom skeleton stays exactly where Vina put it; we just clean
    up the hydrogens, then read the energy. This is the standard CSD-style
    pre-strain pass.
    """
    from rdkit.Chem import AllChem
    try:
        props = AllChem.MMFFGetMoleculeProperties(mol, mmffVariant="MMFF94s")
        if props is None:
            return None
        ff = AllChem.MMFFGetMoleculeForceField(mol, props, confId=conf_id)
        if ff is None:
            return None
        # Pin every heavy atom (Z != 1). Hs stay free.
        for atom in mol.GetAtoms():
            if atom.GetAtomicNum() != 1:
                ff.AddFixedPoint(atom.GetIdx())
        ff.Minimize(maxIts=200)
        return ff.CalcEnergy()
    except Exception:
        return None


def to_extra_string(strain: dict[str, Any]) -> str:
    """Pack strain dict into the existing pipe-separated `extra` field.
    Format: `strain=<verdict>:<kcal>` — short enough to fit alongside the
    other validation flags without blowing up the field length."""
    return f"strain={strain['verdict']}:{strain['strain_kcal']}"
