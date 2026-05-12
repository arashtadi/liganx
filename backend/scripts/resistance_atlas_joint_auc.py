"""Joint ESM2 + Δ ROC analysis.

Compares:
  (a) Δ-from-docking alone        — our spike #5 baseline (AUC 0.719)
  (b) ESM2 fitness alone          — covalent-tolerance signal
  (c) Δ + ESM2 logistic regression — multi-signal calibrated model

Restricted to events where BOTH signals are available (intersection of
Δ-OK and ESM2-OK). With the mutant-build fix from spike #5, Δ will
become available for the remaining 24 events on the next pipeline
re-run; this current join is the floor of what a multi-signal model
can recover.
"""
import json
import math

events = {e["id"]: e for e in json.loads(open('/tmp/events.json').read())["events"]}
delta = {r["event_id"]: r for r in json.loads(open('/tmp/baseline_results.json').read())["results"]}
esm2  = {r["event_id"]: r for r in json.loads(open('/tmp/esm2_results.json').read())["results"]}

def _label(ev):
    d = ev.get("expected_direction")
    if d == "resistance": return 1
    if d in ("retained", "selectivity"): return 0
    return None

# Join: events with Δ=ok AND ESM2=ok AND a binary label.
joined = []
for eid, ev in events.items():
    lab = _label(ev)
    if lab is None: continue
    d = delta.get(eid, {})
    e = esm2.get(eid, {})
    if d.get("status") != "ok" or e.get("status") != "ok": continue
    if d.get("delta_kcal") is None or e.get("fitness") is None: continue
    joined.append({
        "event_id": eid,
        "label": lab,
        "delta": d["delta_kcal"],
        "fitness": e["fitness"],
        "mechanism": ev.get("mechanism"),
        "drug": ev.get("drug_name"),
        "mutation": ev.get("mutation_code"),
    })

print(f"Joined set: {len(joined)} events ({sum(r['label'] for r in joined)} positive, {len(joined)-sum(r['label'] for r in joined)} negative)")

def auc(scores, labels):
    pos = [s for s, L in zip(scores, labels) if L == 1]
    neg = [s for s, L in zip(scores, labels) if L == 0]
    if not pos or not neg: return float("nan")
    n = 0.0
    for p in pos:
        for ng in neg:
            if p > ng: n += 1
            elif p == ng: n += 0.5
    return n / (len(pos) * len(neg))

labels = [r["label"] for r in joined]
deltas = [r["delta"] for r in joined]
fitnesses = [r["fitness"] for r in joined]

auc_delta = auc(deltas, labels)
# ESM2 fitness: higher fitness = mutation more tolerated → more likely
# to actually appear under selection. So fitness near 0 = resistance-
# permitted. The relationship is non-monotonic, so we score by
# -|fitness| (closer to zero = more likely tolerated → resistance).
neg_abs_fit = [-abs(f) for f in fitnesses]
auc_fit_negabs = auc(neg_abs_fit, labels)
auc_fit_raw   = auc(fitnesses, labels)

# Simple logistic regression — closed-form via gradient descent on the
# 25-event sample. Standardize both features so coefficients are
# comparable.
def standardize(xs):
    mu = sum(xs) / len(xs)
    var = sum((x - mu) ** 2 for x in xs) / len(xs)
    sd = math.sqrt(var) if var > 0 else 1.0
    return [(x - mu) / sd for x in xs], mu, sd

dz, mu_d, sd_d = standardize(deltas)
# For ESM2 the most informative encoding is "closeness to 0", so use -|fit|
fz, mu_f, sd_f = standardize(neg_abs_fit)

# Gradient descent on logistic loss. Tiny problem, no need for sklearn.
def sigmoid(z):
    if z > 30: return 1.0
    if z < -30: return 0.0
    return 1 / (1 + math.exp(-z))

def fit_logreg(features, labels, lr=0.1, iters=2000, l2=0.01):
    n_feat = len(features[0])
    w = [0.0] * (n_feat + 1)  # last entry = bias
    for _ in range(iters):
        grad = [0.0] * (n_feat + 1)
        for x, y in zip(features, labels):
            z = sum(wi * xi for wi, xi in zip(w[:-1], x)) + w[-1]
            p = sigmoid(z)
            err = p - y
            for j in range(n_feat):
                grad[j] += err * x[j]
            grad[-1] += err
        for j in range(n_feat):
            grad[j] = grad[j] / len(features) + l2 * w[j]
        grad[-1] /= len(features)
        for j in range(len(w)):
            w[j] -= lr * grad[j]
    return w

# Δ alone — trivially recovers baseline AUC
w_delta = fit_logreg([[x] for x in dz], labels)
joint_features = [[d, f] for d, f in zip(dz, fz)]
w_joint = fit_logreg(joint_features, labels)
joint_scores = [w_joint[0] * d + w_joint[1] * f + w_joint[2] for d, f in zip(dz, fz)]
auc_joint = auc(joint_scores, labels)

print()
print(f"=== Joint analysis on {len(joined)} events ===")
print(f"Δ-only AUC                : {auc_delta:.3f}")
print(f"ESM2 |fitness| (proxy) AUC : {auc_fit_negabs:.3f}")
print(f"ESM2 fitness raw AUC       : {auc_fit_raw:.3f}")
print(f"Joint LogReg (Δ + ESM2)    : {auc_joint:.3f}")
print()
print(f"Joint LR coefficients (standardized): w_Δ = {w_joint[0]:+.3f}, w_fit = {w_joint[1]:+.3f}, bias = {w_joint[2]:+.3f}")
print()
print("Per-event scores (sorted by joint):")
print(f"{'event_id':40s}  {'mech':28s}  {'Δ':>6s}  {'fit':>6s}  {'pjoint':>6s}  label")
ranked = sorted(zip(joined, joint_scores), key=lambda x: -x[1])
for r, s in ranked:
    p = sigmoid(s)
    print(f"{r['event_id']:40s}  {r['mechanism'] or '':28s}  {r['delta']:+6.2f}  {r['fitness']:+6.2f}  {p:6.2f}  {r['label']}")

# Save the joint analysis
import time
open('/tmp/joint_analysis.json', 'w').write(json.dumps({
    "schema_version": 1,
    "n_events": len(joined),
    "n_positive": sum(labels),
    "n_negative": len(joined) - sum(labels),
    "model_id_esm2": "facebook/esm2_t12_35M_UR50D",
    "auc": {
        "delta_only": auc_delta,
        "esm2_negabs_only": auc_fit_negabs,
        "esm2_raw_only": auc_fit_raw,
        "joint_logreg": auc_joint,
    },
    "logreg_weights_standardized": {"w_delta": w_joint[0], "w_esm2_negabs": w_joint[1], "bias": w_joint[2]},
    "logreg_feature_stats": {
        "delta_mean": mu_d, "delta_std": sd_d,
        "esm2_negabs_mean": mu_f, "esm2_negabs_std": sd_f,
    },
    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "rows": [{"event_id": r["event_id"], "delta": r["delta"], "fitness": r["fitness"],
              "joint_score": s, "joint_prob": sigmoid(s), "label": r["label"],
              "mechanism": r["mechanism"]}
             for r, s in zip(joined, joint_scores)],
}, indent=2))
print(f"\nWrote /tmp/joint_analysis.json")
