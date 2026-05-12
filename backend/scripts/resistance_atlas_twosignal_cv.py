"""Cross-validated honest paper number for the 2-signal model.

The drug-independent freq prior (spike #8) didn't add lift — its AUC
alone is 0.365 (frequent mutations appear in both resistance and
retention contexts). So the headline result for the paper is the
2-signal (Δ + ESM2) model with proper 5-fold CV.
"""
import json, math, random

events_by_id = {e["id"]: e for e in json.load(open('/tmp/events.json'))["events"]}
delta = {r["event_id"]: r for r in json.load(open('/tmp/baseline_results.json'))["results"]}
esm2  = {r["event_id"]: r for r in json.load(open('/tmp/esm2_results.json'))["results"]}

def _label(ev):
    d = ev.get("expected_direction")
    if d == "resistance": return 1
    if d in ("retained", "selectivity"): return 0
    return None

joined = []
for eid, ev in events_by_id.items():
    lab = _label(ev)
    if lab is None: continue
    d = delta.get(eid, {}); e = esm2.get(eid, {})
    if d.get("status") != "ok" or e.get("status") != "ok": continue
    if d.get("delta_kcal") is None or e.get("fitness") is None: continue
    joined.append({"event_id": eid, "label": lab,
                   "delta": d["delta_kcal"], "fitness": e["fitness"]})

def auc(scores, labels):
    pos = [s for s, L in zip(scores, labels) if L == 1]
    neg = [s for s, L in zip(scores, labels) if L == 0]
    if not pos or not neg: return float("nan")
    return sum(1 if p > q else (0.5 if p == q else 0) for p in pos for q in neg) / (len(pos) * len(neg))

def std(xs):
    mu = sum(xs)/len(xs); var = sum((x-mu)**2 for x in xs)/len(xs)
    sd = math.sqrt(var) if var > 0 else 1.0
    return [(x-mu)/sd for x in xs], mu, sd

def sig(z):
    if z > 30: return 1.0
    if z < -30: return 0.0
    return 1/(1+math.exp(-z))

def fit(features, labels, lr=0.1, iters=3000, l2=0.01):
    n = len(features[0]); w = [0.0]*(n+1)
    for _ in range(iters):
        g = [0.0]*(n+1)
        for x, y in zip(features, labels):
            z = sum(wi*xi for wi, xi in zip(w[:-1], x)) + w[-1]
            err = sig(z) - y
            for j in range(n): g[j] += err*x[j]
            g[-1] += err
        for j in range(n): g[j] = g[j]/len(features) + l2*w[j]
        g[-1] /= len(features)
        for j in range(len(w)): w[j] -= lr*g[j]
    return w

labels = [r["label"] for r in joined]
deltas = [r["delta"] for r in joined]
fitnesses = [r["fitness"] for r in joined]
neg_abs_fit = [-abs(f) for f in fitnesses]

dz, *_ = std(deltas)
fz, *_ = std(neg_abs_fit)

# In-sample
w2 = fit([[d,f] for d,f in zip(dz,fz)], labels)
s2 = [w2[0]*d + w2[1]*f + w2[2] for d,f in zip(dz,fz)]
auc_2_in = auc(s2, labels)

# 5-fold CV
random.seed(42)
idx = list(range(len(joined))); random.shuffle(idx)
folds = [idx[i::5] for i in range(5)]
oof = [0.0] * len(joined)
fold_aucs = []
for test in folds:
    train = [i for i in idx if i not in set(test)]
    w_cv = fit([[dz[i], fz[i]] for i in train], [labels[i] for i in train])
    for i in test:
        oof[i] = w_cv[0]*dz[i] + w_cv[1]*fz[i] + w_cv[2]
    fold_aucs.append(auc([oof[i] for i in test], [labels[i] for i in test]))
oof_auc = auc(oof, labels)

# Bootstrap 95% CI on OOF AUC
n_boot = 2000
random.seed(0)
boot_aucs = []
n = len(joined)
for _ in range(n_boot):
    sample = [random.randint(0, n-1) for _ in range(n)]
    sampled_scores = [oof[i] for i in sample]
    sampled_labels = [labels[i] for i in sample]
    if sum(sampled_labels) == 0 or sum(sampled_labels) == n: continue
    boot_aucs.append(auc(sampled_scores, sampled_labels))
boot_aucs.sort()
ci_lo = boot_aucs[int(0.025 * len(boot_aucs))]
ci_hi = boot_aucs[int(0.975 * len(boot_aucs))]

print(f"=== Honest paper number: 2-signal (Δ + ESM2) ===")
print(f"In-sample AUC (n={len(joined)}):              {auc_2_in:.3f}")
print(f"5-fold CV out-of-fold AUC:               {oof_auc:.3f}")
print(f"5-fold per-fold AUCs:                    {[f'{a:.3f}' for a in fold_aucs]}")
print(f"Bootstrap 95% CI on OOF AUC:             [{ci_lo:.3f}, {ci_hi:.3f}]")
print()
print(f"Standardized 2-signal LR weights:")
print(f"  w_Δ        = {w2[0]:+.3f}")
print(f"  w_-|ESM2|  = {w2[1]:+.3f}")
print(f"  bias       = {w2[2]:+.3f}")

with open('/tmp/twosignal_cv.json', 'w') as f:
    json.dump({
        "schema_version": 1,
        "model": "Δ_kcal + (−|ESM2_fitness|) → logistic regression",
        "n_events": len(joined),
        "n_positive": sum(labels),
        "n_negative": len(joined) - sum(labels),
        "in_sample_auc": auc_2_in,
        "oof_5fold_auc": oof_auc,
        "per_fold_aucs": fold_aucs,
        "oof_95pct_ci": [ci_lo, ci_hi],
        "lr_weights": {"w_delta": w2[0], "w_esm2": w2[1], "bias": w2[2]},
    }, f, indent=2)
print("\nWrote /tmp/twosignal_cv.json")
