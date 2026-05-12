# Resistance Atlas — calibration & analysis workspace

This folder holds the calibration and analysis artefacts for the
Resistance Atlas (the multi-signal forecasting product that predicts
which mutation will break each FDA-approved drug, **before** it appears
in patients).

## How the spike fits together

```
clinical_resistance_events.json          ← spike #1: curated ground truth
backend/data/                                (50 published clinical events)
                                           │
                                           ▼
backend/scripts/                          spike #2: drive each event
  resistance_atlas_baseline.py            through Liganx's /screening
                                          API, capture wt / mut / Δ
                                           │
                                           ▼
backend/data/resistance_atlas/
  baseline_results.json                   ← one row per event with
                                            wt_score / mut_score /
                                            delta_kcal / status
                                           │
                                           ▼
backend/scripts/                          spike #3: ROC-AUC + per-
  resistance_atlas_analyse.py             mechanism breakdown +
                                          mis-call narrative
                                           │
                                           ▼
backend/data/resistance_atlas/
  baseline_analysis.md                    ← go / no-go decision basis
  baseline_analysis.json                  ← machine-readable numbers
```

## To run the spike

1. **Get an API token.** Sign in to liganx.com, then in DevTools console:

   ```js
   JSON.parse(localStorage[Object.keys(localStorage).find(k => k.includes("auth-token"))]).access_token
   ```

2. **Drive the events through Liganx:**

   ```bash
   export LIGANX_API_TOKEN=<paste from step 1>
   python backend/scripts/resistance_atlas_baseline.py
   ```

   Expect ~25-40 minutes for 50 events (one screening per event,
   pod cold-start on first call, then ~30s per real-dock).

3. **Compute the baseline:**

   ```bash
   python backend/scripts/resistance_atlas_analyse.py
   ```

   Read `baseline_analysis.md` for the headline AUC + mis-call list.

## Go / no-go thresholds

The full Resistance Atlas build is a 8-10 week investment. We gate it
on the spike #3 baseline:

| AUC range | Interpretation | Action |
|---|---|---|
| ≥ 0.65 | Δ alone is meaningfully informative; multi-signal lift to 0.85 is in reach | Green-light full build |
| 0.55-0.65 | Weakly informative; ESM2 may or may not save it | Run ESM2-only on the same set before committing |
| < 0.55 | At-chance; the calibration set is dominated by mechanisms Vina can't see | Pivot scope (e.g., gatekeeper-only atlas) or rethink |

## Why these events specifically

The 50 events span every druggable kinase on Liganx's catalog plus
KRAS, IDH1 and PI3Kα. They include:

- **Positive controls** (Δ should fire): T315I, T790M, F691L, L1196M
  — gatekeeper / steric clash, exactly what rigid docking sees best.
- **Negative controls** (Δ must NOT fire): Ponatinib vs T315I,
  Pirtobrutinib vs C481S, Sotorasib vs G12C — drugs rationally
  designed to retain or to selectively gain potency in the mutant.
  These guard against a model that just predicts resistance for
  everything.
- **Hard cases** (Δ documented to miss): covalent escape (C797S,
  C481S), conformational activation (L858R, D816V), allosteric
  (H1047R, R132H). These are the events ESM2 + accessibility will
  need to rescue in the full atlas.

## Sources / citation footing

Every event in the JSON carries a PMID + short-form citation. The
papers span 2001-2022 and cover the major resistance-event surveys
in oncology drug-resistance literature. Re-curation should preserve
the citation field — it's both a credibility anchor (this isn't
made-up data) and the audit trail if any specific event turns out
to be mis-characterised.
