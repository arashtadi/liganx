# FEP Reconciler — Architecture Design (Phase P)

**Status:** approved 2026-05-18 · author: Liganx FEP team
**Replaces:** the daemon-thread runner pattern in `services/fep_runner.py` (M18/M20 era)
**Companion docs:** `fep_plus_design.md` (chemistry), `fep_plus_phase_b_audit.md` (sampling protocol)

## 0. Why this exists

Between 2026-05-16 and 2026-05-18, four FEP studies (FEP #18, #19, #20, smoke #3 leftover orphans) failed for variations of the same root cause: **the only place in-flight FEP state existed was a Python daemon thread on a single Fly machine**, and that thread was killed by Fly redeploys, OOM, or natural machine cycling. The pod kept computing for hours past each death, burning GPU on results no one collected — ~$15-20 wasted in the three-day window.

Patches we shipped along the way (N3, N4.0a/b, N5.2b, N6.1, N6.2) each fix one specific death mode but leave the underlying architecture untouched. A real production-grade design has to satisfy two non-negotiables:

1. **No in-RAM state owns the lifecycle of a multi-hour edge.** Any process must be killable at any moment without losing work.
2. **Docking is hands-off.** This redesign touches only FEP code paths. The docking runner, pod, routes, and frontend stay bit-for-bit unchanged.

## 1. The new architecture in one diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  Postgres (Fly) — the ONLY source of truth                       │
│    fep_job, fep_node, fep_perturbation, fep_edge_telemetry       │
└────────────┬───────────────────┬─────────────────────────────────┘
             │                   │
             │ writes/reads      │ writes/reads
             │                   │
┌────────────▼─────────┐   ┌─────▼──────────────────────────────────┐
│ FastAPI (Fly)        │   │ Reconciler (Fly asyncio task)          │
│ stateless HTTP       │   │ wakes every 60s                        │
│ create FepJob+edges  │   │ for each edge in dispatching/running:  │
│ no thread spawned    │   │   poll pod, update DB                  │
└──────────────────────┘   │ for each edge in queued:               │
                           │   call /fep/_dispatch_next             │
                           │ no in-RAM state                        │
                           └─────────┬──────────────────────────────┘
                                     │ HTTP poll only
                                     │
                           ┌─────────▼──────────────────────────────┐
                           │ Pod (RunPod)                           │
                           │   fep_server.py   ← supervisord-managed │
                           │   workers (openmm) ← spawned per edge   │
                           │   self-cancels if backend silent 30 min │
                           │   checkpoint files for own-side resume  │
                           └────────────────────────────────────────┘
```

The reconciler is **stateless**. Killing it is a no-op for correctness — the next tick (within 60s) picks up exactly where the last one left off because every transition was committed to Postgres atomically. This is the property we have never had.

## 2. The edge state machine

Every `fep_perturbation` row has a `dispatch_state` column (new in migration 024). Allowed transitions:

```
            ┌─────────────────────────────────────────────────────────────┐
            │                                                             │
            ▼                                                             │
       ┌─────────┐         ┌──────────────┐     ┌─────────┐               │
   ────│ queued  │────────▶│ dispatching  │────▶│ running │               │
       └─────────┘         └──────────────┘     └────┬────┘               │
            │                       │                │                    │
            │                       │ pod 4xx        │ pod returns done   │
            │                       ▼                ▼                    │
            │                  ┌────────────┐   ┌─────────────┐           │
            │                  │   failed   │   │ aggregating │           │
            │                  └────────────┘   └─────┬───────┘           │
            │                                         │                   │
            │ user cancel / budget cap                │                   │
            ▼                                         ▼                   │
       ┌───────────┐                              ┌──────┐                │
       │ cancelled │                              │ done │                │
       └───────────┘                              └──────┘                │
                                                                          │
            ▲                                                             │
            │ retry (idempotent re-dispatch)                              │
            └─────────────────────────────────────────────────────────────┘
```

| state | meaning | who can transition out |
|---|---|---|
| `queued` | edge has been planned but not yet sent to pod | reconciler (→ dispatching) or user (→ cancelled) |
| `dispatching` | POST `/fep_edge_start` is in flight | reconciler (→ running on success, → failed on 4xx, → queued on transient HTTP error for retry) |
| `running` | pod has the job, MD in progress | reconciler (→ aggregating when pod reports done, → failed if pod returns error, → cancelled if user/budget) |
| `aggregating` | edge complete on pod, results being persisted to DB | reconciler (→ done after the row is finalised) |
| `done` | terminal — results live in `ddg_binding_kcal_mol` etc. | none (terminal) |
| `failed` | terminal — `error_message` populated | reconciler can re-queue manually via admin endpoint |
| `cancelled` | terminal — user or budget-cap | none (terminal) |

**Invariants the reconciler enforces:**

1. `pod_job_id` is NULL iff `dispatch_state IN ('queued', 'cancelled')`. Any other state requires a real `pod_job_id`. This fixes the FEP #19 bug where pod_job_id stayed NULL despite the edge being live.
2. `dispatched_at` is set iff `dispatch_state` has ever been `dispatching` or beyond. Used to compute per-edge GPU spend (S3).
3. `last_polled_at` is updated on every reconciler tick that successfully polls the pod. Used by S2 (stale-pod detection).
4. Terminal states never transition. Idempotency at the DB level — every UPDATE filters by current state.

## 3. The dispatch contract (idempotency rules)

The pod's `/fep_edge_start` is **idempotent** with respect to the backend's `fep_perturbation.id`. The backend passes a `client_token = fep_perturbation.id` in the POST body. If the pod already has a job for that token, it returns the existing `job_id` instead of starting a new one.

Why this matters: if the reconciler crashes mid-`/fep_edge_start` and a second reconciler tick fires before the first request times out, both calls reach the pod. Without idempotency, the pod spawns two MD workers and we double-charge. With idempotency, the second call returns the first call's `job_id`, and the second worker is never spawned.

Implementation (pod side, fep_server.py change):

```python
# Pseudo, see Q2 commit
_token_to_job_id: dict[str, str] = {}  # persisted to /workspace/fep_jobs/_tokens.json

@app.post("/fep_edge_start")
def start(req: FepEdgeRequest):
    if req.client_token and req.client_token in _token_to_job_id:
        return {"job_id": _token_to_job_id[req.client_token], "ok": True, "idempotent": True}
    new_job_id = _generate_uuid_hex()
    _token_to_job_id[req.client_token] = new_job_id
    _persist_token_map()
    # ... existing worker spawn ...
```

The backend supplies `client_token = str(perturbation.id)`. Same edge, same token, every retry returns the same job_id.

## 4. The poll contract

`GET /fep_edge_status/{job_id}` is deterministic across pod restarts because the pod persists job state to disk (`/workspace/fep_jobs/{job_id}.json`). On pod restart (supervisord brings fep_server back), the in-flight job:

1. If MD process is still running (Q4 OpenMM checkpoints): pod attaches to the existing process and reports the latest stage.
2. If MD process died: pod marks the job `failed` with `error="pod_restart_lost_worker"`.

**The backend never sees a job_id come back as "unknown".** Either the job's state is on disk, or pod returns 404 with a clear error — in which case the reconciler transitions the edge to `failed`.

## 5. The cancellation contract

Three cancellation paths:

1. **User-initiated**: user clicks "Cancel study" in UI → backend writes `dispatch_state=cancelled` to all non-terminal edges → reconciler picks this up next tick → calls pod `/fep_edge_cancel/{job_id}` for each → pod stops MD process, writes `status=cancelled` to JSON.
2. **Budget-cap**: reconciler tracks accumulated `elapsed_seconds * hourly_rate` per study; if it exceeds `FEP_MAX_USD_PER_STUDY`, sets all queued edges to `cancelled` and the current `running` edge keeps going until it naturally finishes (one edge is in-flight cost is recoverable, two is borderline).
3. **Stale-pod**: reconciler can't reach pod for 1 hour → all `dispatching`/`running` edges → `failed` with `error="pod_unreachable_60min"`. The pod-side auto-cancel (Q2, 30 min) is the inner safety net; this is the outer one.

The pod **commits to stopping the MD process** within 60s of receiving a cancel. No more orphans.

## 6. Scope — what changes, what doesn't

**Files that get modified:**

| file | change |
|---|---|
| `backend/migrations/024_fep_dispatch_state.sql` | NEW — add columns to fep_perturbation |
| `backend/src/deltadock/models.py` | Add `dispatch_state` enum + columns to FepPerturbation. FepJob untouched. **Job table untouched.** |
| `backend/src/deltadock/services/fep_reconciler.py` | NEW — the reconciler loop |
| `backend/src/deltadock/services/fep_runner.py` | Refactor: remove daemon-thread dispatch, keep `run_study` as edge-graph-builder only |
| `backend/src/deltadock/routers/fep.py` | Add `/fep/_dispatch_next` internal endpoint. Existing routes unchanged. |
| `backend/src/deltadock/main.py` | Register reconciler in lifespan alongside `_periodic_orphan_reaper`. **Docking reaper bit-for-bit identical.** |
| `runpod/dock_pod/fep_server.py` | Add idempotency token map + `/fep_edge_cancel`. **dock_server.py untouched.** |
| `runpod/dock_pod/fep_pod.py` | Add OpenMM checkpoint files (Q4) |
| `runpod/deploy/supervisord_fep.conf` | NEW — supervisord unit for fep_server (Q1) |

**Files explicitly NOT touched:**

- All docking code paths (`services/runner.py`, `services/pod_dock.py`, `services/ensemble_dock.py`, `services/quick_dock.py`, `runpod/dock_pod/dock_pod.py`, `runpod/dock_pod/dock_server.py`)
- All docking routes (`routers/jobs.py`, `routers/screenings.py`, `routers/admet.py`)
- All docking frontend pages (`pages/StudioPage.tsx`, `pages/NewJobPage.tsx`, `pages/JobResultsPage.tsx`)
- `db.py`, `config.py` (shared infrastructure, no FEP-only changes needed)
- The docking reaper `_reap_orphan_jobs` and its tests

**The docking smoke (`test_health.py`) must keep passing alongside.**

## 7. Migration strategy — no big-bang cutover

The daemon-thread runner can't disappear in one commit because there might be in-flight studies during deploy. Plan:

1. **R1**: ship migration 024 + new columns; backfill from existing `status` field. Daemon-thread runner keeps writing to `status` only. New `dispatch_state` column populated for new rows.
2. **R2**: ship reconciler in **shadow mode** — it runs every 60s, polls pods, writes to a logger, but does NOT mark anything FAILED or trigger any state transition. Watch logs for 24h to confirm it agrees with the daemon thread's view.
3. **R3**: enable reconciler-driven transitions. Daemon thread is renamed to `_legacy_daemon_runner` and disabled by default; only re-enabled via `FEP_USE_LEGACY_RUNNER=1` env for rollback safety.
4. **R4**: ship `/fep/_dispatch_next`. New submissions use reconciler-only path.
5. **R5**: tests assert resilience.
6. After one production-scale validation run completes successfully end-to-end, remove `_legacy_daemon_runner`. Until then it stays compiled-but-dormant.

This avoids the "everything breaks at once" failure mode.

## 8. What we'll know works at the end

Specific assertions the design has to pass:

1. **A `kill -9` on the Fly machine mid-`running_complex_leg` does not lose the edge.** Reconciler on the next machine starts within 30s, polls pod, sees the edge is still running, updates `last_polled_at`. Edge completes normally. (R5, T1)
2. **A `git push` to backend during an active 12-edge study does not kill any edge.** Same mechanism — daemon thread no longer owns state, only the in-flight HTTP request to `/fep_edge_status` dies. The next reconciler tick re-polls. (T1)
3. **A pod-side fep_server crash auto-restarts and the in-flight edge resumes from checkpoint.** (Q1+Q4)
4. **A genuinely-dead pod (network partition, pod stopped) gets each in-flight study marked FAILED within 1h with a real error message.** (S2)
5. **A run-away study can't burn more than `FEP_MAX_USD_PER_STUDY` of GPU** — at the limit, all queued edges flip to cancelled. (S1)
6. **A multi-day 30-edge cycle study survives at least one simulated Fly redeploy and at least one simulated pod-side restart without losing progress.** (T3, the gating test before any real-physics run.)

Once all six hold in CI, we run a single real-physics validation: a 3-edge KRAS Q61H cycle with two deliberate `flyctl machine restart` calls midway. If that produces a real `cycle_closure_rmsd` number, we ship.

## 9. Open questions resolved (so they're not relitigated mid-implementation)

- **Q: should the reconciler run on Fly or on a separate Celery worker?**
  A: Fly. One fewer moving piece. Reconciler is async-task in the FastAPI lifespan, same place as `_periodic_orphan_reaper` already runs.

- **Q: should the daemon-thread runner be deleted in the first commit?**
  A: No. Keep it dormant for one production-scale validation cycle before removal (see §7).

- **Q: should we batch edges across studies in one dispatch loop?**
  A: Not yet. Per-study reconciler scope keeps the SQL simpler and the failure isolation cleaner. Cross-study batching is a future optimisation (S4-future).

- **Q: do we need a Redis queue?**
  A: No. Postgres `SELECT FOR UPDATE SKIP LOCKED` on `dispatch_state='queued'` gives us a perfectly good work queue with one less dependency.

- **Q: what's the polling cadence — 30s, 60s, more?**
  A: 60s. Pod-side has its own internal heartbeat that ticks the job state every poll; backend just needs to be frequent enough that `last_polled_at` stays fresh relative to the 14h reaper cap. 60s gives 840 polls per max-duration edge — plenty.

## 10. Approval

This design is approved as of 2026-05-18 with the docking-isolation guarantee documented in §6. Phase R implementation starts immediately.
