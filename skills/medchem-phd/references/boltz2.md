# Boltz-2: Towards Accurate and Efficient Binding Affinity Prediction

## Paper identification
- **Title (exact):** Boltz-2: Towards Accurate and Efficient Binding Affinity Prediction
- **Authors (first 5 + et al.):** Saro Passaro, Gabriele Corso, Jeremy Wohlwend, Mateo Reveiz, Stephan Thaler, et al.
- **Year, venue:** 2025, bioRxiv preprint (doi: 10.1101/2025.06.14.659707), posted June 18, 2025
- **Citation tag:** [Passaro 2025, Boltz-2]

## What Boltz-2 actually is

Boltz-2 is a structural biology foundation model that predicts both protein-ligand complex structures and binding affinity. It builds on Boltz-1's co-folding architecture with new affinity-specific components. The model consumes protein sequence, optional MSA (from ColabFold), ligand SMILES, and optionally templates and distance constraints, then outputs: (1) a predicted 3D structure of the protein-ligand complex, (2) a binding likelihood score (binary classification: will bind or not), and (3) a continuous affinity value measured on a logarithmic scale roughly equivalent to IC50 in µM. The affinity module is a PairFormer network that operates on Boltz-2's structural pair representations, masking out intra-protein interactions to focus on protein-ligand interface details, then aggregates via mean pooling to feed two dedicated MLP heads.

## Output conventions — be EXACT

**The affinity_pred_value field:**
- **Unit:** log10(IC50 in µM). The paper's exact wording (Section 4, Affinity training): "Continuous values are supervised...all converted to the logarithmic scale using µM as standardized unit." Trained on a mixture of Ki, Kd, IC50, AC50, EC50, and XC50 normalised through the Cheng–Prusoff equation; within a single assay's pairwise differences the correction terms cancel, so the value is best interpreted as a relative ranking signal (the paper itself describes it as "a general measure of binding strength that supports ranking and can be approximately interpreted as an IC50-like value").
- **Sign convention:** **More-negative = stronger binder.** Worked examples:
  - IC50 = 1 µM → value = log10(1) = **0**
  - IC50 = 100 nM = 0.1 µM → value = log10(0.1) = **−1**
  - IC50 = 10 nM = 0.01 µM → value = log10(0.01) = **−2**
  - IC50 = 1 nM = 0.001 µM → value = log10(0.001) = **−3**
- **Δ between WT and mutant:** Δ = mut − WT. Positive Δ means the mutant has a *higher* (worse) IC50 → resistance direction. Negative Δ means the mutant binds tighter → selectivity direction. Same sign convention as Vina's kcal/mol — the two engines can be subtracted as long as both are in their native units.
- **Common pitfall:** The output is *not* pIC50 (which is positive-stronger). Liganx's own runner.py docstring incorrectly described the unit as "log10(IC50 in µM), so more-negative = stronger" but with example reasoning that flipped the sign — that comment was caught by the 2026-05-01 audit and corrected. When in doubt, check: a small molecule with a published nanomolar IC50 should give a value of about −3, not +9.

**Binding likelihood:**
- Binary classification output (probability of binding).
- Range: [0, 1]; values close to 1 indicate high probability of binding.
- Gates affinity interpretation: if likelihood is low, affinity prediction is unreliable.

**Confidence/calibration score:**
- The paper trains two affinity models with different hyperparameters and ensembles them. For binary classification, it averages the binding likelihoods. For regression, it applies a molecular-weight correction: ŷ = C0·(y1 + y2) + C1·MW_binder + C2.
- No single "confidence" field is reported; instead, the ensembled affinity is calibrated post-hoc.

**Other output channels:**
- ipTM-score: ranked to select the top-1 structure from five samples (200 diffusion steps each).
- pTM: pairwise template modeling score (confidence in contacts).
- B-factors: predicted local dynamics (trained on experimental and MD B-factors).
- pAE (predicted aligned error): coordinate confidence at residue pairs.

**Quote on output interpretation** (from page 5, Training section):
> "Although these metrics reflect different underlying biochemical quantities, Kis and IC50s are related through the Cheng–Prusoff equation, and when comparing affinity values within the same assay, the pairwise differences loss effectively cancel out the correction term, and assays can be combined."

## Validation results worth knowing

**Headline accuracy claims:**

1. **FEP+ 4-target subset (OpenFE hit-to-lead data):** Pearson R = 0.66 vs FEP+ R = 0.78. Boltz-2 approaches state-of-the-art free-energy simulation while running 1000× faster.
2. **OpenFE full benchmark (876 complexes):** Pearson R = 0.62 vs OpenFE relative FEP R = 0.72.
3. **8 blinded internal assays (Recursion):** Pearson R > 0.55 on 3/8 assays; limited performance on others (GPCRs noted as weak class).
4. **CASP16 blind affinity challenge (140 protein-ligand pairs, 2 targets):** Outperformed all top-ranking participants with no fine-tuning.
5. **MF-PCBA virtual screening (10 HTS assays, binary classification):** Average precision 0.025 (vs BACPI 0.013, Chemgauss4 0.005); AUROC ranging 0.64–0.92 across assays; enrichment at 0.5% threshold = 18.4×.

**Outperformance vs standard docking:** Boltz-2 substantially outperforms docking (docking AP on MF-PCBA ≈ 0.005 vs Boltz-2 0.025) and ipTM-only ranking.

**Where Boltz-2 underperforms:** GPCRs, GPCBs, and certain protein classes without custom input preparation (known issue for FEP methods too). On internal assays, performance is highly variable (3/8 strong, 5/8 weak).

## Method limits the skill should respect

**Training data cutoff:** PDB structures up to 06/01/2023. No exposure to structures post-2023.

**Protein size:** Complexes >7 MB or >5000 residues were excluded from training; use cautiously beyond this.

**Sequence-length limits:** Model trained with token crop size up to 768 during training; inference behavior on longer sequences not explicitly documented.

**MSA requirement:** Not strictly required (can run monomer sequences), but ColabFold MSA improves structure prediction (as per Boltz-1 precedent).

**Ligand limitations:**
- Trained on ligands from CCD (Chemical Component Dictionary) only. Custom non-standard residues/ligands may be out-of-distribution.
- Multi-residue ligands (glycans) and modified peptides were discarded from MD training.

**Cofactor/ion handling:** Non-protein chains are processed but ions/metals were not explicitly prioritized in architecture. Use distance/contact conditioning if ions are critical to binding.

**Target class fragility:** Boltz-2 performs well on kinases but struggles on membrane proteins (GPCRs) without custom preparation—consistent with FEP method limitations.

**When NOT to use Boltz-2 vs Vina/GNINA:**
- Early-stage screening where speed matters more than absolute accuracy: use Vina.
- Membrane proteins without manual input: use GNINA or Vina + visual inspection.
- Non-biological ligands (synthetic libraries not in CCD): may be out-of-distribution; validate with Vina.
- Rigid-body docking only (no side-chain flexibility): standard docking is faster.

## How to interpret a single Boltz-2 prediction

**Confidence threshold:** Binding likelihood > 0.5 is generally reliable; below 0.3, affinity predictions should be considered speculative. On the 4-target FEP+ subset, the model achieved Pearson R = 0.66; on real-world complexes, expect wide variance (0.55 down to near-zero on GPCRs).

**WT vs mutant when confidence differs:**
- If WT has likelihood = 0.9, affinity = 6.5 (µM-equiv), and mutant has likelihood = 0.2, affinity = 5.0, **do not trust the Δ**. The mutant's low likelihood suggests the affinity value is likely unreliable; the predicted strengthening (6.5 → 5.0 = 1.5 log-units) may be an artifact.
- **Best practice:** Report both binding likelihood and affinity, and only trust Δ when both WT and mutant likelihoods are > 0.5.

**Calibration vs absolute affinity:**
- Boltz-2 is **relative-ranking calibrated**, not absolute. A predicted value of 6.0 does not guarantee 1 µM experimental IC50; it may be off by ±1 log-unit per the MAE values reported.
- For hit-to-lead ranking within a chemical series: strong (R ≈ 0.6–0.66 on good assays); for absolute affinity prediction: expect ±1.0–1.7 kcal/mol mean absolute error.
- The paper reports centered MAE = 0.855–1.384 kcal/mol on private assays, meaning when offsetting systematic bias, error reduces.

## Direct quotes (≤4, ≤40 words each, with section reference)

1. **On output interpretation** (Training, page 5):
   > "The predicted value should be viewed as a general measure of binding strength that supports ranking and can be approximately interpreted as an IC50-like value."

2. **On FEP comparison** (Section 5.3, page 9):
   > "Boltz-2 addresses this problem as it allows accurate affinity predictions at a fraction of the computational cost, enabling rapid prioritization in structure-guided optimization workflows."

3. **On limitations** (Section 5.3, page 10):
   > "Strong performance on public benchmarks does not always immediately translate to all complexities of real-world drug discovery without further work to understand relative strengths and weaknesses."

4. **On speed-accuracy tradeoff** (Abstract):
   > "Boltz-2...achieves strong correlation with experimental readouts on many benchmarks, while being at least 1000× more computationally efficient than FEP."

## Key references this paper relies on (≤5)

1. **Abramson et al. (2024)** — AlphaFold3 co-folding foundation (structure prediction baseline).
2. **Wohlwend et al. (2025)** — Boltz-1 (prior architecture and training pipeline).
3. **Ross et al. (2023)** — FEP+ benchmark and Cheng–Prusoff equation applied to assay normalization.
4. **Gowers et al. (2023)** — OpenFE dataset (876 hit-to-lead complexes).
5. **Cretu et al. (2024)** — SynFlowNet generative model (coupled with Boltz-2 for de novo design validation).

---

**Notes for medchem-phd skill integration:**
- Use Boltz-2 for ranking and hit-to-lead optimization; validate with Vina or GNINA for novel chemotypes.
- Always report both binding likelihood and affinity in audit trails.
- On GPCR/GPCB targets, explicitly flag as "out-of-recommended scope" and recommend physics-based or experimental validation.
- Δ values are only meaningful when both WT and mutant have likelihood > 0.5.
