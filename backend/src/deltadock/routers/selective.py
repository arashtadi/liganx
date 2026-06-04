"""Mutant-Selective Binder Discovery — standalone API (prefix /selective).

This router is fully self-contained. It does NOT import or touch the docking
`jobs`/`screening` routers or any Studio code; it owns the new
`selectivity_job` table only. See docs/mutant_selective_pipeline.md.

Endpoints (this build):
    GET  /selective/triage              — step A, live: locate a target +
                                          return allowed binder modalities
    POST /selective/jobs                — create a run (persists + runs triage)
    GET  /selective/jobs                — list the caller's runs
    GET  /selective/jobs/{share_id}     — fetch one run
    POST /selective/jobs/{share_id}/cancel

Steps B–E (pocket map, ensemble, differential docking, FEP escalation, analog
expansion) are scaffolded in services/selective_runner.py and wired in later
tasks; submitting a job currently completes step A (triage) and parks at
status='pending' with stage='triage_complete'.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..auth import CurrentUser, admin_user
from ..db import get_session
from ..models import SelectivityJob, SelectivityJobStatus
from ..services.analog_search import expand_analogs
from ..services.selective_runner import pocket_diff, run_differential_pipeline, triage_target

log = logging.getLogger(__name__)

router = APIRouter(prefix="/selective", tags=["selective"])

# Same validation shape used in jobs.py / structures.py — keep target inputs
# tight because they flow into structure lookups downstream.
_PDB_RE = re.compile(r"^([A-Za-z0-9]{4}|USR_[0-9a-f]{8})$")
_CHAIN_RE = re.compile(r"^[A-Za-z0-9]{1,2}$")
_MUTATION_RE = re.compile(r"^[A-Za-z][0-9]+[A-Za-z]([+_][A-Za-z0-9]+)*$")
_UNIPROT_RE = re.compile(r"^[A-Za-z0-9]{1,20}$")
_GENE_RE = re.compile(r"^[A-Za-z0-9_\-]{1,20}$")

_VALID_MODALITIES = {"small_molecule", "peptide", "protein"}
_VALID_STRUCTURE_SOURCES = {"mutate_relax", "experimental"}


# ─────────────────────────── schemas ───────────────────────────
class TriageResponse(BaseModel):
    uniprot_id: Optional[str] = None
    localization: str
    locations: list[str] = []
    allowed_modalities: list[str]
    reasoning: str
    source: str


class CandidateIn(BaseModel):
    name: str = Field(default="", max_length=120)
    smiles: str = Field(..., max_length=600)


class AnalogRequest(BaseModel):
    smiles: str = Field(..., max_length=600, description="Seed molecule SMILES")
    top_k: int = Field(default=10, ge=1, le=50)
    include_chembl: bool = True


class AnalogOut(BaseModel):
    seed_smiles: str
    analogs: list[dict]
    sources: dict
    chembl_available: bool


class SelectivityJobRequest(BaseModel):
    pdb_id: str
    chain: str = "A"
    mutation: str = Field(..., description="e.g. 'T790M' — defines the mutant pocket")
    uniprot_id: Optional[str] = None
    gene: Optional[str] = None
    modality: str = "small_molecule"
    structure_source: str = "mutate_relax"
    ensemble_size: int = Field(default=1, ge=1, le=50)
    candidate_source: Optional[str] = None
    # Candidate molecules to screen differentially. When empty, the run does
    # triage only (no docking). Capped to keep one run's pod time bounded.
    candidates: list[CandidateIn] = Field(default_factory=list, max_length=50)
    title: Optional[str] = None


class SelectivityJobOut(BaseModel):
    share_id: str
    seq_number: int
    created_at: datetime
    updated_at: datetime
    pdb_id: str
    chain: str
    mutation: str
    uniprot_id: Optional[str]
    structure_source: str
    localization: Optional[str]
    allowed_modalities: Optional[list[str]]
    modality: str
    ensemble_size: int
    candidate_source: Optional[str]
    fep_escalation: bool
    fep_top_n: int
    status: str
    stage: Optional[str]
    error_message: Optional[str]
    title: Optional[str]
    triage: Optional[dict] = None
    pocket_diff: Optional[dict] = None
    ranked_hits: Optional[list] = None


def _to_out(job: SelectivityJob) -> SelectivityJobOut:
    def _loads(s: Optional[str]):
        if not s:
            return None
        try:
            return json.loads(s)
        except (ValueError, TypeError):
            return None

    return SelectivityJobOut(
        share_id=job.share_id,
        seq_number=job.seq_number,
        created_at=job.created_at,
        updated_at=job.updated_at,
        pdb_id=job.pdb_id,
        chain=job.chain,
        mutation=job.mutation,
        uniprot_id=job.uniprot_id,
        structure_source=job.structure_source,
        localization=job.localization,
        allowed_modalities=(job.allowed_modalities.split(",") if job.allowed_modalities else None),
        modality=job.modality,
        ensemble_size=job.ensemble_size,
        candidate_source=job.candidate_source,
        fep_escalation=job.fep_escalation,
        fep_top_n=job.fep_top_n,
        status=job.status.value if isinstance(job.status, SelectivityJobStatus) else str(job.status),
        stage=job.stage,
        error_message=job.error_message,
        title=job.title,
        triage=_loads(job.triage_json),
        pocket_diff=_loads(job.pocket_diff_json),
        ranked_hits=_loads(job.ranked_hits_json),
    )


# ─────────────────────────── endpoints ───────────────────────────
@router.get("/triage", response_model=TriageResponse)
def get_triage(
    user: Annotated[CurrentUser, Depends(admin_user)],
    uniprot: Optional[str] = Query(default=None, description="UniProt accession"),
    gene: Optional[str] = Query(default=None, description="Gene symbol"),
) -> TriageResponse:
    """Step A — standalone target triage. Lets the page check where a target
    lives (and which modalities are allowed) BEFORE submitting a run."""
    if not uniprot and not gene:
        raise HTTPException(status_code=422, detail="Provide a `uniprot` accession or a `gene` symbol.")
    if uniprot and not _UNIPROT_RE.match(uniprot):
        raise HTTPException(status_code=422, detail="Malformed UniProt accession.")
    if gene and not _GENE_RE.match(gene):
        raise HTTPException(status_code=422, detail="Malformed gene symbol.")
    result = triage_target(uniprot_id=uniprot, gene=gene)
    return TriageResponse(**result)


@router.post("/analogs", response_model=AnalogOut)
def find_analogs(
    payload: AnalogRequest,
    user: Annotated[CurrentUser, Depends(admin_user)],
) -> AnalogOut:
    """Step E — analog expansion. Given a seed molecule (e.g. a top mutant-
    selective hit), return structurally similar molecules from the curated
    local libraries (RDKit Tanimoto) plus a ChEMBL similarity top-up."""
    if not payload.smiles.strip():
        raise HTTPException(status_code=422, detail="Empty SMILES.")
    result = expand_analogs(
        payload.smiles.strip(),
        top_k=payload.top_k,
        include_chembl=payload.include_chembl,
    )
    return AnalogOut(**result)


@router.post("/jobs", response_model=SelectivityJobOut)
def create_selectivity_job(
    payload: SelectivityJobRequest,
    background: BackgroundTasks,
    user: Annotated[CurrentUser, Depends(admin_user)],
    session: Annotated[Session, Depends(get_session)],
) -> SelectivityJobOut:
    """Create a mutant-selective run. Validates inputs, runs target triage
    (step A) synchronously, persists, and — if candidate molecules were
    supplied — dispatches the differential docking pipeline (step D.1) in the
    background. With no candidates the run does triage only and parks at
    status='pending', stage='triage_complete'.
    """
    if not _PDB_RE.match(payload.pdb_id):
        raise HTTPException(status_code=422, detail="Malformed PDB id.")
    if not _CHAIN_RE.match(payload.chain):
        raise HTTPException(status_code=422, detail="Malformed chain.")
    if not _MUTATION_RE.match(payload.mutation):
        raise HTTPException(status_code=422, detail="Malformed mutation (expected e.g. 'T790M').")
    if payload.modality not in _VALID_MODALITIES:
        raise HTTPException(status_code=422, detail=f"modality must be one of {sorted(_VALID_MODALITIES)}.")
    if payload.structure_source not in _VALID_STRUCTURE_SOURCES:
        raise HTTPException(status_code=422, detail=f"structure_source must be one of {sorted(_VALID_STRUCTURE_SOURCES)}.")
    if payload.uniprot_id and not _UNIPROT_RE.match(payload.uniprot_id):
        raise HTTPException(status_code=422, detail="Malformed UniProt accession.")
    if payload.gene and not _GENE_RE.match(payload.gene):
        raise HTTPException(status_code=422, detail="Malformed gene symbol.")

    # Step A — triage (degrades to 'unknown' on lookup failure; never raises).
    triage = triage_target(uniprot_id=payload.uniprot_id, gene=payload.gene)
    localization = triage["localization"]
    allowed = triage["allowed_modalities"]

    # Enforce the modality policy: can't request a modality the target's
    # location forbids (e.g. a peptide against an intracellular target).
    if payload.modality not in allowed:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Modality '{payload.modality}' is not allowed for a "
                f"{localization} target. Allowed: {allowed}. {triage['reasoning']}"
            ),
        )

    # Per-user human-friendly sequence number (MAX+1), like docking/FEP jobs.
    existing = session.exec(
        select(SelectivityJob.seq_number)
        .where(SelectivityJob.user_id == user.id)
        .order_by(SelectivityJob.seq_number.desc())
    ).first()
    seq_number = (existing or 0) + 1

    candidates = [{"name": c.name, "smiles": c.smiles} for c in payload.candidates]

    # Step B — WT-vs-mutant pocket map. Structure-free residue-property diff,
    # instant, computed at submit so it's available even on a triage-only run.
    pdiff = pocket_diff(payload.mutation)

    job = SelectivityJob(
        user_id=user.id,
        seq_number=seq_number,
        pdb_id=payload.pdb_id.upper() if len(payload.pdb_id) == 4 else payload.pdb_id,
        chain=payload.chain,
        mutation=payload.mutation,
        uniprot_id=triage.get("uniprot_id") or payload.uniprot_id,
        modality=payload.modality,
        structure_source=payload.structure_source,
        ensemble_size=payload.ensemble_size,
        candidate_source=payload.candidate_source or ("user" if candidates else None),
        candidates_json=json.dumps(candidates) if candidates else None,
        title=payload.title,
        localization=localization,
        allowed_modalities=",".join(allowed),
        triage_json=json.dumps(triage),
        pocket_diff_json=json.dumps(pdiff) if pdiff else None,
        status=SelectivityJobStatus.PENDING,
        stage="docking_queued" if candidates else "triage_complete",
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    # Dispatch the differential docking pipeline (step D.1) only when there are
    # candidates to screen. Triage-only runs return immediately.
    if candidates:
        background.add_task(run_differential_pipeline, job.share_id)

    log.info("selective: created run %s (seq #%d) for %s — localization=%s, %d candidate(s)",
             job.share_id, seq_number, user.email, localization, len(candidates))
    return _to_out(job)


@router.get("/jobs", response_model=list[SelectivityJobOut])
def list_selectivity_jobs(
    user: Annotated[CurrentUser, Depends(admin_user)],
    session: Annotated[Session, Depends(get_session)],
    limit: int = Query(default=50, ge=1, le=200),
) -> list[SelectivityJobOut]:
    rows = session.exec(
        select(SelectivityJob)
        .where(SelectivityJob.user_id == user.id)
        .order_by(SelectivityJob.created_at.desc())
        .limit(limit)
    ).all()
    return [_to_out(j) for j in rows]


def _resolve_owned(session: Session, share_id: str, user: CurrentUser) -> SelectivityJob:
    job = session.exec(
        select(SelectivityJob).where(SelectivityJob.share_id == share_id)
    ).first()
    if job is None:
        raise HTTPException(status_code=404, detail="Selectivity run not found.")
    # Ownership scope — a run is private to its creator.
    if job.user_id and job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Selectivity run not found.")
    return job


@router.get("/jobs/{share_id}", response_model=SelectivityJobOut)
def get_selectivity_job(
    share_id: str,
    user: Annotated[CurrentUser, Depends(admin_user)],
    session: Annotated[Session, Depends(get_session)],
) -> SelectivityJobOut:
    return _to_out(_resolve_owned(session, share_id, user))


@router.post("/jobs/{share_id}/cancel", response_model=SelectivityJobOut)
def cancel_selectivity_job(
    share_id: str,
    user: Annotated[CurrentUser, Depends(admin_user)],
    session: Annotated[Session, Depends(get_session)],
) -> SelectivityJobOut:
    job = _resolve_owned(session, share_id, user)
    if job.status in (SelectivityJobStatus.COMPLETED, SelectivityJobStatus.FAILED):
        raise HTTPException(status_code=409, detail=f"Run already {job.status.value}.")
    job.status = SelectivityJobStatus.CANCELLED
    job.stage = None
    job.updated_at = datetime.utcnow()
    session.add(job)
    session.commit()
    session.refresh(job)
    return _to_out(job)
