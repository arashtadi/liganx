# Resistance Atlas — Δ-baseline analysis

Spike #3 output. Measures how much of the clinical-resistance
ground truth (50 published events) Liganx's rigid-receptor docking
Δ alone recovers. The result is the **lift target** for the full
Resistance Atlas build — what ESM2 + codon accessibility have to
add on top to push us past ROC-AUC 0.85.


**Headline numbers**

- Scoreable events: **25** of 50 (rest skipped or failed).
- Overall ROC-AUC (Δ alone, label = expected resistance): **0.719**
- At noise-floor threshold (Δ > +1.0 kcal/mol predicts resistance):
  - precision = 0.89, recall = 0.50, F1 = 0.64
  - confusion: TP=8 FN=8 FP=1 TN=8


## Per-mechanism breakdown

| Mechanism | N | Pos | Neg | AUC | mean Δ (pos) | mean Δ (neg) |
|---|---|---|---|---|---|---|
| activation_loop_conformational | 2 | 1 | 1 | 1.000 | +1.90 | -0.60 |
| conformational_activation | 2 | 0 | 2 | — | — | +0.45 |
| covalent_design | 2 | 0 | 2 | — | — | -1.45 |
| covalent_escape | 2 | 2 | 0 | — | +0.85 | — |
| designed_for_resistance | 1 | 0 | 1 | — | — | -0.70 |
| dfg_motif | 2 | 2 | 0 | — | -0.30 | — |
| gatekeeper | 7 | 6 | 1 | 0.583 | +1.18 | +0.40 |
| gatekeeper_adjacent | 1 | 1 | 0 | — | +1.20 | — |
| macrocyclic_design | 1 | 0 | 1 | — | — | +1.60 |
| non_covalent_design | 1 | 0 | 1 | — | — | +0.80 |
| p_loop | 2 | 2 | 0 | — | +3.10 | — |
| solvent_front | 2 | 2 | 0 | — | +0.95 | — |

## False negatives — clinical resistance that Δ missed

These are the events ESM2 + accessibility have to recover.

- **met-y1230h-capmatinib** (Capmatinib vs met Y1230H, dfg_motif): Δ = -0.90
- **egfr-t790m-gefitinib** (Gefitinib vs egfr T790M, gatekeeper): Δ = +0.20
- **egfr-c797s-osimertinib** (Osimertinib vs egfr C797S, covalent_escape): Δ = +0.20
- **alk-l1196m-crizotinib** (Crizotinib vs alk L1196M, gatekeeper): Δ = +0.20
- **met-d1228v-capmatinib** (Capmatinib vs met D1228V, dfg_motif): Δ = +0.30
- **egfr-t790m-erlotinib** (Erlotinib vs egfr T790M, gatekeeper): Δ = +0.40
- **egfr-l792h-osimertinib** (Osimertinib vs egfr L792H, solvent_front): Δ = +0.40
- **abl-t315i-dasatinib** (Dasatinib vs abl T315I, gatekeeper): Δ = +0.80

## False positives — Δ over-called these (should be retained/selective)

- **ros1-g2032r-repotrectinib-retained** (Repotrectinib vs ros1 G2032R, macrocyclic_design, expected retained): Δ = +1.60

## Go / no-go interpretation

AUC 0.719 ≥ 0.65 — **green-light the full atlas build**. ESM2 + accessibility signals should be additive on covalent / conformational events where Δ alone is weak; target ROC-AUC ≥ 0.85.
