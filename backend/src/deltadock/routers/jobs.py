"""Job submission and retrieval endpoints."""

import re
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from ..auth import CurrentUser, current_user, current_user_or_none, verified_user
from ..celery_app import dispatch_job
from ..config import get_settings
from ..db import get_session
from ..models import Compound, DockingResult, Job, JobStatus
from ..schemas import (
    CompoundOut,
    DockingResultOut,
    JobCreate,
    JobOut,
    JobUpdate,
)
from ..services.rate_limit import JOBS_LIMIT

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
        engine=job.engine,
        user_id=job.user_id,
        title=job.title,
        tags=list(job.tags or []),
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


def _validate_mutations_for_submit(
    pdb_id: str,
    chain: str,
    mutations: list[str],
    uniprot_id: str | None,
) -> list[dict]:
    """Pre-flight: are these mutations buildable on this PDB+chain?

    Fast path uses the cleaned WT PDB if it's already cached on the Fly
    volume (typical for catalog targets and any PDB this user has hit
    before). Otherwise we fetch the raw RCSB PDB — also cached, so the
    second submit against the same target is free.

    We deliberately do NOT trigger a full PDBFixer prep here — that's the
    slow step (~10-20s) and is only needed for actual docking. Residue
    presence + identity is preserved bit-for-bit between raw RCSB and
    cleaned PDB, so the cheaper file is fine for this check.

    Returns a list of issue dicts (see prep.validate_mutations); each one
    that's a `residue_not_resolved` is enriched with `alternatives` —
    other PDB structures of the same UniProt that DO contain the residue.

    Returns empty list (no issues) on import errors so dev environments
    without the bio deps don't fail-closed.
    """
    try:
        from deltadock_pipeline.prep import validate_mutations
        from deltadock_pipeline.fetch import fetch_pdb
    except ImportError:
        return []

    # User uploads (USR_ prefix) — the upload router already wrote a clean
    # PDB to PDB_CACHE. For RCSB IDs we either reuse the cleaned PDB if
    # one exists, or fetch the raw PDB straight from RCSB.
    from ..services.runner import PDB_CACHE, RECEPTOR_CACHE  # avoid circular at import time

    pid = pdb_id if pdb_id.startswith("USR_") else pdb_id.upper()
    ch = (chain or "A").upper()

    # 1) Cleaned WT in the WT cache (most catalog targets land here)
    cleaned = PDB_CACHE / f"{pid}_{ch}.clean.pdb"
    pdb_for_check: Path | None = None
    if cleaned.exists() and cleaned.stat().st_size > 0:
        pdb_for_check = cleaned
    else:
        # 2) Cleaned WT in the receptor cache (legacy path)
        alt = RECEPTOR_CACHE / f"{pid}_{ch}.clean.pdb"
        if alt.exists() and alt.stat().st_size > 0:
            pdb_for_check = alt

    if pdb_for_check is None:
        # 3) Fetch the raw PDB from RCSB. Residue numbering is preserved by
        # our prep pipeline (we deliberately don't renumber), so checking
        # against the raw file gives the same answer as checking against
        # the cleaned one — without paying the PDBFixer cost.
        try:
            pdb_for_check = fetch_pdb(pid, PDB_CACHE)
        except Exception:
            # Couldn't get the structure at all. Don't block submit on this
            # — let the runner discover the same problem and surface it as
            # a job-level error with a normal failure path.
            return []

    issues = validate_mutations(pdb_for_check, ch, pid, mutations)

    # Enrich `residue_not_resolved` issues with alternative PDB suggestions.
    # We only call out to RCSB for the residue-missing case; wildtype_mismatch
    # is usually a numbering issue where another PDB won't help (it'll have
    # the same numbering convention), and `chain_empty` / `unparseable` are
    # not residue-coverage problems.
    if issues and uniprot_id:
        try:
            from ..services.rcsb_alternatives import find_alternative_pdbs
            for issue in issues:
                if issue.get("code") == "residue_not_resolved" and issue.get("residue"):
                    alts = find_alternative_pdbs(
                        uniprot_id=uniprot_id,
                        residue=int(issue["residue"]),
                        exclude_pdb=pid,
                    )
                    if alts:
                        issue["alternatives"] = alts
        except Exception as e:
            # Suggestions are nice-to-have. Failing here would block submit
            # for an issue the user already needs to fix anyway.
            log = __import__("logging").getLogger(__name__)
            log.warning("alternative-PDB enrichment failed: %s", e)

    return issues


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


@router.post("", response_model=JobOut, status_code=201,
              dependencies=[Depends(JOBS_LIMIT)])
def create_job(
    payload: JobCreate,
    background: BackgroundTasks,
    user: CurrentUser = Depends(verified_user),
    session: Session = Depends(get_session),
) -> JobOut:
    # Schema validator already normalized the pdb_id (uppercase for RCSB IDs,
    # case-preserved for USR_ uploads). Re-uppercasing here would corrupt
    # USR_ tokens since the lookup-router stores files with lowercase hex —
    # any extra .upper() breaks the runner's file lookup.

    # Eager SMILES validation. Three checks per compound — each catches a
    # different failure mode that would otherwise cost the user GPU time:
    #   1. Parse: SMILES has to round-trip RDKit (the pipeline's resilient
    #      parser is the same one the runner uses).
    #   2. Connectivity: disconnected fragments (e.g. salt forms like
    #      "CC(=O)O.[Na+]") can't be docked as one molecule. Caller should
    #      Keep-largest before submit; we reject here as a safety net.
    #   3. 3D embeddable: RDKit can parse it but EmbedMolecule must succeed
    #      or the docking pipeline fails at ligand_prep. Catches things like
    #      pathologically large rings or unusual valences that parse fine.
    # Each invalid entry includes the offending SMILES so the frontend can
    # offer "Open in sketcher" to fix it without retyping.
    invalid: list[dict] = []
    try:
        from deltadock_pipeline.prep import _parse_smiles_resilient
        from rdkit import Chem
        from rdkit.Chem import AllChem
        for i, c in enumerate(payload.compounds):
            smi = (c.smiles or "").strip()
            row_base = {"index": i, "name": c.name, "smiles": smi}
            if not smi:
                invalid.append({**row_base, "reason": "empty SMILES", "kind": "empty"})
                continue
            if len(smi) > 1000:
                invalid.append({**row_base, "reason": f"SMILES too long ({len(smi)} chars; max 1000)", "kind": "too_long"})
                continue
            try:
                mol = _parse_smiles_resilient(smi)
            except Exception as e:
                invalid.append({**row_base, "reason": f"parse error: {type(e).__name__}", "kind": "parse"})
                continue
            if mol is None:
                invalid.append({**row_base, "reason": "RDKit could not parse this SMILES", "kind": "parse"})
                continue
            # Disconnected-fragment check — "CC.CC.CC" parses fine but isn't
            # a single dockable molecule. The frontend's MoleculePreview
            # offers a Keep-largest button; if the user submitted anyway,
            # surface the largest fragment in the error so they can apply.
            try:
                frags = Chem.GetMolFrags(mol, asMols=True, sanitizeFrags=False)
                if len(frags) > 1:
                    largest = max(frags, key=lambda m: m.GetNumHeavyAtoms())
                    largest_smi = Chem.MolToSmiles(largest, canonical=True)
                    invalid.append({
                        **row_base,
                        "reason": f"{len(frags)} disconnected fragments — Liganx docks single molecules. Keep the largest fragment ({largest.GetNumHeavyAtoms()} atoms) and re-submit.",
                        "kind": "fragments",
                        "fragment_count": len(frags),
                        "largest_fragment": largest_smi,
                    })
                    continue
            except Exception:
                pass
            # 3D embedding sanity check. Tight maxAttempts because this is
            # synchronous on the submit path — users are waiting. ~50-200ms
            # per compound for typical drug-like molecules.
            try:
                mol_h = Chem.AddHs(mol)
                rc = AllChem.EmbedMolecule(mol_h, maxAttempts=10, randomSeed=0xF00D)
                if rc < 0:
                    invalid.append({
                        **row_base,
                        "reason": "RDKit can't generate a 3D conformer for this molecule — the docking pipeline would fail at ligand prep. Common causes: very large rings, unusual valences.",
                        "kind": "embed",
                    })
                    continue
            except Exception as e:
                invalid.append({
                    **row_base,
                    "reason": f"3D embed failed: {type(e).__name__}",
                    "kind": "embed",
                })
                continue
    except ImportError:
        # If the pipeline isn't importable in this environment (dev without
        # bio deps), skip eager validation so we don't fail-closed in dev.
        pass

    if invalid:
        raise HTTPException(
            status_code=422,
            detail={
                "message": f"{len(invalid)} of {len(payload.compounds)} compound SMILES failed validation",
                "invalid_compounds": invalid,
            },
        )

    # Engine availability check. Boltz-2 is rejected at submit (not silently
    # downgraded) when the deployment doesn't have it enabled, because the
    # methodology is so different from Vina that falling through would lie
    # to the user about what produced their score. GNINA's runner-side
    # fallback to QuickVina is acceptable because they share the same Vina
    # scoring family — Boltz-2's affinity_pred_value is a different unit
    # entirely (log10 IC50 μM vs Vina kcal/mol).
    cfg = get_settings()
    if payload.engine == "boltz2" and not cfg.boltz2_enabled:
        raise HTTPException(
            status_code=503,
            detail={
                "message": (
                    "engine=boltz2 is not currently available on this deployment. "
                    "Boltz-2 needs the Pod-side /predict_boltz2 endpoint installed "
                    "(see runpod/BOLTZ2_INSTALL.md) and BOLTZ2_ENABLED=1 set on the API. "
                    "Pick engine=quickvina2_gpu or engine=gnina for now."
                ),
                "engine_requested": payload.engine,
                "available": [
                    "quickvina2_gpu",
                    *(["gnina"] if cfg.gnina_enabled else []),
                ],
            },
        )

    # Pre-flight mutation residue check. The runner can now verify that
    # every requested mutation maps to a residue that's actually modeled
    # in the user's chosen PDB chain — and that the wildtype letter
    # matches what the structure has at that position. Catching these
    # *before* dispatching means the user isn't waiting 30s for a FoldX
    # fail with a cryptic mutant_build badge; they get specific guidance
    # at submit time, plus alternative PDBs that DO contain the residue.
    #
    # Skipped when there are no mutations (WT-only run) or when the
    # pipeline isn't importable in this environment (dev without bio deps).
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

    job = Job(
        pdb_id=payload.pdb_id,
        chain=payload.chain,
        uniprot_id=payload.uniprot_id,
        mutations=",".join(payload.mutations),
        exhaustiveness=payload.exhaustiveness,
        include_wt=payload.include_wt,
        engine=payload.engine,
        status=JobStatus.PENDING,
        user_id=user.id,
        title=payload.title,
        tags=list(payload.tags or []),
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    for c in payload.compounds:
        session.add(Compound(job_id=job.id, name=c.name, smiles=c.smiles))
    session.commit()
    session.refresh(job)

    # Dispatch the job. Routes through celery_app.dispatch_job which
    # picks Celery (when USE_CELERY_DISPATCH=True and Redis is configured)
    # or FastAPI BackgroundTasks (default). The behaviour is identical
    # from the API's point of view; the wrapper exists so the migration
    # to Celery (#168) can flip behind a feature flag without touching
    # this site again. See docs/celery_redis_migration_plan.md.
    dispatch_job(job.id, background_tasks=background)

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


@router.post("/{job_key}/cancel", response_model=JobOut)
def cancel_job(
    job_key: str,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> JobOut:
    """Cancel a running or pending job.

    The runner cooperatively checks job.status between cells and bails out
    when it sees CANCELLED. The currently in-flight Pod GPU call (~3 s) will
    complete and any results-already-computed stay in the DB; no further
    cells dispatch, so we don't waste compute on a job the user no longer
    wants.

    Idempotent on terminal statuses: cancelling an already-completed or
    already-failed job is a no-op (returns 200 with the existing state).
    Cancelling an already-cancelled job is also a no-op.

    Authorization: only the job's owner can cancel. Returns 404 (not 403) for
    non-owners so a stranger with a guessed share-link can't probe whether a
    job exists.
    """
    job = _resolve_job(session, job_key)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
        # Terminal — nothing to cancel. Return current state without
        # mutating; this makes the endpoint safe to call from a Cancel
        # button that might race with normal completion.
        return _to_out(job)
    job.status = JobStatus.CANCELLED
    job.error_message = "Cancelled by user"
    job.updated_at = datetime.utcnow()
    session.add(job)
    session.commit()
    session.refresh(job)
    return _to_out(job)


@router.patch("/{job_key}", response_model=JobOut)
def update_job(
    job_key: str,
    payload: JobUpdate,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> JobOut:
    """Owner-side patch for editable fields (currently title and tags).

    Tags drive the History page's color-coded labels (Favorite, Promising,
    Bad, Send to lab, etc.) and filter. They're stored in the existing
    Job.tags ARRAY column, so this endpoint requires no schema change.

    Both fields use the "None means leave alone" convention so the frontend
    can patch one without echoing the other:
      • {"tags": ["promising", "favorite"]}  → only tags change
      • {"title": "EGFR resistance panel"}   → only title changes
      • {"tags": []}                         → clear all tags
      • {"title": ""}                        → clear back to synthesized title

    Authorization: only the job's owner. Non-owners get 404 (not 403) so
    a guessed share-link can't probe whether the job exists.
    """
    job = _resolve_job(session, job_key)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Job not found")

    changed = False
    if payload.title is not None:
        # Empty string clears the title back to the synthesized default.
        job.title = payload.title.strip() or None
        changed = True
    if payload.tags is not None:
        # JobUpdate.field_validator already trims, dedupes, and length-checks.
        job.tags = payload.tags
        changed = True

    if changed:
        job.updated_at = datetime.utcnow()
        session.add(job)
        session.commit()
        session.refresh(job)
    return _to_out(job)


@router.delete("/{job_key}", status_code=204)
def delete_job(
    job_key: str,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> None:
    """Permanently delete a job and all its compounds + docking results.

    Owner-only — non-owners get 404 (we don't reveal that the job exists).
    Cascade is done in app code because the migration didn't add ON DELETE
    CASCADE on the FKs (intentional — it lets us decide per-table whether to
    follow the parent down).

    Pose files on the Fly volume are NOT deleted here. They become orphaned
    but are harmless (~few KB each), and a periodic cleanup job can sweep
    them up by checking for missing parent dockingresult rows. Leaving the
    pose IO out of this path keeps the endpoint fast and avoids partial-
    failure modes (DB row gone, file orphaned vs file gone, DB row stuck).
    """
    job = _resolve_job(session, job_key)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.user_id != user.id:
        # Don't leak existence: return 404, not 403.
        raise HTTPException(status_code=404, detail="Job not found")

    # Children first (no FK cascade in schema).
    for r in session.exec(select(DockingResult).where(DockingResult.job_id == job.id)):
        session.delete(r)
    for c in session.exec(select(Compound).where(Compound.job_id == job.id)):
        session.delete(c)
    session.delete(job)
    session.commit()


@router.get("", response_model=list[JobOut])
def list_jobs(
    limit: int = Query(20, ge=1, le=200, description="Max jobs to return (1-200)"),
    offset: int = Query(0, ge=0, description="Skip this many jobs (for pagination)"),
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> list[JobOut]:
    """List the requesting user's jobs (newest first).

    Auth required — anonymous viewers can still see individual jobs by
    share-link (GET /jobs/{share_id}), but the bulk list is per-user only.
    Filtering is done in app code (not RLS) because the backend connects as
    the privileged postgres role which bypasses RLS. The DB-side RLS policies
    are still in place as defense-in-depth.

    Performance: this is the History-page hot path. We deliberately return a
    SLIM JobOut here — empty `results`, no `pdb_quality`, and no per-compound
    `admet`. Reasoning:

      • The History UI only reads id/share_id/pdb_id/chain/uniprot_id/
        mutations/status/title/tags/created_at + compounds[].name/smiles for
        client-side search. It never opens results, ADMET, or pdb_quality
        from the list response — those are computed lazily on JobPage when
        a user actually drills in.
      • _admet_for() runs RDKit per compound; on a cold LRU cache with 25
        jobs × ~5 compounds each it added 1-3s of pure compute.
      • _pdb_quality_for() does a crossdock-cache file lookup per job.
      • Loading job.results lazily triggers an N+1 query per job (25 extra
        round-trips per page).

    We also use selectinload(Job.compounds) so all compounds load in one
    bulk SELECT keyed on job_id IN (...) instead of 25 separate queries.
    The user_id filter is already covered by idx_job_user_created from
    migration 001.
    """
    stmt = (
        select(Job)
        .where(Job.user_id == user.id)
        .order_by(Job.created_at.desc())
        .offset(offset)
        .limit(limit)
        .options(selectinload(Job.compounds))  # one bulk query, not N+1
    )
    return [_to_summary_out(j) for j in session.exec(stmt)]


def _to_summary_out(job: Job) -> JobOut:
    """Slim JobOut for the History list view. Same schema as _to_out so the
    frontend Job type doesn't need to fork — we just zero out the expensive
    fields the History page never reads. See list_jobs() for the rationale."""
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
        engine=job.engine,
        user_id=job.user_id,
        title=job.title,
        tags=list(job.tags or []),
        compounds=[
            # admet=None is the default; History page renders nothing from it.
            CompoundOut(id=c.id, name=c.name, smiles=c.smiles)
            for c in job.compounds
        ],
        # results + pdb_quality intentionally omitted (default empty / None).
    )


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
