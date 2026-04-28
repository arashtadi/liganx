"""Job submission and retrieval endpoints."""

import re
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlmodel import Session, select

from ..db import get_session
from ..models import Compound, DockingResult, Job, JobStatus
from ..schemas import (
    CompoundOut,
    DockingResultOut,
    JobCreate,
    JobOut,
)
from ..services.runner import run_job_in_background

# Same shape used in structures.py: variant must look like "WT" or "T790M"
# style. URL-controlled values get baked into a path lookup, so we validate
# format first and confine the resolved path to POSE_CACHE.
_VARIANT_RE = re.compile(r"^(WT|[A-Za-z][0-9]+[A-Za-z]([+_][A-Za-z0-9]+)*(del|ins[A-Za-z]+)?)$")

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _resolve_job(session: Session, key: str) -> Job | None:
    """Resolve either a legacy integer job ID or a public share_id to a Job.

    URLs the frontend creates use `share_id` (random base64url token); URLs in
    bookmarks or older tabs may use the integer primary key. Try integer first
    only when the path looks like one — short numeric strings — to avoid a
    spurious DB hit on every share_id.
    """
    if key.isdigit() and len(key) <= 9:
        job = session.get(Job, int(key))
        if job:
            return job
    return session.exec(select(Job).where(Job.share_id == key)).first()


def _to_out(job: Job) -> JobOut:
    # ADMET is computed lazily here (not at job submit) so any SMILES that
    # snuck in before the descriptor module shipped still gets enriched on
    # next read. compute_admet is LRU-cached by SMILES so the second job
    # using the same compound costs ~0ms.
    return JobOut(
        id=job.id,
        share_id=job.share_id,
        pdb_id=job.pdb_id,
        chain=job.chain,
        uniprot_id=job.uniprot_id,
        mutations=[m for m in job.mutations.split(",") if m],
        status=job.status,
        error_message=job.error_message,
        created_at=job.created_at,
        updated_at=job.updated_at,
        exhaustiveness=job.exhaustiveness,
        include_wt=job.include_wt,
        compounds=[
            CompoundOut(id=c.id, name=c.name, smiles=c.smiles, admet=_admet_for(c.smiles))
            for c in job.compounds
        ],
        results=[
            DockingResultOut(
                compound_id=r.compound_id,
                variant=r.variant,
                best_score=r.best_score,
                pose_uri=r.pose_uri,
                extra=r.extra,
            )
            for r in job.results
        ],
        pdb_quality=_pdb_quality_for(job.pdb_id, job.chain),
    )


def _admet_for(smiles: str) -> dict | None:
    """Wrap admet.compute_admet so an import-time failure (RDKit missing in
    a stripped-down environment) doesn't take the whole jobs router down —
    the frontend just sees admet=null and renders an em-dash for that
    compound's chip row."""
    try:
        from deltadock_pipeline.admet import compute_admet
        return compute_admet(smiles)
    except Exception:
        return None


def _pdb_quality_for(pdb_id: str, chain: str) -> dict | None:
    """Look up the cached cross-docking sanity-check result for this
    (pdb_id, chain). Returns None if the background job hasn't run yet
    (catalog targets eventually get pre-baked; custom uploads compute on
    first job submission)."""
    # Preserve USR_ case (uploads); uppercase RCSB IDs.
    pid = pdb_id if pdb_id.startswith("USR_") else pdb_id.upper()
    ch = (chain or "A").upper()
    try:
        from deltadock_pipeline.crossdock import load_cached
        return load_cached(pid, ch)
    except Exception:
        return None


@router.post("", response_model=JobOut, status_code=201)
def create_job(
    payload: JobCreate,
    background: BackgroundTasks,
    session: Session = Depends(get_session),
) -> JobOut:
    # Schema validator already normalized the pdb_id (uppercase for RCSB IDs,
    # case-preserved for USR_ uploads). Re-uppercasing here would corrupt
    # USR_ tokens since the lookup-router stores files with lowercase hex —
    # any extra .upper() breaks the runner's file lookup.
    job = Job(
        pdb_id=payload.pdb_id,
        chain=payload.chain,
        uniprot_id=payload.uniprot_id,
        mutations=",".join(payload.mutations),
        exhaustiveness=payload.exhaustiveness,
        include_wt=payload.include_wt,
        status=JobStatus.PENDING,
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    for c in payload.compounds:
        session.add(Compound(job_id=job.id, name=c.name, smiles=c.smiles))
    session.commit()
    session.refresh(job)

    # Phase 1: run inline in a background task. Phase 2: dispatch to Celery + RunPod.
    background.add_task(run_job_in_background, job.id)

    return _to_out(job)


@router.get("/{job_key}", response_model=JobOut)
def get_job(job_key: str, session: Session = Depends(get_session)) -> JobOut:
    """Fetch a job by either its share_id (preferred, public) or legacy
    integer primary key. The same path handles both for backward compat
    with any links that still exist in the wild."""
    job = _resolve_job(session, job_key)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _to_out(job)


@router.get("", response_model=list[JobOut])
def list_jobs(
    limit: int = Query(20, ge=1, le=200, description="Max jobs to return (1-200)"),
    offset: int = Query(0, ge=0, description="Skip this many jobs (for pagination)"),
    session: Session = Depends(get_session),
) -> list[JobOut]:
    stmt = (
        select(Job)
        .order_by(Job.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return [_to_out(j) for j in session.exec(stmt)]


@router.get("/{job_key}/poses/{compound_id}/{variant}", response_class=PlainTextResponse)
def get_pose(
    job_key: str,
    compound_id: int,
    variant: str,
    session: Session = Depends(get_session),
) -> str:
    """Serve the docked-pose for a (job, compound, variant), best mode only.

    Vina output is PDBQT with all 9 modes concatenated. We extract mode 1 and
    convert to PDB via Open Babel so 3Dmol's parser handles every atom — its
    PDBQT support is incomplete and silently drops atoms with non-PDB columns.
    """
    import shutil as _shutil
    import subprocess as _subprocess
    import tempfile as _tempfile

    # Validate variant format up front — URL params are user-controlled and
    # we use them in DB filters + (indirectly) in path resolution below.
    if not _VARIANT_RE.match(variant):
        raise HTTPException(status_code=400, detail="invalid variant format")

    # Resolve job_key (share_id or legacy int) → integer id for the FK lookup.
    # DockingResult is keyed on the integer primary key, never on share_id.
    job = _resolve_job(session, job_key)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job_id = job.id

    stmt = (
        select(DockingResult)
        .where(DockingResult.job_id == job_id)
        .where(DockingResult.compound_id == compound_id)
        .where(DockingResult.variant == variant)
    )
    result = session.exec(stmt).first()
    if not result or not result.pose_uri:
        raise HTTPException(status_code=404, detail="Pose not found")

    # Read through the storage abstraction so r2:// URIs and legacy filesystem
    # paths both resolve. The store enforces the path-traversal guard that
    # the original endpoint had (anything outside POSE_CACHE / R2 bucket is
    # rejected) so we don't have to repeat that check here.
    from ..services.pose_store import get_pose_store
    try:
        raw = get_pose_store().read(result.pose_uri)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Pose not found")
    except Exception:
        raise HTTPException(status_code=410, detail="Pose file no longer cached")
    if not raw:
        raise HTTPException(status_code=410, detail="Pose file no longer cached")
    text = raw.decode("utf-8", errors="replace")
    # Extract first MODEL block (best-scoring pose)
    if "MODEL" in text:
        out_lines = []
        in_first = False
        for line in text.splitlines(keepends=True):
            if line.startswith("MODEL"):
                if in_first:
                    break
                in_first = True
                continue
            if line.startswith("ENDMDL"):
                if in_first:
                    break
                continue
            if in_first:
                out_lines.append(line)
        best_pdbqt = "".join(out_lines)
    else:
        best_pdbqt = text

    # Convert PDBQT → PDB so 3Dmol parses every atom (its PDBQT mode is buggy).
    # Falls back to raw PDBQT if obabel isn't available.
    if not _shutil.which("obabel"):
        return best_pdbqt
    with _tempfile.TemporaryDirectory() as td:
        in_path = Path(td) / "pose.pdbqt"
        out_path = Path(td) / "pose.pdb"
        in_path.write_text(best_pdbqt)
        res = _subprocess.run(
            ["obabel", str(in_path), "-O", str(out_path)],
            capture_output=True, text=True, check=False,
        )
        if res.returncode == 0 and out_path.exists() and out_path.stat().st_size > 0:
            return out_path.read_text()
        return best_pdbqt
