"""FastAPI application entrypoint."""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import get_settings
from .db import init_db
from .routers import admin, ask, assist, atlas, calibrate, catalog, contact, jobs, library, lookup, me, me_compounds, screening, sentry_webhook, structures, suggest

# Git SHA of the deployed image — injected by the GH Actions workflow as a
# build arg / env var. Lets us verify which commit is actually live without
# having to read Fly logs. Defaults to "dev" for local runs.
GIT_SHA = os.environ.get("GIT_SHA", "dev")

settings = get_settings()
logging.basicConfig(level=settings.log_level.upper())
log = logging.getLogger("deltadock")

# Sentry — opt-in via SENTRY_DSN env var. No-op when unset so local dev
# stays untouched. Wrapped in try/except so a missing sentry_sdk doesn't
# break startup. Documented in the May 2026 platform audit (#256).
_sentry_dsn = os.environ.get("SENTRY_DSN", "").strip()
if _sentry_dsn:
    try:
        import sentry_sdk  # type: ignore
        from sentry_sdk.integrations.fastapi import FastApiIntegration  # type: ignore
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration  # type: ignore
        sentry_sdk.init(
            dsn=_sentry_dsn,
            environment=settings.app_env,
            release=GIT_SHA,
            traces_sample_rate=0.1,  # conservative — 10% of requests traced
            send_default_pii=False,   # never auto-send PII; surface explicitly when needed
            integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        )
        log.info("Sentry initialised (env=%s, release=%s)", settings.app_env, GIT_SHA)
    except Exception as e:  # noqa: BLE001
        log.warning("Sentry init failed (non-fatal): %s", e)


def _reap_orphan_jobs() -> None:
    """Mark any RUNNING or PENDING jobs whose updated_at is older than
    5 minutes as FAILED with a clear "interrupted by deploy" message.

    Why we need this: jobs are dispatched as FastAPI BackgroundTasks
    or Celery tasks. Two failure modes that leave orphans:
      - RUNNING orphan: the worker died mid-job (deploy SIGTERM, OOM,
        Pod hiccup). Pre-Celery this was the common case.
      - PENDING orphan: the dispatch never fired at all (BackgroundTask
        wasn't scheduled, Celery enqueue failed silently, or the job
        was created during a half-deployed state). Found one of these
        in QA — job had been PENDING for 1.5 days from before Celery
        deploy.

    Both are caught here. The "5 minutes since last touch" heuristic
    works because the runner bumps updated_at at every stage transition
    (fetching → preparing → docking → validating → completed). A real
    running job touches the row every 30-60s; anything stale > 5 min
    is almost certainly dead. False positives (a genuinely slow stage
    like a cold-start Boltz-2) get re-tried by the user, which is
    acceptable given how rarely deploys land mid-stage.

    With Celery + Redis (#168) shipped, this is now a belt-and-braces
    safety net rather than the primary deploy-survival mechanism, but
    still catches the rarer "Celery worker had a bad day" case.
    Idempotent — safe to run on every startup.
    """
    try:
        from sqlmodel import Session
        from sqlalchemy import text
        from .db import engine
        with Session(engine) as session:
            result = session.execute(
                text(
                    "UPDATE job"
                    " SET status = 'FAILED',"
                    "     error_message = COALESCE(error_message,"
                    "         'Interrupted by a backend restart — the docking worker"
                    " was killed before this job could finish. Please re-submit.'),"
                    "     updated_at = now()"
                    " WHERE status IN ('RUNNING', 'PENDING')"
                    "   AND updated_at < now() - INTERVAL '5 minutes'"
                    " RETURNING id, status"
                ),
            )
            rows = [(r[0], r[1]) for r in result]
            session.commit()
            if rows:
                log.warning(
                    "Reaped %d orphan jobs at startup: %s",
                    len(rows),
                    rows,
                )
            else:
                log.info("No orphan jobs to reap at startup")
    except Exception as e:
        # Never let a reaper failure block startup. We'd rather come up
        # with a few stuck jobs than refuse to serve traffic.
        log.exception("Orphan-job reaper failed at startup (non-fatal): %s", e)


async def _runpod_watchdog():
    """Cost-control watchdog. Polls services.pod_activity every minute;
    if no docking traffic for runpod_idle_minutes AND the pod is
    currently RUNNING, calls runpod_client.stop_pod() to drop the GPU
    bill. Runs forever as an asyncio task; recovers silently from any
    transient RunPod API blip.

    Conservative: requires at least one bump_pod_activity() call AFTER
    startup before considering the pod idle. Prevents auto-stopping
    immediately after a redeploy when last_activity is None.
    """
    import asyncio
    from .services.pod_activity import seconds_since_last_activity
    from .services import runpod_client

    if not runpod_client.is_configured():
        log.info("RunPod watchdog: not configured — skipping")
        return
    # 2026-05-12: watchdog default-disabled. Set Fly secret
    # RUNPOD_WATCHDOG_ENABLED=true to turn back on. See config.py for why.
    if not settings.runpod_watchdog_enabled:
        log.info("RunPod watchdog: disabled via RUNPOD_WATCHDOG_ENABLED=false — skipping")
        return
    threshold = settings.runpod_idle_minutes * 60
    max_uptime = settings.runpod_max_uptime_minutes * 60
    # Track when this watchdog last observed the pod transition into RUNNING
    # so we can enforce the max-uptime ceiling. None ⇒ unknown (we'll set
    # it the first time we see status=RUNNING).
    pod_running_since: float | None = None
    log.info(
        "RunPod watchdog: idle-stop after %d min of no traffic, "
        "hard ceiling at %d min uptime regardless",
        settings.runpod_idle_minutes, settings.runpod_max_uptime_minutes,
    )
    while True:
        try:
            await asyncio.sleep(60)
            elapsed = seconds_since_last_activity()
            now = __import__("time").time()

            # Always check status — we need it for both the idle and
            # uptime-ceiling checks.
            try:
                status = await runpod_client.get_pod_status()
            except Exception as e:  # noqa: BLE001
                log.warning("RunPod watchdog: status check failed: %s", e)
                continue
            is_running = (status.get("desiredStatus") or "").upper() == "RUNNING"
            if is_running and pod_running_since is None:
                pod_running_since = now
            if not is_running:
                pod_running_since = None  # reset when not running

            # Uptime ceiling: stop unconditionally if pod has been up too
            # long, regardless of recent traffic. Activity-based watchdog
            # alone can loop forever if requests keep trickling in.
            if is_running and pod_running_since is not None:
                uptime = now - pod_running_since
                if uptime >= max_uptime:
                    log.warning(
                        "RunPod watchdog: pod uptime %ds (>%ds) — stopping "
                        "for budget protection (next submission will auto-resume)",
                        int(uptime), max_uptime,
                    )
                    try:
                        await runpod_client.stop_pod()
                        pod_running_since = None
                    except Exception as e:  # noqa: BLE001
                        log.warning("RunPod watchdog: ceiling-stop failed: %s", e)
                    continue

            # Activity-based: stop if idle for `threshold` seconds.
            if elapsed is None or elapsed < threshold:
                continue
            if not is_running:
                continue
            log.info(
                "RunPod watchdog: pod idle %ds (>%ds) — stopping",
                int(elapsed), threshold,
            )
            try:
                await runpod_client.stop_pod()
                pod_running_since = None
            except Exception as e:  # noqa: BLE001
                log.warning("RunPod watchdog: stop failed: %s", e)
        except asyncio.CancelledError:
            log.info("RunPod watchdog: cancelled")
            return
        except Exception as e:  # noqa: BLE001
            log.warning("RunPod watchdog: unexpected: %s", e)


def _apply_startup_migration(env_flag: str, sql_filename: str, label: str) -> None:
    """Idempotent self-healing migration runner.

    Generalised from the #208 version: gated by an env flag so we don't
    auto-run migrations on every deploy long-term, but provides a way
    to apply schema changes without needing flyctl SSH (which had a
    sustained outage on 2026-05-11). Drop the env flag on the deploy
    AFTER the migration has applied once.

    Earlier versions of this helper ran the whole multi-statement SQL
    in a single `cur.execute()` call. That works for run_migration_010
    but turned out to fail silently on migration 012 — the CREATE TABLE
    statement never ran (table absent post-boot) yet no exception fired
    and the "applied" log was printed. The fix is to split on `;` and
    execute each statement individually so any single-statement failure
    raises and surfaces in the log.
    """
    import os
    if os.environ.get(env_flag, "").lower() not in ("1", "true", "yes"):
        return
    from pathlib import Path
    sql_path = Path("/app/backend/migrations") / sql_filename
    if not sql_path.exists():
        sql_path = (
            Path(__file__).resolve().parent.parent.parent / "migrations" / sql_filename
        )
    if not sql_path.exists():
        log.warning("%s set but SQL file not found at %s", env_flag, sql_path)
        return
    sql_text = sql_path.read_text()

    # Strip line-comments + the BEGIN/COMMIT wrappers, then split into
    # individual statements. Splitting on `;` is naive but adequate for
    # our migrations (no triggers, no function bodies). Empty fragments
    # are dropped.
    cleaned_lines: list[str] = []
    for line in sql_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        if stripped in ("BEGIN;", "COMMIT;"):
            continue
        cleaned_lines.append(line)
    cleaned = "\n".join(cleaned_lines)
    statements = [s.strip() for s in cleaned.split(";") if s.strip()]

    try:
        from .db import engine as db_engine
        with db_engine.connect() as conn:
            raw = conn.connection.dbapi_connection
            cur = raw.cursor()
            try:
                for i, stmt in enumerate(statements, 1):
                    cur.execute(stmt)
                    log.info("%s: statement %d/%d ok (%s…)",
                             label, i, len(statements), stmt[:60].replace("\n", " "))
            finally:
                cur.close()
            # CRITICAL: commit on the raw psycopg2 connection, NOT the
            # SQLAlchemy wrapper. In SQLAlchemy 2.x the wrapper's commit
            # only finalizes SQLAlchemy-tracked statements; raw cursor
            # operations run in their own psycopg2 transaction that
            # rolls back when the SQLAlchemy connection is returned to
            # the pool. We hit this exact failure mode on migration 012
            # — the per-statement log said "ok" but the table never
            # existed post-boot because the DDL was never actually
            # committed to disk.
            raw.commit()
            conn.commit()
        # Post-migration sanity: re-issue a trivial query on a fresh
        # connection to prove the changes are visible from outside this
        # transaction. If we get an exception here, the migration
        # didn't commit and the hook log will surface it.
        with db_engine.connect() as verify_conn:
            verify_conn.connection.dbapi_connection.cursor().execute("SELECT 1")
        log.info("%s applied (%d statements, idempotent, committed)", label, len(statements))
    except Exception as e:
        log.error("%s FAILED at startup: %s", label, e)


def _ensure_screening_columns() -> None:
    """#208 — wt_score / delta_score / selectivity_index / extra on screening_result."""
    _apply_startup_migration(
        env_flag="MIGRATE_011_ON_STARTUP",
        sql_filename="011_screening_selectivity.sql",
        label="Migration 011 (screening selectivity)",
    )


def _ensure_chat_history_table() -> None:
    """#224 — user_job_ai_chat (per-user-per-job Liganx AI Beta conversation history)."""
    _apply_startup_migration(
        env_flag="MIGRATE_012_ON_STARTUP",
        sql_filename="012_user_job_ai_chat.sql",
        label="Migration 012 (ai chat history)",
    )


def _ensure_compound_job_id_nullable() -> None:
    """v1.16.1 — DROP NOT NULL on compound.job_id so screening
    submissions (which create orphan Compound rows with no parent Job)
    don't crash with NotNullViolation."""
    _apply_startup_migration(
        env_flag="MIGRATE_013_ON_STARTUP",
        sql_filename="013_compound_job_id_nullable.sql",
        label="Migration 013 (compound.job_id nullable)",
    )


def _ensure_is_pro_column() -> None:
    """v1.24 — Pro tier flag on user_profile. Gates GNINA + Virtual
    Screening; admin toggles via PATCH /admin/users/{id}/pro."""
    _apply_startup_migration(
        env_flag="MIGRATE_014_ON_STARTUP",
        sql_filename="014_is_pro.sql",
        label="Migration 014 (is_pro flag)",
    )


def _ensure_job_ensemble_column() -> None:
    """Ensemble docking — `ensemble` flag on the job table. When set, the
    runner docks each ligand against an MD-relaxed receptor conformer
    ensemble instead of a single rigid snapshot. Default FALSE so legacy
    rows + non-opted-in jobs are unchanged.

    MUST run before any Job query (the SQLModel Job class now declares the
    `ensemble` field, so a SELECT against a pre-migration table would
    error). lifespan() calls this right after init_db() and before
    _reap_orphan_jobs(), so the ordering holds."""
    _apply_startup_migration(
        env_flag="MIGRATE_015_ON_STARTUP",
        sql_filename="015_job_ensemble.sql",
        label="Migration 015 (job.ensemble flag)",
    )


def _ensure_ensemble_access_column() -> None:
    """Ensemble docking — per-user `ensemble_enabled` access flag on
    user_profile. Ungated by default (column DEFAULTs TRUE); admin can
    revoke per-user via PATCH /admin/users/{id}/ensemble. Reusable for
    the planned MM-GBSA / FEP-lite phase-2 feature."""
    _apply_startup_migration(
        env_flag="MIGRATE_016_ON_STARTUP",
        sql_filename="016_ensemble_access.sql",
        label="Migration 016 (ensemble access flag)",
    )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    import asyncio
    log.info("Starting DeltaDock backend %s in %s mode", __version__, settings.app_env)
    init_db()
    _ensure_screening_columns()
    _ensure_chat_history_table()
    _ensure_compound_job_id_nullable()
    _ensure_is_pro_column()
    _ensure_job_ensemble_column()
    _ensure_ensemble_access_column()
    _reap_orphan_jobs()
    watchdog_task = asyncio.create_task(_runpod_watchdog())
    try:
        yield
    finally:
        watchdog_task.cancel()
        try:
            await watchdog_task
        except (asyncio.CancelledError, Exception):
            pass
        log.info("Shutting down DeltaDock backend")


app = FastAPI(
    title="Liganx API",
    version=__version__,
    description="Mutation-aware structural-biology platform",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs.router)
app.include_router(screening.router)
app.include_router(catalog.router)
app.include_router(structures.router)
app.include_router(lookup.router)
app.include_router(suggest.router)
app.include_router(me.router)
app.include_router(me_compounds.router)
app.include_router(contact.router)
app.include_router(admin.router)
app.include_router(assist.router)
app.include_router(ask.router)  # Liganx AI Beta — Q&A over a job's results page
app.include_router(library.router)  # v1.23 — pre-computed library screenings (public)
app.include_router(atlas.router)  # Resistance Atlas — per-drug forecast landing pages (public)
app.include_router(calibrate.router)  # Pro feature: score user's own (drug, mutation) data against Liganx model
app.include_router(sentry_webhook.router)  # Sentry alerts → Telegram bridge (/internal/sentry-webhook)


@app.get("/health", tags=["meta"])
def health() -> dict:
    """Liveness probe — must NEVER block.

    HISTORY: An earlier version of this endpoint did a synchronous
    `engine.connect() + SELECT 1` to surface DB unreachability as 503.
    Under sustained traffic the SQLAlchemy connection pool can exhaust,
    and `engine.connect()` then blocks on `pool_timeout` (default 30 s)
    waiting for a connection to free up. With Fly health checks polling
    every few seconds, that turned the readiness probe into a thundering-
    herd amplifier — every probe queued behind the previous one and the
    whole worker stalled. Production went dark on 2026-05-12 from this
    exact pathology.

    Keep this endpoint trivially fast and dependency-free. The DB
    reachability check lives at /health/db with a hard timeout so a
    wedged DB can't take the liveness signal with it.
    """
    return {
        "status": "ok",
        "version": __version__,
        "env": settings.app_env,
        "git_sha": GIT_SHA,
    }


@app.get("/health/db", tags=["meta"])
def health_db() -> dict:
    """Optional DB-reachability probe. Uses a short connect_timeout via
    a one-off psycopg2 connection (bypassing the SQLAlchemy pool) so a
    wedged pool can't hang this endpoint either. Returns 503 on failure
    so monitoring can alert without affecting Fly's liveness routing.
    """
    from fastapi import HTTPException
    import os
    import time

    started = time.time()
    db_url = settings.effective_database_url
    if db_url.startswith("sqlite"):
        return {"status": "ok", "db": "sqlite (dev)", "elapsed_ms": 0}

    try:
        import psycopg2  # type: ignore
        # 2-second connect_timeout — fast enough to never hang the probe.
        conn = psycopg2.connect(db_url, connect_timeout=2)
        try:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            cur.fetchone()
            cur.close()
        finally:
            conn.close()
        elapsed_ms = int((time.time() - started) * 1000)
        return {"status": "ok", "db": "postgres", "elapsed_ms": elapsed_ms}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=503,
            detail={
                "status": "db_unreachable",
                "error_type": type(e).__name__,
                "error": str(e)[:200],
                "elapsed_ms": int((time.time() - started) * 1000),
            },
        )


@app.get("/health/full", tags=["meta"])
async def health_full() -> dict:
    """Full infrastructure health probe. Checks pod connectivity and essential config.
    Used by monitoring/smoke tests to verify the entire stack is operational."""
    import httpx

    pod_dock_status = "not_configured"
    pod_dock_url_val = settings.pod_dock_url

    if pod_dock_url_val:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{pod_dock_url_val}/health")
                pod_dock_status = "ok" if resp.status_code == 200 else f"http_{resp.status_code}"
        except Exception as e:
            pod_dock_status = "down"

    # Boltz-2 pod URL (may be same as pod_dock_url or separate)
    boltz2_pod_url_val = settings.boltz2_pod_url or settings.pod_dock_url
    boltz2_status = "not_configured"

    if boltz2_pod_url_val and settings.boltz2_enabled:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{boltz2_pod_url_val}/health")
                boltz2_status = "ok" if resp.status_code == 200 else f"http_{resp.status_code}"
        except Exception as e:
            boltz2_status = "down"

    return {
        "ok": True,
        "git_sha": GIT_SHA,
        "pod_dock_url": pod_dock_url_val or "not_set",
        "pod_dock_status": pod_dock_status,
        "runpod_api_key": "configured" if settings.runpod_api_key else "missing",
        "boltz2_enabled": settings.boltz2_enabled,
        "boltz2_status": boltz2_status,
    }
