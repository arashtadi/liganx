# Scoring conventions reference

The numerical conventions of docking, drug-likeness, and pose validation
that need to be exactly right or downstream interpretation breaks.

## Table of contents

1. Vina-family scoring (Vina, QuickVina, Smina, Vinardo)
2. GNINA (CNN-based)
3. Boltz-2 (co-folding with affinity head)
4. PoseBusters
5. Strain energy (MMFF94 RMSD)
6. ProLIF interaction fingerprints
7. Drug-likeness rules — Lipinski, Veber, QED, PAINS
8. Pocket geometry — box sizing, outside-pocket detection

## Vina-family scoring

**Output unit:** kcal/mol. AutoDock Vina, QuickVina, Smina, and Vinardo
all emit scores in this unit. Vinardo is a re-scoring function applied
post-Vina; the unit is the same.

**Sign convention:** more-negative = stronger binding. A score of
−10.0 kcal/mol is tighter than −7.0 kcal/mol. This matches the
free-energy convention but Vina is empirical scoring, not free energy
(see "what Vina is not" below).

**Reproducibility:**
- exh=8 (Vina default): reproducibility ~ ±1.0 kcal/mol per pose
- exh=16: ~ ±0.3-0.5 kcal/mol
- exh=32+: diminishing returns; ±0.2 kcal/mol but doubled wall-clock

**Δ between two receptors:** When the pipeline reports Δ = mut_score
− WT_score, a positive Δ means the mutant binds *less tightly*
(resistance direction). A negative Δ means the mutant binds *more
tightly* (selectivity direction).

**Noise floor for Δ:** at exh=8, |Δ| < 1.0 kcal/mol is within noise.
At exh=16, it tightens to ~0.5 kcal/mol but is not zero. Don't
claim a direction at sub-noise magnitude.

**What Vina is not:**
- Not free energy — empirical scoring fit to 1-2 nM affinity data.
- Not entropy-corrected for ligand flexibility beyond the torsion penalty.
- Not solvent-aware in the modern sense (no explicit waters).
- Not covalent — covalent inhibitors get only the non-covalent component.
- Not induced-fit — receptor is rigid in the standard pipeline.

## GNINA (CNN-based)

**Output:** GNINA emits two scores per pose:
- `CNN_pose_score` (0-1, higher = better pose quality)
- `CNN_affinity` (pK-like, higher = stronger)

**Critical:** these are NOT both "score" — don't conflate them. The
pose score is a quality classifier; the affinity is a regression
target. In Liganx the "score" column is the affinity prediction
(positive-stronger), so to combine with Vina (negative-stronger) you
must convert.

**Reproducibility:** GNINA's CNN is deterministic for a given receptor
+ ligand pair. Variability comes from the upstream Vina sampling that
generates the poses being scored.

## Boltz-2 (co-folding with affinity head)

**Output unit:** `affinity_pred_value` is documented as log10(IC50 in
µM). A value of −1.0 means IC50 ≈ 0.1 µM = 100 nM. A value of +1.0
means IC50 ≈ 10 µM.

**Sign convention (subtle):** for log10(IC50 in µM), more-negative
= stronger binding (because IC50 is smaller). This is the SAME sign
convention as Vina (more-negative = stronger), so Δ subtraction works
the same way.

**However:** Some Boltz-2 variants and some downstream tools convert
the output to pKd or pKi (positive-stronger). Always re-confirm the
sign convention against the model card you're using before
subtracting between WT and mutant.

**Confidence channel:** Boltz-2 emits a separate confidence score per
prediction. Treat it as a gating dimension — low-confidence affinities
should be flagged, not used.

## PoseBusters

**Purpose:** Geometric pose validation — checks for physically
implausible poses (intra-molecular clashes, broken bond angles, wrong
chirality, etc.).

**Output:** count of failed checks (an integer 0-N).

**Liganx threshold:**
- 0 fails → "high" confidence
- 1-2 fails → "medium"
- ≥3 fails → "low"

The threshold at 2 is intentionally permissive — most "fails" are
chirality flags on prochiral centers that don't actually matter.
Tightening to 0 would skip too many valid poses.

## Strain energy (MMFF94 RMSD)

**Purpose:** Detect docked poses that are in unrealistic ligand
conformations. Computed as heavy-atom RMSD between the docked pose
and the nearest MMFF94-relaxed conformer.

**Unit:** Ångströms (NOT kcal/mol).

**Liganx thresholds:**
- < 1.0 Å → "ok" (green)
- 1.0-2.0 Å → "mild" (yellow)
- > 2.0 Å → "high" (red)

**Reference:** Bostrom 2007, J Comp Aided Mol Des. Anything above
2 Å is usually a Vina bad pose, not a real bound conformation.

## ProLIF interaction fingerprints

**Distance defaults (ProLIF library defaults, used by Liganx):**
- Hydrogen bond: ≤ 2.5 Å heavy-atom donor-acceptor distance, with
  angle constraint
- π-stacking: ≤ 5.5 Å ring-centroid distance
- Hydrophobic contact: ≤ 3.5 Å heavy-atom contact
- Salt bridge: ≤ 4.0 Å between charged groups

These match the Schrödinger / MOE conventions for IFP analysis.
Liganx adds explicit per-contact distance to the rendered output.

## Drug-likeness rules

**Lipinski Rule of 5** (Lipinski 1997):
- MW ≤ 500 Da
- logP ≤ 5 (Crippen wlogP in Liganx; same scale as cLogP within
  ±0.5 units)
- HBD ≤ 5
- HBA ≤ 10

A compound passes if all four are true. ≥1 violation flags it as
non-Ro5; the literature shows orally-bioavailable drugs increasingly
violate one or two of these (Doak 2014 on macrocycles).

**Veber** (Veber 2002):
- Rotatable bonds ≤ 10
- TPSA ≤ 140 Å²

Common second filter alongside Lipinski. A compound passing both is
"drug-like" by these classical criteria; passing neither is a flag.

**QED** (Bickerton 2012):
- Range: 0-1
- Higher = more drug-like
- Threshold: ≥0.5 is "drug-like" by the QED authors' criterion;
  marketed drugs cluster at ≥0.6.

QED is an aggregate of 8 properties (MW, logP, HBA, HBD, TPSA,
rot_bonds, aromatic_rings, alerts). It's smoother than Lipinski
because it uses desirability functions instead of hard cutoffs.

**PAINS** (Pan-Assay Interference Compounds; Baell & Holloway 2010):
- A list of substructures known to give false-positive readouts in
  high-throughput screens.
- Liganx uses the RDKit FilterCatalog with PAINS_A + PAINS_B + PAINS_C
  catalogs.
- A PAINS hit doesn't mean the compound is bad — it means a chemist
  should look closely. Many marketed drugs (e.g., quercetin
  derivatives) are technically PAINS hits.

## Pocket geometry

**Box sizing convention:** Vina's docking box is defined by center +
size in Å. The "pocket" is the volume Vina samples; atoms outside
the box are not seen by the scoring function.

**Liganx box sizes:** typically 22-30 Å on each side, depending on
the target. Wider box = more conformational sampling but more noise.
30 Å is the upper end and was chosen for EGFR specifically to capture
the L858R activation-loop residue.

**Outside-pocket detection:** A mutation is flagged "outside pocket"
when its CA atom is farther from the box center than the smallest
half-edge. With a 22 Å box, that's 11 Å. With 30 Å, 15 Å. This
correctly accounts for per-target box differences — a mutation
that's "in pocket" for EGFR's 30 Å box might be "outside pocket" for
ABL's 22 Å box.

**Pocket centre verification:** Liganx CI verifies that each catalog
target's pocket centre is within 5 Å of the chain-A co-crystal
ligand centroid. The 5 Å tolerance is a check on the catalog data
(did someone put in wrong coordinates?), not a runtime threshold.

## Conversion table

| From | To | Conversion |
|------|------|------------|
| kcal/mol Δ | rough fold-change | exp(Δ/0.6) at 298K, e.g., +1 kcal/mol ≈ 5× shift |
| log10(IC50 µM) | nM | 10^(value+3) e.g., −1.0 → 100 nM |
| pKd | Kd in nM | 10^(9-pKd), e.g., pKd 8.0 → 10 nM |

Use these for sanity checks, not for serious affinity claims —
empirical scoring functions don't have the calibration to support
absolute fold-change predictions.
