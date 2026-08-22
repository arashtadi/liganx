"""Virtual screening endpoints (mutation-aware library-scale docking).

Mirrors the shape of routers/jobs.py but for the ScreeningJob workflow.
Key differences from /jobs:

  - Per-submission compound cap is 1000 (vs 5 for /jobs). The whole
    point of this endpoint is "rank N compounds against one target +
    optional mutation", not the single-compound matrix view.

  - Mutation list capped at 2 (v1.19). Δ-vs-WT ranking math runs
    per-mutant row independently, so 2 mutations = 2 separate
    Δ columns ranked next to each other. Higher caps would require
    a multi-Δ aggregation strategy we haven't designed yet.

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

from ..auth import CurrentUser, current_user, current_user_or_none, profile_complete_user
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
MAX_COMPOUNDS_PER_SCREEN = 10000  # per-run cap lifted (crash rail only; owner decision 2026-08)


def _resolve_screening(
    session: Session, key: str, *, allow_integer_id: bool = True
) -> ScreeningJob | None:
    """Same dual lookup as routers.jobs._resolve_job — integer pk or share_id.

    `allow_integer_id=False` resolves ONLY via the unguessable share_id.
    The owner-scoped callers (cancel/delete) keep the default True (they
    re-check ownership); the PUBLIC read path uses _resolve_screening_public
    which sets it False so /screening/<int> can't be enumerated."""
    if allow_integer_id and key.isdigit() and len(key) <= 9:
        sj = session.get(ScreeningJob, int(key))
        if sj is not None:
            return sj
    return session.exec(select(ScreeningJob).where(ScreeningJob.share_id == key)).first()


def _resolve_screening_public(
    session: Session, key: str, user: "CurrentUser | None"
) -> ScreeningJob | None:
    """Resolve a screening for the PUBLIC read endpoint. share_id always
    resolves (public by design); the enumerable integer PK resolves only
    for the authenticated owner — closing the /screening/<int> enumeration
    hole without breaking share links or owner bookmarks."""
    sj = _resolve_screening(session, key, allow_integer_id=False)
    if sj is not None:
        return sj
    if user is not None and key.isdigit() and len(key) <= 9:
        sj = session.get(ScreeningJob, int(key))
        if sj is not None and sj.user_id and str(sj.user_id) == str(user.id):
            return sj
    return None


def _result_to_out(r: ScreeningResult, compound: Compound | None) -> ScreeningResultOut:
    # #208: wt_score / delta_score / selectivity_index are now
    # denormalized onto each mutant row by screening_runner._materialize_selectivity
    # right after both the WT and mutant cells finish docking. The WT
    # row's own copies stay NULL — only mutant rows carry a Δ. The
    # frontend uses this to render the ranked hit list without doing
    # any client-side cross-row math.
    return ScreeningResultOut(
        compound_id=r.compound_id,
        compound_name=compound.name if compound else None,
        compound_smiles=compound.smiles if compound else "",
        variant=r.variant,
        best_score=r.best_score,
        status=r.status,
        error_message=r.error_message,
        wt_score=r.wt_score,
        delta_score=r.delta_score,
        selectivity_index=r.selectivity_index,
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
    # #208: sort by selectivity_index DESC (higher = more selective for
    # mutant), then best_score ASC (more-negative = tighter) as a
    # tiebreaker, then by compound_id for deterministic ordering of
    # same-score rows. WT rows have selectivity_index=None and float to
    # the bottom of the ranked list — they're reference data, not
    # candidates. Cells without a best_score (failed / pending) sit at
    # the very bottom regardless of variant.
    def _sort_key(r: ScreeningResult) -> tuple:
        return (
            r.best_score is None,                            # failed/pending last
            r.selectivity_index is None,                     # WT-only rows after mutants
            -(r.selectivity_index or 0.0),                   # desc by selectivity
            r.best_score if r.best_score is not None else 0.0,  # asc by score (tighter first)
            r.compound_id,                                   # stable tiebreaker
        )
    rows_sorted = sorted(rows, key=_sort_key)
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
    # Pro-tier gate: Virtual Screening is Pro only. Free tier sees 402
    # with a contact-us message; the Studio UI also hides/locks the VS
    # entry point so this is defense-in-depth.
    from ..auth import is_pro_user
    if not is_pro_user(user.id, session):
        raise HTTPException(
            status_code=402,
            detail={
                "message": (
                    "Virtual Screening is a Liganx Pro feature. "
                    "Free tier supports single-compound AutoDock Vina docking. "
                    "Contact us to upgrade your account."
                ),
                "feature": "screening",
                "contact_url": "https://liganx.com/contact",
            },
        )

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

    # Pre-flight SMILES validation. Reject any unparseable rows BEFORE
    # we create the ScreeningJob shell — otherwise we'd burn pod minutes
    # only to fail per-cell with cryptic ligand-prep errors, AND we'd
    # leave a half-populated job row behind. RDKit is the source of
    # truth; without it we fall back to a basic non-empty + length
    # check (good enough for a sanity gate on direct API calls).
    try:
        from rdkit import Chem  # type: ignore
        _rdkit_ok = True
    except Exception:  # noqa: BLE001
        _rdkit_ok = False
    smiles_errors: list[dict] = []
    for i, c in enumerate(payload.compounds):
        smi = (c.smiles or "").strip()
        if not smi:
            smiles_errors.append({"index": i, "name": c.name, "reason": "empty SMILES"})
            continue
        if len(smi) > 500:
            smiles_errors.append({"index": i, "name": c.name, "reason": f"SMILES too long ({len(smi)} chars, max 500)"})
            continue
        if _rdkit_ok:
            try:
                mol = Chem.MolFromSmiles(smi)
                if mol is None:
                    smiles_errors.append({"index": i, "name": c.name, "reason": "RDKit could not parse SMILES"})
            except Exception as e:  # noqa: BLE001
                smiles_errors.append({"index": i, "name": c.name, "reason": f"RDKit error: {e}"})
    if smiles_errors:
        raise HTTPException(
            status_code=422,
            detail={
                "message": (
                    f"{len(smiles_errors)} compound(s) have invalid SMILES — "
                    "fix or remove them and resubmit."
                ),
                "smiles_errors": smiles_errors,
            },
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
    # Variants list = ["WT", *mutations] — mutations capped at 2 by
    # the schema. Each compound becomes 1+len(mutations) cells.
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
def get_screening(
    key: str,
    session: Session = Depends(get_session),
    user: CurrentUser | None = Depends(current_user_or_none),
) -> ScreeningOut:
    """Public read: resolves by share_id for anyone; the legacy integer PK
    resolves for the authenticated owner only (no enumeration scraping)."""
    sj = _resolve_screening_public(session, key, user)
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


@router.delete("/{key}", status_code=204)
def delete_screening(
    key: str,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> None:
    """Permanently delete a screening and all its result rows.

    Owner-only — non-owners get 404 to avoid leaking existence. Mirrors
    the delete_job pattern: cascade is done in app code (no ON DELETE
    CASCADE FK), parent screening_result rows are deleted first.

    Compounds attached via screening_result.compound_id are NOT deleted
    here — they're orphan-safe (job_id is now nullable per migration 013)
    and another screening / job may reference the same canonical SMILES.
    A periodic GC job can sweep truly-orphan Compound rows later.
    """
    sj = _resolve_screening(session, key)
    if not sj:
        raise HTTPException(status_code=404, detail="Screening not found")
    if sj.user_id != user.id:
        # Don't leak existence — return 404, not 403.
        raise HTTPException(status_code=404, detail="Screening not found")
    # Children first.
    for r in session.exec(
        select(ScreeningResult).where(ScreeningResult.screening_job_id == sj.id)
    ):
        session.delete(r)
    session.delete(sj)
    session.commit()
