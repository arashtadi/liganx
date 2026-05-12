"""3-signal joint analysis: Δ + ESM2 + (codon distance × frequency tier).

Features (all standardized):
  f1 = Δ_kcal                  (rigid-receptor docking signal)
  f2 = −|ESM2_fitness|          (closeness to ESM2 neutral band)
  f3 = freq_tier * (4 − codon_distance) / 3
                                (mutational accessibility × clinical
                                 frequency — high score = single-nt-
                                 accessible AND clinically common)

Models reported:
  (a) Δ alone                       — spike #5 baseline
  (b) ESM2 alone                    — spike #6
  (c) Δ + ESM2 (2-signal)           — spike #6
  (d) accessibility×freq alone      — new
  (e) Δ + ESM2 + accessibility×freq (3-signal)  — spike #7 headline

Plus 5-fold cross-validated AUC for (e) to guard against over-fit on
the 25-event sample.
"""
import json, math, random
from collections import defaultdict

events_by_id = {e["id"]: e for e in json.load(open('/tmp/events.json'))["events"]}
delta = {r["event_id"]: r for r in json.load(open('/tmp/baseline_results.json'))["results"]}
esm2  = {r["event_id"]: r for r in json.load(open('/tmp/esm2_results.json'))["results"]}
freq  = json.load(open('/tmp/freq_prior.json'))["freq_tier"]

def _label(ev):
    d = ev.get("expected_direction")
    if d == "resistance": return 1
    if d in ("retained", "selectivity"): return 0
    return None

# Join: events with Δ-ok AND ESM2-ok AND a binary label.
joined = []
for eid, ev in events_by_id.items():
    lab = _label(ev)
    if lab is None: continue
    d = delta.get(eid, {})
    e = esm2.get(eid, {})
    if d.get("status") != "ok" or e.get("status") != "ok": continue
    if d.get("delta_kcal") is None or e.get("fitness") is None: continue
    cd = ev.get("codon_distance")
    if cd is None: continue
    ft = freq.get(eid, 0)
    # Accessibility×frequency: higher tier × lower codon distance =
    # higher likelihood of clinical emergence. (4 - cd) gives 3 for
    # cd=1, 2 for cd=2, 1 for cd=3 — normalized by dividing by 3.
    acc = ft * (4 - cd) / 3.0
    joined.append({
        "event_id": eid,
        "label": lab,
        "delta": d["delta_kcal"],
        "fitness": e["fitness"],
        "freq_tier": ft,
        "codon_distance": cd,
        "acc_freq": acc,
        "mechanism": ev.get("mechanism"),
        "drug": ev.get("drug_name"),
        "mutation": ev.get("mutation_code"),
    })

print(f"Joined: {len(joined)} events  ({sum(r['label'] for r in joined)} positive / {len(joined)-sum(r['label'] for r in joined)} negative)")

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

def standardize(xs):
    mu = sum(xs) / len(xs)
    var = sum((x-mu)**2 for x in xs) / len(xs)
    sd = math.sqrt(var) if var > 0 else 1.0
    return [(x-mu)/sd for x in xs], mu, sd

def sigmoid(z):
    if z > 30: return 1.0
    if z < -30: return 0.0
    return 1 / (1 + math.exp(-z))

def fit_logreg(features, labels, lr=0.1, iters=3000, l2=0.01):
    n_feat = len(features[0])
    w = [0.0] * (n_feat + 1)
    for _ in range(iters):
        grad = [0.0] * (n_feat + 1)
        for x, y in zip(features, labels):
            z = sum(wi*xi for wi, xi in zip(w[:-1], x)) + w[-1]
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

def lr_predict(w, x):
    z = sum(wi*xi for wi, xi in zip(w[:-1], x)) + w[-1]
    return sigmoid(z)

labels = [r["label"] for r in joined]
deltas = [r["delta"] for r in joined]
fitnesses = [r["fitness"] for r in joined]
accfreqs = [r["acc_freq"] for r in joined]
neg_abs_fit = [-abs(f) for f in fitnesses]

dz, mu_d, sd_d = standardize(deltas)
fz, mu_f, sd_f = standardize(neg_abs_fit)
az, mu_a, sd_a = standardize(accfreqs)

auc_delta = auc(deltas, labels)
auc_esm2  = auc(neg_abs_fit, labels)
auc_acc   = auc(accfreqs, labels)

# 2-signal
w2 = fit_logreg([[d,f] for d,f in zip(dz,fz)], labels)
s2 = [w2[0]*d + w2[1]*f + w2[2] for d,f in zip(dz,fz)]
auc_2 = auc(s2, labels)

# 3-signal
w3 = fit_logreg([[d,f,a] for d,f,a in zip(dz,fz,az)], labels)
s3 = [w3[0]*d + w3[1]*f + w3[2]*a + w3[3] for d,f,a in zip(dz,fz,az)]
auc_3 = auc(s3, labels)

# 5-fold CV on 3-signal
random.seed(42)
idx = list(range(len(joined)))
random.shuffle(idx)
folds = [idx[i::5] for i in range(5)]
cv_aucs = []
cv_oof_scores = [0.0] * len(joined)
for k, test in enumerate(folds):
    train = [i for i in idx if i not in set(test)]
    feats_tr = [[dz[i], fz[i], az[i]] for i in train]
    labs_tr = [labels[i] for i in train]
    w_cv = fit_logreg(feats_tr, labs_tr)
    test_scores = [w_cv[0]*dz[i] + w_cv[1]*fz[i] + w_cv[2]*az[i] + w_cv[3] for i in test]
    test_labels = [labels[i] for i in test]
    a = auc(test_scores, test_labels)
    cv_aucs.append(a)
    for i, s in zip(test, test_scores):
        cv_oof_scores[i] = s
oof_auc = auc(cv_oof_scores, labels)

print()
print("=== Spike #7 — 3-signal calibrated forecast ===")
print(f"{'Model':45s}  AUC")
print(f"{'-'*45}  -----")
print(f"{'(a) Δ-from-docking alone (baseline)':45s}  {auc_delta:.3f}")
print(f"{'(b) ESM2 |fitness| alone':45s}  {auc_esm2:.3f}")
print(f"{'(c) Δ + ESM2 (2-signal)':45s}  {auc_2:.3f}")
print(f"{'(d) accessibility × freq alone':45s}  {auc_acc:.3f}")
print(f"{'(e) Δ + ESM2 + acc×freq (3-signal)':45s}  {auc_3:.3f}")
print(f"{'    5-fold CV (out-of-fold) AUC':45s}  {oof_auc:.3f}")
print(f"    per-fold AUCs: {[f'{a:.3f}' for a in cv_aucs]}")
print()
print(f"3-signal LR coefficients (standardized): w_Δ={w3[0]:+.3f}  w_ESM2={w3[1]:+.3f}  w_acc×freq={w3[2]:+.3f}  bias={w3[3]:+.3f}")
print()
print("Per-event scores (sorted by 3-signal joint probability):")
print(f"{'event_id':40s}  {'mech':28s}  {'Δ':>6s}  {'fit':>6s}  {'acc':>6s}  {'p3':>5s}  label")
ranked = sorted(zip(joined, s3), key=lambda x: -x[1])
for r, s in ranked:
    p = sigmoid(s)
    print(f"{r['event_id']:40s}  {(r['mechanism'] or '')[:28]:28s}  {r['delta']:+6.2f}  {r['fitness']:+6.2f}  {r['acc_freq']:+6.2f}  {p:5.2f}  {r['label']}")

import time
out = {
    "schema_version": 1,
    "n_events": len(joined),
    "n_positive": sum(labels),
    "n_negative": len(joined) - sum(labels),
    "auc": {
        "delta_only": auc_delta,
        "esm2_only": auc_esm2,
        "delta_plus_esm2": auc_2,
        "acc_freq_only": auc_acc,
        "three_signal": auc_3,
        "three_signal_5fold_cv_oof": oof_auc,
    },
    "cv_per_fold_aucs": cv_aucs,
    "logreg_3signal": {
        "w_delta": w3[0], "w_esm2": w3[1], "w_acc_freq": w3[2], "bias": w3[3],
    },
    "feature_stats": {
        "delta_mean": mu_d, "delta_std": sd_d,
        "esm2_mean": mu_f, "esm2_std": sd_f,
        "acc_freq_mean": mu_a, "acc_freq_std": sd_a,
    },
    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "rows": [
        {"event_id": r["event_id"], "delta": r["delta"], "fitness": r["fitness"],
         "freq_tier": r["freq_tier"], "codon_distance": r["codon_distance"],
         "acc_freq": r["acc_freq"], "score3": s, "p3": sigmoid(s),
         "label": r["label"], "mechanism": r["mechanism"]}
        for r, s in zip(joined, s3)
    ],
}
with open('/tmp/threesignal_analysis.json', 'w') as f:
    json.dump(out, f, indent=2)
print("\nWrote /tmp/threesignal_analysis.json")
