"""Pydantic schemas for the public API. Kept separate from DB models."""

import re
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from .models import JobStatus


# Standard 4-char RCSB PDB ID (e.g. "2RGP") OR a user-uploaded structure
# tagged "USR_xxxxxxxx" (8 hex chars from POST /upload/pdb). Both forms get
# stored as the job's pdb_id in the DB; the runner branches on the prefix to
# decide whether to fetch from RCSB or read the upload from disk.
PDB_ID_RE = re.compile(r"^([A-Za-z0-9]{4}|USR_[0-9a-f]{8})$")
# Mutations: T790M, L858R, G12C, T790M+C797S, E746_A750del, V559insT
MUTATION_RE = re.compile(r"^[A-Z][0-9]+[A-Z]([+_][A-Za-z0-9]+)*(del|ins[A-Z]+)?$")
# Chain ID: usually a single letter, sometimes two.
CHAIN_RE = re.compile(r"^[A-Za-z0-9]{1,2}$")


class CompoundIn(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    smiles: str = Field(..., min_length=1, max_length=2000)


class JobCreate(BaseModel):
    pdb_id: str = Field(..., min_length=4, max_length=12)
    chain: str = "A"
    uniprot_id: str | None = Field(default=None, max_length=20)
    # Empty list = WT only. Free-tier cap: max 5 mutations per submit.
    # Frontend hard-blocks adding past 5 and shows a popup; this is the
    # server-side guard so direct API callers (curl, scripts) can't exceed
    # it either.
    mutations: list[str] = Field(default_factory=list, max_length=5)
    # Per-submission cap. 2026-05-11: bumped 5 → 50 to make room for the
    # CSV/SDF library-upload UI that's landing next in the frontend. The
    # 4090 cutover gives us enough headroom that 50 compounds × 2 variants
    # = 100 cells fits in a single Full Job's reasonable runtime budget
    # (~5-10 min at 1-3 s/dock). Library-scale screening (1000+) lives
    # in the separate /screening endpoint, capped at 1000 there.
    compounds: list[CompoundIn] = Field(..., min_length=1, max_length=50)
    # Search depth — Vina-style: 8 fast / 16 balanced / 32 thorough. We cap at
    # 64 because anything higher gives diminishing returns and risks tying up
    # the GPU. Anything below 4 is useless.
    exhaustiveness: int = Field(default=8, ge=4, le=64)
    # Whether to also dock against wild-type. Default True (most users want a
    # baseline for Δ); set False to skip WT and just dock the listed mutants.
    include_wt: bool = True
    # Docking engine choice. Three options:
    #   "quickvina2_gpu" — default; QuickVina2-GPU on the Pod, physics-empirical.
    #   "gnina"          — Vina-fork with CNN pose rescoring (Koes lab).
    #                      Gated by GNINA_ENABLED + pod_dock_url; falls back to
    #                      quickvina2_gpu if either is missing (logged).
    #   "boltz2"         — ML pose+affinity prediction model from MIT (#104).
    #                      Gated by BOLTZ2_ENABLED + pod_dock_url. Unlike GNINA,
    #                      a Boltz-2 request is REJECTED (not silently
    #                      downgraded) when the engine isn't enabled — its
    #                      methodology is so different from Vina that a silent
    #                      fallback would mislead the user about what produced
    #                      their score.
    # Free-form string keeps room for autodock_gpu / vanilla vina without
    # another schema migration.
    engine: str = Field(default="quickvina2_gpu", max_length=32)
    # Optional user-provided title for the History page. Defaults to a
    # synthesized label ("EGFR · 3 compounds · T790M") when null.
    title: str | None = Field(default=None, max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=10)

    # Server-side validators mirror the frontend regex. Catches anyone
    # bypassing the form (curl, postman, malicious actors), and keeps the
    # filesystem paths we build from these values constrained to a known shape.
    @field_validator("pdb_id")
    @classmethod
    def _v_pdb(cls, v: str) -> str:
        if not PDB_ID_RE.match(v):
            raise ValueError("pdb_id must be 4 alphanumeric chars or USR_<8 hex>")
        # User-uploaded IDs carry a "USR_" prefix (case-significant) — only
        # standard RCSB IDs get upper-cased to match RCSB's canonical casing.
        return v if v.startswith("USR_") else v.upper()

    @field_validator("chain")
    @classmethod
    def _v_chain(cls, v: str) -> str:
        if not CHAIN_RE.match(v):
            raise ValueError("chain must be 1-2 alphanumeric characters")
        return v.upper()

    @field_validator("mutations")
    @classmethod
    def _v_mutations(cls, v: list[str]) -> list[str]:
        bad = [m for m in v if not MUTATION_RE.match(m)]
        if bad:
            raise ValueError(f"invalid mutation code(s): {', '.join(bad[:3])}")
        return v


class CompoundOut(BaseModel):
    id: int
    name: str | None
    smiles: str
    # ADMET / drug-likeness descriptors. Computed from SMILES via RDKit on
    # job fetch (cached by SMILES). None if RDKit isn't available or if the
    # SMILES failed to parse — frontend renders an em-dash in that case.
    # Schema is intentionally loose (dict[str, Any]) so we can grow the
    # descriptor set without forcing schema bumps; see admet.compute_admet
    # for the current shape.
    admet: dict | None = None


class DockingResultOut(BaseModel):
    compound_id: int
    variant: str
    best_score: float
    pose_uri: str | None = None
    extra: str | None = None


class JobOut(BaseModel):
    id: int
    # share_id is what the frontend uses in URLs — unguessable, URL-safe.
    # Integer `id` is kept for back-compat with the few existing direct links
    # but new jobs are addressed by share_id everywhere user-facing.
    share_id: str
    pdb_id: str
    chain: str
    uniprot_id: str | None
    mutations: list[str]
    status: JobStatus
    error_message: str | None
    # Live-updated stage slug the runner writes as it advances through
    # pre-flight + docking phases (fetching_pdb / cleaning_pdb /
    # building_mutant_T315I / docking_3_of_8 / validating_poses, etc.).
    # The frontend's progress banner renders a friendly label from
    # this slug instead of guessing the active stage from elapsed
    # time. NULL when the job hasn't started or has terminated.
    stage: str | None = None
    created_at: datetime
    updated_at: datetime
    # Echo the docking knobs so the UI can label the matrix accurately
    # ("ran with Thorough exhaustiveness", "WT skipped"). Defaults match the
    # legacy behaviour for jobs created before these fields existed.
    exhaustiveness: int = 8
    include_wt: bool = True
    # Echo the engine the job was submitted with so the matrix UI can label
    # which engine produced these scores. None on legacy rows = quickvina2_gpu.
    engine: str | None = "quickvina2_gpu"
    # Owner — UUID of auth.users(id). Null for anonymous legacy jobs (none
    # remain after the wipe, but kept nullable so account deletion sets to
    # NULL rather than cascading the data away). The frontend uses this to
    # decide whether to render the Cancel + Edit Title buttons.
    user_id: str | None = None
    title: str | None = None
    tags: list[str] = Field(default_factory=list)
    compounds: list[CompoundOut] = Field(default_factory=list)
    results: list[DockingResultOut] = Field(default_factory=list)
    # Cross-docking sanity-check result for this (pdb_id, chain). When
    # present, the frontend renders a "PDB quality · RMSD X Å" badge in
    # the JobPage header. None means we haven't run / cached the check
    # yet (catalog targets eventually get pre-baked; custom uploads run
    # lazily in a background thread on first job submission).
    # Shape: see deltadock_pipeline.crossdock.CrossDockResult — fields:
    #   ligand_resname, rmsd_angstroms, verdict (valid|uncertain|questionable),
    #   smiles, crystal_atom_count, docked_atom_count
    pdb_quality: dict | None = None


class JobUpdate(BaseModel):
    """Owner-side patch for fields the user can edit after creation.

    Currently scoped to title + tags — the only mutable, user-meaningful
    fields. Everything else (target, mutations, compounds, results) is
    immutable post-submit so the displayed data always matches what was
    actually run. Both fields are optional; omitting one leaves it
    unchanged. Empty list / None / empty string are treated as "clear".
    """
    # Mirror the JobCreate cap (200 chars). None = leave alone, "" = clear
    # back to the synthesized default title.
    title: str | None = Field(default=None, max_length=200)
    # Same cap as JobCreate (10 tags max). None = leave alone, [] = clear.
    # Each tag is bounded to 32 chars to keep the column tidy and to deter
    # anyone storing JSON blobs in here.
    tags: list[str] | None = Field(default=None, max_length=10)

    @field_validator("tags")
    @classmethod
    def _trim_and_bound_tags(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        out: list[str] = []
        seen: set[str] = set()
        for t in v:
            t2 = (t or "").strip()
            if not t2:
                continue
            if len(t2) > 32:
                raise ValueError(f"tag '{t2[:32]}…' exceeds 32 chars")
            # Dedupe case-insensitively while preserving the user's chosen
            # casing on first occurrence.
            key = t2.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(t2)
        return out


class HealthOut(BaseModel):
    status: str = "ok"
    version: str
    env: str


# -----------------------------------------------------------------------------
# Screening (virtual screening at library scale) — Tier 3 #2 / Mutation-aware
# library screening. Submit shape diverges from JobCreate in three ways:
#   1. compounds list is uncapped here at the schema level (router caps at
#      1000 per submission — the value of the feature is HUNDREDS of compounds,
#      not 5; the 1000 ceiling keeps any single screening inside ~30-60 min
#      of pod time on a 4090).
#   2. mutations capped at 1 entry. We want clean Δ-vs-WT semantics; multi-
#      mutation makes the ranking math ambiguous (which Δ do we sort by?).
#      Multi-variant screening is a future capability.
#   3. exhaustiveness defaults to 4 (vs 8 for /jobs). Screening is about
#      RANKING — re-dock the top survivors at higher exhaustiveness in a
#      follow-up Job submission.
# -----------------------------------------------------------------------------


from .models import ScreeningStatus  # noqa: E402  (avoid top-level circular)


class ScreeningCreate(BaseModel):
    pdb_id: str = Field(..., min_length=4, max_length=12)
    chain: str = "A"
    uniprot_id: str | None = Field(default=None, max_length=20)
    # Empty list = WT-only screening (still useful — ranks affinity against
    # the wild-type target with no Δ column). 1-2 mutations = the canonical
    # mutation-aware library screen, with each mutant getting its own
    # ranked-row set in the results page. The frontend Studio dropdown
    # already allows up to 2 mutations; this schema mirrors that cap.
    # Higher caps later, once we know real screenings on the 4090 pod
    # don't drag too long with M variants × N compounds.
    mutations: list[str] = Field(default_factory=list, max_length=2)
    # Library compounds. Router applies the 1000-cap after validation; the
    # schema upper-bound here is a defensive 2000 so a typo doesn't OOM
    # the validator. Pre-loaded libraries (Enamine REAL subset, ChEMBL
    # approved, etc.) get expanded to a CompoundIn list before this schema
    # is hit — they're not a server-side magic value.
    compounds: list[CompoundIn] = Field(..., min_length=1, max_length=2000)
    # Lower default than JobCreate.exhaustiveness. Screening cares about
    # the ranking, not absolute scores. Re-dock the top 20-50 survivors
    # at higher exhaustiveness via the existing /jobs flow.
    exhaustiveness: int = Field(default=4, ge=4, le=16)
    engine: str = Field(default="quickvina2_gpu", max_length=32)
    title: str | None = Field(default=None, max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=10)

    # Same validators as JobCreate — same regex rules apply.
    @field_validator("pdb_id")
    @classmethod
    def _v_pdb(cls, v: str) -> str:
        if not PDB_ID_RE.match(v):
            raise ValueError("pdb_id must be 4 alphanumeric chars or USR_<8 hex>")
        return v if v.startswith("USR_") else v.upper()

    @field_validator("chain")
    @classmethod
    def _v_chain(cls, v: str) -> str:
        if not CHAIN_RE.match(v):
            raise ValueError("chain must be 1-2 alphanumeric characters")
        return v.upper()

    @field_validator("mutations")
    @classmethod
    def _v_mutations(cls, v: list[str]) -> list[str]:
        bad = [m for m in v if not MUTATION_RE.match(m)]
        if bad:
            raise ValueError(f"invalid mutation code(s): {', '.join(bad[:3])}")
        return v


class ScreeningResultOut(BaseModel):
    """One row of a screening run.

    Lean shape — the results page renders hundreds of these in a sortable
    table, so we keep the per-row payload tight. Pose blob + full ADMET
    are loaded on demand when the user expands / opens a row.
    """
    compound_id: int
    compound_name: str | None
    compound_smiles: str
    variant: str  # "WT" or the mutation code
    best_score: float | None  # kcal/mol, lower = stronger binding
    status: str  # ok | pending | failed | skipped
    error_message: str | None = None
    # Selectivity components — computed by services/screening_runner when
    # both a mutant and WT row exist for the same compound. wt_score and
    # delta_score are denormalized here so the results page can sort by
    # selectivity without a self-join.
    wt_score: float | None = None
    delta_score: float | None = None  # mutant_score - wt_score
    selectivity_index: float | None = None  # higher = more selective
    # ADMET tier flags (low / medium / high). Rendered as the same chip
    # set the JobPage uses, so users have a consistent visual.
    admet: dict | None = None


class ScreeningOut(BaseModel):
    """Top-level screening job envelope. The results page polls this
    every 3-5 s while pending/running; once completed it stops polling."""
    id: int
    share_id: str
    pdb_id: str
    chain: str
    uniprot_id: str | None = None
    mutations: list[str]
    engine: str
    exhaustiveness: int
    n_total: int
    n_completed: int
    n_failed: int
    status: ScreeningStatus
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    user_id: str | None = None
    title: str | None = None
    tags: list[str] = Field(default_factory=list)
    # Results sorted server-side by selectivity_index DESC, then by
    # best_score ASC. Pagination via query params on the GET endpoint
    # for very large screens (>500 hits).
    results: list[ScreeningResultOut] = Field(default_factory=list)
