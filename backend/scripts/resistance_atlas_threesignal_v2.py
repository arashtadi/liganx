"""Spike #8: 3-signal joint with DRUG-INDEPENDENT freq prior.

Same model architecture as spike #7 but uses freq_prior_v2.json
(per-mutation, not per-(drug, mutation, target)). The negative-
control rejection now MUST come from Δ + ESM2, not from the prior.
"""
import json, math, random

events_by_id = {e["id"]: e for e in json.load(open('/tmp/events.json'))["events"]}
delta = {r["event_id"]: r for r in json.load(open('/tmp/baseline_results.json'))["results"]}
esm2  = {r["event_id"]: r for r in json.load(open('/tmp/esm2_results.json'))["results"]}
freq  = json.load(open('/tmp/freq_prior_v2.json'))["freq_tier"]

def _label(ev):
    d = ev.get("expected_direction")
    if d == "resistance": return 1
    if d in ("retained", "selectivity"): return 0
    return None

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
    acc = ft * (4 - cd) / 3.0
    joined.append({
        "event_id": eid, "label": lab,
        "delta": d["delta_kcal"], "fitness": e["fitness"],
        "freq_tier": ft, "codon_distance": cd, "acc_freq": acc,
        "mechanism": ev.get("mechanism"), "drug": ev.get("drug_name"),
        "mutation": ev.get("mutation_code"),
    })

def auc(scores, labels):
    pos = [s for s, L in zip(scores, labels) if L == 1]
    neg = [s for s, L in zip(scores, labels) if L == 0]
    if not pos or not neg: return float("nan")
    n = sum(1 if p > q else (0.5 if p == q else 0) for p in pos for q in neg)
    return n / (len(pos) * len(neg))

def standardize(xs):
    mu = sum(xs)/len(xs); var = sum((x-mu)**2 for x in xs)/len(xs)
    sd = math.sqrt(var) if var > 0 else 1.0
    return [(x-mu)/sd for x in xs], mu, sd

def sigmoid(z):
    if z > 30: return 1.0
    if z < -30: return 0.0
    return 1/(1+math.exp(-z))

def fit_logreg(features, labels, lr=0.1, iters=3000, l2=0.01):
    n = len(features[0])
    w = [0.0] * (n+1)
    for _ in range(iters):
        g = [0.0]*(n+1)
        for x, y in zip(features, labels):
            z = sum(wi*xi for wi, xi in zip(w[:-1], x)) + w[-1]
            err = sigmoid(z) - y
            for j in range(n): g[j] += err * x[j]
            g[-1] += err
        for j in range(n): g[j] = g[j]/len(features) + l2 * w[j]
        g[-1] /= len(features)
        for j in range(len(w)): w[j] -= lr * g[j]
    return w

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

w2 = fit_logreg([[d,f] for d,f in zip(dz,fz)], labels)
s2 = [w2[0]*d + w2[1]*f + w2[2] for d,f in zip(dz,fz)]
auc_2 = auc(s2, labels)

w3 = fit_logreg([[d,f,a] for d,f,a in zip(dz,fz,az)], labels)
s3 = [w3[0]*d + w3[1]*f + w3[2]*a + w3[3] for d,f,a in zip(dz,fz,az)]
auc_3 = auc(s3, labels)

# 5-fold CV
random.seed(42)
idx = list(range(len(joined))); random.shuffle(idx)
folds = [idx[i::5] for i in range(5)]
cv_aucs = []
oof_scores = [0.0] * len(joined)
for test in folds:
    train = [i for i in idx if i not in set(test)]
    feats_tr = [[dz[i], fz[i], az[i]] for i in train]
    labs_tr = [labels[i] for i in train]
    w_cv = fit_logreg(feats_tr, labs_tr)
    for i in test:
        oof_scores[i] = w_cv[0]*dz[i] + w_cv[1]*fz[i] + w_cv[2]*az[i] + w_cv[3]
    ts = [oof_scores[i] for i in test]
    tl = [labels[i] for i in test]
    cv_aucs.append(auc(ts, tl))
oof_auc = auc(oof_scores, labels)

print()
print("=== Spike #8 — 3-signal with DRUG-INDEPENDENT freq prior ===")
print(f"{'Model':45s}  AUC")
print(f"{'-'*45}  -----")
print(f"{'(a) Δ alone':45s}  {auc_delta:.3f}")
print(f"{'(b) ESM2 |fitness| alone':45s}  {auc_esm2:.3f}")
print(f"{'(c) Δ + ESM2 (2-signal)':45s}  {auc_2:.3f}")
print(f"{'(d) acc × freq alone (v2)':45s}  {auc_acc:.3f}")
print(f"{'(e) Δ + ESM2 + acc×freq (3-signal)':45s}  {auc_3:.3f}")
print(f"{'    5-fold CV OOF AUC':45s}  {oof_auc:.3f}")
print(f"    per-fold AUCs: {[f'{a:.3f}' for a in cv_aucs]}")
print()
print(f"3-signal LR coefficients (standardized): w_Δ={w3[0]:+.3f}  w_ESM2={w3[1]:+.3f}  w_acc×freq={w3[2]:+.3f}  bias={w3[3]:+.3f}")
print()
print("Top + bottom of ranked list:")
print(f"{'event_id':40s}  {'mech':28s}  {'Δ':>6s}  {'fit':>6s}  {'tier':>4s}  {'p3':>5s}  label")
ranked = sorted(zip(joined, s3), key=lambda x: -x[1])
for r, s in ranked:
    p = sigmoid(s)
    print(f"{r['event_id']:40s}  {(r['mechanism'] or '')[:28]:28s}  {r['delta']:+6.2f}  {r['fitness']:+6.2f}  {r['freq_tier']:>4d}  {p:5.2f}  {r['label']}")

import time
with open('/tmp/threesignal_v2_analysis.json', 'w') as f:
    json.dump({
        "schema_version": 2,
        "n_events": len(joined),
        "n_positive": sum(labels),
        "n_negative": len(joined) - sum(labels),
        "auc": {
            "delta_only": auc_delta,
            "esm2_only": auc_esm2,
            "delta_plus_esm2": auc_2,
            "acc_freq_only_v2": auc_acc,
            "three_signal_v2": auc_3,
            "three_signal_v2_5fold_cv_oof": oof_auc,
        },
        "cv_per_fold_aucs": cv_aucs,
        "logreg_3signal": {"w_delta": w3[0], "w_esm2": w3[1], "w_acc_freq": w3[2], "bias": w3[3]},
        "feature_stats": {
            "delta_mean": mu_d, "delta_std": sd_d,
            "esm2_mean": mu_f, "esm2_std": sd_f,
            "acc_freq_mean": mu_a, "acc_freq_std": sd_a,
        },
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rows": [{
            "event_id": r["event_id"], "delta": r["delta"], "fitness": r["fitness"],
            "freq_tier": r["freq_tier"], "codon_distance": r["codon_distance"],
            "acc_freq": r["acc_freq"], "score3": s, "p3": sigmoid(s),
            "label": r["label"], "mechanism": r["mechanism"],
            "drug": r["drug"], "mutation": r["mutation"],
        } for r, s in zip(joined, s3)],
    }, f, indent=2)
print("\nWrote /tmp/threesignal_v2_analysis.json")
