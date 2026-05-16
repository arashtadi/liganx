"""FEP+ router — Phase B scaffold.

Three endpoints stubbed per the design doc (docs/fep_plus_design.md §8):

  POST   /fep/studies                  → create + dispatch (501 until B)
  GET    /fep/studies/{share_id}       → poll status      (501 until B)
  GET    /fep/studies/{share_id}/graph → full graph       (501 until B)
  POST   /fep/studies/{share_id}/cancel                   (501 until B)

The router IS registered in main.py so the routes show up in the OpenAPI
spec — useful for frontend planning and for the design-review agent
that audits the API surface. Each endpoint returns HTTP 501 with a
clear message pointing at the design doc until the Phase B runner +
pod image are in place.

Request/response schemas are fully defined here (Pydantic models) even
though no business logic runs — so the frontend NewFepStudyPage.tsx
skeleton can compile against real types from /api.ts.
"""
from __future__ import annotations

import logging
import os
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from sqlmodel import Session

from ..auth import CurrentUser, current_user, fep_access_allowed
from ..db import get_session
from ..models import Compound, FepJob, FepJobStatus, FepNode, FepPerturbation, Job
from sqlmodel import select
from ..services.fep_runner import (
    FepNotImplementedError,
    aggregate_node_ddg,
    build_perturbation_graph,
    cancel_fep_study as _cancel_fep_study,
    get_fep_study_status,
    is_fep_enabled,
    run_study,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/fep", tags=["fep"])


# ─────────────────────── request/response schemas ───────────────────────


class FepAnalog(BaseModel):
    """One non-hit ligand in the perturbation graph."""
    name: Optional[str] = Field(default=None, max_length=120)
    smiles: str = Field(..., min_length=1, max_length=2000)


class FepManualEdge(BaseModel):
    """One manually-specified edge in the perturbation graph (per
    Phase B audit — typed model is clearer than list[tuple[str, str]]).

    `a` and `b` are 0-based indices into the [hit] + analog_smiles
    list: 0 = hit, 1 = first analog, etc."""
    a: int = Field(..., ge=0)
    b: int = Field(..., ge=0)


class FepStudyRequest(BaseModel):
    """Start a relative-FEP study. See design doc §8 for the exact
    fields; mirrored here so the frontend has typed access to the
    schema before the runner is implemented."""
    pdb_id: str = Field(..., min_length=4, max_length=8)
    chain: str = Field(default="A", max_length=4)
    variant: str = Field(default="WT", max_length=120)
    parent_job_share_id: Optional[str] = Field(default=None, max_length=64)
    hit_smiles: str = Field(..., min_length=1, max_length=2000)
    hit_name: Optional[str] = Field(default=None, max_length=120)
    analog_smiles: list[FepAnalog] = Field(default_factory=list, max_length=10)
    # Protocol knobs — see design doc §4.
    n_lambda_windows: int = Field(default=12, ge=4, le=24)
    # 7 ns/window = 2 ns equilibration + 5 ns production (post-audit).
    ns_per_window: float = Field(default=7.0, gt=0, le=20.0)
    network_topology: str = Field(default="radial_plus_mst", max_length=32)
    # Typed FepManualEdge per the Phase B audit (clearer than the old
    # list[tuple[str, str]]). `a`/`b` are 0-based indices into
    # [hit] + analog_smiles.
    manual_edges: Optional[list[FepManualEdge]] = None
    # (K3) Force-field tier. None = backend default = "sage" (OpenFF
    # Sage 2.2.0, free Basic tier). Accepted values:
    #   "sage"      — OpenFF Sage 2.2.0 (Basic, ~$0.95/GPU-hr)
    #   "espaloma"  — Espaloma 0.3.2 GNN (Standard, K2)
    #   "mace"      — MACE-OFF 23 ML-MM (Pro tier, future)
    # The router whitelists the value and persists it onto fep_job;
    # the runner (K4) reads it to dispatch to the right pod URL.
    # Backwards-compatible: if the client doesn't send it, behaviour
    # is unchanged (Sage path runs).
    force_field_engine: Optional[str] = Field(default=None, max_length=32)


class FepNodeResult(BaseModel):
    compound_id: Optional[int] = None
    name: Optional[str] = None
    smiles: str
    is_hit: bool = False
    ddg_to_hit_kcal_mol: Optional[float] = None
    ddg_to_hit_uncertainty: Optional[float] = None
    convergence_flag: Optional[str] = None       # "ok" | "high_uncertainty" | "not_converged"


class FepEdgeResult(BaseModel):
    from_compound_id: Optional[int] = None
    to_compound_id: Optional[int] = None
    lomap_score: Optional[float] = None
    ddg_binding_kcal_mol: Optional[float] = None
    ddg_uncertainty: Optional[float] = None
    hysteresis_kcal_mol: Optional[float] = None
    status: str = "pending"
    # (J13) Timing for the running-edge ETA display on FepStudyPage.
    # ISO 8601 timestamps; None if the edge hasn't reached that state
    # yet. started_at is set when the runner dispatches the edge to
    # the pod; completed_at is set when the pod returns (success or
    # failure). The frontend uses these to render an elapsed-time
    # counter for the live edge.
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    # (J12) Live sub-stage progress while the edge is mid-flight.
    # Updated by the fep_runner's polling loop from the pod's
    # /fep_edge_status response. `stage` is a human-readable label
    # (e.g. "running_complex_leg", "parameterising_ligands");
    # `progress_pct` is 0-100, currently a coarse milestone mapping
    # until the openmm reporter hook lands in J14.
    stage: Optional[str] = None
    progress_pct: Optional[int] = None


class FepStudyGraphResponse(BaseModel):
    share_id: str
    status: str
    stage: Optional[str] = None
    cycle_closure_rmsd: Optional[float] = None
    nodes: list[FepNodeResult] = Field(default_factory=list)
    edges: list[FepEdgeResult] = Field(default_factory=list)
    # (J13) Study-level timing + protocol info so the FepStudyPage can
    # render elapsed wall-time + estimated-remaining without a separate
    # API call. created_at is the submission timestamp; the protocol
    # knobs let the UI compute the per-edge baseline (~2 GPU-hours per
    # 12×7ns edge, scaled linearly) and combine with the edge counts
    # to estimate remaining wall-clock.
    created_at: Optional[str] = None
    n_lambda_windows: Optional[int] = None
    ns_per_window: Optional[float] = None
    # (J14) Per-user sequential number. Rendered as 'FEP #42' on the
    # study page. 0 means "no number" (legacy rows from before
    # migration 021).
    seq_number: Optional[int] = None
    # (K3) Which force-field engine ran this study. None = legacy
    # (pre-K3) row → UI displays "Sage". One of: "sage" | "espaloma"
    # | "mace" (future). Surfaced so FepStudyPage can show an engine
    # badge and the History tab can filter by tier.
    force_field_engine: Optional[str] = None
    # (M15) Target identity — was previously absent from the response,
    # so FepStudyPage had no way to render "KRAS Q61H" in the header.
    # pdb_id is the canonical 4-letter identifier (e.g. "4OBE").
    pdb_id: Optional[str] = None
    chain: Optional[str] = None
    variant: Optional[str] = None
    # (M16) Protocol knobs — chemists check these to know what was
    # actually simulated. Frozen at submit time on the FepJob row.
    forcefield_protein: Optional[str] = None
    forcefield_ligand: Optional[str] = None
    water_model: Optional[str] = None
    hrex: Optional[bool] = None
    network_topology: Optional[str] = None
    estimated_usd_cost: Optional[float] = None
    # (M15) Hit compound — needed for "FEP planning map" diagram so we
    # know which node is the central one.
    hit_compound_id: Optional[int] = None


class FepStudySummary(BaseModel):
    """(H3) Row shape for the History page's FEP Studies tab.
    Lightweight summary — full study fetched via GET /fep/studies/{id}
    when the user clicks through. Fields chosen to match the same
    visual rhythm as the docking-jobs row: identity (target/variant +
    hit name), state (status + stage), timestamps, and one
    interpretive number (cycle_closure_rmsd, since that's the most
    user-facing trust signal at the study level)."""
    share_id: str
    created_at: str                  # ISO 8601
    pdb_id: str
    chain: str
    variant: str
    hit_name: Optional[str] = None
    n_analogs: int
    status: str                      # pending | preparing | running | completed | failed | cancelled
    stage: Optional[str] = None
    cycle_closure_rmsd: Optional[float] = None
    title: Optional[str] = None
    # (J14) Per-user sequential number; renders as 'FEP #42' in the
    # History tab. None for legacy rows that predate migration 021.
    seq_number: Optional[int] = None
    # (K3) Force-field engine tier — used by the History row's
    # engine badge ("Sage"/"Espaloma"/"MACE"). None = pre-K3 legacy row.
    force_field_engine: Optional[str] = None


class FepEstimateResponse(BaseModel):
    """(Phase B audit risk #1 — cost shock prevention) Projected
    runtime + dollar cost of a FEP study BEFORE submission. Required
    by audit doc `fep_plus_phase_b_audit.md` item 3 — without this,
    a user pasting 10 analogs into the form and clicking Run is
    looking at a ~$100 bill they had no warning about.

    The numbers are approximate: 1.5 × (n_analogs) edges for radial
    + MST topology, ~10 GPU-hours per edge on Blackwell at 12 lambda
    windows × 5 ns HREX. Multiplied by the pod's hourly rate."""
    n_analogs: int
    n_edges_estimated: int
    gpu_hours_estimated: float
    usd_cost_estimated: float
    eta_hours_wall_clock: float
    pod_hourly_usd: float
    notes: list[str] = Field(default_factory=list)
    # (G3) Whether THIS user can actually submit. The estimate endpoint
    # is intentionally available to everyone — anyone can see what FEP
    # would cost. The submit endpoint (/fep/studies POST) is gated.
    # The UI uses this flag to render either a "Submit" button or a
    # "Request access" prompt.
    fep_access_granted: bool = False


# ─────────────────────── endpoints (501 until Phase B) ───────────────────────


def _require_fep_access(user: CurrentUser, session: Session) -> None:
    """(G3) Gate every FEP study endpoint on per-user fep_enabled.

    GATED BY DEFAULT — fresh signups must NOT be able to spend $100 of
    pod GPU per click. Admin grants access per-user via
    PATCH /admin/users/{id}/fep. The admin email is unconditionally
    allowed by `fep_access_allowed` for testing.

    Returns 403 (not 404) when access is denied — the user knows the
    feature exists; this is a billing/operator decision, not a privacy
    leak. Clearer error for the UI to render than 'not found'."""
    if not fep_access_allowed(user.id, session):
        raise HTTPException(
            status_code=403,
            detail=(
                "FEP+ studies are not enabled for your account. "
                "Each study costs ~$100 of pod GPU; access is granted "
                "per-user by an admin. Contact your administrator to "
                "request access."
            ),
        )


def _not_implemented():
    """Helper — every endpoint funnels through this so the message is
    consistent and points at the design doc."""
    if not is_fep_enabled():
        raise HTTPException(
            status_code=501,
            detail=(
                "FEP+ is in Phase B scaffolding — endpoint shape is "
                "frozen but the runner + dedicated FEP pod aren't "
                "wired yet. See docs/fep_plus_design.md for the "
                "implementation plan. Set FEP_ENABLED=1 in Fly "
                "secrets only after the pod image is built."
            ),
        )
    # Even with the flag set, until services/fep_runner.py is filled
    # in we surface a clear 501 (FepNotImplementedError) so a
    # premature production toggle doesn't 500.
    raise HTTPException(
        status_code=501,
        detail=(
            "FEP+ runner not implemented yet. FEP_ENABLED is set but "
            "the orchestration layer is still a scaffold — see "
            "docs/fep_plus_design.md §10 for the timeline."
        ),
    )


@router.post("/studies/estimate")
def estimate_fep_study(
    payload: FepStudyRequest,
    user: Annotated[CurrentUser, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> FepEstimateResponse:
    """Estimate the GPU-hours, dollar cost, and ETA of a FEP study
    BEFORE submission. Pure-Python — no pod call, no DB write, no
    feature flag required. Designed to let the NewFepStudyPage.tsx
    confirmation panel show the user what they're about to spend.

    Approximations:
      * radial+MST topology: ~1.5 × n_analogs edges
      * per edge: 12 windows × (2 ns equil + 5 ns prod) × 2 legs
        (complex + solvent) ≈ 168 ns total sampling
      * Blackwell 4090 sm_120 throughput: ~250-350 ns/day on a 60K-atom
        kinase complex → ~10 GPU-hours per edge wall-clock
      * pod cost: $1.50/hr (RunPod Blackwell community-cloud
        average mid-2026; varies $0.95-$2.50 by SKU and availability)

    This intentionally errs HIGH so the user isn't undercharged in a
    pleasant surprise direction. Real runs land 10-30% under the
    estimate when LOMAP prunes redundant edges and HMR drops the
    cost of the solvent leg."""
    # (G3) Check the gate but don't enforce it on /estimate — the
    # whole point of this endpoint is so a user can see what FEP
    # WOULD cost before they request access from the admin. Surface
    # the flag in the response so the UI can render the right CTA
    # ("Submit" vs "Request access").
    granted = fep_access_allowed(user.id, session)
    n_analogs = len(payload.analog_smiles)
    if n_analogs == 0:
        return FepEstimateResponse(
            n_analogs=0,
            n_edges_estimated=0,
            gpu_hours_estimated=0.0,
            usd_cost_estimated=0.0,
            eta_hours_wall_clock=0.0,
            pod_hourly_usd=1.50,
            notes=["No analogs supplied — at least 1 analog is needed for a relative FEP study."],
            fep_access_granted=granted,
        )
    # Topology-aware edge count.
    # (I5) For radial_plus_mst: N radial spokes + up to N/2 extra MST
    # edges so we get cycles for cycle-closure analysis. The old
    # `max(N, 1.5*N)` formula returned 2 for N=1, but N=1 has only
    # ONE possible edge (hit → analog) — you can't form an MST with
    # 2 nodes. New formula handles that correctly.
    if payload.network_topology == "radial":
        n_edges = n_analogs
    elif payload.network_topology == "radial_plus_mst":
        n_edges = n_analogs + max(0, n_analogs // 2)
    else:
        n_edges = n_analogs + max(0, n_analogs // 2)
    # Per-edge GPU-hours scales with windows × (equil + prod) × legs.
    # 12 windows × (2 ns equil + 5 ns prod) × 2 legs = 168 ns @
    # ~350 ns/day on Blackwell ≈ 11.5 GPU-hours. Round to 10 for the
    # base case; the n_lambda_windows knob scales linearly.
    base_per_edge_hr = 10.0 * (payload.n_lambda_windows / 12.0)
    base_per_edge_hr *= (payload.ns_per_window / 5.0)
    gpu_hours = n_edges * base_per_edge_hr
    pod_hourly = 1.50         # 2026-05 Blackwell community-cloud rate
    usd = gpu_hours * pod_hourly
    # Wall-clock ETA assumes ONE FEP pod running edges sequentially —
    # the design-doc plan for v1. Once the runner supports
    # concurrent edges across multiple pods, this drops by the pod
    # count.
    eta_hr = gpu_hours
    notes = [
        f"Estimate assumes single FEP pod, edges run sequentially "
        f"({base_per_edge_hr:.1f} GPU-hours/edge).",
        "Estimate errs HIGH — real runs land 10–30% lower after "
        "LOMAP edge pruning + HMR speedup.",
    ]
    if usd > 50.0:
        notes.append(
            f"⚠ Projected cost over $50. This is a Pro-tier feature; "
            f"confirm your monthly quota before submitting."
        )
    if n_analogs > 8:
        notes.append(
            "Large analog sets converge less reliably — consider "
            "splitting into multiple sub-studies (≤8 per study) for "
            "tighter cycle-closure errors."
        )
    # (G3) Surface the access state in the response so the UI can
    # render "Submit" or "Request access" without a separate call.
    if not granted:
        notes.append(
            "🔒 FEP+ is locked for your account. Contact your "
            "administrator to request access — they can grant it from "
            "the admin panel."
        )

    return FepEstimateResponse(
        n_analogs=n_analogs,
        n_edges_estimated=n_edges,
        gpu_hours_estimated=round(gpu_hours, 1),
        usd_cost_estimated=round(usd, 2),
        eta_hours_wall_clock=round(eta_hr, 1),
        pod_hourly_usd=pod_hourly,
        notes=notes,
        fep_access_granted=granted,
    )


def _create_compound(session: Session, smiles: str, name: Optional[str]) -> Compound:
    """Create a fresh Compound row for the study. The Compound table
    is shared between Job (where job_id is set) and Screening (where
    it isn't); for FEP we leave job_id NULL — the compound is owned
    by the FepNode.compound_id FK, not by a docking Job."""
    c = Compound(smiles=smiles.strip(), name=name, job_id=None)
    session.add(c)
    session.flush()                                                  # populate c.id
    return c


# ────────────────────────────────────────────────────────────────────
# Inline SMILES validation — used by NewFepStudyPage to grey out the
# Run button if any hit/analog SMILES won't survive the pod-side
# RDKit → 3D embed step. Mirrors the same parse + AddHs + EmbedMolecule
# + MMFFOptimize chain that fep_runner._smiles_to_sdf uses, so a
# SMILES that passes here is one that will actually dispatch.
#
# A pre-flight check rather than a server-side reject avoids the
# previous failure mode where a user submitted a $50+ study against a
# bad demo SMILES and only got a "FAILED" status with no actionable
# message. Now the Run button is disabled until every SMILES is
# green-ticked and the user sees per-row errors inline.
# ────────────────────────────────────────────────────────────────────
class _SmilesValidationItem(BaseModel):
    """One SMILES to validate. `key` is whatever the frontend wants to
    use to map results back to its row state (e.g. "hit", "analog_2").
    The backend echoes it untouched."""
    key: str
    smiles: str


class _SmilesValidationRequest(BaseModel):
    """Batched per-form check. We accept up to 12 (1 hit + 10 analogs +
    1 padding) so a single round-trip covers the whole form."""
    items: list[_SmilesValidationItem]


class _SmilesValidationResult(BaseModel):
    key: str
    ok: bool
    error: Optional[str] = None         # human-readable, suitable for tooltip


class _SmilesValidationResponse(BaseModel):
    results: list[_SmilesValidationResult]


def _validate_one_smiles(smiles: str) -> tuple[bool, Optional[str]]:
    """Return (ok, error_or_None). Tries parse + 3D embed; same checks
    as the pod-side _smiles_to_sdf so the pre-flight is a faithful
    proxy for what will actually happen on dispatch."""
    smi = (smiles or "").strip()
    if not smi:
        return False, "SMILES is empty"
    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem
    except ImportError:                                              # noqa: BLE001
        # RDKit should always be present on the backend; if it isn't,
        # don't block submission — fall open so a transient install
        # issue doesn't ground the whole feature.
        return True, None
    try:
        mol = Chem.MolFromSmiles(smi)
    except Exception as e:                                           # noqa: BLE001
        return False, f"SMILES parse error: {type(e).__name__}: {e}"
    if mol is None:
        # RDKit prints the kekulize error to stderr but doesn't raise.
        # The most common cause is exactly the indole-NH bug we hit
        # with the demo data; explain it to the user.
        return False, (
            "Invalid SMILES — RDKit can't parse or kekulize this. "
            "Check aromatic-ring nitrogens for a missing [nH] hydrogen "
            "or other valence problems."
        )
    try:
        mol_h = Chem.AddHs(mol)
        rc = AllChem.EmbedMolecule(mol_h, randomSeed=42)
        if rc < 0:
            return False, "3D embed failed — molecule may be too strained or fragmented."
    except Exception as e:                                           # noqa: BLE001
        return False, f"3D embed crashed: {type(e).__name__}: {e}"
    return True, None


@router.post("/studies/validate-smiles", response_model=_SmilesValidationResponse)
def validate_fep_smiles(
    payload: _SmilesValidationRequest,
    user: Annotated[CurrentUser, Depends(current_user)],
) -> _SmilesValidationResponse:
    """Validate a batch of SMILES against RDKit's parse + 3D-embed
    pipeline. Used by NewFepStudyPage to disable the Run button when
    any row would fail at the pod's SMILES → SDF embed step.

    No DB writes, no pod calls, no gate — just rdkit. Fast (~50ms per
    SMILES for the embed). The endpoint requires sign-in so it can't
    be abused as a public SMILES-validation API, but doesn't check
    fep_access — a user without access can still get inline errors
    while drafting before they request access."""
    results = [
        _SmilesValidationResult(key=item.key, ok=ok, error=err)
        for item in payload.items
        for ok, err in [_validate_one_smiles(item.smiles)]
    ]
    return _SmilesValidationResponse(results=results)


@router.post("/studies", response_model=FepStudyGraphResponse)
def create_fep_study(
    payload: FepStudyRequest,
    user: Annotated[CurrentUser, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> FepStudyGraphResponse:
    """Create a FEP study, build the perturbation graph, and dispatch
    the runner. Returns the freshly-created study with PENDING status
    + the LOMAP graph already laid out.

    The runner itself runs OUT-OF-PROCESS via Celery (when configured)
    or synchronously in a background thread for dev. Either way the
    HTTP response returns immediately with the share_id — the client
    polls /fep/studies/{share_id}/graph for progress.

    Gated on per-user fep_enabled (G3). 403 for users without access.
    """
    _require_fep_access(user, session)

    # ─── Validate payload. ──────────────────────────────────────────
    if not payload.analog_smiles:
        raise HTTPException(
            status_code=400,
            detail="At least 1 analog is required for a relative FEP study.",
        )
    if len(payload.analog_smiles) > 10:
        raise HTTPException(
            status_code=400,
            detail="At most 10 analogs per study in v1. Split into multiple sub-studies.",
        )

    # ─── (Final audit M4) Backend cost cap. ─────────────────────────
    # The frontend asks the user to tick a checkbox for studies over
    # $50, but a curl POST bypasses that. Re-validate server-side
    # against the same /estimate logic and hard-reject above the cap.
    # Cap is configurable via env so the operator can raise it for a
    # specific high-value run without redeploying — set
    # FEP_MAX_USD_PER_STUDY=400 (or whatever) in Fly secrets.
    max_usd_per_study = float(os.environ.get("FEP_MAX_USD_PER_STUDY", "250.0"))
    est = estimate_fep_study(payload, user, session)
    if est.usd_cost_estimated > max_usd_per_study:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Projected cost ${est.usd_cost_estimated:.2f} exceeds the "
                f"per-study cap of ${max_usd_per_study:.2f}. Reduce the "
                "analog count, drop the lambda windows / ns_per_window, "
                "or ask an admin to raise FEP_MAX_USD_PER_STUDY for this run."
            ),
        )

    # ─── (I2) Per-user concurrent-study limit. ──────────────────────
    # A single user shouldn't be able to fill the FEP pod queue
    # indefinitely. Default 3 simultaneous studies in PENDING/PREPARING/
    # RUNNING. Each completed/failed/cancelled study DOES NOT count.
    # Raise via FEP_MAX_CONCURRENT_PER_USER env for a power user.
    max_concurrent = int(os.environ.get("FEP_MAX_CONCURRENT_PER_USER", "3"))
    active_states = (
        FepJobStatus.PENDING,
        FepJobStatus.PREPARING,
        FepJobStatus.RUNNING,
    )
    active_count = session.exec(
        select(FepJob)
        .where(FepJob.user_id == user.id)
        .where(FepJob.status.in_(active_states))      # type: ignore[attr-defined]
    ).all()
    if len(active_count) >= max_concurrent:
        raise HTTPException(
            status_code=429,
            detail=(
                f"You already have {len(active_count)} FEP {'study' if len(active_count) == 1 else 'studies'} "
                f"running or queued (cap: {max_concurrent}). Wait for one to finish, "
                f"or cancel one via /fep/<share_id>, before submitting another."
            ),
        )

    # ─── (I3) Monthly per-user $ cap. ───────────────────────────────
    # Backstop against a user submitting 10 studies in a click-rampage.
    # Default $500/month rolling 30-day window.
    #
    # Counts studies that have CONSUMED pod time: completed, running,
    # preparing, cancelled (cancelled-mid-edge still spent pod minutes).
    # EXCLUDES failed studies that never dispatched an edge — e.g. the
    # "POD_FEP_URL not configured" failure that consumes $0. Also
    # excludes PENDING studies that haven't started yet (they may still
    # be cancelled before spending anything).
    from datetime import datetime, timedelta
    max_usd_per_month = float(os.environ.get("FEP_MAX_USD_PER_USER_PER_MONTH", "500.0"))
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    # States that DID consume pod time (or are actively consuming):
    spending_states = (
        FepJobStatus.PREPARING,
        FepJobStatus.RUNNING,
        FepJobStatus.COMPLETED,
        FepJobStatus.CANCELLED,
    )
    recent_studies = session.exec(
        select(FepJob)
        .where(FepJob.user_id == user.id)
        .where(FepJob.created_at >= thirty_days_ago)  # type: ignore[attr-defined]
        .where(FepJob.status.in_(spending_states))     # type: ignore[attr-defined]
    ).all()
    spend_30d = sum((s.estimated_usd_cost or 0.0) for s in recent_studies)
    if spend_30d + est.usd_cost_estimated > max_usd_per_month:
        remaining = max(0.0, max_usd_per_month - spend_30d)
        raise HTTPException(
            status_code=429,
            detail=(
                f"This study would cost ${est.usd_cost_estimated:.2f} on top of "
                f"your last-30-days spend of ${spend_30d:.2f}, exceeding the "
                f"${max_usd_per_month:.2f}/month per-user cap. "
                f"You have ~${remaining:.2f} left this month. Wait for the "
                f"window to roll over, or ask an admin to raise the cap."
            ),
        )

    # ─── Resolve / create compounds. ────────────────────────────────
    hit = _create_compound(session, payload.hit_smiles, payload.hit_name)
    analog_compounds: list[Compound] = []
    for a in payload.analog_smiles:
        analog_compounds.append(
            _create_compound(session, a.smiles, a.name)
        )

    # ─── Resolve parent docking job (optional). ─────────────────────
    parent_job_id: Optional[int] = None
    if payload.parent_job_share_id:
        parent = session.exec(
            select(Job).where(Job.share_id == payload.parent_job_share_id)
        ).first()
        if parent and parent.user_id == user.id:
            parent_job_id = parent.id

    # ─── Create FepJob row. ─────────────────────────────────────────
    # estimated_usd_cost is frozen at submit time — used for the
    # monthly per-user cap.
    #
    # (J14) Compute the user's next seq_number atomically: MAX +1 of
    # their existing FEP studies. Done in the same transaction as the
    # INSERT so concurrent submits don't collide on the same number —
    # if two POSTs land at once, one commits first, the second's
    # SELECT MAX sees the updated value, and they get distinct seqs.
    # Worst case under heavy contention: a number could be skipped if
    # an in-progress transaction rolls back, which is the same
    # behaviour as docking Job.seq_number.
    from sqlmodel import func as _sql_func
    next_seq = (session.exec(
        select(_sql_func.coalesce(_sql_func.max(FepJob.seq_number), 0))
        .where(FepJob.user_id == user.id)
    ).one() or 0) + 1

    # (K3) Validate the force-field tier choice and normalize. Whitelist
    # is intentionally narrow — keeps "mace" reserved for the Pro tier
    # build without letting clients submit arbitrary strings. If the
    # client doesn't send anything (legacy frontend), we record NULL
    # and the runner (K4) treats NULL as "sage" — provably identical
    # to pre-K3 behaviour.
    _ALLOWED_ENGINES = {"sage", "espaloma", "mace"}
    chosen_engine: Optional[str] = None
    if payload.force_field_engine is not None:
        engine_norm = payload.force_field_engine.strip().lower()
        if engine_norm not in _ALLOWED_ENGINES:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Unknown force_field_engine '{payload.force_field_engine}'. "
                    f"Allowed: {sorted(_ALLOWED_ENGINES)}."
                ),
            )
        chosen_engine = engine_norm

    fep_job = FepJob(
        user_id=user.id,
        pdb_id=payload.pdb_id,
        chain=payload.chain or "A",
        variant=payload.variant or "WT",
        parent_job_id=parent_job_id,
        hit_compound_id=hit.id,
        n_lambda_windows=payload.n_lambda_windows,
        ns_per_window=payload.ns_per_window,
        network_topology=payload.network_topology,
        status=FepJobStatus.PENDING,
        estimated_usd_cost=est.usd_cost_estimated,
        seq_number=next_seq,
        force_field_engine=chosen_engine,
    )
    session.add(fep_job)
    session.commit()
    session.refresh(fep_job)

    # ─── Build LOMAP graph + seed nodes/edges. ──────────────────────
    all_smiles = [payload.hit_smiles] + [a.smiles for a in payload.analog_smiles]
    edges = build_perturbation_graph(
        payload.hit_smiles,
        [a.smiles for a in payload.analog_smiles],
        topology=payload.network_topology,
        manual_edges=(
            [(a.a, a.b) for a in payload.manual_edges]
            if payload.manual_edges else None
        ),
    )

    # Seed node rows. Index 0 = hit, 1..N = analogs in payload order.
    node_rows: list[FepNode] = []
    all_compounds = [hit] + analog_compounds
    for i, c in enumerate(all_compounds):
        node = FepNode(
            fep_job_id=fep_job.id,
            compound_id=c.id,
            is_hit=(i == 0),
        )
        session.add(node)
        node_rows.append(node)
    session.flush()                                                  # populate node.id

    # Seed perturbation rows.
    for a_idx, b_idx, score in edges:
        if a_idx >= len(node_rows) or b_idx >= len(node_rows):
            continue
        pert = FepPerturbation(
            fep_job_id=fep_job.id,
            node_a_id=node_rows[a_idx].id,
            node_b_id=node_rows[b_idx].id,
            lomap_score=score,
        )
        session.add(pert)
    session.commit()
    session.refresh(fep_job)

    # ─── Dispatch the runner via a daemon thread. ──────────────────
    # v1 deliberately skips Celery for FEP. The previous attempt sent
    # to a 'fep' queue + task name that no worker was registered for,
    # so studies just sat in Redis forever and the thread fallback
    # (gated on send_task raising) never fired. A daemon thread
    # in-process is durable enough for v1 traffic — the startup
    # reaper catches anything stuck in PENDING/RUNNING > 90 minutes
    # after a Fly restart, which is the only failure mode that
    # matters. When we have real volume + a dedicated FEP Celery
    # worker subscribed to a 'fep' queue, swap this back to
    # celery_app.send_task('deltadock.tasks.run_fep_study', ...)
    # AND register the task in celery_app.py.
    import threading
    from ..db import engine as db_engine
    from sqlmodel import Session as _S

    def _run_in_thread(job_id: int):
        with _S(db_engine) as s:
            try:
                run_study(job_id, s)
            except Exception:                                        # noqa: BLE001
                log.exception("Threaded FEP runner crashed for job %s", job_id)

    threading.Thread(target=_run_in_thread, args=(fep_job.id,), daemon=True).start()
    log.info("FepJob %s dispatched via daemon thread (Celery deferred for v1)", fep_job.id)

    # Return the freshly-created study shape — frontend will poll
    # /fep/studies/{share_id}/graph for live updates.
    return _serialise_graph(fep_job, node_rows, [], session)


@router.get("/studies", response_model=list[FepStudySummary])
def list_fep_studies(
    user: Annotated[CurrentUser, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
    offset: int = 0,
    limit: int = 25,
) -> list[FepStudySummary]:
    """(H3) Owner-only list of the current user's FEP studies. Used
    by HistoryPage's FEP Studies tab. Same offset/limit pagination
    shape as /jobs and /screenings so the frontend's useInfiniteQuery
    pattern works identically.

    NOT gated on fep_access_allowed — once a user has had access
    granted and run a study, they can always see the history even
    if the admin later revokes access. The submit path is the gated
    one; reading your own historical results is not."""
    # Cap limit defensively so a malicious client can't ask for
    # 100K rows.
    limit = max(1, min(100, limit))
    rows = session.exec(
        select(FepJob)
        .where(FepJob.user_id == user.id)
        .order_by(FepJob.created_at.desc())              # type: ignore[attr-defined]
        .offset(offset)
        .limit(limit)
    ).all()

    # Bulk-fetch the hit compound names + analog counts in one
    # additional round-trip rather than N+1.
    if not rows:
        return []
    job_ids = [r.id for r in rows if r.id is not None]
    hit_compound_ids = {r.hit_compound_id for r in rows}
    compound_name_by_id: dict[int, Optional[str]] = {}
    for c in session.exec(
        select(Compound).where(Compound.id.in_(hit_compound_ids))   # type: ignore[attr-defined]
    ).all():
        compound_name_by_id[c.id] = c.name

    # Analog count per study = total nodes minus the one hit node.
    analog_count_by_job: dict[int, int] = {jid: 0 for jid in job_ids}
    for node in session.exec(
        select(FepNode).where(FepNode.fep_job_id.in_(job_ids))      # type: ignore[attr-defined]
    ).all():
        if not node.is_hit and node.fep_job_id in analog_count_by_job:
            analog_count_by_job[node.fep_job_id] += 1

    out: list[FepStudySummary] = []
    for r in rows:
        out.append(FepStudySummary(
            share_id=r.share_id,
            created_at=r.created_at.isoformat() if r.created_at else "",
            pdb_id=r.pdb_id,
            chain=r.chain,
            variant=r.variant,
            hit_name=compound_name_by_id.get(r.hit_compound_id),
            n_analogs=analog_count_by_job.get(r.id or 0, 0),
            status=str(r.status.value if hasattr(r.status, "value") else r.status),
            stage=r.stage,
            cycle_closure_rmsd=r.cycle_closure_rmsd,
            title=r.title,
            seq_number=(r.seq_number if r.seq_number else None),
            force_field_engine=r.force_field_engine,
        ))
    return out


@router.get("/studies/{share_id}", response_model=FepStudyGraphResponse)
def get_fep_study(
    share_id: str,
    user: Annotated[CurrentUser, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> FepStudyGraphResponse:
    """Poll the status of a FEP study by share_id. Owner-only.

    Gated on per-user fep_enabled (G3)."""
    _require_fep_access(user, session)
    job = get_fep_study_status(share_id, session)
    if not job:
        raise HTTPException(status_code=404, detail="FEP study not found")
    if job.user_id != user.id:
        raise HTTPException(status_code=404, detail="FEP study not found")
    nodes = list(session.exec(
        select(FepNode).where(FepNode.fep_job_id == job.id)
    ).all())
    edges = list(session.exec(
        select(FepPerturbation).where(FepPerturbation.fep_job_id == job.id)
    ).all())
    return _serialise_graph(job, nodes, edges, session)


@router.get("/studies/{share_id}/graph", response_model=FepStudyGraphResponse)
def get_fep_study_graph(
    share_id: str,
    user: Annotated[CurrentUser, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> FepStudyGraphResponse:
    """Fetch the full perturbation graph + ΔΔG matrix. Alias of GET
    /studies/{id} — returns the same shape, kept as a separate URL
    for symmetry with the design doc API spec."""
    return get_fep_study(share_id, user, session)


@router.post("/studies/{share_id}/cancel")
def cancel_fep_study(
    share_id: str,
    user: Annotated[CurrentUser, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    """Mark a FEP study as CANCELLED. The runner cooperatively picks
    this up at the next edge boundary — the in-flight edge runs to
    completion (~8-12 hours) and no further edges dispatch.

    Idempotent: returns the same shape whether or not the cancel
    actually changed state."""
    _require_fep_access(user, session)
    job = get_fep_study_status(share_id, session)
    if not job:
        raise HTTPException(status_code=404, detail="FEP study not found")
    if job.user_id != user.id:
        raise HTTPException(status_code=404, detail="FEP study not found")
    changed = _cancel_fep_study(share_id, session)
    return {
        "share_id": share_id,
        "cancelled": changed,
        "status": job.status,
        "note": (
            "The in-flight edge will run to completion (~8-12 GPU-hours). "
            "No further edges will dispatch. Billing stops at the next "
            "edge boundary."
        ),
    }


def _serialise_graph(
    job: FepJob,
    nodes: list[FepNode],
    edges: list[FepPerturbation],
    session: Session,
) -> FepStudyGraphResponse:
    """Build the FepStudyGraphResponse payload from a FepJob + its
    nodes + edges. Joins to Compound for the SMILES/name."""
    compound_cache: dict[int, Compound] = {}
    for n in nodes:
        if n.compound_id not in compound_cache:
            c = session.get(Compound, n.compound_id)
            if c:
                compound_cache[n.compound_id] = c

    node_results: list[FepNodeResult] = []
    for n in nodes:
        c = compound_cache.get(n.compound_id)
        node_results.append(FepNodeResult(
            compound_id=n.compound_id,
            name=(c.name if c else None),
            smiles=(c.smiles if c else ""),
            is_hit=bool(n.is_hit),
            ddg_to_hit_kcal_mol=n.ddg_to_hit_kcal_mol,
            ddg_to_hit_uncertainty=n.ddg_to_hit_uncertainty,
            convergence_flag=n.convergence_flag,
        ))

    edge_results: list[FepEdgeResult] = []
    node_id_to_compound_id = {n.id: n.compound_id for n in nodes}
    for e in edges:
        edge_results.append(FepEdgeResult(
            from_compound_id=node_id_to_compound_id.get(e.node_a_id),
            to_compound_id=node_id_to_compound_id.get(e.node_b_id),
            lomap_score=e.lomap_score,
            ddg_binding_kcal_mol=e.ddg_binding_kcal_mol,
            ddg_uncertainty=e.ddg_uncertainty,
            hysteresis_kcal_mol=e.hysteresis_kcal_mol,
            status=e.status,
            started_at=(e.started_at.isoformat() if e.started_at else None),
            completed_at=(e.completed_at.isoformat() if e.completed_at else None),
            stage=getattr(e, "stage", None),
            progress_pct=getattr(e, "progress_pct", None),
        ))

    return FepStudyGraphResponse(
        share_id=job.share_id,
        status=str(job.status.value if hasattr(job.status, "value") else job.status),
        stage=job.stage,
        cycle_closure_rmsd=job.cycle_closure_rmsd,
        nodes=node_results,
        edges=edge_results,
        created_at=(job.created_at.isoformat() if job.created_at else None),
        n_lambda_windows=job.n_lambda_windows,
        ns_per_window=job.ns_per_window,
        seq_number=(job.seq_number if job.seq_number else None),
        force_field_engine=job.force_field_engine,
        pdb_id=job.pdb_id,
        chain=job.chain,
        variant=job.variant,
        forcefield_protein=job.forcefield_protein,
        forcefield_ligand=job.forcefield_ligand,
        water_model=job.water_model,
        hrex=job.hrex,
        network_topology=job.network_topology,
        estimated_usd_cost=job.estimated_usd_cost,
        hit_compound_id=job.hit_compound_id,
    )
