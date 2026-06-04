"""Job runner.

Phase 1.5: real Vina docking, in-process.

For each (compound, variant) pair:
  - fetch the WT PDB (cached)
  - prepare receptor (PDBFixer + Open Babel → PDBQT)
  - prepare ligand (RDKit + Meeko → PDBQT)
  - dock with AutoDock Vina

Mutations aren't actually applied to the structure yet — that lands in Phase 3
(FoldX BuildModel). For now mutant docking uses the WT structure but the variant
column is preserved in the DB so the matrix layout works end-to-end.

If Vina or Meeko aren't installed, falls back to the deterministic placeholder
so the UI stays functional in dev environments without the binaries.
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
import time
from datetime import datetime
from pathlib import Path

from sqlmodel import Session, select

from ..catalog import get_target
from ..config import get_settings
from ..db import engine
from ..models import Compound, DockingResult, Job, JobStatus
# Pocket-best wrapper — added 2026-05-04 to bring the full-job docking
# paths up to Quick Dock parity. Each per-cell dock_one_pod / _gnina /
# _runpod call now goes through dock_one_with_pocket_best, which docks
# once happy-path then re-rolls up to 2 more times only when the first
# pose drifted off-pocket. See pocket_filter.py for the full rationale
# and cost analysis.
from .pocket_filter import dock_one_with_pocket_best, engine_label_with_attempts

log = logging.getLogger(__name__)
settings = get_settings()

# Cache roots — env-overridable so production can put them on the mounted
# Fly volume (/var/lib/liganx) instead of the OverlayFS upper layer (~/.deltadock).
# When LIGANX_CACHE_ROOT is unset (dev), files land under ~/.deltadock as
# before. When set (prod), all cleaned receptors and FoldX scratch live on
# the persistent volume so they survive redeploys. The 3D viewer at
# GET /structures/{pdb}/{chain}/{variant} reads from the same root.
_CACHE_ROOT = Path(settings.cache_root) if settings.cache_root else Path.home() / ".deltadock"
RECEPTOR_CACHE = _CACHE_ROOT / "receptors"
PDB_CACHE = _CACHE_ROOT / "pdb"
FOLDX_CACHE = _CACHE_ROOT / "foldx-cache"
# Persistent pose cache — runner's tmpdir gets cleaned, but the API needs poses
# to outlive the run so users can re-open jobs and the 3D viewer still works.
# In production this is overridden by `pose_cache_dir` (Fly.io volume mount);
# in dev it stays under ~/.deltadock so existing rows keep resolving without
# a data migration. See also services/pose_store.py for the R2 abstraction
# that supersedes this directory when R2 is configured.
POSE_CACHE = (
    Path(settings.pose_cache_dir) if settings.pose_cache_dir
    else _CACHE_ROOT / "poses"
)
FOLDX_PATH = os.environ.get("FOLDX_PATH", str(Path.home() / ".local" / "bin" / "foldx"))

# Auto-retry transient per-cell failures. Set DOCK_AUTO_RETRY_ENABLED=0 to
# disable in 30s if it misbehaves. The retry layer only fires for failures
# that look transient (timeouts, pod overflow, 5xx). RDKit/Meeko parse errors
# and other obviously-permanent failures skip the retry and surface as
# `docking_failed:` immediately, same as before. See _is_permanent_dock_error.
#
# Symptom this fixes: a one-off transient pod stall returns 0.00/Caution for
# a compound that docks fine on a manual re-run (e.g., Job #360 Sotorasib vs
# #361, same inputs, different outcome — the pod was warming up during #360).
DOCK_AUTO_RETRY_ENABLED = os.getenv("DOCK_AUTO_RETRY_ENABLED", "1").lower() in ("1", "true", "yes", "on")
DOCK_AUTO_RETRY_DELAY_S = float(os.getenv("DOCK_AUTO_RETRY_DELAY_S", "30"))
_MAX_DOCK_ATTEMPTS = 2 if DOCK_AUTO_RETRY_ENABLED else 1


def _is_permanent_dock_error(e: Exception) -> bool:
    """Return True if `e` is the kind of failure that won't get better with
    a retry — so we should surface it immediately instead of waiting another
    30s + retrying. Conservative on purpose: when in doubt, return False
    (retry) so the user benefits from the auto-recovery layer."""
    msg = str(e).lower()
    permanent_markers = (
        "ligand_prep",          # rdkit/meeko prep failure
        "could not parse",      # smiles parse error
        "invalid smiles",
        "embedding failed",     # rdkit 3D embed failure
        "could not embed",
        "no conformer",
        "kekulize",             # rdkit aromaticity fault
        "explicit valence",     # rdkit valence error
        "atom_type",            # meeko atom-typing failure
        "rdkit.chem.rdmolops",  # rdkit module error path
    )
    return any(m in msg for m in permanent_markers)


def _retry_sleep_cancellable(seconds: float, session, job_id) -> bool:
    """Sleep up to `seconds`, polling for job cancellation every ~5s so a
    user-initiated cancel doesn't wait out the full retry delay. Returns
    True if the job was cancelled mid-sleep. Uses the module-level
    `is_cancelled` helper defined further down in this file."""
    elapsed = 0.0
    step = 5.0
    while elapsed < seconds:
        wait_for = min(step, seconds - elapsed)
        time.sleep(wait_for)
        elapsed += wait_for
        try:
            if is_cancelled(session, job_id):
                return True
        except Exception:  # noqa: BLE001
            # is_cancelled does a DB query; if the conn is briefly bad,
            # don't crash the dock — just continue sleeping.
            pass
    return False


def _real_pipeline_available() -> tuple[bool, str | None]:
    """Check that all the binaries needed for real docking are present."""
    if not shutil.which(settings.vina_path):
        return False, f"vina binary not found ({settings.vina_path!r})"
    if not shutil.which("obabel"):
        return False, "obabel not on PATH"
    if not shutil.which("mk_prepare_ligand.py"):
        return False, "mk_prepare_ligand.py not on PATH"
    try:
        import rdkit  # noqa: F401
        import meeko  # noqa: F401
        from pdbfixer import PDBFixer  # noqa: F401
    except ImportError as e:
        return False, f"missing python dep: {e}"
    return True, None


def _foldx_available() -> bool:
    """Whether real mutation building is wired up. If False, mutants get docked
    against the WT receptor with an explicit warning recorded on each result."""
    return shutil.which(FOLDX_PATH) is not None


def _run_crossdock_in_background(pdb_id: str, chain: str) -> None:
    """Self-dock the bound co-crystal ligand for this (pdb_id, chain) and
    cache the heavy-atom RMSD-vs-crystal as a 'PDB quality' badge.

    Runs entirely off the request thread so it never blocks user-facing
    docking. Cached on disk in ~/.deltadock/crossdock-cache/ — every later
    job for the same (pdb_id, chain) hits the cache instantly.

    On any failure (apo structure, ligand prep crash, etc.) we silently
    skip; the JobPage header just doesn't show the quality badge — better
    than a noisy error. The check is informational, not on the critical
    path of producing a docking score.
    """
    try:
        import tempfile
        from pathlib import Path as _Path
        from datetime import datetime as _dt
        from deltadock_pipeline.crossdock import (
            CrossDockResult, extract_cocrystal_ligand, heavy_atom_rmsd,
            save_cached, verdict_from_rmsd,
        )
        from deltadock_pipeline.fetch import fetch_pdb
        from deltadock_pipeline.prep import fix_pdb, prepare_ligand, prepare_receptor
        from deltadock_pipeline.dock import dock_one
        from deltadock_pipeline.pocket import detect_pocket

        raw_pdb = fetch_pdb(pdb_id, PDB_CACHE)
        info = extract_cocrystal_ligand(raw_pdb, chain=chain)
        if info is None:
            log.info("crossdock %s/%s: no co-crystal ligand", pdb_id, chain)
            return

        # Reuse the existing receptor cache; if it's not there yet, do the
        # cleanup ourselves. fix_pdb is idempotent on its output path.
        clean_pdb = PDB_CACHE / f"{pdb_id}_{chain}.clean.pdb"
        if not clean_pdb.exists():
            fix_pdb(raw_pdb, clean_pdb, chain=chain)
        receptor = RECEPTOR_CACHE / f"{pdb_id}_{chain}_WT.pdbqt"
        if not receptor.exists():
            RECEPTOR_CACHE.mkdir(parents=True, exist_ok=True)
            prepare_receptor(clean_pdb, receptor)

        pocket = detect_pocket(raw_pdb, chain=chain)
        if pocket is None:
            log.info("crossdock %s/%s: no pocket centroid — skipping", pdb_id, chain)
            return

        # Box: 22.5 Å cube centred on the ligand centroid, matching what the
        # main runner uses for auto-detected pockets. dock_one expects a
        # PocketBox dataclass (center_x/y/z + size_x/y/z) — passing a dict
        # silently AttributeErrors deep inside the Vina argv builder.
        from deltadock_pipeline.dock import PocketBox
        box = PocketBox(
            center_x=pocket.center[0], center_y=pocket.center[1], center_z=pocket.center[2],
            size_x=22.5, size_y=22.5, size_z=22.5,
        )

        with tempfile.TemporaryDirectory(prefix=f"xdock-{pdb_id}-") as td:
            work = _Path(td)
            lig_pdbqt = work / "ligand.pdbqt"
            try:
                prepare_ligand(info["smiles"], lig_pdbqt)
            except Exception as e:
                log.info("crossdock %s/%s: ligand prep failed: %s", pdb_id, chain, e)
                return

            # Cheap exhaustiveness — we just need a position estimate, not
            # a publication-quality pose. 8 = matches the user's default.
            settings = get_settings()
            result = dock_one(
                receptor_pdbqt=receptor,
                ligand_pdbqt=lig_pdbqt,
                box=box,
                work_dir=work,
                exhaustiveness=8,
                num_modes=9,
                vina_path=settings.vina_path,
            )

            # Convert best mode of the docked PDBQT to SDF, then RMSD-compare
            # against the crystal PDB we extracted earlier.
            from deltadock_pipeline.validate import _convert, _extract_best_mode
            best = work / "best.pdbqt"
            _extract_best_mode(result.pose_pdbqt, best)
            docked_sdf = work / "docked.sdf"
            _convert(best, docked_sdf)

            rmsd = heavy_atom_rmsd(docked_sdf, _Path(info["lig_pdb_path"]))
            if rmsd is None:
                log.info("crossdock %s/%s: RMSD calc failed", pdb_id, chain)
                return

            res = CrossDockResult(
                pdb_id=pdb_id,
                chain=chain,
                ligand_resname=info["resname"],
                rmsd_angstroms=round(rmsd, 2),
                verdict=verdict_from_rmsd(rmsd),
                smiles=info["smiles"],
                crystal_atom_count=info["atom_count"],
                docked_atom_count=info["atom_count"],
                timestamp=_dt.utcnow().isoformat(),
            )
            save_cached(res)
            log.info(
                "crossdock %s/%s: %s ligand RMSD=%.2f Å (%s)",
                pdb_id, chain, info["resname"], rmsd, res.verdict,
            )
    except Exception as e:
        log.warning("crossdock background failed for %s/%s: %s", pdb_id, chain, e)


class JobCancelled(Exception):
    """Raised by the runner's per-cell cancellation check when a user has
    flipped this job's status to CANCELLED via POST /jobs/{key}/cancel.
    Propagates up to run_job_in_background, which logs the cancellation
    and leaves the status as CANCELLED (does NOT overwrite with FAILED)."""


def set_stage(session: Session, job_id: int, stage: str | None) -> None:
    """Write a short stage slug onto the job row so the JobPage's progress
    banner can show what's happening RIGHT NOW — and, just as importantly,
    bump ``updated_at`` so the orphan-job reaper can tell a slow-but-alive
    job from a genuinely dead one.

    Live since 2026-05-15. Previously a no-op stub (the ``stage`` column
    wasn't declared on the Job model because migration 004 wasn't reliably
    applied). Migration 004 is now in the unconditional startup-migration
    runner and ``Job.stage`` is declared again, so this writes for real.

    Fail-soft: a stage write must NEVER crash a docking job. On any error
    (transient DB blip) we log and move on — the stage is cosmetic and the
    reaper's staleness window is generous, so a missed bump isn't fatal.
    """
    try:
        job = session.get(Job, job_id)
        if job is None:
            return
        job.stage = stage
        job.updated_at = datetime.utcnow()
        session.add(job)
        session.commit()
    except Exception as e:  # noqa: BLE001
        log.warning("set_stage(%s, %r) failed (non-fatal): %s", job_id, stage, e)
        try:
            session.rollback()
        except Exception:  # noqa: BLE001
            pass


def is_cancelled(session: Session, job_id: int) -> bool:
    """Cheap re-read of the job's status from the DB. Used between cells
    in the per-cell loop. Refreshes the in-memory copy so callers see the
    latest status without us needing a Job instance threaded everywhere.
    """
    # Fetch a fresh copy via primary key — bypasses any session-cached
    # stale state from the original `job` object the runner is holding.
    fresh = session.get(Job, job_id)
    return bool(fresh and fresh.status == JobStatus.CANCELLED)


def _commit_retry(session: Session) -> None:
    """Drop-in replacement for session.commit() that survives a Postgres
    idle-drop mid-run.

    Why: the runner does ~dozens of per-cell session.add(DockingResult(...))
    + session.commit() pairs across a multi-minute pipeline. Supabase's
    pooler closes idle Postgres connections after a few minutes, and the
    very first commit() after that idle period throws
    psycopg2.OperationalError("server closed the connection unexpectedly"),
    SQLAlchemy promotes the session into a PendingRollbackError state,
    and every subsequent commit() then fails the same way until
    rollback() is explicitly called. Without recovery, a single transient
    network blip nukes the entire job — exactly what happened to job
    #261 on 2026-05-11 (and #258 before it).

    Behavior:
      1. Try session.commit(). If it works, return.
      2. On DBAPIError or PendingRollbackError, session.rollback() to
         clear the sticky bad state (this invalidates the dead connection
         and the next operation checks out a fresh one — pool_pre_ping
         in db.py validates it before handing it back).
      3. Retry session.commit() once. If THAT raises, re-raise — the
         outer except in run_job_in_background catches it and writes
         FAILED via _safe_commit (which has its own three-tier recovery
         including a brand-new Session as a last resort).

    Note: only the rows added in the CURRENT (failed) transaction are
    lost on rollback. Previously-committed cells are safe. So a retry
    only loses one cell's row, and the runner's normal flow will simply
    move on to the next compound/variant.
    """
    from sqlalchemy.exc import DBAPIError, PendingRollbackError
    try:
        session.commit()
        return
    except (DBAPIError, PendingRollbackError) as e:
        log.warning("_commit_retry: commit failed (%s); rolling back + retrying once",
                    type(e).__name__)
    session.rollback()
    session.commit()  # if this raises, let it — outer handler writes FAILED


def _maybe_notify_first_dock(session: Session, job: "Job") -> None:
    """If this is the user's first-ever COMPLETED job, fire a Telegram
    activation alert. Skips if user_id is None (anonymous job) OR if
    they've previously completed a job. The 'first ever' check uses a
    COUNT of prior COMPLETED jobs by the same user — by the time this
    runs the current job is already COMPLETED in the DB, so we look
    for any OTHER completed job.

    Cheap query (one COUNT against an indexed column). Side-effect
    only — never raises into the runner."""
    if not job.user_id:
        return
    from sqlalchemy import text as _sql_text
    prior = session.execute(
        _sql_text(
            "SELECT COUNT(*) FROM job"
            " WHERE user_id = :uid AND status::text = 'completed' AND id != :jid"
        ),
        {"uid": str(job.user_id), "jid": job.id},
    ).scalar() or 0
    if prior > 0:
        return  # not their first — quietly skip
    # Build compound summary for the alert (names, truncated)
    comp_rows = session.execute(
        _sql_text(
            "SELECT DISTINCT c.name FROM compound c"
            " JOIN dockingresult dr ON dr.compound_id = c.id"
            " WHERE dr.job_id = :jid"
        ),
        {"jid": job.id},
    ).all()
    comp_names = ", ".join(r[0] for r in comp_rows) if comp_rows else "—"
    user_row = session.execute(
        _sql_text("SELECT email FROM auth.users WHERE id = :uid"),
        {"uid": str(job.user_id)},
    ).first()
    user_email = user_row[0] if user_row else None
    from .notifications import notify_first_dock
    notify_first_dock(
        job_id=job.id,
        share_id=job.share_id,
        user_email=user_email,
        user_id=str(job.user_id),
        pdb_id=job.pdb_id,
        mutations=job.mutations or "",
        engine=job.engine or "",
        compound_summary=comp_names,
    )


def _maybe_notify_watched_completed(session: Session, job: "Job") -> None:
    """If the job's owner is on the operator's watch list, fire a Telegram
    alert with the per-compound best scores. Unlike _maybe_notify_first_dock
    this fires on EVERY completed job for a watched user (the operator
    asked for a live feed of one demo user's activity). Side-effect only —
    never raises into the runner."""
    if not job.user_id:
        return
    from sqlalchemy import text as _sql_text
    user_row = session.execute(
        _sql_text("SELECT email FROM auth.users WHERE id = :uid"),
        {"uid": str(job.user_id)},
    ).first()
    user_email = user_row[0] if user_row else None
    from .notifications import is_watched_user, notify_watch_dock_completed
    if not is_watched_user(user_email):
        return
    rows = session.execute(
        _sql_text(
            "SELECT c.name, dr.variant, dr.best_score"
            " FROM dockingresult dr JOIN compound c ON c.id = dr.compound_id"
            " WHERE dr.job_id = :jid"
            " ORDER BY dr.best_score ASC NULLS LAST"
        ),
        {"jid": job.id},
    ).all()
    if rows:
        lines = []
        for name, variant, score in rows[:14]:
            s = f"{score:.1f}" if score is not None else "failed"
            lines.append(f"{name or '—'} [{variant or 'WT'}]: {s}")
        results_summary = "\n".join(lines)
    else:
        results_summary = "(no result rows)"
    notify_watch_dock_completed(
        user_email=user_email,
        pdb_id=job.pdb_id,
        mutations=job.mutations or "",
        engine=job.engine or "",
        share_id=job.share_id,
        results_summary=results_summary,
    )


def _safe_commit(session: Session, job_id: int, *, status: JobStatus,
                 error_message: str | None = None) -> bool:
    """Commit a final job status update, surviving a poisoned session.

    Why this helper exists: the runner holds a single Session across the
    multi-minute dock pipeline. If Postgres drops the idle connection
    mid-job (Supabase pooler closes idle sockets after a few minutes),
    SQLAlchemy raises PendingRollbackError on the next commit() and the
    session refuses to do ANY work until rollback() is called. Without
    this helper, the failure path itself fails to write FAILED, the
    runner thread dies, and the job sits in RUNNING forever — exactly
    the bug that left job #258 hung overnight.

    Strategy:
      1. Try a normal commit on the existing session.
      2. If that raises (DBAPIError covers OperationalError, ConnectionError,
         and the cascade PendingRollbackError), roll back the session to
         clear its sticky bad state, then retry on the same session.
      3. If THAT still fails, open a brand-new Session(engine) so we get
         a fresh checkout from the (pre-pinged) pool, and write the
         status update there. This is the absolute last-resort path —
         it bypasses the runner's session entirely.

    Returns True iff the status was written (somewhere). Never raises;
    the caller already has more important things to do (logging the
    original failure, sending Telegram, etc.) and shouldn't have to
    care that the DB write itself was rocky.
    """
    from sqlalchemy.exc import DBAPIError, PendingRollbackError

    def _do_write(s: Session) -> None:
        j = s.get(Job, job_id)
        if j is None:
            log.warning("_safe_commit: job %s vanished before status write", job_id)
            return
        j.status = status
        if error_message is not None:
            j.error_message = error_message[:500]
        j.updated_at = datetime.utcnow()
        s.add(j)
        s.commit()

    # Attempt 1: existing session.
    try:
        _do_write(session)
        return True
    except (DBAPIError, PendingRollbackError) as e:
        log.warning("_safe_commit: existing session write failed (%s); rolling back + retrying",
                    type(e).__name__)

    # Attempt 2: rollback the dead session, retry on the same Session.
    # rollback() forces SQLAlchemy to invalidate the bad connection and
    # check out a fresh one from the pool. pool_pre_ping (db.py) ensures
    # the new checkout is alive.
    try:
        session.rollback()
        _do_write(session)
        return True
    except (DBAPIError, PendingRollbackError) as e:
        log.warning("_safe_commit: rollback+retry also failed (%s); falling back to fresh Session",
                    type(e).__name__)

    # Attempt 3: brand-new Session, totally bypass the original.
    try:
        with Session(engine) as fresh:
            _do_write(fresh)
        log.info("_safe_commit: wrote status=%s for job %s via fresh Session", status.name, job_id)
        return True
    except Exception as e:  # noqa: BLE001
        log.exception("_safe_commit: every attempt failed for job %s — DB unreachable: %s",
                      job_id, e)
        return False


def run_job_in_background(job_id: int) -> None:
    """Background entrypoint. Pulls the job, runs docking, writes results."""
    log.info("Running job %s", job_id)
    with Session(engine) as session:
        job = session.get(Job, job_id)
        if not job:
            log.error("Job %s not found", job_id)
            return

        # If the user cancelled before the worker even picked it up, honour
        # that immediately rather than transitioning to RUNNING just to
        # check again on the first cell.
        if job.status == JobStatus.CANCELLED:
            log.info("Job %s already cancelled before runner started; nothing to do", job_id)
            return

        job.status = JobStatus.RUNNING
        job.updated_at = datetime.utcnow()
        session.add(job)
        _commit_retry(session)

        try:
            available, reason = _real_pipeline_available()
            if available:
                log.info("Real Vina pipeline available — using it")
                _run_real(session, job)
            else:
                log.warning("Real pipeline unavailable (%s) — falling back to placeholder", reason)
                _run_placeholder(session, job, reason)

            # Re-read in case the runner loop saw a cancel between cells.
            # If the user cancelled mid-run, _run_real raised JobCancelled,
            # which we catch below — but a "natural" completion that
            # raced with cancel would land here. Either way: don't
            # clobber a CANCELLED status with COMPLETED.
            # Use _safe_commit so a Postgres connection drop during the
            # multi-minute pipeline doesn't strand the job in RUNNING.
            # We re-fetch via _safe_commit's internal session.get(), so
            # the previous session.refresh() is no longer needed for
            # correctness (the helper is the source of truth) but we
            # keep the cancel check on the in-memory `job` object since
            # _safe_commit won't tell us about a races-with-cancel case.
            try:
                session.refresh(job)
                terminal_status = JobStatus.COMPLETED if job.status != JobStatus.CANCELLED else JobStatus.CANCELLED
            except Exception as e:  # noqa: BLE001
                log.warning("Job %s: refresh failed (%s) — assuming COMPLETED", job_id, type(e).__name__)
                terminal_status = JobStatus.COMPLETED
            if terminal_status == JobStatus.COMPLETED:
                if _safe_commit(session, job_id, status=JobStatus.COMPLETED):
                    log.info("Job %s completed", job_id)
                    # Activation signal: was this the user's FIRST
                    # successful job? If so, fire a Telegram alert —
                    # this is the most important growth event we track.
                    # Wrapped in try/except so a Telegram blip can't
                    # impact the completion path.
                    try:
                        _maybe_notify_first_dock(session, job)
                    except Exception:
                        log.exception("Telegram first-dock alert failed (non-fatal)")
                    # Watched-user live feed: per-dock result alert for a
                    # demo user the operator is actively monitoring.
                    try:
                        _maybe_notify_watched_completed(session, job)
                    except Exception:
                        log.exception("Telegram watched-completed alert failed (non-fatal)")
                else:
                    log.error("Job %s: COULD NOT WRITE COMPLETED STATUS (DB unreachable)", job_id)
            else:
                log.info("Job %s ended in CANCELLED state — preserving it", job_id)
        except JobCancelled:
            log.info("Job %s cancelled by user mid-run", job_id)
            # The cancel endpoint already set status=CANCELLED and the
            # error_message; no need to overwrite.
        except Exception as e:
            log.exception("Job %s failed", job_id)
            # _safe_commit handles the poisoned-session case where a DB
            # disconnect mid-run made the regular commit fail. Without
            # this, the runner would crash here trying to write FAILED
            # and the job would sit in RUNNING forever.
            _safe_commit(session, job_id, status=JobStatus.FAILED, error_message=str(e))
            # Telegram alert with full triage context. Wrapped in its own
            # try/except so a notification failure (Telegram down,
            # credentials missing, network blip) never re-raises and
            # masks the original error in Fly logs. Imported lazily so
            # an unrelated import failure in the notifications module
            # can't break the runner itself.
            try:
                import traceback as _tb
                from .notifications import notify_job_failed
                # Build a compact compound summary (names only, truncated)
                # so the Telegram preview shows what was being docked at
                # a glance. Pull via SQL — joining through DockingResult
                # would miss compounds when the failure happened during
                # receptor prep before any results were written.
                from sqlalchemy import text as _sql_text
                comp_rows = session.execute(
                    _sql_text(
                        "SELECT c.name FROM compound c"
                        " JOIN dockingresult dr ON dr.compound_id = c.id"
                        " WHERE dr.job_id = :jid"
                        " UNION SELECT '(no results yet)' WHERE NOT EXISTS"
                        "  (SELECT 1 FROM dockingresult WHERE job_id = :jid)"
                    ),
                    {"jid": job_id},
                ).all()
                comp_names = ", ".join(r[0] for r in comp_rows) if comp_rows else "—"
                # User email lookup — auth.users is Supabase-managed but
                # readable via SQL with our service role.
                user_row = session.execute(
                    _sql_text(
                        "SELECT email FROM auth.users WHERE id = :uid"
                    ),
                    {"uid": str(job.user_id) if job.user_id else None},
                ).first()
                user_email = user_row[0] if user_row else None

                tb_text = _tb.format_exc()
                # Last ~12 lines is usually enough to identify the call
                # site without flooding the message.
                tb_tail = "\n".join(tb_text.splitlines()[-12:])

                notify_job_failed(
                    job_id=job.id,
                    share_id=job.share_id,
                    pdb_id=job.pdb_id,
                    mutations=job.mutations or "",
                    engine=job.engine or "",
                    user_email=user_email,
                    user_id=str(job.user_id) if job.user_id else None,
                    compound_summary=comp_names,
                    error_message=str(e),
                    traceback_tail=tb_tail,
                )
            except Exception:
                log.exception("Telegram failure-alert failed (non-fatal)")


# ──────────────────────────────────────────────────────────────────────
# Real Vina pipeline
# ──────────────────────────────────────────────────────────────────────

def _drain_pending_interface_extras(pending: list[dict], session: Session) -> None:
    """Crash-safe wrapper around the interface-extras drain. NEVER raises.

    Why this matters: the drain runs AFTER the job has already been marked
    COMPLETED. If it raised, the exception would bubble up through
    _run_real into run_job_in_background's `except Exception` handler,
    which calls _safe_commit(... FAILED) — silently overwriting a
    perfectly good COMPLETED job with FAILED. The drain is pure
    post-completion enrichment (BSA + Vina-term chips); on any failure we
    log, roll the session back, and swallow. The job stays COMPLETED with
    its real scores; the user just doesn't get the extra chips.
    """
    try:
        _drain_pending_interface_extras_impl(pending, session)
    except Exception as e:  # noqa: BLE001
        log.exception(
            "interface-extras drain crashed (non-fatal — job stays COMPLETED): %s", e
        )
        try:
            session.rollback()
        except Exception:  # noqa: BLE001
            pass


def _drain_pending_interface_extras_impl(pending: list[dict], session: Session) -> None:
    """Background pass that computes the slow interface KPIs after each
    DockingResult row has been committed.

    Why this exists: BSA (freesasa × 3) and the Vina score breakdown
    (smina --score_only subprocess) together add ~2–4 s of CPU work per
    cell. Running them inline in _finalize_cell delays the row write,
    which the user sees as "the dock got slower." Moving them here
    keeps the result row appearing as fast as before; the chips paint
    in on the frontend's next 2s poll once we've updated row.extra.

    Each pending item carries: compound_id, variant, job_id, receptor
    (pdbqt path), receptor_pdb, pose_pdbqt path, run_dir, current_extra.
    Output is written back into DockingResult.extra in place.
    """
    if not pending:
        return
    try:
        from deltadock_pipeline.interface_extras import (
            compute_bsa, count_hbonds_from_extra, format_for_extra,
            pdbqt_to_pdb, vina_score_terms,
        )
    except ImportError as e:
        log.info("interface_extras unavailable; skipping deferred BSA + vina-terms: %s", e)
        return

    from concurrent.futures import ThreadPoolExecutor, as_completed

    def _one_extras(item: dict) -> tuple[int, str, list[str], str | None]:
        """Returns (compound_id, variant, new_segments, error)."""
        try:
            pose_pdb = pdbqt_to_pdb(
                Path(item["pose_pdbqt"]),
                Path(item["run_dir"]) / f"pose_for_bsa_c{item['compound_id']}_{item['variant']}.pdb",
            )
            bsa = compute_bsa(Path(item["receptor_pdb"]), pose_pdb) if pose_pdb else None
            vterms = None
            try:
                vterms = vina_score_terms(
                    receptor_pdbqt=Path(item["receptor"]),
                    ligand_pdbqt=Path(item["pose_pdbqt"]),
                )
            except Exception as vte:  # noqa: BLE001
                log.debug("vina_score_terms deferred: failed c%s × %s: %s",
                          item["compound_id"], item["variant"], vte)
            segs = format_for_extra(bsa=bsa, hbonds=None, vina_terms=vterms)
            return (item["compound_id"], item["variant"], segs, None)
        except Exception as e:  # noqa: BLE001
            return (item["compound_id"], item["variant"], [], f"extras_err={str(e)[:60]}")

    log.info("Deferred interface extras: draining %d cells in parallel", len(pending))
    by_key = {(it["compound_id"], it["variant"]): it for it in pending}
    job_id_for_rows = pending[0].get("job_id") if pending and pending[0].get("job_id") is not None else None

    with ThreadPoolExecutor(max_workers=4) as ex:
        futures = [ex.submit(_one_extras, it) for it in pending]
        for fut in as_completed(futures):
            try:
                compound_id, variant, new_segs, err = fut.result()
            except Exception as e:  # noqa: BLE001
                log.warning("interface_extras worker crashed: %s", e)
                continue
            # Re-read the row to get the freshest extra (validation may
            # have updated it after the row was first written). We do
            # this even when new_segs is empty so the `extras=pending`
            # placeholder still gets stripped — otherwise a cell where
            # both BSA and vina_terms failed would show "computing…"
            # forever on the frontend.
            stmt = select(DockingResult).where(
                DockingResult.compound_id == compound_id,
                DockingResult.variant == variant,
            )
            if job_id_for_rows is not None:
                stmt = stmt.where(DockingResult.job_id == job_id_for_rows)
            row = session.exec(stmt).first()
            if row is None:
                continue
            current = row.extra or ""
            # Strip the placeholder, then append whatever the worker
            # produced — real segments, or an extras_err marker on failure
            # (the frontend parser ignores unknown keys, so it's harmless
            # but useful for debugging).
            cleaned = "|".join(
                p for p in current.split("|")
                if p and p != "extras=pending"
            )
            append_segs = list(new_segs)
            if not append_segs and err:
                append_segs = [err]
            # Interface H-bond count: derive it HERE, not at cell-finalize
            # time. On the production deferred-validation path the
            # `contacts=` segment isn't in `extra` when the cell is first
            # written — it only lands after _drain_pending_validations runs,
            # which is *before* this drainer. So by now `contacts=` exists.
            # Skip if the eager-validation path already wrote iface_hb.
            if "iface_hb=" not in current:
                hb = count_hbonds_from_extra(current)
                if hb is not None:
                    append_segs.append(f"iface_hb={hb}")
            joined_new = "|".join(append_segs)
            if joined_new:
                new_extra = (cleaned + "|" + joined_new) if cleaned else joined_new
            else:
                new_extra = cleaned
            if new_extra == current:
                # Nothing changed: no placeholder was present and the
                # worker produced nothing — skip the write entirely.
                continue
            row.extra = new_extra
            try:
                session.add(row)
                session.commit()
            except Exception as ce:  # noqa: BLE001
                log.warning("Couldn't commit interface_extras update for c%s × %s: %s",
                            compound_id, variant, ce)
                session.rollback()


def _drain_pending_validations(pending: list[dict], session: Session) -> None:
    """Crash-safe wrapper around the deferred-validation drain. NEVER raises.

    Same rationale as _drain_pending_interface_extras: this runs after the
    job is already COMPLETED, so a crash that propagated would reach
    run_job_in_background's except handler and overwrite COMPLETED with
    FAILED. Validation is post-completion enrichment (PoseBusters / ProLIF
    / strain chips) — on any failure we log, roll back, and swallow; the
    job stays COMPLETED.
    """
    try:
        _drain_pending_validations_impl(pending, session)
    except Exception as e:  # noqa: BLE001
        log.exception(
            "validation drain crashed (non-fatal — job stays COMPLETED): %s", e
        )
        try:
            session.rollback()
        except Exception:  # noqa: BLE001
            pass


def _drain_pending_validations_impl(pending: list[dict], session: Session) -> None:
    """Run deferred PoseBusters/ProLIF/strain validation in parallel.

    `pending` is a list of dicts (built by _finalize_cell when
    defer_validation is on) containing everything one validation pass
    needs: receptor pdbqt, receptor pdb, pose pdbqt path (still alive
    in the runner's tempdir), ligand SMILES, and the row's current
    `extra` string so we can append the new validation segment.

    Updates DockingResult.extra in place via the same `session` —
    rows already have `validate=pending` from _finalize_cell, which we
    overwrite with the real validation string. Frontend's 2s polling
    sees the update on the next /jobs fetch.

    Concurrency: uses ThreadPoolExecutor. PoseBusters + ProLIF + strain
    each run as their own subprocess (RDKit segfault isolation), so
    real parallelism comes from the OS scheduler, not the Python GIL.
    Cap at 4 concurrent because each validation spawns ~3 subprocesses
    and the Fly machine has 2 vCPU — going wider would just cause
    context-switch thrash without speedup.

    No-op when `pending` is empty (eager-validation path doesn't
    populate the list).
    """
    if not pending:
        return
    try:
        from deltadock_pipeline.validate import validate_pose
    except ImportError:
        log.warning("validate_pose unavailable; deferred validation skipped")
        return

    from concurrent.futures import ThreadPoolExecutor, as_completed

    def _one_validation(item: dict) -> tuple[int, str, str | None, str | None]:
        """Returns (compound_id, variant, validation_segment, error)."""
        try:
            v = validate_pose(
                receptor_pdbqt=item["receptor"],
                pose_pdbqt=item["pose_pdbqt"],
                receptor_pdb=item["receptor_pdb"],
                work_dir=item["run_dir"],
                ligand_smiles=item["ligand_smiles"],
            )
            return (item["compound_id"], item["variant"], v.to_extra_string(), None)
        except Exception as ve:
            return (item["compound_id"], item["variant"], None, f"validate_err={str(ve)[:80]}")

    log.info("Deferred validation: draining %d cells in parallel", len(pending))
    by_key = {(it["compound_id"], it["variant"]): it for it in pending}
    # All pending items share a job_id (one runner = one job) — capture once.
    job_id_for_rows = pending[0].get("job_id") if pending and pending[0].get("job_id") is not None else None
    # Fallback: derive from a query against compound_id+variant — but every
    # pending item came from this runner so they all carry the same job_id
    # if it was set at enqueue time. Add it now if missing (older callers).
    # We use the first pending item's job_id; matches the model.

    with ThreadPoolExecutor(max_workers=4) as ex:
        futures = [ex.submit(_one_validation, it) for it in pending]
        for fut in as_completed(futures):
            try:
                compound_id, variant, segment, err = fut.result()
            except Exception as e:
                log.warning("Validation worker crashed: %s", e)
                continue

            current_extra = by_key[(compound_id, variant)].get("current_extra") or ""
            new_segment = segment if segment else (err or "validate_err=unknown")
            # Strip the placeholder so the final extra is clean.
            cleaned = "|".join(
                p for p in current_extra.split("|")
                if p and p != "validate=pending"
            )
            final_extra = (cleaned + "|" + new_segment) if cleaned else new_segment

            # Find and update the row. Filter by job_id when we have it
            # (avoids cross-job collisions in the same compound_id space).
            stmt = select(DockingResult).where(
                DockingResult.compound_id == compound_id,
                DockingResult.variant == variant,
            )
            if job_id_for_rows is not None:
                stmt = stmt.where(DockingResult.job_id == job_id_for_rows)
            for r in session.exec(stmt):
                r.extra = final_extra
                session.add(r)
            _commit_retry(session)
    log.info("Deferred validation: done")


def _run_boltz2_dispatch(
    session: Session,
    job: Job,
    cleaned_pdb: Path,
    chain: str,
    pocket_centre: tuple[float, float, float],
    pocket_size: tuple[float, float, float],
    pocket_source: str | None,
    boltz2_pod_url: str,
    compounds: list,
    variants: list[str],
) -> None:
    """Boltz-2-only per-cell dispatch.

    Called from `_run_real` when `job.engine == "boltz2"`. Independent
    flow because Boltz-2 takes a sequence + ligand SMILES, not a PDBQT
    receptor + box, so almost none of the Vina/GNINA scaffolding
    applies. Skipped: receptor PDBQT prep, FoldX mutation builder,
    Vina/GNINA dispatch, Vinardo rescoring, PoseBusters/ProLIF
    validation. Those are all physics-pipeline concepts that don't
    map onto a foundation-model prediction.

    What we DO share with the Vina path: PDB fetch, PDBFixer cleanup,
    pocket-box auto-detection (catalog → fpocket fallback → origin),
    DocketResult row shape, R2 pose persistence, cooperative
    cancellation between cells.

    Per-cell behaviour:
      - WT cell: dock the unmodified chain sequence.
      - Mutation cell: apply substitution to the sequence string and
        dock that. If the mutation references a residue not in the
        chain (gap, wrong chain ID, wrong WT letter), write a clean
        failure row instead of silently sending WT to the model.
      - Pocket constraint: residues whose CA is within (min half-edge
        of pocket box) Å of pocket centre. Empty list is OK; Boltz-2
        falls back to its learned pocket prior.

    Score field (DocketResult.best_score): we store affinity_pred_value
    directly. It's log10(IC50 in μM), so more-negative = stronger binder
    (matches Vina's sign convention even though the units are different).
    The matrix renders Δ as (mutant - WT) — same direction signal
    regardless of units.
    """
    # Late imports — module is only meaningful in the boltz2 path.
    import sys
    pipeline_path = Path(__file__).parents[3].parent / "pipeline"
    if str(pipeline_path) not in sys.path:
        sys.path.insert(0, str(pipeline_path))
    from deltadock_pipeline.boltz2_dock import (
        Boltz2DockConfig, Boltz2DockError, predict_one_boltz2,
    )
    from deltadock_pipeline.boltz2_seq import (
        apply_mutation_to_sequence, extract_sequence_from_pdb,
        pocket_residues_within,
    )

    cx, cy, cz = pocket_centre
    sx, sy, sz = pocket_size

    # Boltz-2 client config — picked up from the runtime settings so a
    # restart with new env (longer timeout, MSA toggle) takes effect
    # without code changes.
    cfg = Boltz2DockConfig(
        base_url=boltz2_pod_url,
        timeout_s=settings.boltz2_timeout_s,
        use_msa=settings.boltz2_use_msa,
        num_samples=settings.boltz2_num_samples,
    )

    # Step 1: extract WT sequence + residue→index map from the cleaned PDB.
    # Failures here are catastrophic for the whole job (no sequence → no
    # boltz prediction possible), so let them propagate up to the run_job
    # exception handler which marks the job FAILED with a useful reason.
    set_stage(session, job.id, "extracting_sequence")
    try:
        wt_sequence = extract_sequence_from_pdb(cleaned_pdb, chain)
    except ValueError as e:
        raise RuntimeError(
            f"prep_step=extract_sequence pdb={cleaned_pdb.name} "
            f"chain={chain}: {e}"
        ) from e

    # Step 2: build pocket-residue list (CA atoms inside the docking box).
    # Use the smallest half-edge so the constraint stays inside the box
    # the user expects — same convention as the Vina path's
    # POCKET_RADIUS_A.
    pocket_radius_a = min(sx, sy, sz) / 2.0
    pocket_residues = pocket_residues_within(
        cleaned_pdb, chain, pocket_centre, pocket_radius_a,
    )
    log.info(
        "Boltz-2: WT sequence %d residues, pocket constraint %d residues",
        len(wt_sequence.seq), len(pocket_residues),
    )

    # Step 3: per-variant sequence map. Same structure as receptor_for_variant
    # in the Vina path. variant_extra carries telemetry that gets glued onto
    # the per-cell `extra` string so the user sees what produced the score.
    sequence_for_variant: dict[str, str | None] = {"WT": wt_sequence.seq}
    variant_extra: dict[str, str | None] = {"WT": pocket_source}
    for mut in [m for m in job.mutations.split(",") if m]:
        new_seq, err = apply_mutation_to_sequence(wt_sequence, mut)
        if err is not None:
            log.warning("Boltz-2: mutation %s rejected: %s", mut, err)
            sequence_for_variant[mut] = None
            variant_extra[mut] = f"mutation_rejected: {err}"
        else:
            sequence_for_variant[mut] = new_seq
            variant_extra[mut] = "boltz2_seq_mutation_applied"

    # Step 4: per-cell loop. Boltz-2 has no native ligand-batch endpoint
    # yet (see predict_batch_boltz2 stub), so we iterate compound × variant
    # one HTTP call at a time. Each call is ~20 s on a warm RTX 4090.
    #
    # Track WT predicted complexes by (compound_id, "WT") so we can align
    # mutant complexes to them. Key: (compound_id, "WT"), value: Path to predicted_pdb.
    wt_predicted_pdbs: dict[tuple[int, str], Path] = {}
    total_cells = len(compounds) * len(variants)
    cell_idx = 0
    with tempfile.TemporaryDirectory(prefix=f"boltz2-job{job.id}-") as work_str:
        work = Path(work_str)
        for compound in compounds:
            if is_cancelled(session, job.id):
                log.info("Job %s cancelled — stopping Boltz-2 loop", job.id)
                raise JobCancelled()
            for variant in variants:
                if is_cancelled(session, job.id):
                    raise JobCancelled()
                cell_idx += 1
                # Stage tells the user which cell we're on right now —
                # critical for Boltz-2 because each cell takes ~130 s.
                set_stage(session, job.id, f"predicting_{cell_idx}_of_{total_cells}")
                seq = sequence_for_variant.get(variant)
                if seq is None:
                    # Mutation rejected upstream; emit a clean failure row.
                    fail = variant_extra.get(variant) or "mutation_rejected"
                    session.add(DockingResult(
                        job_id=job.id, compound_id=compound.id, variant=variant,
                        best_score=0.0, extra=fail,
                    ))
                    _commit_retry(session)
                    continue

                cell_dir = work / f"compound_{compound.id}_{variant}"
                cell_dir.mkdir(exist_ok=True)
                parts: list[str] = []
                if variant_extra.get(variant):
                    parts.append(variant_extra[variant])
                parts.append("engine=boltz2")

                try:
                    result = predict_one_boltz2(
                        receptor_sequence=seq,
                        ligand_smiles=compound.smiles,
                        work_dir=cell_dir,
                        cfg=cfg,
                        pocket_residues=pocket_residues or None,
                        chain_id=chain,
                    )
                    # Track WT poses for later alignment of mutants
                    if variant == "WT":
                        wt_predicted_pdbs[(compound.id, "WT")] = result.predicted_pdb
                except Boltz2DockError as bde:
                    log.warning(
                        "Boltz-2 failed for c%s × %s: %s",
                        compound.id, variant, bde,
                    )
                    session.add(DockingResult(
                        job_id=job.id, compound_id=compound.id, variant=variant,
                        best_score=0.0,
                        extra="|".join(parts + [f"boltz2_failed: {str(bde)[:120]}"]),
                    ))
                    _commit_retry(session)
                    continue
                except Exception as e:
                    log.exception(
                        "Boltz-2 unexpected error for c%s × %s",
                        compound.id, variant,
                    )
                    session.add(DockingResult(
                        job_id=job.id, compound_id=compound.id, variant=variant,
                        best_score=0.0,
                        extra="|".join(parts + [f"boltz2_err:{type(e).__name__}:{str(e)[:80]}"]),
                    ))
                    _commit_retry(session)
                    continue

                # Boltz-2 returns the predicted protein-ligand COMPLEX as a
                # single PDB. Persist it as the cell's pose so the 3D
                # viewer can display it.
                # PoseBusters/strain are deliberately skipped — they're
                # physics validators that flag ML-generated geometries
                # as "Suspect" even when the binding mode is fine.
                # ProLIF is NOT a physics validator (it just measures
                # contacts), so we do run it — split the complex into
                # protein-only + ligand-only PDBs first, then call the
                # same subprocess-isolated runner the Vina path uses.
                from .pose_store import get_pose_store

                # For non-WT variants, attempt Cα alignment to the WT predicted
                # complex (when available). If alignment succeeds with RMSD < 3.0 Å,
                # overwrite the mutant pose with the aligned version.
                pose_to_write = result.predicted_pdb
                alignment_note = None
                if variant != "WT" and (compound.id, "WT") in wt_predicted_pdbs:
                    try:
                        from deltadock_pipeline.boltz2_align import align_complex_to
                        wt_pdb = wt_predicted_pdbs[(compound.id, "WT")]
                        aligned_out = cell_dir / f"aligned_{variant}.pdb"
                        rmsd, ok_flag = align_complex_to(
                            target_pdb=wt_pdb,
                            source_pdb=pose_to_write,
                            out_pdb=aligned_out,
                            chain_id=chain,
                        )
                        if ok_flag:
                            # RMSD < 3.0 Å — overlay is meaningful
                            pose_to_write = aligned_out
                            alignment_note = f"boltz2_aligned_to_wt={rmsd}A"
                            log.info(
                                "Boltz-2 c%s × %s: aligned to WT, RMSD=%.1f Å",
                                compound.id, variant, rmsd,
                            )
                        else:
                            # RMSD >= 3.0 Å — fold has diverged, skip overlay
                            alignment_note = f"boltz2_alignment_skipped: RMSD={rmsd}A >= 3.0A (fold diverged)"
                            log.info(
                                "Boltz-2 c%s × %s: alignment RMSD=%.1f Å >= 3.0 — skipping (fold diverged)",
                                compound.id, variant, rmsd,
                            )
                    except Exception as ae:
                        alignment_note = f"boltz2_alignment_skipped: {type(ae).__name__}:{str(ae)[:60]}"
                        log.warning(
                            "Boltz-2 c%s × %s alignment failed: %s",
                            compound.id, variant, ae,
                        )

                try:
                    pose_uri = get_pose_store().write(
                        job.id, compound.id, variant, pose_to_write,
                    )
                except Exception as e:
                    log.warning(
                        "Could not persist Boltz-2 pose for c%s × %s: %s",
                        compound.id, variant, e,
                    )
                    pose_uri = str(pose_to_write)

                # Telemetry that the JobPage + parseExtra.ts surface back
                # to the user: the raw affinity, the binder probability,
                # pocket-residue count (so they know the constraint was
                # honored).
                parts.append(f"aff_value={result.affinity_pred_value:.3f}")
                parts.append(f"aff_prob={result.affinity_probability_binary:.3f}")
                parts.append(f"pocket_residues={len(pocket_residues)}")

                # Append alignment outcome to the extra string so the frontend
                # can detect whether this mutant was aligned and at what RMSD.
                if alignment_note:
                    parts.append(alignment_note)

                # ProLIF on the Boltz-2 complex. Fail-soft — if anything
                # goes wrong (split fails, ProLIF subprocess crashes, no
                # contacts found), we just skip the contacts segment and
                # the user sees the cell without a 2D map / contact list.
                # Same pattern the Vina path uses for ProLIF errors.
                try:
                    from deltadock_pipeline.boltz2_seq import split_complex_pdb
                    from deltadock_pipeline.validate import _run_prolif_safe
                    protein_only, ligand_only = split_complex_pdb(
                        result.predicted_pdb, cell_dir,
                        ligand_chain="L", protein_chain=chain,
                    )
                    contacts = _run_prolif_safe(
                        pose_pdb=ligand_only,
                        receptor_pdb=protein_only,
                        ligand_smiles=compound.smiles,
                        timeout=60.0,
                    )
                    if contacts:
                        # Same compact format the Vina path uses so the
                        # frontend's parseExtra.ts can read both: comma-
                        # separated list of "RES:Type:distance" tokens.
                        # We don't have a distance from ProLIF's bare
                        # output here, so we elide the third field;
                        # parseExtra handles 2-field tokens fine.
                        toks = []
                        for c in contacts:
                            res = c.get("residue") or c.get("res") or ""
                            typ = c.get("type") or c.get("interaction") or "Contact"
                            if res:
                                toks.append(f"{res}:{typ}")
                        if toks:
                            parts.append("contacts=" + ",".join(toks))
                            parts.append("prolif=ok")
                        else:
                            parts.append("prolif=empty")
                    else:
                        parts.append("prolif=empty")
                except Exception as pe:
                    log.warning(
                        "Boltz-2 ProLIF failed for c%s × %s: %s",
                        compound.id, variant, pe,
                    )
                    parts.append(f"prolif=err:{str(pe)[:40]}")

                session.add(DockingResult(
                    job_id=job.id, compound_id=compound.id, variant=variant,
                    best_score=float(result.score),
                    pose_uri=pose_uri,
                    extra="|".join(parts),
                ))
                _commit_retry(session)
                log.info(
                    "Boltz-2 c%s × %s: aff=%.3f prob=%.3f",
                    compound.id, variant,
                    result.affinity_pred_value,
                    result.affinity_probability_binary,
                )


def _run_real(session: Session, job: Job) -> None:
    # (Pod auto-resume) If the cost-control watchdog stopped the pod
    # while idle, wake it now and wait for /health to go green BEFORE
    # we start any pod-dependent work. The function no-ops when
    # RUNPOD_API_KEY/POD_ID isn't configured, so dev environments
    # behave exactly as before. Stage updates are pushed via
    # set_stage so Studio's polling can show 'pod_resuming /
    # pod_warming' on the prominent docking-in-progress banner.
    from .pod_lifecycle import ensure_pod_ready_sync
    log.info("Job %s: ensuring pod is ready before dispatch", job.id)
    pod_ready = ensure_pod_ready_sync(
        timeout_s=300,
        on_stage_change=lambda slug: set_stage(session, job.id, slug),
    )
    if not pod_ready:
        # Couldn't warm the pod in time. Fall through anyway — the
        # downstream dock_server HTTP call will fail with its own
        # error, which the runner already turns into a JOB FAILED
        # with a clear error_message. Logging the warning here so
        # the operator can see "auto-resume tried and timed out" in
        # the logs even if the user-visible failure is generic.
        log.warning("Job %s: ensure_pod_ready timed out, proceeding anyway", job.id)

    # Late import — keeps the placeholder-only path lightweight
    import sys
    pipeline_path = Path(__file__).parents[3].parent / "pipeline"
    if str(pipeline_path) not in sys.path:
        sys.path.insert(0, str(pipeline_path))
    from deltadock_pipeline.fetch import fetch_pdb
    from deltadock_pipeline.prep import prepare_receptor, prepare_ligand, fix_pdb
    from deltadock_pipeline.dock import dock_one, PocketBox

    foldx_on = _foldx_available()
    if foldx_on:
        from deltadock_pipeline.foldx import build_mutant, FoldXError
    else:
        log.warning("FoldX not available — mutants will be docked against the WT receptor")

    # Two opt-in remote engines, tried in this order:
    #   1. Pod-hosted GPU docking (settings.pod_dock_url) — long-running FastAPI
    #      service on a dedicated GPU Pod; always-warm, ~30x faster than CPU.
    #   2. RunPod serverless (settings.runpod_enabled) — pay-per-second, has
    #      cold-start latency.
    # Both fail-soft to local Vina on any error so a single bad call doesn't
    # take down the whole job. The engine that ran each cell is annotated in
    # the result's `extra` field (engine=pod_gpu | runpod | local | local_after_*).
    pod_on = settings.pod_dock_enabled
    if pod_on:
        from deltadock_pipeline.pod_dock import dock_one_pod, PodDockConfig, PodDockError
        pod_cfg = PodDockConfig(
            base_url=settings.pod_dock_url,
            timeout_s=settings.pod_dock_timeout_s,
        )
        log.info("Pod GPU dispatch enabled → %s", settings.pod_dock_url)

    # When pod_batch_dock is on, we can group cells of the same variant into
    # one HTTP call so the GPU loads the receptor once per variant instead
    # of once per cell. Pod-side endpoint (POST /dock_batch) must be live —
    # check via env, not via probe, so a transient Pod hiccup at startup
    # doesn't permanently disable the fast path. Falls back to per-cell
    # dispatch on per-batch error.
    pod_batch_on = pod_on and settings.pod_batch_dock
    if pod_batch_on:
        from deltadock_pipeline.pod_dock import dock_batch_pod, BatchLigand
        log.info("Pod GPU batch dispatch enabled (one HTTP call per variant)")

    # ── Ensemble docking ──────────────────────────────────────────────────
    # When job.ensemble is set, each ligand is docked against several short-
    # MD-relaxed receptor conformers (generated on the Pod's /relax_ensemble
    # endpoint) instead of one rigid crystal snapshot — the best score+pose
    # per cell is kept and the per-conformer spread is recorded. This is a
    # FULL JOB ONLY opt-in (Quick Dock never sets job.ensemble).
    #
    # Requires the Pod: it's used for BOTH conformer generation AND docking
    # each conformer's ligand batch. dock_batch_pod is the workhorse — it
    # docks the whole ligand list against one receptor per HTTP call, so
    # ensemble = one dock_batch_pod call per conformer. Note this does NOT
    # require pod_batch_dock (that flag only controls whether the *standard*
    # path batches); ensemble always uses the batch primitive.
    #
    # Fully additive + gated: when ensemble_on is False nothing below changes.
    # If the user opted in but no Pod is configured we log and fall through
    # to standard single-conformation docking (the API gate + frontend
    # should prevent this, but defense-in-depth).
    ensemble_on = pod_on and bool(getattr(job, "ensemble", False))
    if ensemble_on:
        from deltadock_pipeline.pod_dock import (
            dock_batch_pod, BatchLigand, relax_ensemble_pod,
        )
        log.info("Ensemble docking ENABLED for job %s — MD-relaxed receptor "
                 "conformer ensemble per variant", job.id)
    elif getattr(job, "ensemble", False):
        log.warning(
            "Job %s requested ensemble docking but no Pod is configured "
            "(POD_DOCK_URL unset) — ensemble needs the Pod for conformer "
            "generation AND docking; falling back to single-conformation docking",
            job.id,
        )

    # RunPod serverless can run *alongside* Pod GPU as a burst-overflow path:
    # when the Pod is busy / 5xx / timing out, individual cells fall through
    # to RunPod instead of dropping straight to local CPU. When Pod is off,
    # RunPod is the primary remote engine. When both are off, everything
    # runs locally.
    runpod_on = settings.runpod_enabled
    if runpod_on:
        from deltadock_pipeline.runpod_dock import dock_one_runpod, RunPodConfig, RunPodError
        runpod_cfg = RunPodConfig(
            api_key=settings.runpod_api_key,
            endpoint_id=settings.runpod_endpoint_id,
            timeout_s=settings.runpod_timeout_s,
        )
        if pod_on:
            log.info("RunPod serverless burst overflow enabled → endpoint %s", settings.runpod_endpoint_id)
        else:
            log.info("RunPod serverless dispatch enabled → endpoint %s", settings.runpod_endpoint_id)

    # GNINA dispatch is opt-in per-job via job.engine. The Pod-side endpoint
    # /dock_gnina has to be installed first (see pod/GNINA_INSTALL.md) and
    # the GNINA_ENABLED Fly secret set. When all that's in place, jobs that
    # arrive with engine=gnina dispatch through the GNINA client; everything
    # else continues to use QuickVina2-GPU. We deliberately do NOT use
    # GNINA as an automatic fallback — users picked their engine on
    # purpose, falling them back silently to a different scoring function
    # would be misleading.
    gnina_requested = (
        getattr(job, "engine", None) == "gnina"
        and settings.gnina_enabled
        and pod_on  # GNINA hits the same Pod, so requires pod_dock_url
    )
    if ensemble_on and gnina_requested:
        # Ensemble docking v1 uses the QuickVina batch primitive
        # (dock_batch_pod) — it does NOT route through the GNINA client.
        # Rather than silently dock with the wrong scoring function, we let
        # GNINA win: the ensemble branch below is gated on `not
        # gnina_requested`, so a gnina+ensemble job runs as a normal GNINA
        # job. The frontend already declines to send ensemble=true with
        # engine=gnina; this is the defense-in-depth for direct API callers.
        log.warning(
            "Job %s requested BOTH engine=gnina and ensemble=true — ensemble "
            "docking v1 is QuickVina-only; running as a standard GNINA job "
            "(ensemble ignored for this job)", job.id,
        )
    if gnina_requested:
        from deltadock_pipeline.gnina_dock import (
            dock_one_gnina, dock_batch_gnina, GninaDockConfig, GninaDockError, GninaBatchLigand,
        )
        gnina_cfg = GninaDockConfig(
            base_url=settings.pod_dock_url,
            timeout_s=settings.gnina_timeout_s,
            cnn_mode=settings.gnina_cnn_mode,
        )
        log.info("GNINA dispatch active for this job (cnn=%s)", settings.gnina_cnn_mode)
    elif getattr(job, "engine", None) == "gnina":
        # User asked for GNINA but the flag's off OR Pod isn't configured.
        # Log loudly so we can spot misconfiguration; the runner will fall
        # through to QuickVina2-GPU below.
        log.warning(
            "Job %s requested engine=gnina but GNINA_ENABLED=%s pod_on=%s — falling back to quickvina2_gpu",
            job.id, settings.gnina_enabled, pod_on,
        )

    # ── Boltz-2 ML engine (#104, third engine option) ─────────────────────
    # Boltz-2 takes a protein SEQUENCE + ligand SMILES — fundamentally
    # different inputs from Vina/GNINA's PDBQT receptor. We still share
    # the PDB fetch + clean step with the Vina path (the cleaned PDB is
    # the source of the WT sequence), so the boltz2 branch fires AFTER
    # cleaned_pdb is computed (~line 700) — see `if boltz2_dispatch:`
    # below. Here we only fail fast if the user asked for boltz2 but the
    # required config is missing.
    boltz2_dispatch = (
        getattr(job, "engine", None) == "boltz2"
        and settings.boltz2_enabled
    )
    if boltz2_dispatch:
        # Pod URL: dedicated boltz2 pod if configured, else fall back to
        # the Vina/GNINA pod (legacy single-pod deploy).
        boltz2_pod_url = settings.boltz2_pod_url or settings.pod_dock_url
        if not boltz2_pod_url:
            raise RuntimeError(
                "engine=boltz2 requested but neither BOLTZ2_POD_URL nor "
                "POD_DOCK_URL is configured."
            )
        log.info("Boltz-2 dispatch active for this job → %s", boltz2_pod_url)
    elif getattr(job, "engine", None) == "boltz2":
        log.warning(
            "Job %s requested engine=boltz2 but BOLTZ2_ENABLED=%s — "
            "engine is not currently available; the API should have rejected at submit time",
            job.id, settings.boltz2_enabled,
        )
        raise RuntimeError(
            "Boltz-2 engine not enabled on this deployment. "
            "Set BOLTZ2_ENABLED=1 on the API once the Pod-side endpoint is live."
        )

    if not pod_on and not runpod_on:
        log.info("No remote engine configured — running Vina locally")

    # Validation (PoseBusters + ProLIF) is optional too — if it crashes for any
    # reason it just won't add `extra` info, the docking still works.
    try:
        from deltadock_pipeline.validate import validate_pose
        validate_on = True
    except Exception as e:
        log.warning("Validation pipeline not available: %s", e)
        validate_on = False

    # WT is included by default; users can opt out via the New Job form when
    # they don't need a baseline. When skipped, the matrix has no REF column
    # and no Δ values, but the rest of the pipeline still works (FoldX still
    # builds mutant receptors off the WT crystal structure).
    requested_mutations = [m for m in job.mutations.split(",") if m]
    variants = (["WT"] if job.include_wt else []) + requested_mutations
    if not variants:
        # Defensive: include_wt=False AND no mutations leaves nothing to dock.
        raise ValueError(
            "Job has no variants to dock — enable WT comparison or list at least one mutation."
        )

    # Per-job exhaustiveness, with a sane fallback for legacy rows that don't
    # have the column populated (defaults to Vina's own default of 8).
    exhaustiveness = int(getattr(job, "exhaustiveness", None) or 8)
    log.info("Docking with exhaustiveness=%d, variants=%s", exhaustiveness, variants)

    compounds = session.exec(select(Compound).where(Compound.job_id == job.id)).all()

    # Preserve USR_ upload-id case (lowercase hex tail) — uppercase only
    # standard RCSB IDs. Forcing .upper() here previously broke uploads
    # because the lookup-router stored files with lowercase hex.
    pdb_id = job.pdb_id if job.pdb_id.startswith("USR_") else job.pdb_id.upper()
    chain = job.chain or "A"

    # Cross-docking sanity check: if we don't have a cached self-dock RMSD
    # for this (pdb_id, chain), trigger one in a background thread. It uses
    # the same Vina/QuickVina-GPU path the user's compounds will use, then
    # measures heavy-atom RMSD between the docked pose and the original
    # crystal pose. Cached forever after — surfaces in the JobPage header
    # via the next /jobs response after it completes. Doesn't block the
    # user's actual results.
    try:
        from deltadock_pipeline.crossdock import load_cached
        if load_cached(pdb_id, chain) is None:
            import threading as _th
            _th.Thread(
                target=_run_crossdock_in_background,
                args=(pdb_id, chain),
                name=f"crossdock-{pdb_id}-{chain}",
                daemon=True,
            ).start()
            log.info("Spawned cross-dock sanity check for %s/%s", pdb_id, chain)
    except Exception as e:
        log.info("Could not spawn cross-dock for %s/%s: %s", pdb_id, chain, e)

    # Step 1: fetch the raw PDB FIRST so pocket auto-detection has it to scan.
    # The cleaned version is what FoldX operates on (it doesn't like raw PDBs
    # with heterogens) AND what we use to prep the WT receptor.
    # Each prep step is wrapped to convert a generic "list index out of range"
    # style traceback into a step-tagged error the user can act on.
    set_stage(session, job.id, "fetching_pdb")
    PDB_CACHE.mkdir(parents=True, exist_ok=True)
    try:
        raw_pdb = fetch_pdb(pdb_id, PDB_CACHE)
    except Exception as e:
        raise RuntimeError(f"prep_step=fetch_pdb pdb={pdb_id}: {type(e).__name__}: {e}") from e

    # Pocket box: catalog first, then auto-detect from co-crystal HETATM,
    # finally fall back to origin (won't dock anything sensible — but the job
    # finishes and the user gets a clear "wrong pocket" hint in the result).
    catalog_target = next(
        (t for t in [get_target(c) for c in [pdb_id.lower()]] if t),
        None,
    ) or _catalog_by_pdb(pdb_id)
    pocket_source = None  # appended to per-result extra string for telemetry

    if catalog_target:
        try:
            cx, cy, cz = catalog_target.pocket.center
            sx, sy, sz = catalog_target.pocket.size
        except (ValueError, TypeError) as e:
            raise RuntimeError(
                f"prep_step=catalog_pocket target={catalog_target.id}: "
                f"pocket center/size malformed ({type(e).__name__}: {e})"
            ) from e
        pocket_source = "pocket=catalog"
    else:
        try:
            from deltadock_pipeline.pocket import detect_pocket
            detected = detect_pocket(raw_pdb, chain=chain)
        except Exception as e:
            log.warning("Pocket auto-detect crashed: %s", e)
            detected = None

        if detected:
            cx, cy, cz = detected.center
            sx, sy, sz = 22.0, 22.0, 22.0
            pocket_source = f"pocket=auto({detected.source_het})"
        else:
            log.warning("No catalog entry and no co-crystal in %s — pocket box defaulting to origin (LIKELY WRONG)", pdb_id)
            cx, cy, cz = 0.0, 0.0, 0.0
            sx, sy, sz = 22.0, 22.0, 22.0
            pocket_source = "pocket=default_origin_LIKELY_WRONG"

    box = PocketBox(center_x=cx, center_y=cy, center_z=cz, size_x=sx, size_y=sy, size_z=sz)

    # Prep version stamp. When this changes, all cached cleaned PDBs and
    # derived receptors get auto-invalidated and rebuilt with the new prep.
    # v2 = numbering-preserving fix_pdb (skips findMissingResidues that used
    # to silently renumber every residue). Bumping this is the cleanest way
    # to force a one-time precache rebuild without manual file deletion.
    # v3 (2026-04-30): mutant builds now run a 200-step amber99sb-ildn vacuum
    # minimisation after PDBFixer applyMutations to relieve substitution
    # clash artefacts. Bumping the prep version invalidates every cached
    # mutant *.clean.pdb and *.pdbqt so the next request rebuilds with the
    # new minimised structure. WT-only caches are unaffected (no change
    # to WT prep), but we share one PREP_VERSION for simplicity — the
    # extra ~10 s of WT re-prep on first hit per target is fine and avoids
    # a divergent versioning scheme that's easy to get wrong.
    #
    # v4 (2026-04-30): per-target minimize_mutant flag (catalog.py Target).
    # BRAF flips to False because V600E activation-loop biology doesn't
    # survive a local-energy-minimum search — the validation suite went
    # -2.90 → -0.70 → +2.20 across three samples. Bumping to v4 forces
    # BRAF mutant rebuilds with minimisation skipped on next request.
    #
    # v5 (2026-05-01): EXPERIMENT — symmetric WT minimisation. Reverted
    # the same day after the validation suite regressed from 5/8 PASS
    # to 2/8 PASS + 1 FAIL. See docs/v5_postmortem.md for the full
    # reasoning. The short version: WT comes from a crystal structure
    # (already a low-energy minimum), so minimising it just collapses
    # the discriminating geometry; MUT comes from a synthetic side-chain
    # swap, so it DOES need minimisation to relieve clashes. The two
    # receptors start from physically different states, so they
    # correctly need different prep — asymmetry is right, not a bug.
    #
    # v6 (2026-05-01): cache invalidation after the v5 revert. Every
    # cached WT.pdbqt got re-stamped v5-symmetric-min during the
    # botched run and now contains a minimised (= wrong) WT receptor.
    # Bumping to v6 forces a fresh rebuild on next first-hit per target,
    # back to the correct WT-not-minimised state.
    PREP_VERSION = "v6-revert-to-asymmetric"

    def _is_stale(path: Path) -> bool:
        """A cache file is stale if its sibling .prep_version marker is missing
        or doesn't match PREP_VERSION. Used to recover from old precaches that
        were built with the renumbering bug."""
        if not path.exists() or path.stat().st_size == 0:
            return True
        marker = path.with_suffix(path.suffix + ".prep_version")
        if not marker.exists():
            return True
        return marker.read_text().strip() != PREP_VERSION

    def _stamp(path: Path) -> None:
        marker = path.with_suffix(path.suffix + ".prep_version")
        marker.write_text(PREP_VERSION + "\n")

    cleaned_pdb = PDB_CACHE / f"{pdb_id}_{chain}.clean.pdb"
    if _is_stale(cleaned_pdb):
        set_stage(session, job.id, "cleaning_pdb")
        log.info("Cleaning %s with PDBFixer (prep %s)", pdb_id, PREP_VERSION)
        # Two-attempt loop. First attempt may use a cached raw_pdb that's
        # truncated (RCSB CloudFront has flaky cold-cache hits) or partially
        # cleaned. On failure we nuke ALL related files and re-fetch +
        # re-clean from scratch. If the second attempt also fails, it's a
        # real PDB-level problem (DNA-only entry, malformed structure, etc.)
        # and we surface the error to the user.
        last_err: Exception | None = None
        for attempt in (1, 2):
            try:
                fix_pdb(raw_pdb, cleaned_pdb, chain=chain)
                _stamp(cleaned_pdb)
                last_err = None
                break
            except Exception as e:
                last_err = e
                # Self-heal: ANY failure inside fix_pdb suggests the cached
                # raw or cleaned files are in a bad state — could be:
                #   - "No ATOM lines kept": empty/truncated download
                #   - IndexError from PDBFixer: corrupt residue records
                #   - PrepError from obabel/PDBFixer: malformed coordinates
                #   - ValueError parsing coordinate fields
                #   - "Misaligned residue name": malformed ATOM records
                # In all cases the cure is the same: nuke both the raw
                # cached file (forces refetch from RCSB) and any partial
                # cleaned output (forces re-clean). USR_ uploads are exempt
                # from raw-file deletion since we can't refetch user uploads.
                if pdb_id.startswith("USR_"):
                    # Custom uploads can't be re-fetched, so a single
                    # failure is terminal. Skip the retry.
                    break
                for stale_path in (raw_pdb, cleaned_pdb,
                                   cleaned_pdb.with_suffix(cleaned_pdb.suffix + ".prep_version"),
                                   cleaned_pdb.with_suffix(".prestrip.pdb")):
                    try:
                        if stale_path.exists():
                            stale_path.unlink()
                    except OSError:
                        pass
                if attempt == 1:
                    log.warning(
                        "fix_pdb failed for %s on attempt 1 — re-fetching from "
                        "RCSB and retrying once. Original error: %s",
                        pdb_id, str(e)[:160],
                    )
                    # Re-fetch the raw PDB before the second attempt.
                    raw_pdb = fetch_pdb(pdb_id, PDB_CACHE)
                else:
                    log.error(
                        "fix_pdb failed for %s on retry — surfacing to user. "
                        "Error: %s", pdb_id, str(e)[:160],
                    )
        if last_err is not None:
            raise RuntimeError(
                f"prep_step=fix_pdb pdb={pdb_id} chain={chain}: "
                f"{type(last_err).__name__}: {last_err}"
            ) from last_err

    # ── Boltz-2 dispatch branch ─────────────────────────────────────────
    # Now that cleaned_pdb + pocket box are ready, route Boltz-2 jobs
    # through their own loop and return — they don't need the WT-receptor
    # PDBQT prep, FoldX mutant builder, or Vina/GNINA dispatch below.
    # Everything from here down is for Vina/GNINA only.
    if boltz2_dispatch:
        _run_boltz2_dispatch(
            session=session,
            job=job,
            cleaned_pdb=cleaned_pdb,
            chain=chain,
            pocket_centre=(cx, cy, cz),
            pocket_size=(sx, sy, sz),
            pocket_source=pocket_source,
            boltz2_pod_url=boltz2_pod_url,
            compounds=compounds,
            variants=variants,
        )
        return

    set_stage(session, job.id, "preparing_receptor")
    # Step 2: prep WT receptor once. Cached across jobs. The WT receptor is
    # derived from cleaned_pdb so when the latter gets re-built (stale
    # invalidation), the WT PDBQT must also be rebuilt — otherwise it'd
    # still reference the old renumbered residues.
    RECEPTOR_CACHE.mkdir(parents=True, exist_ok=True)
    wt_receptor = RECEPTOR_CACHE / f"{pdb_id}_{chain}_WT.pdbqt"
    if _is_stale(wt_receptor):
        log.info("Prepping WT receptor %s chain %s (prep %s)", pdb_id, chain, PREP_VERSION)
        try:
            prepare_receptor(cleaned_pdb, wt_receptor, chain=chain)
            _stamp(wt_receptor)
        except Exception as e:
            raise RuntimeError(
                f"prep_step=prepare_receptor pdb={pdb_id} chain={chain}: {type(e).__name__}: {e}"
            ) from e

    # Step 3: build a mutant receptor PDBQT for every requested mutation.
    # Cached on (PDB hash, chain, mutation) — FoldX is the slowest step (~30s).
    # Track three things per variant: the docking receptor (PDBQT), the cleaned
    # PDB (for ProLIF), and any prefix info we'll glue onto the result's extra.
    receptor_for_variant: dict[str, Path] = {"WT": wt_receptor}
    receptor_pdb_for_variant: dict[str, Path] = {"WT": cleaned_pdb}
    # Tag the WT row with where the pocket box came from so the user sees if
    # we auto-detected vs catalog-pulled vs defaulted.
    variant_extra: dict[str, str | None] = {"WT": pocket_source}
    variant_ddg: dict[str, float | None] = {"WT": None}

    # Late-import the verification helper — checks each mutant receptor
    # actually contains the requested substitution before we waste compute
    # docking against a silently-broken file.
    from deltadock_pipeline.prep import verify_mutation_applied

    def _residue_distance_to_pocket(pdb_path: Path, ch: str, resnum: int) -> float | None:
        """Distance from residue's CA atom to the docking box center.
        Used to flag mutations that are too far from the pocket for
        single-conformation docking to capture their effect — the user
        sees a clear "outside_pocket" tag instead of a confusing
        zero-delta result."""
        try:
            with pdb_path.open() as fh:
                for line in fh:
                    if not line.startswith("ATOM") or len(line) < 54:
                        continue
                    if line[21] != ch or line[22:26].strip() != str(resnum):
                        continue
                    if line[12:16].strip() != "CA":
                        continue
                    x = float(line[30:38]); y = float(line[38:46]); z = float(line[46:54])
                    return ((x-cx)**2 + (y-cy)**2 + (z-cz)**2) ** 0.5
        except (OSError, ValueError):
            pass
        return None

    # The Vina box only "sees" atoms within ~half-edge of box center. The
    # threshold for the "outside_pocket" badge is therefore the smallest
    # half-edge of the actual docking box, NOT a hardcoded constant —
    # otherwise widening a target's box (e.g. EGFR went from 22 → 30 Å on
    # 2026-04-30 to capture L858R on the activation loop) leaves the badge
    # firing on residues Vina can in fact sample. Using the box's own
    # half-edge ties the honest-tagging logic to the actual sampling
    # volume, so any future per-target box adjustments stay consistent.
    POCKET_RADIUS_A = min(sx, sy, sz) / 2.0

    FOLDX_CACHE.mkdir(parents=True, exist_ok=True)
    # Pre-compute pocket-distance for each mutation. Outside-pocket mutations
    # CAN'T produce a meaningful Vina delta in single-conformation docking
    # because Vina only sees atoms within ~22 Å of box center. Track per-mut
    # so we can append a hint to variant_extra.
    pocket_hints: dict[str, str | None] = {}
    for mut in [m for m in job.mutations.split(",") if m]:
        try:
            first_resnum = int("".join(c for c in mut.split("+")[0] if c.isdigit()))
            d = _residue_distance_to_pocket(cleaned_pdb, chain, first_resnum)
            if d is not None and d > POCKET_RADIUS_A:
                pocket_hints[mut] = f"mutation_outside_pocket={d:.1f}A"
                log.info("Mutation %s residue %s is %.1f Å from pocket center — Vina won't see it",
                         mut, first_resnum, d)
            else:
                pocket_hints[mut] = None
        except (ValueError, AttributeError):
            pocket_hints[mut] = None

    for mut in [m for m in job.mutations.split(",") if m]:
        set_stage(session, job.id, f"building_mutant_{mut}")
        # PRECACHE FIRST — many mutant receptors were built offline with FoldX
        # and baked into the Docker image (see backend/precache/receptors/).
        # Without this check, prod (where FoldX isn't installed) would
        # silently dock every mutant against WT and produce IDENTICAL
        # scores per row — the bug reported as "WT and mutation always
        # have the same value".
        cached_mut_pdbqt = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.pdbqt"
        cached_mut_pdb = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.clean.pdb"
        # Skip the precache lookup if the file is missing OR stale (built with
        # the old renumbering-broken prep). In the stale case, fall through
        # to the PDBFixer mutation builder which will produce a v2 file.
        if cached_mut_pdbqt.exists() and cached_mut_pdbqt.stat().st_size > 0 and not _is_stale(cached_mut_pdbqt):
            # VERIFY the precached mutant actually contains the substitution.
            # We check the sibling .clean.pdb (preserved numbering), not the
            # PDBQT (which obabel renumbers). If the sibling PDB doesn't exist
            # we conservatively treat the precache as unverifiable and force
            # a fresh rebuild via the PDBFixer fallback below.
            if cached_mut_pdb.exists():
                ok, reason = verify_mutation_applied(cached_mut_pdb, chain, mut)
            else:
                ok, reason = False, f"sibling .clean.pdb missing for {cached_mut_pdbqt.name} — cannot verify"
            if ok:
                receptor_for_variant[mut] = cached_mut_pdbqt
                cached_mut_pdb = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.clean.pdb"
                if cached_mut_pdb.exists():
                    receptor_pdb_for_variant[mut] = cached_mut_pdb
                hint = pocket_hints.get(mut)
                variant_extra[mut] = f"foldx_precached|{hint}" if hint else "foldx_precached"
                log.info("Using precached mutant receptor %s (verified)", cached_mut_pdbqt.name)
            else:
                # Precache is corrupt (was built with the old PDBFixer-renumbering
                # bug). Don't give up — try the PDBFixer mutation builder as a
                # second chance. If THAT works, we get a real mutant; if it
                # fails too, then we mark the cell with both reasons.
                log.warning("Precached mutant %s FAILED verification (%s) — trying PDBFixer fallback",
                            cached_mut_pdbqt.name, reason)
                try:
                    from deltadock_pipeline.mutate import build_mutant_pdbfixer
                    fresh_pdb = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.fresh.clean.pdb"
                    fresh_pdbqt = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.fresh.pdbqt"
                    build_mutant_pdbfixer(
                        pdb_path=cleaned_pdb,
                        chain=chain,
                        mutation_code=mut,
                        out_path=fresh_pdb,
                        # Per-target opt-out from the post-PDBFixer OpenMM
                        # vacuum minimisation. Default True; BRAF flips this
                        # to False because V600E activation-loop biology
                        # doesn't survive a local-minimum search. See the
                        # Target.minimize_mutant docstring in catalog.py.
                        minimize=catalog_target.minimize_mutant if catalog_target else True,
                    )
                    prepare_receptor(fresh_pdb, fresh_pdbqt, chain=chain)
                    _stamp(fresh_pdbqt)
                    _stamp(fresh_pdb)
                    # Verify against the PDB (preserves residue numbering);
                    # the PDBQT obabel writes is renumbered.
                    ok2, reason2 = verify_mutation_applied(fresh_pdb, chain, mut)
                    if ok2:
                        receptor_for_variant[mut] = fresh_pdbqt
                        receptor_pdb_for_variant[mut] = fresh_pdb
                        hint = pocket_hints.get(mut)
                        variant_extra[mut] = (
                            f"pdbfixer_mutated_after_bad_precache|{hint}" if hint
                            else "pdbfixer_mutated_after_bad_precache"
                        )
                        log.info("Recovered %s via PDBFixer fallback", mut)
                    else:
                        receptor_for_variant[mut] = None  # type: ignore[assignment]
                        variant_extra[mut] = (
                            f"mutant_verify_failed: precache={reason} pdbfixer={reason2}"
                        )
                except Exception as me:
                    receptor_for_variant[mut] = None  # type: ignore[assignment]
                    variant_extra[mut] = (
                        f"mutant_verify_failed: precache={reason} "
                        f"pdbfixer_err={type(me).__name__}:{str(me)[:60]}"
                    )
            continue
        if not foldx_on:
            # NEW: PDBFixer-based mutation building. We can't use FoldX in prod
            # (license-restricted Linux binary not vendored), but PDBFixer's
            # applyMutations() does a perfectly serviceable side-chain swap
            # using its built-in rotamer library. We lose the ΔΔG number but
            # GAIN correct mutant geometry — a much better deal than silently
            # docking against WT and pretending it's the mutant.
            try:
                from deltadock_pipeline.mutate import build_mutant_pdbfixer, MutateError
                mut_pdb_out = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.clean.pdb"
                mut_receptor_out = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.pdbqt"
                if _is_stale(mut_receptor_out):
                    log.info("PDBFixer mutation: %s on %s chain %s", mut, pdb_id, chain)
                    build_mutant_pdbfixer(
                        pdb_path=cleaned_pdb,
                        chain=chain,
                        mutation_code=mut,
                        out_path=mut_pdb_out,
                        # Per-target minimisation flag — see other call site
                        # plus catalog.py Target.minimize_mutant docstring.
                        minimize=catalog_target.minimize_mutant if catalog_target else True,
                    )
                    prepare_receptor(mut_pdb_out, mut_receptor_out, chain=chain)
                    _stamp(mut_pdb_out)
                    _stamp(mut_receptor_out)
                # Verify the resulting receptor actually has the substitution
                # Verify against the PDB (mut_pdb_out), not the PDBQT.
                # obabel renumbers residues when writing PDBQT (collapses
                # 600-947 → 1-N), so the residue numbers we typed only
                # survive in the PDB. Vina/QuickVina doesn't care about
                # residue numbers — it only reads atomic coordinates — so
                # this discrepancy doesn't affect docking, only verification.
                ok, reason = verify_mutation_applied(mut_pdb_out, chain, mut)
                if ok:
                    receptor_for_variant[mut] = mut_receptor_out
                    receptor_pdb_for_variant[mut] = mut_pdb_out
                    hint = pocket_hints.get(mut)
                    variant_extra[mut] = f"pdbfixer_mutated|{hint}" if hint else "pdbfixer_mutated"
                else:
                    log.warning("PDBFixer mutation %s verification failed: %s", mut, reason)
                    receptor_for_variant[mut] = None  # type: ignore[assignment]
                    variant_extra[mut] = f"mutant_verify_failed: {reason}"
            except Exception as me:
                log.warning("PDBFixer mutation %s failed: %s — docking against WT", mut, me)
                receptor_for_variant[mut] = wt_receptor
                variant_extra[mut] = f"mutant_build_failed:{type(me).__name__}:{str(me)[:60]}"
            continue
        try:
            log.info("FoldX BuildModel: %s on %s chain %s", mut, pdb_id, chain)
            with tempfile.TemporaryDirectory(prefix=f"foldx-{job.id}-{mut}-") as fx_work:
                res = build_mutant(
                    pdb_path=cleaned_pdb,
                    chain=chain,
                    mutation_code=mut,
                    out_dir=fx_work,
                    foldx_path=FOLDX_PATH,
                    cache_dir=FOLDX_CACHE,
                )
                # Now turn the mutant PDB into a PDBQT receptor
                mut_receptor = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.pdbqt"
                if not mut_receptor.exists() or mut_receptor.stat().st_size == 0:
                    prepare_receptor(res.mutant_pdb, mut_receptor, chain=chain)
                # Also cache the cleaned mutant PDB for ProLIF (no PDBQT round-trip)
                mut_pdb_cached = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.clean.pdb"
                if not mut_pdb_cached.exists() or mut_pdb_cached.stat().st_size == 0:
                    shutil.copy(res.mutant_pdb, mut_pdb_cached)
                receptor_for_variant[mut] = mut_receptor
                receptor_pdb_for_variant[mut] = mut_pdb_cached
                variant_ddg[mut] = res.ddg_kcal_mol
                variant_extra[mut] = (
                    f"foldx_ddg={res.ddg_kcal_mol:.2f}" if res.ddg_kcal_mol is not None
                    else "foldx_ok"
                )
        except FoldXError as e:
            log.warning("FoldX failed for %s: %s — falling back to WT receptor", mut, e)
            receptor_for_variant[mut] = wt_receptor
            receptor_pdb_for_variant[mut] = cleaned_pdb
            variant_extra[mut] = f"foldx_failed: {e}"

    set_stage(session, job.id, "preparing_compounds")
    # Step 4+5: prep each ligand and dock against each variant's receptor.
    # We check job.status between cells (cooperative cancellation) — if the
    # user has hit POST /jobs/{key}/cancel via the UI, we bail out as soon
    # as the currently-in-flight Pod GPU call returns. This stops further
    # compute spend within ~3 s of the cancel click.
    with tempfile.TemporaryDirectory(prefix=f"deltadock-job{job.id}-") as work_str:
        work = Path(work_str)

        # ── Pending-validation queue. When defer_validation is on, validation
        # is skipped inside _finalize_cell and queued here. After the main
        # docking loop finishes (and the job is marked COMPLETED so the user
        # sees scores immediately), we drain this queue in a ThreadPoolExecutor
        # that updates row.extra as each validation finishes. The frontend's
        # 2s polling picks up the updates piecewise.
        pending_validations: list[dict] = []
        # ── Pending-interface-extras queue. BSA (freesasa × 3 SASA calls)
        # and Vina score breakdown (smina --score_only) together add
        # ~2-4 s per cell. Always deferred so the result row appears as
        # fast as it did before A+B+C shipped; chips paint in on the
        # next 2s frontend poll.
        pending_interface_extras: list[dict] = []
        defer_val = settings.defer_validation and validate_on

        # ── Dock result cache (services/dock_cache.py) — flag-gated + fail-open.
        # A HIT serves a stored score+pose for an IDENTICAL molecule (canonical
        # isomeric InChIKey) under identical conditions, skipping the GPU dock
        # entirely; validation still re-runs so quality chips resolve like a
        # normal dock. Any error, or DOCK_CACHE_ENABLED=off, behaves exactly
        # like a normal uncached dock. Nothing is written to the pod — the cache
        # lives in the app DB.
        def _canon_engine(engine_used: str) -> str:
            """Map a path-specific engine label to a canonical dock engine, so a
            GNINA result can never be served for a QuickVina request (and the
            batched 'pod_gpu_batch' label matches a plain QuickVina dock)."""
            e = (engine_used or "").lower()
            if "gnina" in e:
                return "gnina"
            if "boltz" in e:
                return "boltz2"
            return "quickvina2-gpu"

        def _dock_cache_key(compound, variant, engine_canon):
            try:
                from . import dock_cache as _dc
                ik = _dc.canonical_inchikey(compound.smiles)
                if not ik:
                    return None, None
                key = _dc.make_cache_key(
                    inchikey=ik, pdb_id=job.pdb_id, chain=job.chain, variant=variant,
                    engine=engine_canon, engine_version="v1",
                    exhaustiveness=exhaustiveness,
                    box=(box.center_x, box.center_y, box.center_z,
                         box.size_x, box.size_y, box.size_z),
                    prep_version=settings.dock_cache_prep_version,
                    ensemble=ensemble_on,
                )
                return ik, key
            except Exception:  # noqa: BLE001 — uncacheable → behave as a miss
                return None, None

        def _dock_cache_store(compound, variant, result, extra, engine_used):
            if not settings.dock_cache_enabled:
                return
            try:
                from . import dock_cache as _dc
                engine_canon = _canon_engine(engine_used)
                ik, key = _dock_cache_key(compound, variant, engine_canon)
                if not key:
                    return
                try:
                    pose_text = Path(result.pose_pdbqt).read_text()
                except Exception:  # noqa: BLE001
                    pose_text = None
                if pose_text is None:
                    return
                _dc.store(
                    cache_key=key, inchikey=ik, pdb_id=job.pdb_id, chain=job.chain,
                    variant=variant, engine=engine_canon, engine_version="v1",
                    exhaustiveness=exhaustiveness,
                    prep_version=settings.dock_cache_prep_version,
                    best_score=float(result.best_score), pose_pdbqt=pose_text,
                    extra=extra,
                )
            except Exception as e:  # noqa: BLE001
                log.info("dock_cache store skipped (%s)", e)

        def _dock_cache_try_hit(compound, variant, receptor, receptor_pdb, run_dir,
                                engine_canon="quickvina2-gpu"):
            """On a hit: write the DockingResult row from cache + enqueue
            validation, return True (caller skips the GPU dock). Else False.
            engine_canon must match the engine the cell would otherwise dock
            with, so a QuickVina result is never served for a GNINA request."""
            if not settings.dock_cache_enabled:
                return False
            try:
                from . import dock_cache as _dc
                ik, key = _dock_cache_key(compound, variant, engine_canon)
                if not key:
                    return False
                cached = _dc.lookup(key)
                if not cached or not cached.get("pose_pdbqt"):
                    return False
                pose_path = Path(run_dir) / f"cachehit_c{compound.id}_{variant}.pdbqt"
                pose_path.write_text(cached["pose_pdbqt"])
                from .pose_store import get_pose_store
                try:
                    pose_uri = get_pose_store().write(job.id, compound.id, variant, pose_path)
                except Exception:  # noqa: BLE001
                    pose_uri = str(pose_path)
                # Re-validate from the cached pose so quality chips resolve like a
                # normal dock — we skipped only the GPU dock, not validation.
                pending_validations.append({
                    "job_id": job.id, "compound_id": compound.id, "variant": variant,
                    "receptor": receptor, "receptor_pdb": receptor_pdb,
                    "pose_pdbqt": str(pose_path), "run_dir": run_dir,
                    "ligand_smiles": compound.smiles,
                    "current_extra": "engine=cache|validate=pending",
                })
                session.add(DockingResult(
                    job_id=job.id, compound_id=compound.id, variant=variant,
                    best_score=float(cached["best_score"]), pose_uri=pose_uri,
                    extra="engine=cache|validate=pending",
                ))
                log.info("dock_cache HIT c%s x %s — skipped GPU dock", compound.id, variant)
                return True
            except Exception as e:  # noqa: BLE001
                log.info("dock_cache hit path failed (%s) — docking normally", e)
                return False

        # ── Per-cell finalize: shared between the legacy per-cell path and
        # the new batched-per-variant path. Runs vinardo rescore + (eagerly
        # OR deferred) ProLIF/PoseBusters validation, persists the pose to
        # R2 (or local), and writes the DB row. Pure side effects on
        # `session`; caller commits.
        def _finalize_cell(compound, variant, receptor, receptor_pdb, run_dir, result,
                           engine_used, extra_segments=None):
            parts = [variant_extra.get(variant)] if variant_extra.get(variant) else []
            parts.append(f"engine={engine_used}")
            # Optional caller-supplied extra segments (e.g. the ensemble path
            # injects ensemble=N/M | ens_spread=X | ens_best=label here).
            # Appended right after engine= so they sit alongside the other
            # pipe-delimited telemetry parseExtra.ts already understands.
            if extra_segments:
                parts.extend(seg for seg in extra_segments if seg)
            try:
                from deltadock_pipeline.rescore import smina_rescore
                v_score = smina_rescore(receptor, result.pose_pdbqt, scoring="vinardo")
                if v_score is not None:
                    parts.append(f"vinardo={v_score:.2f}")
            except Exception as e:
                log.info("Vinardo rescore failed for c%s × %s: %s", compound.id, variant, e)
            if validate_on and not defer_val:
                # Eager (legacy) validation — runs synchronously before the
                # row is written. Slow but simpler.
                try:
                    v = validate_pose(
                        receptor_pdbqt=receptor,
                        pose_pdbqt=result.pose_pdbqt,
                        receptor_pdb=receptor_pdb,
                        work_dir=run_dir,
                        ligand_smiles=compound.smiles,
                    )
                    parts.append(v.to_extra_string())
                except Exception as ve:
                    log.warning("Validation crashed for c%s × %s: %s", compound.id, variant, ve)
                    parts.append(f"validate_err={str(ve)[:80]}")
            elif defer_val:
                # Deferred — write a placeholder so the matrix UI knows to
                # show "validation pending" rather than a missing column.
                parts.append("validate=pending")

            # ── Phase 0 water-displacement analysis (#103). Cheap, inline,
            # fail-soft. Pulls HOH records from raw_pdb (preserved by
            # fetch_pdb before strip_hetatm) and counts crystallographic
            # waters the pose displaces vs the count of pocket waters.
            # Format on extra: "water=N/M" where N=displaced, M=pocket
            # waters. Frontend renders a Water Analysis panel from this
            # plus a "Phase 0: not WaterMap" honesty caveat.
            # ── Interface KPIs + Vina score decomposition (v1.26 — extras
            # surfaced from FoldX/FlexPepDock comparison). Cheap, inline,
            # fail-soft. We compute three signals per pose:
            #   iface_bsa  — buried surface area in Å² via freesasa
            #   iface_hb   — H-bond count from ProLIF interactions (eager
            #                validation path only; deferred path skips it)
            #   vina_terms — gauss1/2/repulsion/hydrophobic/hbond + total
            #                from smina --score_only --scoring vina
            # All three are best-effort; any failure just omits the key
            # from extra and the frontend gracefully hides the chip.
            # H-bond count: parse from the contacts=… sub-segment of
            # validate_pose's output. This is FREE (just string parsing
            # over an already-computed validator blob), so it stays inline.
            # The slow stuff (freesasa, smina --score_only) is deferred
            # to _drain_pending_interface_extras after the row is written.
            try:
                from deltadock_pipeline.interface_extras import format_for_extra
                hbonds = None
                for p in parts:
                    if not isinstance(p, str):
                        continue
                    for sub in p.split("|"):
                        if sub.startswith("contacts="):
                            n = 0
                            for tok in sub[len("contacts="):].split(","):
                                t = tok.split(":")[1] if ":" in tok else ""
                                tl = t.lower()
                                if tl.startswith("hbond") or tl.startswith("hbdo") or tl.startswith("hbac"):
                                    n += 1
                            hbonds = n
                            break
                    if hbonds is not None:
                        break
                parts.extend(format_for_extra(hbonds=hbonds))
                # Mark BSA + vina_terms as pending so the frontend can
                # show a "computing…" hint if it wants, and so the
                # drainer can strip the placeholder when it updates.
                parts.append("extras=pending")
                pending_interface_extras.append({
                    "compound_id": compound.id,
                    "variant": variant,
                    "job_id": job.id,
                    "receptor": str(receptor),
                    "receptor_pdb": str(receptor_pdb),
                    "pose_pdbqt": str(result.pose_pdbqt),
                    "run_dir": str(run_dir),
                })
            except Exception as ie:
                log.debug("H-bond inline parse skipped for c%s × %s: %s",
                          compound.id, variant, ie)

            try:
                from deltadock_pipeline.water import analyse_pose_water_displacement
                wresult = analyse_pose_water_displacement(
                    receptor_pdb=raw_pdb,
                    pose_pdb=result.pose_pdbqt,
                    pocket_centre=(cx, cy, cz),
                    pose_id=f"c{compound.id}_{variant}",
                )
                # Compact representation for the extra string. Rich per-water
                # detail isn't needed for Phase 0 because the JobPage panel
                # surfaces just the counts + interpretation copy. Phase 1
                # (3D-RISM) will warrant a separate JSON column.
                parts.append(f"water={wresult.displaced_count}/{wresult.pocket_water_count}")
            except Exception as we:
                # Fail-soft: water analysis is informational, not blocking.
                # Don't even log warning unless debug — it's expected to
                # fail on cryo-EM PDBs without deposited waters.
                log.debug("Water analysis skipped for c%s × %s: %s", compound.id, variant, we)

            from .pose_store import get_pose_store
            try:
                pose_uri = get_pose_store().write(
                    job.id, compound.id, variant, Path(result.pose_pdbqt)
                )
            except Exception as e:
                log.warning("Could not persist pose for c%s × %s: %s", compound.id, variant, e)
                pose_uri = str(result.pose_pdbqt)
            session.add(DockingResult(
                job_id=job.id, compound_id=compound.id, variant=variant,
                best_score=result.best_score,
                pose_uri=pose_uri,
                extra="|".join(parts) if parts else None,
            ))
            if defer_val:
                # Capture everything the validation thread needs. Note we
                # snapshot the pose_pdbqt path WHILE the runner's tempdir
                # still exists — the validation pass must finish before the
                # outer `with tempfile.TemporaryDirectory()` block exits,
                # otherwise the pose file gets unlinked out from under it.
                pending_validations.append({
                    "job_id": job.id,
                    "compound_id": compound.id,
                    "variant": variant,
                    "receptor": receptor,
                    "receptor_pdb": receptor_pdb,
                    "pose_pdbqt": result.pose_pdbqt,
                    "run_dir": run_dir,
                    "ligand_smiles": compound.smiles,
                    "current_extra": "|".join(parts) if parts else None,
                })

            # Cache this fresh result for instant repeat docks (flag-gated,
            # fail-open, app-DB only — never written to the pod). Stores
            # score + pose keyed by canonical InChIKey + conditions.
            _dock_cache_store(compound, variant, result,
                              "|".join(parts) if parts else None, engine_used)

        # ── Ensemble dispatch path. Activates when the job opted into
        # ensemble docking AND a Pod is configured. For each variant we
        # generate an MD-relaxed receptor conformer ensemble on the Pod,
        # dock the whole ligand batch against EACH conformer, and keep the
        # best score+pose per cell (recording the per-conformer spread).
        # Entirely separate from the standard paths below — when ensemble_on
        # is False this whole block is skipped and behaviour is byte-for-byte
        # unchanged. Fail-soft throughout: a failed ensemble generation, a
        # failed conformer prep, or a failed per-conformer dock just shrinks
        # the candidate set; the un-relaxed input is always a candidate, so
        # the worst case is "ensemble silently behaved like standard mode".
        #
        # `not gnina_requested` — ensemble v1 uses the QuickVina batch
        # primitive, so a gnina+ensemble job falls through to the standard
        # GNINA path instead (see the warning logged at gnina_requested).
        if ensemble_on and not gnina_requested:
            # Mark pod activity so the cost-control watchdog doesn't auto-stop
            # mid-job. See services/pod_activity.py.
            from .pod_activity import bump_pod_activity  # local: avoid circular
            bump_pod_activity()
            # Pose-drift threshold + offset helper — used to prefer in-pocket
            # conformer poses over off-pocket ones with artificially good scores.
            from .pocket_filter import (
                _POSE_DRIFT_THRESHOLD_A, compute_pose_offset_a,
            )
            log.info(
                "Using ENSEMBLE dispatch: %d compound(s) x %d variant(s)",
                len(compounds), len(variants),
            )

            def _dock_variant_ensemble(variant, receptor, receptor_pdb, batch_ligs):
                """Dock a ligand batch against an MD-relaxed receptor conformer
                ensemble for ONE variant.

                Per compound: keep the best pose+score across conformers
                (preferring in-pocket poses, then most-negative score) and
                record the score spread across conformers. Adds DockingResult
                rows via _finalize_cell (or a docking_failed row when every
                conformer failed for a ligand). Caller commits."""
                set_stage(session, job.id, f"ensemble_relax_{variant}")
                ens_dir = work / f"ensemble_{variant}"
                ens_dir.mkdir(exist_ok=True)

                # Step 1: generate the receptor conformer ensemble on the Pod.
                # relax_ensemble_pod NEVER raises — on any failure it returns
                # just [receptor_pdb], so this variant transparently degrades
                # to standard single-conformation docking.
                conformer_pdbs = relax_ensemble_pod(
                    receptor_pdb=receptor_pdb,
                    box_center=(box.center_x, box.center_y, box.center_z),
                    out_dir=ens_dir,
                    cfg=pod_cfg,
                )

                # Step 2: prep each conformer PDB into a docking-ready PDBQT.
                # conformer_pdbs[0] is the original receptor_pdb whose PDBQT
                # (`receptor`) is already built — reuse it. Only conformers
                # 1..N need prepare_receptor; a conformer that fails prep is
                # dropped (we still have the others + the un-relaxed input).
                # conformers: list of (label, receptor_pdbqt, receptor_clean_pdb)
                conformers = [("input", receptor, receptor_pdb)]
                for i, conf_pdb in enumerate(conformer_pdbs[1:], start=1):
                    try:
                        conf_pdbqt = ens_dir / f"{conf_pdb.stem}.pdbqt"
                        prepare_receptor(conf_pdb, conf_pdbqt, chain=chain)
                        conformers.append((f"conf{i}", conf_pdbqt, conf_pdb))
                    except Exception as e:
                        log.warning(
                            "ensemble: conformer %d prep failed for %s: %s — dropping",
                            i, variant, e,
                        )
                conf_by_label = {lbl: (pq, cp) for (lbl, pq, cp) in conformers}
                n_conf = len(conformers)
                log.info("ensemble: variant %s — docking against %d receptor conformer(s)",
                         variant, n_conf)

                # Step 3: dock the whole ligand batch against EACH conformer —
                # one dock_batch_pod call per conformer (the GPU loads that
                # conformer once and docks every ligand). A per-conformer
                # failure is non-fatal: we just lose that conformer's poses.
                # per_compound[cid] = [(conf_label, BatchDockResult, run_dir), ...]
                per_compound: dict[int, list] = {}
                for conf_idx, (conf_label, conf_pdbqt, _cp) in enumerate(conformers, start=1):
                    if is_cancelled(session, job.id):
                        raise JobCancelled()
                    set_stage(session, job.id,
                              f"ensemble_dock_{variant}_{conf_idx}_of_{n_conf}")
                    conf_run_dir = ens_dir / f"dock_{conf_label}"
                    conf_run_dir.mkdir(exist_ok=True)
                    try:
                        batch_results = dock_batch_pod(
                            receptor_pdbqt=conf_pdbqt,
                            ligands=batch_ligs,
                            box=box,
                            work_dir=conf_run_dir,
                            cfg=pod_cfg,
                            exhaustiveness=exhaustiveness,
                            num_modes=9,
                        )
                    except PodDockError as pde:
                        log.warning(
                            "ensemble: batch dock failed for %s conformer %s: %s "
                            "— skipping this conformer", variant, conf_label, pde,
                        )
                        continue
                    for br in batch_results:
                        try:
                            cid = int(br.id)
                        except (TypeError, ValueError):
                            continue
                        per_compound.setdefault(cid, []).append(
                            (conf_label, br, conf_run_dir)
                        )

                # Step 4: per compound, pick the winning conformer. Sort key
                # prefers in-pocket poses, then most-negative score — so an
                # off-pocket pose with an artificially good score can't beat
                # a clean in-pocket one. The spread (worst − best across all
                # successful conformers) is recorded as a transparency signal:
                # how much receptor flexibility actually moved this score.
                box_center = (box.center_x, box.center_y, box.center_z)
                for c in compounds:
                    if c.id not in prepped:
                        continue
                    attempts = per_compound.get(c.id, [])
                    ok = [(lbl, br, rd) for (lbl, br, rd) in attempts
                          if br.result is not None and not br.error]
                    if not ok:
                        errs = "; ".join(
                            br.error for (_, br, _) in attempts if br.error
                        ) or "no conformer produced a pose"
                        log.warning(
                            "ensemble: c%s x %s — all %d conformer dock(s) failed: %s",
                            c.id, variant, len(attempts), errs,
                        )
                        session.add(DockingResult(
                            job_id=job.id, compound_id=c.id, variant=variant,
                            best_score=0.0,
                            extra=f"docking_failed: ensemble — all conformers failed "
                                  f"({errs[:120]})",
                        ))
                        continue

                    scored = []
                    for (lbl, br, rd) in ok:
                        try:
                            offset = compute_pose_offset_a(
                                pose_pdbqt=br.result.pose_pdbqt, box_center=box_center,
                            )
                        except Exception:
                            offset = 0.0  # offset unknown — don't penalise
                        scored.append((lbl, br, rd, offset, br.result.best_score))
                    # in-pocket first (False sorts before True), then most-negative score
                    scored.sort(key=lambda t: (t[3] > _POSE_DRIFT_THRESHOLD_A, t[4]))
                    best_label, best_br, best_run_dir, best_offset, best_score = scored[0]

                    all_scores = [t[4] for t in scored]
                    spread = max(all_scores) - min(all_scores)
                    n_ok = len(ok)
                    in_pocket = best_offset <= _POSE_DRIFT_THRESHOLD_A
                    ens_segments = [
                        f"ensemble={n_ok}/{n_conf}",
                        f"ens_spread={spread:.2f}",
                        f"ens_best={best_label}",
                    ]
                    engine_label = (
                        "pod_gpu_ensemble" if in_pocket
                        else "pod_gpu_ensemble_off_pocket"
                    )
                    win_pdbqt, win_pdb = conf_by_label.get(
                        best_label, (receptor, receptor_pdb)
                    )
                    log.info(
                        "ensemble: c%s x %s — best=%s score=%.2f spread=%.2f (%d/%d ok)",
                        c.id, variant, best_label, best_score, spread, n_ok, n_conf,
                    )
                    try:
                        _finalize_cell(
                            c, variant, win_pdbqt, win_pdb, best_run_dir,
                            best_br.result, engine_label, extra_segments=ens_segments,
                        )
                    except Exception as e:
                        log.warning("ensemble: finalize failed for c%s x %s: %s",
                                    c.id, variant, e)
                        session.add(DockingResult(
                            job_id=job.id, compound_id=c.id, variant=variant,
                            best_score=0.0,
                            extra=f"docking_failed: ensemble finalize {str(e)[:120]}",
                        ))

            # Phase 1: prep every ligand once (identical to the batched path).
            prepped: dict[int, Path] = {}
            for compound in compounds:
                if is_cancelled(session, job.id):
                    log.info("Job %s cancelled during ligand prep", job.id)
                    raise JobCancelled()
                try:
                    lig_pdbqt = work / f"compound_{compound.id}.pdbqt"
                    prepare_ligand(compound.smiles, lig_pdbqt,
                                   name=compound.name or f"c{compound.id}")
                    prepped[compound.id] = lig_pdbqt
                except Exception as e:
                    log.warning("Ligand prep failed for compound %s: %s", compound.id, e)
                    for variant in variants:
                        session.add(DockingResult(
                            job_id=job.id, compound_id=compound.id, variant=variant,
                            best_score=0.0, extra=f"ligand_prep_failed: {e}",
                        ))
                    _commit_retry(session)

            # Phase 2: per-variant ensemble dispatch.
            for variant in variants:
                if is_cancelled(session, job.id):
                    log.info("Job %s cancelled — skipping remaining variants", job.id)
                    raise JobCancelled()
                receptor = receptor_for_variant.get(variant, wt_receptor)
                receptor_pdb = receptor_pdb_for_variant.get(variant, cleaned_pdb)
                # Sentinel: receptor=None ⇒ upstream caught a corrupt precache.
                if receptor is None:
                    fail_reason = variant_extra.get(variant, "mutant_verify_failed")
                    log.warning("Variant %s receptor unavailable: %s", variant, fail_reason)
                    for c in compounds:
                        if c.id in prepped:
                            session.add(DockingResult(
                                job_id=job.id, compound_id=c.id, variant=variant,
                                best_score=0.0, extra=fail_reason,
                            ))
                    _commit_retry(session)
                    continue

                batch_ligs = [
                    BatchLigand(id=str(c.id), pdbqt_path=prepped[c.id])
                    for c in compounds if c.id in prepped
                ]
                if not batch_ligs:
                    continue
                _dock_variant_ensemble(variant, receptor, receptor_pdb, batch_ligs)
                _commit_retry(session)

            # Mark COMPLETED before the validation drain so the user sees the
            # matrix as soon as docking finishes — same ordering as the
            # standard batched path.
            if pending_validations:
                session.refresh(job)
                if job.status != JobStatus.CANCELLED:
                    job.status = JobStatus.COMPLETED
                    job.updated_at = datetime.utcnow()
                    session.add(job)
                    _commit_retry(session)
                    log.info("Job %s ensemble docking phase complete; "
                             "running validation in background", job.id)
            set_stage(session, job.id,
                      "validating_poses" if pending_validations else None)
            _drain_pending_validations(pending_validations, session)
            _drain_pending_interface_extras(pending_interface_extras, session)
            set_stage(session, job.id, None)
            return  # ensemble path done; skip the standard dispatch below

        # ── Batched-per-variant dispatch path. Activates when pod_batch_on
        # AND the matrix has more than one cell. Inverts the loop nesting:
        # for each variant, prep all compound ligands once, then send the
        # whole list to the Pod's /dock_batch endpoint in a single HTTP call.
        # The GPU loads the receptor once per variant instead of once per
        # cell — major throughput win on suite jobs.
        # On any whole-batch HTTP failure we fall back to the per-cell Pod
        # call for that variant, which is exactly what the legacy path does
        # anyway, so reliability is unchanged.
        # (U3) Small jobs skip the batched path so the user sees cells
        # stream in one-by-one instead of all-at-once-per-variant. The
        # default cutoff (12 cells) keeps batch dispatch for large
        # screening jobs where GPU throughput dominates; configurable
        # via POD_BATCH_DOCK_MIN_CELLS env var.
        if pod_batch_on and (len(compounds) * len(variants)) >= settings.pod_batch_dock_min_cells:
            # Mark pod activity so cost-control watchdog doesn't auto-stop
            # mid-job. See services/pod_activity.py.
            from .pod_activity import bump_pod_activity  # local: avoid circular
            bump_pod_activity()
            log.info(
                "Using batched dispatch: %d compounds x %d variants",
                len(compounds), len(variants),
            )

            # Phase 1: prep every ligand once. Failed-prep compounds get a
            # ligand_prep_failed row written for every variant up front so
            # the user sees them immediately and we don't waste GPU on them.
            prepped: dict[int, Path] = {}
            for compound in compounds:
                if is_cancelled(session, job.id):
                    log.info("Job %s cancelled during ligand prep", job.id)
                    raise JobCancelled()
                try:
                    lig_pdbqt = work / f"compound_{compound.id}.pdbqt"
                    prepare_ligand(compound.smiles, lig_pdbqt, name=compound.name or f"c{compound.id}")
                    prepped[compound.id] = lig_pdbqt
                except Exception as e:
                    log.warning("Ligand prep failed for compound %s: %s", compound.id, e)
                    for variant in variants:
                        session.add(DockingResult(
                            job_id=job.id, compound_id=compound.id, variant=variant,
                            best_score=0.0, extra=f"ligand_prep_failed: {e}",
                        ))
                    _commit_retry(session)

            # Phase 2: per-variant batched dispatch.
            for variant in variants:
                if is_cancelled(session, job.id):
                    log.info("Job %s cancelled — skipping remaining variants", job.id)
                    raise JobCancelled()
                receptor = receptor_for_variant.get(variant, wt_receptor)
                receptor_pdb = receptor_pdb_for_variant.get(variant, cleaned_pdb)
                # Sentinel: receptor=None means upstream caught a corrupt
                # precache. Write the failure row for every prepped compound
                # in this variant, then move on to the next variant.
                if receptor is None:
                    fail_reason = variant_extra.get(variant, "mutant_verify_failed")
                    log.warning("Variant %s receptor unavailable: %s", variant, fail_reason)
                    for c in compounds:
                        if c.id in prepped:
                            session.add(DockingResult(
                                job_id=job.id, compound_id=c.id, variant=variant,
                                best_score=0.0, extra=fail_reason,
                            ))
                    _commit_retry(session)
                    continue

                run_dir = work / f"batch_{variant}"
                run_dir.mkdir(exist_ok=True)

                # Cache pass: serve identical prior docks from the cache (skips
                # the GPU dock entirely) and send only genuine misses to the
                # pod. Fail-open: _dock_cache_try_hit returns False on any error
                # or when the cache is disabled, so this degrades cleanly to a
                # normal full batch.
                batch_ligs = []
                for c in compounds:
                    if c.id not in prepped:
                        continue
                    if _dock_cache_try_hit(c, variant, receptor, receptor_pdb, run_dir):
                        continue
                    batch_ligs.append(BatchLigand(id=str(c.id), pdbqt_path=prepped[c.id]))
                if not batch_ligs:
                    _commit_retry(session)  # persist cache-hit rows for this all-hit variant
                    continue

                # Single HTTP call — the Pod loads the receptor once and
                # docks every ligand in one GPU session.
                try:
                    batch_results = dock_batch_pod(
                        receptor_pdbqt=receptor,
                        ligands=batch_ligs,
                        box=box,
                        work_dir=run_dir,
                        cfg=pod_cfg,
                        exhaustiveness=exhaustiveness,
                        num_modes=9,
                    )
                    results_by_id = {br.id: br for br in batch_results}
                    engine_label = "pod_gpu_batch"
                except PodDockError as pde:
                    # Whole-batch failure: fall back to per-cell single-
                    # ligand /dock for this variant. Exact same code path
                    # as the legacy loop uses for a per-cell error, just
                    # scoped to this variant's compounds.
                    log.warning(
                        "Batch dispatch failed for %s: %s — falling back per-cell",
                        variant, pde,
                    )
                    for c in compounds:
                        if c.id not in prepped:
                            continue
                        if is_cancelled(session, job.id):
                            raise JobCancelled()
                        cell_dir = work / f"compound_{c.id}_{variant}"
                        cell_dir.mkdir(exist_ok=True)
                        try:
                            # Pocket-best wraps the per-cell fallback path
                            # too. When the whole batch failed and we're
                            # going per-cell, every dock here is already a
                            # second attempt at this ligand — but we still
                            # want the 3× pocket filter so the FINAL pose
                            # is in-pocket regardless.
                            result, _pb_meta = dock_one_with_pocket_best(
                                dock_one_pod,
                                receptor_pdbqt=receptor,
                                ligand_pdbqt=prepped[c.id],
                                box=box,
                                work_dir=cell_dir,
                                cfg=pod_cfg,
                                exhaustiveness=exhaustiveness,
                                num_modes=9,
                            )
                            _finalize_cell(
                                c, variant, receptor, receptor_pdb, cell_dir, result,
                                engine_label_with_attempts("pod_gpu_after_batch_fail", _pb_meta),
                            )
                        except Exception as e:
                            # Per-cell Pod retry failed too. Burst overflow:
                            # try RunPod serverless if configured before
                            # giving up on this cell.
                            if runpod_on:
                                log.warning("Per-cell Pod fallback failed for c%s × %s: %s — overflowing to RunPod",
                                            c.id, variant, e)
                                try:
                                    # Pocket-best wraps the RunPod-serverless
                                    # fallback in the batch-fail path too —
                                    # consistency with the legacy per-cell
                                    # branches above.
                                    result, _pb_meta = dock_one_with_pocket_best(
                                        dock_one_runpod,
                                        receptor_pdbqt=receptor,
                                        ligand_pdbqt=prepped[c.id],
                                        box=box,
                                        work_dir=cell_dir,
                                        cfg=runpod_cfg,
                                        exhaustiveness=exhaustiveness,
                                        num_modes=9,
                                    )
                                    _finalize_cell(
                                        c, variant, receptor, receptor_pdb, cell_dir, result,
                                        engine_label_with_attempts("runpod_after_batch_fail", _pb_meta),
                                    )
                                except Exception as e2:
                                    log.warning("RunPod also failed for c%s × %s: %s", c.id, variant, e2)
                                    session.add(DockingResult(
                                        job_id=job.id, compound_id=c.id, variant=variant,
                                        best_score=0.0, extra=f"docking_failed: {e2}",
                                    ))
                            else:
                                log.warning("Per-cell fallback failed for c%s × %s: %s", c.id, variant, e)
                                session.add(DockingResult(
                                    job_id=job.id, compound_id=c.id, variant=variant,
                                    best_score=0.0, extra=f"docking_failed: {e}",
                                ))
                    _commit_retry(session)
                    continue

                # Per-cell post-processing on batch results. The batch call
                # gave us one pose per ligand — most will be in-pocket, but
                # a few may have drifted to the protein surface. For those,
                # we re-roll just that ligand via dock_one_pod (with a
                # different seed) up to 2 more times to find an in-pocket
                # pose. The batch throughput win is preserved for the in-
                # pocket cells; we only pay extra GPU time on the outliers.
                # Pocket-best parity with quick_dock — added 2026-05-04.
                # See services/pocket_filter.py for the full rationale.
                from .pocket_filter import (  # local import keeps the hot path's import graph small
                    _POSE_DRIFT_THRESHOLD_A,
                    _BASE_SEED,
                    _MAX_POCKET_RETRIES,
                    compute_pose_offset_a,
                )
                _box_center = (box.center_x, box.center_y, box.center_z)
                for c in compounds:
                    if c.id not in prepped:
                        continue
                    br = results_by_id.get(str(c.id))
                    try:
                        if br is None:
                            raise RuntimeError("missing from batch response")
                        if br.error or not br.result:
                            raise RuntimeError(f"batch err: {br.error or 'no result'}")
                        # Check this cell's pose offset. If it drifted, try
                        # to find an in-pocket pose by re-rolling via per-
                        # ligand dock_one_pod with different seeds.
                        chosen = br.result
                        chosen_offset = compute_pose_offset_a(
                            pose_pdbqt=chosen.pose_pdbqt, box_center=_box_center,
                        )
                        cell_engine_label = engine_label
                        if chosen_offset > _POSE_DRIFT_THRESHOLD_A:
                            log.info(
                                "pocket_best (batched): c%s × %s drifted (%.2f Å) — re-rolling",
                                c.id, variant, chosen_offset,
                            )
                            cell_dir = work / f"compound_{c.id}_{variant}_reroll"
                            cell_dir.mkdir(exist_ok=True)
                            attempts: list = [(chosen, chosen_offset)]
                            for retry_idx in range(1, _MAX_POCKET_RETRIES):
                                try:
                                    retry_result = dock_one_pod(
                                        receptor_pdbqt=receptor,
                                        ligand_pdbqt=prepped[c.id],
                                        box=box,
                                        work_dir=cell_dir / f"attempt_{retry_idx + 1}",
                                        cfg=pod_cfg,
                                        exhaustiveness=exhaustiveness,
                                        num_modes=9,
                                        seed=_BASE_SEED + retry_idx,
                                    )
                                except Exception as re:  # noqa: BLE001
                                    log.info(
                                        "pocket_best (batched): retry %d errored — %s",
                                        retry_idx + 1, re,
                                    )
                                    continue
                                retry_offset = compute_pose_offset_a(
                                    pose_pdbqt=retry_result.pose_pdbqt, box_center=_box_center,
                                )
                                attempts.append((retry_result, retry_offset))
                                if retry_offset <= _POSE_DRIFT_THRESHOLD_A:
                                    break
                            attempts.sort(
                                key=lambda pair: (pair[0].modes[0].affinity_kcal_mol, pair[1]),
                            )
                            chosen, chosen_offset = attempts[0]
                            in_pocket = chosen_offset <= _POSE_DRIFT_THRESHOLD_A
                            cell_engine_label = engine_label + (
                                f"_retried_{len(attempts)}"
                                + ("" if in_pocket else "_off_pocket")
                            )
                            log.info(
                                "pocket_best (batched): c%s × %s final offset=%.2f Å, attempts=%d",
                                c.id, variant, chosen_offset, len(attempts),
                            )
                        _finalize_cell(c, variant, receptor, receptor_pdb, run_dir, chosen, cell_engine_label)
                    except Exception as e:
                        log.warning("Docking failed for c%s × %s: %s", c.id, variant, e)
                        session.add(DockingResult(
                            job_id=job.id, compound_id=c.id, variant=variant,
                            best_score=0.0, extra=f"docking_failed: {e}",
                        ))
                _commit_retry(session)
            # Mark COMPLETED *before* validation drain so the user sees
            # the matrix as soon as docking finishes, not after PoseBusters/
            # ProLIF (~30-60s of blocking subprocess work).
            if pending_validations:
                session.refresh(job)
                if job.status != JobStatus.CANCELLED:
                    job.status = JobStatus.COMPLETED
                    job.updated_at = datetime.utcnow()
                    session.add(job)
                    _commit_retry(session)
                    log.info("Job %s docking phase complete; running validation in background", job.id)
            set_stage(session, job.id, "validating_poses" if pending_validations else None)
            _drain_pending_validations(pending_validations, session)
            # BSA + Vina score breakdown background pass — fast (~2-4 s/cell
            # in parallel), runs after validation. Updates row.extra in
            # place; frontend's 2s polling picks the chips up.
            _drain_pending_interface_extras(pending_interface_extras, session)
            set_stage(session, job.id, None)
            return  # batched path done; skip the legacy per-cell loop below

        # ── Legacy per-cell dispatch (untouched). Kept as fallback for
        # local Vina runs (no Pod), per-cell debugging, and as the safety
        # net while the batched path stabilizes.
        for compound in compounds:
            if is_cancelled(session, job.id):
                log.info("Job %s cancelled — skipping remaining compounds", job.id)
                raise JobCancelled()
            try:
                lig_pdbqt = work / f"compound_{compound.id}.pdbqt"
                prepare_ligand(compound.smiles, lig_pdbqt, name=compound.name or f"c{compound.id}")
            except Exception as e:
                log.warning("Ligand prep failed for compound %s: %s", compound.id, e)
                for variant in variants:
                    session.add(DockingResult(
                        job_id=job.id, compound_id=compound.id, variant=variant,
                        best_score=0.0, extra=f"ligand_prep_failed: {e}",
                    ))
                _commit_retry(session)
                continue

            for variant in variants:
                if is_cancelled(session, job.id):
                    log.info("Job %s cancelled — skipping remaining variants", job.id)
                    raise JobCancelled()
                receptor = receptor_for_variant.get(variant, wt_receptor)
                receptor_pdb = receptor_pdb_for_variant.get(variant, cleaned_pdb)
                # Sentinel: receptor=None means we caught a corrupt precache
                # upstream. Emit a clear failure row and skip docking entirely.
                if receptor is None:
                    fail_reason = variant_extra.get(variant, "mutant_verify_failed")
                    log.warning("Skipping c%s × %s: %s", compound.id, variant, fail_reason)
                    session.add(DockingResult(
                        job_id=job.id, compound_id=compound.id, variant=variant,
                        best_score=0.0, extra=fail_reason,
                    ))
                    _commit_retry(session)
                    continue
                run_dir = work / f"compound_{compound.id}_{variant}"
                run_dir.mkdir(exist_ok=True)
                # Cache hit → write the row from cache + skip the GPU dock.
                # Keyed by the engine this cell would actually use (gnina vs
                # quickvina) so a result is never served for the wrong engine.
                if _dock_cache_try_hit(compound, variant, receptor, receptor_pdb, run_dir,
                                       "gnina" if gnina_requested else "quickvina2-gpu"):
                    continue
                # Auto-retry transient cell failures (DOCK_AUTO_RETRY_ENABLED).
                # The whole engine chain re-runs from scratch on the second
                # attempt — run_dir is wiped between tries so stale .pdbqt
                # artifacts can't confuse the next pass. Permanent errors
                # (RDKit/Meeko parse failures, invalid SMILES) skip the retry
                # and surface as docking_failed immediately. See
                # _is_permanent_dock_error + the constants at the top of this
                # module. Shipped 2026-05-31 in response to Job #360 Sotorasib
                # (returned 0.00/Caution on a warm-up stall, docked cleanly on
                # the very next attempt in #361).
                _cell_attempt = 0
                _cell_done = False
                while not _cell_done:
                    _cell_attempt += 1
                    try:
                        # Try the configured remote engine first (Pod GPU > RunPod
                        # serverless > local). On any error fall back to local Vina
                        # so one bad call doesn't take down the whole job.
                        engine_used = "local"
                        result = None
                        # When the user picked engine=gnina on this job AND the
                        # feature flag is on AND the Pod is reachable, GNINA
                        # takes priority over QuickVina2-GPU for the cell. Same
                        # error-handling shape: GNINA failure → fall through to
                        # Pod (QuickVina), then to local Vina, just like the
                        # Pod path does for RunPod overflow.
                        if gnina_requested:
                            try:
                                # Pocket-best wrapper applies to GNINA too — same
                                # off-pocket failure mode (Vina-family search
                                # under the hood) so the 3× re-roll buys the
                                # same parity gain. See pocket_filter.py.
                                result, _pb_meta = dock_one_with_pocket_best(
                                    dock_one_gnina,
                                    receptor_pdbqt=receptor,
                                    ligand_pdbqt=lig_pdbqt,
                                    box=box,
                                    work_dir=run_dir,
                                    cfg=gnina_cfg,
                                    exhaustiveness=exhaustiveness,
                                    num_modes=9,
                                )
                                engine_used = engine_label_with_attempts(
                                    f"gnina_{settings.gnina_cnn_mode}", _pb_meta,
                                )
                            except GninaDockError as gde:
                                log.warning("GNINA failed for c%s × %s: %s — falling back to QuickVina2-GPU",
                                            compound.id, variant, gde)
                                # Don't set engine_used yet — let the Pod branch
                                # below run and overwrite engine_used appropriately.
                        if result is None and pod_on:
                            try:
                                # Pocket-best wrapper: dock_one_pod runs once,
                                # then up to 2 more times if the first pose
                                # drifted off-pocket. Median cost overhead is
                                # ~33% (most cells in-pocket on attempt 1).
                                # See services/pocket_filter.py.
                                result, _pb_meta = dock_one_with_pocket_best(
                                    dock_one_pod,
                                    receptor_pdbqt=receptor,
                                    ligand_pdbqt=lig_pdbqt,
                                    box=box,
                                    work_dir=run_dir,
                                    cfg=pod_cfg,
                                    exhaustiveness=exhaustiveness,
                                    num_modes=9,
                                )
                                engine_used = engine_label_with_attempts("pod_gpu", _pb_meta)
                            except PodDockError as pde:
                                # Burst overflow: Pod busy / down → try RunPod
                                # serverless before falling to local CPU. This
                                # is the whole point of having both engines on.
                                if runpod_on:
                                    log.warning("Pod GPU failed for c%s × %s: %s — overflowing to RunPod serverless",
                                                compound.id, variant, pde)
                                    try:
                                        # Pocket-best applies to RunPod serverless
                                        # too — same Vina, same off-pocket failure
                                        # mode. Each retry uses a different seed
                                        # which the worker forwards to vina --seed.
                                        result, _pb_meta = dock_one_with_pocket_best(
                                            dock_one_runpod,
                                            receptor_pdbqt=receptor,
                                            ligand_pdbqt=lig_pdbqt,
                                            box=box,
                                            work_dir=run_dir,
                                            cfg=runpod_cfg,
                                            exhaustiveness=exhaustiveness,
                                            num_modes=9,
                                        )
                                        engine_used = engine_label_with_attempts(
                                            "runpod_after_pod_busy", _pb_meta,
                                        )
                                    except RunPodError as rpe:
                                        log.warning("RunPod also failed for c%s × %s: %s — falling back to local",
                                                    compound.id, variant, rpe)
                                        engine_used = "local_after_pod_and_runpod_fail"
                                else:
                                    log.warning("Pod GPU failed for c%s × %s: %s — falling back to local",
                                                compound.id, variant, pde)
                                    engine_used = "local_after_pod_fail"
                        # RunPod-only path: Pod not configured (or GNINA path
                        # already covered Pod). Pod-busy overflow is handled
                        # inside the `if result is None and pod_on:` branch
                        # above; this branch fires only when there's no Pod
                        # at all so RunPod is the *primary* remote engine.
                        if result is None and runpod_on and not pod_on:
                            try:
                                # Pocket-best wraps RunPod-serverless calls just
                                # like the Pod path above — keeps full-job pose
                                # quality on parity with Quick Dock.
                                result, _pb_meta = dock_one_with_pocket_best(
                                    dock_one_runpod,
                                    receptor_pdbqt=receptor,
                                    ligand_pdbqt=lig_pdbqt,
                                    box=box,
                                    work_dir=run_dir,
                                    cfg=runpod_cfg,
                                    exhaustiveness=exhaustiveness,
                                    num_modes=9,
                                )
                                engine_used = engine_label_with_attempts("runpod", _pb_meta)
                            except RunPodError as rpe:
                                log.warning("RunPod failed for c%s × %s: %s — falling back to local",
                                            compound.id, variant, rpe)
                                engine_used = "local_after_runpod_fail"
                        if result is None:
                            result = dock_one(
                                receptor_pdbqt=receptor,
                                ligand_pdbqt=lig_pdbqt,
                                box=box,
                                work_dir=run_dir,
                                exhaustiveness=exhaustiveness,
                                num_modes=9,
                                vina_path=settings.vina_path,
                            )
                        # If a retry produced the result, note that on the row so
                        # we can spot the pattern in logs later — useful both for
                        # tuning the retry heuristic and for knowing whether the
                        # warm-up stall theory matches reality.
                        if _cell_attempt > 1:
                            engine_used = f"{engine_used}_retry{_cell_attempt - 1}"
                        # Build the `extra` string by combining variant info + validation
                        parts = [variant_extra.get(variant)] if variant_extra.get(variant) else []
                        parts.append(f"engine={engine_used}")

                        # Vinardo rescoring (smina --score_only). Cheap second-pass
                        # score that often discriminates close analogs better than
                        # raw Vina. Failure here is silent — the original Vina
                        # score still ships; we just skip the refined column.
                        try:
                            from deltadock_pipeline.rescore import smina_rescore
                            v_score = smina_rescore(receptor, result.pose_pdbqt, scoring="vinardo")
                            if v_score is not None:
                                parts.append(f"vinardo={v_score:.2f}")
                        except Exception as e:
                            log.info("Vinardo rescore failed for c%s × %s: %s", compound.id, variant, e)

                        if validate_on:
                            try:
                                v = validate_pose(
                                    receptor_pdbqt=receptor,
                                    pose_pdbqt=result.pose_pdbqt,
                                    receptor_pdb=receptor_pdb,
                                    work_dir=run_dir,
                                    # Pass the original SMILES so ProLIF can re-template
                                    # bond orders that obabel's PDBQT round-trip drops.
                                    # This is the difference between "no interactions"
                                    # and a real contact list on aromatic-rich ligands.
                                    ligand_smiles=compound.smiles,
                                )
                                # (U20.4) Compute the canonical-pocket overlap
                                # using the target's catalog entry. Surfaces
                                # poses that landed in an alternate site
                                # (e.g. Adagrasib docked into the nucleotide
                                # pocket of a switch-II-closed KRAS).
                                try:
                                    from deltadock_pipeline.validate import compute_pocket_overlap
                                    _target_for_pocket = _catalog_by_pdb(job.pdb_id)
                                    _canonical = (
                                        _target_for_pocket.canonical_pocket_residues
                                        if _target_for_pocket else []
                                    )
                                    _frac = compute_pocket_overlap(
                                        v.interactions, _canonical,
                                    )
                                    if _frac is not None:
                                        v.pocket_overlap_frac = _frac
                                        v.alt_site = _frac < 0.20
                                except Exception as _pe:  # noqa: BLE001
                                    log.debug("pocket-overlap check skipped: %s", _pe)
                                parts.append(v.to_extra_string())
                            except Exception as ve:
                                log.warning("Validation crashed for c%s × %s: %s", compound.id, variant, ve)
                                parts.append(f"validate_err={str(ve)[:80]}")

                        # Persist the pose via the storage abstraction so the API
                        # endpoint still finds it after the runner's tmpdir is
                        # cleaned. Backend is R2 in prod, local disk otherwise.
                        from .pose_store import get_pose_store
                        try:
                            pose_uri = get_pose_store().write(
                                job.id, compound.id, variant, Path(result.pose_pdbqt)
                            )
                        except Exception as e:
                            log.warning("Could not persist pose for c%s × %s: %s", compound.id, variant, e)
                            pose_uri = str(result.pose_pdbqt)  # fallback to tmp

                        session.add(DockingResult(
                            job_id=job.id, compound_id=compound.id, variant=variant,
                            best_score=result.best_score,
                            pose_uri=pose_uri,
                            extra="|".join(parts) if parts else None,
                        ))
                        # Cache this fresh result for instant repeat docks. The
                        # legacy per-cell path writes its DockingResult inline and
                        # never calls _finalize_cell (where the batched/ensemble
                        # paths store), so the store MUST be invoked here too —
                        # otherwise single-compound jobs (< pod_batch_dock_min_cells,
                        # which is exactly this path) would look up the cache at
                        # line ~2680 but never populate it, so no hit could ever
                        # fire. Flag-gated, fail-open, app-DB only.
                        _dock_cache_store(compound, variant, result,
                                          "|".join(parts) if parts else None, engine_used)
                        _cell_done = True
                    except JobCancelled:
                        # Cancellation isn't a "retry" candidate — bubble out.
                        raise
                    except Exception as e:
                        # If we still have a retry budget AND this doesn't look
                        # like a permanent failure (RDKit/Meeko parse error,
                        # invalid SMILES, etc.), sleep ~30s and try the whole
                        # chain again. Most cell-level failures on Liganx are
                        # transient — pod warm-up stalls, brief 5xx from the
                        # GPU container, network blips — so the silent retry
                        # is what feels right. Permanent errors skip the wait
                        # and surface immediately, same as before this layer
                        # existed.
                        if _cell_attempt < _MAX_DOCK_ATTEMPTS and not _is_permanent_dock_error(e):
                            log.warning(
                                "Transient docking failure for c%s × %s (attempt %s/%s): %s — sleeping %ss + retrying",
                                compound.id, variant, _cell_attempt, _MAX_DOCK_ATTEMPTS,
                                e, DOCK_AUTO_RETRY_DELAY_S,
                            )
                            if _retry_sleep_cancellable(DOCK_AUTO_RETRY_DELAY_S, session, job.id):
                                raise JobCancelled()
                            # Wipe stale per-cell artifacts between attempts so
                            # a half-written .pdbqt or partial log file from
                            # the failed attempt can't confuse the next pass.
                            try:
                                shutil.rmtree(run_dir, ignore_errors=True)
                                run_dir.mkdir(exist_ok=True)
                            except Exception:  # noqa: BLE001
                                pass
                            continue
                        # Final failure: log + write the docking_failed row.
                        log.warning("Docking failed for compound %s × %s (attempt %s/%s): %s",
                                    compound.id, variant, _cell_attempt, _MAX_DOCK_ATTEMPTS, e)
                        session.add(DockingResult(
                            job_id=job.id, compound_id=compound.id, variant=variant,
                            best_score=0.0, extra=f"docking_failed: {e}",
                        ))
                        _cell_done = True
                _commit_retry(session)
        # Common drain for both batched and legacy paths. Runs deferred
        # validation (when DEFER_VALIDATION=1) in a thread pool that
        # updates rows in place; tempdir is still alive so pose files
        # are readable. We mark the job COMPLETED *before* the drain so
        # the user sees scores immediately while validation columns fill
        # in via the frontend's polling.
        if pending_validations:
            session.refresh(job)
            if job.status != JobStatus.CANCELLED:
                job.status = JobStatus.COMPLETED
                job.updated_at = datetime.utcnow()
                session.add(job)
                _commit_retry(session)
                log.info("Job %s docking phase complete; running validation in background", job.id)
        set_stage(session, job.id, "validating_poses" if pending_validations else None)
        _drain_pending_validations(pending_validations, session)
        _drain_pending_interface_extras(pending_interface_extras, session)
        set_stage(session, job.id, None)


def _catalog_by_pdb(pdb_id: str):
    """Find a catalog Target by PDB ID rather than slug."""
    from ..catalog import CATALOG
    for t in CATALOG:
        if t.pdb_id.upper() == pdb_id.upper():
            return t
    return None


# ──────────────────────────────────────────────────────────────────────
# Placeholder fallback (used when real binaries aren't installed)
# ──────────────────────────────────────────────────────────────────────

def _run_placeholder(session: Session, job: Job, reason: str | None) -> None:
    log.info("Placeholder run for job %s (reason: %s)", job.id, reason)
    requested_mutations = [m for m in job.mutations.split(",") if m]
    variants = (["WT"] if job.include_wt else []) + requested_mutations
    if not variants:
        log.warning("Placeholder job %s has no variants — nothing to render", job.id)
        return
    compounds = session.exec(select(Compound).where(Compound.job_id == job.id)).all()

    for compound in compounds:
        for variant in variants:
            score = _placeholder_score(compound.smiles, variant)
            session.add(DockingResult(
                job_id=job.id, compound_id=compound.id, variant=variant,
                best_score=score, extra=f"placeholder ({reason})",
            ))
    _commit_retry(session)


def _placeholder_score(smiles: str, variant: str) -> float:
    seed = (sum(ord(c) for c in smiles) + sum(ord(c) for c in variant)) % 800
    return -(4 + seed / 100.0)
