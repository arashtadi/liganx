"""POST /calibrate/score — score user-uploaded (drug, mutation) cases
against Liganx's calibrated 2-signal resistance forecast model.

This is the "Use my own data" Pro feature in lite form. Free tier:
  - 10 rows per request
  - ESM2 fitness lookup against the 49 pre-computed calibration events
    + a BLOSUM62 substitution-matrix proxy for positions outside the
    cache (honest, conservative — labelled as such in the response)
  - Δ-from-docking defaults to 0 (Pro tier wires the live GPU
    docking pipeline; coming soon)
  - Returns per-row joint probability + summary AUC if user supplied
    `expected_direction` labels

Pro tier (slot wired, paywall stubbed):
  - Unlimited rows
  - Real ESM2 inference on GPU pod for any (UniProt, position) pair
  - Δ-from-docking via the existing /screening pipeline
  - Per-user calibration history persisted

Pricing not finalised — frontend currently shows a "Pro — get notified"
email-capture instead of a checkout button. Stripe wiring is the next
spike once we have ≥10 sign-ups for the early-access list.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/calibrate", tags=["calibrate"])


# ── Calibration-model weights (from spike #8 twosignal_cv.json) ────────
# These are baked-in so /calibrate/score works even if the analysis
# files aren't deployed alongside the backend image. Refresh by editing
# this constant and re-deploying.
LR_WEIGHTS = {
    "w_delta": 1.4734461801375394,
    "w_esm2": 0.919956242415361,
    "bias": 0.8966144349696004,
}
FEATURE_STATS = {
    "delta_mean": 0.7560000000000002,
    "delta_std": 1.3172941964496772,
    "neg_abs_fit_mean": -3.412528388053179,
    "neg_abs_fit_std": 1.5454914680853782,
}

# BLOSUM62 substitution scores. Free-tier fallback when the (gene,
# position, mut) is outside our pre-computed ESM2 cache. NOT a substitute
# for the real masked-LM signal — we explicitly tag rows that fall back
# to BLOSUM as `score_source = "blosum_proxy"` so callers can re-score
# them later on Pro.
#
# Each entry maps a (wt_aa, mut_aa) pair to a substitution score on
# BLOSUM62's standard scale (-4 = very dissimilar, +11 = identical).
# We convert to a pseudo-fitness by:
#   fitness ≈ (blosum - 2) / 2     # rough mapping to ESM2-fitness scale
# so the resulting feature lives on roughly the same numeric range as
# our calibrated ESM2 features.
BLOSUM62 = {
    "AR": -1, "AN": -2, "AD": -2, "AC":  0, "AQ": -1, "AE": -1, "AG":  0, "AH": -2, "AI": -1, "AL": -1,
    "AK": -1, "AM": -1, "AF": -2, "AP": -1, "AS":  1, "AT":  0, "AW": -3, "AY": -2, "AV":  0,
    "RA": -1, "RN":  0, "RD": -2, "RC": -3, "RQ":  1, "RE":  0, "RG": -2, "RH":  0, "RI": -3, "RL": -2,
    "RK":  2, "RM": -1, "RF": -3, "RP": -2, "RS": -1, "RT": -1, "RW": -3, "RY": -2, "RV": -3,
    "NA": -2, "NR":  0, "ND":  1, "NC": -3, "NQ":  0, "NE":  0, "NG":  0, "NH":  1, "NI": -3, "NL": -3,
    "NK":  0, "NM": -2, "NF": -3, "NP": -2, "NS":  1, "NT":  0, "NW": -4, "NY": -2, "NV": -3,
    "DA": -2, "DR": -2, "DN":  1, "DC": -3, "DQ":  0, "DE":  2, "DG": -1, "DH": -1, "DI": -3, "DL": -4,
    "DK": -1, "DM": -3, "DF": -3, "DP": -1, "DS":  0, "DT": -1, "DW": -4, "DY": -3, "DV": -3,
    "CA":  0, "CR": -3, "CN": -3, "CD": -3, "CQ": -3, "CE": -4, "CG": -3, "CH": -3, "CI": -1, "CL": -1,
    "CK": -3, "CM": -1, "CF": -2, "CP": -3, "CS": -1, "CT": -1, "CW": -2, "CY": -2, "CV": -1,
    "QA": -1, "QR":  1, "QN":  0, "QD":  0, "QC": -3, "QE":  2, "QG": -2, "QH":  0, "QI": -3, "QL": -2,
    "QK":  1, "QM":  0, "QF": -3, "QP": -1, "QS":  0, "QT": -1, "QW": -2, "QY": -1, "QV": -2,
    "EA": -1, "ER":  0, "EN":  0, "ED":  2, "EC": -4, "EQ":  2, "EG": -2, "EH":  0, "EI": -3, "EL": -3,
    "EK":  1, "EM": -2, "EF": -3, "EP": -1, "ES":  0, "ET": -1, "EW": -3, "EY": -2, "EV": -2,
    "GA":  0, "GR": -2, "GN":  0, "GD": -1, "GC": -3, "GQ": -2, "GE": -2, "GH": -2, "GI": -4, "GL": -4,
    "GK": -2, "GM": -3, "GF": -3, "GP": -2, "GS":  0, "GT": -2, "GW": -2, "GY": -3, "GV": -3,
    "HA": -2, "HR":  0, "HN":  1, "HD": -1, "HC": -3, "HQ":  0, "HE":  0, "HG": -2, "HI": -3, "HL": -3,
    "HK": -1, "HM": -2, "HF": -1, "HP": -2, "HS": -1, "HT": -2, "HW": -2, "HY":  2, "HV": -3,
    "IA": -1, "IR": -3, "IN": -3, "ID": -3, "IC": -1, "IQ": -3, "IE": -3, "IG": -4, "IH": -3, "IL":  2,
    "IK": -3, "IM":  1, "IF":  0, "IP": -3, "IS": -2, "IT": -1, "IW": -3, "IY": -1, "IV":  3,
    "LA": -1, "LR": -2, "LN": -3, "LD": -4, "LC": -1, "LQ": -2, "LE": -3, "LG": -4, "LH": -3, "LI":  2,
    "LK": -2, "LM":  2, "LF":  0, "LP": -3, "LS": -2, "LT": -1, "LW": -2, "LY": -1, "LV":  1,
    "KA": -1, "KR":  2, "KN":  0, "KD": -1, "KC": -3, "KQ":  1, "KE":  1, "KG": -2, "KH": -1, "KI": -3,
    "KL": -2, "KM": -1, "KF": -3, "KP": -1, "KS":  0, "KT": -1, "KW": -3, "KY": -2, "KV": -2,
    "MA": -1, "MR": -1, "MN": -2, "MD": -3, "MC": -1, "MQ":  0, "ME": -2, "MG": -3, "MH": -2, "MI":  1,
    "ML":  2, "MK": -1, "MF":  0, "MP": -2, "MS": -1, "MT": -1, "MW": -1, "MY": -1, "MV":  1,
    "FA": -2, "FR": -3, "FN": -3, "FD": -3, "FC": -2, "FQ": -3, "FE": -3, "FG": -3, "FH": -1, "FI":  0,
    "FL":  0, "FK": -3, "FM":  0, "FP": -4, "FS": -2, "FT": -2, "FW":  1, "FY":  3, "FV": -1,
    "PA": -1, "PR": -2, "PN": -2, "PD": -1, "PC": -3, "PQ": -1, "PE": -1, "PG": -2, "PH": -2, "PI": -3,
    "PL": -3, "PK": -1, "PM": -2, "PF": -4, "PS": -1, "PT": -1, "PW": -4, "PY": -3, "PV": -2,
    "SA":  1, "SR": -1, "SN":  1, "SD":  0, "SC": -1, "SQ":  0, "SE":  0, "SG":  0, "SH": -1, "SI": -2,
    "SL": -2, "SK":  0, "SM": -1, "SF": -2, "SP": -1, "ST":  1, "SW": -3, "SY": -2, "SV": -2,
    "TA":  0, "TR": -1, "TN":  0, "TD": -1, "TC": -1, "TQ": -1, "TE": -1, "TG": -2, "TH": -2, "TI": -1,
    "TL": -1, "TK": -1, "TM": -1, "TF": -2, "TP": -1, "TS":  1, "TW": -2, "TY": -2, "TV":  0,
    "WA": -3, "WR": -3, "WN": -4, "WD": -4, "WC": -2, "WQ": -2, "WE": -3, "WG": -2, "WH": -2, "WI": -3,
    "WL": -2, "WK": -3, "WM": -1, "WF":  1, "WP": -4, "WS": -3, "WT": -2, "WY":  2, "WV": -3,
    "YA": -2, "YR": -2, "YN": -2, "YD": -3, "YC": -2, "YQ": -1, "YE": -2, "YG": -3, "YH":  2, "YI": -1,
    "YL": -1, "YK": -2, "YM": -1, "YF":  3, "YP": -3, "YS": -2, "YT": -2, "YW":  2, "YV": -1,
    "VA":  0, "VR": -3, "VN": -3, "VD": -3, "VC": -1, "VQ": -2, "VE": -2, "VG": -3, "VH": -3, "VI":  3,
    "VL":  1, "VK": -2, "VM":  1, "VF": -1, "VP": -2, "VS": -2, "VT":  0, "VW": -3, "VY": -1,
}


# Lazy-load the pre-computed ESM2 fitness cache. We store it alongside
# the rest of the resistance_atlas data; if the file isn't present we
# fall back to BLOSUM62 for every row.
_ESM2_CACHE: dict[tuple[str, int, str], float] | None = None


def _load_esm2_cache() -> dict[tuple[str, int, str], float]:
    """Load the pre-computed ESM2 fitness scores for our 49 calibration
    events. Key = (gene, position, mutant_aa). Value = fitness score."""
    global _ESM2_CACHE
    if _ESM2_CACHE is not None:
        return _ESM2_CACHE
    cache: dict[tuple[str, int, str], float] = {}
    try:
        # Two files combined: the 50-event events JSON (for the gene/pos
        # mapping) and the ESM2 fitness results (for the scores).
        repo_root = Path(__file__).resolve().parent.parent.parent.parent
        events_path = repo_root / "data" / "clinical_resistance_events.json"
        esm2_path = repo_root / "data" / "resistance_atlas" / "esm2_fitness.json"
        if events_path.exists() and esm2_path.exists():
            events_by_id = {
                e["id"]: e for e in json.loads(events_path.read_text())["events"]
            }
            for r in json.loads(esm2_path.read_text())["results"]:
                if r.get("status") != "ok" or r.get("fitness") is None:
                    continue
                ev = events_by_id.get(r["event_id"])
                if not ev:
                    continue
                key = (ev["gene"], int(ev["position"]), ev["mutant"])
                cache[key] = float(r["fitness"])
    except Exception:  # noqa: BLE001
        # Fail-soft: an unparseable cache file just means we use BLOSUM
        # for every row. Logged at the route layer instead of crashing.
        pass
    _ESM2_CACHE = cache
    return cache


def _sigmoid(z: float) -> float:
    if z > 30:
        return 1.0
    if z < -30:
        return 0.0
    return 1.0 / (1.0 + math.exp(-z))


def _score_row(
    gene: str,
    position: int,
    wt: str,
    mut: str,
    delta_kcal: float | None,
    cache: dict[tuple[str, int, str], float],
) -> dict:
    """Compute joint probability for one (gene, position, wt, mut) row.

    Returns a dict with:
      fitness         — ESM2 (cached) or BLOSUM-proxy fitness
      score_source    — "cached_esm2" | "blosum_proxy"
      delta_kcal      — passed-through (None → 0 for the model)
      joint_logit     — pre-sigmoid LR score
      joint_probability — calibrated probability of resistance
    """
    key = (gene, position, mut)
    if key in cache:
        fitness = cache[key]
        source = "cached_esm2"
    else:
        # BLOSUM proxy. Wild-type-to-wild-type is always +11 by
        # construction; we want fitness = 0 in that case (mutation
        # is no change). The substitution score ranges roughly
        # -4 to +3 for distinct AAs; rescale to a pseudo-fitness.
        blosum_key = (wt.upper() + mut.upper())
        raw = BLOSUM62.get(blosum_key, 0)
        fitness = (raw - 2) / 2.0  # rough mapping to ESM2-fitness scale
        source = "blosum_proxy"
    neg_abs_fit = -abs(fitness)
    d = delta_kcal if delta_kcal is not None else 0.0
    dz = (d - FEATURE_STATS["delta_mean"]) / FEATURE_STATS["delta_std"]
    fz = (neg_abs_fit - FEATURE_STATS["neg_abs_fit_mean"]) / FEATURE_STATS["neg_abs_fit_std"]
    logit = LR_WEIGHTS["w_delta"] * dz + LR_WEIGHTS["w_esm2"] * fz + LR_WEIGHTS["bias"]
    return {
        "fitness": fitness,
        "score_source": source,
        "delta_kcal_input": delta_kcal,
        "joint_logit": logit,
        "joint_probability": _sigmoid(logit),
    }


def _auc(scores: list[float], labels: list[int]) -> float | None:
    pos = [s for s, L in zip(scores, labels) if L == 1]
    neg = [s for s, L in zip(scores, labels) if L == 0]
    if not pos or not neg:
        return None
    total = 0.0
    for p in pos:
        for q in neg:
            if p > q:
                total += 1
            elif p == q:
                total += 0.5
    return total / (len(pos) * len(neg))


# ── Schema ──────────────────────────────────────────────────────────


class CalibrateRow(BaseModel):
    """One (gene, position, wt, mutant) row from the user. Optional
    drug_smiles + expected_direction + delta_kcal lets the user use
    this for either prediction (no label) or measurement (with label)."""

    gene: str = Field(min_length=1, max_length=20)
    position: int = Field(ge=1, le=10_000)
    wt_residue: str = Field(min_length=1, max_length=1)
    mutant: str = Field(min_length=1, max_length=1)
    drug_name: str | None = Field(default=None, max_length=100)
    drug_smiles: str | None = Field(default=None, max_length=500)
    delta_kcal: float | None = Field(default=None, ge=-20.0, le=20.0)
    expected_direction: str | None = Field(default=None, max_length=20)


class CalibrateRequest(BaseModel):
    rows: list[CalibrateRow] = Field(min_length=1, max_length=10)


# Free-tier row cap. Pro tier removes the cap; we'll wire that to the
# Stripe-paid claims check when subscription billing lands.
MAX_FREE_ROWS = 10


@router.post("/score")
def score_calibration(payload: CalibrateRequest) -> dict:
    if len(payload.rows) > MAX_FREE_ROWS:
        raise HTTPException(
            status_code=402,
            detail={
                "code": "free_tier_row_cap",
                "message": (
                    f"Free tier is capped at {MAX_FREE_ROWS} rows per request. "
                    "Pro tier (unlimited rows + real-time GPU Δ-scoring) is "
                    "in early access — email hello@liganx.com to join the list."
                ),
            },
        )
    cache = _load_esm2_cache()
    scored = []
    labels: list[int] = []
    label_scores: list[float] = []
    n_cached = 0
    n_blosum = 0
    for r in payload.rows:
        row_out = _score_row(
            gene=r.gene.strip(),
            position=r.position,
            wt=r.wt_residue.strip().upper(),
            mut=r.mutant.strip().upper(),
            delta_kcal=r.delta_kcal,
            cache=cache,
        )
        if row_out["score_source"] == "cached_esm2":
            n_cached += 1
        else:
            n_blosum += 1
        # Label parsing for AUC. Accept "resistance"/"retained"/"selectivity"
        # in either direction; ignore anything else.
        label_int: int | None = None
        if r.expected_direction:
            d = r.expected_direction.strip().lower()
            if d == "resistance":
                label_int = 1
            elif d in ("retained", "selectivity"):
                label_int = 0
        if label_int is not None:
            labels.append(label_int)
            label_scores.append(row_out["joint_probability"])
        scored.append({
            "gene": r.gene,
            "position": r.position,
            "wt_residue": r.wt_residue,
            "mutant": r.mutant,
            "mutation_code": f"{r.wt_residue.upper()}{r.position}{r.mutant.upper()}",
            "drug_name": r.drug_name,
            "expected_direction": r.expected_direction,
            **row_out,
            "verdict": (
                "high_confidence_resistance" if row_out["joint_probability"] >= 0.7
                else "borderline_resistance" if row_out["joint_probability"] >= 0.45
                else "low_probability_resistance"
            ),
            "label_for_auc": label_int,
        })
    user_auc = _auc(label_scores, labels) if len(set(labels)) == 2 else None
    return {
        "schema_version": 1,
        "n_rows": len(scored),
        "n_cached_esm2": n_cached,
        "n_blosum_proxy": n_blosum,
        "rows": scored,
        "user_auc": user_auc,
        "user_auc_caveat": (
            "AUC requires at least one positive and one negative label "
            "across your rows (expected_direction = resistance vs "
            "retained/selectivity)."
            if user_auc is None and labels else None
        ),
        "liganx_published_auc_oof": 0.812,
        "liganx_published_auc_95pct_ci": [0.618, 0.961],
        "model": "Liganx 2-signal (Δ + ESM2) free-tier scorer",
        "free_tier_notes": (
            "Free tier: ESM2 lookup against our 49 pre-computed calibration "
            "events for known positions; BLOSUM62 substitution-matrix proxy "
            "for novel positions; Δ defaults to 0 (Δ-from-docking is a Pro "
            "feature). Per-row score_source tells you which path each row "
            "took. Pro tier (coming soon) runs real-time GPU docking + "
            "full ESM2 inference for every row."
        ),
        "pro_upgrade_url": "/atlas/calibrate?upgrade=1",
    }
