# Water-displacement analysis — design doc

**Status:** scoping (2026-04-30)
**Driver task:** #103 — open-source WaterMap-equivalent

---

## Why this matters for mutation-aware docking

Schrödinger's WaterMap is a pillar of their pitch — for any new ligand
or mutant, it scores the binding-site water network and tells the
medicinal chemist which waters are "happy" (stable, hard to displace)
vs "unhappy" (high-energy, displacing them is favourable). For
mutation work it's especially valuable: a single residue change can
reshape the water network in ways that drive selectivity even when
the protein heavy atoms barely move.

We don't currently model water at all. Vina, GNINA, and Boltz-2 all
treat the binding site as dehydrated — solvation effects are absorbed
into empirical scoring functions, and the ΔΔG between WT and mutant
loses any signal that comes purely from water-network rearrangement.

For at least three documented cases on our /validation page, water
network is plausibly part of the unresolved signal:

- **Avapritinib + KIT D816V** — selectivity comes from the active-
  conformation pocket, which has a different solvation pattern than
  the inactive form.
- **Osimertinib + EGFR T790M** — covalent acrylamide attaches at
  C797, but the pre-covalent binding mode involves displacing
  pocket waters that T790M reorganises.
- **L858R + various TKIs** — outside-pocket but reshapes the
  P-loop water ring; not testable in our current pipeline.

---

## Survey of available approaches

### Option A — GIST (grid inhomogeneous solvation theory)

**What it is.** Run an MD simulation of the apo (no ligand) protein
in explicit water, compute per-grid-voxel water entropy, enthalpy,
and free energy. Identify "hydration sites" as voxels where water
density spikes, score each site's ΔG of displacement.

**Pros.** Theoretically rigorous; this is what WaterMap is.
Open-source implementations exist (cpptraj's `grid` action does
this; SSTMap is a free toolkit; AmberTools includes GIST).

**Cons.** Needs explicit-water MD per (target, mutation) pair.
Even a 5 ns simulation is ~30 min of GPU time on our Blackwell —
expensive. Pre-equilibration adds more. For a free-tier user
submitting a job, that's a 30+ min wait for a per-cell water
score, and we'd burn through pod hours fast.

**Verdict.** Right answer scientifically; wrong answer
operationally for our serverless free-tier model.

### Option B — 3D-RISM (reference interaction site model)

**What it is.** A statistical-mechanical solvation theory that
gives water density and free-energy fields at every voxel without
explicit MD — solves integral equations instead. AmberTools ships
`rism3d.snglpnt`. ~2 minutes per (target, mutation) on a CPU.

**Pros.** Much faster than GIST. No equilibration. Deterministic.

**Cons.** Less accurate than GIST/MD for "interesting" pockets.
Needs the protein structure already prepared (we have that). Output
format is volumetric (.dx) — needs post-processing to extract
per-residue or per-water "displacement scores".

**Verdict.** This is probably where we land for v1.

### Option C — crystallographic-water displacement scoring

**What it is.** Use the WT crystal structure's bound waters as a
proxy. For each crystallographic water, score whether the ligand
pose displaces it (overlap with ligand atoms) and whether the
water site is conserved across PDB structures of the same target
(the more conserved, the more "structural" the water, the more
costly to displace).

**Pros.** Almost free — no simulation, no theory, just geometric
overlap on PDB-deposited waters. Conservation lookup is one query
to the PDB API.

**Cons.** Assumes crystallographic waters are real biology and not
crystal-packing artifacts. Doesn't handle de novo waters in
mutant pockets. Doesn't give a thermodynamic ΔG.

**Verdict.** Cheap shipable v0 to demonstrate the concept while we
build B. Honest framing: "we score whether your ligand displaces
known crystallographic waters; deeper solvation thermodynamics is
a /Phase 2/."

### Option D — JAWS / WaterDock-style ML pose scoring

**What it is.** Train a small neural net to predict water
displacement free energy from local geometry. Inference is fast.
A few open-source models exist (WaterDock, hydra, OpenJAWS).

**Pros.** Fast at inference time.

**Cons.** Model availability is mixed. Quality varies wildly by
target class. Adds another model dependency.

**Verdict.** Skip for v1; revisit if 3D-RISM proves too slow at
scale.

---

## Proposed phasing

### Phase 0 — crystallographic-water v0 (1-2 sessions)

The cheap shipable thing. For each docked pose:

1. Pull the canonical PDB (we already do this for receptor prep).
2. Extract HOH records within 5 Å of the binding pocket centre.
3. For each pose, count waters whose oxygen atom sits within 1.5 Å
   of any ligand heavy atom — those are "displaced waters".
4. Look up each displaced water's conservation in BindingDB or
   the PDB's water database (cheap query) — count how many
   structures of the same UniProt have a water at the same
   coordinates within 1 Å.
5. Surface in the JobPage as a panel: "This pose displaces N
   binding-site waters, M of which are conserved across K PDB
   structures of {target}. Conserved-water displacement is
   typically more thermodynamically costly."

This is honest, cheap, and lets us put a "Water analysis" tab on
the JobPage today. It's NOT WaterMap; the copy explicitly says
that.

### Phase 1 — 3D-RISM thermodynamic scores (1 week)

Add an apo-protein 3D-RISM run as a per-target catalog asset,
not per-job. Pre-compute for each catalog target's WT and major
mutants at deploy time; cache the .dx volumetric output in R2
alongside the receptor PDBQT. At job time, sample the cached
volumetric ΔG field at each ligand atom position and sum — that's
the per-pose desolvation-displacement score in real units.

This is operationally clean (compute heavy lifting at deploy time,
not job time) and gives us the WaterMap-equivalent number.

### Phase 2 — explicit-water GIST for premium pockets

For the highest-stakes targets in our catalog (BRAF, EGFR, KIT,
ABL — the marquee oncology kinases), commission proper GIST
simulations off-line and ship the cached results. Nobody runs
GIST at request time; everyone caches. This is what WaterMap
does too — they pre-compute on customer-supplied targets at
project setup, not per-screen.

---

## Integration touchpoints

- **Backend:** new `water_analysis` field on Job model.
  Per-pose breakdown of displaced waters + conservation +
  estimated ΔG_disp (Phase 1+).
- **Pipeline:** new `analysis/water.py` module. Fast crystallo-
  water scoring inline (Phase 0); .dx volumetric sampling for
  Phase 1; pre-cached GIST for Phase 2.
- **Frontend:** "Water analysis" tab on JobPage between Pose and
  Insights. 3D viewer overlay shows water spheres coloured by
  conservation (Phase 0) or ΔG (Phase 1+). Per-pose count + sum.
- **Validation:** the 8-case positive-control suite gets a parallel
  "water-displacement Δ" column once Phase 1 lands. Cases where
  water-displacement Δ adds signal that Vina missed are real
  evidence we've extended the platform's reach.

---

## What's NOT in scope

- Per-conformation water network sampling (path-integral MD,
  metadynamics over water sites). Out-of-budget for this product.
- Drug-design suggestions ("displace this water and gain X
  kcal/mol"). That's an SBDD-tool feature; we're scoring, not
  designing.
- Membrane proteins. The water network in lipid-embedded receptors
  needs different treatment. Out of scope until we add membrane
  catalog targets.
