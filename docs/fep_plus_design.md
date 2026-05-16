# Liganx FEP+ — Phase B Design Document

Author: design-agent draft, 2026-05-15
Status: design — Phase B scaffold to be implemented this session, full
implementation in subsequent sessions per the timeline below.

## 1. Software stack — openfe + OpenMM

We build on **openfe 1.x (Open Free Energy Consortium)** as the
orchestration layer, with **OpenMM 8.x** as the simulation engine and
**openmmtools** providing the alchemical sampler. Perses is the
principal alternative (same Chodera-lab lineage, same OpenMM substrate,
more battle-tested on absolute FEP and exotic perturbations) but for
our workflow — a star or MST over ≤10 congeneric analogs with a sane
CLI and a documented Python API — openfe is the better choice today.

Concretely:
- Maturity has crossed the "production at industrial sponsors"
  threshold in 2024–2025; OpenFE's public benchmark on Schrödinger's
  JACS-22 set reproduced commercial-grade accuracy.
- MIT-licensed end-to-end — important because the Liganx pod image is a
  mix of OSI licenses and a non-redistributable dependency would drag
  the image into a gray zone.
- Python API stability: openfe 1.x froze the `ChemicalSystem` /
  `Transformation` / `ProtocolUnit` abstractions and the
  `RelativeHybridTopologyProtocol` is what every consortium tutorial
  uses. The CLI (`openfe quickrun`) is a thin wrapper over those same
  objects — we drive the API directly, not the CLI.

**Blackwell sm_120 caveat:** OpenMM 8.1+ ships pre-built CUDA kernels
but the cubins target sm_70 through sm_90 (Hopper). On Blackwell
(sm_120) OpenMM falls back to JIT-compiling PTX, which works but adds
~30 seconds to first-launch and occasionally hits PTX→SASS bugs on
bleeding-edge drivers. Reliable mitigation: build OpenMM 8.2+ from
source against CUDA 12.6+ inside the pod image — same pattern as the
QuickVina-GPU `make` step. Pin the NVIDIA driver to a known-good 555+
build.

## 2. Force fields — Amber14SB + OpenFF-2.2 + TIP3P

- **Protein:** Amber ff14SB (Maier et al., JCTC 2015). Supersedes
  ff99SB-ILDN on backbone and side-chain dihedrals; every modern FEP
  benchmark uses 14SB or its descendants. Our ensemble code uses
  ff99SB-ILDN today, which was fine for a 250 ps minimization-plus-
  snapshot run but is the wrong default for a 5 ns production
  trajectory.
- **Ligand:** OpenFF Sage 2.2.x. Outperforms GAFF2 on the Wang JACS-22
  set by ~0.2 kcal/mol RMSE on average and has a far less fragile
  parameterization pipeline (`Molecule.from_smiles` →
  `ForceField('openff-2.2.0.offxml')` → `Interchange`).
- **Water:** TIP3P despite OPC being technically superior — TIP3P is
  what every published RBFE benchmark used.
- **Salt:** 0.15 M NaCl plus neutralizing counterions.

GAFF2 stays as a fallback toggle for ligands outside OpenFF's training
distribution (uncommon halogens, hypervalent S, phosphate-mimics).

## 3. Perturbation graph — LOMAP + radial+MST

Build the graph with **LOMAP** (Liu et al., JCAMD 2013; openfe ships
the modern reimplementation under `openfe.setup.LomapAtomMapper`).
LOMAP scores each candidate edge by a maximum common substructure
(MCS) score and a chemical-similarity score, then prunes low-score
edges.

For ≤10 analogs against one hit, use a **radial (star) topology with
the hit at the center, plus the Kruskal MST as a secondary backbone**.
Pure star is simple but relies on every edge from the hit converging;
adding the MST costs ~10 extra edges for 10 analogs and provides
cycles for cycle-closure error analysis. Spider (every pair) is
overkill for 10 ligands.

API: default to automatic (user picks the hit, system runs LOMAP).
Accept `manual_edges: list[tuple[str, str]]` for advanced users.
Validate manual edges with the LOMAP scorer; warn (don't block) if
score < 0.4.

## 4. Alchemical sampling — 12 windows, HREX, 5 ns/window

Honest minimum: **Hamiltonian Replica Exchange (HREX) across 12 lambda
windows for 5 ns each, in both complex and solvent legs, with the
first 1 ns discarded as equilibration**.

- Per edge: ~8–12 GPU-hours wall on Blackwell.
- Per edge with 11 windows × 2.5 ns (1–4 hour budget): noisier
  (~0.5 kcal/mol statistical), must be flagged in UI.
- Temperature: 298.15 K. PME 1.0 nm, switched LJ 1.0 nm.
- Hydrogen mass repartitioning to 3 amu, 4 fs timestep — yields
  300+ ns/day on Blackwell.

`n_lambda_windows` configurable; default 12. Larger perturbations
(heavy-atom inserts, ring opens) need 16–20. Methyl/halogen scans
work with 8.

## 5. Convergence + honest error reporting

Analyze with **MBAR** (`pymbar 4.x`). MBAR uses all overlap
information; BAR is the same statistic restricted to pairwise. Drop
correlated samples with `pymbar.timeseries`.

Report:
- **Statistical error** — MBAR bootstrap (200 resamples, 95% CI
  half-width).
- **Forward/reverse hysteresis** — MBAR on first half vs second half
  of production. If `|ΔG_fwd − ΔG_rev| > 1.0 kcal/mol`, flag the edge
  as not converged.
- **Cycle-closure RMSD** — sum of ΔΔG around each closed cycle should
  be 0; residual is the model-quality signal.

UI fail flags, in order of severity (tightened per Phase B audit
2026-05-15, `docs/fep_plus_phase_b_audit.md` item 2 — the prior
1.0/1.0/1.5 thresholds would have passed garbage results unflagged):

1. `NOT_CONVERGED` — hysteresis > **0.5** kcal/mol on any edge in
   the path. Render ΔΔG as `—`.
2. `HIGH_UNCERTAINTY` — MBAR 95% CI half-width > **0.4** kcal/mol.
   Render muted with prominent error bar.
3. `CYCLE_CLOSURE_FAIL` — any cycle closure > **1.0** kcal/mol.
   Banner on the study saying the force field may be misbehaving.

Reference: Mey et al. 2020, *Living Journal of Computational Molecular
Science*, "Best Practices for Alchemical Free Energy Calculations".

## 6. Pod scheduling — second pod, tier-tagged queue

Provision a second RunPod with a dedicated `liganx-fep-pod` image
(same dock_pod base + OpenMM-from-source + openfe pip layer + new
`fep_server.py` on a separate port). Don't time-slice a single GPU
between 5 s Vina cells and 8-hour FEP runs.

Backend gets two `runpod_client` configs: `POD_DOCK_URL` (existing) and
`POD_FEP_URL` (new). Celery routes — FEP jobs to a `fep` queue, Vina
to default. Separate worker pools.

Cost: Blackwell pod ~$0.70–1.20/hr. A 10-analog star = 10 edges × 10
GPU-hours = ~$100. Build a hard quota
(`max_fep_gpu_hours_per_user_per_month`) into FepJob submission from
day one. Surface projected cost on the submit form. The economics
force the feature to be Pro-tier from launch.

Interim (no second pod yet): `fep_idle_only` flag the runner checks —
FEP runs only when dock-pod queue is idle for >2 minutes.

## 7. Data model — three new tables

```python
class FepJobStatus(str, Enum):
    PENDING = "pending"
    PREPARING = "preparing"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class FepJob(SQLModel, table=True):
    __tablename__ = "fep_job"
    id: Optional[int] = Field(default=None, primary_key=True)
    share_id: str = Field(default_factory=_new_share_id, index=True, unique=True)
    created_at: datetime
    updated_at: datetime
    user_id: Optional[str]
    pdb_id: str = Field(index=True)
    chain: str = "A"
    variant: str = Field(index=True)
    parent_job_id: Optional[int] = Field(default=None, foreign_key="job.id", index=True)
    hit_compound_id: int = Field(foreign_key="compound.id", index=True)
    n_lambda_windows: int = 12
    ns_per_window: float = 5.0
    forcefield_protein: str = "amber14sb"
    forcefield_ligand: str = "openff-2.2.0"
    water_model: str = "tip3p"
    hrex: bool = True
    network_topology: str = "radial_plus_mst"
    status: FepJobStatus
    stage: Optional[str]
    error_message: Optional[str]
    cycle_closure_rmsd: Optional[float]
    title: Optional[str]
    tags: list[str]

class FepNode(SQLModel, table=True):
    __tablename__ = "fep_node"
    id: Optional[int] = Field(default=None, primary_key=True)
    fep_job_id: int = Field(foreign_key="fep_job.id", index=True)
    compound_id: int = Field(foreign_key="compound.id", index=True)
    is_hit: bool = False
    ddg_to_hit_kcal_mol: Optional[float]
    ddg_to_hit_uncertainty: Optional[float]
    convergence_flag: Optional[str]
    starting_pose_uri: Optional[str]

class FepPerturbation(SQLModel, table=True):
    __tablename__ = "fep_perturbation"
    id: Optional[int] = Field(default=None, primary_key=True)
    fep_job_id: int = Field(foreign_key="fep_job.id", index=True)
    node_a_id: int = Field(foreign_key="fep_node.id", index=True)
    node_b_id: int = Field(foreign_key="fep_node.id", index=True)
    lomap_score: float
    ddg_complex_kcal_mol: Optional[float]
    ddg_solvent_kcal_mol: Optional[float]
    ddg_binding_kcal_mol: Optional[float]
    ddg_uncertainty: Optional[float]
    hysteresis_kcal_mol: Optional[float]
    status: str
    mbar_diagnostics_json: Optional[str]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    pod_log_tail: Optional[str]
```

Migration: `017_fep_tables.sql`. The startup-migration runner in
`main.py` picks it up automatically.

## 8. API shape

```
POST   /fep/studies                  → create + dispatch
GET    /fep/studies/{share_id}       → poll status
GET    /fep/studies/{share_id}/graph → full graph + results
POST   /fep/studies/{share_id}/cancel
```

POST `/fep/studies` body:
```json
{
  "pdb_id": "1M17",
  "chain": "A",
  "variant": "T790M",
  "parent_job_share_id": "VXrA3kF9zY1",
  "hit_smiles": "COc1cc...",
  "hit_name": "Osimertinib",
  "analog_smiles": [
    {"name": "OSI-002", "smiles": "..."},
    {"name": "OSI-003", "smiles": "..."}
  ],
  "n_lambda_windows": 12,
  "ns_per_window": 5.0,
  "network_topology": "radial_plus_mst",
  "manual_edges": null
}
```

GET `/fep/studies/{share_id}/graph` response shape:
```json
{
  "share_id": "...",
  "status": "running",
  "stage": "edge_7_of_11_running",
  "cycle_closure_rmsd": 0.42,
  "nodes": [
    {"compound_id": 42, "name": "Osimertinib", "is_hit": true,
     "ddg_to_hit_kcal_mol": 0.0, "ddg_to_hit_uncertainty": 0.0,
     "convergence_flag": "ok"},
    {"compound_id": 43, "name": "OSI-002",
     "ddg_to_hit_kcal_mol": -0.8, "ddg_to_hit_uncertainty": 0.3,
     "convergence_flag": "ok"}
  ],
  "edges": [
    {"from": 42, "to": 43, "lomap_score": 0.87,
     "ddg_binding_kcal_mol": -0.8, "ddg_uncertainty": 0.3,
     "hysteresis_kcal_mol": 0.18, "status": "ok"}
  ]
}
```

## 9. UI surface

**Primary view — ranked analog table:** name, SMILES preview, ΔΔG to
hit (kcal/mol, color-coded the same way `SelectivityMatrix.tsx` colors
Δ-scores), 95% CI bar, convergence chip (green/yellow/red). Hit is row
zero with ΔΔG = 0.0. CSV export.

**Secondary view — graph visualization:** force-directed via
`react-force-graph-2d` or a 200-line custom SVG component. Nodes are
ligands with the hit highlighted; edges show LOMAP score as thickness
and ΔΔG as label. This is "the chemist drilling into why ligand X
looks weak — is it because the only edge into it was a low-LOMAP
edge?".

Above the fold: study-level cycle-closure RMSD with a tooltip
explaining good (<0.5 kcal/mol) vs bad (>1.5) values. Don't bury
convergence diagnostics behind a "details" toggle.

**Entry point:** "Promote to FEP" button on `JobPage.tsx` next to
"Optimize" — populates `parent_job_id`, pre-fills the hit, lets the
user paste 1–10 analog SMILES.

## 10. Timeline — six weeks to first production EGFR-T790M FEP

- **Week 1 (this session — scaffold).** DB migration
  `017_fep_tables.sql`. SQLModel classes. Empty `routers/fep.py` with
  three endpoints returning 501 stubs but with full request/response
  schemas. Empty `services/fep_runner.py`. Empty
  `runpod/dock_pod/fep_pod.py`. New `services/runpod_fep_client.py`
  mirroring `runpod_client.py`. Frontend `FepStudyPage.tsx` and
  `NewFepStudyPage.tsx` skeletons. Feature flag `FEP_ENABLED=False`.
- **Week 2 (pod image + smoke test).** Build the FEP pod Dockerfile:
  CUDA 12.6, OpenMM 8.2 built from source for sm_120, openfe 1.x +
  openmmtools + pymbar pinned. Implement `/fep_edge` endpoint on the
  pod. Smoke test against a published EGFR-T790M edge from Wang et al.
  JACS-22 — verify ΔΔG within 0.5 kcal/mol.
- **Week 3 (orchestration).** `services/fep_runner.py`: LOMAP graph
  generation, edge dispatch loop, MBAR aggregation, cycle-closure
  analysis. Celery `fep` queue. End-to-end on a 3-analog star.
- **Week 4 (UI + convergence reporting).** `FepStudyPage.tsx` ranked
  table + graph + convergence chips + CSV. `NewFepStudyPage.tsx`.
  "Promote to FEP" button.
- **Week 5 (production hardening).** Quota enforcement, cancellation
  cleanup, error taxonomy, Sentry breadcrumbs, runbook.
- **Week 6 (gated launch).** Flip `FEP_ENABLED` for Pro users only.
  First real study: osimertinib + 8 published EGFR-T790M analogs from
  Cross et al. 2014 / Jia et al. 2016. Compare ΔΔG predictions against
  published IC50s; publish on the Liganx blog.

## 11. Risks + unknowns

**Ligand parameterization will bite first.** OpenFF Sage 2.2 covers
~99% of FDA-approved drug-like atoms, but pasted SMILES will routinely
fall outside that envelope — boronic acids, unusual sulfur oxidation
states, hypervalent phosphorus, DEL-derived rings. Failure mode is
silent: parameterization succeeds, simulation runs, answer is wrong by
5 kcal/mol. Mitigation: emit `parameterization_warnings` per node
(atom-types-with-low-confidence count); require manual review in the
UI before showing predictions for any compound where the count is
non-zero. Fail closed.

**Slow convergence on flexible binders.** Type-II (DFG-out) kinase
inhibitors open and close the back pocket on µs timescales — 5 ns
won't sample that. For the EGFR-T790M / osimertinib initial use case
this is fine (type-I, ATP-pocket); it will be a problem for ABL
imatinib analogs (type-II). Detect type-II by binding-pose geometry at
study setup time and warn the user. Long-term: REST2 enhanced
sampling, but not in v1.

**Force-field bias on KRAS-class pockets.** Switch II hops on G12C
inhibitors, covalent-warhead chemistry, shallow allosteric pocket —
none of this is well-represented in the OpenFF training set.
Schrödinger FEP+ struggles here too; this is a field-wide problem.
Document the limitation in the Mutation Docking Guide.

**GPU memory on Blackwell with HREX.** 12 replicas × 60K-atom kinase
complex = ~6–8 GB per leg; two legs simultaneously = 12–16 GB.
Blackwell-class 24 GB is fine for kinase systems but tight; GPCRs
(~160K atoms with lipid bilayer) would OOM. Run legs sequentially in
v1.

**Numerical reproducibility across pod restarts.** OpenMM
mixed-precision + HREX has non-deterministic FP reductions; two runs
of the same edge will differ by 0.1–0.3 kcal/mol. Bake "FEP results
are stochastic, MBAR error bars are the truth" into UI copy.

**Atom-mapping pathologies.** LOMAP occasionally produces atom maps
that break alchemical decoupling (e.g., mapping a charged group across
a chirality center). Openfe's `RelativeHybridTopologyProtocol`
validates these and refuses; user-visible error is cryptic. Catch the
validation exception in the runner and fall back to
`KartografAtomMapper`; only fail the edge if both mappers refuse.

**Implicit dependency drift.** openfe, openmmtools, pymbar,
openff-toolkit, rdkit pins all need to agree on numpy and a compatible
OpenMM ABI. Dependency graph is fragile; lock every pin in the FEP
pod Dockerfile and never `pip install -U` anything inside it.
