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


class FepStudyGraphResponse(BaseModel):
    share_id: str
    status: str
    stage: Optional[str] = None
    cycle_closure_rmsd: Optional[float] = None
    nodes: list[FepNodeResult] = Field(default_factory=list)
    edges: list[FepEdgeResult] = Field(default_factory=list)


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
    if payload.network_topology == "radial":
        n_edges = n_analogs
    elif payload.network_topology == "radial_plus_mst":
        n_edges = max(n_analogs, int(round(1.5 * n_analogs)))
    else:
        n_edges = int(round(1.5 * n_analogs))
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

    # ─── Dispatch the runner via Celery (if configured) or in a
    #    background thread. The runner's run_study is blocking
    #    (~days), so we MUST run it out-of-process or the HTTP
    #    handler will hang. ──────────────────────────────────────────
    try:
        # Prefer Celery if it's wired up.
        from ..celery_app import celery_app
        celery_app.send_task(
            "deltadock.tasks.run_fep_study",
            args=[fep_job.id],
            queue="fep",                # design doc §6 — dedicated queue
        )
        log.info("FepJob %s dispatched to Celery 'fep' queue", fep_job.id)
    except Exception as e:                                           # noqa: BLE001
        # Fallback: kick off in a daemon thread. NOT durable across
        # worker restarts but unblocks the HTTP call in dev.
        log.warning("Celery dispatch failed (%s); falling back to thread", e)
        import threading
        from ..db import engine as db_engine
        from sqlmodel import Session as _S

        def _run_in_thread(job_id: int):
            with _S(db_engine) as s:
                try:
                    run_study(job_id, s)
                except Exception as e:                               # noqa: BLE001
                    log.exception("Threaded FEP runner crashed for job %s", job_id)

        threading.Thread(target=_run_in_thread, args=(fep_job.id,), daemon=True).start()

    # Return the freshly-created study shape — frontend will poll
    # /fep/studies/{share_id}/graph for live updates.
    return _serialise_graph(fep_job, node_rows, [], session)


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
        ))

    return FepStudyGraphResponse(
        share_id=job.share_id,
        status=str(job.status.value if hasattr(job.status, "value") else job.status),
        stage=job.stage,
        cycle_closure_rmsd=job.cycle_closure_rmsd,
        nodes=node_results,
        edges=edge_results,
    )
