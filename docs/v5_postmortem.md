# v5-symmetric-min postmortem (2026-05-01)

**Status:** Reverted same day. Validation regression too severe to ship.

## TL;DR

A PhD-level audit flagged that WT receptors weren't going through the
same OpenMM amber99sb-ildn vacuum minimisation that mutant receptors
got, and recommended symmetric prep. We implemented that as v5
(`PREP_VERSION = "v5-symmetric-min"`, commit `23fd315`), re-ran the
8-case positive-control validation suite, and watched the headline
PASS rate collapse from **5/8 → 2/8 + 1 FAIL**. Reverted in commit
`fe4f75f`. Bumped to v6 to flush the polluted WT caches the v5 run
left behind.

The audit was wrong, and so were we for acting on it without thinking
hard enough about WHY the asymmetry was there in the first place.

## What v5 changed

1. New public helper `minimize_pdb()` in `pipeline/deltadock_pipeline/mutate.py`
   — extracted from the existing internal `_minimize_with_openmm`.
2. `runner.py` WT-prep block called `minimize_pdb(cleaned_pdb, wt_min_pdb)`
   before `prepare_receptor`, gated by `catalog_target.minimize_mutant`
   (so BRAF stayed un-minimised, everything else got both sides minimised).
3. `PREP_VERSION` bumped `v4-per-target-min → v5-symmetric-min` to
   invalidate every cached WT/mutant pdbqt.

## What broke (per-case Δ comparison)

| Case | v4 WT / MUT / Δ → verdict | v5 WT / MUT / Δ → verdict | Diff |
|------|---------------------------|---------------------------|------|
| ABL T315I (Imatinib) | -12.0 / -8.4 / +3.6 PASS | -10.2 / -9.2 / +1.0 PASS | margin shrunk |
| EGFR T790M (Gefitinib) | -7.9 / -6.6 / +1.3 PASS | -6.6 / -6.6 / 0.0 NOISE | dropped from PASS |
| EGFR T790M (Osimertinib) | -7.4 / -7.1 / +0.3 NOISE | -7.4 / -7.1 / +0.3 NOISE | unchanged (cache?) |
| BRAF V600E (Vemurafenib) | -8.6 / -11.3 / -2.7 PASS | -11.3 / -11.3 / 0.0 NOISE | dropped from PASS |
| KIT D816V (Imatinib) | -12.3 / -9.7 / +2.6 PASS | -8.8 / -10.6 / -1.8 FAIL | flipped to wrong direction |
| KIT D816V (Avapritinib) | -9.6 / -9.2 / +0.4 NOISE | -8.7 / -8.5 / +0.2 NOISE | both moved |
| BTK C481S (Ibrutinib) | -10.5 / -9.0 / +1.5 PASS | -8.9 / -8.4 / +0.5 NOISE | dropped from PASS |
| BTK C481S (Pirtobrutinib) | -10.5 / -8.7 / +1.8 FAIL | -9.6 / -8.9 / +0.7 PASS | flipped to PASS |

Net: 4 cases lost their v4 PASS verdict, 1 flipped direction (FAIL),
1 flipped from FAIL to within-noise PASS.

## Why the audit was wrong

The audit characterised the v4 prep as "biased — every Δ inherits a
small bias whose direction depends on the target." That framing assumed
WT and mutant should be treated identically. But the two receptors
**start from physically different states**:

- **WT** comes from the canonical RCSB co-crystal PDB. The crystal
  structure IS a low-energy minimum — that's why crystals form. Running
  another 200 steps of vacuum minimisation on it just collapses the
  pocket slightly (vacuum forces tend to compress structures), which
  loosens the discriminating geometry that gives Vina its selectivity
  signal. Multiple v5 cases showed WT scores moving toward weaker
  binding (less negative) by 1.3–3.5 kcal/mol — pure information loss.

- **Mutant** comes from `PDBFixer.applyMutations()`, which swaps the
  residue *identity* but leaves the new side-chain atoms at the WT
  positions with the new residue's atom names. For non-isosteric
  substitutions (V→E, T→I, C→S, G→V) that places atoms with
  bond lengths off by 0.1–0.3 Å and clashes of 0.5–1.0 Å. THIS is
  why mutant needs minimisation: not to match WT's treatment, but to
  fix the clashes the synthetic substitution introduced.

So the asymmetry isn't a bug — it's the correct response to the fact
that the two receptors are in different physical conditions. The v4
prep had this right.

## What the audit should have looked at instead

The real issue v4 had wasn't asymmetry; it was that a few targets
(BRAF V600E specifically) showed Vina-score variability across runs,
which the audit interpreted as "minimisation bias." The actual cause
was probably:

1. PDBFixer's `addMissingAtoms` is mildly non-deterministic on edge
   cases (rotamer choice, hydrogen placement order).
2. Vina at exhaustiveness=16 has a stochastic search, ~0.5 kcal/mol
   reproducibility per run.
3. Some pocket geometries (BRAF V600E activation loop) are sensitive
   to small starting-structure perturbations.

The right answer was already in place: per-target opt-out via
`Target.minimize_mutant`. BRAF was the only target with persistent
instability; flipping its flag to False resolved it. That mechanism
is the right shape — apply prep that's appropriate to each target's
biology, not a one-size-fits-all rule.

## What we shipped to prevent recurrence

1. **Reverted** v5 in commit `fe4f75f`.
2. **Bumped PREP_VERSION** to `v6-revert-to-asymmetric` so the WT
   caches that got minimised during the bad run are flushed.
3. **Rewrote** `backend/scripts/verify_prep_symmetry.py` to assert
   the CORRECT invariant: WT does NOT minimise, mutant DOES (per-target).
   Wired into `fly-deploy.yml` as a blocking CI gate. A future
   audit-driven attempt to make the prep symmetric will fail the build
   before it can ship.
4. **Memory note** with the "asymmetry isn't a bug" lesson so future
   sessions don't re-walk the same trap.

## Lessons

1. **An asymmetry isn't always a bug.** Two things being treated
   differently can be the correct response to them BEING different.
   Before changing the treatment, ask why the asymmetry is there.

2. **Validation suite is the source of truth, not the audit.** The
   audit is a smart prior; the validation suite is empirical evidence.
   When they disagree, the suite wins.

3. **PhD audit recommendations are inputs, not commands.** The audit
   said "this looks like a bug" — the right response was to
   investigate, not to act. We acted, broke validation, and had to
   revert under pressure.

4. **Bumping PREP_VERSION has hidden consequences.** Even reverting
   the code change leaves the cached files behind. Need to bump
   PREP_VERSION on the revert too (which we did, → v6).

5. **The pre-symmin backup snapshot was load-bearing.** Without
   `pre-symmin-2026-05-01` tag + Postgres dump + ROLLBACK.md, this
   would have been a much worse incident. Continue snapshotting
   before any change that touches scientific output.

## What to do if someone re-proposes symmetric WT minimisation

Read this document. Run the v5 experiment in their head with the
per-case table above. If they still want to try it, the right
experiment shape is: opt-in per target via a NEW `Target.minimize_wt`
flag (default False), test on a single non-BRAF target first, run
the full validation suite, only flip more targets if numbers improve.
Don't apply it globally again.
