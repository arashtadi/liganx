"""Mutant-Selective Binder Discovery — step E: analog expansion.

Given a seed molecule (typically a top mutant-selective hit), find structurally
similar molecules to broaden the hit list. Two sources, combined and de-duped:

  1. LOCAL  — RDKit Morgan-fingerprint Tanimoto similarity over the curated
              compound libraries in backend/data/libraries/. Always available,
              no network.
  2. ChEMBL — the public ChEMBL similarity REST API, for breadth beyond our
              local set. Network-dependent; degrades silently when unreachable
              (the ChEMBL connector has been intermittently offline).

Self-contained: imported only by routers/selective.py. Never raises — every
entry point returns a (possibly empty) list so the API stays responsive even
when RDKit can't parse the seed or ChEMBL is down.
"""
from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

_LIB_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data" / "libraries"

# ChEMBL public REST similarity endpoint. threshold is an integer percent.
_CHEMBL_SIM = "https://www.ebi.ac.uk/chembl/api/data/similarity/{smiles}/{threshold}.json?limit={limit}"
_HTTP_TIMEOUT = 10

# Morgan fingerprint params — radius 2 (~ECFP4), 2048 bits is the de-facto
# standard for drug-like Tanimoto screening.
_FP_RADIUS = 2
_FP_BITS = 2048


def _canonical(smiles: str) -> Optional[str]:
    try:
        from rdkit import Chem
        m = Chem.MolFromSmiles(smiles)
        return Chem.MolToSmiles(m) if m is not None else None
    except Exception:  # noqa: BLE001
        return None


def _fp(smiles: str):
    """Morgan bit-vector fingerprint, or None if the SMILES won't parse."""
    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem
        m = Chem.MolFromSmiles(smiles)
        if m is None:
            return None
        return AllChem.GetMorganFingerprintAsBitVect(m, _FP_RADIUS, nBits=_FP_BITS)
    except Exception:  # noqa: BLE001
        return None


def _load_local_compounds() -> list[dict]:
    """Flatten every curated library JSON into [{name, smiles, source_library}]."""
    out: list[dict] = []
    if not _LIB_DIR.exists():
        return out
    for path in sorted(_LIB_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text())
        except Exception as e:  # noqa: BLE001
            log.warning("analog_search: failed to read %s: %s", path.name, e)
            continue
        lib_id = data.get("id") or path.stem
        for c in data.get("compounds", []) or []:
            smi = (c.get("smiles") or "").strip()
            if smi:
                out.append({"name": c.get("name") or "?", "smiles": smi, "source_library": lib_id})
    return out


def rdkit_similar(seed_smiles: str, *, top_k: int = 10, threshold: float = 0.3) -> list[dict]:
    """Tanimoto similarity of the seed against the local curated libraries.
    Returns up to top_k rows {name, smiles, similarity, source} with
    similarity >= threshold, excluding the seed itself, most-similar first.
    """
    try:
        from rdkit import DataStructs
    except Exception as e:  # noqa: BLE001
        log.warning("analog_search: RDKit unavailable: %s", e)
        return []

    seed_fp = _fp(seed_smiles)
    if seed_fp is None:
        return []
    seed_canon = _canonical(seed_smiles)

    scored: list[dict] = []
    for comp in _load_local_compounds():
        fp = _fp(comp["smiles"])
        if fp is None:
            continue
        if _canonical(comp["smiles"]) == seed_canon:
            continue  # don't return the seed back to the user
        sim = float(DataStructs.TanimotoSimilarity(seed_fp, fp))
        if sim >= threshold:
            scored.append({
                "name": comp["name"],
                "smiles": comp["smiles"],
                "similarity": round(sim, 3),
                "source": f"local:{comp['source_library']}",
            })
    scored.sort(key=lambda r: r["similarity"], reverse=True)
    return scored[:top_k]


def chembl_similar(seed_smiles: str, *, limit: int = 10, threshold: int = 70) -> list[dict]:
    """ChEMBL REST similarity search. threshold is an integer percent (40–100).
    Returns up to `limit` rows {name, smiles, similarity, source, chembl_id}.
    Degrades to [] on any network/parse failure.
    """
    canon = _canonical(seed_smiles) or seed_smiles
    url = _CHEMBL_SIM.format(
        smiles=urllib.parse.quote(canon, safe=""),
        threshold=int(threshold),
        limit=int(limit),
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Liganx/selective", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
            if resp.status != 200:
                return []
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        log.warning("analog_search: ChEMBL similarity fetch failed: %s", e)
        return []

    out: list[dict] = []
    for mol in data.get("molecules", []) or []:
        structs = mol.get("molecule_structures") or {}
        smi = (structs.get("canonical_smiles") or "").strip()
        if not smi:
            continue
        try:
            sim = round(float(mol.get("similarity", 0.0)) / 100.0, 3)
        except (TypeError, ValueError):
            sim = None
        out.append({
            "name": mol.get("pref_name") or mol.get("molecule_chembl_id") or "?",
            "smiles": smi,
            "similarity": sim,
            "source": "chembl",
            "chembl_id": mol.get("molecule_chembl_id"),
        })
    return out


def expand_analogs(
    seed_smiles: str,
    *,
    top_k: int = 10,
    local_threshold: float = 0.3,
    include_chembl: bool = True,
    chembl_threshold: int = 70,
) -> dict:
    """Step E entry point. Combine local RDKit hits + ChEMBL hits, de-dupe by
    canonical SMILES (local wins on a tie), sort by similarity.

    Returns:
        {
          "seed_smiles": str,
          "analogs": [{name, smiles, similarity, source, chembl_id?}, ...],
          "sources": {"local": int, "chembl": int},  # counts contributed
          "chembl_available": bool,
        }
    Never raises.
    """
    local = rdkit_similar(seed_smiles, top_k=top_k, threshold=local_threshold)
    chembl = chembl_similar(seed_smiles, limit=top_k) if include_chembl else []
    chembl_available = bool(chembl) or not include_chembl

    seen: set[str] = set()
    seed_canon = _canonical(seed_smiles)
    merged: list[dict] = []
    for row in (*local, *chembl):
        canon = _canonical(row["smiles"]) or row["smiles"]
        if canon == seed_canon or canon in seen:
            continue
        seen.add(canon)
        merged.append(row)

    merged.sort(key=lambda r: (r.get("similarity") is None, -(r.get("similarity") or 0.0)))
    return {
        "seed_smiles": seed_smiles,
        "analogs": merged[:max(top_k, len(local))],
        "sources": {"local": len(local), "chembl": len(chembl)},
        "chembl_available": chembl_available,
    }
