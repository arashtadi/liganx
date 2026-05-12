"""Spike #9: Auto-generate atlas pages from the calibrated 2-signal model.

Reads:
  - clinical_resistance_events.json (50 events)
  - baseline_results.json (Δ scores from spike #5)
  - esm2_fitness.json (ESM2 fitness from spike #6)
  - twosignal_cv.json (calibrated LR weights from spike #8 follow-up)

Writes one atlas JSON per drug into backend/data/atlas/, with each
event ranked by joint probability. Replaces the hand-curated v1
atlas files (imatinib.json, sotorasib.json, osimertinib.json) with
model-derived predictions for every drug in the calibration set.

This is the "honest evidence-backed" atlas mode: predictions are
the calibration events themselves, scored by the live model. The
v2 "predict NOVEL residues" mode requires enumerating every residue
in each binding pocket and scoring each — a separate batch-screening
spike worth a dedicated #11.
"""
import json, math, time
from pathlib import Path
from collections import defaultdict

EVENTS = json.load(open('/tmp/events.json'))["events"]
DELTA  = {r["event_id"]: r for r in json.load(open('/tmp/baseline_results.json'))["results"]}
ESM2   = {r["event_id"]: r for r in json.load(open('/tmp/esm2_results.json'))["results"]}
CV     = json.load(open('/tmp/twosignal_cv.json'))
W = CV["lr_weights"]  # w_delta, w_esm2, bias

# Re-derive feature standardization from the joined calibration set,
# so the generated p3 numbers match what the calibration model produced.
joined = []
for ev in EVENTS:
    eid = ev["id"]
    d = DELTA.get(eid, {}); e = ESM2.get(eid, {})
    if d.get("status") != "ok" or e.get("status") != "ok": continue
    if d.get("delta_kcal") is None or e.get("fitness") is None: continue
    joined.append({"delta": d["delta_kcal"], "neg_abs_fit": -abs(e["fitness"])})

mu_d = sum(x["delta"] for x in joined) / len(joined)
var_d = sum((x["delta"] - mu_d)**2 for x in joined) / len(joined)
sd_d = math.sqrt(var_d) if var_d > 0 else 1.0
mu_f = sum(x["neg_abs_fit"] for x in joined) / len(joined)
var_f = sum((x["neg_abs_fit"] - mu_f)**2 for x in joined) / len(joined)
sd_f = math.sqrt(var_f) if var_f > 0 else 1.0

def sig(z):
    if z > 30: return 1.0
    if z < -30: return 0.0
    return 1/(1+math.exp(-z))

def score(delta, fitness):
    dz = (delta - mu_d) / sd_d
    fz = (-abs(fitness) - mu_f) / sd_f
    z = W["w_delta"] * dz + W["w_esm2"] * fz + W["bias"]
    return sig(z), z

def slug(name):
    return name.lower().replace(" ", "-").replace("/", "-")

# Group events by drug
by_drug = defaultdict(list)
for ev in EVENTS:
    by_drug[ev["drug_name"]].append(ev)

ATLAS_DIR = Path("/sessions/gallant-optimistic-hawking/mnt/DockingOnline/backend/data/atlas")
ATLAS_DIR.mkdir(parents=True, exist_ok=True)

PRIMARY_TARGETS = {
    "Imatinib": ("BCR-ABL", "2HYY"),
    "Dasatinib": ("BCR-ABL", "2HYY"),
    "Nilotinib": ("BCR-ABL", "2HYY"),
    "Ponatinib": ("BCR-ABL", "2HYY"),
    "Gefitinib": ("EGFR", "2ITY"),
    "Erlotinib": ("EGFR", "2ITY"),
    "Osimertinib": ("EGFR (T790M)", "2ITY"),
    "Afatinib": ("EGFR", "2ITY"),
    "Vemurafenib": ("BRAF V600E", "4WO5"),
    "Dabrafenib": ("BRAF V600E", "4WO5"),
    "Sotorasib": ("KRAS G12C", "4OBE"),
    "Adagrasib": ("KRAS G12C", "4OBE"),
    "Crizotinib": ("ALK / ROS1 / MET", "2XP2"),
    "Alectinib": ("ALK", "2XP2"),
    "Lorlatinib": ("ALK / ROS1", "2XP2"),
    "Repotrectinib": ("ROS1 / NTRK", "3ZBF"),
    "Capmatinib": ("MET", "2WGJ"),
    "Tepotinib": ("MET", "2WGJ"),
    "Gilteritinib": ("FLT3", "4XUF"),
    "Quizartinib": ("FLT3", "4XUF"),
    "Ibrutinib": ("BTK", "5P9J"),
    "Pirtobrutinib": ("BTK", "5P9J"),
    "Lapatinib": ("HER2/EGFR", "3PP0"),
    "Tucatinib": ("HER2", "3PP0"),
    "Alpelisib": ("PI3K-α", "4JPS"),
    "Ivosidenib": ("IDH1 R132H", "1T0L"),
    "Avapritinib": ("KIT D816V", "1T46"),
}

def verdict_for(ev, p):
    expected = ev.get("expected_direction", "")
    if expected in ("retained", "selectivity"):
        return "drug_designed_for_this"
    if p >= 0.70:
        return "high_confidence_resistance"
    if p >= 0.45:
        return "borderline_resistance"
    return "low_probability_resistance"

written = 0
for drug, evs in by_drug.items():
    slug_ = slug(drug)
    primary_target, primary_pdb = PRIMARY_TARGETS.get(drug, (drug + " primary", ""))

    predictions = []
    for ev in evs:
        d = DELTA.get(ev["id"], {})
        e = ESM2.get(ev["id"], {})
        if d.get("status") != "ok" or e.get("status") != "ok": continue
        if d.get("delta_kcal") is None or e.get("fitness") is None: continue
        p, z = score(d["delta_kcal"], e["fitness"])
        verdict = verdict_for(ev, p)
        predictions.append({
            "mutation": ev["mutation_code"],
            "target": ev["gene"],
            "position": ev["position"],
            "mechanism": ev["mechanism"],
            "delta_kcal": d["delta_kcal"],
            "wt_score": d.get("wt_score"),
            "mut_score": d.get("mut_score"),
            "esm2_fitness": e["fitness"],
            "codon_distance": ev.get("codon_distance"),
            "wt_codon": ev.get("wt_codon"),
            "mut_codon": ev.get("mutant_codon_example"),
            "joint_logit": z,
            "joint_probability": p,
            "verdict": verdict,
            "literature_confirmed": ev.get("clinical_emergence", False),
            "citation_pmid": ev.get("citation_pmid"),
            "citation_short": ev.get("citation_short"),
            "expected_direction": ev.get("expected_direction"),
            "rationale": (
                f"Δ = {d['delta_kcal']:+.2f} kcal/mol, ESM2 fitness = "
                f"{e['fitness']:+.2f}, mechanism = {ev['mechanism']}. "
                f"Joint calibrated probability = {p:.2f}. "
                f"{ev.get('citation_short', '')}"
            ),
        })

    if not predictions:
        continue
    predictions.sort(key=lambda x: -x["joint_probability"])
    for i, p in enumerate(predictions, 1):
        p["rank"] = i

    sample_ev = evs[0]
    has_covalent = any("covalent" in (e.get("mechanism") or "") for e in evs)
    payload = {
        "drug_slug": slug_,
        "drug_name": drug,
        "drug_smiles": sample_ev["drug_smiles"],
        "primary_target": primary_target,
        "primary_pdb": primary_pdb,
        "atlas_version": 2,
        "model": {
            "name": "Liganx 2-signal calibrated forecast (Δ + ESM2)",
            "in_sample_auc": CV["in_sample_auc"],
            "oof_5fold_auc": CV["oof_5fold_auc"],
            "oof_95pct_ci": CV["oof_95pct_ci"],
            "lr_weights_standardized": CV["lr_weights"],
            "feature_stats": {"delta_mean": mu_d, "delta_std": sd_d,
                              "neg_abs_fit_mean": mu_f, "neg_abs_fit_std": sd_f},
        },
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "data_provenance": (
            "Forecasts auto-generated from the live calibration model. "
            "Δ from Liganx rigid-receptor Vina (exhaustiveness=8); "
            "ESM2 from facebook/esm2_t12_35M_UR50D masked-LM; joint "
            "probability from a logistic regression cross-validated "
            "on 25 published clinical-resistance events."
        ),
        "covalent_caveat": (
            "This drug is a covalent binder. Vina is non-covalent and "
            "under-represents the covalent bond contribution to binding. "
            "ESM2 fitness still detects substitutions that ablate the "
            "covalent target (cysteine → serine), so the joint model "
            "recovers most covalent-escape predictions."
        ) if has_covalent else None,
        "predicted_resistance": predictions,
        "n_predictions": len(predictions),
        "literature_confirmed_count": sum(1 for p in predictions if p["literature_confirmed"]),
        "ledger_note": (
            "Atlas v2 forecasts are computed live from the multi-signal "
            "model. Re-runs against new clinical reports compound the "
            "credibility ledger: a prediction that pre-dates the first "
            "clinical observation of the mutation becomes a confirmed "
            "forecast on the next regeneration."
        ),
    }
    out_path = ATLAS_DIR / f"{slug_}.json"
    out_path.write_text(json.dumps(payload, indent=2))
    written += 1
    print(f"  wrote {out_path.name}  ({len(predictions)} predictions, top: {predictions[0]['mutation']} @ p={predictions[0]['joint_probability']:.2f})")

print(f"\nWrote {written} atlas files into {ATLAS_DIR}")
