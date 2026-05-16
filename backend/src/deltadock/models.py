"""Database models for jobs, compounds, and results."""

import secrets
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import Column, String
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlmodel import Field, Relationship, SQLModel


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    # User-initiated cancellation. The runner cooperatively checks this
    # between cells and bails when set. The currently in-flight Pod GPU
    # call (~3 s) completes; no further cells dispatch.
    CANCELLED = "cancelled"


def _new_share_id() -> str:
    """Random URL-safe token used as the public job ID.

    11 characters from the base64url alphabet (a-zA-Z0-9_-) — about 65 bits of
    entropy, enough that guessing is computationally infeasible. Short enough
    that links stay copy-pasteable (`/jobs/VXrA3kF9zY1`).
    """
    return secrets.token_urlsafe(8)


class Job(SQLModel, table=True):
    """A docking job: dock a list of compounds against WT and a set of mutants."""

    id: Optional[int] = Field(default=None, primary_key=True)
    # share_id is the PUBLIC, unguessable identifier for a job — used in every
    # /jobs/{...} URL the frontend or share links exposes. The integer `id`
    # stays for internal foreign-key relationships (Compound.job_id, etc.) so
    # we don't have to reshape the relational graph. Existing integer URLs
    # still resolve via a backward-compat lookup in routers/jobs.py.
    share_id: str = Field(
        default_factory=_new_share_id,
        index=True,
        unique=True,
        max_length=32,
    )
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # Target
    uniprot_id: Optional[str] = Field(default=None, index=True)
    pdb_id: str = Field(index=True)
    chain: str = "A"

    # Mutations: comma-separated list of e.g. "T790M,L858R" — empty = WT only
    mutations: str = ""

    # Search depth for the docking engine. Vina-style "exhaustiveness" maps
    # roughly to: 8 = fast (~3 s/cell GPU), 16 = balanced, 32 = thorough.
    # Higher = more reliable convergence on the global minimum at the cost of
    # GPU time. Default 8 matches Vina's default and is good enough for most
    # screening; bump to 16 or 32 when pose quality matters.
    exhaustiveness: int = Field(default=8)

    # Whether to dock against wild-type as well. Default True — users almost
    # always want a WT baseline to compute Δ. Set False when the user only
    # cares about absolute mutant binding.
    include_wt: bool = Field(default=True)

    # Which docking engine to use for this job. Free-form string keeps the
    # column forward-compatible with engines we haven't shipped yet
    # (autodock_gpu, vanilla vina, etc.). Current values:
    #   "quickvina2_gpu"  — DEFAULT. Pod-hosted Vina derivative on NVIDIA GPU.
    #                       Best balance of speed + Vina-family compatibility.
    #   "gnina"           — Vina fork with CNN-based pose rescoring (Koes lab,
    #                       trained on PDBbind). Slower per cell (~2-3x) but
    #                       genuinely different ranking signal. Behind the
    #                       GNINA_ENABLED Fly secret until the Pod-side
    #                       /dock_gnina endpoint is installed.
    # The runner reads this field to dispatch to the right Pod endpoint;
    # falling through to the QuickVina engine is the safe default if the
    # value is unknown. NULL on legacy rows ⇒ treated as quickvina2_gpu.
    engine: Optional[str] = Field(default="quickvina2_gpu", index=True)

    # Opt-in "ensemble docking". When True, the runner docks each ligand
    # against several short-MD-relaxed receptor conformers (generated on the
    # GPU Pod's /relax_ensemble endpoint) instead of a single rigid crystal
    # snapshot, and keeps the best score + pose per cell. This retires the
    # "single-conformation docking can't see protein flexibility" caveat.
    #
    # Full Jobs only — NEVER set by the Quick Dock path (keeps the editor's
    # fast path instant). Default False so every existing code path and
    # every legacy row is byte-for-byte unchanged: when this is False the
    # runner's docking path is exactly what it is today. The per-cell
    # score spread across conformers is recorded pipe-delimited in
    # DockingResult.extra (ens=... segment), not a dedicated column —
    # matches how vinardo/water/strain extras are carried.
    #
    # Added by migration 015_job_ensemble.sql. NULL on rows that predate
    # the migration ⇒ treated as False by the runner's getattr fallback.
    ensemble: bool = Field(default=False)

    # Status
    status: JobStatus = Field(default=JobStatus.PENDING, index=True)
    error_message: Optional[str] = None

    # Live-updated stage slug the runner writes via services.runner.set_stage
    # as it advances through pre-flight + docking phases ("fetching_pdb",
    # "preparing_receptor", "docking_3_of_8", "validating_poses", …). The
    # JobPage progress banner renders a friendly label from it; NULL is the
    # rest state (PENDING / terminal). Added by migration 004_job_stage.sql,
    # which is now wired into the unconditional startup-migration runner
    # (main._STARTUP_MIGRATIONS) and guarded by _verify_schema_matches_models,
    # so this field can no longer drift ahead of the column.
    stage: Optional[str] = None

    # Owner — UUID referencing auth.users(id) in Supabase. Nullable so legacy
    # rows survive an account deletion (FK is ON DELETE SET NULL). The runner
    # never reads this field; it's used by the API layer to scope GET /jobs
    # (list) to the requesting user and to authorize POST /jobs/{key}/cancel.
    # Public share-link GETs intentionally don't filter on user_id.
    user_id: Optional[str] = Field(
        default=None,
        sa_column=Column(UUID(as_uuid=False), index=True, nullable=True),
    )

    # Optional human title — "EGFR resistance scan", "ABL kinome panel". Used
    # in the History page for search + display. Null = render the auto title
    # ("EGFR · 4 compounds · T790M+C797S").
    title: Optional[str] = None

    # Free-form tags for grouping in History — ["egfr-project", "draft"].
    # Stored as Postgres TEXT[] so we can index/filter efficiently if it
    # becomes a power-user feature.
    tags: list[str] = Field(
        default_factory=list,
        sa_column=Column(ARRAY(String()), nullable=False, server_default="{}"),
    )

    compounds: list["Compound"] = Relationship(back_populates="job")
    results: list["DockingResult"] = Relationship(back_populates="job")


class Compound(SQLModel, table=True):
    """One ligand to dock — provided as SMILES, optionally with a friendly name.

    job_id is OPTIONAL (Optional[int]) because the Compound table is shared
    between Job (where every compound has a parent job_id) and Screening
    (where compounds are referenced via ScreeningResult.compound_id but have
    no parent Job). Made nullable in migration 013 — without it the
    screening submission code path crashed with NotNullViolation."""

    id: Optional[int] = Field(default=None, primary_key=True)
    job_id: Optional[int] = Field(default=None, foreign_key="job.id", index=True)

    name: Optional[str] = None
    smiles: str

    job: Optional[Job] = Relationship(back_populates="compounds")


class DockingResult(SQLModel, table=True):
    """One docking score: (job, compound, variant) → score in kcal/mol."""

    id: Optional[int] = Field(default=None, primary_key=True)
    job_id: int = Field(foreign_key="job.id", index=True)
    compound_id: int = Field(foreign_key="compound.id", index=True)

    # "WT" or a mutation string like "T790M"
    variant: str = Field(index=True)

    # Best Vina score across poses, kcal/mol (lower = stronger binding)
    best_score: float

    # Path/key into object storage for the pose file (PDBQT). Null in Phase 1 if local.
    pose_uri: Optional[str] = None

    # Free-form metadata: rmsd, num_poses, engine version, etc.
    extra: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)

    job: Optional[Job] = Relationship(back_populates="results")


class OptimizeAttempt(SQLModel, table=True):
    """Durable per-call log of /assist/optimize.

    Every Optimize click, success or failure, writes one row here. The
    Fly free log buffer rolls over too fast to debug "Optimize failed
    earlier today" reports, so we persist the request shape, the
    outcome, and the elapsed time in Postgres instead. See
    migrations/010_optimize_attempt.sql for the column rationale and
    status taxonomy.

    Volume is bounded by the /assist rate limit (30/hr/IP) plus the
    QUICK_DOCK_ENABLED feature flag, so growth is manageable in v1
    without a TTL job.
    """

    __tablename__ = "optimize_attempt"

    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)

    # Auth context. UUID nullable so anonymous fallbacks (if we ever
    # drop auth) still log; we capture both id + email for support
    # workflows ("which user hit this?").
    user_id: Optional[str] = Field(
        default=None,
        sa_column=Column(UUID(as_uuid=False), nullable=True, index=True),
    )
    user_email: Optional[str] = None

    # Request shape — what the user asked Optimize to do.
    target_pdb: Optional[str] = None
    mutations: Optional[str] = None
    parent_smiles: str
    parent_score: Optional[float] = None

    # Outcome. status is one of:
    #   "ok" | "no_variants" | "anthropic_error" | "pod_error"
    #   | "timeout" | "unknown_error"
    status: str = Field(index=True)
    elapsed_ms: int

    # Diagnostic counts — populated when the loop got far enough.
    n_raw_variants: Optional[int] = None
    n_unique_variants: Optional[int] = None
    n_survivors_sa: Optional[int] = None
    n_docked: Optional[int] = None
    n_returned: Optional[int] = None

    # Truncated to 2000 chars on insert to bound row size.
    error_message: Optional[str] = None

    # Same UUID written to the start-of-attempt log line so a row in
    # this table can be cross-referenced with Fly logs (while they're
    # still in the buffer).
    request_id: Optional[str] = Field(
        default=None,
        sa_column=Column(UUID(as_uuid=False), nullable=True),
    )


# -----------------------------------------------------------------------------
# Virtual screening (added 2026-05-11) — dock ≤1K compounds from a SMILES list
# against one target. Differentiates Liganx from single-compound docking
# wrappers; Schrödinger's Glide-VS competitor at scale.
#
# Modelled as a separate table from Job (not a subtype) because:
#   - Job rows are ~6 docks (3 compounds × 2 variants); ScreeningJob rows
#     are ~1000 docks. Different concurrency + scheduling behaviour, will
#     diverge further as we add tiered exhaustiveness.
#   - History page treats them as different UX (one is a matrix, the
#     other is a ranked hit list with filters).
# Reuses Compound rows by FK — the same SMILES that's been docked before
# gets cached/deduped at insert time (see services/screening.py when it
# lands next session).
# -----------------------------------------------------------------------------


class ScreeningStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ScreeningJob(SQLModel, table=True):
    """A virtual screening run: rank N compounds against one (target, mutations) tuple.

    Unlike Job, which renders as a per-mutation matrix, this renders as a
    ranked hit list — best score first, with ADMET chips inline. Capped at
    1000 compounds per submission to stay inside a single pod's reasonable
    runtime (~30-60 min at 1-3 s/dock on the GPU).
    """

    __tablename__ = "screening_job"

    id: Optional[int] = Field(default=None, primary_key=True)
    share_id: str = Field(
        default_factory=_new_share_id,
        index=True,
        unique=True,
        max_length=32,
    )
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # Target — same shape as Job. We deliberately don't FK to a target
    # table because targets are referenced by string identifier (PDB id
    # or catalog id) throughout the codebase.
    pdb_id: str = Field(index=True)
    chain: str = "A"

    # Comma-separated mutations like Job.mutations. Empty = WT only.
    # Screening typically pins to ONE variant (the cancer mutation of
    # interest) — multi-variant screening would multiply the dock count
    # and is left as a future capability.
    mutations: str = ""

    # Same engine column convention as Job.
    engine: Optional[str] = Field(default="quickvina2_gpu", index=True)

    # Docking depth. Defaults lower than Job (4 vs 8) because the value
    # of screening is RANKING the top N, not getting absolute scores
    # right — re-dock survivors at higher exhaustiveness in a follow-up.
    exhaustiveness: int = Field(default=4)

    # Total compounds queued + running counters for the progress bar.
    n_total: int = Field(default=0)
    n_completed: int = Field(default=0)
    n_failed: int = Field(default=0)

    # User-supplied label so History shows e.g. "BTK BRENK-filtered DEL".
    title: Optional[str] = None
    tags: list[str] = Field(
        default_factory=list,
        sa_column=Column(ARRAY(String()), nullable=False, server_default="{}"),
    )

    status: ScreeningStatus = Field(default=ScreeningStatus.PENDING, index=True)
    error_message: Optional[str] = None

    user_id: Optional[str] = Field(
        default=None,
        sa_column=Column(UUID(as_uuid=False), index=True, nullable=True),
    )

    results: list["ScreeningResult"] = Relationship(back_populates="screening_job")


class ScreeningResult(SQLModel, table=True):
    """One docking score in a screening run.

    Separate from DockingResult because:
      - We don't want a million screening rows polluting the per-job
        DockingResult queries (variant matrix loads etc.).
      - Screening rows can be aged/archived independently — keep top
        1000 forever, age out the long tail after 30 days.
      - ADMET predictions cached here too so the results page is a
        single query, not a join.
    """

    __tablename__ = "screening_result"

    id: Optional[int] = Field(default=None, primary_key=True)
    screening_job_id: int = Field(foreign_key="screening_job.id", index=True)
    compound_id: int = Field(foreign_key="compound.id", index=True)

    # "WT" or single mutation string. ScreeningJob is pinned to one
    # variant at a time, but we store it per-row anyway for query
    # ergonomics.
    variant: str = Field(index=True)

    # Vina score (kcal/mol, lower = stronger binding). Indexed so the
    # results page can ORDER BY best_score LIMIT 100 cheaply.
    best_score: Optional[float] = Field(default=None, index=True)

    # Pose blob (R2 object URI when configured, local path otherwise).
    # Most screening rows will never have their pose viewed; only the
    # top ~20-50 will. Lazy-load.
    pose_uri: Optional[str] = None

    # ADMET prediction blob (JSON: hERG, DILI, BBB, CYP3A4, CYP2D6 +
    # raw probability). Cached at insert time from admet_ml. Null
    # means ADMET wasn't run for this row (RDKit parse failed).
    admet_extended_json: Optional[str] = None

    # Status of this specific cell:
    #   "ok" | "pending" | "failed" | "skipped"
    # skipped = compound parsed but never got docked (cancelled run).
    status: str = Field(default="pending", index=True)
    error_message: Optional[str] = None

    # ── #208: Δ-vs-WT ranking columns ──
    # The runner denormalizes these onto the MUTANT row after both the
    # mutant and WT cells for a given compound have completed. The WT
    # row's own copies remain NULL — only mutant rows carry a Δ. This
    # makes the results-page ORDER BY selectivity_index work without
    # any self-join.
    #
    # wt_score          The paired WT cell's best_score (kcal/mol).
    # delta_score       mutant_score - wt_score. NEGATIVE = mutant
    #                   binds tighter than WT (selectivity gain).
    # selectivity_index Composite ranking metric:
    #                     |mutant_score| * sigmoid(-Δ * 4)
    #                   See screening_runner._selectivity_index for
    #                   the full rationale. NULL when WT-only or the
    #                   paired WT hasn't docked yet.
    wt_score: Optional[float] = Field(default=None)
    delta_score: Optional[float] = Field(default=None)
    selectivity_index: Optional[float] = Field(default=None, index=True)

    # Pipe-delimited extras, same format as DockingResult.extra.
    # Carries outside_pocket_angstroms, vinardo, strain, etc. — anything
    # the runner / pod want to surface for the UI's parseExtra to
    # interpret. None when the cell has no metadata beyond best_score.
    extra: Optional[str] = Field(default=None)

    created_at: datetime = Field(default_factory=datetime.utcnow)

    screening_job: Optional[ScreeningJob] = Relationship(back_populates="results")


# -----------------------------------------------------------------------------
# Boltz-2 structure prediction (added 2026-05-11) — pod-hosted co-folding
# of protein + ligand. Wohlwend et al. 2025, MIT Jameel Clinic.
#
# A row per /predict_boltz2 call. The actual inference happens on the
# RunPod GPU (see runpod/BOLTZ2_INSTALL.md); this table records what was
# requested, the cached output (predicted_pdb_b64 + affinity), and
# timing for support workflows. ~5 GB model weights live on the pod's
# /workspace volume, NOT here.
# -----------------------------------------------------------------------------


class Boltz2Status(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class Boltz2Prediction(SQLModel, table=True):
    """One Boltz-2 prediction record. Persistent cache + audit trail."""

    __tablename__ = "boltz2_prediction"

    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)

    user_id: Optional[str] = Field(
        default=None,
        sa_column=Column(UUID(as_uuid=False), nullable=True, index=True),
    )

    # Request shape — deterministic input identifier so identical
    # requests dedupe via a hash index.
    receptor_sequence: str  # amino-acid string, can be long
    ligand_smiles: str
    chain_id: str = "A"
    use_msa: bool = False
    num_samples: int = 1

    # Hash of (receptor_sequence + ligand_smiles + chain_id + use_msa)
    # for cache lookups. Index so /predict_boltz2 can check
    # "have we computed this before?" in O(log n).
    request_hash: str = Field(index=True, max_length=64)

    # Output. predicted_pdb is the co-folded complex; affinity_pred_value
    # is Boltz-2's predicted binding affinity (~log Kd, lower = stronger);
    # affinity_probability_binary is the binder/non-binder probability.
    predicted_pdb_b64: Optional[str] = None  # gzipped or raw, fits in TEXT
    affinity_pred_value: Optional[float] = None
    affinity_probability_binary: Optional[float] = None

    status: Boltz2Status = Field(default=Boltz2Status.PENDING, index=True)
    error_message: Optional[str] = None
    elapsed_ms: Optional[int] = None


# ─────────────────────────── FEP+ tables (G4) ───────────────────────────
#
# Schema mirror of migration 018_fep_tables.sql. Three tables:
#   • fep_job: parent study (target + variant + hit + protocol knobs)
#   • fep_node: one ligand in the perturbation graph
#   • fep_perturbation: one A→B alchemical transformation edge
#
# See docs/fep_plus_design.md §7 for the design rationale.


class FepJobStatus(str, Enum):
    PENDING = "pending"
    PREPARING = "preparing"          # building graph, parameterising
    RUNNING = "running"              # at least one edge in flight
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class FepJob(SQLModel, table=True):
    """A FEP+ study — one (target, variant, hit, analog set) tuple."""

    __tablename__ = "fep_job"

    id: Optional[int] = Field(default=None, primary_key=True)
    share_id: str = Field(default_factory=_new_share_id, index=True, unique=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    user_id: Optional[str] = Field(
        default=None,
        sa_column=Column(UUID(as_uuid=False), nullable=True, index=True),
    )

    # Target identity (same shape as docking Job).
    pdb_id: str = Field(index=True, max_length=8)
    chain: str = Field(default="A", max_length=4)
    variant: str = Field(default="WT", index=True, max_length=120)

    # Optional FK to the parent docking job that produced the hit pose.
    parent_job_id: Optional[int] = Field(default=None, foreign_key="job.id", index=True)
    # Hit compound — graph centre. Reuses the existing Compound table.
    hit_compound_id: int = Field(foreign_key="compound.id", index=True)

    # Protocol knobs (defaults match the post-audit design doc).
    n_lambda_windows: int = 12
    # 7 ns/window = 2 ns equilibration discarded + 5 ns production.
    ns_per_window: float = 7.0
    forcefield_protein: str = Field(default="amber14sb", max_length=64)
    forcefield_ligand: str = Field(default="openff-2.2.0", max_length=64)
    water_model: str = Field(default="tip3p", max_length=64)
    hrex: bool = True
    network_topology: str = Field(default="radial_plus_mst", max_length=64)

    # State machine.
    status: FepJobStatus = Field(default=FepJobStatus.PENDING, index=True)
    stage: Optional[str] = Field(default=None, max_length=120)
    error_message: Optional[str] = None

    # Cycle-closure RMSD across the perturbation graph — populated
    # when status=completed.
    cycle_closure_rmsd: Optional[float] = None

    # (I3) Estimated dollar cost at submit time. Frozen — even if the
    # per-GPU-hour rate or the per-edge time changes later, this row
    # remembers what was projected when the user accepted the cost.
    # Aggregated for the per-user monthly cap (FEP_MAX_USD_PER_USER_PER_MONTH).
    estimated_usd_cost: float = 0.0

    title: Optional[str] = Field(default=None, max_length=240)
    # tags is TEXT[] in Postgres; SQLAlchemy ARRAY(String) for the model
    # type. FastAPI returns it as list[str].
    tags: list[str] = Field(
        default_factory=list,
        sa_column=Column(ARRAY(String), nullable=False, server_default="{}"),
    )


class FepNode(SQLModel, table=True):
    """One ligand in the perturbation graph (hit or analog)."""

    __tablename__ = "fep_node"

    id: Optional[int] = Field(default=None, primary_key=True)
    fep_job_id: int = Field(foreign_key="fep_job.id", index=True)
    compound_id: int = Field(foreign_key="compound.id", index=True)
    is_hit: bool = False

    # Aggregate result, populated when all edges into this node converge.
    ddg_to_hit_kcal_mol: Optional[float] = None
    ddg_to_hit_uncertainty: Optional[float] = None
    # "ok" | "high_uncertainty" | "not_converged" — drives the
    # convergence chip on the ranked analog table.
    convergence_flag: Optional[str] = Field(default=None, max_length=32)
    starting_pose_uri: Optional[str] = Field(default=None, max_length=512)


class FepPerturbation(SQLModel, table=True):
    """One alchemical edge: ligand A → ligand B."""

    __tablename__ = "fep_perturbation"

    id: Optional[int] = Field(default=None, primary_key=True)
    fep_job_id: int = Field(foreign_key="fep_job.id", index=True)
    node_a_id: int = Field(foreign_key="fep_node.id")
    node_b_id: int = Field(foreign_key="fep_node.id")
    lomap_score: float

    # Per-edge ΔΔG results (populated as the edge runs on the pod).
    ddg_complex_kcal_mol: Optional[float] = None
    ddg_solvent_kcal_mol: Optional[float] = None
    ddg_binding_kcal_mol: Optional[float] = None  # difference = ΔΔG_binding
    ddg_uncertainty: Optional[float] = None
    hysteresis_kcal_mol: Optional[float] = None   # |fwd − rev|

    # "pending" | "running" | "ok" | "failed" | "skipped".
    status: str = Field(default="pending", index=True, max_length=32)

    # MBAR diagnostics blob — overlap matrix, decorrelation times,
    # per-replica free energies. Rendered as a collapsible "diagnostics"
    # panel for power users.
    mbar_diagnostics_json: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    pod_log_tail: Optional[str] = None
