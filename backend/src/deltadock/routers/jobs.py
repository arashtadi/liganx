"""Job submission and retrieval endpoints."""

import logging
import re
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

log = logging.getLogger(__name__)

from ..auth import CurrentUser, current_user, current_user_or_none, profile_complete_user, verified_user
from ..celery_app import dispatch_job
from ..config import get_settings
from ..db import get_session
from ..models import Compound, DockingResult, Job, JobStatus, ScreeningJob, ScreeningResult
from ..schemas import (
    CompoundOut,
    DockingResultOut,
    JobCreate,
    JobOut,
    JobUpdate,
)
from ..services.pose_store import get_pose_store
from ..services.rate_limit import JOBS_LIMIT

# Same shape used in structures.py: variant must look like "WT" or "T790M"
# style. URL-controlled values get baked into a path lookup, so we validate
# format first and confine the resolved path to POSE_CACHE.
_VARIANT_RE = re.compile(r"^(WT|[A-Za-z][0-9]+[A-Za-z]([+_][A-Za-z0-9]+)*(del|ins[A-Za-z]+)?)$")

router = APIRouter(prefix="/jobs", tags=["jobs"])

# (U17) Secondary router whose ONLY purpose is to expose the list
# endpoint under a path that doesn't trigger ad-blockers. uBlock
# Origin / EasyPrivacy / Brave Shields all carry filter rules that
# match BARE ROOT-LEVEL collection paths like `/jobs` and `/runs`
# as tracking patterns, blocking the request before it ever leaves
# the browser. Confirmed in the user's own browser:
#   /jobs        → Failed to fetch
#   /runs        → Failed to fetch    ← first attempt at fix, still blocked
#   /me/runs     → request goes through
#   /fep/studies → works
#   /me/profile  → works
# Pattern: root-level single-word paths are flagged; nested paths
# (a `/me/` or `/fep/` prefix) bypass the filter.
#
# Mitigation: register `GET /me/runs` as a 1-line alias that
# delegates to list_jobs(). The frontend's History page calls
# /me/runs instead of /jobs. Detail endpoints (/jobs/{share_id},
# /jobs/{id}/cancel, etc.) stay on /jobs — per-id suffixes break
# the filter pattern so they keep working.
#
# We keep /jobs (collection) working too for backward compat: old
# share links, the validation harness in scripts/validation/run.py,
# and any external integrations that crawl the API still resolve.
runs_router = APIRouter(prefix="/me", tags=["jobs"])


def _resolve_job(session: Session, key: str, *, allow_integer_id: bool = True) -> Job | None:
    """Resolve either a legacy integer job ID or a public share_id to a Job.

    URLs the frontend creates use `share_id` (random base64url token); URLs in
    bookmarks or older tabs may use the integer primary key. Try integer first
    only when the path looks like one — short numeric strings — to avoid a
    spurious DB hit on every share_id.

    `allow_integer_id=False` resolves ONLY via the unguessable share_id —
    the sequential integer PK is rejected. The owner-scoped callers
    (cancel/patch/delete) keep the default True because they re-check
    ownership anyway; the PUBLIC read path goes through _resolve_job_public
    which sets this False so /jobs/<int> can't be enumerated to scrape
    other users' jobs.
    """
    if allow_integer_id and key.isdigit() and len(key) <= 9:
        job = session.get(Job, int(key))
        if job:
            return job
    return session.exec(select(Job).where(Job.share_id == key)).first()


def _resolve_job_public(
    session: Session, key: str, user: "CurrentUser | None"
) -> Job | None:
    """Resolve a job for a PUBLIC, unauthenticated-allowed read endpoint.

    The unguessable share_id always resolves — share links are public by
    design. The enumerable integer primary key resolves ONLY for the
    authenticated owner, so a legacy /jobs/<int> bookmark still works for
    the person who created the job, but an anonymous or third-party caller
    can't walk /jobs/1, /jobs/2, … to scrape everyone's compounds, scores
    and poses. This closes the integer-PK enumeration hole without
    breaking share links or owner bookmarks.
    """
    job = _resolve_job(session, key, allow_integer_id=False)  # share_id only
    if job is not None:
        return job
    # share_id miss — it may be a legacy integer PK. Owner-only.
    if user is not None and key.isdigit() and len(key) <= 9:
        job = session.get(Job, int(key))
        if job is not None and job.user_id and str(job.user_id) == str(user.id):
            return job
    return None


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
        ensemble=bool(getattr(job, "ensemble", False)),
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
    # profile_complete_user wraps verified_user (which wraps current_user) so
    # this single dep enforces auth + email-verified + profile-complete in
    # one shot. The frontend's ProfileRedirect blocks the same condition,
    # this is the server-side defense-in-depth so a tampered client can't
    # bypass — see auth.profile_complete_user docstring for context.
    user: CurrentUser = Depends(profile_complete_user),
    session: Session = Depends(get_session),
) -> JobOut:
    # Schema validator already normalized the pdb_id (uppercase for RCSB IDs,
    # case-preserved for USR_ uploads). Re-uppercasing here would corrupt
    # USR_ tokens since the lookup-router stores files with lowercase hex —
    # any extra .upper() breaks the runner's file lookup.

    # ── Per-user lifetime job quota ─────────────────────────────────────
    # Each user starts with a default quota of 10 (column DEFAULT in
    # migration 007); admin can raise it per user via PATCH /admin/users/{id}.
    # We count pending+running+completed jobs against the quota.
    # Failed/cancelled don't count — the user shouldn't be penalized for
    # a Pod failure or a fat-finger cancel. Quota of 0 = effectively
    # banned from new submissions but existing jobs continue.
    # NB Postgres native enum jobstatus stores uppercase enum NAMES
    # (PENDING, RUNNING, COMPLETED) rather than the Python str values
    # (pending, running, completed). Lowercase comparisons hit
    # "invalid input value for enum jobstatus" — discovered the hard way
    # when /jobs went 500 the first time after this check shipped.
    #
    # Quota check + Job insert run inside this request's implicit
    # transaction. We hold an advisory lock keyed on user_id for the
    # transaction's duration so two concurrent POST /jobs from the same
    # user serialise instead of both seeing "under quota" and both
    # inserting — TOCTOU race called out in the May 2026 audit (#251).
    #
    # Compute the lock key in Python rather than via SQL's hashtext()
    # because the inline cast `:uid::text` triggers a SQLAlchemy text()
    # parser bug (Sentry issue 2026-05-13: psycopg2.errors.SyntaxError
    # "syntax error at or near :"). md5+8-byte-truncation gives the
    # same property pg_advisory_xact_lock wants (a stable bigint per
    # user_id) without needing Postgres-side hashing.
    import hashlib as _hashlib
    _uid_str = str(user.id)
    _lock_key = int.from_bytes(
        _hashlib.md5(_uid_str.encode()).digest()[:8],
        "big",
        signed=True,
    )
    session.execute(
        text("SELECT pg_advisory_xact_lock(:k)"),
        {"k": _lock_key},
    )
    quota_row = session.execute(
        text(
            "SELECT COALESCE(p.job_quota, 10) AS quota,"
            " (SELECT COUNT(*) FROM job j"
            "  WHERE j.user_id = :uid AND j.status IN ('PENDING','RUNNING','COMPLETED')"
            " ) AS used"
            " FROM (SELECT 1) _"
            " LEFT JOIN public.user_profile p ON p.user_id = :uid"
        ),
        {"uid": user.id},
    ).mappings().first()
    quota = int(quota_row["quota"]) if quota_row else 10
    used = int(quota_row["used"]) if quota_row else 0
    if used >= quota:
        # 402 Payment Required is the closest semantic match in HTTP for
        # "you've used your free allocation". The frontend special-cases
        # 402 to render a friendlier "you've used your N free dockings —
        # contact us if you'd like more" rather than a generic error.
        raise HTTPException(
            status_code=402,
            detail=(
                f"You've used all {quota} of your free dockings. "
                "Get in touch via the Contact page if you'd like more."
            ),
            headers={"X-Quota-Used": str(used), "X-Quota-Limit": str(quota)},
        )

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
        # Same canonical pre-flight the Quick Dock path uses (services
        # .properties.check_dockability) — atom allowlist + size bounds
        # (Vina's flexibility model breaks down past ~80 heavy atoms).
        # Wiring it in here closes the gap that let a 1.8 kDa cyclic
        # peptide (126 heavy atoms, 29 rotatable bonds) into job #303
        # only to fail mid-run with an opaque "docking_failed: batch err:
        # no pose written" cell. Now it's rejected at submit with a clear
        # reason. Imported inside the try so a dev box without RDKit
        # still skips eager validation rather than fail-closed.
        from ..services.properties import check_dockability
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
            # Dockability / size pre-flight — the SAME check_dockability the
            # Quick Dock path runs. Catches molecules that parse + embed
            # fine but are too large / too complex for Vina-family docking
            # (>~80 heavy atoms), or contain atoms Vina/GNINA can't score.
            # Without this they'd run and fail per-cell with an opaque
            # "docking_failed" badge; here the user gets the real reason
            # (e.g. "126 heavy atoms — too large for Vina-style docking")
            # at submit time, before any GPU time is spent.
            try:
                dock_check = check_dockability(smi)
                if not dock_check.get("dockable", True):
                    invalid.append({
                        **row_base,
                        "reason": dock_check.get("reason")
                        or "This molecule can't be docked by Vina/GNINA.",
                        "kind": "undockable",
                        **(
                            {"suggestion": dock_check["suggestion"]}
                            if dock_check.get("suggestion")
                            else {}
                        ),
                    })
                    continue
            except Exception:
                # check_dockability never raises by contract — belt-and-
                # suspenders so a check bug can't block a valid submit.
                pass
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

    # Pro-tier gate: GNINA is Pro only. Free tier sees a 402 with a
    # "contact us" message; the frontend Studio also hides/locks the
    # button so this is defense-in-depth for a direct API call.
    if payload.engine == "gnina":
        from ..auth import is_pro_user
        if not is_pro_user(user.id, session):
            raise HTTPException(
                status_code=402,
                detail={
                    "message": (
                        "GNINA docking is a Liganx Pro feature. "
                        "Free tier supports AutoDock Vina. "
                        "Contact us to upgrade your account."
                    ),
                    "feature": "gnina",
                    "contact_url": "https://liganx.com/contact",
                },
            )

    # Ensemble-docking access gate. Ensemble docking is UNGATED BY DEFAULT
    # — this rejects ONLY users an admin has explicitly switched off
    # (user_profile.ensemble_enabled = FALSE). It is NOT a Pro paywall;
    # 402 here means "an admin disabled this for your account", not "pay
    # to unlock". The Studio also disables the toggle for these users, so
    # this is defense-in-depth for a direct API call.
    if payload.ensemble:
        from ..auth import ensemble_access_allowed
        if not ensemble_access_allowed(user.id, session):
            raise HTTPException(
                status_code=402,
                detail={
                    "message": (
                        "Ensemble docking has been disabled for your account "
                        "by an administrator. Contact us if you believe this "
                        "is a mistake."
                    ),
                    "feature": "ensemble",
                    "contact_url": "https://liganx.com/contact",
                },
            )

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
        ensemble=payload.ensemble,
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


# ──────────────────────────────────────────────────────────────────────
# Promote-from-Screening (v1.22 / #233)
# ──────────────────────────────────────────────────────────────────────
#
# A Full Job created via promote-from-screening reuses the docking
# scores + pose files that the screening already produced. We don't
# re-run Vina because:
#   1. The screening already docked these compounds against this exact
#      (target, mutation) at exhaustiveness=4. With a fixed seed,
#      re-docking at exhaustiveness=8 moves the score by ~0.1 kcal/mol
#      worst-case — barely above single-seed noise.
#   2. The user's intent on clicking "promote" is to see the 3D pose +
#      ADMET + AI Variants panel. None of that requires a fresh dock —
#      pose viewer reads pose_uri, ADMET is pose-agnostic, AI Variants
#      kicks off its own dock per generated SMILES.
#
# The trade we accept: hits/misses / pocket-contact analysis (which
# JobPage renders below the pose) is currently embedded in the dock
# pipeline's `validate_pose` step (see audit). Imported jobs don't get
# that section. JobPage already renders gracefully when the `extra`
# field lacks contacts data, so this degrades cleanly to "score + pose
# + ADMET only" without breaking.
#
# Tracking the source screening: stored in Job.tags as a
# `promoted-from-screening:<screening_share_id>` token. Avoids a schema
# migration for v1.22; can be promoted to a proper FK column later if
# we add more cross-Job relationships.

class PromoteFromScreeningPayload(BaseModel):
    """Request body for POST /jobs/from-screening."""
    screening_share_id: str = Field(min_length=1, max_length=64)
    compound_ids: list[int] = Field(min_length=1, max_length=5)
    title: str | None = Field(default=None, max_length=200)


_PROMOTE_TAG_PREFIX = "promoted-from-screening:"


@router.post(
    "/from-screening",
    response_model=JobOut,
    status_code=201,
    dependencies=[Depends(JOBS_LIMIT)],
)
def create_job_from_screening(
    payload: PromoteFromScreeningPayload,
    user: CurrentUser = Depends(profile_complete_user),
    session: Session = Depends(get_session),
) -> JobOut:
    """Import a slice of a screening's results as a brand-new Full Job.

    The new Job lands in COMPLETED state with DockingResult rows
    pre-populated from the matching ScreeningResult rows (scores +
    pose files cloned via pose_store.clone). No GPU work — the
    response returns within ~1s for a typical 5-compound promotion.

    Auth: same `profile_complete_user` gate as POST /jobs. Per-user
    job quota applies (this DOES count, since it produces a real Job
    that shows up in History). Rate limit also applies via the
    JOBS_LIMIT dependency on the route.
    """
    # 1. Find the source screening + verify ownership.
    sj = session.exec(
        select(ScreeningJob).where(ScreeningJob.share_id == payload.screening_share_id)
    ).first()
    if sj is None:
        raise HTTPException(status_code=404, detail="Screening not found")
    # Ownership gate. Two cases that must BOTH reject:
    #   (a) Screening has a real owner that isn't the caller — clear leak path.
    #   (b) Screening has NO owner (user_id IS NULL) — these are pre-auth
    #       orphans from the v1.20 era. Without a positive ownership claim,
    #       any logged-in user could promote anyone else's anonymous
    #       screening. Treat as 404 so share_ids can't be enumerated; admins
    #       can adopt orphans via a separate admin tool if needed.
    if sj.user_id is None or sj.user_id != user.id:
        raise HTTPException(status_code=404, detail="Screening not found")

    # 2. Pull the screening's result rows for the requested compounds.
    selected_ids = list(set(payload.compound_ids))
    src_rows = session.exec(
        select(ScreeningResult)
        .where(ScreeningResult.screening_job_id == sj.id)
        .where(ScreeningResult.compound_id.in_(selected_ids))
    ).all()
    if not src_rows:
        raise HTTPException(
            status_code=422,
            detail="None of the requested compounds belong to that screening.",
        )

    # At least one mutant row must have docked successfully — otherwise
    # there's nothing to promote. WT-only screenings hit this branch
    # if WT failed; legit failure path.
    ok_rows = [r for r in src_rows if r.status == "ok" and r.best_score is not None]
    if not ok_rows:
        raise HTTPException(
            status_code=422,
            detail=(
                "Selected screening rows have no completed docks. "
                "Wait for the screening to finish or pick rows with status=ok."
            ),
        )

    # 3. Per-user lifetime job quota — same logic as create_job. Imported
    #    Jobs DO count: they create a real Job row that shows in History.
    # Hold a Postgres transactional advisory lock keyed on the user_id
    # for the duration of THIS request's transaction. Two concurrent
    # promotes from the same user serialise behind it instead of both
    # reading "under quota" + inserting (the TOCTOU race called out in
    # the May 2026 audit, #251). hashtext(uuid::text) collapses the
    # UUID to a bigint key — collisions across users only cost a
    # negligible amount of serialisation, never correctness.
    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:uid::text)::bigint)"),
        {"uid": user.id},
    )
    quota_row = session.execute(
        text(
            "SELECT COALESCE(p.job_quota, 10) AS quota,"
            " (SELECT COUNT(*) FROM job j"
            "  WHERE j.user_id = :uid AND j.status IN ('PENDING','RUNNING','COMPLETED')"
            " ) AS used"
            " FROM (SELECT 1) _"
            " LEFT JOIN public.user_profile p ON p.user_id = :uid"
        ),
        {"uid": user.id},
    ).mappings().first()
    quota = int(quota_row["quota"]) if quota_row else 10
    used = int(quota_row["used"]) if quota_row else 0
    if used >= quota:
        raise HTTPException(
            status_code=402,
            detail=(
                f"You've used your {quota} free dockings. Contact us if "
                "you'd like more."
            ),
        )

    # 4. Build the Job shell. Status=COMPLETED from the jump — there's
    #    no async work pending. Mutations come from the screening so
    #    we never accidentally widen the set on import.
    mutations_list = [m for m in (sj.mutations or "").split(",") if m]
    mut_label = "+".join(mutations_list) if mutations_list else "WT"
    auto_title = (
        payload.title
        or f"Promoted from Screening · {sj.pdb_id} · {mut_label} · {len(selected_ids)} cmpd"
    )
    # Carry forward any tags the source screening had + add the
    # promote marker so the JobPage UI can render the back-link.
    tags = list(sj.tags or [])
    tags.append(f"{_PROMOTE_TAG_PREFIX}{sj.share_id}")

    job = Job(
        pdb_id=sj.pdb_id,
        chain=sj.chain,
        uniprot_id=None,  # screening doesn't track uniprot; not needed for read-only Job
        mutations=sj.mutations or "",
        # Use the screening's exhaustiveness so the score row reads as
        # "from a screening" not "from a Full Job at exh=8". Lying
        # about exhaustiveness here would be a data-integrity bug.
        exhaustiveness=sj.exhaustiveness or 4,
        include_wt=True,  # screening always produces WT rows; preserve
        engine=sj.engine or "quickvina2_gpu",
        status=JobStatus.COMPLETED,
        user_id=user.id,
        title=auto_title,
        tags=tags,
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    # 5. Materialize Compound rows owned by the new Job. The screening's
    #    Compound rows may have job_id=NULL (compounds are shared); we
    #    create fresh ones FK'd to this Job so JobPage's lookup chain
    #    works exactly like a freshly-submitted Job.
    src_compounds_by_id = {
        c.id: c
        for c in session.exec(
            select(Compound).where(Compound.id.in_(selected_ids))
        ).all()
    }
    src_to_new_compound: dict[int, Compound] = {}
    for src_cid in selected_ids:
        src_c = src_compounds_by_id.get(src_cid)
        if src_c is None:
            continue
        new_c = Compound(job_id=job.id, name=src_c.name, smiles=src_c.smiles)
        session.add(new_c)
        src_to_new_compound[src_cid] = new_c
    session.commit()
    for new_c in src_to_new_compound.values():
        session.refresh(new_c)

    # 6. Copy ScreeningResult rows → DockingResult rows. Clone pose
    #    files so the new Job's pose viewer can resolve them without
    #    fishing for the old screening's URI conventions. The clone
    #    method on pose_store handles LocalDisk + R2 server-side copy.
    store = get_pose_store()
    for sr in src_rows:
        if sr.compound_id not in src_to_new_compound:
            continue
        new_c = src_to_new_compound[sr.compound_id]

        new_pose_uri: str | None = None
        if sr.pose_uri:
            try:
                new_pose_uri = store.clone(
                    sr.pose_uri, job.id, new_c.id, sr.variant,
                )
            except Exception as e:
                # A missing source file or transient R2 error shouldn't
                # take down the whole promote — fall back to no pose
                # for this cell. The user will see the score but the
                # 3D viewer for that cell will show "pose unavailable".
                log.warning(
                    "promote-from-screening %s: pose clone failed for compound=%s variant=%s: %s",
                    sj.share_id, sr.compound_id, sr.variant, e,
                )
                new_pose_uri = None

        # Carry the screening's extras forward so any outside-pocket
        # flag / FoldX ddg / engine tag survives the import.
        new_extra = sr.extra
        # Stamp the cell with its provenance so the AI panel can know
        # "this score came from a screening, not from a dedicated dock".
        provenance = f"source=screening|screening_id={sj.share_id}"
        new_extra = f"{provenance}|{new_extra}" if new_extra else provenance

        dr = DockingResult(
            job_id=job.id,
            compound_id=new_c.id,
            variant=sr.variant,
            best_score=sr.best_score if sr.best_score is not None else 0.0,
            pose_uri=new_pose_uri,
            extra=new_extra,
        )
        session.add(dr)
    session.commit()
    session.refresh(job)

    log.info(
        "promote-from-screening: created job %s from screening %s "
        "(%d compounds, %d cells)",
        job.share_id, sj.share_id, len(src_to_new_compound), len(src_rows),
    )
    return _to_out(job)


@router.get("/{job_key}", response_model=JobOut)
def get_job(
    job_key: str,
    session: Session = Depends(get_session),
    user: CurrentUser | None = Depends(current_user_or_none),
) -> JobOut:
    """Fetch a job by its share_id (public, by design) or — for the
    authenticated owner only — its legacy integer primary key. The
    integer PK is no longer resolvable by anonymous/third-party callers,
    so /jobs/<int> can't be enumerated to scrape other users' jobs."""
    job = _resolve_job_public(session, job_key, user)
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
    # (U11) Bypass SQLAlchemy enum-name serialisation. The default
    # `Enum(JobStatus)` column type sends the enum MEMBER NAME
    # ("CANCELLED") to Postgres rather than its VALUE ("cancelled"),
    # and the live jobstatus enum stores lowercase. Result: prior code
    # `job.status = JobStatus.CANCELLED` produced
    #   psycopg2.errors.InvalidTextRepresentation:
    #     invalid input value for enum jobstatus: "CANCELLED"
    # Raw UPDATE with the lowercase literal sidesteps the mapping
    # entirely. Migration 024 also ensures the enum contains 'cancelled'.
    from sqlalchemy import text as _text
    session.execute(_text(
        "UPDATE job"
        "   SET status = 'cancelled',"
        "       error_message = :msg,"
        "       updated_at    = now()"
        " WHERE id = :id"
    ), {"msg": "Cancelled by user", "id": job.id})
    session.commit()
    session.refresh(job)
    return _to_out(job)


class JobReport(BaseModel):
    """User-supplied comment when reporting a job issue. Owner-only."""
    comment: str = Field(..., min_length=1, max_length=2000)


@router.post("/{job_key}/report", status_code=204)
def report_job(
    job_key: str,
    payload: JobReport,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> None:
    """User-side issue report on any job they own.

    Triggers a Telegram alert with the user's comment plus job context
    so we can triage. Most useful on FAILED jobs (where the user has a
    specific complaint about why it broke), but allowed on any status —
    sometimes the issue is "I expected X but got Y" on a COMPLETED run.

    Returns 204 with no body. Errors:
      - 404 for non-owners (so a stranger with a guessed share-link
        can't probe job existence)
      - 422 for empty/oversized comments (Pydantic enforces)

    Rate limiting: deliberately none beyond ownership — if a user fires
    50 reports about the same job, we want to see all 50 because we'll
    likely respond to one and dedupe ourselves.
    """
    job = _resolve_job(session, job_key)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Job not found")

    # Best-effort user email lookup for the alert. auth.users is
    # Supabase-managed but readable through our service-role connection.
    user_email: str | None = None
    try:
        row = session.execute(
            text("SELECT email FROM auth.users WHERE id = :uid"),
            {"uid": str(job.user_id)},
        ).first()
        if row:
            user_email = row[0]
    except Exception:
        # Email lookup is decoration; never let it block the report.
        pass

    try:
        from ..services.notifications import notify_user_report
        notify_user_report(
            job_id=job.id,
            share_id=job.share_id,
            pdb_id=job.pdb_id,
            mutations=job.mutations or "",
            engine=job.engine or "",
            job_status=str(job.status.value if hasattr(job.status, "value") else job.status),
            user_email=user_email,
            user_id=str(job.user_id) if job.user_id else None,
            user_comment=payload.comment,
            error_message=job.error_message,
        )
    except Exception:
        # Notification failure shouldn't 500 the report — the user gets
        # a 204 either way and we'll see the failure in Fly logs.
        log.exception("notify_user_report failed for job %s", job.id)


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


# (U17 → U17d) Alias for GET /jobs. The route exists in two flavors so
# the frontend can fall back when uBlock / EasyPrivacy / Brave Shields
# dynamically learn the GET pattern:
#
#   • GET  /me/dockings?offset=&limit=    — preferred, semantic
#   • POST /me/dockings  body {offset, limit}
#                        — fallback used by listJobs() in api.ts. POST
#                          with a JSON body has no offset=/limit= URL
#                          fingerprint for filter lists to match on,
#                          which is the actual pattern uBlock learns
#                          (not the path word itself).
#
# Both delegate to list_jobs() so semantics and auth are identical.
class _ListPageBody(BaseModel):
    offset: int = 0
    limit: int = 25

@runs_router.get("/dockings/{token}.json", response_model=list[JobOut])
def list_runs(
    token: str,  # noqa: ARG001 — cache-buster only; ignored
    limit: int = Query(20, ge=1, le=200, description="Max jobs to return (1-200)"),
    offset: int = Query(0, ge=0, description="Skip this many jobs (for pagination)"),
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> list[JobOut]:
    """Ad-blocker-evading alias for GET /jobs.

    `{token}` is a random per-request token (8-char base36) that the
    frontend regenerates on every call. Combined with the `.json`
    suffix, this defeats uBlock / EasyPrivacy / Brave Shields
    dynamic-learning entirely: filter lists can't learn a pattern
    that never repeats, and they treat `.json` paths as static
    assets which exempts them from tracker matching.

    Server-side the token is purely a cache-buster — it's not
    validated, not logged for auth purposes, and not used for
    anything. Same auth, same response shape, same pagination
    semantics as GET /jobs.

    History of this dance:
      U17a  /runs              — blocked
      U17b  /me/runs           — blocked
      U17c  /me/dockings       — blocked after first use
      U17d  POST /me/dockings  — also blocked
      U17e  /me/dockings.json  — also blocked after first use
      U17f  /me/dockings/{token}.json — uBlock can't learn a moving
                                        target. End of chase.
    """
    return list_jobs(limit=limit, offset=offset, user=user, session=session)


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
        ensemble=bool(getattr(job, "ensemble", False)),
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
    user: CurrentUser | None = Depends(current_user_or_none),
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

    # Resolve job_key → Job. share_id is public; the integer PK resolves
    # for the owner only, so pose files can't be scraped by enumeration.
    job = _resolve_job_public(session, job_key, user)
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


@router.get("/{job_key}/review")
async def chemist_review(
    job_key: str,
    compound_id: int | None = Query(default=None),
    variant: str | None = Query(default=None),
    session: Session = Depends(get_session),
    user: CurrentUser | None = Depends(current_user_or_none),
) -> dict:
    """Chemist-style sanity review of a docking result (S1).

    Picks the best (most-negative) pose for this job by default, or a
    specific (compound_id, variant) if both query params are given.
    Calls the chemist_review service which:
      • Parses the runner's already-computed extras (PoseBusters, ProLIF
        contacts, MMFF94 strain, FoldX ΔΔG, BSA, H-bond count, Vina-term
        split) — same metrics the matrix UI shows.
      • Loads the target's catalog metadata for context.
      • Asks Claude Haiku for a chemist verdict in strict JSON form.
      • Returns it as a ChemistReview dict.

    PUBLIC by share_id, owner-only for the integer PK — matches the
    /poses endpoint's visibility model.

    Errors:
      404 — job not found, or no docking result for the picked pose
      503 — ANTHROPIC_API_KEY not configured on this deployment
      502 — Anthropic returned a non-success response
    """
    import os
    from ..catalog import get_target
    from ..services.chemist_review import review_pose

    job = _resolve_job_public(session, job_key, user)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Pick the pose to review. Specific (compound, variant) if both given;
    # otherwise the best-scoring row for this job.
    if compound_id is not None and variant is not None:
        if not _VARIANT_RE.match(variant):
            raise HTTPException(status_code=400, detail="invalid variant format")
        result = session.exec(
            select(DockingResult)
            .where(DockingResult.job_id == job.id)
            .where(DockingResult.compound_id == compound_id)
            .where(DockingResult.variant == variant)
        ).first()
    else:
        result = session.exec(
            select(DockingResult)
            .where(DockingResult.job_id == job.id)
            # Skip placeholder failure rows (best_score == 0 with no pose)
            # — picking those as "best" would always trigger the failed-
            # docking short-circuit and waste a Claude call.
            .where(DockingResult.best_score < 0)
            .order_by(DockingResult.best_score.asc())   # type: ignore[attr-defined]
        ).first()
    if not result:
        raise HTTPException(status_code=404, detail="No docking result to review")

    compound = session.get(Compound, result.compound_id)
    if not compound:
        raise HTTPException(status_code=404, detail="Compound not found")

    target = get_target(job.pdb_id)

    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=(
                "ANTHROPIC_API_KEY is not configured on this server — the "
                "chemist reviewer can't run. Set it via Fly secrets."
            ),
        )

    try:
        review = await review_pose(
            compound_smiles=compound.smiles,
            compound_name=compound.name or f"compound #{compound.id}",
            target_id=target.id if target else (job.pdb_id or "unknown"),
            target_name=target.name if target else (job.pdb_id or "Unknown target"),
            target_uniprot=(target.uniprot if target else (job.uniprot_id or "")),
            pdb_id=job.pdb_id,
            chain=job.chain,
            variant=result.variant,
            indications=(target.indications if target else []),
            docked_score=result.best_score,
            extra=result.extra,
            api_key=api_key,
            # (T2) Pipe catalog trust signals through so the chemist
            # agent can defer to them and the clamp can backstop.
            druggability=(target.druggability if target else "untested"),
            druggability_note=(target.druggability_note if target else ""),
            canonical_pocket_residues=(target.canonical_pocket_residues if target else []),
            typical_vina_range=(target.typical_vina_range if target else None),
        )
    except RuntimeError as e:
        # Anthropic-side error (network, auth, rate-limit, parse). Map to
        # 502 so monitoring can distinguish it from our own bugs (5xx).
        raise HTTPException(status_code=502, detail=str(e))

    return {
        "job_id": job.id,
        "share_id": job.share_id,
        "compound_id": result.compound_id,
        "compound_name": compound.name,
        "variant": result.variant,
        "score": result.best_score,
        "review": review.to_dict(),
    }


# ────────────────────────── MM-GBSA rescoring (F2) ─────────────────────────
#
# Opt-in second-pass rescoring of a docked pose with single-snapshot
# one-trajectory MM-GBSA — Amber14SB + OpenFF Sage 2.2 + OBC2 implicit
# solvent. ~30-90 s per pose on the pod. See services/mmgbsa.py for the
# protocol caveats and docs/fep_plus_design.md for the broader plan.
#
# The endpoint is per-pose and on-demand — NOT triggered automatically on
# every cell. Cost would balloon and the science value is in rank-ordering
# a small set of candidate hits, not in rescoring every Δ-mutant cell.


@router.post("/{job_key}/results/{compound_id}/{variant}/mmgbsa")
def rescore_with_mmgbsa(
    job_key: str,
    compound_id: int,
    variant: str,
    session: Session = Depends(get_session),
    user: CurrentUser = Depends(current_user),
) -> dict:
    """Rescore a docked pose with MM-GBSA. Persists ΔG back into
    DockingResult.extra and returns the breakdown.

    Errors:
      400 — bad variant format
      401 — unauthenticated
      404 — job not found OR not owned by this user (shape matches
            the cancel/PATCH/DELETE owner pattern so an enumeration
            attempt on share_ids can't distinguish 'no such job' from
            'belongs to someone else')
      503 — pod not configured, or pod missing openff-toolkit
            (returned with a clear actionable error so the operator
            knows to pip-install on the pod)
      502 — pod transport error (timeout, network, 5xx)
      500 — pose-to-SDF conversion failed (obabel missing or borked
            pose)

    Auth: Final-verification audit C1 — this is a WRITE endpoint
    (mutates DockingResult.extra + burns 30-90 s of pod GPU per
    call) so it must be OWNER-only, not public-by-share-id like
    /poses or /review. Mirrors the established /cancel and DELETE
    pattern in this router. See docs/mmgbsa_phase_a_audit.md (and
    the final verification report) for the rationale.
    """
    import shutil as _shutil
    import subprocess as _subprocess
    import tempfile as _tempfile

    from ..services.mmgbsa import MmgbsaError, merge_into_extra, rescore_pose
    from ..services.pose_store import get_pose_store
    from ..services.receptor_prep import prepare_receptor_for_target
    from ..config import get_settings

    if not _VARIANT_RE.match(variant):
        raise HTTPException(status_code=400, detail="invalid variant format")

    # Owner-only lookup. Same pattern as /report (line 915) and
    # /cancel — _resolve_job + an explicit user_id check guarantees
    # a stranger with a guessed share-link can't probe job existence.
    job = _resolve_job(session, job_key)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Job not found")

    result = session.exec(
        select(DockingResult)
        .where(DockingResult.job_id == job.id)
        .where(DockingResult.compound_id == compound_id)
        .where(DockingResult.variant == variant)
    ).first()
    if not result or not result.pose_uri:
        raise HTTPException(status_code=404, detail="Pose not found")
    if result.best_score is None or result.best_score >= 0:
        # No real docked pose — same guard the chemist-review endpoint
        # uses. MM-GBSA on a failure-placeholder row is meaningless.
        raise HTTPException(
            status_code=400,
            detail="No docked pose to rescore (best_score >= 0 indicates a failed dock)",
        )

    # ─── Re-prepare the receptor (same paths the runner uses) ───────
    # We re-use the receptor_prep service so the receptor PDB the MM-
    # GBSA endpoint sees is BIT-FOR-BIT identical to what produced the
    # pose. Cache-hits ride the same /var/lib/liganx/.../receptor cache
    # as the runner, so this is fast (~milliseconds) for any cell whose
    # job has finished.
    settings = get_settings()
    try:
        rprep = prepare_receptor_for_target(
            pdb_id=job.pdb_id,
            chain=job.chain or "A",
            mutation=None if variant == "WT" else variant,
            pdb_cache=Path(settings.pose_cache) / "pdb",
            receptor_cache=Path(settings.pose_cache) / "receptors",
        )
    except Exception as e:                                           # noqa: BLE001
        raise HTTPException(
            status_code=500,
            detail=f"Receptor prep failed for {job.pdb_id}_{job.chain} {variant}: {e}",
        )
    receptor_pdb_text = rprep.receptor_pdb.read_text()

    # ─── Fetch the docked pose, convert PDBQT → SDF ─────────────────
    # The pod's MM-GBSA needs an SDF (3D coords + bond orders) — Vina
    # output is PDBQT which doesn't carry the bond-order info openff-
    # toolkit needs for parameterisation. Open Babel handles the
    # conversion. Same dependency the /poses endpoint relies on; if
    # obabel isn't available the rescore can't run.
    if not _shutil.which("obabel"):
        raise HTTPException(
            status_code=500,
            detail="Open Babel (obabel) not installed on this backend — "
                   "required for PDBQT → SDF conversion before MM-GBSA",
        )
    try:
        pose_raw = get_pose_store().read(result.pose_uri)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Pose file not in storage")
    except Exception:
        raise HTTPException(status_code=410, detail="Pose file no longer cached")
    if not pose_raw:
        raise HTTPException(status_code=410, detail="Pose file empty")
    pose_pdbqt_text = pose_raw.decode("utf-8", errors="replace")
    # Extract MODEL 1 only (best-scoring pose) — same logic as /poses.
    if "MODEL" in pose_pdbqt_text:
        out_lines: list[str] = []
        in_first = False
        for line in pose_pdbqt_text.splitlines(keepends=True):
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
        best_pdbqt_text = "".join(out_lines)
    else:
        best_pdbqt_text = pose_pdbqt_text

    with _tempfile.TemporaryDirectory() as td:
        in_path = Path(td) / "pose.pdbqt"
        out_path = Path(td) / "pose.sdf"
        in_path.write_text(best_pdbqt_text)
        # (Audit fix #5) `-p 7.4` re-protonates at physiological pH.
        # Without this, Open Babel's default tautomer/charge rules
        # mis-protonate basic amines on ~30-40% of kinase inhibitors,
        # which then yields wrong AM1-BCC charges in MM-GBSA. This is
        # a partial mitigation; the full fix is to round-trip through
        # the input SMILES (see audit doc, Phase A.1). Logged as
        # mmgbsa_phase_a_audit.md issue #5.
        res = _subprocess.run(
            ["obabel", str(in_path), "-O", str(out_path), "-p", "7.4"],
            capture_output=True, text=True, check=False,
        )
        if res.returncode != 0 or not out_path.exists() or out_path.stat().st_size == 0:
            raise HTTPException(
                status_code=500,
                detail=f"PDBQT → SDF conversion failed: {res.stderr.strip()[:200]}",
            )
        ligand_sdf_text = out_path.read_text()

    # ─── Call the pod ──────────────────────────────────────────────
    try:
        mmgbsa_result = rescore_pose(
            receptor_pdb=receptor_pdb_text,
            ligand_sdf=ligand_sdf_text,
        )
    except MmgbsaError as e:
        # Map MmgbsaError.kind → HTTP code so the UI can render an
        # appropriate message. missing_deps → 503 with a clear
        # actionable signal to the operator. parameterisation → 422
        # (compound-specific issue, retry won't help). Other transport
        # / runtime → 502.
        if e.kind == "missing_deps":
            raise HTTPException(status_code=503, detail=str(e))
        if e.kind == "parameterisation":
            raise HTTPException(status_code=422, detail=str(e))
        raise HTTPException(status_code=502, detail=str(e))

    # ─── Persist into DockingResult.extra (idempotent merge) ───────
    result.extra = merge_into_extra(result.extra, mmgbsa_result)
    session.add(result)
    session.commit()

    return {
        "job_id": job.id,
        "share_id": job.share_id,
        "compound_id": result.compound_id,
        "variant": result.variant,
        "vina_score": result.best_score,
        "mmgbsa": {
            "dg_bind_kcal_mol": mmgbsa_result.dg_bind_kcal_mol,
            "e_complex_kcal_mol": mmgbsa_result.e_complex_kcal_mol,
            "e_protein_kcal_mol": mmgbsa_result.e_protein_kcal_mol,
            "e_ligand_kcal_mol": mmgbsa_result.e_ligand_kcal_mol,
            "method": mmgbsa_result.method,
            "wall_seconds": mmgbsa_result.wall_seconds,
            # (Final-verify M3) Surface the receptor RMSD in the
            # response so the UI can warn when the minimisation
            # walked too far from the docked geometry. ~0.1-0.5 Å is
            # healthy; >1.0 Å means the restraint wasn't strong
            # enough or there were significant clashes.
            "receptor_rmsd_a": mmgbsa_result.receptor_rmsd_a,
        },
    }
