# Celery + Redis dispatch — migration plan

**Status:** scoping (2026-04-30)
**Driver task:** #168 — wire Celery + Redis for job dispatch

---

## Why now

We hit transient HTTP 500s during the validation runs that the script
had to retry through. Diagnosis: the FastAPI app on Fly does job
execution in `BackgroundTasks` (in-process), and when the pod is busy
the in-process executor blocks the main event loop long enough that
some incoming HTTP requests time out. The `_poll()` retry-with-backoff
we added to the validation script papers over the symptom; the root
cause is that we don't have a proper job queue.

This was tolerable when Liganx was three users running a few jobs. It
is not tolerable on the trajectory we want — a public marketing surface
that hits `/jobs` from validation cron, /library re-runs, automated
tests, and real users at the same time.

The fix is the textbook one: pull job execution out of the FastAPI
process into a dedicated Celery worker pool, with Redis as the broker.

---

## What stays / what moves

### Stays in FastAPI

- `POST /jobs` — accept the request, validate, persist a job row in
  Postgres in `pending` state, return the job ID. **Returns
  immediately**, no work done in-process.
- `GET /jobs/{id}` — read the job row + cells from Postgres and
  return. Stays a database read; nothing else.
- `DELETE /jobs/{id}` — delete the row. Already trivial.
- Auth, free-tier caps, profile endpoints — unchanged.

### Moves to Celery worker

Everything currently inside `runner.run_job()`:
- Receptor prep (PDBFixer / cleaning / cache lookup).
- Mutant build (PDBFixer applyMutations + optional OpenMM
  minimisation).
- Pod dispatch (existing `dock_one_pod` / `dock_batch_pod`).
- Per-cell post-processing (PoseBusters, ProLIF, strain, ADMET).
- Cell state updates (which currently write directly to Postgres
  from inside the request handler).

Celery task signature:
```python
@celery_app.task(bind=True, name="liganx.run_job")
def run_job_task(self, job_id: str) -> None:
    runner.run_job(job_id)  # existing runner, unchanged
```

Re-using the existing `runner.run_job()` keeps the migration small —
all the per-cell state-machine logic doesn't change, it just runs in
a different process.

---

## Infra plan

### Redis on Fly

Two options:

**A. Fly Managed Redis (Upstash).** `fly redis create`. ~$0/month for
small workloads. Managed; no ops. **Pick this for v1.**

**B. Self-hosted Redis on a Fly volume.** Cheaper at scale; more ops.
Revisit if Upstash ever bills > $50/mo (it won't at our load).

### Celery worker container

Add a second Fly app: `liganx-worker`. Same Docker image as the API
(reuses all the runner code), different command — `celery -A
deltadock.celery_app worker --concurrency 2 --loglevel info`.

Concurrency 2 because each job spawns a pod request that takes 1-5
minutes; two concurrent jobs per worker keeps the worker busy without
overloading downstream pods. Scale by adding more worker replicas
(`fly scale count 2 -a liganx-worker`), not by raising concurrency.

### Free-tier rate limiting

Currently rate-limits live in the API process and check Postgres before
queueing. Stays the same — the API process counts pending+running jobs
for the user before enqueueing the Celery task. Simple, no race
conditions worth worrying about at our scale.

---

## Migration sequencing

The existing in-process executor needs to keep working while the
Celery path comes online — we can't have a flag day where every
in-flight job dies.

### Step 1: feature flag the dispatch (1 session)

Wrap `runner.run_job()` invocation in a feature flag:

```python
if settings.USE_CELERY_DISPATCH:
    run_job_task.delay(job_id)
else:
    background_tasks.add_task(runner.run_job, job_id)
```

Default flag off. Existing flow preserved. Ship + verify nothing breaks.

### Step 2: stand up Celery + Redis (1 session)

- `fly redis create` for the broker.
- New Fly app for the worker.
- Local docker-compose Redis for dev.
- Wire `celery_app.py` with the broker URL.
- Worker boots, can ping Redis, can pick up tasks.
- E2E test: flip the feature flag locally, submit a job, watch it
  flow through the worker.

### Step 3: flip the flag in prod (1 session)

- Set `USE_CELERY_DISPATCH=true` on the API app's secrets.
- Monitor for an hour. Submit test jobs from each engine type
  (Vina, GNINA, eventually Boltz-2).
- If any failure mode shows up, flip back — code paths are still
  available.

### Step 4: clean up (after a stable week)

- Remove the feature flag and the in-process path.
- Document Celery worker as a required deploy target alongside the
  API and DB.

---

## What this fixes

- **No more HTTP 500s under load.** API returns immediately on submit;
  the heavy work is on the worker.
- **Horizontal scaling.** Add worker replicas to handle more concurrent
  jobs without touching the API.
- **Visibility.** `flower` (Celery's web dashboard) gives us queue
  depth, task latency, error rate. We've been blind to this.
- **Retry semantics.** Celery's `autoretry_for` handles transient pod
  failures cleanly. Existing in-process retries are bespoke.

## What this does NOT fix

- Pod GPU shortages. If RunPod is busy / cold, Boltz-2 / Vina jobs
  still wait. Celery just means the API isn't blocked while they wait.
- Job result storage. Cell state still lives in Postgres. R2 still
  stores poses. Unchanged.
- Free-tier abuse. A user can still hit their daily cap. The cap
  enforcement just moves from "before in-process executor" to "before
  Celery enqueue" — same place, conceptually.

---

## Risks

1. **Celery + Postgres state-machine consistency.** If the worker
   crashes mid-job, the cell rows are left in an intermediate state.
   Mitigation: the existing runner already has cooperative-cancel
   logic + a `running → failed` transition on exception; Celery's
   default acknowledge-late + visibility timeout gives us at-least-
   once delivery. Worst case: a crashed task gets retried and we
   re-do work. That's fine for our jobs (idempotent inputs).

2. **Redis availability.** If Redis goes down, no new jobs can be
   queued. API endpoint should return a 503 with "Submission queue
   temporarily unavailable, please retry" rather than a 500. Cheap
   to add.

3. **Cost.** Two Fly apps instead of one. $0–10/mo extra at our scale.
   Negligible.

---

## Deferred items

- **Priority queues.** All jobs are FIFO for now. If we ever want
  paying users to jump the queue, Celery has `priority` queue
  support; trivial extension later.
- **Scheduled jobs.** The validation refresh workflow currently runs
  via GitHub Actions. Could move to a Celery beat scheduler later
  if we want it on the API side.
- **Distributed tracing.** Adding OpenTelemetry across API + worker
  + pod is a separate project.
