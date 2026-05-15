"""ChEMBL REST client — fetch known-activity compounds for a UniProt target.

API base: https://www.ebi.ac.uk/chembl/api/data/
Reference: https://chembl.gitbook.io/chembl-interface-documentation/web-services

We use two endpoints:
  1. /target/search — UniProt accession → CHEMBL target id
  2. /activity     — filter activities by target + standard type

The activity filter pulls rows where ChEMBL's curators have already
normalised the affinity into `pchembl_value = -log10(standard_value [M])`.
That's the apples-to-apples number we'll correlate against Liganx's Vina
scores. We further filter to standard_relation '=' (exact, not lower-
bound or 'less than') so the correlation isn't polluted by censored data.
"""
from __future__ import annotations

import logging
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Iterator, Optional

log = logging.getLogger(__name__)

CHEMBL_BASE = "https://www.ebi.ac.uk/chembl/api/data"
USER_AGENT = "liganx-validation/0.1 (https://liganx.com)"
DEFAULT_TIMEOUT_S = 30.0


@dataclass
class ChemblActivity:
    """One known-activity data point for a (target, compound) pair."""

    molecule_chembl_id: str
    canonical_smiles: str
    standard_type: str               # e.g. "Ki", "IC50", "Kd"
    standard_value_nM: float         # always normalised to nanomolar
    pchembl_value: float             # -log10(M) — what we correlate against
    assay_chembl_id: Optional[str] = None
    target_chembl_id: Optional[str] = None


def _http_get_json(url: str, timeout_s: float = DEFAULT_TIMEOUT_S) -> dict:
    """Minimal stdlib GET — the validation script must run without extra deps."""
    import json
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout_s) as r:
        return json.loads(r.read().decode("utf-8"))


def target_chembl_id_for_uniprot(uniprot_id: str, *, timeout_s: float = DEFAULT_TIMEOUT_S) -> Optional[str]:
    """Resolve a UniProt accession (e.g. 'P00533') to its ChEMBL target id.

    Returns the FIRST exact-match target. ChEMBL sometimes returns
    multiple results for closely related targets — we take the canonical
    SINGLE PROTEIN entry when available.
    """
    if not uniprot_id:
        return None
    q = urllib.parse.quote(uniprot_id.strip())
    url = f"{CHEMBL_BASE}/target.json?target_components__accession={q}"
    data = _http_get_json(url, timeout_s=timeout_s)
    targets = data.get("targets", []) or []
    # Prefer "SINGLE PROTEIN" (cleanest mapping); fall back to first hit.
    for t in targets:
        if t.get("target_type") == "SINGLE PROTEIN":
            return t.get("target_chembl_id")
    if targets:
        return targets[0].get("target_chembl_id")
    return None


def fetch_known_activities(
    target_chembl_id: str,
    *,
    types: tuple[str, ...] = ("Ki", "IC50", "Kd"),
    limit: int = 100,
    min_pchembl: Optional[float] = None,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> list[ChemblActivity]:
    """Return up to `limit` known-activity rows for a target.

    Filters applied to keep the correlation clean:
      • standard_type ∈ {Ki, IC50, Kd}  (configurable)
      • standard_relation == "="  (exact values only — no censored data)
      • pchembl_value is not null  (ChEMBL pre-normalised affinity)
      • canonical_smiles is not null
      • optional min_pchembl gate (e.g. 4.0 to drop very weak binders)
    """
    types_q = ",".join(types)
    params = {
        "target_chembl_id": target_chembl_id,
        "standard_type__in": types_q,
        "standard_relation": "=",
        "pchembl_value__isnull": "false",
        "limit": str(min(limit, 1000)),
    }
    url = f"{CHEMBL_BASE}/activity.json?" + urllib.parse.urlencode(params)
    data = _http_get_json(url, timeout_s=timeout_s)
    rows = data.get("activities", []) or []

    out: list[ChemblActivity] = []
    for r in rows:
        smiles = r.get("canonical_smiles") or ""
        pchembl = _coerce_float(r.get("pchembl_value"))
        if not smiles or pchembl is None:
            continue
        if min_pchembl is not None and pchembl < min_pchembl:
            continue
        # standard_value can be µM or nM in ChEMBL responses; pchembl_value
        # is unit-normalised so prefer back-deriving from it for nM.
        # pchembl = -log10(M)  →  value_M = 10**(-pchembl)  →  value_nM = value_M * 1e9
        try:
            value_nm = (10 ** (-pchembl)) * 1e9
        except OverflowError:
            continue
        out.append(ChemblActivity(
            molecule_chembl_id=r.get("molecule_chembl_id", ""),
            canonical_smiles=smiles,
            standard_type=r.get("standard_type", ""),
            standard_value_nM=value_nm,
            pchembl_value=pchembl,
            assay_chembl_id=r.get("assay_chembl_id"),
            target_chembl_id=r.get("target_chembl_id"),
        ))
    return out


def _coerce_float(v) -> Optional[float]:
    """Defensive float coerce — ChEMBL occasionally returns strings."""
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def dedupe_by_molecule(activities: list[ChemblActivity]) -> list[ChemblActivity]:
    """ChEMBL often has multiple assays for the same compound on the same
    target — same molecule, different pchembl values. Take the MEDIAN
    pchembl per molecule so one outlier assay doesn't skew the correlation.
    The standard_type of the kept row is the type of the median measurement.
    """
    from statistics import median
    by_mol: dict[str, list[ChemblActivity]] = {}
    for a in activities:
        if not a.molecule_chembl_id:
            continue
        by_mol.setdefault(a.molecule_chembl_id, []).append(a)
    out: list[ChemblActivity] = []
    for mol_id, rows in by_mol.items():
        rows_sorted = sorted(rows, key=lambda r: r.pchembl_value)
        med_pchembl = median(r.pchembl_value for r in rows_sorted)
        # Take the row whose pchembl is closest to the median.
        chosen = min(rows_sorted, key=lambda r: abs(r.pchembl_value - med_pchembl))
        # Replace its pchembl with the median (so duplicates collapse cleanly).
        out.append(ChemblActivity(
            molecule_chembl_id=chosen.molecule_chembl_id,
            canonical_smiles=chosen.canonical_smiles,
            standard_type=chosen.standard_type,
            standard_value_nM=(10 ** (-med_pchembl)) * 1e9,
            pchembl_value=med_pchembl,
            assay_chembl_id=chosen.assay_chembl_id,
            target_chembl_id=chosen.target_chembl_id,
        ))
    return out
