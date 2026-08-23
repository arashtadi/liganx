"""Resistance Radar — shareable, durable scan records.

A scan is a compound docked across a target's variant panel, with per-variant
Δ-docking + calibrated resistance probability. The whole per-variant table is
stored as one JSON payload (the row is a document, not a matrix).

Endpoints:
    POST   /resistance                — create a scan (owner-scoped; beta: admin)
    GET    /resistance                — list the caller's scans (admin, beta)
    GET    /resistance/{share_id}     — fetch one scan (PUBLIC, read-only)
    PATCH  /resistance/{share_id}     — update rows/status (owner only)

The public GET is what makes a scan shareable: anyone with the unguessable
share_id link can view the assembled map. Writes are owner-scoped, and gated to
admin while the feature is in beta (relax when access opens up).
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..auth import CurrentUser, admin_user, current_user_or_none
from ..db import get_session
from ..models import ResistanceScan

router = APIRouter(prefix="/resistance", tags=["resistance"])


# ── Schemas ──────────────────────────────────────────────────────────
class ScanRow(BaseModel):
    code: str
    label: str = ""
    significance: str = ""
    mutScore: Optional[float] = None
    wtScore: Optional[float] = None
    jobKey: Optional[str] = None
    error: Optional[str] = None
    prob: Optional[float] = None
    probSource: Optional[str] = None
    probVerdict: Optional[str] = None


class ScanCreate(BaseModel):
    targetId: str = ""
    targetLabel: str = ""
    gene: str = ""
    pdbId: str = ""
    chain: str = "A"
    uniprotId: Optional[str] = None
    compoundName: str = ""
    smiles: str = Field(default="", max_length=2000)
    status: str = "running"
    wtScore: Optional[float] = None
    rows: list[ScanRow] = Field(default_factory=list, max_length=64)


class ScanUpdate(BaseModel):
    status: Optional[str] = None
    wtScore: Optional[float] = None
    rows: Optional[list[ScanRow]] = Field(default=None, max_length=64)


class ScanOut(BaseModel):
    share_id: str
    created_at: str
    updated_at: str
    status: str
    targetId: str
    targetLabel: str
    gene: str
    pdbId: str
    chain: str
    uniprotId: Optional[str]
    compoundName: str
    smiles: str
    wtScore: Optional[float]
    rows: list[ScanRow]
    is_owner: bool


def _to_out(s: ResistanceScan, user: "CurrentUser | None") -> ScanOut:
    try:
        rows = json.loads(s.rows_json) if s.rows_json else []
    except Exception:  # noqa: BLE001
        rows = []
    is_owner = bool(user is not None and s.user_id and str(s.user_id) == str(user.id))
    return ScanOut(
        share_id=s.share_id,
        created_at=s.created_at.isoformat(),
        updated_at=s.updated_at.isoformat(),
        status=s.status,
        targetId=s.target_id,
        targetLabel=s.target_label,
        gene=s.gene,
        pdbId=s.pdb_id,
        chain=s.chain,
        uniprotId=s.uniprot_id,
        compoundName=s.compound_name,
        smiles=s.smiles,
        wtScore=s.wt_score,
        rows=[ScanRow(**r) for r in rows],
        is_owner=is_owner,
    )


def _rows_json(rows: list[ScanRow]) -> str:
    return json.dumps([r.model_dump() for r in rows])


@router.post("", response_model=ScanOut, status_code=201)
def create_scan(
    payload: ScanCreate,
    user: CurrentUser = Depends(admin_user),
    session: Session = Depends(get_session),
) -> ScanOut:
    scan = ResistanceScan(
        user_id=str(user.id),
        target_id=payload.targetId[:64],
        target_label=payload.targetLabel[:240],
        gene=payload.gene[:32],
        pdb_id=payload.pdbId[:8],
        chain=(payload.chain or "A")[:4],
        uniprot_id=(payload.uniprotId or None),
        compound_name=payload.compoundName[:240],
        smiles=payload.smiles[:2000],
        status=payload.status if payload.status in ("running", "done") else "running",
        wt_score=payload.wtScore,
        rows_json=_rows_json(payload.rows),
        title=f"Resistance Radar · {payload.targetLabel} · {payload.compoundName}"[:240],
    )
    session.add(scan)
    session.commit()
    session.refresh(scan)
    return _to_out(scan, user)


@router.get("", response_model=list[ScanOut])
def list_scans(
    user: CurrentUser = Depends(admin_user),
    session: Session = Depends(get_session),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[ScanOut]:
    rows = session.exec(
        select(ResistanceScan)
        .where(ResistanceScan.user_id == str(user.id))
        .order_by(ResistanceScan.created_at.desc())
        .limit(limit)
    ).all()
    return [_to_out(s, user) for s in rows]


@router.get("/{share_id}", response_model=ScanOut)
def get_scan(
    share_id: str,
    user: Optional[CurrentUser] = Depends(current_user_or_none),
    session: Session = Depends(get_session),
) -> ScanOut:
    scan = session.exec(
        select(ResistanceScan).where(ResistanceScan.share_id == share_id)
    ).first()
    if scan is None:
        raise HTTPException(status_code=404, detail="Resistance scan not found.")
    return _to_out(scan, user)


@router.patch("/{share_id}", response_model=ScanOut)
def update_scan(
    share_id: str,
    payload: ScanUpdate,
    user: CurrentUser = Depends(admin_user),
    session: Session = Depends(get_session),
) -> ScanOut:
    scan = session.exec(
        select(ResistanceScan).where(ResistanceScan.share_id == share_id)
    ).first()
    if scan is None:
        raise HTTPException(status_code=404, detail="Resistance scan not found.")
    if not (scan.user_id and str(scan.user_id) == str(user.id)):
        raise HTTPException(status_code=403, detail="Not your scan.")
    if payload.status is not None and payload.status in ("running", "done"):
        scan.status = payload.status
    if payload.wtScore is not None:
        scan.wt_score = payload.wtScore
    if payload.rows is not None:
        scan.rows_json = _rows_json(payload.rows)
    scan.updated_at = datetime.utcnow()
    session.add(scan)
    session.commit()
    session.refresh(scan)
    return _to_out(scan, user)
