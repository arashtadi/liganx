"""Resistance Atlas spike #3 — baseline ROC + mechanism breakdown.

Reads backend/data/resistance_atlas/baseline_results.json (produced by
spike #2), joins back to the original events JSON for ground-truth
labels, and computes:

  1. Overall ROC-AUC for "Δ-from-rigid-docking predicts published clinical
     resistance" on the labelled positive set.
  2. Per-mechanism breakdown — what fraction of gatekeeper / covalent /
     conformational events does Δ alone recover?
  3. Confusion matrix at the noise-floor threshold (Δ > +1.0 kcal/mol
     interpreted as resistance prediction).
  4. The specific events Δ over- and under-calls, so the go/no-go
     conversation has concrete examples instead of just one summary
     number.

Output: backend/data/resistance_atlas/baseline_analysis.md (and an
optional baseline_analysis.json with the raw numbers for downstream
plotting).

NO external deps — pure stdlib. Numpy / scikit-learn would be cleaner
for ROC-AUC but adding them to the script-runtime deps for a one-off
spike isn't worth the install cost. The ROC implementation here is
trapezoidal on sorted (score, label) pairs — correct for non-tied
inputs and within rounding for the typical N≤50 ground truth set.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
EVENTS_PATH = REPO_ROOT / "backend" / "data" / "clinical_resistance_events.json"
BASELINE_PATH = REPO_ROOT / "backend" / "data" / "resistance_atlas" / "baseline_results.json"
OUTPUT_MD = REPO_ROOT / "backend" / "data" / "resistance_atlas" / "baseline_analysis.md"
OUTPUT_JSON = REPO_ROOT / "backend" / "data" / "resistance_atlas" / "baseline_analysis.json"

NOISE_FLOOR_KCAL = 1.0


def _roc_auc(scores: list[float], labels: list[int]) -> float:
    """Compute ROC-AUC. labels in {0, 1}; higher score = more likely positive.
    Uses the Mann-Whitney U equivalence: AUC = P(score_positive > score_negative).
    Tie handling: 0.5 weight per tied pair.
    """
    pos = [s for s, l in zip(scores, labels) if l == 1]
    neg = [s for s, l in zip(scores, labels) if l == 0]
    if not pos or not neg:
        return float("nan")
    n_correct = 0.0
    total = len(pos) * len(neg)
    for sp in pos:
        for sn in neg:
            if sp > sn:
                n_correct += 1.0
            elif sp == sn:
                n_correct += 0.5
    return n_correct / total


def _label_for_event(event: dict) -> int | None:
    """Convert expected_direction → binary label.
      resistance → 1 (should predict resistance)
      retained, selectivity → 0 (must NOT predict resistance)
      anything else → None (skip from ROC; goes in narrative only)
    """
    d = event.get("expected_direction")
    if d == "resistance":
        return 1
    if d in ("retained", "selectivity"):
        return 0
    return None


def main() -> int:
    if not BASELINE_PATH.exists():
        sys.stderr.write(
            f"baseline_results.json not found at {BASELINE_PATH}.\n"
            f"  Run backend/scripts/resistance_atlas_baseline.py first.\n"
        )
        return 2

    events = {e["id"]: e for e in json.loads(EVENTS_PATH.read_text())["events"]}
    baseline = json.loads(BASELINE_PATH.read_text())["results"]

    # Joined frame: one row per scoreable event with score (Δ) + binary label + mechanism.
    rows: list[dict[str, Any]] = []
    for r in baseline:
        eid = r["event_id"]
        ev = events.get(eid)
        if ev is None:
            continue
        if r.get("status") != "ok":
            rows.append({**r, "label": _label_for_event(ev), "mechanism": ev.get("mechanism")})
            continue
        delta = r.get("delta_kcal")
        if delta is None:
            continue
        label = _label_for_event(ev)
        if label is None:
            continue
        rows.append({
            "event_id": eid,
            "mutation_code": ev["mutation_code"],
            "drug": ev["drug_name"],
            "target": ev["target_slug"],
            "mechanism": ev["mechanism"],
            "expected_direction": ev["expected_direction"],
            "delta_kcal": delta,
            "wt_score": r.get("wt_score"),
            "mut_score": r.get("mut_score"),
            "label": label,
            "status": "ok",
        })

    scored = [r for r in rows if r.get("status") == "ok" and r.get("label") is not None]
    if not scored:
        sys.stderr.write("No scored rows with usable labels. Cannot compute baseline.\n")
        return 1

    # Overall ROC-AUC. The score variable is Δ (mut - wt) — higher Δ → more
    # likely resistance under the rigid-docking model.
    scores = [r["delta_kcal"] for r in scored]
    labels = [r["label"] for r in scored]
    auc_overall = _roc_auc(scores, labels)

    # Per-mechanism breakdown.
    mech_groups: dict[str, list[dict]] = {}
    for r in scored:
        mech_groups.setdefault(r["mechanism"], []).append(r)
    per_mech: dict[str, dict] = {}
    for mech, group in sorted(mech_groups.items()):
        m_scores = [g["delta_kcal"] for g in group]
        m_labels = [g["label"] for g in group]
        per_mech[mech] = {
            "n": len(group),
            "n_positive": sum(m_labels),
            "n_negative": len(group) - sum(m_labels),
            "auc": _roc_auc(m_scores, m_labels) if (any(m_labels) and not all(m_labels)) else None,
            "mean_delta_positive": (
                sum(s for s, l in zip(m_scores, m_labels) if l == 1) / max(1, sum(m_labels))
                if any(m_labels) else None
            ),
            "mean_delta_negative": (
                sum(s for s, l in zip(m_scores, m_labels) if l == 0) / max(1, len(group) - sum(m_labels))
                if any(l == 0 for l in m_labels) else None
            ),
        }

    # Confusion matrix at noise-floor threshold.
    # Predict resistance if Δ > NOISE_FLOOR_KCAL (the band on /validation).
    tp = sum(1 for r in scored if r["label"] == 1 and r["delta_kcal"] > NOISE_FLOOR_KCAL)
    fn = sum(1 for r in scored if r["label"] == 1 and r["delta_kcal"] <= NOISE_FLOOR_KCAL)
    fp = sum(1 for r in scored if r["label"] == 0 and r["delta_kcal"] > NOISE_FLOOR_KCAL)
    tn = sum(1 for r in scored if r["label"] == 0 and r["delta_kcal"] <= NOISE_FLOOR_KCAL)

    precision = tp / (tp + fp) if (tp + fp) > 0 else float("nan")
    recall = tp / (tp + fn) if (tp + fn) > 0 else float("nan")
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else float("nan")

    # Mis-call narrative.
    false_negatives = sorted(
        [r for r in scored if r["label"] == 1 and r["delta_kcal"] <= NOISE_FLOOR_KCAL],
        key=lambda r: r["delta_kcal"],
    )
    false_positives = sorted(
        [r for r in scored if r["label"] == 0 and r["delta_kcal"] > NOISE_FLOOR_KCAL],
        key=lambda r: -r["delta_kcal"],
    )

    # Persist JSON.
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps({
        "n_total": len(rows),
        "n_scored": len(scored),
        "auc_overall": auc_overall,
        "threshold_kcal": NOISE_FLOOR_KCAL,
        "confusion": {"tp": tp, "fn": fn, "fp": fp, "tn": tn,
                      "precision": precision, "recall": recall, "f1": f1},
        "per_mechanism": per_mech,
        "false_negatives": false_negatives,
        "false_positives": false_positives,
    }, indent=2))

    # Markdown report.
    lines: list[str] = []
    lines.append("# Resistance Atlas — Δ-baseline analysis\n")
    lines.append("Spike #3 output. Measures how much of the clinical-resistance\n"
                 "ground truth (50 published events) Liganx's rigid-receptor docking\n"
                 "Δ alone recovers. The result is the **lift target** for the full\n"
                 "Resistance Atlas build — what ESM2 + codon accessibility have to\n"
                 "add on top to push us past ROC-AUC 0.85.\n")
    lines.append(f"\n**Headline numbers**\n")
    lines.append(f"- Scoreable events: **{len(scored)}** of {len(rows)} (rest skipped or failed).")
    lines.append(f"- Overall ROC-AUC (Δ alone, label = expected resistance): **{auc_overall:.3f}**")
    lines.append(f"- At noise-floor threshold (Δ > +{NOISE_FLOOR_KCAL:.1f} kcal/mol predicts resistance):")
    lines.append(f"  - precision = {precision:.2f}, recall = {recall:.2f}, F1 = {f1:.2f}")
    lines.append(f"  - confusion: TP={tp} FN={fn} FP={fp} TN={tn}\n")
    lines.append("\n## Per-mechanism breakdown\n")
    lines.append("| Mechanism | N | Pos | Neg | AUC | mean Δ (pos) | mean Δ (neg) |")
    lines.append("|---|---|---|---|---|---|---|")
    for mech, m in per_mech.items():
        auc_str = f"{m['auc']:.3f}" if m['auc'] is not None else "—"
        mp = m['mean_delta_positive']
        mn = m['mean_delta_negative']
        mp_str = f"{mp:+.2f}" if mp is not None else "—"
        mn_str = f"{mn:+.2f}" if mn is not None else "—"
        lines.append(
            f"| {mech} | {m['n']} | {m['n_positive']} | {m['n_negative']} | "
            f"{auc_str} | {mp_str} | {mn_str} |"
        )

    if false_negatives:
        lines.append("\n## False negatives — clinical resistance that Δ missed\n")
        lines.append("These are the events ESM2 + accessibility have to recover.\n")
        for r in false_negatives:
            lines.append(
                f"- **{r['event_id']}** ({r['drug']} vs {r['target']} {r['mutation_code']}, "
                f"{r['mechanism']}): Δ = {r['delta_kcal']:+.2f}"
            )
    if false_positives:
        lines.append("\n## False positives — Δ over-called these (should be retained/selective)\n")
        for r in false_positives:
            lines.append(
                f"- **{r['event_id']}** ({r['drug']} vs {r['target']} {r['mutation_code']}, "
                f"{r['mechanism']}, expected {r['expected_direction']}): Δ = {r['delta_kcal']:+.2f}"
            )

    lines.append("\n## Go / no-go interpretation\n")
    if auc_overall >= 0.65:
        lines.append(f"AUC {auc_overall:.3f} ≥ 0.65 — **green-light the full atlas build**. "
                     "ESM2 + accessibility signals should be additive on covalent / "
                     "conformational events where Δ alone is weak; target ROC-AUC ≥ 0.85.")
    elif auc_overall >= 0.55:
        lines.append(f"AUC {auc_overall:.3f} between 0.55 and 0.65 — **caution**. Δ alone is "
                     "weakly informative. Worth doing a single ESM2-only experiment on the "
                     "same calibration set BEFORE committing the full pipeline; if ESM2 alone "
                     "also lands below 0.7, the multi-signal product is not credible.")
    else:
        lines.append(f"AUC {auc_overall:.3f} < 0.55 — **rethink**. Δ-from-rigid-docking is at "
                     "or near chance on this ground truth. Likely causes: (a) the calibration "
                     "set is dominated by covalent / conformational mechanisms that Vina can't "
                     "see; (b) pocket-box geometry is off for several entries. Diagnose before "
                     "scaling.")
    lines.append("")

    OUTPUT_MD.write_text("\n".join(lines))
    sys.stderr.write(f"Wrote {OUTPUT_MD}\n")
    sys.stderr.write(f"Wrote {OUTPUT_JSON}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
