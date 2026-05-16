# FEP+ Phase B — Scaffold + Design Audit (2026-05-15)

Auditor: science-engineering verification agent, brief in
`Agent("Audit FEP+ Phase B scaffold")` call.

## Overall verdict

**Directionally right, gaps are acceptable for a scaffold.** The
stack choice (openfe + OpenMM + openmmtools + pymbar) is the
defensible 2026 OSS pick, the sampling protocol is in the band of
published industrial RBFE work, and the scaffold cleanly isolates a
feature-flagged surface that frontend can compile against without
dragging in 2 GB of CUDA.

Four real issues, none show-stoppers — must be addressed before
flipping `FEP_ENABLED=1` in production.

## Top 3 action items for week-1 follow-up

1. Add `017_fep_tables.sql` + the three SQLModel classes
   (FepJob/FepNode/FepPerturbation). The doc promised them in week 1
   and downstream tooling assumes they exist.
2. **Tighten convergence thresholds** — current numbers will pass
   garbage results unflagged:
   - `NOT_CONVERGED` if hysteresis > **0.5** kcal/mol (was 1.0)
   - `HIGH_UNCERTAINTY` if 95% CI > **0.4** kcal/mol (was 1.0)
   - `CYCLE_CLOSURE_FAIL` if any cycle > **1.0** kcal/mol (was 1.5)
   Per Mey et al. 2020, *Living Journal Comp. Mol. Sci.*
3. Add `POST /fep/studies/estimate` + Pro-tier gate before launch.

## Section-by-section findings

### a) Scientific design

**Stack** — openfe is the right 2026 OSS pick. JACS-22 reproduced to
0.3–0.4 kcal/mol RMSE. Perses has better absolute-FEP machinery but
API churn + brittle hybrid topology setup. Keep openfe.

**Force fields** — Amber14SB + Sage 2.2 + TIP3P is correct.
**OpenFF Rosemary (2.3) shipped late 2025** with better halogen +
sulfonamide treatment (relevant for kinase chemistry: osimertinib's
acrylamide warhead, Cl-aniline). Pin Sage 2.2 for v1
reproducibility, plan a Rosemary A/B in week 6+. TIP3P over OPC is
right for benchmark comparability.

**Sampling — equilibration is too short.** For EGFR-T790M
ATP-pocket the gatekeeper sidechain relaxes on the ~2 ns timescale.
Bump equilibration from 1 ns to **2 ns** (discard, not counted in
"5 ns/window" framing). Reframe as: 7 ns total per window, 2 ns
discard, 5 ns production. HMR to 3 amu + 4 fs timestep is standard.

**Convergence thresholds** — see item 2 above. Current numbers
(>1.0 hysteresis = NOT_CONVERGED, >1.5 cycle closure = FAIL) will let
through results that should be flagged. Tighten to 0.5/0.4/1.0.

**Atom mapping** — LOMAP default + Kartograf fallback is correct.
Add `PersesAtomMapper` as a third option exposed via a request-body
parameter (`atom_mapper: "lomap"|"kartograf"|"perses"`). Cost of
exposing is one field; power users will want it.

### b) Engineering design

**Missing migration + models** — the biggest scaffold gap. Doc promised
them in week 1. Anyone who flips `FEP_ENABLED=1` blind will hit a 500
where they expected a 501. Add `017_fep_tables.sql` + SQLModel
classes in the next scaffold pass.

**No `/runpod/fep_pod/`** — acceptable, week 2 work.

**Feature flag — needs per-user gate.** `FEP_ENABLED` alone is fine
as a kill switch. The doc says "Pro-tier from launch" and $100/study
costs make that non-negotiable. Add `user.tier == "pro"` check
before any real call lands.

**`list[tuple[str, str]]` for manual_edges** — round-trips OK but
ambiguous (which field is which? name? SMILES?). Switch to a typed
Pydantic model `FepManualEdge {a: str, b: str}` for self-documenting
clarity.

### c) Missing risks

1. **Cost shock.** First angry support ticket if we don't ship: "I
   clicked Run and got a $100 bill." Need `/fep/studies/estimate`
   returning projected GPU-hours + $ + ETA, typed confirmation
   checkbox, monthly per-user cap.
2. **Cancellation semantics.** Cooperative cancellation at edge
   boundaries (kills in-flight pod request only on current edge);
   partial results persist (finished edges keep their ΔΔG);
   **billing stops at next edge boundary, not instantly** — UI must
   say so.
3. **"Now what?" UI.** Ranked ΔΔG table is necessary, not
   sufficient. After 10-analog study, user needs:
   - top-3 synthesize-next recommendations (filtered by
     `convergence_flag=ok`)
   - ADMET cross-reference via existing `/admet/predict` endpoint
   - cycle-closure banner with FF-misbehaviour interpretation, not
     just a number

### d) Timeline

**Week 2 (OpenMM-from-source on Blackwell sm_120) is the riskiest
by a wide margin.** OpenMM 8.2 merged sm_100/sm_120 PTX targets;
publicly thin evidence beyond Chodera-lab threads. User memory
`project_gnina_blackwell.md` is a warning: TVM kernels SIGABRT'd on
Blackwell. OpenMM build is cleaner (no TVM) but expect 3–4 day
delays. **Pad week 2 to 1.5 weeks, or start an A100/H100 fallback
pod in parallel.** Weeks 3–6 are about right if week 2 lands.

### e) Schrödinger FEP+ gap analysis

What FEP+ has that this design doesn't:
- **OPLS4 ligand FF** — ~0.1 kcal/mol better RMSE on Schrödinger's
  internal sets. Not available to us; gap is real but small.
- **REST2 by default** — correctly deferred in our v1.
- **Smart-map perturbation-graph optimization** — implementable on
  openfe later.
- **Charge-changing transformation handling** — FEP+ has hand-tuned
  heuristics. openfe handles same-net-charge well; charge-changing
  needs separate dual-topology + counter-ion solvent legs neither
  openfe nor the design doc currently address. **MUST: forbid
  charge-changing analogs at submit time in v1, error out clearly.**
- **Covalent-warhead workflow** — v1 treats covalent ligands as
  their non-covalent recognition pose; result is "binding affinity
  of recognition complex," not "covalent IC50." Document this.

**Is the gap acceptable for v1 "we have FEP"?** Yes, with two
caveats:
1. Be explicit in UI/docs that this is "RBFE on neutral,
   non-covalent congeneric analogs in the ATP pocket" — not
   "Schrödinger FEP+."
2. Convergence threshold tightening (item 2 above) is non-negotiable
   if you want the results defensible against a FEP+ comparison.
