"""FastAPI application entrypoint."""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import get_settings
from .db import init_db
from .routers import admin, ask, assist, atlas, calibrate, catalog, contact, fep, jobs, library, lookup, me, me_compounds, screening, selective, sentry_webhook, structures, suggest, telegram_webhook

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
# (U15) Operator kill switch — flip `fly secrets set SENTRY_DISABLED=1`
# to mute ALL Sentry events instantly without a code redeploy. Use when
# Sentry is firing a webhook storm we can't suppress fast enough through
# before_send filters (e.g. a brand-new exception path that bypassed the
# U5c / U14 patterns). Empty / unset = Sentry runs normally. Costs one
# `fly secrets set` + ~30 s for the machines to pick up the new env.
_sentry_disabled = os.environ.get("SENTRY_DISABLED", "").strip() in ("1", "true", "yes")
if _sentry_disabled:
    log.warning("SENTRY_DISABLED=1 — skipping Sentry init (operator kill switch)")
if _sentry_dsn and not _sentry_disabled:
    try:
        import sentry_sdk  # type: ignore
        from sentry_sdk.integrations.fastapi import FastApiIntegration  # type: ignore
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration  # type: ignore
        # (U5c) Filter watchdog-internal exceptions out of Sentry.
        # Watchdog probes routinely surface state that we ALREADY
        # report via /admin/watchdog/status (e.g. a check throwing
        # because Postgres lost a column); we don't need each one
        # to also fire a Sentry issue + Telegram webhook. Drop any
        # event whose logger is the watchdog or that originates
        # inside services/watchdog.py.
        #
        # (U14) Extended to suppress the "every Fly redeploy fires a
        # Sentry storm" pattern. Mid-deploy SIGTERM kills the docking
        # runner, every in-flight DB query / pod HTTP fails, and each
        # cascading exception fires its own webhook → user sees 14+
        # Telegram pings in 90s. Drop these expected-during-shutdown
        # exception classes; the M18 reaper already classifies the
        # orphaned job correctly ("Interrupted by a backend restart").
        #
        # Suppression list — ALL of these are routine, not pages:
        #   - JobCancelled                       → user clicked Cancel
        #   - asyncio.CancelledError             → graceful shutdown
        #   - InFailedSqlTransactionError +
        #     "current transaction is aborted"   → session poisoning
        #                                          cascade — original
        #                                          error is already
        #                                          captured upstream
        _SUPPRESS_EXC_TYPES = {
            "JobCancelled",
            "CancelledError",
            "InFailedSqlTransactionError",
            "InFailedSqlTransaction",
        }
        _SUPPRESS_MSG_FRAGMENTS = (
            "current transaction is aborted",
            "Cancelled by user",
            # Pod HTTP transient — pod redeploys / network hiccups
            # surface here but the M18 reaper + N9 cancel path
            # already handle them.
            "Connection aborted",
            "Read timed out",
        )

        def _drop_watchdog(event, hint):
            try:
                if event.get("logger") == "deltadock.services.watchdog":
                    return None
                # Also catch exceptions raised from within the watchdog
                # module — they may not carry the logger field.
                exc_values = (event.get("exception", {}) or {}).get("values", [])
                for v in exc_values:
                    # (U14) Suppress by exception type — these are the
                    # routine "Fly redeployed mid-job" cascade.
                    if v.get("type") in _SUPPRESS_EXC_TYPES:
                        return None
                    msg = v.get("value") or ""
                    if any(frag in msg for frag in _SUPPRESS_MSG_FRAGMENTS):
                        return None
                    for f in (v.get("stacktrace", {}) or {}).get("frames", []):
                        if "services/watchdog.py" in (f.get("abs_path") or ""):
                            return None
            except Exception:                                            # noqa: BLE001
                pass
            return event

        sentry_sdk.init(
            dsn=_sentry_dsn,
            environment=settings.app_env,
            release=GIT_SHA,
            traces_sample_rate=0.1,  # conservative — 10% of requests traced
            send_default_pii=False,   # never auto-send PII; surface explicitly when needed
            integrations=[FastApiIntegration(), SqlalchemyIntegration()],
            before_send=_drop_watchdog,
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
            # NOTE: as of U18 the jobstatus PG enum holds lowercase
            # values ('pending', 'running', 'failed', ...). Pre-U18
            # this SQL used uppercase literals and fired
            # `InvalidTextRepresentation: invalid input value for enum
            # jobstatus: "RUNNING"` on every boot. Cast through ::text
            # so the SQL works regardless of whether the enum on this
            # particular env is fully migrated or still has stragglers
            # from old uppercase rows.
            result = session.execute(
                text(
                    "UPDATE job"
                    " SET status = 'failed',"
                    "     error_message = COALESCE(error_message,"
                    "         'Interrupted by a backend restart — the docking worker"
                    " was killed before this job could finish. Please re-submit.'),"
                    "     updated_at = now()"
                    " WHERE status::text IN ('running', 'pending')"
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


def _bump_inflight_fep_timestamps() -> None:
    """(N4.0a) Reset updated_at on every in-flight FEP study at boot.

    WHY: FEP #19 (twrk8Zul9B4 follow-up) failed because the daemon-thread
    runner was killed mid-edge by a Fly redeploy, the pod kept running
    the edge with no backend listener, updated_at stopped ticking, and
    ~90 minutes later the orphan reaper killed the row with "Interrupted
    by a backend restart." The pod's edge had completed by then; the
    result was simply orphaned.

    FIX: At startup, before the reaper runs, bump updated_at on every
    study still in PENDING/PREPARING/RUNNING. This buys the study a
    fresh 90-minute window starting from "now we know about it" rather
    than "the moment before the old daemon thread died". The follow-up
    fix (N4.0c, deferred) is to also re-attach a polling-only daemon
    to in-flight pod jobs so we don't just sit and watch the clock.

    Idempotent + cheap: a single UPDATE statement, no per-row work.
    Safe to call repeatedly. The reaper still fires on genuinely
    stale rows (those whose pod job actually died), just not on the
    just-redeployed ones."""
    try:
        from sqlmodel import Session
        from sqlalchemy import text
        from .db import engine
        with Session(engine) as session:
            result = session.execute(
                text(
                    "UPDATE fep_job"
                    " SET updated_at = now()"
                    " WHERE status IN ('PENDING', 'PREPARING', 'RUNNING')"
                    " RETURNING id, share_id"
                ),
            )
            rows = [(r[0], r[1]) for r in result]
            session.commit()
            if rows:
                log.warning(
                    "(N4.0a) Bumped updated_at on %d in-flight FEP study/studies "
                    "post-restart: %s", len(rows), rows
                )
            else:
                log.info("(N4.0a) No in-flight FEP studies need a timestamp bump")
    except Exception as e:                                            # noqa: BLE001
        log.exception("In-flight FEP timestamp bump failed (non-fatal): %s", e)


def _reap_orphan_fep_studies() -> None:
    """(I1) FEP+ counterpart of _reap_orphan_jobs.

    Marks FepJobs stuck in PENDING/PREPARING/RUNNING with stale
    updated_at as FAILED. Catches the failure mode where the runner's
    daemon-thread fallback died mid-study (Fly machine restart,
    SIGTERM, OOM) and the DB row stays RUNNING forever with no progress.

    (N4.0b + N5.2b + N6.2) Two-tier staleness threshold:
      • Pre-dispatch (no edge has stage OR pod_job_id set) → 90 min.
        These are studies whose runner died before any edge made it
        to the pod; nothing real-physics is happening, reap quickly
        so the user gets clear feedback.
      • Mid-dispatch (any edge has non-null stage OR pod_job_id)
        → 14 hours. Matches the dispatch_edge timeout_s default of
        14h, which is the wall-clock cap for a single OpenCL edge.
        Below this we'd kill legitimately-running edges; above we'd
        strand a genuinely-dead pod for too long. FEP #20 died at
        the previous 6h cap even though N6.1 heartbeat-on-every-poll
        keeps updated_at fresh — better to be generous here and let
        the in-edge timeout govern the upper bound.

    (N5.2b) Original N4.0b used `pod_job_id IS NOT NULL` as the
    dispatch signal. FEP #19 surfaced a secondary bug where the
    pod_job_id column stays NULL even though edges DO dispatch and
    the runner's polling callback updates `stage` + `progress_pct`
    fine. Adding `stage IS NOT NULL` to the OR keeps the reaper
    resilient to that bug — the dispatch signal is "ANY edge has
    any progress field set", not specifically pod_job_id.

    The error_message tells the user exactly what happened and what
    to do: 'restart, please resubmit'. Idempotent — re-running it is
    a no-op on already-FAILED rows."""
    try:
        from sqlmodel import Session
        from sqlalchemy import text
        from .db import engine
        with Session(engine) as session:
            # Postgres ENUM type fepjobstatus uses ENUM MEMBER NAMES
            # (uppercase) as valid values — Python's FepJobStatus.PENDING
            # FepJob.status mapping is by enum NAME (uppercase) — the
            # Field declaration on FepJob doesn't pass values_callable,
            # so SQLAlchemy's default Enum mapping kicks in and writes
            # the member name, not the .value. So the DB literal IS
            # 'RUNNING' / 'PENDING' / etc. — NOT lowercase. Unlike
            # Job.status which was migrated to lowercase in U18.
            # (Confirmed via DB-dependent CI tests after U22.)
            #
            # (N4.0b + N5.2b) The OR clause splits stale rows into two
            # cohorts: rows WITH any in-flight signal (non-null stage
            # OR non-null pod_job_id) get a 14-hour threshold; rows
            # WITHOUT any keep the original 90-minute one. Using
            # (stage OR pod_job_id) instead of just pod_job_id
            # works around the FEP #19 bug where pod_job_id stays
            # null even though stage is set.
            result = session.execute(
                text(
                    "UPDATE fep_job j"
                    " SET status = 'FAILED',"
                    "     error_message = COALESCE(error_message,"
                    "         'Interrupted by a backend restart — the FEP runner"
                    " was killed before this study could finish. Please re-submit"
                    " from /fep/new.'),"
                    "     updated_at = now()"
                    " WHERE status IN ('PENDING', 'PREPARING', 'RUNNING')"
                    "   AND ("
                    "     ("                 # pre-dispatch: 90 min threshold
                    "       NOT EXISTS (SELECT 1 FROM fep_perturbation p"
                    "         WHERE p.fep_job_id = j.id"
                    "           AND (p.pod_job_id IS NOT NULL OR p.stage IS NOT NULL))"
                    "       AND updated_at < now() - make_interval(mins => 90)"
                    "     )"
                    "     OR"
                    "     ("                 # mid-dispatch: 14 h threshold (N6.2)
                    "       EXISTS (SELECT 1 FROM fep_perturbation p"
                    "         WHERE p.fep_job_id = j.id"
                    "           AND (p.pod_job_id IS NOT NULL OR p.stage IS NOT NULL))"
                    "       AND updated_at < now() - make_interval(hours => 14)"
                    "     )"
                    "   )"
                    " RETURNING id, share_id, status"
                ),
            )
            rows = [(r[0], r[1], r[2]) for r in result]
            session.commit()
            if rows:
                log.warning("Reaped %d orphan FEP study/studies: %s", len(rows), rows)
            else:
                log.info("Orphan FEP-study reaper: nothing stale")
    except Exception as e:                                            # noqa: BLE001
        log.exception("Orphan FEP-study reaper failed (non-fatal): %s", e)


def _resume_recent_fep_studies() -> None:
    """(M18) Re-dispatch FEP studies that were RECENT enough to still
    be salvageable when the backend restarted mid-run.

    Two complementary failure modes:
      • _reap_orphan_fep_studies marks STALE (>90 min) studies as
        FAILED — the runner is presumed dead beyond recovery.
      • _resume_recent_fep_studies (this fn) handles the OPPOSITE
        case: studies submitted in the last ~10 minutes whose
        daemon-thread runner was killed by THIS process's restart
        (Fly redeploy). Those studies are in PENDING/PREPARING but
        their `updated_at` is recent — they haven't crossed the
        reaper's stale bar yet. Left alone, they'd sit stuck until
        the 90-min timeout reaps them as FAILED. We can do better:
        re-spawn the runner thread now.

    Detection: status in PENDING/PREPARING/RUNNING AND zero edges
    have pod_job_id (no dispatch ever reached the pod from this row).
    The pod_job_id is set by fep_runner.dispatch_edge after the
    pod's /fep_edge_start returns, so its absence proves nothing
    real-physics has happened yet.

    Idempotent: re-running this fn quickly is safe because the
    daemon thread it spawns is short-circuited by run_study's own
    cancellation/state checks. Worst case: a few extra thread
    spawns that no-op."""
    try:
        from sqlmodel import Session, select
        from sqlalchemy import text
        from .db import engine
        from .models import FepJob, FepJobStatus, FepPerturbation
        import threading
        from sqlmodel import Session as _S

        with Session(engine) as session:
            # Find FepJobs in dispatch-pending states. We filter to
            # the last 24 hours so a stuck-decades-ago row doesn't
            # get re-attempted indefinitely; combined with the 90-min
            # reaper, anything older becomes FAILED.
            recent_pending = session.exec(
                select(FepJob)
                .where(FepJob.status.in_((                                # type: ignore[attr-defined]
                    FepJobStatus.PENDING,
                    FepJobStatus.PREPARING,
                    FepJobStatus.RUNNING,
                )))
                .where(FepJob.updated_at >= text("now() - make_interval(hours => 24)"))
            ).all()

            resumable_ids: list[int] = []
            for job in recent_pending:
                # Skip if any edge has been dispatched to the pod —
                # that means real work has started; let the running
                # thread/pod finish or the reaper catch a true death.
                if job.id is None:
                    continue
                edge_count_with_pod_id = session.exec(
                    select(FepPerturbation)
                    .where(FepPerturbation.fep_job_id == job.id)
                    .where(FepPerturbation.pod_job_id.is_not(None))      # type: ignore[union-attr]
                ).first()
                if edge_count_with_pod_id is not None:
                    continue
                resumable_ids.append(job.id)

            if not resumable_ids:
                log.info("FEP resume sweep: no recent pre-dispatch studies to re-spawn")
                return

            # (N8) Authority gating. When FEP_AUTHORITATIVE_RECONCILER=1
            # is set, the reconciler (services/fep_reconciler.py) is
            # the sole dispatcher — spawning a daemon thread here would
            # race with the reconciler on the same queued edges. The
            # reconciler picks up dispatch_state='queued' rows on its
            # next tick (≤60s) automatically.
            from .services.fep_reconciler import _is_authoritative
            if _is_authoritative():
                log.info(
                    "FEP resume sweep: %d study/studies will be picked up by the "
                    "authoritative reconciler on its next tick (no daemon thread "
                    "spawned): %s",
                    len(resumable_ids), resumable_ids,
                )
                return

            log.warning(
                "FEP resume sweep: re-spawning runner thread for %d study/studies %s "
                "(reconciler is not authoritative — legacy daemon thread path)",
                len(resumable_ids), resumable_ids,
            )

            # Spawn one daemon thread per resumable study. Same shape
            # as the daemon-thread dispatch in create_fep_study.
            from .services.fep_runner import run_study_safe as _run_study_safe

            def _resume_in_thread(job_id: int) -> None:
                with _S(engine) as s:
                    # (M20) Exception → persist FAILED, fire alert.
                    _run_study_safe(job_id, s)

            for jid in resumable_ids:
                threading.Thread(
                    target=_resume_in_thread,
                    args=(jid,),
                    daemon=True,
                    name=f"fep_resume_{jid}",
                ).start()
    except Exception as e:                                                # noqa: BLE001
        log.exception("FEP resume sweep failed (non-fatal): %s", e)


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
            _reap_orphan_fep_studies()
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
    ("017_fep_access.sql", "Migration 017 (FEP+ per-user access flag, gated by default)"),
    ("018_fep_tables.sql", "Migration 018 (FEP study + node + perturbation tables)"),
    ("019_fep_estimated_cost.sql", "Migration 019 (FEP estimated_usd_cost column)"),
    ("020_fep_perturbation_stage.sql", "Migration 020 (FEP per-edge stage + progress + pod_job_id)"),
    ("021_fep_seq_number.sql", "Migration 021 (FEP per-user seq_number for human-friendly #)"),
    ("022_fep_force_field_engine.sql", "Migration 022 (FEP force_field_engine column)"),
    # (R1) Phase R of the reconciler architecture rewrite. Adds the
    # dispatch_state state machine + lifecycle timestamps that the
    # new fep_reconciler.py owns. Strictly fep_perturbation-only; the
    # docking schema is untouched.
    ("023_fep_dispatch_state.sql", "Migration 023 (FEP dispatch_state + lifecycle columns)"),
    # (U11) Idempotent ALTER TYPE … ADD VALUE IF NOT EXISTS to make sure
    # 'cancelled' lives in the jobstatus Postgres enum. Older Fly DBs
    # were initialised before CANCELLED was added to the Python model;
    # the cancel endpoint's raw-SQL UPDATE expects the value to exist.
    ("024_jobstatus_cancelled.sql", "Migration 024 (jobstatus.cancelled enum value)"),
    # (U18) Cure the SQLAlchemy "maps enums by NAME, not value" trap
    # that bit us on the 17-attempt history-page chase. Two files:
    # 025 adds lowercase enum values, 026 lowercases existing rows.
    # Split because PG won't let us use a newly-added enum value in
    # the same transaction it was added — each .sql file runs in its
    # own transaction, so 025 commits before 026's UPDATEs reference
    # the new values. Pairs with the JobStatus model's values_callable
    # mapping landed in the same release.
    ("025_jobstatus_lowercase_values.sql", "Migration 025 (jobstatus enum lowercase values)"),
    ("026_jobstatus_lowercase_rows.sql", "Migration 026 (lowercase existing job.status rows)"),
    ("027_fep_ddg_history.sql", "Migration 027 (FEP ddg_history_json for live convergence chart)"),
    # Dock result cache (docking critical-path optimisation). Repeat docks of an
    # identical molecule + identical conditions return instantly from this table
    # instead of re-running the GPU. Inert until DOCK_CACHE_ENABLED is set; the
    # docking schema is otherwise untouched. See services/dock_cache.py.
    ("028_dock_cache.sql", "Migration 028 (dock result cache table)"),
    # Per-user approval gate. New sign-ups land as `pending` and cannot dock
    # until approved. Existing rows are grandfathered to `approved` so this
    # is non-disruptive. The gate is what makes auto-stopping the GPU pod
    # safe (no random sign-up can wake it). See routers/admin.py + the
    # `/jobs` POST gate in routers/jobs.py.
    ("029_user_approval_status.sql", "Migration 029 (per-user approval gate)"),
    # 029's backfill over-grandfathered — it set 'approved' for every
    # pre-existing profile row, including dormant OAuth zombies who'd just
    # touched the OAuth callback once and never used the system. 030 re-pends
    # any row with zero job activity AND no explicit admin decision, while
    # keeping the admin email approved so the operator can't lock themselves
    # out. See the file header for the full rationale.
    ("030_repend_zombie_approvals.sql", "Migration 030 (re-pend zombie approvals)"),
    # signup_notified_at — atomic flag for notify_new_user dedup. Lets the
    # notification fire from /me/access_status on first call so OAuth users
    # whose user_profile row is trigger-created (and who never hit /welcome)
    # still trigger admin notification.
    ("031_signup_notified_at.sql", "Migration 031 (signup notification flag)"),
    # Mutant-Selective Binder Discovery — standalone /selective feature.
    # Creates ONLY the new selectivity_job table; the docking/FEP/Studio
    # schema is untouched. Idempotent CREATE TABLE IF NOT EXISTS. See
    # docs/mutant_selective_pipeline.md and services/selective_runner.py.
    ("032_selectivity_tables.sql", "Migration 032 (mutant-selective binder discovery table)"),
    # Raises free-tier quota 10 -> 20 (default + bump existing rows at 10).
    ("033_bump_free_quota_20.sql", "Migration 033 (free quota 10 -> 20)"),
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
    # (N4.0a) Bump updated_at on every in-flight FEP study FIRST, so
    # the reaper below sees a fresh 90/360-minute window starting now
    # rather than from the moment our previous daemon thread died.
    # Without this, a redeploy mid-edge reaps the row before M18 even
    # gets to look at it.
    _bump_inflight_fep_timestamps()
    # (I1) Reap stale FEP studies — two-tier threshold per N4.0b:
    # 90 min for pre-dispatch (no pod_job_id yet) and 6 h for studies
    # with any edge dispatched to the pod.
    _reap_orphan_fep_studies()
    # (M18) Re-spawn runner threads for RECENT (<90 min) FEP studies
    # whose daemon-thread runner died with THIS process's restart.
    # Without this, a study submitted seconds before a Fly redeploy
    # would sit in PREPARING for 90 minutes before the reaper kills
    # it. Now: backend restarts → recent studies get a fresh runner
    # thread → they continue from where they left off.
    _resume_recent_fep_studies()
    watchdog_task = asyncio.create_task(_runpod_watchdog())
    reaper_task = asyncio.create_task(_periodic_orphan_reaper())
    # S3 — failover watchdog. Companion to the cost watchdog: where the
    # cost watchdog STOPS the pod when idle, this one STARTS it when
    # /health is unreachable but recent activity says users need it.
    # No-op when RUNPOD_API_KEY / RUNPOD_POD_ID aren't set, or when
    # RUNPOD_FAILOVER_ENABLED is false.
    from .services.pod_failover import runpod_failover_watchdog
    failover_task = asyncio.create_task(runpod_failover_watchdog())
    # (R2) Phase R reconciler task — stateless edge-lifecycle owner.
    # Ships in shadow mode by default (FEP_RECONCILER_SHADOW=1 env)
    # so we can observe its view against the daemon-thread runner
    # without taking authority away yet. After the cutover (§7 of
    # the design doc), the daemon thread is removed and this task is
    # the sole owner of in-flight edge state.
    from .services.fep_reconciler import reconciler_task as fep_reconciler_task
    fep_reconciler_async_task = asyncio.create_task(fep_reconciler_task())

    # (U5) Liganx watchdog — hourly proactive health checks + auto-fix
    # for safe-to-remediate failure modes (idle GPU leak, stuck dock
    # jobs > 14h). Results served via GET /admin/watchdog/status.
    from .services.watchdog import watchdog_task as liganx_watchdog_task
    liganx_watchdog_async_task = asyncio.create_task(liganx_watchdog_task())

    try:
        yield
    finally:
        all_tasks = (
            watchdog_task, reaper_task, failover_task,
            fep_reconciler_async_task, liganx_watchdog_async_task,
        )
        for task in all_tasks:
            task.cancel()
        for task in all_tasks:
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
# (U17) Ad-blocker-friendly alias for the /jobs collection list. See
# jobs.py runs_router declaration for full rationale — short version:
# uBlock / EasyPrivacy / Brave Shields block the literal path /jobs
# as a tracking pattern, so the frontend's History page falls back
# to /runs for the list. Detail endpoints stay on /jobs.
app.include_router(jobs.runs_router)
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
app.include_router(fep.router)  # Phase B scaffold — endpoints return 501 until the FEP pod is wired up (docs/fep_plus_design.md)
app.include_router(calibrate.router)  # Pro feature: score user's own (drug, mutation) data against Liganx model
app.include_router(selective.router)  # Mutant-Selective Binder Discovery — standalone /selective feature (docs/mutant_selective_pipeline.md)
app.include_router(sentry_webhook.router)  # Sentry alerts → Telegram bridge (/internal/sentry-webhook)
app.include_router(telegram_webhook.router)  # Telegram Approve/Deny callbacks for new-user notifications


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

    # DATABASE_URL is a SQLAlchemy-style DSN ("postgresql+psycopg2://...").
    # psycopg2.connect() speaks libpq and chokes on the "+psycopg2" dialect
    # suffix with a ProgrammingError — which made this probe report
    # db_unreachable even when the database was perfectly healthy (the app
    # itself, going through SQLAlchemy, was fine the whole time). Strip the
    # dialect suffix to a plain libpq URI before connecting.
    libpq_dsn = db_url.replace("postgresql+psycopg2://", "postgresql://", 1)

    try:
        import psycopg2  # type: ignore
        # 2-second connect_timeout — fast enough to never hang the probe.
        conn = psycopg2.connect(libpq_dsn, connect_timeout=2)
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
        # Log the full error server-side; do NOT return it to the caller.
        # /health/db is unauthenticated and a DB connection error can carry
        # the host / connection-string shape in its text. The error_type
        # (class name, e.g. OperationalError) is safe + useful for alerting.
        log.warning("/health/db: database unreachable: %s", e)
        raise HTTPException(
            status_code=503,
            detail={
                "status": "db_unreachable",
                "error_type": type(e).__name__,
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
        # Do NOT echo the pod URL — it's an unauthenticated compute
        # endpoint; leaking its address here hands anyone the door. Report
        # configured/not + reachability instead, which is all monitoring
        # actually needs.
        "pod_dock_configured": bool(pod_dock_url_val),
        "pod_dock_status": pod_dock_status,
        "runpod_api_key": "configured" if settings.runpod_api_key else "missing",
        "boltz2_enabled": settings.boltz2_enabled,
        "boltz2_status": boltz2_status,
    }
