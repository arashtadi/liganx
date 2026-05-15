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


# How stale a RUNNING/PENDING job's updated_at must be before the reaper
# treats it as dead. The runner's set_stage() bumps updated_at at every
# stage transition (fetching → preparing → docking → validating), so a
# healthy job touches its row well within this window. 20 min (was 5)
# gives generous headroom for slow stages — a cold-start Boltz-2 cell or
# a large ensemble variant — without false-positiving a live job.
_ORPHAN_STALE_MINUTES = 20
# How often the periodic reaper runs (in addition to the once-at-startup
# pass). Catches the "Celery worker died but the API process stayed up"
# case that a startup-only reaper never sees.
_ORPHAN_REAP_INTERVAL_SECONDS = 300


def _reap_orphan_jobs() -> None:
    """Mark RUNNING or PENDING jobs whose updated_at is older than
    _ORPHAN_STALE_MINUTES as FAILED with a clear "interrupted" message.

    Two orphan failure modes this catches:
      - RUNNING orphan: the worker died mid-job (deploy SIGTERM, OOM,
        Pod hiccup) and nothing will ever finish the job.
      - PENDING orphan: the dispatch never fired (BackgroundTask not
        scheduled, Celery enqueue failed silently, job created during a
        half-deployed state).

    The staleness heuristic works because the runner's set_stage() bumps
    updated_at at every stage transition. (Until 2026-05-15 set_stage was
    a no-op stub, so updated_at was only written at job start/end and this
    heuristic was effectively "older than X since the job *started*" —
    set_stage is now live, restoring the intended "since last activity"
    semantics.)

    Runs once at startup AND on a periodic background task (see
    _periodic_orphan_reaper) so a worker that dies while the API process
    stays up doesn't leave a job stuck RUNNING forever. Idempotent.
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
                    "   AND updated_at < now() - make_interval(mins => :stale_mins)"
                    " RETURNING id, status"
                ),
                {"stale_mins": _ORPHAN_STALE_MINUTES},
            )
            rows = [(r[0], r[1]) for r in result]
            session.commit()
            if rows:
                log.warning("Reaped %d orphan job(s): %s", len(rows), rows)
            else:
                log.info("Orphan-job reaper: nothing stale")
    except Exception as e:
        # Never let a reaper failure block startup or crash the periodic
        # task. We'd rather come up with a few stuck jobs than refuse to
        # serve traffic. Surface it loudly so it's visible in Sentry.
        log.exception("Orphan-job reaper failed (non-fatal): %s", e)


async def _periodic_orphan_reaper():
    """Run _reap_orphan_jobs on a fixed interval forever. Registered as an
    asyncio task by lifespan, alongside _runpod_watchdog. This is what
    catches a Celery worker dying mid-job while the API stays up — the
    once-at-startup reap never sees that."""
    import asyncio
    while True:
        await asyncio.sleep(_ORPHAN_REAP_INTERVAL_SECONDS)
        try:
            _reap_orphan_jobs()
        except Exception as e:  # noqa: BLE001 — defence in depth; the
            # inner function already swallows, but never let the loop die.
            log.exception("Periodic orphan reaper iteration failed: %s", e)


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


def _split_sql_statements(sql_text: str) -> list[str]:
    """Split a migration file into individual statements.

    Strips full-line ``--`` comments and the ``BEGIN;`` / ``COMMIT;``
    wrappers (the runner manages the transaction itself), strips inline
    ``-- ...`` comments, then splits on ``;`` — but NEVER inside a
    ``$$``-quoted body, so a ``CREATE FUNCTION ... $$ ... ; ... $$``
    migration isn't shredded into invalid fragments. The old splitter
    naively split on every ``;`` and would have corrupted any future
    PL/pgSQL migration."""
    lines: list[str] = []
    for line in sql_text.splitlines():
        s = line.strip()
        if not s or s.startswith("--"):
            continue
        if s.upper() in ("BEGIN;", "COMMIT;", "BEGIN", "COMMIT"):
            continue
        # Strip an inline comment, but not a ``--`` inside a quoted string.
        idx = line.find("--")
        if idx != -1:
            before = line[:idx]
            if before.count("'") % 2 == 0 and before.count('"') % 2 == 0:
                line = before
        lines.append(line)
    cleaned = "\n".join(lines)

    statements: list[str] = []
    buf: list[str] = []
    in_dollar = False
    i = 0
    while i < len(cleaned):
        if cleaned[i:i + 2] == "$$":
            in_dollar = not in_dollar
            buf.append("$$")
            i += 2
            continue
        ch = cleaned[i]
        if ch == ";" and not in_dollar:
            stmt = "".join(buf).strip()
            if stmt:
                statements.append(stmt)
            buf = []
        else:
            buf.append(ch)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        statements.append(tail)
    return statements


def _apply_startup_migration(sql_filename: str, label: str) -> None:
    """Self-healing, idempotent migration runner — runs on EVERY boot.

    History: this used to be gated behind a per-migration
    ``MIGRATE_<NNN>_ON_STARTUP`` env flag an operator had to remember to
    set. On 2026-05-15 that footgun caused a ~14-minute production
    outage — a migration's column was declared on a SQLModel class but
    the flag was never set, so the column never got created and every
    query on that table 500'd. The gate is GONE. Every migration wired
    into ``lifespan`` now runs unconditionally on boot.

    That is only safe because every wired migration is IDEMPOTENT
    (``CREATE TABLE/INDEX IF NOT EXISTS``, ``ADD COLUMN IF NOT EXISTS``,
    ``ALTER COLUMN ... DROP NOT NULL``) — re-running them is a cheap
    no-op. Do NOT wire a destructive or non-idempotent migration (e.g.
    the early ``001`` with its ``TRUNCATE``) into this path.

    Contract:
      * Atomic per file — every statement runs inside ONE transaction;
        any failure rolls the whole file back (no half-applied schema).
      * FAILS LOUD — on any error this re-raises, so ``lifespan`` aborts,
        uvicorn never comes up, and the Fly deploy fails / rolls back.
        A failed migration must fail the DEPLOY, never boot a broken app.
    """
    from pathlib import Path

    sql_path = Path("/app/backend/migrations") / sql_filename
    if not sql_path.exists():
        sql_path = (
            Path(__file__).resolve().parent.parent.parent / "migrations" / sql_filename
        )
    if not sql_path.exists():
        # A wired migration whose file isn't in the image is a broken
        # deploy, not something to shrug off with a log line.
        raise RuntimeError(
            f"{label}: migration file not found at {sql_path} — "
            f"is backend/migrations/ COPY'd into the Docker image?"
        )

    statements = _split_sql_statements(sql_path.read_text())
    if not statements:
        log.warning("%s: no statements found in %s", label, sql_filename)
        return

    from .db import engine as db_engine
    try:
        with db_engine.connect() as conn:
            raw = conn.connection.dbapi_connection
            cur = raw.cursor()
            try:
                for i, stmt in enumerate(statements, 1):
                    cur.execute(stmt)
                    log.info("%s: statement %d/%d ok (%s…)",
                             label, i, len(statements),
                             stmt[:60].replace("\n", " "))
                # Commit only after ALL statements succeeded — atomic.
                # Commit on the raw psycopg2 connection (SQLAlchemy 2.x's
                # wrapper commit doesn't finalize raw-cursor DDL).
                raw.commit()
            except Exception:
                # Roll the whole file back — never leave a half-applied
                # schema — then re-raise to fail the boot.
                try:
                    raw.rollback()
                except Exception:
                    pass
                raise
            finally:
                cur.close()
        # Prove the changes are visible from a fresh connection.
        with db_engine.connect() as verify_conn:
            verify_conn.connection.dbapi_connection.cursor().execute("SELECT 1")
        log.info("%s applied (%d statements, idempotent, committed)",
                 label, len(statements))
    except Exception as e:
        # FAIL LOUD. lifespan does NOT catch this — uvicorn fails to
        # start, the Fly machine never goes healthy, the deploy fails,
        # and the previous (working) release stays live. A failed deploy
        # is a safe outcome; booting a broken app is not.
        log.critical("%s FAILED at startup — aborting boot: %s", label, e)
        raise


def _verify_schema_matches_models() -> None:
    """Fail-loud guard against ORM↔DB schema drift.

    After migrations run, introspect every SQLModel ``table=True`` class
    and assert every column it declares actually exists in the live
    database. If a model declares a column that no migration created,
    this raises — aborting boot and failing the deploy — instead of
    letting the app come up and 500 on the first query against that
    table. This is the runtime backstop for the exact bug class that
    caused the 2026-05-15 outage; ``backend/scripts/check_schema_migrations.py``
    catches the same drift earlier (at CI time).

    No-op on SQLite (local dev): there's no ``information_schema`` there,
    and ``create_all`` builds the full current schema from the models on
    every dev boot anyway, so drift is structurally impossible in dev.
    """
    from sqlmodel import SQLModel
    from sqlalchemy import text
    from .db import engine as db_engine
    from . import models  # noqa: F401  — register tables on the metadata

    if db_engine.dialect.name == "sqlite":
        log.info("Schema-drift check skipped (SQLite dev DB)")
        return

    missing: list[str] = []
    with db_engine.connect() as conn:
        for table_name, table in SQLModel.metadata.tables.items():
            rows = conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = :t AND table_schema = 'public'"
                ),
                {"t": table_name},
            ).fetchall()
            db_cols = {r[0] for r in rows}
            if not db_cols:
                missing.append(f"{table_name} (entire table absent)")
                continue
            for col in table.columns:
                if col.name not in db_cols:
                    missing.append(f"{table_name}.{col.name}")
    if missing:
        raise RuntimeError(
            "ORM↔DB schema drift detected — these model columns/tables are "
            "missing from the database (a migration didn't run): "
            + ", ".join(sorted(missing))
            + ". Boot aborted to fail the deploy rather than serve 500s."
        )
    log.info("Schema-drift check passed — all %d model tables match the DB",
             len(SQLModel.metadata.tables))


# ── Startup migrations ────────────────────────────────────────────────
# Every migration listed here runs UNCONDITIONALLY on each boot (no env
# flag). That is safe ONLY because each is idempotent. If you add a new
# migration: (1) make it idempotent, (2) add an entry below, (3) keep
# backend/scripts/check_schema_migrations.py green. Migrations 001-010 are
# deliberately NOT here — they were hand-applied historically and 001 has
# a destructive TRUNCATE; the runtime _verify_schema_matches_models() guard
# covers their columns instead.
_STARTUP_MIGRATIONS: list[tuple[str, str]] = [
    ("004_job_stage.sql", "Migration 004 (job.stage)"),
    ("011_screening_selectivity.sql", "Migration 011 (screening selectivity)"),
    ("012_user_job_ai_chat.sql", "Migration 012 (ai chat history)"),
    ("013_compound_job_id_nullable.sql", "Migration 013 (compound.job_id nullable)"),
    ("014_is_pro.sql", "Migration 014 (is_pro flag)"),
    ("015_job_ensemble.sql", "Migration 015 (job.ensemble flag)"),
    ("016_ensemble_access.sql", "Migration 016 (ensemble access flag)"),
]


def _run_startup_migrations() -> None:
    """Apply every wired migration, in order, on boot. Each is idempotent;
    each fails loud (see _apply_startup_migration), so a broken migration
    fails the deploy rather than booting a half-migrated app.

    No-op on SQLite (local dev): the migration files are Postgres DDL
    (``make_interval``, ``UUID``, ``JSONB``, ``TEXT[]``, ``ADD COLUMN IF
    NOT EXISTS`` …) and would fail against SQLite. In dev, ``create_all``
    builds the full current schema from the models, so migrations aren't
    needed there."""
    from .db import engine as db_engine
    if db_engine.dialect.name == "sqlite":
        log.info("Startup migrations skipped (SQLite dev DB — create_all builds the schema)")
        return
    for sql_filename, label in _STARTUP_MIGRATIONS:
        _apply_startup_migration(sql_filename=sql_filename, label=label)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    import asyncio
    log.info("Starting DeltaDock backend %s in %s mode", __version__, settings.app_env)
    init_db()
    # Migrations run UNCONDITIONALLY and FAIL LOUD — if any raises, it
    # propagates out of lifespan, uvicorn never comes up, and the Fly
    # deploy fails (the previous good release stays live). That is the
    # correct, safe outcome: a failed deploy beats a booted-broken app.
    _run_startup_migrations()
    # After migrations, assert the ORM matches the DB. Catches the exact
    # drift class (model column with no applied migration) before we
    # serve a single request. Also fails loud.
    _verify_schema_matches_models()
    _reap_orphan_jobs()
    watchdog_task = asyncio.create_task(_runpod_watchdog())
    reaper_task = asyncio.create_task(_periodic_orphan_reaper())
    try:
        yield
    finally:
        for task in (watchdog_task, reaper_task):
            task.cancel()
        for task in (watchdog_task, reaper_task):
            try:
                await task
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
