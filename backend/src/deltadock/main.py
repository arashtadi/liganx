"""FastAPI application entrypoint."""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import get_settings
from .db import init_db
from .routers import admin, assist, catalog, contact, jobs, lookup, me, me_compounds, screening, structures, suggest

# Git SHA of the deployed image — injected by the GH Actions workflow as a
# build arg / env var. Lets us verify which commit is actually live without
# having to read Fly logs. Defaults to "dev" for local runs.
GIT_SHA = os.environ.get("GIT_SHA", "dev")

settings = get_settings()
logging.basicConfig(level=settings.log_level.upper())
log = logging.getLogger("deltadock")


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
    threshold = settings.runpod_idle_minutes * 60
    log.info("RunPod watchdog: idle-stop after %d min of no traffic", settings.runpod_idle_minutes)
    while True:
        try:
            await asyncio.sleep(60)
            elapsed = seconds_since_last_activity()
            if elapsed is None or elapsed < threshold:
                continue
            try:
                status = await runpod_client.get_pod_status()
            except Exception as e:  # noqa: BLE001
                log.warning("RunPod watchdog: status check failed: %s", e)
                continue
            if (status.get("desiredStatus") or "").upper() != "RUNNING":
                continue
            log.info(
                "RunPod watchdog: pod idle %ds (>%ds) — stopping",
                int(elapsed), threshold,
            )
            try:
                await runpod_client.stop_pod()
            except Exception as e:  # noqa: BLE001
                log.warning("RunPod watchdog: stop failed: %s", e)
        except asyncio.CancelledError:
            log.info("RunPod watchdog: cancelled")
            return
        except Exception as e:  # noqa: BLE001
            log.warning("RunPod watchdog: unexpected: %s", e)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    import asyncio
    log.info("Starting DeltaDock backend %s in %s mode", __version__, settings.app_env)
    init_db()
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


@app.get("/health", tags=["meta"])
def health() -> dict:
    return {
        "status": "ok",
        "version": __version__,
        "env": settings.app_env,
        "git_sha": GIT_SHA,
    }


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
