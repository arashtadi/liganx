"""FastAPI application entrypoint."""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import get_settings
from .db import init_db
from .routers import admin, assist, catalog, contact, jobs, lookup, me, me_compounds, structures, suggest

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


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log.info("Starting DeltaDock backend %s in %s mode", __version__, settings.app_env)
    init_db()
    _reap_orphan_jobs()
    yield
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
