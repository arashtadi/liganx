"""Conformational strain of a docked pose, via RMSD to nearest relaxed conformer.

WHY THIS APPROACH:

Vina (and most fast docking engines) optimize protein-ligand interaction energy
without checking whether the ligand itself is sitting in a sane conformation.
Result: occasional "high-affinity" poses where the ligand is bent into a
high-strain shape just to fit a pocket — a textbook false positive.

We tried MMFF94s absolute energy (E_pose - E_relaxed) first. That methodology
is theoretically sound but extremely brittle in practice — AddHs heuristics,
missing force-field parameters, and clash artifacts routinely produced ΔE
values of 200-300 kcal/mol on perfectly clean poses, making the verdict
useless.

Switched to a geometry-only metric: heavy-atom RMSD between the docked pose
and the closest of N relaxed conformers generated from the input SMILES via
ETKDG + MMFF94s minimization. Bostrom (2007, J. Med. Chem.) showed that
crystal-bound ligand conformations are typically within ~1 Å of a low-energy
solution conformer, so:

    < 1.0 Å  → OK            (pose matches a relaxed conformer well)
    1.0-2.0  → mild strain   (geometrically plausible but not common)
    > 2.0 Å  → high strain   (likely a Vina junk pose)

This metric is robust to force-field parameter coverage and doesn't blow up
on H-placement artifacts. Costs ~1-3s per pose for the conformer search.
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
    """Compute strain (RMSD to nearest relaxed conformer) for a docked pose.

    Args:
        pose_sdf: Path to the pose SDF (output of obabel'ing the best mode of
                  Vina's PDBQT). Must have bond orders, which meeko's SDF
                  pipeline preserves.
        ligand_smiles: Original input SMILES — used to generate the relaxed
                  reference conformer ensemble.
        n_conformers: How many ETKDG conformers to generate. 20 is enough
                  coverage for drug-sized molecules without exploding wall-time.

    Returns:
        dict {rmsd, verdict, n_conformers_compared} or None on failure.
        Verdict drives the matrix chip color; rmsd goes in the tooltip.
    """
    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem
    except ImportError as e:
        log.warning("RDKit unavailable for strain calc: %s", e)
        return None

    pose_sdf = Path(pose_sdf)
    if not pose_sdf.exists() or pose_sdf.stat().st_size == 0:
        log.info("Strain: pose_sdf missing or empty: %s", pose_sdf)
        return None
    log.info("Strain: computing for %s (smiles=%s, %d conformers)",
             pose_sdf.name, ligand_smiles[:40], n_conformers)

    # 1. Load the docked pose (heavy atoms only — Hs aren't reliable here
    # and we're measuring heavy-atom geometry).
    try:
        suppl = Chem.SDMolSupplier(str(pose_sdf), removeHs=True, sanitize=True)
        pose_mol = next((m for m in suppl if m is not None), None)
    except Exception as e:
        log.info("Strain: SDF load failed (%s)", e)
        return None
    if pose_mol is None:
        return None

    # 2. Generate relaxed conformer ensemble from SMILES.
    template = Chem.MolFromSmiles(ligand_smiles)
    if template is None:
        return None
    template_h = Chem.AddHs(template)
    try:
        ids = AllChem.EmbedMultipleConfs(
            template_h,
            numConfs=n_conformers,
            randomSeed=42,
            pruneRmsThresh=0.5,
        )
    except Exception as e:
        log.info("Strain: ETKDG embed failed (%s)", e)
        return None
    if not ids:
        return None

    # MMFF-minimize each conformer so we're comparing against actual local
    # minima, not raw ETKDG geometry. MMFFOptimizeMoleculeConfs is much
    # faster than calling MMFFOptimizeMolecule per-conformer.
    try:
        AllChem.MMFFOptimizeMoleculeConfs(template_h, maxIters=200, mmffVariant="MMFF94s")
    except Exception as e:
        log.info("Strain: MMFF minimization failed (%s)", e)
        # Continue — RMSD against unminimized conformers is still informative

    # Strip Hs — RMSD is on heavy atoms only.
    relaxed = Chem.RemoveHs(template_h)

    # 3. RMSD between docked pose and each relaxed conformer.
    # GetBestRMS *requires* atoms to be in identical order; meeko's PDBQT→SDF
    # round-trip routinely reorders atoms vs. an RDKit SMILES build, so we
    # try GetBestRMS first (cheap when it works) and fall back to explicit
    # substructure-match-based alignment when the atom orders differ.
    from rdkit.Chem import rdMolAlign

    rmsds: list[float] = []
    last_err = None
    for cid in range(relaxed.GetNumConformers()):
        r = _try_rmsd(pose_mol, relaxed, cid)
        if r is not None:
            rmsds.append(r)
        else:
            # Track the first error reason for diagnostics.
            try:
                AllChem.GetBestRMS(pose_mol, relaxed, refId=cid, prbId=0)
            except Exception as e:
                last_err = str(e)[:80]

    if not rmsds:
        log.warning("Strain: no RMSD values for %s (last err: %s)", pose_sdf.name, last_err)
        return None

    best_rmsd = min(rmsds)
    log.info("Strain: %s → RMSD=%.2f Å (%d conformers compared)",
             pose_sdf.name, best_rmsd, len(rmsds))

    if best_rmsd < 1.0:
        verdict = "ok"
    elif best_rmsd < 2.0:
        verdict = "mild"
    else:
        verdict = "high"

    return {
        "rmsd": round(best_rmsd, 2),                # Å — closest matching relaxed conformer
        "verdict": verdict,                          # ok | mild | high
        "n_conformers_compared": len(rmsds),
        # Kept for API back-compat with the older MMFF version of this
        # module — the frontend reads `strain.kcal` and falls back to
        # `strain.rmsd` rendering when present.
        "strain_kcal": round(best_rmsd, 2),
    }


def _try_rmsd(pose_mol, ref_mol, ref_cid: int) -> float | None:
    """Best-effort heavy-atom RMSD between pose_mol and ref_mol[ref_cid].

    Tries three strategies in order, returning the first one that works:
      1. AllChem.GetBestRMS — fast, requires identical atom orders.
      2. rdMolAlign.GetBestRMS with explicit atom map from GetSubstructMatch
         — handles atom-order divergence common in PDBQT→SDF round-trips.
      3. Manual coordinate alignment via SMARTS pattern match — fallback
         for edge cases where SubstructMatch picks a permutation that breaks
         GetBestRMS (rare, but happens with symmetric scaffolds).
    """
    from rdkit.Chem import AllChem, rdMolAlign

    # Strategy 1: identical-atom-order assumption
    try:
        return AllChem.GetBestRMS(pose_mol, ref_mol, refId=ref_cid, prbId=0)
    except Exception:
        pass

    # Strategy 2: explicit substructure-mapped RMSD. We pin the smaller
    # molecule as the substruct probe so the match always succeeds when
    # they're the same compound modulo atom-order.
    try:
        # GetSubstructMatch returns atoms of `pose_mol` indexed by `ref_mol`.
        match = pose_mol.GetSubstructMatch(ref_mol)
        if match and len(match) == ref_mol.GetNumAtoms():
            atom_map = list(zip(match, range(ref_mol.GetNumAtoms())))
            return rdMolAlign.GetBestRMS(
                pose_mol, ref_mol,
                refId=ref_cid, prbId=0,
                map=[atom_map],
            )
    except Exception:
        pass

    # Strategy 3: try the reverse direction
    try:
        match = ref_mol.GetSubstructMatch(pose_mol)
        if match and len(match) == pose_mol.GetNumAtoms():
            atom_map = list(zip(range(pose_mol.GetNumAtoms()), match))
            return rdMolAlign.GetBestRMS(
                pose_mol, ref_mol,
                refId=ref_cid, prbId=0,
                map=[atom_map],
            )
    except Exception:
        pass

    return None


def to_extra_string(strain: dict[str, Any]) -> str:
    """Pack strain dict into the existing pipe-separated `extra` field.
    Format: `strain=<verdict>:<rmsd>` — the frontend treats the second
    field as a magnitude (Å in this implementation; kcal in older rows)."""
    return f"strain={strain['verdict']}:{strain.get('rmsd', strain.get('strain_kcal', '?'))}"
