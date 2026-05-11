"""Virtual screening endpoints (mutation-aware library-scale docking).

Mirrors the shape of routers/jobs.py but for the ScreeningJob workflow.
Key differences from /jobs:

  - Per-submission compound cap is 1000 (vs 5 for /jobs). The whole
    point of this endpoint is "rank N compounds against one target +
    optional mutation", not the single-compound matrix view.

  - Mutation list capped at 1. Δ-vs-WT ranking math is undefined for
    multi-mutation, and we deliberately keep this clean for v1.

  - Per-cell ScreeningResult rows are pre-created at submit time (one
    per compound × variant) so the progress bar has its denominator
    from the first poll. The runner updates them in place.

  - No "exhaustiveness >= 8" coercion — screening defaults to 4 to
    keep total throughput inside one pod's reasonable runtime budget.
    Users re-dock top survivors at higher exhaustiveness via /jobs.

  - Mutation residue validation reuses _validate_mutations_for_submit
    from routers.jobs so we don't have two copies of the same code.

Routes:
    POST   /screening                 — submit a screening job
    GET    /screening                 — list current user's screenings
    GET    /screening/{share_id}      — fetch one screening + results
    POST   /screening/{share_id}/cancel — cancel an in-flight screening
"""
from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

log = logging.getLogger(__name__)

from ..auth import CurrentUser, current_user, profile_complete_user
from ..db import get_session
from ..models import Compound, ScreeningJob, ScreeningResult, ScreeningStatus
from ..schemas import ScreeningCreate, ScreeningOut, ScreeningResultOut
from ..services.screening_runner import run_screening_in_background
# Pull the same mutation pre-flight from routers.jobs — single source of
# truth for the "is this mutation buildable on this PDB" check.
from .jobs import _validate_mutations_for_submit

router = APIRouter(prefix="/screening", tags=["screening"])

# Hard cap. The schema accepts up to 2000 to leave headroom, but the
# router enforces 1000 to keep a single screening inside one pod's
# reasonable runtime budget (~30-60 min at 1-3 s/dock on the 4090).
MAX_COMPOUNDS_PER_SCREEN = 1000


def _resolve_screening(session: Session, key: str) -> ScreeningJob | None:
    """Same dual lookup as routers.jobs._resolve_job — integer pk or share_id."""
    if key.isdigit() and len(key) <= 9:
        sj = session.get(ScreeningJob, int(key))
        if sj is not None:
            return sj
    return session.exec(select(ScreeningJob).where(ScreeningJob.share_id == key)).first()


def _result_to_out(r: ScreeningResult, compound: Compound | None) -> ScreeningResultOut:
    return ScreeningResultOut(
        compound_id=r.compound_id,
        compound_name=compound.name if compound else None,
        compound_smiles=compound.smiles if compound else "",
        variant=r.variant,
        best_score=r.best_score,
        status=r.status,
        error_message=r.error_message,
        # wt_score / delta_score / selectivity_index are denormalized
        # onto the mutant row by the runner once both mutant + WT have
        # docked. Persisted in ScreeningResult.extra (JSON) once the
        # runner ships; v1 returns None and the frontend sorts by
        # best_score until then.
        wt_score=None,
        delta_score=None,
        selectivity_index=None,
        admet=None,
    )


def _to_out(sj: ScreeningJob, session: Session) -> ScreeningOut:
    # Pull the per-cell rows joined with their compounds in one go to
    # avoid the N+1. The results page renders hundreds of these, so
    # the join cost matters.
    rows = session.exec(
        select(ScreeningResult).where(ScreeningResult.screening_job_id == sj.id)
    ).all()
    compound_ids = list({r.compound_id for r in rows})
    compounds_by_id: dict[int, Compound] = {}
    if compound_ids:
        for c in session.exec(select(Compound).where(Compound.id.in_(compound_ids))).all():
            compounds_by_id[c.id] = c
    # Default sort: best_score ASC nulls last. Once selectivity_index is
    # wired, the runner pre-sorts the rows it writes back so this default
    # is meaningful; until then we sort by best_score with None at end.
    rows_sorted = sorted(
        rows,
        key=lambda r: (r.best_score is None, r.best_score if r.best_score is not None else 0.0),
    )
    return ScreeningOut(
        id=sj.id,
        share_id=sj.share_id,
        pdb_id=sj.pdb_id,
        chain=sj.chain,
        mutations=[m for m in sj.mutations.split(",") if m],
        engine=sj.engine or "quickvina2_gpu",
        exhaustiveness=sj.exhaustiveness,
        n_total=sj.n_total,
        n_completed=sj.n_completed,
        n_failed=sj.n_failed,
        status=sj.status,
        error_message=sj.error_message,
        created_at=sj.created_at,
        updated_at=sj.updated_at,
        user_id=sj.user_id,
        title=sj.title,
        tags=list(sj.tags or []),
        results=[_result_to_out(r, compounds_by_id.get(r.compound_id)) for r in rows_sorted],
    )


@router.post("", response_model=ScreeningOut, status_code=201)
def create_screening(
    payload: ScreeningCreate,
    background: BackgroundTasks,
    user: CurrentUser = Depends(profile_complete_user),
    session: Session = Depends(get_session),
) -> ScreeningOut:
    # Hard cap. Frontend should never send more than this — server-side
    # defense for direct API callers.
    if len(payload.compounds) > MAX_COMPOUNDS_PER_SCREEN:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Screening capped at {MAX_COMPOUNDS_PER_SCREEN} compounds per submission. "
                f"You sent {len(payload.compounds)}. Split into batches or filter your library first."
            ),
        )

    # Pre-flight mutation check — same as /jobs. Catches "T790M on a PDB
    # that doesn't model residue 790" before we waste GPU minutes.
    if payload.mutations:
        mut_issues = _validate_mutations_for_submit(
            pdb_id=payload.pdb_id,
            chain=payload.chain,
            mutations=list(payload.mutations),
            uniprot_id=payload.uniprot_id,
        )
        if mut_issues:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": (
                        f"{len(mut_issues)} mutation(s) can't be built on "
                        f"{payload.pdb_id} chain {payload.chain}"
                    ),
                    "mutation_issues": mut_issues,
                },
            )

    # Persist the ScreeningJob shell. Per-cell ScreeningResult rows go
    # in next so n_total has a meaningful value from the first poll.
    sj = ScreeningJob(
        pdb_id=payload.pdb_id,
        chain=payload.chain,
        mutations=",".join(payload.mutations),
        exhaustiveness=payload.exhaustiveness,
        engine=payload.engine,
        status=ScreeningStatus.PENDING,
        user_id=user.id,
        title=payload.title,
        tags=list(payload.tags or []),
    )
    session.add(sj)
    session.commit()
    session.refresh(sj)

    # Compounds: dedupe by canonical SMILES inside this submission. Two
    # rows with the same canonical SMILES would dock to the same score
    # anyway — wastes GPU time. The runner can still get told to dock
    # the same SMILES across SEPARATE screenings (different target +
    # mutation), and the pod's own /dock cache catches THAT.
    canon_to_compound: dict[str, Compound] = {}
    try:
        from rdkit import Chem  # type: ignore
        rdkit_ok = True
    except Exception:
        rdkit_ok = False

    for c in payload.compounds:
        smi = (c.smiles or "").strip()
        if not smi:
            continue
        canon = smi
        if rdkit_ok:
            try:
                mol = Chem.MolFromSmiles(smi)
                if mol is not None:
                    canon = Chem.MolToSmiles(mol, canonical=True)
            except Exception:
                canon = smi
        if canon in canon_to_compound:
            continue
        compound = Compound(name=c.name, smiles=smi)
        # Compound table is FK'd from ScreeningResult, not from
        # ScreeningJob. We don't attach to job here; the row exists
        # as a standalone Compound that ScreeningResult references.
        session.add(compound)
        canon_to_compound[canon] = compound
    session.commit()
    # Refresh so we have compound.id for every row.
    for compound in canon_to_compound.values():
        session.refresh(compound)

    # Pre-create ScreeningResult rows so the progress bar has its
    # denominator from the first poll. One per (compound, variant) pair.
    # Variants list = ["WT", *mutations] (mutations is capped at 1 by
    # the schema).
    variants = ["WT"] + list(payload.mutations)
    n_total = 0
    for compound in canon_to_compound.values():
        for variant in variants:
            session.add(ScreeningResult(
                screening_job_id=sj.id,
                compound_id=compound.id,
                variant=variant,
                status="pending",
            ))
            n_total += 1
    sj.n_total = n_total
    session.add(sj)
    session.commit()
    session.refresh(sj)

    # Dispatch the runner. Same BackgroundTasks pattern as /jobs.
    # Celery migration would slot in here later (see celery_app.dispatch_job
    # for the precedent — we'd add dispatch_screening with the same shape).
    background.add_task(run_screening_in_background, sj.id)

    return _to_out(sj, session)


@router.get("/{key}", response_model=ScreeningOut)
def get_screening(key: str, session: Session = Depends(get_session)) -> ScreeningOut:
    sj = _resolve_screening(session, key)
    if not sj:
        raise HTTPException(status_code=404, detail="Screening not found")
    return _to_out(sj, session)


@router.get("", response_model=list[ScreeningOut])
def list_screenings(
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
    limit: int = Query(50, ge=1, le=200),
) -> list[ScreeningOut]:
    """Current user's screenings, most recent first. History page calls this."""
    rows = session.exec(
        select(ScreeningJob)
        .where(ScreeningJob.user_id == user.id)
        .order_by(ScreeningJob.created_at.desc())
        .limit(limit)
    ).all()
    return [_to_out(sj, session) for sj in rows]


@router.post("/{key}/cancel", response_model=ScreeningOut)
def cancel_screening(
    key: str,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> ScreeningOut:
    sj = _resolve_screening(session, key)
    if not sj:
        raise HTTPException(status_code=404, detail="Screening not found")
    if sj.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not your screening")
    if sj.status in (ScreeningStatus.COMPLETED, ScreeningStatus.FAILED, ScreeningStatus.CANCELLED):
        # Idempotent — already terminal, just return current state.
        return _to_out(sj, session)
    sj.status = ScreeningStatus.CANCELLED
    sj.updated_at = datetime.utcnow()
    session.add(sj)
    session.commit()
    session.refresh(sj)
    return _to_out(sj, session)
