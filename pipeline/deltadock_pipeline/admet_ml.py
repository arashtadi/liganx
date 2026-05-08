"""ADMET risk predictions — rule-based heuristics over RDKit descriptors.

Extends the basic descriptor-only ADMET (admet.py) with the four endpoints
chemists actually use to triage compounds:

  • BBB        — Blood-brain barrier penetration (Pajouhesh-Lenz / Egan)
  • hERG       — Cardiac potassium-channel risk (cardiotoxicity)
  • CYP3A4     — Metabolic inhibition risk (drug-drug interaction)
  • CYP2D6     — Same, for the other big metabolizer
  • DILI       — Drug-induced liver injury risk (Greene/Liguori motifs)

Why rule-based instead of ML:
  * Fast: <100 ms/compound vs ~5 s for admet-ai's Chemprop ensembles.
  * No deploy weight: RDKit is already in the pipeline; admet-ai needs
    ~500 MB of model files that don't fit Fly's free tier.
  * Honest: results are labelled as 'rule-based heuristic', not pretending
    to be ML-grade predictions.
  * Structured for swap-in: each predict_*_risk function returns the same
    {label, evidence} dict shape that an admet-ai wrapper would, so a
    future ML upgrade is one function-body change per endpoint.

References for the rule sets:
  - Pajouhesh & Lenz (2005), 'Medicinal Chemical Properties of Successful
    Central Nervous System Drugs' — BBB rules.
  - Aronov (2005), 'Predictive in silico modeling for hERG channel
    blockers' — hERG pharmacophore + descriptor heuristics.
  - Greene et al. (2010), Liguori et al. (2017) — DILI structural alerts.
  - Veith et al. (2009), CYP450 inhibition descriptor patterns.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any

log = logging.getLogger(__name__)

RiskLabel = str  # "low" | "medium" | "high"

# ---------------------------------------------------------------
# admet-ai pod path (added 2026-05-08)
#
# When POD_DOCK_URL is set AND POD_ADMET_ENABLED is truthy, we call
# the pod's /admet/predict endpoint first. The pod runs admet-ai
# (Chemprop ensemble) on CPU and returns continuous probabilities
# for ~100 ADMET endpoints. We map the five we care about onto the
# same {label, evidence} shape the rule-based path returns so the
# frontend doesn't need to know which path produced the result.
#
# We DO NOT wake the pod for ADMET. If the call times out (3 s) or
# errors, we fall through to the rule-based path silently — the
# user always gets *some* answer, just possibly the cheaper one.
# This avoids the brutal UX where opening Studio waits 3-5 min
# for a pod cold start before showing chips.
# ---------------------------------------------------------------
def _pod_url() -> str | None:
    """Return the pod base URL if both POD_DOCK_URL and admet are
    enabled; None otherwise. POD_ADMET_ENABLED defaults true so once
    POD_DOCK_URL is set, ADMET upgrades automatically."""
    base = (os.environ.get("POD_DOCK_URL") or "").rstrip("/")
    if not base:
        return None
    enabled = (os.environ.get("POD_ADMET_ENABLED", "true") or "").strip().lower()
    if enabled in ("0", "false", "no", "off"):
        return None
    return base


# admet-ai → {label} cutoffs.
#
# These follow each endpoint's training dataset's standard binary
# cutoff (model was trained against), with a 'medium' band added
# for borderline cases. Sources:
#   - hERG / DILI: 0.5 = positive (Karim 2021, Liu 2015)
#   - CYP_Veith inhibition: 0.5 = inhibitor (Veith 2009)
#   - BBB_Martins: 0.5 = penetrant (Martins 2012)
#
# 'high' for hERG/DILI/CYP means *risk*; 'high' for BBB means
# 'will cross' (interpretation flips depending on whether the user
# wants CNS penetration or to avoid it — UI handles framing).
def _admet_label(prob: float, low_max: float = 0.3, med_max: float = 0.6) -> str:
    if prob is None:
        return "low"
    if prob <= low_max:
        return "low"
    if prob <= med_max:
        return "medium"
    return "high"


def _admet_to_extended(props: dict[str, Any]) -> dict[str, Any]:
    """Map the admet-ai property dict (~100 keys) onto our 5-channel
    {bbb, herg, cyp3a4, cyp2d6, dili} schema. Each evidence string
    quotes the raw probability so the user can audit how close to
    the cutoff a borderline call was."""
    def field(name: str, prob_key: str) -> dict[str, str]:
        prob = props.get(prob_key)
        try:
            p = float(prob) if prob is not None else None
        except (TypeError, ValueError):
            p = None
        if p is None:
            return {"label": "low", "evidence": f"{name} prob unavailable"}
        return {"label": _admet_label(p), "evidence": f"{name} probability {p:.2f}"}

    return {
        "source": "ml",
        "bbb": field("BBB penetration", "BBB_Martins"),
        "herg": field("hERG block", "hERG"),
        "cyp3a4": field("CYP3A4 inhibition", "CYP3A4_Veith"),
        "cyp2d6": field("CYP2D6 inhibition", "CYP2D6_Veith"),
        "dili": field("DILI", "DILI"),
    }


def _predict_admet_extended_pod(smiles: str, pod_url: str, timeout: float = 3.0) -> dict[str, Any] | None:
    """POST /admet/predict on the pod. Returns the mapped extended dict,
    or None on any failure (timeout, network, 5xx, malformed payload).
    The caller should treat None as 'fall back to rule-based'."""
    try:
        import httpx  # type: ignore
    except ImportError:
        return None
    url = pod_url + "/admet/predict"
    try:
        with httpx.Client(timeout=timeout) as c:
            r = c.post(url, json={"smiles": smiles})
            if r.status_code != 200:
                log.info("admet pod returned %d for %s", r.status_code, smiles[:40])
                return None
            data = r.json()
    except Exception as e:  # noqa: BLE001
        # 3-second timeout means "the pod is asleep or busy" — quietly
        # fall back to rules; this is expected behaviour when the
        # watchdog has stopped the pod for cost control.
        log.info("admet pod call failed (%s) — falling back to rules", type(e).__name__)
        return None
    props = data.get("properties")
    if not isinstance(props, dict):
        return None
    return _admet_to_extended(props)


def _label_from_score(score: float, low_max: float, med_max: float) -> RiskLabel:
    """Map a 0..1 score onto low/medium/high tiers."""
    if score <= low_max:
        return "low"
    if score <= med_max:
        return "medium"
    return "high"


# Pre-compiled SMARTS patterns. We compile once at import to avoid the
# per-call overhead of MolFromSmarts (each call does a small parse).
def _compile_smarts(patterns: list[str]) -> list[Any]:
    try:
        from rdkit import Chem
    except ImportError:
        return []
    out = []
    for p in patterns:
        m = Chem.MolFromSmarts(p)
        if m is not None:
            out.append((p, m))
    return out


# hERG cardiotoxicity — basic nitrogen + lipophilic aromatic + size.
# Aronov's classic pharmacophore: a basic amine (often piperidine /
# piperazine), one or more aromatic rings, and overall logP > 3.5.
# We score by motif hits + descriptor thresholds.
_HERG_MOTIFS = _compile_smarts([
    "[$([#7;X3;H0,H1;!$(N=*);!$(N#*)])]",  # neutral basic nitrogen (sp3)
    "[#7+]",                                # quaternary nitrogen
    "C1CCN(CC1)c2ccccc2",                  # N-aryl piperidine — terfenadine-like
    "C1CN(CCN1)c2ccccc2",                  # N-aryl piperazine
])

# DILI / hepatotoxicity — Greene & Liguori reactive-group alerts.
# Each motif is independently a meaningful red flag in liver tox QSAR.
_DILI_MOTIFS = _compile_smarts([
    "[N+](=O)[O-]",       # nitro
    "[NX3][NX3]",         # hydrazine / hydrazide
    "C(=O)Cl",            # acyl chloride
    "C(=O)Br",            # acyl bromide
    "C1OC1",              # epoxide
    "[c;H1]1[c;H1][c;H1][c;H1][c;H1][c;H1]1[NX3;H2]",  # aniline (some)
    "[#6]=[#6][#6]=[O]",  # michael acceptor (acrylate/enone)
])


@lru_cache(maxsize=2048)
def predict_admet_extended(smiles: str) -> dict[str, Any] | None:
    """Compute extended ADMET risks. Returns None on parse failure.

    Two-tier prediction path:
      1. If POD_DOCK_URL is set, try the pod's /admet/predict endpoint
         (admet-ai Chemprop ensemble, CPU inference, ~0.3-2 s/molecule
         + free thereafter via SQLite cache on the pod). Returns
         source="ml" on success.
      2. Fall back to the rule-based heuristics below. Returns
         source="rule-based". Always available, ~10 ms/molecule.

    The pod call uses a tight 3 s timeout — long enough for a warm
    pod, short enough that a sleeping pod degrades the user to rules
    without stalling the response. We deliberately do NOT wake the
    pod for ADMET; cost control wins over sharper predictions.

    Output dict keys (each value is `{label: "low"|"medium"|"high",
    evidence: <short string>}`):
      bbb              — BBB penetration likelihood
      herg             — hERG cardiac channel binding risk
      cyp3a4           — CYP3A4 metabolic inhibition risk
      cyp2d6           — CYP2D6 metabolic inhibition risk
      dili             — Drug-induced liver injury risk
    Plus a top-level "source": "ml" | "rule-based" tag.
    """
    # --- Tier 1: pod admet-ai ---
    pod = _pod_url()
    if pod:
        ml = _predict_admet_extended_pod(smiles, pod)
        if ml is not None:
            return ml

    # --- Tier 2: rule-based fallback ---
    return _predict_admet_extended_rules(smiles)


def _predict_admet_extended_rules(smiles: str) -> dict[str, Any] | None:
    """Rule-based ADMET (RDKit + SMARTS). Always available, instant,
    pre-existing implementation kept verbatim for stability — only
    wrapped by the new pod-first dispatch above."""
    try:
        from rdkit import Chem
        from rdkit.Chem import Crippen, Descriptors, Lipinski, rdMolDescriptors
    except ImportError as e:
        log.warning("RDKit unavailable for admet_ml: %s", e)
        return None

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None

    try:
        mw = Descriptors.MolWt(mol)
        logp = Crippen.MolLogP(mol)
        tpsa = rdMolDescriptors.CalcTPSA(mol)
        hbd = Lipinski.NumHDonors(mol)
        hba = Lipinski.NumHAcceptors(mol)
        rot_bonds = Lipinski.NumRotatableBonds(mol)
        arom_rings = rdMolDescriptors.CalcNumAromaticRings(mol)
    except Exception as e:  # noqa: BLE001
        log.warning("admet_ml descriptors failed: %s", e)
        return None

    # ── BBB penetration (Pajouhesh-Lenz / Egan)
    # Each criterion contributes a point; ≥3 = likely BBB+, ≤1 = likely BBB−.
    bbb_score = 0
    bbb_reasons: list[str] = []
    if 1.0 <= logp <= 4.0:
        bbb_score += 1
    else:
        bbb_reasons.append(f"logP {logp:.1f} outside 1–4")
    if mw < 450:
        bbb_score += 1
    else:
        bbb_reasons.append(f"MW {mw:.0f} >450")
    if tpsa < 90:
        bbb_score += 1
    else:
        bbb_reasons.append(f"TPSA {tpsa:.0f} ≥90")
    if hbd <= 3:
        bbb_score += 1
    else:
        bbb_reasons.append(f"HBD {hbd} >3")
    bbb_label = "high" if bbb_score >= 3 else "medium" if bbb_score >= 2 else "low"
    bbb_evidence = f"{bbb_score}/4 favourable criteria" + (
        " · " + "; ".join(bbb_reasons[:2]) if bbb_reasons and bbb_label != "high" else ""
    )

    # ── hERG cardiotoxicity (Aronov pharmacophore + descriptor combo)
    herg_motif_hits = sum(1 for _, m in _HERG_MOTIFS if mol.HasSubstructMatch(m))
    herg_logp_flag = logp > 3.5
    # Each axis contributes; aryl-piperidine + high logP = classic hERG hit.
    herg_score = (
        (0.5 if herg_motif_hits >= 1 else 0.0)
        + (0.3 if herg_motif_hits >= 2 else 0.0)
        + (0.2 if herg_logp_flag else 0.0)
        + (0.1 if arom_rings >= 2 else 0.0)
    )
    herg_label = _label_from_score(herg_score, low_max=0.2, med_max=0.6)
    herg_evidence_parts: list[str] = []
    if herg_motif_hits:
        herg_evidence_parts.append(f"{herg_motif_hits} basic-N motif{'s' if herg_motif_hits != 1 else ''}")
    if herg_logp_flag:
        herg_evidence_parts.append(f"logP {logp:.1f} (>3.5)")
    if arom_rings >= 2:
        herg_evidence_parts.append(f"{arom_rings} aromatic rings")
    herg_evidence = ", ".join(herg_evidence_parts) or "no flagged motifs"

    # ── CYP3A4 inhibition risk
    # Heuristic: large lipophilic compounds with multiple aromatic rings.
    cyp3a4_score = 0.0
    if logp > 4.0:
        cyp3a4_score += 0.4
    elif logp > 3.0:
        cyp3a4_score += 0.2
    if arom_rings >= 3:
        cyp3a4_score += 0.3
    elif arom_rings >= 2:
        cyp3a4_score += 0.15
    if mw > 450:
        cyp3a4_score += 0.2
    cyp3a4_label = _label_from_score(cyp3a4_score, low_max=0.2, med_max=0.5)
    cyp3a4_evidence = f"logP {logp:.1f}, MW {mw:.0f}, {arom_rings} aromatic ring(s)"

    # ── CYP2D6 inhibition risk
    # Heuristic: basic nitrogen + lipophilic — Veith et al. patterns.
    cyp2d6_score = 0.0
    if logp > 3.0:
        cyp2d6_score += 0.3
    if herg_motif_hits >= 1:  # reuses basic-N detection
        cyp2d6_score += 0.4
    if hbd <= 1:
        cyp2d6_score += 0.1
    cyp2d6_label = _label_from_score(cyp2d6_score, low_max=0.2, med_max=0.5)
    cyp2d6_evidence = (
        f"basic N + logP {logp:.1f}" if herg_motif_hits else f"logP {logp:.1f}, HBD {hbd}"
    )

    # ── DILI hepatotoxicity (structural alerts)
    dili_motif_hits: list[str] = [
        pat for pat, m in _DILI_MOTIFS if mol.HasSubstructMatch(m)
    ]
    dili_label = "high" if len(dili_motif_hits) >= 1 else "low"
    dili_evidence = (
        f"{len(dili_motif_hits)} reactive group flag(s): {dili_motif_hits[0]}…"
        if dili_motif_hits
        else "no structural alerts"
    )
    # We deliberately don't emit "medium" for DILI — the Greene rule set
    # is binary by design; either a reactive group is present or it isn't.

    return {
        "source": "rule-based",
        "bbb": {"label": bbb_label, "evidence": bbb_evidence},
        "herg": {"label": herg_label, "evidence": herg_evidence},
        "cyp3a4": {"label": cyp3a4_label, "evidence": cyp3a4_evidence},
        "cyp2d6": {"label": cyp2d6_label, "evidence": cyp2d6_evidence},
        "dili": {"label": dili_label, "evidence": dili_evidence},
        # Unused for now but here so a future ML upgrade can fill them.
        "_unused_fields_for_ml_upgrade": ["ames", "pgp", "hia", "ppb", "clearance"],
    }
