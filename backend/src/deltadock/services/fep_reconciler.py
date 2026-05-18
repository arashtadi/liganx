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

# (S2) If the pod hasn't been reachable for this long, mark every
# in-flight edge in this reconciler's worldview as FAILED with a
# real error message. 1 h matches the design doc §5 cancellation
# contract. The pod-side auto-cancel (Q2) is 30 min — strictly tighter,
# so the pod gives up before we do, freeing GPU.
POD_UNREACHABLE_FAIL_AFTER_SECONDS = 60 * 60

# (S1) Per-study GPU budget cap. When the SUM of actual elapsed_seconds
# × pod_hourly_usd across a study's done+running edges exceeds this,
# the reconciler refuses to dispatch new edges from that study (the
# currently-running edge keeps going to its natural completion; one
# edge is recoverable cost, two is borderline). Default $250; raise
# via FEP_MAX_USD_PER_STUDY env on Fly. This is a SECOND layer beyond
# the pre-flight estimate cap (I3) — covers the case where actual
# runtime diverges from estimate.
DEFAULT_MAX_USD_PER_STUDY = 250.0
DEFAULT_POD_HOURLY_USD = 0.69                # RTX 4090 spot on RunPod


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


# (N9) Edges that were cancelled (by user click or budget cap) but
# still have a live pod_job_id — the pod doesn't know to stop yet.
# Throttled to one cancel-send per edge per 5 minutes (the pod's
# /fep_edge_cancel is idempotent so retries are safe, but flooding is
# rude). last_polled_at acts as the throttle clock — bumped after
# each send.
_PENDING_CANCEL_EDGES_SQL = text(
    """
    SELECT id, fep_job_id, pod_job_id
      FROM fep_perturbation
     WHERE dispatch_state = 'cancelled'
       AND pod_job_id   IS NOT NULL
       AND (last_polled_at IS NULL
            OR last_polled_at < now() - interval '5 minutes')
     LIMIT 50
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

    # ── Step 3: (S2) stale-pod sweep ──────────────────────────────
    # Mark in-flight edges as FAILED if last_polled_at is older than
    # POD_UNREACHABLE_FAIL_AFTER_SECONDS (1 h). This is the outer
    # safety net — the pod-side Q2 orphan-cancel (30 min) should have
    # cleaned up first, but if the pod itself is unreachable we won't
    # know from polling alone. The cap unsticks the row so the user
    # sees a definitive failure rather than an eternally-running edge.
    if not is_shadow_mode():
        try:
            counters["stale_failed"] = _sweep_stale_pod(session)
        except Exception as e:                                       # noqa: BLE001
            counters["errors"] += 1
            log.exception("reconciler: stale-pod sweep failed: %s", e)

    # ── Step 4: (N9) propagate user cancellations to the pod ──────
    # cancel_fep_study (in fep_runner.py) marks edges with
    # dispatch_state='cancelled' but does not call the pod — that's
    # this step's job. We POST /fep_edge_cancel/{pod_job_id} for each
    # cancelled edge that still has a live pod_job_id. The pod endpoint
    # is idempotent so retries are safe; we throttle to once per 5
    # minutes per edge via the _PENDING_CANCEL_EDGES_SQL WHERE clause.
    if not is_shadow_mode():
        try:
            counters["cancels_sent"] = _propagate_cancellations(session)
        except Exception as e:                                       # noqa: BLE001
            counters["errors"] += 1
            log.exception("reconciler: cancel propagation failed: %s", e)

    return counters


def _propagate_cancellations(session: Session) -> int:
    """(N9) For each cancelled edge with a live pod_job_id, POST
    /fep_edge_cancel/{pod_job_id} to the pod so the MD process stops.

    Throttled per-edge by _PENDING_CANCEL_EDGES_SQL (max once / 5 min).
    Idempotent — calling /fep_edge_cancel on an already-cancelled or
    already-done job is a no-op on the pod side. We bump last_polled_at
    even on transport failures so we don't hammer an unreachable pod.

    Returns the number of successful cancel-sends (HTTP 2xx).
    """
    rows = list(session.execute(_PENDING_CANCEL_EDGES_SQL).fetchall())
    if not rows:
        return 0
    sent = 0
    for row in rows:
        pod_url = _pod_url_for_edge(session, row.fep_job_id)
        if not pod_url:
            log.warning(
                "reconciler: edge %s cancelled with pod_job_id=%s but no pod URL "
                "configured — cannot propagate cancel",
                row.id, row.pod_job_id,
            )
            # Still bump throttle so we don't spam this log line every
            # tick. The edge stays cancelled in DB — pod will eventually
            # self-cancel via Q2 orphan after 30 min of no polls.
            session.execute(
                text("UPDATE fep_perturbation SET last_polled_at = now() WHERE id = :id"),
                {"id": row.id},
            )
            continue

        url = pod_url.rstrip("/") + f"/fep_edge_cancel/{row.pod_job_id}"
        ok = False
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(url, headers=pod_auth_headers())
            if resp.is_success:
                ok = True
                log.info(
                    "reconciler: /fep_edge_cancel sent for edge %s (pod_job_id=%s) — %s",
                    row.id, row.pod_job_id, (resp.json() if resp.text else {}),
                )
            else:
                log.warning(
                    "reconciler: /fep_edge_cancel HTTP %d for edge %s (pod_job_id=%s): %s",
                    resp.status_code, row.id, row.pod_job_id, resp.text[:200],
                )
        except (httpx.TimeoutException, httpx.RequestError) as e:
            log.warning(
                "reconciler: /fep_edge_cancel transport error for edge %s: %s",
                row.id, e,
            )

        # Bump last_polled_at regardless — the throttle is what stops
        # this loop from re-spamming the same edge every 60s.
        session.execute(
            text("UPDATE fep_perturbation SET last_polled_at = now() WHERE id = :id"),
            {"id": row.id},
        )
        if ok:
            sent += 1
    session.commit()
    return sent


def _check_and_finalize_study(session: Session, fep_job_id: int) -> None:
    """(N8) After any edge transitions to a terminal state, check if
    the parent study is fully done. If so, run the end-of-study
    aggregation that the legacy daemon-thread runner used to do:

      1. Per-node ΔΔG via shortest-path from hit (aggregate_node_ddg)
      2. Study-level cycle_closure_rmsd
      3. FepJob.status → COMPLETED or FAILED depending on edge outcomes
      4. Telegram alert on failure (M10)

    Idempotent — safe to call multiple times. The terminal-state check
    in the WHERE clause prevents double-finalization.

    Called from _reconcile_one_edge whenever an edge transitions to
    done/failed. NOT called for cancelled edges (those flow through
    the user-cancel path which has its own finalisation).
    """
    from ..models import FepJob, FepJobStatus, FepNode, FepPerturbation
    from sqlmodel import select as _select

    # Load all edges + their dispatch states. We need this to decide
    # if the study is fully done.
    edges = list(session.exec(
        _select(FepPerturbation).where(FepPerturbation.fep_job_id == fep_job_id)
    ).all())
    if not edges:
        return

    terminal_states = {"done", "failed", "cancelled"}
    non_terminal = [e for e in edges if (e.dispatch_state or "queued") not in terminal_states]
    if non_terminal:
        # Study still has work to do — let the next reconciler tick
        # pick up the remaining edges.
        return

    # All edges terminal — fetch the job (with SELECT FOR UPDATE) to
    # avoid two reconciler ticks racing on the same finalisation.
    job = session.get(FepJob, fep_job_id)
    if not job:
        return
    if job.status not in (
        FepJobStatus.PENDING,
        FepJobStatus.PREPARING,
        FepJobStatus.RUNNING,
    ):
        # Already terminal — nothing to do. Idempotent.
        return

    # Aggregate per-node ΔΔG + cycle closure RMSD using the legacy
    # helpers — no duplication, single source of truth for the chemistry.
    try:
        from .fep_runner import aggregate_node_ddg, compute_cycle_closure_rmsd
        nodes = list(session.exec(
            _select(FepNode).where(FepNode.fep_job_id == fep_job_id)
        ).all())
        aggregate_node_ddg(nodes, edges)
        for n in nodes:
            session.add(n)
        try:
            job.cycle_closure_rmsd = compute_cycle_closure_rmsd(nodes, edges)
        except Exception:                                            # noqa: BLE001
            job.cycle_closure_rmsd = None
    except Exception as e:                                           # noqa: BLE001
        log.exception("reconciler: end-of-study aggregation failed for FepJob %s: %s", fep_job_id, e)
        job.cycle_closure_rmsd = None

    # Decide final status. Mirror the legacy run_study logic at
    # fep_runner.py:1030-1041 (one source of truth: same convergence
    # rules apply whichever runner finalised the study).
    n_ok = sum(1 for e in edges if e.dispatch_state == "done" and e.status == "ok")
    n_total = len(edges)
    if n_ok == n_total:
        job.status = FepJobStatus.COMPLETED
    elif n_ok > 0:
        job.status = FepJobStatus.COMPLETED
        job.error_message = f"Partial: {n_ok}/{n_total} edges converged."
    else:
        job.status = FepJobStatus.FAILED
        job.error_message = "All edges failed; check per-edge pod_log_tail for details."
    job.stage = None
    job.updated_at = datetime.utcnow()
    session.add(job)
    session.commit()
    log.info(
        "reconciler: finalised FepJob %s — status=%s n_ok=%d/%d cycle_closure_rmsd=%s",
        fep_job_id, job.status, n_ok, n_total, job.cycle_closure_rmsd,
    )

    # (M10) Telegram alert on failure. Fire-and-forget — never let an
    # alert failure block the finaliser path.
    if job.status == FepJobStatus.FAILED:
        try:
            from .notifications import notify_fep_failed
            from ..models import Compound, User
            user_row = session.get(User, job.user_id) if job.user_id else None
            hit_row = session.get(Compound, job.hit_compound_id) if job.hit_compound_id else None
            # Pull the first failed edge's tail as the actionable error.
            tail_err = "All edges failed."
            tail_kind = "runtime"
            for e in edges:
                if e.dispatch_state == "failed" and e.pod_log_tail:
                    plt = e.pod_log_tail
                    if plt.startswith("[") and "] " in plt:
                        bracket_end = plt.index("] ")
                        tail_kind = plt[1:bracket_end]
                        tail_err = plt[bracket_end + 2:]
                    else:
                        tail_err = plt
                    break
            notify_fep_failed(
                fep_job_id=job.id or -1,
                share_id=job.share_id,
                pdb_id=job.pdb_id,
                variant=job.variant,
                user_email=(user_row.email if user_row else None),
                user_id=job.user_id,
                hit_name=(hit_row.name if hit_row else None),
                n_analogs=max(0, n_total - 1),
                edges_completed=n_ok,
                edges_total=n_total,
                error_message=tail_err[:600],
                error_kind=tail_kind,
                cost_usd_so_far=job.estimated_usd_cost,
            )
        except Exception as ne:                                      # noqa: BLE001
            log.warning("reconciler: Telegram alert failed for FepJob %s: %s", fep_job_id, ne)


def _sweep_stale_pod(session: Session) -> int:
    """(S2) Mark edges as failed when last_polled_at is too stale.

    Returns the number of edges transitioned. A non-zero return is
    usually a red flag (pod genuinely down for an hour) — operator
    should investigate."""
    result = session.execute(
        text(
            "UPDATE fep_perturbation"
            " SET dispatch_state = 'failed',"
            "     status = 'failed',"
            "     pod_log_tail = :msg,"
            "     completed_at = now()"
            " WHERE dispatch_state IN ('dispatching', 'running')"
            "   AND last_polled_at IS NOT NULL"
            "   AND last_polled_at < now() - make_interval(secs => :secs)"
            " RETURNING id, fep_job_id"
        ),
        {
            "msg": (
                f"Pod unreachable for >{POD_UNREACHABLE_FAIL_AFTER_SECONDS//60} min — "
                "reconciler marked edge failed. Check pod /health + supervisord status."
            ),
            "secs": POD_UNREACHABLE_FAIL_AFTER_SECONDS,
        },
    )
    rows = list(result)
    if rows:
        # Also mark the parent FepJob FAILED so the UI banner fires.
        job_ids = list({r[1] for r in rows})
        for jid in job_ids:
            session.execute(
                text(
                    "UPDATE fep_job"
                    " SET status = 'FAILED',"
                    "     error_message = COALESCE(error_message, :msg),"
                    "     updated_at = now()"
                    " WHERE id = :jid AND status IN ('PENDING','PREPARING','RUNNING')"
                ),
                {
                    "jid": jid,
                    "msg": (
                        f"GPU pod unreachable for >{POD_UNREACHABLE_FAIL_AFTER_SECONDS//60} min. "
                        "Study failed. Operator should check pod status; re-submit "
                        "once the pod is back online."
                    ),
                },
            )
        session.commit()
        log.warning("reconciler: stale-pod sweep marked %d edges failed", len(rows))
    return len(rows)


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

    # Stale-dispatching revert. This check happens BEFORE the pod_url
    # check because reverting state to 'queued' doesn't need a pod —
    # it's a pure DB cleanup. State=dispatching with no pod_job_id
    # means either an in-flight dispatch RPC or a stalled one. If
    # stalled (older than DISPATCH_STALE_AFTER_SECONDS), revert to
    # queued so the next dispatch attempt retries. Idempotency on the
    # pod side (client_token) ensures this never spawns two workers.
    if not edge_row.pod_job_id:
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

    pod_url = _pod_url_for_edge(session, edge_row.fep_job_id)
    if not pod_url:
        # No pod URL configured — caller is responsible for marking
        # the study FAILED. We don't do it here because that's the
        # daemon-thread runner's job during the rollout window.
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
        # (R4) Edge completed on the pod. Read the result payload,
        # persist ddg_* fields, and transition to terminal done state.
        # This is the part that previously lived in the daemon-thread
        # runner; the reconciler now owns it.
        result = payload.get("result") or {}
        if result.get("ok"):
            session.execute(
                text(
                    "UPDATE fep_perturbation"
                    " SET dispatch_state = 'done',"
                    "     status = 'ok',"
                    "     last_polled_at = now(),"
                    "     stage = 'done',"
                    "     progress_pct = 100,"
                    "     completed_at = now(),"
                    "     ddg_complex_kcal_mol  = :ddg_complex,"
                    "     ddg_solvent_kcal_mol  = :ddg_solvent,"
                    "     ddg_binding_kcal_mol  = :ddg_bind,"
                    "     ddg_uncertainty       = :ddg_unc,"
                    "     hysteresis_kcal_mol   = :hysteresis,"
                    "     mbar_diagnostics_json = :mbar"
                    " WHERE id = :id"
                    "   AND dispatch_state = 'running'"
                ),
                {
                    "id": edge_row.id,
                    "ddg_complex": result.get("ddg_complex_kcal_mol"),
                    "ddg_solvent": result.get("ddg_solvent_kcal_mol"),
                    "ddg_bind": result.get("ddg_binding_kcal_mol"),
                    "ddg_unc": result.get("ddg_uncertainty"),
                    "hysteresis": result.get("hysteresis_kcal_mol"),
                    "mbar": result.get("mbar_diagnostics_json"),
                },
            )
            session.commit()
            log.info(
                "reconciler: edge %s done; ddg_binding=%s kcal/mol",
                edge_row.id, result.get("ddg_binding_kcal_mol"),
            )
            # (N8) Now that this edge is terminal, check if the parent
            # study is fully done — if so, run end-of-study aggregation.
            _check_and_finalize_study(session, edge_row.fep_job_id)
        else:
            # Pod returned ok=False even though status=done. Edge
            # failed at the pod's analysis step. Mark failed with the
            # error message the pod included.
            kind = result.get("kind", "runtime")
            err = (result.get("error") or "unknown pod-side error")[:600]
            tail = f"[{kind}] {err}"
            session.execute(
                text(
                    "UPDATE fep_perturbation"
                    " SET dispatch_state = 'failed',"
                    "     status = 'failed',"
                    "     last_polled_at = now(),"
                    "     completed_at = now(),"
                    "     pod_log_tail = :tail"
                    " WHERE id = :id"
                    "   AND dispatch_state = 'running'"
                ),
                {"id": edge_row.id, "tail": tail},
            )
            session.commit()
            log.warning("reconciler: edge %s pod returned done+failed: %s", edge_row.id, err[:120])
            # (N8) Same check on failure path.
            _check_and_finalize_study(session, edge_row.fep_job_id)
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
        # (N8) Edge is terminal — check if study is fully done.
        _check_and_finalize_study(session, edge_row.fep_job_id)
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
    """(R4) Dispatch the next queued edge to the pod.

    Idempotent via client_token on the pod side — same edge submitted
    twice gets the same job_id back, no double-charge. The pod's Q2
    idempotency token map persists this across pod restarts too.

    Authority gating:
      shadow mode             → log only, no mutation
      FEP_AUTHORITATIVE_RECONCILER=1 → reconciler is sole dispatcher,
                                       the legacy daemon thread in
                                       run_study skips its own dispatch
      default                 → log only (legacy runner is still
                                authoritative; reconciler only observes)

    On success: transition edge to dispatch_state=running, write
                pod_job_id, dispatched_at. Next tick polls.
    On 4xx (bad input): mark failed terminally.
    On transport failure: leave queued; next tick retries.
    """
    if is_shadow_mode():
        log.info(
            "[shadow] would dispatch edge %s (study %s) — skipping",
            queued_row.id, queued_row.share_id,
        )
        return
    if not _is_authoritative():
        # Legacy runner owns dispatch; we just observe. This is the
        # safe-rollout default — flip FEP_AUTHORITATIVE_RECONCILER=1
        # in Fly secrets to transfer authority.
        return

    # (N12) Per-study serialization. The legacy run_study() ran edges
    # sequentially — wait for edge N to finish before dispatching N+1.
    # The pod has one GPU and can't realistically run two edges in
    # parallel without thrashing. Before dispatching a new queued edge,
    # confirm this study has no edge already in (dispatching, running).
    inflight = session.execute(
        text(
            "SELECT COUNT(*) FROM fep_perturbation"
            " WHERE fep_job_id  = :jid"
            "   AND dispatch_state IN ('dispatching', 'running')"
        ),
        {"jid": queued_row.fep_job_id},
    ).scalar() or 0
    if inflight > 0:
        log.debug(
            "reconciler: study %s already has %d edge(s) in flight; "
            "deferring edge %s",
            queued_row.share_id, inflight, queued_row.id,
        )
        return

    # (S1) Budget cap check. Refuse to dispatch a NEW edge if the
    # study has already spent more than the cap. The currently-
    # running edge (if any) keeps going to natural completion — we
    # only gate NEW dispatches.
    spent_usd = _study_spent_usd(session, queued_row.fep_job_id)
    max_usd = float(os.environ.get("FEP_MAX_USD_PER_STUDY", DEFAULT_MAX_USD_PER_STUDY))
    if spent_usd >= max_usd:
        log.warning(
            "reconciler: study %s has spent $%.2f (cap=$%.2f); cancelling queued edge %s",
            queued_row.share_id, spent_usd, max_usd, queued_row.id,
        )
        session.execute(
            text(
                "UPDATE fep_perturbation"
                " SET dispatch_state = 'cancelled',"
                "     status = 'skipped',"
                "     pod_log_tail = :msg,"
                "     completed_at = now()"
                " WHERE id = :id AND dispatch_state = 'queued'"
            ),
            {
                "id": queued_row.id,
                "msg": f"budget-cap: study spent ${spent_usd:.2f} ≥ cap ${max_usd:.2f}",
            },
        )
        # Also mark the parent study as FAILED with a clear message
        # so the user sees what happened.
        session.execute(
            text(
                "UPDATE fep_job"
                " SET status = 'FAILED',"
                "     error_message = COALESCE(error_message, :msg),"
                "     updated_at = now()"
                " WHERE id = :jid AND status IN ('PENDING','PREPARING','RUNNING')"
            ),
            {
                "jid": queued_row.fep_job_id,
                "msg": (
                    f"Study auto-cancelled: GPU spend (${spent_usd:.2f}) "
                    f"exceeded the per-study cap of ${max_usd:.2f}. "
                    "Raise FEP_MAX_USD_PER_STUDY to allow more, or re-submit "
                    "with a smaller analog set."
                ),
            },
        )
        session.commit()
        return

    pod_url = _pod_url_for_edge(session, queued_row.fep_job_id)
    if not pod_url:
        log.warning(
            "reconciler: pod_url unset for FepJob %s; refusing to dispatch edge %s",
            queued_row.fep_job_id, queued_row.id,
        )
        return

    # Atomic state transition: queued → dispatching, with dispatched_at
    # set. If two reconciler ticks race, only one wins because the
    # WHERE filter requires the row to still be in 'queued' state.
    upd = session.execute(
        text(
            "UPDATE fep_perturbation"
            " SET dispatch_state = 'dispatching',"
            "     dispatched_at  = now()"
            " WHERE id = :id"
            "   AND dispatch_state = 'queued'"
            " RETURNING id"
        ),
        {"id": queued_row.id},
    ).fetchone()
    if not upd:
        # Lost the race — another tick grabbed this edge first.
        return
    session.commit()

    # Build the dispatch payload. Need to load the parent edge + its
    # node compounds to assemble receptor PDB + ligand SDFs. This
    # logic mirrors the legacy dispatch path in fep_runner.run_study
    # but stays in this file so the reconciler is self-contained.
    payload, err = _build_dispatch_payload(session, queued_row.id)
    if err:
        log.warning("reconciler: edge %s payload build failed: %s", queued_row.id, err)
        session.execute(
            text(
                "UPDATE fep_perturbation"
                " SET dispatch_state = 'failed',"
                "     status = 'failed',"
                "     pod_log_tail = :err,"
                "     completed_at = now()"
                " WHERE id = :id"
            ),
            {"id": queued_row.id, "err": f"dispatch payload build failed: {err}"[:600]},
        )
        session.commit()
        return

    # POST /fep_edge_start with idempotency token = perturbation.id.
    # Pod's Q2 token map dedupes if we accidentally call twice.
    payload["client_token"] = str(queued_row.id)
    try:
        with httpx.Client(timeout=60) as client:
            resp = client.post(
                pod_url.rstrip("/") + "/fep_edge_start",
                json=payload,
                headers=pod_auth_headers(),
            )
    except (httpx.TimeoutException, httpx.RequestError) as e:
        # Transport failure — revert to queued so the next tick retries.
        # Idempotency token guarantees we don't spawn duplicate workers
        # if the pod actually received the call before the timeout.
        log.warning("reconciler: dispatch transport error for edge %s: %s", queued_row.id, e)
        session.execute(
            text(
                "UPDATE fep_perturbation"
                " SET dispatch_state = 'queued', dispatched_at = NULL"
                " WHERE id = :id AND dispatch_state = 'dispatching'"
            ),
            {"id": queued_row.id},
        )
        session.commit()
        return

    if resp.status_code >= 400:
        # 4xx → bad request, terminal. 5xx → transient, retry.
        if 400 <= resp.status_code < 500:
            err = f"pod {resp.status_code}: {resp.text[:500]}"
            session.execute(
                text(
                    "UPDATE fep_perturbation"
                    " SET dispatch_state = 'failed',"
                    "     status = 'failed',"
                    "     pod_log_tail = :err,"
                    "     completed_at = now()"
                    " WHERE id = :id"
                ),
                {"id": queued_row.id, "err": err[:600]},
            )
            session.commit()
            log.warning("reconciler: edge %s dispatch rejected: %s", queued_row.id, err[:120])
        else:
            # 5xx — retry next tick
            session.execute(
                text(
                    "UPDATE fep_perturbation"
                    " SET dispatch_state = 'queued', dispatched_at = NULL"
                    " WHERE id = :id"
                ),
                {"id": queued_row.id},
            )
            session.commit()
        return

    try:
        start_payload = resp.json()
    except Exception:                                                # noqa: BLE001
        log.warning("reconciler: pod /fep_edge_start non-JSON for edge %s", queued_row.id)
        return

    pod_job_id = start_payload.get("job_id")
    if not pod_job_id:
        # Pod returned 200 but no job_id — treat as failure.
        session.execute(
            text(
                "UPDATE fep_perturbation"
                " SET dispatch_state = 'failed',"
                "     status = 'failed',"
                "     pod_log_tail = :err,"
                "     completed_at = now()"
                " WHERE id = :id"
            ),
            {"id": queued_row.id, "err": f"pod returned no job_id: {str(start_payload)[:400]}"},
        )
        session.commit()
        return

    # Success — pod has the job. Move to running state.
    session.execute(
        text(
            "UPDATE fep_perturbation"
            " SET dispatch_state = 'running',"
            "     status = 'running',"
            "     pod_job_id = :jid,"
            "     started_at = now(),"
            "     last_polled_at = now()"
            " WHERE id = :id"
            "   AND dispatch_state = 'dispatching'"
        ),
        {"id": queued_row.id, "jid": pod_job_id},
    )
    session.commit()
    log.info(
        "reconciler: dispatched edge %s → pod job_id=%s (study %s)",
        queued_row.id, pod_job_id, queued_row.share_id,
    )


def _is_authoritative() -> bool:
    """(R4) Master flag — when set, reconciler is sole dispatch
    authority and the legacy daemon thread skips its own dispatch.
    Default: False (legacy still owns)."""
    return os.environ.get("FEP_AUTHORITATIVE_RECONCILER", "").strip().lower() in {
        "1", "true", "yes",
    }


def _build_dispatch_payload(session: Session, perturbation_id: int) -> tuple[dict, Optional[str]]:
    """Assemble the /fep_edge_start payload from DB state.

    Returns (payload_dict, None) on success or ({}, error_message)
    on failure. All the data we need is already in Postgres:
    receptor via the FepJob's pdb_id/chain/variant + receptor_prep,
    ligand SDFs via the FepNode → Compound → smiles chain.
    """
    from sqlmodel import select as _select
    from ..models import Compound, FepJob, FepNode, FepPerturbation

    pert = session.get(FepPerturbation, perturbation_id)
    if not pert:
        return {}, "perturbation row not found"
    job = session.get(FepJob, pert.fep_job_id)
    if not job:
        return {}, "parent FepJob not found"
    node_a = session.get(FepNode, pert.node_a_id) if pert.node_a_id else None
    node_b = session.get(FepNode, pert.node_b_id) if pert.node_b_id else None
    if not node_a or not node_b:
        return {}, "node_a or node_b missing"
    cmp_a = session.get(Compound, node_a.compound_id)
    cmp_b = session.get(Compound, node_b.compound_id)
    if not cmp_a or not cmp_b:
        return {}, "compound row missing"

    # Receptor: use the same receptor_prep service the docking runner
    # uses — guarantees bit-identical receptor across docking + FEP.
    # (N7) Path isolation via _fep_cache_root() — see comment in
    # services/fep_runner.py. Without this, FEP path collides with
    # docking's /var/lib/liganx/poses/pdb/ directory.
    try:
        from .receptor_prep import prepare_receptor_for_target
        from .fep_runner import _fep_cache_root
        rprep = prepare_receptor_for_target(
            pdb_id=job.pdb_id,
            chain=job.chain or "A",
            mutation=None if job.variant == "WT" else job.variant,
            pdb_cache=_fep_cache_root() / "pdb",
            receptor_cache=_fep_cache_root() / "receptors",
        )
        receptor_pdb_text = rprep.receptor_pdb.read_text()
    except Exception as e:                                           # noqa: BLE001
        return {}, f"receptor prep failed: {type(e).__name__}: {e}"

    # SMILES → SDF via RDKit (same path as legacy fep_runner).
    def _smiles_to_sdf(smiles: str) -> Optional[str]:
        try:
            from rdkit import Chem
            from rdkit.Chem import AllChem
            mol = Chem.MolFromSmiles(smiles)
            if mol is None:
                return None
            mol = Chem.AddHs(mol)
            AllChem.EmbedMolecule(mol, randomSeed=42)
            AllChem.MMFFOptimizeMolecule(mol)
            return Chem.MolToMolBlock(mol)
        except Exception:                                            # noqa: BLE001
            return None

    sdf_a = _smiles_to_sdf(cmp_a.smiles)
    sdf_b = _smiles_to_sdf(cmp_b.smiles)
    if not sdf_a or not sdf_b:
        return {}, "SMILES → SDF embed failed"

    return {
        "receptor_pdb": receptor_pdb_text,
        "ligand_a_sdf": sdf_a,
        "ligand_b_sdf": sdf_b,
        "n_lambda_windows": job.n_lambda_windows,
        "ns_per_window": job.ns_per_window,
    }, None


def _study_spent_usd(session: Session, fep_job_id: int) -> float:
    """(S1) Compute the actual GPU spend for a study as
    SUM(elapsed_seconds × pod_hourly_usd) across all done+running edges.

    Uses started_at + completed_at for done edges; for running edges,
    uses started_at → now. Cheap to compute (single SQL aggregate).
    """
    hourly = float(os.environ.get("POD_HOURLY_USD", DEFAULT_POD_HOURLY_USD))
    row = session.execute(
        text(
            """
            SELECT COALESCE(SUM(
                EXTRACT(EPOCH FROM (COALESCE(completed_at, now()) - started_at))
            ), 0) AS total_seconds
              FROM fep_perturbation
             WHERE fep_job_id = :jid
               AND started_at IS NOT NULL
            """
        ),
        {"jid": fep_job_id},
    ).fetchone()
    total_seconds = float(row[0] or 0.0)
    return (total_seconds / 3600.0) * hourly


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
