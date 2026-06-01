# Liganx Mutant-Selective Binder Discovery — Pipeline Design

Author: design draft, 2026-05-31
Status: design / action plan — no code written yet. This document is the
reference for the build. Goal: find binders that grab the **mutant** form
of a target but **not** the wild-type (WT).

## 0. Guiding constraints

- **Standalone.** Ships as one new page at `/selective`. It does NOT touch
  `StudioPage.tsx` or any existing Studio flow, the core `jobs` router, or
  the docking pod image (MVP). Everything is additive: a new router, a new
  service, a new model + migration, a new frontend page + route + nav link.
- **Reuse over rebuild.** ~70% of the pipeline already exists as shipped
  primitives. The new service *imports and orchestrates* them; it does not
  fork or modify them.
- **Audience note.** Liganx is built by a software engineer learning the
  bio domain — this doc favors plain-English explanation of the science.

## 1. What already exists (reuse)

| Pipeline need | Existing asset | Notes |
|---|---|---|
| Mutate WT structure + relax (option ②) | `routers/structures.py` + FoldX/PDBFixer build path in `runner.py` | Already serves WT-clean AND mutated PDBs on demand. |
| Matched experimental structures (option ①) | RCSB fetch + `fix_pdb()` prep in `structures.py` | Pull a real mutant crystal/cryo-EM when one exists. |
| Conformational ensemble (#4) | pod `/relax_ensemble`, `ensemble` flag on `Job` | Shipped ensemble docking. |
| Dock a ligand vs a specific `(pdb, chain, variant)` | `services/runner.py`, `dock_cache.py` | Differential = run twice (WT + mutant), subtract. |
| Rigorous relative binding free energy | `fep_runner.py`, `fep_reconciler.py` (openfe/OpenMM) | The gold-standard engine for the selectivity number on top hits. |
| Mutation / target context | `atlas`, `esm2` fitness, FoldX ddG | Optional enrichment. |

**Genuinely new code:** target triage (A), pocket-diff summary (B output),
the differential scoring + ranking layer (D), and a similarity/analog
engine (E — no real Tanimoto/scaffold search exists today).

## 2. Where it lives

### Frontend (no Studio contact)
- New route `/selective` in `App.tsx` + a nav link.
- New `pages/SelectivePage.tsx`. Imports shared components (3D viewer,
  results table) **read-only**; edits nothing in Studio.

### Backend (additive only)
- `routers/selective.py`, prefix `/selective`, registered in `main.py`.
- `services/selective_runner.py` — orchestrates `receptor_prep`, `runner`
  (ensemble), `dock_cache`, and `fep_runner`. Imports, never modifies.
- `services/analog_search.py` — RDKit similarity + ChEMBL top-up (E).
- New `SelectivityJob` model + one idempotent `.sql` migration, wired into
  `_STARTUP_MIGRATIONS` per the standing migration convention (no env
  flags; runs unconditionally + fail-loud on boot).
- **No pod changes** for the MVP — reuses existing dock/relax endpoints.

## 3. The pipeline, step by step

### A. Target triage — "where does the target live?"
`GET /selective/triage?target=<uniprot|gene>` fetches the UniProt
subcellular-location annotation and returns `intracellular |
extracellular | membrane` plus the **allowed binder modalities**.

Why it matters: an intracellular target can only be hit by something that
crosses the cell membrane → small-molecule / cell-permeable chemistry.
Extracellular targets are freer → chemical, peptide, or protein binders.

The page uses this to **gate modality options**: intracellular greys out
peptide/protein and steers to small molecules; extracellular unlocks all
three. This gating is cheap to build now and keeps the page honest even
before peptide/protein docking exists.

### B. Build the WT-vs-mutant pocket map
1. Obtain both structures: option ② (mutate WT + relax, via the existing
   FoldX/PDBFixer path) and, when available, option ① (a matched
   experimental mutant structure from RCSB).
2. `pocket_diff()` in `selective_runner.py` aligns WT vs mutant around the
   mutation residue and reports the delta: added/removed atoms, change in
   pocket volume and electrostatic character. This is the "two-blob"
   comparison — it drives both the 3D viewer overlay and the docking box
   definition for step D.

### C. Add flexibility (ensemble)
Call the existing `/relax_ensemble` for **both** WT and mutant pockets and
store N conformers each. Represents the pocket's natural wobble instead of
one rigid snapshot. Already-built code path.

### D. Differential binding — the payoff (MVP = docking + FEP)
1. **Docking diff (screen).** Dock each candidate across both ensembles.
   Score `ΔΔG_sel = score_mutant − score_WT`. Rank most-negative first =
   binds the mutant tighter than WT = mutant-selective. Fast, screens many.
2. **FEP escalation (confirm).** Auto-escalate only the **top 5 hits
   (ranks 1–5 by `ΔΔG_sel`)** to the `fep_runner` pipeline for a rigorous
   relative binding free energy between the WT and mutant pockets. FEP is
   the gold-standard, GPU-hours number — too expensive per-candidate, so it
   runs only on this tight shortlist. This two-tier screen→confirm design
   is the core of the MVP.

   > Decision (2026-05-31): escalate strictly the best 5, not a larger N —
   > keeps FEP GPU cost bounded and predictable per run.

> Decision (2026-05-31): D ships with **both** tiers from day one, not
> docking-only. FEP is gated/queued the same way the existing FEP feature
> is, so it can't swamp the GPU.

### E. Analog expansion
Take the top selective hits and broaden the list via `analog_search.py`:
1. **Local RDKit** Tanimoto / scaffold search over the existing compound
   libraries (self-contained, always available).
2. **ChEMBL top-up** via the ChEMBL connector for wider chemical space.

> Decision (2026-05-31): E = **both** sources. NOTE: the ChEMBL connector
> was offline as of this writing — E ships RDKit-first and lights up the
> ChEMBL half once the connector is reconnected.

## 4. Binder modalities

Decision (2026-05-31): rank small molecules, then peptides, then proteins —
phased by what the engine supports and what triage allows. The protein
phase is explicitly **peptide-derived**, not generic protein docking.

- **Small molecules** — ship in the MVP; the current docking engine
  already handles them.
- **Peptides** — next phase, **before** proteins; needs peptide-capable
  docking/scoring on the pod. Modality is exposed in the UI but gated by
  triage (extracellular only). We fully work out the winning mutant-
  selective peptide(s) here first.
- **Proteins / biologics** — last phase, and seeded by the peptide result.
  Rather than dock arbitrary proteins, we take the winning surface peptide
  patch and search for proteins that **already display a similar surface
  patch — or can be engineered to (graft / loop-extension)**. So the
  protein hunt is: "what natural or engineerable scaffold presents this
  same selective patch to the mutant pocket?" Only offered when triage
  reports extracellular.

## 5. Build order

1. `SelectivityJob` model + migration + empty router/page wired
   end-to-end (clickable, returns a stub).
2. **A — triage.** Cheap, proves the page and drives modality gating.
3. **B + C.** Wire mutant-build + dual ensembles into the new flow (mostly
   reuse).
4. **D.** Differential docking + ranking, then the FEP-escalation hook.
   This is where the real value lands.
5. **E.** Analog expansion (RDKit, then ChEMBL when reconnected).
6. **Peptide** modality — work out the winning mutant-selective peptide(s).
7. **Protein** modality — search for proteins that natively present, or can
   be engineered (graft / loop-extension) to present, the winning peptide's
   surface patch.

## 6. Explicitly out of scope (MVP)
- Any change to Studio, the core `jobs` router, or the pod image.
- Peptide/protein docking engines (modality slots reserved + gated only).
- Wet-lab validation hooks.
