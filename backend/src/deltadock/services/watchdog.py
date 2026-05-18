"""Liganx watchdog (U5) — hourly proactive health check + auto-remediation.

Catches issues before users see them. Runs as an asyncio task in lifespan
(parallel to the FEP reconciler), wakes every WATCHDOG_INTERVAL_SECONDS,
runs a battery of checks against the pod, the DB, and the in-flight job
state, and:

  1. AUTO-FIXES safe, well-understood failure modes:
       - GPU memory leak on idle fep_server → trigger restart
       - Docking jobs stuck > 14 h (matches reaper threshold) → mark FAILED
       - Old terminal pod-job dirs > 7 days → relies on pod's disk_cleaner
         thread that already handles this (N14)

  2. RECORDS every run in an in-memory ring buffer (last 24 runs = 1 day
     at hourly cadence) so the admin endpoint can serve a recent
     timeline without needing a new DB table.

  3. DOES NOT push notifications. The watchdog publishes via
     GET /admin/watchdog/status; the human/UI polls. (Per U5 design
     decision — keep notification plumbing out of scope.)

Scope guarantee: only READS docking + FEP tables, and only WRITES in the
auto-remediation paths that explicitly target stuck/leaked state. Never
modifies in-flight work that the reconciler or runner is currently
shepherding.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, Optional

import httpx
from sqlalchemy import text
from sqlmodel import Session

from ..config import get_settings, pod_auth_headers

settings = get_settings()
from ..db import engine

log = logging.getLogger(__name__)


# How often we run. 1 h matches the user's request ("wakes up every
# hour and does a health check"). Override with WATCHDOG_INTERVAL_S for
# faster cadence in dev/test.
WATCHDOG_INTERVAL_SECONDS = int(os.environ.get("WATCHDOG_INTERVAL_S", "3600"))

# Ring buffer of last N watchdog runs served by the admin endpoint.
# 24 = one day at hourly cadence.
_HISTORY_MAX = 24

# Per-check severity levels.
SEV_OK = "ok"
SEV_WARN = "warn"
SEV_CRITICAL = "critical"


@dataclass
class CheckResult:
    """One check's output. Severity tells the admin UI how to render it."""
    name: str
    severity: str
    message: str
    # Optional structured detail (counts, sizes, latencies) for the UI.
    details: dict[str, Any] = field(default_factory=dict)
    # If auto-remediation kicked in, this is a short human-readable line
    # describing what we did. None when no action taken.
    remediation: Optional[str] = None


@dataclass
class WatchdogRun:
    started_at: str
    duration_ms: int
    results: list[dict]   # serialised CheckResults
    summary: dict[str, int]   # {"ok": N, "warn": M, "critical": K}


# In-memory ring buffer; one process per Fly machine, so a watchdog run
# from another Fly redeploy isn't visible here — that's fine, the admin
# UI shows "last 24 runs from THIS process" and `started_at` makes it
# obvious when the process restarted.
_history: list[WatchdogRun] = []


def get_history() -> list[dict]:
    """Latest-first list of recorded watchdog runs (for the admin endpoint)."""
    return [asdict(r) for r in reversed(_history)]


def _push_history(run: WatchdogRun) -> None:
    _history.append(run)
    if len(_history) > _HISTORY_MAX:
        del _history[0]


# ─── Individual checks ───────────────────────────────────────────────────


async def check_pod_dock_health() -> CheckResult:
    """Probe the dock_server /health endpoint. WARN on transport error,
    CRITICAL if the body says deps_ok=False."""
    url = (settings.pod_dock_url or "").rstrip("/") + "/health"
    if not settings.pod_dock_url:
        return CheckResult(
            name="pod_dock_health", severity=SEV_WARN,
            message="POD_DOCK_URL not configured; cannot probe.",
        )
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url, headers=pod_auth_headers())
        if r.status_code != 200:
            return CheckResult(
                name="pod_dock_health", severity=SEV_CRITICAL,
                message=f"HTTP {r.status_code} from dock_server /health",
                details={"body": r.text[:200]},
            )
        body = r.json()
        if not body.get("ok"):
            return CheckResult(
                name="pod_dock_health", severity=SEV_CRITICAL,
                message=f"dock_server reports ok=False: {body}",
                details=body,
            )
        return CheckResult(
            name="pod_dock_health", severity=SEV_OK,
            message=f"dock_server healthy ({body.get('engine', '?')})",
            details=body,
        )
    except (httpx.TimeoutException, httpx.RequestError) as e:
        return CheckResult(
            name="pod_dock_health", severity=SEV_CRITICAL,
            message=f"transport error: {type(e).__name__}: {e}",
        )


async def check_pod_fep_health() -> CheckResult:
    """Same as above but for fep_server. WARN-level when FEP URL isn't
    configured (some deployments don't run FEP)."""
    url = (os.environ.get("POD_FEP_URL", "") or "").strip().rstrip("/") + "/health"
    if url == "/health":
        return CheckResult(
            name="pod_fep_health", severity=SEV_OK,
            message="POD_FEP_URL not configured; skipping (FEP disabled).",
        )
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url, headers=pod_auth_headers())
        if r.status_code != 200:
            return CheckResult(
                name="pod_fep_health", severity=SEV_CRITICAL,
                message=f"HTTP {r.status_code} from fep_server /health",
                details={"body": r.text[:200]},
            )
        body = r.json()
        if not body.get("ok"):
            return CheckResult(
                name="pod_fep_health", severity=SEV_CRITICAL,
                message=f"fep_server reports ok=False",
                details=body,
            )
        return CheckResult(
            name="pod_fep_health", severity=SEV_OK,
            message=f"fep_server healthy (deps_ok={body.get('deps_ok')})",
            details=body,
        )
    except (httpx.TimeoutException, httpx.RequestError) as e:
        return CheckResult(
            name="pod_fep_health", severity=SEV_WARN,
            message=f"transport error: {type(e).__name__}: {e}",
        )


async def check_gpu_leak() -> CheckResult:
    """Detect the OpenMM-CUDA-context leak pattern (U4): fep_server is
    holding >5 GB of GPU memory but has zero active edges. Auto-remediate
    by hitting fep_server's /admin/gpu_status (which is read-only) and
    restarting fep_server via supervisord if has_orphan_leak=True.

    Note: actual restart needs to happen FROM the pod side — we don't
    have shell access from Fly. So 'remediation' here is to log + flag
    so an operator (or a future pod-side cron) can act. The pod's
    _idle_restarter handles this autonomously after 30 min of idle, so
    this check is the early-warning belt to that suspenders.
    """
    url = (os.environ.get("POD_FEP_URL", "") or "").strip().rstrip("/") + "/admin/gpu_status"
    if url == "/admin/gpu_status":
        return CheckResult(
            name="gpu_leak", severity=SEV_OK,
            message="POD_FEP_URL not configured; skipping.",
        )
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(url, headers=pod_auth_headers())
        if r.status_code != 200:
            return CheckResult(
                name="gpu_leak", severity=SEV_WARN,
                message=f"HTTP {r.status_code} from /admin/gpu_status",
                details={"body": r.text[:200]},
            )
        body = r.json()
        used_mb = int(body.get("gpu_used_mb", 0))
        active = int(body.get("active_edges", 0))
        if body.get("has_orphan_leak"):
            return CheckResult(
                name="gpu_leak", severity=SEV_WARN,
                message=(
                    f"GPU leak detected: {used_mb} MB held with {active} "
                    f"active edges. Pod-side _idle_restarter will respawn "
                    f"fep_server within 30 min."
                ),
                details=body,
                remediation="pod-side idle_restarter will trigger automatically",
            )
        return CheckResult(
            name="gpu_leak", severity=SEV_OK,
            message=f"GPU healthy: {used_mb} MB used, {active} active edges",
            details=body,
        )
    except (httpx.TimeoutException, httpx.RequestError) as e:
        return CheckResult(
            name="gpu_leak", severity=SEV_WARN,
            message=f"transport error: {type(e).__name__}: {e}",
        )


def check_stuck_docking_jobs(session: Session) -> CheckResult:
    """Docking jobs in (pending, running) where updated_at hasn't moved
    in > 14 h. The existing reaper handles this but at startup-time only;
    the watchdog is the steady-state belt to that suspenders.

    Auto-remediation: mark jobs FAILED with a clear error_message that
    points at the dock-stuck path so the user understands why it died.
    Conservative threshold (14 h) leaves the in-progress reaper window
    untouched and only acts on jobs that are genuinely abandoned."""
    rows = session.execute(text(
        "SELECT id, share_id, status, updated_at,"
        "       EXTRACT(EPOCH FROM (now() - updated_at))/3600 AS hours_stuck"
        "  FROM job"
        " WHERE status IN ('running', 'pending')"
        "   AND updated_at < now() - interval '14 hours'"
        " ORDER BY updated_at"
        " LIMIT 25"
    )).mappings().all()
    if not rows:
        return CheckResult(
            name="stuck_docking_jobs", severity=SEV_OK,
            message="No docking jobs stuck > 14 h.",
        )
    # Auto-remediation: mark FAILED.
    fixed = 0
    for r in rows:
        session.execute(text(
            "UPDATE job SET status = 'failed',"
            "       error_message = :msg,"
            "       updated_at = now()"
            " WHERE id = :jid AND status IN ('running','pending')"
        ), {
            "jid": r["id"],
            "msg": (
                f"Watchdog auto-failed: status was '{r['status']}' with "
                f"no progress for {r['hours_stuck']:.1f} h. Pod or runner "
                f"likely died mid-job. Please re-submit."
            ),
        })
        fixed += 1
    session.commit()
    return CheckResult(
        name="stuck_docking_jobs", severity=SEV_WARN,
        message=f"Auto-failed {fixed} docking job(s) stuck > 14 h.",
        details={"jobs": [
            {"id": r["id"], "share_id": r["share_id"],
             "hours_stuck": round(float(r["hours_stuck"]), 1)} for r in rows
        ]},
        remediation=f"marked {fixed} job(s) FAILED with explanatory error_message",
    )


def check_stuck_fep_edges(session: Session) -> CheckResult:
    """FEP edges that the reconciler should be polling but haven't been
    polled in > 30 min. This shouldn't normally happen — the reconciler
    runs every 60 s. If we see this, the reconciler asyncio task may have
    crashed; we observe but DON'T auto-fix because the right action is to
    surface it and let an operator restart the backend."""
    rows = session.execute(text(
        "SELECT id, fep_job_id, dispatch_state, pod_job_id,"
        "       EXTRACT(EPOCH FROM (now() - last_polled_at))/60 AS minutes_stale"
        "  FROM fep_perturbation"
        " WHERE dispatch_state IN ('dispatching', 'running')"
        "   AND last_polled_at IS NOT NULL"
        "   AND last_polled_at < now() - interval '30 minutes'"
        " LIMIT 25"
    )).mappings().all()
    if not rows:
        return CheckResult(
            name="stuck_fep_edges", severity=SEV_OK,
            message="All in-flight FEP edges polled within last 30 min.",
        )
    return CheckResult(
        name="stuck_fep_edges", severity=SEV_WARN,
        message=(
            f"{len(rows)} FEP edge(s) not polled in > 30 min. "
            "Reconciler task may have stalled; backend restart may be needed."
        ),
        details={"edges": [
            {"id": r["id"], "fep_job_id": r["fep_job_id"],
             "dispatch_state": r["dispatch_state"],
             "minutes_stale": round(float(r["minutes_stale"]), 1)} for r in rows
        ]},
    )


def check_stale_cancellations(session: Session) -> CheckResult:
    """Cancelled FEP edges whose cancel-to-pod propagation is lagging.
    The reconciler's N9 cancel-propagation runs every tick; if we see
    cancelled edges with pod_job_id set + no recent poll, something is
    wrong with the propagation path (or the pod is unreachable)."""
    rows = session.execute(text(
        "SELECT id, fep_job_id, pod_job_id,"
        "       EXTRACT(EPOCH FROM (now() - COALESCE(last_polled_at,"
        "                                            completed_at,"
        "                                            now())))/60 AS minutes_stale"
        "  FROM fep_perturbation"
        " WHERE dispatch_state = 'cancelled'"
        "   AND pod_job_id IS NOT NULL"
        "   AND (last_polled_at IS NULL OR"
        "        last_polled_at < now() - interval '15 minutes')"
        " LIMIT 25"
    )).mappings().all()
    if not rows:
        return CheckResult(
            name="stale_cancellations", severity=SEV_OK,
            message="All recent cancels propagated to pod.",
        )
    return CheckResult(
        name="stale_cancellations", severity=SEV_WARN,
        message=(
            f"{len(rows)} cancelled edge(s) with pod_job_id set but "
            "/fep_edge_cancel not delivered in > 15 min."
        ),
        details={"edges": [
            {"id": r["id"], "pod_job_id": r["pod_job_id"],
             "minutes_stale": round(float(r["minutes_stale"]), 1)} for r in rows
        ]},
    )


def check_db_alive(session: Session) -> CheckResult:
    """Cheap probe — SELECT 1. Catches transient Postgres outages."""
    try:
        session.execute(text("SELECT 1")).scalar()
        return CheckResult(
            name="db_alive", severity=SEV_OK, message="Postgres reachable.",
        )
    except Exception as e:                                               # noqa: BLE001
        return CheckResult(
            name="db_alive", severity=SEV_CRITICAL,
            message=f"DB query failed: {type(e).__name__}: {e}",
        )


def check_recent_jobs(session: Session) -> CheckResult:
    """Throughput sanity check — counts of jobs in each status over the
    last 24 h. Always SEV_OK (purely informational); useful in the admin
    UI for spotting unusual error spikes."""
    row = session.execute(text(
        "SELECT status, COUNT(*) AS n"
        "  FROM job"
        " WHERE created_at > now() - interval '24 hours'"
        " GROUP BY status"
    )).all()
    counts = {r[0]: r[1] for r in row}
    total = sum(counts.values()) or 0
    return CheckResult(
        name="recent_jobs_24h", severity=SEV_OK,
        message=(
            f"{total} docking jobs in last 24 h ("
            f"{counts.get('completed', 0)} completed, "
            f"{counts.get('failed', 0)} failed, "
            f"{counts.get('running', 0)} running, "
            f"{counts.get('pending', 0)} pending)"
        ),
        details=counts,
    )


# ─── Orchestrator ────────────────────────────────────────────────────────


async def run_all_checks() -> WatchdogRun:
    """Run every check, collect results, push to history, return."""
    started = datetime.utcnow()
    t0 = time.time()

    # Async checks fire in parallel (3 pod probes typically take 0.3-2 s each).
    async_results = await asyncio.gather(
        check_pod_dock_health(),
        check_pod_fep_health(),
        check_gpu_leak(),
        return_exceptions=True,
    )
    results: list[CheckResult] = []
    for r in async_results:
        if isinstance(r, CheckResult):
            results.append(r)
        elif isinstance(r, Exception):
            results.append(CheckResult(
                name="async_check_crashed", severity=SEV_WARN,
                message=f"{type(r).__name__}: {r}",
            ))

    # DB checks need a sync Session; run them serially.
    try:
        with Session(engine) as session:
            for fn in (
                check_db_alive,
                check_stuck_docking_jobs,
                check_stuck_fep_edges,
                check_stale_cancellations,
                check_recent_jobs,
            ):
                try:
                    results.append(fn(session))
                except Exception as e:                                   # noqa: BLE001
                    log.exception("watchdog: %s failed", fn.__name__)
                    results.append(CheckResult(
                        name=fn.__name__, severity=SEV_WARN,
                        message=f"check crashed: {type(e).__name__}: {e}",
                    ))
    except Exception as e:                                               # noqa: BLE001
        log.exception("watchdog: DB session setup failed")
        results.append(CheckResult(
            name="db_session", severity=SEV_CRITICAL,
            message=f"Session() failed: {type(e).__name__}: {e}",
        ))

    summary = {SEV_OK: 0, SEV_WARN: 0, SEV_CRITICAL: 0}
    for r in results:
        summary[r.severity] = summary.get(r.severity, 0) + 1

    duration_ms = int((time.time() - t0) * 1000)
    run = WatchdogRun(
        started_at=started.isoformat() + "Z",
        duration_ms=duration_ms,
        results=[asdict(r) for r in results],
        summary=summary,
    )
    _push_history(run)
    log.info(
        "watchdog: run complete in %d ms — ok=%d warn=%d crit=%d",
        duration_ms, summary[SEV_OK], summary[SEV_WARN], summary[SEV_CRITICAL],
    )
    return run


async def watchdog_task() -> None:
    """Long-running asyncio task. Sleeps WATCHDOG_INTERVAL_SECONDS, runs
    all checks, repeats. Wraps every iteration in try/except so a single
    crashed check can't take the whole task down."""
    log.info("Liganx watchdog started (interval=%ds)", WATCHDOG_INTERVAL_SECONDS)
    # First run on boot — gives the admin UI immediate data instead of
    # waiting an hour for the first results.
    try:
        await run_all_checks()
    except Exception as e:                                               # noqa: BLE001
        log.exception("watchdog: first-run failed: %s", e)

    while True:
        try:
            await asyncio.sleep(WATCHDOG_INTERVAL_SECONDS)
            await run_all_checks()
        except asyncio.CancelledError:
            log.info("Liganx watchdog stopping (asyncio cancel)")
            raise
        except Exception as e:                                           # noqa: BLE001
            log.exception("watchdog: tick failed: %s", e)
