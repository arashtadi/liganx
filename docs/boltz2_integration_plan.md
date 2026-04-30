# Boltz-2 ML scoring engine — integration plan

**Status:** scoping (2026-04-30)
**Driver task:** #104 — Boltz-2 / DiffDock as alternative ML scoring engine

---

## Why Boltz-2

**Competitive position.** Vina (physics-empirical) + GNINA (CNN-rescored
Vina) + Boltz-2 (ML pose+affinity) gives Liganx three engines spanning the
methodology space. No competing rigid-receptor docking platform we've
surveyed offers an ML-pose-prediction option as a first-class engine — this
is the largest single differentiator we can ship without rebuilding the
backend.

**Scientific reach.** Vina cannot resolve covalent mechanism, active-
conformation selectivity, or the non-covalent-vs-covalent distinction we
documented in our positive-control suite (Pirtobrutinib, Avapritinib,
Osimertinib). Boltz-2 was trained on protein-ligand complexes from PDB and
predicts a complex structure plus an affinity value in one forward pass —
some classes of those failures might be partially resolvable by giving Vina
+ GNINA + Boltz-2 as three independent estimates and showing the user where
they agree vs disagree.

**Cost & speed.** ~20s per prediction on a single recent NVIDIA GPU; runs
on the existing Blackwell pod we already provision. No new infra cost.

**License.** MIT. Both academic and commercial use permitted. (FoldX
compares unfavourably here — academic-licence-only, which is why we have
fallback paths.)

---

## What Boltz-2 actually returns

Each prediction outputs:

- A **predicted complex structure** (CIF/PDB) — the binding pose of the
  ligand inside the protein.
- `affinity_pred_value` — a continuous affinity prediction. Units are
  log10(IC50 in μM); larger negative = stronger binder.
- `affinity_probability_binary` — 0–1 score for "is this a real binder vs
  decoy?"; useful for hit triage but not for ΔΔG.

**For our mutation-aware ΔΔG use case** the relevant quantity is
`affinity_pred_value` for WT and mutant separately, with
**Δ = mutant − WT**. Same direction-not-magnitude framing as Vina.

---

## Per-target mutation handling

Boltz-2 takes the protein **sequence** as input, not a PDB. A single-
residue substitution becomes a one-character change in the sequence
string. This is the right primitive for our use case — no FoldX-style
side-chain rebuild, no PDBFixer-style residue swap, no OpenMM
minimisation. The model handles mutation directly.

**The big unknown.** ML structure prediction models have been criticised
in the literature for being insensitive to single-residue changes far
from training-data perturbations. Whether Boltz-2 returns meaningfully
different `affinity_pred_value`s for a single-residue gatekeeper change
(T315I, T790M, V600E, D816V, C481S) is the single most important
validation question. Plan: run the existing 8-case positive-control
suite through Boltz-2 and compare to the Vina results we already have
on /validation. Any case where Boltz-2 disagrees with Vina is a
two-engine disagreement we surface to the user — that's value, not a
bug.

---

## Integration architecture

The same dispatch pattern we used for GNINA, three layers deep:

### 1. Pod side — `dock_server.py`

Existing endpoints: `/dock_one`, `/dock_batch`, `/dock_one_gnina`,
`/dock_batch_gnina`.

Add: `/dock_one_boltz2`, `/dock_batch_boltz2`.

Implementation:
- One-time pod setup: `mamba env create -n boltz` with python 3.10,
  `pip install boltz`, download model weights (~5 GB — fits on existing
  /workspace volume).
- Per-job: write a YAML manifest with WT or mutant sequence + ligand
  SMILES, call `boltz predict <yaml> --output_format pdb`, parse the
  JSON output, return `(affinity_pred_value, affinity_probability_binary,
  predicted_pdb)`.
- Boltz's `--use_msa_server` is a Click boolean **flag** (not a
  value-taking option), default False. Single-sequence mode is the
  default and what we want — WT and mutant predictions don't depend
  on MSA construction differences. To enable MSA later, append the
  flag with no value; do NOT write `--use_msa_server False` (Click
  rejects "False" as an unexpected positional argument).
- Pass a pocket hint via `pocket` field in the YAML (template chain ID
  + ligand contact residues from our catalog) so Boltz-2 anchors the
  ligand near the canonical site rather than searching the whole
  protein. This matters: without a pocket hint, Boltz can place the
  ligand on the protein surface and we get noise.

Runbook:
`backend/docs/runpod_boltz2_setup.md` — step-by-step pod-side install,
mirroring `runpod_gnina_setup.md`.

### 2. Pipeline client — `pipeline/deltadock_pipeline/`

Add: `dock_one_boltz2()`, `dock_batch_boltz2()` in a new module
`boltz2_pod.py`. Same shape as `gnina_pod.py` — POSTs to the pod
endpoint, returns a normalised result dict with `score` (= negative
of `affinity_pred_value` so larger-negative = stronger, matching Vina
convention), pose PDB, raw Boltz outputs.

### 3. Backend — `backend/src/deltadock/services/runner.py`

The runner already dispatches on `engine ∈ {"vina", "gnina"}`. Add
`"boltz2"` as a third option. Per-target flags follow the same per-
target catalog approach we used for `minimize_mutant`:
`engine_supported: tuple[str, ...] = ("vina", "gnina", "boltz2")` on
the Target dataclass, defaulted to all three. Targets that are
known-bad for Boltz-2 (no pocket coords, custom uploads with
unknown sequence) drop "boltz2" from the tuple.

### 4. API — `backend/src/deltadock/api.py`

Add `"boltz2"` to the engine enum. Update OpenAPI docs.

### 5. Frontend — engine picker

`NewJobPage.tsx` already has a Vina/GNINA segmented control. Add a
third option. Per-engine description tooltip:
- Vina: "Fast, physics-empirical scoring. Good for steric/electrostatic
  effects."
- GNINA: "CNN-rescored Vina poses. Better pose ranking, similar
  signal direction."
- Boltz-2: "ML structure + affinity prediction. Different methodology;
  useful for cross-validation."

Engine badge on each cell already supports per-cell engine display
(from #234) — extend the colour palette to include a Boltz-2 badge.

### 6. Validation

After end-to-end works on at least one case, run the 8-case positive-
control suite with engine=boltz2 and append a parallel column to
`validation_results.json`. The /validation page already renders one
verdict column; the JSON schema will need a small extension to allow
per-engine verdicts. Alternative: separate `/validation/boltz2` JSON
file rendered as a sibling tab on the page.

---

## Phasing — what ships when

**Phase 1: Pod-side proof-of-life (1-2 sessions).**
- Pod runbook + Boltz-2 install.
- Hand-run a single Boltz-2 prediction on ABL T315I + Imatinib via SSH;
  capture WT and T315I `affinity_pred_value`s; verify Δ direction
  matches the +3.6 kcal/mol Vina signal.
- Decision gate: if the single hand-run disagrees in direction with
  Vina (and with the literature), pause and revisit. ML model
  sensitivity to single-residue changes is the open question.

**Phase 2: Backend integration (1-2 sessions).**
- `dock_server.py` endpoints on the pod.
- `boltz2_pod.py` pipeline client.
- Runner dispatch + API enum + free-tier rate-limit logic.
- E2E test: submit a job from frontend with engine=boltz2.

**Phase 3: UI + validation (1 session).**
- Engine picker third option.
- Per-cell badge.
- Validation page schema extension or sibling page.

**Phase 4: Document + ship.**
- Update homepage method-honesty footnote with Boltz-2 status.
- Add a third column to the comparison table: "ML pose+affinity model".
- Run the 8-case suite, commit the snapshot.

---

## Open questions to resolve mid-implementation

1. **MSA on/off?** Single-sequence is faster + makes WT/mutant
   comparisons fair. Auto-MSA is more accurate per Boltz-2's own
   benchmarks. Decision: start single-sequence; if validation runs
   show direction errors that auto-MSA fixes, switch.

2. **Pocket hint format.** Boltz-2 accepts a `pocket` field in YAML
   listing contact residues. Our catalog stores pocket centres as
   xyz coordinates, not residue lists. Cheapest path: extract
   contact residues at catalog-audit time (PDB residues within 5 Å
   of the canonical co-crystal ligand) and store on the Target
   dataclass.

3. **Pose vs affinity priority.** Boltz-2's `affinity_pred_value` is
   trained separately from its structure head. The pose accuracy
   numbers in the paper are PoseBusters-like; affinity numbers are
   FEP+-comparable. For OUR use case ΔΔG direction is what matters,
   so we expose `affinity_pred_value` deltas. Pose is rendered in
   the existing 3D viewer for inspection but not scored against.

4. **Cost ceiling.** Free-tier accounts get N Boltz-2 jobs/day
   (TBD — probably 5, vs 50 for Vina, since Boltz-2 takes 20s vs
   Vina's 5s and we don't want a single user starving the pod).

---

## What this plan does NOT include

- Boltz-2's antibody / multi-protein modes. Out of scope for the
  drug-mutation use case.
- Affinity calibration to ΔΔG kcal/mol. Boltz-2 returns log10(IC50
  μM); we present this in its native units alongside Vina kcal/mol
  rather than trying to convert.
- Switching the default engine away from Vina. Vina remains the
  default; Boltz-2 is opt-in.
- Replacing GNINA. GNINA stays as the second engine. Three engines.
