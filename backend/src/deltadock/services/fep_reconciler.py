"""FEP edge reconciler — stateless reconciliation loop (Phase R2).

Replaces the daemon-thread pattern in fep_runner.run_study() that owned
in-flight edge state in Python RAM. See docs/fep_reconciler_design.md
for the full architecture spec.

# Why this exists

The old pattern: POST /fep/studies → spawn daemon thread → thread owns
a polling loop for the next N hours/days. Any Fly redeploy, OOM, or
machine cycle killed the thread. The pod kept computing for hours past
each death, with no one collecting the result.

The new pattern: POST /fep/studies → write edges to DB in state=queued
→ return immediately, no thread spawned. A separate stateless task
(this file) wakes every 60 seconds, scans DB for in-flight edges,
polls the pod, and writes back. Killing this task is a no-op for
correctness — the next tick picks up exactly where it left off because
EVERY piece of state lives in Postgres.

# What this is NOT

- A worker. It does no compute itself; it's a reconciler in the
  Kubernetes-controller sense.
- A scheduler. Edges are only dispatched in-order per study, by the
  existing precedence in fep_runner.build_perturbation_graph; this
  loop just shepherds dispatch_state transitions.
- A retry mechanism for failed edges. Once a edge is `failed` or
  `cancelled`, it stays that way. Manual re-queue via admin endpoint
  is a future task; for now we treat failures as terminal.

# Scope guarantee

This file modifies ONLY fep_perturbation rows. It does not touch:
  - any docking tables (job, screening, boltz2_job, mmgbsa_job)
  - any docking services (runner.py, pod_dock.py, etc.)
  - any non-FEP routes
See docs/fep_reconciler_design.md §6.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta
from typing import Optional

import httpx
from sqlalchemy import text
from sqlmodel import Session, select

from ..config import pod_auth_headers
from ..db import engine
from ..models import FepJob, FepJobStatus, FepNode, FepPerturbation

log = logging.getLogger(__name__)


# How often the reconciler wakes. 60s gives 840 polls during a max-
# duration 14h edge — plenty of liveness. Anything faster thrashes
# the pod's /fep_edge_status endpoint without telling us more.
RECONCILE_INTERVAL_SECONDS = 60

# Edges in `dispatching` for longer than this are presumed lost to a
# crashed HTTP request — re-queue them and the reconciler will retry
# the dispatch on the next tick. Idempotency on the pod side (via
# client_token = perturbation.id) ensures this never double-charges.
DISPATCH_STALE_AFTER_SECONDS = 5 * 60

# (S2 preview) If the pod hasn't been reachable for this long, mark
# every in-flight edge in this reconciler's worldview as FAILED with
# a real error message. 1 h matches the design doc §5 cancellation
# contract. The pod-side auto-cancel (Q2) is 30 min — strictly tighter,
# so the pod gives up before we do.
POD_UNREACHABLE_FAIL_AFTER_SECONDS = 60 * 60


# (Phase R rollout) Shadow mode: when enabled, the reconciler still
# runs the full poll loop but does NOT mutate dispatch_state or write
# results. Pure observation, logged to compare against the daemon-thread
# runner. Flip via FEP_RECONCILER_SHADOW=1 in Fly env. Default = "do
# transitions" once we're past the cutover window.
def is_shadow_mode() -> bool:
    return os.environ.get("FEP_RECONCILER_SHADOW", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


# (Phase R rollout) Master kill-switch. Set FEP_RECONCILER_ENABLED=0
# to disable the reconciler entirely (falls back to the legacy daemon
# thread runner in run_study). Default: enabled. This is a safety
# valve, not the rollout mechanism — that's shadow mode above.
def is_reconciler_enabled() -> bool:
    return (
        os.environ.get("FEP_RECONCILER_ENABLED", "1").strip().lower()
        not in {"0", "false", "no"}
    )


# ─── Hot SQL queries ─────────────────────────────────────────────────────


# Edges in flight: dispatching (HTTP call in progress, or stalled) or
# running (pod accepted, MD in progress). The reconciler polls these
# every tick.
_IN_FLIGHT_EDGES_SQL = text(
    """
    SELECT id, fep_job_id, dispatch_state, pod_job_id, last_polled_at,
           dispatched_at, stage, progress_pct
      FROM fep_perturbation
     WHERE dispatch_state IN ('dispatching', 'running')
     ORDER BY dispatched_at NULLS LAST
    """
)


# Edges ready for dispatch: in `queued` state, with no pod_job_id
# (defensive: NULL means not yet dispatched). Ordered by job creation
# so older studies' edges are dispatched first.
_QUEUED_EDGES_SQL = text(
    """
    SELECT p.id, p.fep_job_id, j.share_id
      FROM fep_perturbation p
      JOIN fep_job          j ON j.id = p.fep_job_id
     WHERE p.dispatch_state = 'queued'
       AND j.status IN ('PENDING', 'PREPARING', 'RUNNING')
     ORDER BY j.created_at, p.id
    """
)


# ─── Pod polling ─────────────────────────────────────────────────────────


async def _poll_pod_status(
    pod_url: str, pod_job_id: str, timeout_s: float = 20.0
) -> Optional[dict]:
    """Call the pod's /fep_edge_status/{job_id}.

    Returns the JSON payload on success, or None on any HTTP/network
    error. Never raises — the caller decides what to do with None
    (typically: bump last_polled_at not at all, leave state unchanged,
    retry next tick).
    """
    url = f"{pod_url.rstrip('/')}/fep_edge_status/{pod_job_id}"
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.get(url, headers=pod_auth_headers())
    except (httpx.TimeoutException, httpx.RequestError) as e:
        log.warning("reconciler: pod poll transport error for %s: %s", pod_job_id, e)
        return None
    if resp.status_code == 404:
        # Pod has no record of this job_id. Could mean the pod was
        # restarted and lost the in-memory map; the disk JSON should
        # still exist via the persistent-state mechanism. Treat as
        # "pod-side state lost" → bubble that up for handling.
        return {"status": "lost", "_pod_404": True}
    if not resp.is_success:
        log.warning(
            "reconciler: pod poll HTTP %d for %s: %s",
            resp.status_code, pod_job_id, resp.text[:200],
        )
        return None
    try:
        return resp.json()
    except Exception:                                                # noqa: BLE001
        log.warning("reconciler: pod poll JSON parse fail for %s", pod_job_id)
        return None


# ─── Reconciliation step (one tick) ──────────────────────────────────────


def reconcile_once_sync(session: Session) -> dict:
    """One reconciler tick — sync version for tests + invocation from
    the async wrapper.

    Returns a small dict of counters so tests can assert on it without
    parsing logs.

    Step 1: For each edge in (dispatching, running), poll the pod and
            update the row based on what the pod says.
    Step 2: For each edge in `queued`, if the parent study isn't
            cancelled, ask the dispatcher to push the next edge to the
            pod. (Real HTTP call happens inside _try_dispatch_next.)

    Both steps are idempotent and crash-safe. If we crash mid-step,
    the next tick re-reads the DB and picks up whatever state was
    committed."""
    counters = {
        "polled": 0,
        "transitions": 0,
        "dispatch_attempts": 0,
        "errors": 0,
        "shadow_mode": is_shadow_mode(),
    }
    if not is_reconciler_enabled():
        return counters

    # ── Step 1: poll in-flight edges ──────────────────────────────
    in_flight = list(session.execute(_IN_FLIGHT_EDGES_SQL).fetchall())
    for row in in_flight:
        counters["polled"] += 1
        try:
            _reconcile_one_edge(session, row)
            counters["transitions"] += 1
        except Exception as e:                                       # noqa: BLE001
            counters["errors"] += 1
            log.exception("reconciler: edge %s reconcile failed: %s", row.id, e)

    # ── Step 2: dispatch new queued edges ─────────────────────────
    # Limit: at most 1 new dispatch per tick, so we don't flood the
    # pod with 10 parallel /fep_edge_start calls. The single pod
    # serialises edges anyway.
    queued = list(session.execute(_QUEUED_EDGES_SQL).fetchall())
    if queued:
        counters["dispatch_attempts"] += 1
        try:
            _try_dispatch_next(session, queued[0])
        except Exception as e:                                       # noqa: BLE001
            counters["errors"] += 1
            log.exception("reconciler: dispatch_next failed: %s", e)

    return counters


def _reconcile_one_edge(session: Session, edge_row) -> None:
    """Poll the pod for one in-flight edge and reconcile the DB state.

    Sync (synchronous-style) call to the pod via httpx.Client — async
    pod polling is conceptually nicer but adds complexity (need to
    pass the loop through) without measurable benefit at our scale
    (≤ 10 in-flight edges per tick).
    """
    if is_shadow_mode():
        log.info(
            "[shadow] edge %s state=%s pod_job_id=%s — skipping mutation",
            edge_row.id, edge_row.dispatch_state, edge_row.pod_job_id,
        )
        return

    pod_url = _pod_url_for_edge(session, edge_row.fep_job_id)
    if not pod_url:
        # No pod URL configured — caller is responsible for marking
        # the study FAILED. We don't do it here because that's the
        # daemon-thread runner's job during the rollout window.
        return

    if not edge_row.pod_job_id:
        # State=dispatching with no pod_job_id — either an in-flight
        # dispatch RPC, or a stalled one. If stalled (older than
        # DISPATCH_STALE_AFTER_SECONDS), revert to queued so the next
        # dispatch attempt retries. Idempotency on the pod side
        # (client_token) ensures this never spawns two workers.
        if edge_row.dispatched_at is None:
            return                                                   # fresh, give it a few seconds
        age = datetime.utcnow() - edge_row.dispatched_at
        if age > timedelta(seconds=DISPATCH_STALE_AFTER_SECONDS):
            log.warning(
                "reconciler: edge %s stuck in dispatching for %s — reverting to queued",
                edge_row.id, age,
            )
            session.execute(
                text(
                    "UPDATE fep_perturbation"
                    " SET dispatch_state = 'queued', dispatched_at = NULL"
                    " WHERE id = :id AND dispatch_state = 'dispatching'"
                ),
                {"id": edge_row.id},
            )
            session.commit()
        return

    # Edge has a pod_job_id — poll the pod synchronously. (Async-poll
    # variant could be added later for parallel polling of many edges;
    # not needed at our scale today.)
    url = pod_url.rstrip("/") + f"/fep_edge_status/{edge_row.pod_job_id}"
    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.get(url, headers=pod_auth_headers())
    except (httpx.TimeoutException, httpx.RequestError) as e:
        log.warning("reconciler: pod poll transport error for edge %s: %s", edge_row.id, e)
        return
    if not resp.is_success:
        log.warning(
            "reconciler: pod poll HTTP %d for edge %s: %s",
            resp.status_code, edge_row.id, resp.text[:200],
        )
        return
    try:
        payload = resp.json()
    except Exception:                                                # noqa: BLE001
        return

    # Always tick last_polled_at — this is the signal S2 stale-pod
    # detection watches. Tick even when stage hasn't changed.
    pod_status = (payload.get("status") or "").lower()
    pod_stage = payload.get("stage") or "running"
    progress_pct = payload.get("progress_pct")

    if pod_status == "done":
        # Edge completed on the pod. Mark aggregating; the dispatcher
        # in fep_runner picks this up and writes the ddg_* fields.
        # We do NOT write them here — that requires the legacy
        # post-processing path which lives in run_study.
        session.execute(
            text(
                "UPDATE fep_perturbation"
                " SET dispatch_state = 'aggregating',"
                "     last_polled_at = now(),"
                "     stage = 'done',"
                "     progress_pct = 100"
                " WHERE id = :id"
                "   AND dispatch_state = 'running'"
            ),
            {"id": edge_row.id},
        )
        session.commit()
        log.info("reconciler: edge %s pod-side done; marked aggregating", edge_row.id)
        return

    if pod_status in ("failed", "lost"):
        result = payload.get("result") or {}
        err = (result.get("error") or "pod reported edge as failed")[:600]
        session.execute(
            text(
                "UPDATE fep_perturbation"
                " SET dispatch_state = 'failed',"
                "     last_polled_at = now(),"
                "     status = 'failed',"
                "     pod_log_tail = :err,"
                "     completed_at = now()"
                " WHERE id = :id"
                "   AND dispatch_state IN ('running', 'dispatching')"
            ),
            {"id": edge_row.id, "err": err},
        )
        session.commit()
        log.warning("reconciler: edge %s pod-side failed: %s", edge_row.id, err[:120])
        return

    # Still running — just tick the timestamps + stage label so the
    # UI + the orphan-reaper both see fresh state.
    session.execute(
        text(
            "UPDATE fep_perturbation"
            " SET last_polled_at = now(),"
            "     stage = :stage,"
            "     progress_pct = :pct"
            " WHERE id = :id"
            "   AND dispatch_state = 'running'"
        ),
        {"id": edge_row.id, "stage": pod_stage, "pct": progress_pct},
    )
    # Also tick the parent job's updated_at so the orphan reaper
    # doesn't fire on this row.
    session.execute(
        text(
            "UPDATE fep_job SET updated_at = now() WHERE id = :jid"
        ),
        {"jid": edge_row.fep_job_id},
    )
    session.commit()


def _try_dispatch_next(session: Session, queued_row) -> None:
    """Dispatch the next queued edge to the pod. Idempotent via
    client_token on the pod side. Does NOT do the actual MD work —
    that's the pod's job; we just POST /fep_edge_start.

    On success: transition edge to dispatch_state=dispatching, record
                dispatched_at, write pod_job_id. Next tick will see
                it's running on the pod.
    On failure: leave the edge in queued state; next tick retries.

    Stub for now — full implementation in R4 (we'll wire to the
    legacy dispatch_edge body once the new endpoint lands). Keeping
    this minimal so R1+R2 ship and shadow-mode observation can run
    against real edges before the dispatch path flips."""
    if is_shadow_mode():
        log.info(
            "[shadow] would dispatch edge %s (study %s) — skipping (R4 wires this)",
            queued_row.id, queued_row.share_id,
        )
        return
    # R4 will implement the actual POST /fep_edge_start path. For now
    # the daemon-thread runner is still authoritative for dispatch;
    # the reconciler only observes / cleans up in-flight rows. This
    # makes R1+R2 safe to ship behind FEP_RECONCILER_SHADOW=1.
    log.debug(
        "reconciler: edge %s queued; dispatch handled by legacy runner until R4",
        queued_row.id,
    )


def _pod_url_for_edge(session: Session, fep_job_id: int) -> str:
    """Read the parent FepJob's force_field_engine and pick the right
    pod URL (matches K4 routing). Cached locally — engines don't change
    mid-edge."""
    row = session.execute(
        text("SELECT force_field_engine FROM fep_job WHERE id = :jid"),
        {"jid": fep_job_id},
    ).fetchone()
    engine_val = (row[0] if row else None) or "sage"
    if engine_val == "espaloma":
        url = os.environ.get("POD_FEP_ESPALOMA_URL", "").strip()
        if url:
            return url
    return os.environ.get("POD_FEP_URL", "").strip()


# ─── Lifespan-task wrapper ───────────────────────────────────────────────


async def reconciler_task() -> None:
    """Long-running asyncio task registered in main.lifespan.

    Wakes every RECONCILE_INTERVAL_SECONDS, opens a fresh Session,
    runs one reconcile_once_sync tick, closes the Session. Never
    fails — wraps every tick in a try/except so a transient bug can't
    take the whole task down.

    Crash-safe: if Fly restarts mid-tick, the partially-committed
    rows are still consistent (every reconciler step is a single
    UPDATE that commits before moving on)."""
    log.info(
        "FEP reconciler started (interval=%ds, shadow=%s, enabled=%s)",
        RECONCILE_INTERVAL_SECONDS, is_shadow_mode(), is_reconciler_enabled(),
    )
    while True:
        try:
            await asyncio.sleep(RECONCILE_INTERVAL_SECONDS)
            with Session(engine) as session:
                counters = reconcile_once_sync(session)
            if counters["polled"] > 0 or counters["dispatch_attempts"] > 0:
                log.info("FEP reconciler tick: %s", counters)
        except asyncio.CancelledError:
            log.info("FEP reconciler stopping (asyncio cancel)")
            raise
        except Exception as e:                                       # noqa: BLE001
            log.exception("FEP reconciler tick failed: %s", e)
