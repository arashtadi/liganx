"""Celery worker app for background job dispatch (#168, scaffold).

Status: SCAFFOLD. The Celery app and the run_job_task wrapper are
defined here, but the API endpoint still uses FastAPI's in-process
BackgroundTasks by default. Toggle with the USE_CELERY_DISPATCH env
flag once Redis is provisioned and a worker container is deployed.

See docs/celery_redis_migration_plan.md for the full migration plan
(Redis on Fly, worker container, feature-flag rollout, cleanup).

Why this scaffold ships before Redis is up. The dispatch site in
routers/jobs.py needs to know whether to enqueue or run-in-process,
and it needs to import the task function either way. Defining the
task here behind a "Celery configured?" check lets us:

  1. Land the dispatch-site refactor without breaking anything.
  2. Add the celery==5.x dependency to pyproject.toml.
  3. Smoke-test locally with a docker-compose Redis + worker.

When USE_CELERY_DISPATCH is False (default), this module is largely
inert — `run_job_task` exists but is never .delay()'d. The runner
itself is unchanged; the only thing changing is which process
executes runner.run_job(job_id).
"""

from __future__ import annotations

import logging
from typing import Any

from .config import get_settings

log = logging.getLogger(__name__)


# Celery import is conditional. Local dev environments without Celery
# installed (the Vercel deploy of the docs build, for example) should
# still be able to import this module — the API only calls Celery code
# when use_celery_dispatch=True at runtime.
try:
    from celery import Celery  # type: ignore[import-not-found]
    _CELERY_AVAILABLE = True
except ImportError:
    Celery = None  # type: ignore[assignment, misc]
    _CELERY_AVAILABLE = False


def _build_celery_app() -> "Celery | None":
    """Create the Celery app, or return None if Celery isn't configured.

    Failure modes intentionally separated:
      - Celery package not installed → return None, log INFO
      - settings.use_celery_dispatch is False → return None, log INFO
      - settings.celery_broker_url is empty → raise RuntimeError
        (asymmetric: if you flip the flag on without setting the broker,
        we want to fail loud rather than silently fall back to in-process)
    """
    if not _CELERY_AVAILABLE:
        log.info("Celery not installed — dispatch will use FastAPI BackgroundTasks")
        return None

    settings = get_settings()
    if not settings.use_celery_dispatch:
        log.info("USE_CELERY_DISPATCH=False — dispatch will use FastAPI BackgroundTasks")
        return None

    if not settings.celery_broker_url:
        raise RuntimeError(
            "USE_CELERY_DISPATCH=True but CELERY_BROKER_URL is empty. "
            "Set CELERY_BROKER_URL=redis://... or flip USE_CELERY_DISPATCH=False."
        )

    backend = settings.celery_result_backend or settings.celery_broker_url

    app = Celery(
        "liganx",
        broker=settings.celery_broker_url,
        backend=backend,
    )
    # Tunings appropriate for our workload — long-running per-job tasks
    # (1-15 min) running on a small worker pool, idempotent inputs.
    app.conf.update(
        # Acknowledge tasks after they complete, not when received. If a
        # worker crashes mid-job, the task is re-delivered. Our runner
        # is idempotent w.r.t. job_id (re-running a completed job is a
        # no-op — early-COMPLETED flip from #178), so this is safe.
        task_acks_late=True,
        # Only fetch one task at a time per worker. Each task spawns Pod
        # requests that take 1-5 min wall-time; prefetching multiple
        # would just queue them locally and starve other workers.
        worker_prefetch_multiplier=1,
        # Reject and re-queue on disconnect rather than losing the task.
        task_reject_on_worker_lost=True,
        # Visibility timeout (Redis-broker-specific): how long Redis
        # waits before re-delivering an unacked task. Set to 30 min —
        # longer than our worst-case job runtime (a 12-cell matrix on
        # cold pod is ~20 min).
        broker_transport_options={"visibility_timeout": 60 * 30},
        # Send sent/received/started events so flower (or any other
        # monitor) can show the queue.
        worker_send_task_events=True,
        task_send_sent_event=True,
        # Task time limit — kill any task hung longer than 60 min.
        # Hard timeout; soft is 50 min (gives the runner a chance to
        # finalise cell rows).
        task_soft_time_limit=60 * 50,
        task_time_limit=60 * 60,
    )

    log.info(
        "Celery app configured: broker=%s prefetch=%d acks_late=True",
        settings.celery_broker_url.split("@")[-1],  # scrub credentials from log
        app.conf.worker_prefetch_multiplier,
    )
    return app


# Module-level Celery app — None when not configured; non-None when
# USE_CELERY_DISPATCH=True and broker is set. Workers import this
# module and `celery_app` to start the worker pool.
celery_app = _build_celery_app()


def run_job_task(job_id: str) -> None:
    """Celery task wrapper around runner.run_job().

    When use_celery_dispatch=True: the API enqueues this via
    `run_job_task.delay(job_id)`, the worker picks it up, runs the
    full pipeline, persists the cell rows.

    When use_celery_dispatch=False: this function is never called.
    The API uses background_tasks.add_task(run_job_in_background, ...)
    instead.

    The actual job logic is unchanged — this is just a process-
    boundary wrapper that lets us move execution out of the API.
    """
    # Import inside the function to avoid pulling the runner's heavy
    # bio dependencies (RDKit, OpenMM, etc.) into the API process at
    # import time. The worker process imports this module, then this
    # function is called, then the runner is loaded.
    from .services.runner import run_job_in_background

    log.info("Celery worker picked up job %s", job_id)
    run_job_in_background(job_id)


# Register the task with Celery only if the app exists. When Celery
# isn't configured (default state today), `run_job_task` is just a
# regular Python function — calling it directly works for tests and
# local dev.
if celery_app is not None:
    run_job_task = celery_app.task(  # type: ignore[assignment]
        bind=False,
        name="liganx.run_job",
        autoretry_for=(ConnectionError, TimeoutError),
        retry_backoff=True,
        max_retries=2,
    )(run_job_task)


def dispatch_job(job_id: str, *, background_tasks: Any | None = None) -> str:
    """Single entry point for "run this job, somehow".

    Routes to Celery if configured, else falls through to the FastAPI
    BackgroundTasks executor (existing behaviour). Returns a string
    indicating which path was used — useful in logs and tests.

    The API endpoint should call this with both the job_id and the
    request's BackgroundTasks instance; we pick which to use.
    """
    if celery_app is not None:
        # Celery path — fire and forget; worker will pick it up.
        run_job_task.delay(job_id)  # type: ignore[attr-defined]
        log.info("Job %s dispatched via Celery", job_id)
        return "celery"

    if background_tasks is None:
        # No Celery, no BackgroundTasks — caller didn't pass either,
        # fall back to inline execution. This path exists for tests
        # and CLI tools; production always passes BackgroundTasks.
        from .services.runner import run_job_in_background
        log.warning("Job %s running inline (no Celery, no BackgroundTasks)", job_id)
        run_job_in_background(job_id)
        return "inline"

    background_tasks.add_task(run_job_task, job_id)
    log.info("Job %s dispatched via FastAPI BackgroundTasks", job_id)
    return "background_tasks"
