"""ADMET / drug-likeness descriptors from a SMILES string.

Everything here is RDKit-only — no external API calls, no licensed
datasets. Computes in 5-50ms per molecule (drug-sized) so we run it inline
on every compound submission and cache by canonical SMILES.

Numbers we report and why each one matters:

  * MW      — Molecular weight. Lipinski cap at 500 Da.
  * LogP    — Crippen MolLogP. Lipinski cap at 5.
  * HBA/HBD — H-bond acceptors / donors. Lipinski caps at 10 / 5.
  * TPSA    — Topological polar surface area. Veber: ≤140 Å² for oral
              bioavailability. >140 generally means poor membrane permeation.
  * RotBonds — Rotatable bonds. Veber: ≤10 for oral. Higher = more
              conformational entropy cost on binding.
  * QED     — Quantitative Estimate of Drug-likeness (Bickerton 2012).
              0-1, higher is more drug-like. >0.5 is "good".
  * Lipinski / Veber — Boolean pass/fail of the canonical rule sets.
  * PAINS   — Pan-Assay INterference compounds. Substructure flags from
              the Baell & Holloway 2010 set, shipped with RDKit. Hits
              are likely to give false positives in screening assays.
  * NumRings / NumAromaticRings — Size descriptors.

Anything we might want to add later (instant, RDKit-only):
  * Bertz complexity, sp3 fraction, NumHeavyAtoms, Synthetic Accessibility.

Out of scope for this module (heavier, ML-based, separate work):
  * BBB permeability, P-gp substrate, hERG, CYP inhibition, AMES tox.
    These need ML models (e.g. ADMET-AI / SwissADME backend) and add
    weight to the deploy. Pipeline already designed so we can add an
    `admet_ml.py` sibling later that augments the same dict.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

log = logging.getLogger(__name__)


# Round helpers — keeps the JSON small and the frontend chips tidy.
def _r(v: float, n: int = 2) -> float:
    return round(float(v), n)


@lru_cache(maxsize=2048)
def compute_admet(smiles: str) -> dict[str, Any] | None:
    """Compute ADMET descriptors for a SMILES. Returns None on parse failure
    (so the caller can render "—" instead of crashing). LRU-cached because
    the same compound shows up in many jobs and these descriptors are
    deterministic — no need to recompute.

    The cache is process-local (not Redis) — fine for our scale and avoids
    a network hop on the hot path.
    """
    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem, Crippen, Descriptors, Lipinski, QED, rdMolDescriptors
    except ImportError as e:
        log.warning("RDKit unavailable: %s", e)
        return None

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None

    try:
        mw = Descriptors.MolWt(mol)
        logp = Crippen.MolLogP(mol)
        hba = Lipinski.NumHAcceptors(mol)
        hbd = Lipinski.NumHDonors(mol)
        tpsa = rdMolDescriptors.CalcTPSA(mol)
        rotb = Lipinski.NumRotatableBonds(mol)
        rings = rdMolDescriptors.CalcNumRings(mol)
        arom_rings = rdMolDescriptors.CalcNumAromaticRings(mol)
        heavy_atoms = mol.GetNumHeavyAtoms()
        try:
            qed_val = QED.qed(mol)
        except Exception:
            qed_val = None

        # Lipinski Rule of Five — counts the number of violations.
        # 0 violations = passes "cleanly"; 1 violation is still considered
        # acceptable in most pharma settings (the original rule allows one).
        lipinski_violations = sum([
            mw > 500,
            logp > 5,
            hba > 10,
            hbd > 5,
        ])
        # Veber 2002: oral bioavailability filter.
        veber_violations = sum([
            rotb > 10,
            tpsa > 140,
        ])

        pains_hits = _check_pains(mol)

        # Extended ADMET (hERG, BBB, CYP, DILI). Side module so a future
        # ML upgrade (admet-ai / Chemprop) is one drop-in. Failure here
        # is non-fatal — descriptors above are still useful on their own.
        extended: dict[str, Any] | None = None
        try:
            from .admet_ml import predict_admet_extended
            extended = predict_admet_extended(smiles)
        except Exception as e:  # noqa: BLE001
            log.warning("admet_ml extended predict failed for %s: %s", smiles[:40], e)

        return {
            "mw": _r(mw, 1),
            "logp": _r(logp, 2),
            "hba": int(hba),
            "hbd": int(hbd),
            "tpsa": _r(tpsa, 1),
            "rot_bonds": int(rotb),
            "rings": int(rings),
            "aromatic_rings": int(arom_rings),
            "heavy_atoms": int(heavy_atoms),
            "qed": _r(qed_val, 2) if qed_val is not None else None,
            "lipinski_violations": int(lipinski_violations),
            "lipinski_pass": lipinski_violations == 0,
            "veber_violations": int(veber_violations),
            "veber_pass": veber_violations == 0,
            # PAINS: list of matched filter names (empty = clean).
            # Truncate to first 3 to keep the JSON compact in the matrix view.
            "pains": pains_hits[:3],
            "pains_count": len(pains_hits),
            # Extended ADMET risk predictions. Optional — frontend
            # AdmetChips card renders only when present.
            "extended": extended,
        }
    except Exception as e:
        log.warning("ADMET compute failed for %s: %s", smiles[:40], e)
        return None


# PAINS catalog is heavy to instantiate (~100ms first time) — build once.
_PAINS_CATALOG = None


def _check_pains(mol) -> list[str]:
    """Return the list of PAINS filter names this molecule matches.
    Empty list = clean (no PAINS substructures found)."""
    global _PAINS_CATALOG
    try:
        from rdkit.Chem import FilterCatalog
    except ImportError:
        return []

    if _PAINS_CATALOG is None:
        try:
            params = FilterCatalog.FilterCatalogParams()
            params.AddCatalog(FilterCatalog.FilterCatalogParams.FilterCatalogs.PAINS)
            _PAINS_CATALOG = FilterCatalog.FilterCatalog(params)
        except Exception as e:
            log.warning("Could not build PAINS catalog: %s", e)
            _PAINS_CATALOG = False  # sentinel — don't retry
            return []

    if _PAINS_CATALOG is False:
        return []

    try:
        matches = _PAINS_CATALOG.GetMatches(mol)
        return [m.GetDescription() for m in matches]
    except Exception:
        return []
