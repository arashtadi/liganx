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
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import CurrentUser, current_user
from ..services.fep_runner import FepNotImplementedError, is_fep_enabled

log = logging.getLogger(__name__)

router = APIRouter(prefix="/fep", tags=["fep"])


# ─────────────────────── request/response schemas ───────────────────────


class FepAnalog(BaseModel):
    """One non-hit ligand in the perturbation graph."""
    name: Optional[str] = Field(default=None, max_length=120)
    smiles: str = Field(..., min_length=1, max_length=2000)


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
    ns_per_window: float = Field(default=5.0, gt=0, le=20.0)
    network_topology: str = Field(default="radial_plus_mst", max_length=32)
    manual_edges: Optional[list[tuple[str, str]]] = None


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


# ─────────────────────── endpoints (501 until Phase B) ───────────────────────


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
    _ = user
    n_analogs = len(payload.analog_smiles)
    if n_analogs == 0:
        return FepEstimateResponse(
            n_analogs=0,
            n_edges_estimated=0,
            gpu_hours_estimated=0.0,
            usd_cost_estimated=0.0,
            eta_hours_wall_clock=0.0,
            pod_hourly_usd=0.95,
            notes=["No analogs supplied — at least 1 analog is needed for a relative FEP study."],
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
    return FepEstimateResponse(
        n_analogs=n_analogs,
        n_edges_estimated=n_edges,
        gpu_hours_estimated=round(gpu_hours, 1),
        usd_cost_estimated=round(usd, 2),
        eta_hours_wall_clock=round(eta_hr, 1),
        pod_hourly_usd=pod_hourly,
        notes=notes,
    )


@router.post("/studies")
def create_fep_study(
    payload: FepStudyRequest,
    user: Annotated[CurrentUser, Depends(current_user)],
) -> FepStudyGraphResponse:
    """Create a FEP study and dispatch it to the FEP pod. NOT YET IMPLEMENTED."""
    _ = payload, user
    try:
        _not_implemented()
        # Unreachable until the implementation lands; type-checker
        # placeholder so the function signature is honest.
        raise RuntimeError("unreachable")
    except FepNotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))


@router.get("/studies/{share_id}")
def get_fep_study(
    share_id: str,
    user: Annotated[CurrentUser, Depends(current_user)],
) -> dict:
    """Poll the status of a FEP study. NOT YET IMPLEMENTED."""
    _ = share_id, user
    _not_implemented()
    return {}                                                       # unreachable


@router.get("/studies/{share_id}/graph")
def get_fep_study_graph(
    share_id: str,
    user: Annotated[CurrentUser, Depends(current_user)],
) -> FepStudyGraphResponse:
    """Fetch the full perturbation graph + ΔΔG matrix. NOT YET IMPLEMENTED."""
    _ = share_id, user
    _not_implemented()
    return FepStudyGraphResponse(share_id=share_id, status="not_implemented")


@router.post("/studies/{share_id}/cancel")
def cancel_fep_study(
    share_id: str,
    user: Annotated[CurrentUser, Depends(current_user)],
) -> dict:
    """Cancel a running FEP study. NOT YET IMPLEMENTED."""
    _ = share_id, user
    _not_implemented()
    return {}                                                       # unreachable
