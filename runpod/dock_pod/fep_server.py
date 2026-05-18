"""Minimal standalone FastAPI server for the FEP+ edge routes.

Endpoints:
  POST /fep_edge                 — synchronous (blocking). Kept for
                                   backward-compat with old runners.
  POST /fep_edge_start           — async (J12). Returns {job_id}
                                   immediately, spawns a thread that
                                   runs the edge and writes stage
                                   updates to
                                   /workspace/fep_jobs/{job_id}.json
  GET  /fep_edge_status/{job_id} — returns the latest status JSON;
                                   backend polls every 30s.

The async pattern avoids the 10-hour Cloudflare/RunPod proxy idle
timeout on long edges, gives the user sub-stage progress instead of
opaque silence, and lets the backend recover from a pod restart
mid-edge (the status file survives if the worker dies, the backend
sees status="failed" and moves on).


Why a separate server (not just appending to dock_server.py): the FEP
scientific stack (openfe + openmmtools + pymbar + openff-toolkit +
lomap2) is conda-only. We install it into an isolated conda env on
the pod so it doesn't pollute the system python that dock_server uses
for Vina/GNINA/Boltz-2. This fep_server.py runs from that conda env
on a separate port (default 7861); dock_server.py keeps running on
port 7860 from system python, untouched. Same machine, same GPU, but
clean Python-environment separation.

Deploy (operator):
    curl -L -o /workspace/fep_server.py \\
        https://raw.githubusercontent.com/arashtadi/liganx/main/runpod/dock_pod/fep_server.py
    curl -L -o /workspace/fep_pod.py \\
        https://raw.githubusercontent.com/arashtadi/liganx/main/runpod/dock_pod/fep_pod.py
    source /workspace/miniconda3/etc/profile.d/conda.sh
    conda activate fep
    cd /workspace && nohup uvicorn fep_server:app --host 0.0.0.0 --port 7861 \\
        > /workspace/fep_server_boot.log 2>&1 &

Shared-secret auth is honoured (same X-Pod-Secret header as the dock
server) so a leaked proxy URL is useless without the secret.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

# (J12) Per-job status files live here. Backend polls
# GET /fep_edge_status/{job_id} which just reads this file. Kept on
# the persistent network volume so the latest status survives a pod
# restart — the backend can see "this edge died" and not stall.
_JOBS_DIR = Path("/workspace/fep_jobs")
_JOBS_DIR.mkdir(parents=True, exist_ok=True)

# (Q2) Idempotency token map: client_token → job_id. Persisted to
# /workspace/fep_jobs/_tokens.json so it survives pod restarts.
# Backend (reconciler) passes client_token=fep_perturbation.id; if the
# pod already has a job for that token, return the same job_id instead
# of spawning a second worker. Prevents double-charge when a backend
# tick crashes mid-/fep_edge_start and a retry arrives.
_TOKEN_MAP_PATH = _JOBS_DIR / "_tokens.json"
_token_lock = threading.Lock()


def _load_token_map() -> dict[str, str]:
    if not _TOKEN_MAP_PATH.exists():
        return {}
    try:
        return json.loads(_TOKEN_MAP_PATH.read_text())
    except Exception:                                                # noqa: BLE001
        return {}


def _persist_token_map(m: dict[str, str]) -> None:
    """Atomic write — same tmp+rename pattern as _write_status."""
    tmp = _TOKEN_MAP_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(m, separators=(",", ":")))
    tmp.replace(_TOKEN_MAP_PATH)


# (Q2) Per-job liveness map: job_id → last_polled_at_unix. Updated on
# every /fep_edge_status read. The orphan-cancel thread checks this
# every 5 minutes and cancels MD workers that haven't been polled for
# > ORPHAN_CANCEL_AFTER_SECONDS. Stops the GPU bleed when the backend
# loses track of an edge.
_last_polled_at: dict[str, float] = {}
_poll_lock = threading.Lock()

ORPHAN_CANCEL_AFTER_SECONDS = 30 * 60     # 30 min — matches design doc §5

# (Q3) Job cancellation flags. The orphan-cancel thread (Q2) and the
# explicit /fep_edge_cancel endpoint both set this; the run_edge MD
# loop checks it via stage_callback and aborts at the next stage
# boundary. Cooperative cancellation — we don't kill -9 the worker
# thread mid-MD because that can leave the GPU in a bad state.
_cancel_flags: dict[str, threading.Event] = {}
_cancel_lock = threading.Lock()


class _CancelledError(Exception):
    """(Q3) Sentinel raised by the stage callback when the cancel
    flag is set. Caught by _run_edge_worker, converted into a clean
    status='done', stage='cancelled' final state — NOT treated as a
    crash. Subclassing Exception (not BaseException) so the openfe
    machinery's own try/excepts don't suppress it."""

# fep_pod is heavy-import-only — its imports (openff, openmm, openfe)
# happen deferred inside run_edge so this module loads even if a dep
# is missing. We import fep_pod at top to fail-fast at server start
# if the conda env is broken.
import fep_pod

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("fep_server")

app = FastAPI(title="Liganx FEP+ edge server", version="0.1")


def require_pod_secret(x_pod_secret: str = Header(default="")) -> None:
    """Same shared-secret auth as dock_server's pod routes. When
    POD_SHARED_SECRET is set on the pod and on the backend (Fly), every
    /fep_edge call must include matching X-Pod-Secret. Absent on either
    side → fails open (matches docking's safe-rollout pattern)."""
    expected = os.environ.get("POD_SHARED_SECRET", "").strip()
    if not expected:
        return                                                       # fails open
    if x_pod_secret.strip() != expected:
        raise HTTPException(status_code=401, detail="bad X-Pod-Secret")


class FepEdgeRequest(BaseModel):
    """Same shape as the request in dock_server's /fep_edge route.

    Inputs are TEXT (PDB + SDF) so the HTTP boundary is human-readable.
    Protocol knobs default to the post-audit values from
    docs/fep_plus_design.md §4 (12 windows × 7 ns/window with 2 ns
    equilibration discarded)."""
    receptor_pdb: str
    ligand_a_sdf: str
    ligand_b_sdf: str
    n_lambda_windows: int = Field(default=12, ge=4, le=24)
    ns_per_window: float = Field(default=7.0, gt=0, le=20.0)
    ns_equilibration: float = Field(default=2.0, ge=0, le=10.0)
    salt_conc_mol_per_l: float = Field(default=0.15, ge=0, le=1.0)
    temperature_k: float = Field(default=298.15, gt=0, le=500.0)
    hmr_mass_amu: float = Field(default=3.0, ge=1.0, le=5.0)
    timestep_fs: float = Field(default=4.0, gt=0, le=5.0)
    # (Q2) Idempotency token. Backend reconciler sets this to the
    # fep_perturbation row id; if the pod already has a job for the
    # same token, /fep_edge_start returns the existing job_id rather
    # than spawning a new MD worker. Prevents double-charge when a
    # backend retry races an in-flight /fep_edge_start.
    client_token: Optional[str] = None


@app.get("/health")
def health() -> dict:
    """Liveness probe. Returns immediately. The backend's
    /admin/pod-status card polls this so the operator can see whether
    the FEP server is up without firing a real edge."""
    return {
        "ok": True,
        "service": "fep_server",
        "version": "0.1",
        # Surface whether the heavy deps loaded — operator-facing
        # signal that the conda env is intact.
        "deps_ok": _deps_loaded(),
    }


@app.post("/fep_edge")
def fep_edge_endpoint(req: FepEdgeRequest, _auth: None = None) -> dict:
    """Run one alchemical edge A→B. ~8-12 GPU-hours wall on a kinase
    complex with the default 12×7 ns × 2 legs protocol. The full
    contract is documented in fep_pod.run_edge; this endpoint is a
    thin pydantic wrapper around it.

    HTTP timeout caveat: backend should set client timeout ≥ 13 hours.
    RunPod's HTTP proxy has a 10-hour idle timeout — for long edges,
    switch to async pod-side worker + result-polling pattern (Phase
    B.1)."""
    require_pod_secret()  # noqa: F811 — pydantic deps don't expose Header here
    try:
        return fep_pod.run_edge(
            req.receptor_pdb,
            req.ligand_a_sdf,
            req.ligand_b_sdf,
            n_lambda_windows=req.n_lambda_windows,
            ns_per_window=req.ns_per_window,
            ns_equilibration=req.ns_equilibration,
            salt_conc_mol_per_l=req.salt_conc_mol_per_l,
            temperature_k=req.temperature_k,
            hmr_mass_amu=req.hmr_mass_amu,
            timestep_fs=req.timestep_fs,
        )
    except Exception as e:                                            # noqa: BLE001
        log.exception("fep_edge_endpoint failed")
        return {
            "ok": False,
            "error": f"{type(e).__name__}: {e}",
            "kind": "runtime",
            "wall_seconds": 0.0,
        }


# ─────────────────────── async start/status (J12) ───────────────────────
# Background-thread pattern: client POSTs /fep_edge_start, we generate a
# job_id and spawn a daemon thread. The thread runs fep_pod.run_edge
# with a stage_callback that writes the latest stage to a JSON file in
# _JOBS_DIR. Client polls /fep_edge_status/{job_id} to read the file.
# When run_edge returns, the thread writes the final result to the
# same file with status="done" or status="failed". GIL is fine here —
# the long phases (antechamber, openmm) all release it.


def _status_path(job_id: str) -> Path:
    """All status files live in _JOBS_DIR. job_id is a UUID so there's
    no path-traversal risk, but we still validate it before joining."""
    if not job_id or "/" in job_id or ".." in job_id:
        raise HTTPException(status_code=400, detail="bad job_id")
    return _JOBS_DIR / f"{job_id}.json"


def _write_status(job_id: str, payload: dict) -> None:
    """Atomically rewrite the status file. Writes to a sibling .tmp
    then renames so polling reads never see a half-written file."""
    p = _status_path(job_id)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":")))
    tmp.replace(p)


def _read_status(job_id: str) -> Optional[dict]:
    p = _status_path(job_id)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception:                                                    # noqa: BLE001
        return None


def _run_edge_worker(job_id: str, req: "FepEdgeRequest") -> None:
    """Daemon-thread target. Calls fep_pod.run_edge with a
    stage_callback that updates the status file, then writes the final
    result (success or structured error). Never raises — any unexpected
    exception is caught and persisted as status='failed'.

    (M7) A heartbeat thread runs in parallel: every 60s, if no new
    stage transition has fired, it writes a status update that
    includes `stage_elapsed_seconds` (time since last stage change).
    Lets the UI distinguish "stuck for 5 min" from "stuck for 5 hours"
    inside running_complex_leg / running_solvent_leg — the two
    opaque MD stages with no sub-stage reporting from openfe."""
    started = time.time()

    # (M7) Mutable closure state shared between the stage callback and
    # the heartbeat thread. A simple list is the easiest way to keep
    # the closure capture working without `nonlocal` plumbing in two
    # places. Lock isn't strictly required — both writers append-style
    # update is fine here because writes are atomic via tmp+rename in
    # _write_status, and last-writer-wins is acceptable.
    current_stage = ["queued"]
    stage_started_at = [time.time()]

    def _cb(stage: str) -> None:
        # (Q3) Cooperative cancellation check at every stage boundary.
        # If the cancel flag is set (by /fep_edge_cancel or Q2's
        # orphan canceller), abort the MD by raising a sentinel
        # exception that the worker's outer try/except catches and
        # converts into a clean status='done', stage='cancelled'.
        with _cancel_lock:
            flag = _cancel_flags.get(job_id)
        if flag and flag.is_set():
            raise _CancelledError(f"job {job_id} cancelled at stage {stage}")
        current_stage[0] = stage
        stage_started_at[0] = time.time()
        _write_status(job_id, {
            "status": "running",
            "stage": stage,
            "stage_elapsed_seconds": 0.0,
            "started_at": started,
            "elapsed_seconds": round(time.time() - started, 1),
        })

    _write_status(job_id, {
        "status": "running",
        "stage": "queued",
        "stage_elapsed_seconds": 0.0,
        "started_at": started,
        "elapsed_seconds": 0.0,
    })

    # (M7) Heartbeat thread. Runs every 60s; only writes when the
    # current stage has been stuck for > 30s (avoids churn during
    # fast transitions through setup stages like LOMAP). Threading
    # Event for clean shutdown — main thread signals stop after
    # run_edge returns and the heartbeat exits its wait promptly.
    stop_heartbeat = threading.Event()
    HEARTBEAT_SECONDS = 60
    HEARTBEAT_MIN_STAGE_AGE_SECONDS = 30

    def _heartbeat() -> None:
        while not stop_heartbeat.wait(HEARTBEAT_SECONDS):
            now = time.time()
            stage_age = now - stage_started_at[0]
            if stage_age < HEARTBEAT_MIN_STAGE_AGE_SECONDS:
                continue
            try:
                _write_status(job_id, {
                    "status": "running",
                    "stage": current_stage[0],
                    "stage_elapsed_seconds": round(stage_age, 1),
                    "started_at": started,
                    "elapsed_seconds": round(now - started, 1),
                })
            except Exception as hb_e:                                # noqa: BLE001
                # Best-effort — never let a heartbeat write failure
                # take down the whole worker.
                log.warning("heartbeat write failed for %s: %s", job_id, hb_e)

    hb_thread = threading.Thread(
        target=_heartbeat,
        name=f"fep_heartbeat_{job_id[:8]}",
        daemon=True,
    )
    hb_thread.start()

    try:
        result = fep_pod.run_edge(
            req.receptor_pdb,
            req.ligand_a_sdf,
            req.ligand_b_sdf,
            n_lambda_windows=req.n_lambda_windows,
            ns_per_window=req.ns_per_window,
            ns_equilibration=req.ns_equilibration,
            salt_conc_mol_per_l=req.salt_conc_mol_per_l,
            temperature_k=req.temperature_k,
            hmr_mass_amu=req.hmr_mass_amu,
            timestep_fs=req.timestep_fs,
            stage_callback=_cb,
        )
        # run_edge always returns a dict (never raises) — `ok` tells us
        # which terminal state to write. Either way, status is "done"
        # from the polling client's perspective and `result` carries
        # the payload.
        _write_status(job_id, {
            "status": "done",
            "stage": "done" if result.get("ok") else "failed",
            "stage_elapsed_seconds": 0.0,
            "started_at": started,
            "elapsed_seconds": round(time.time() - started, 1),
            "result": result,
        })
    except _CancelledError as e:
        # (Q3) Cooperative cancellation — clean terminal state, NOT
        # a crash. Backend reconciler sees status=done + the
        # cancelled stage and transitions the edge to dispatch_state
        # 'cancelled' (or 'failed' if it didn't initiate the cancel).
        log.info("fep_edge_worker cancelled cleanly for job %s: %s", job_id, e)
        _write_status(job_id, {
            "status": "done",
            "stage": "cancelled",
            "stage_elapsed_seconds": 0.0,
            "started_at": started,
            "elapsed_seconds": round(time.time() - started, 1),
            "result": {
                "ok": False,
                "error": str(e),
                "kind": "cancelled",
                "wall_seconds": round(time.time() - started, 1),
            },
        })
    except Exception as e:                                               # noqa: BLE001
        log.exception("fep_edge_worker crashed for job %s", job_id)
        _write_status(job_id, {
            "status": "done",
            "stage": "crashed",
            "stage_elapsed_seconds": 0.0,
            "started_at": started,
            "elapsed_seconds": round(time.time() - started, 1),
            "result": {
                "ok": False,
                "error": f"worker crashed: {type(e).__name__}: {e}",
                "kind": "runtime",
                "wall_seconds": round(time.time() - started, 1),
            },
        })
    finally:
        # (M7) Always stop the heartbeat thread, even on crashes.
        # The daemon=True flag means it would die with the process
        # anyway, but explicit shutdown is cleaner.
        stop_heartbeat.set()
        # (Q2) Clean up tracking for this job — it's terminal now.
        with _cancel_lock:
            _cancel_flags.pop(job_id, None)
        with _poll_lock:
            _last_polled_at.pop(job_id, None)


@app.post("/fep_edge_start")
def fep_edge_start_endpoint(req: FepEdgeRequest, _auth: None = None) -> dict:
    """Spawn a background worker that runs the edge async. Returns
    {job_id} immediately so the client can poll /fep_edge_status/{id}
    every 30s. Same auth + same request shape as /fep_edge.

    Why async: a real edge is 10+ GPU-hours wall and that exceeds
    Cloudflare's 100s timeout and RunPod's 10h proxy idle ceiling.
    The polling pattern decouples client liveness from edge length.

    (Q2) Idempotency: if req.client_token is set AND we already have
    a job for that token, return the existing job_id instead of
    spawning a second worker. Backend's reconciler passes
    client_token=fep_perturbation.id so retries are safe."""
    require_pod_secret()  # noqa: F811

    # (Q2) Idempotency check.
    client_token = getattr(req, "client_token", None)
    if client_token:
        with _token_lock:
            token_map = _load_token_map()
            existing_job_id = token_map.get(client_token)
            if existing_job_id:
                # Confirm the job still has a status file — could be
                # purged. If purged, drop the token + dispatch fresh.
                if _read_status(existing_job_id) is not None:
                    log.info(
                        "fep_edge_start: idempotent return for client_token=%s → job_id=%s",
                        client_token, existing_job_id,
                    )
                    return {
                        "job_id": existing_job_id,
                        "ok": True,
                        "idempotent": True,
                    }
                # Stale token — purge and re-dispatch below.
                token_map.pop(client_token, None)
                _persist_token_map(token_map)

    job_id = uuid.uuid4().hex

    # (Q2) Record the token → job_id mapping before spawning so a
    # racing retry sees the in-flight job.
    if client_token:
        with _token_lock:
            token_map = _load_token_map()
            token_map[client_token] = job_id
            _persist_token_map(token_map)

    # (Q2) Initialise the cancel flag for this job.
    with _cancel_lock:
        _cancel_flags[job_id] = threading.Event()

    # (Q2) Seed last_polled_at so the orphan-cancel thread doesn't
    # immediately reap a brand-new job before the first poll arrives.
    with _poll_lock:
        _last_polled_at[job_id] = time.time()

    # mark as queued before the thread starts so the first poll has
    # something to read.
    _write_status(job_id, {
        "status": "queued",
        "stage": "queued",
        "started_at": time.time(),
        "elapsed_seconds": 0.0,
    })
    t = threading.Thread(
        target=_run_edge_worker,
        args=(job_id, req),
        name=f"fep_edge_worker_{job_id[:8]}",
        daemon=True,
    )
    t.start()
    return {"job_id": job_id, "ok": True}


@app.get("/fep_edge_status/{job_id}")
def fep_edge_status_endpoint(job_id: str, _auth: None = None) -> dict:
    """Polled by the backend's reconciler every 60s (also legacy
    runner every 30s during shadow-mode rollout). Returns:
      {"status": "queued"|"running"|"done", "stage": "<name>",
       "started_at": <unix_ts>, "elapsed_seconds": <float>,
       "result": <dict if done, else absent>}
    404 if the job_id isn't known (cleared after a long retention).

    (Q2) Every poll updates _last_polled_at so the orphan-cancel
    thread can detect abandoned workers."""
    require_pod_secret()  # noqa: F811
    status = _read_status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="unknown job_id")
    with _poll_lock:
        _last_polled_at[job_id] = time.time()
    return status


@app.get("/admin/gpu_status")
def admin_gpu_status(_auth: None = None) -> dict:
    """(U5) Lightweight GPU + service status probe for the Liganx
    watchdog. Returns:
      - gpu_used_mb / gpu_util_pct (from nvidia-smi)
      - compute_apps: list of {pid, name, used_mb} that hold GPU memory
      - active_edges: count of edges in non-terminal state per fep_server
      - has_orphan_leak: True iff GPU mem > 5 GB AND active_edges == 0
        (the canonical "fep_server is hoarding CUDA context with no work
        to do" pattern that produced today's vina-gpu rc=255 cascade)

    Used by services/watchdog.py to detect + remediate the leak.
    Auth: shared pod secret, same as the rest of the admin routes.
    """
    require_pod_secret()  # noqa: F811

    used_mb = 0
    util_pct = 0
    apps: list[dict] = []
    try:
        import subprocess
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if out.returncode == 0:
            line = (out.stdout.strip().splitlines() or [""])[0]
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 2:
                util_pct = int(parts[0])
                used_mb = int(parts[1])
        out2 = subprocess.run(
            ["nvidia-smi", "--query-compute-apps=pid,process_name,used_memory",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if out2.returncode == 0:
            for raw in out2.stdout.strip().splitlines():
                cols = [c.strip() for c in raw.split(",")]
                if len(cols) >= 3:
                    apps.append({
                        "pid": int(cols[0]),
                        "name": cols[1],
                        "used_mb": int(cols[2]),
                    })
    except Exception as e:                                               # noqa: BLE001
        return {"ok": False, "error": str(e)[:200]}

    with _poll_lock:
        active_edges = len(_last_polled_at)

    has_orphan_leak = used_mb > 5000 and active_edges == 0

    return {
        "ok": True,
        "gpu_used_mb": used_mb,
        "gpu_util_pct": util_pct,
        "compute_apps": apps,
        "active_edges": active_edges,
        "has_orphan_leak": has_orphan_leak,
        "fep_server_pid": os.getpid(),
    }


@app.post("/fep_edge_cancel/{job_id}")
def fep_edge_cancel_endpoint(job_id: str, _auth: None = None) -> dict:
    """(Q3) Explicit cancellation. Backend reconciler calls this when
    a study transitions to cancelled (user click, budget cap).

    Sets the cancel flag for the job; the MD worker checks this at
    the next stage boundary and aborts cleanly. The worker writes
    status='done' with stage='cancelled' so the backend sees a
    terminal state on next poll.

    Idempotent — cancelling an already-cancelled or already-done
    job is a no-op."""
    require_pod_secret()  # noqa: F811
    # Validate job_id format (same rules as _status_path).
    if not job_id or "/" in job_id or ".." in job_id:
        raise HTTPException(status_code=400, detail="bad job_id")

    with _cancel_lock:
        flag = _cancel_flags.get(job_id)
    if flag is None:
        # Unknown job_id — could be already-done, or never existed.
        # Either way, no work to do; treat as success.
        return {"ok": True, "noop": True, "reason": "job not in cancel map"}

    flag.set()
    log.info("fep_edge_cancel: requested cancel for job %s", job_id)
    return {"ok": True, "cancel_requested": True}


# ─── (Q2) Orphan-cancel thread ───────────────────────────────────────────


def _orphan_canceller() -> None:
    """Background thread that runs every 5 minutes. For each job_id in
    _last_polled_at: if the last poll was > ORPHAN_CANCEL_AFTER_SECONDS
    ago AND the job is still in a running state, signal cancel.

    Why this exists: the backend's reconciler should call
    /fep_edge_cancel explicitly when it gives up on a study (Q3 path).
    But if the backend itself crashes hard (loss of state), no cancel
    is ever sent. This thread is the pod-side belt to the backend's
    suspenders — 30 minutes of silence = the backend forgot about us =
    stop burning GPU.

    Cancellation is cooperative — the MD worker only checks the flag
    at stage boundaries. Worst-case latency from no-poll to actual
    GPU-free is one MD-stage duration (typically ≤ 30 min on Sage).
    """
    log.info(
        "orphan_canceller started (cancel after %ds of silence, check every 300s)",
        ORPHAN_CANCEL_AFTER_SECONDS,
    )
    while True:
        try:
            time.sleep(300)                                          # 5 min
            now = time.time()
            with _poll_lock:
                stale_jobs = [
                    jid for jid, last in _last_polled_at.items()
                    if (now - last) > ORPHAN_CANCEL_AFTER_SECONDS
                ]
            for jid in stale_jobs:
                # Check the job hasn't already finished.
                status = _read_status(jid)
                if status is None or status.get("status") == "done":
                    # Already terminal — clean up tracking.
                    with _poll_lock:
                        _last_polled_at.pop(jid, None)
                    with _cancel_lock:
                        _cancel_flags.pop(jid, None)
                    continue
                # Still running and abandoned — signal cancel.
                with _cancel_lock:
                    flag = _cancel_flags.get(jid)
                if flag and not flag.is_set():
                    log.warning(
                        "orphan_canceller: job %s silent for >%ds, cancelling",
                        jid, ORPHAN_CANCEL_AFTER_SECONDS,
                    )
                    flag.set()
        except Exception as e:                                       # noqa: BLE001
            log.exception("orphan_canceller iteration failed: %s", e)


# Spawn the orphan canceller on module import so it's running for the
# lifetime of the fep_server process. daemon=True so it dies with the
# server (supervisord will restart both).
_orphan_thread = threading.Thread(
    target=_orphan_canceller,
    name="fep_orphan_canceller",
    daemon=True,
)
_orphan_thread.start()


# ─── (N14) Disk-cleanup thread ───────────────────────────────────────────
#
# Each completed FEP edge leaves behind a directory under
# /workspace/fep_jobs/<job_id>/ with MD trajectories, checkpoints, and
# logs — typically 1-5 GB per edge for production runs. Without cleanup
# the volume fills up after ~50-100 edges on a busy week.
#
# Strategy: scan once an hour. For each job_id with a status.json marked
# terminal (done | failed | cancelled) AND last_modified > N days,
# rmtree the whole directory. Errors are logged but never raise — never
# block a clean MD on a clean-up failure.
#
# DAYS_TO_KEEP is generous (7) on purpose — gives the human the chance
# to ssh in and post-mortem a failed edge before its artifacts vanish.


DAYS_TO_KEEP_TERMINAL_JOBS = int(os.environ.get("FEP_KEEP_DAYS", "7"))
CLEANUP_INTERVAL_SECONDS = int(os.environ.get("FEP_CLEANUP_INTERVAL_S", "3600"))   # 1 h


def _disk_cleaner() -> None:
    """Background thread: delete terminal-status FEP job directories
    older than DAYS_TO_KEEP_TERMINAL_JOBS.

    Conservative — only deletes when:
      1. status.json exists in the directory, AND
      2. status.json says status in {done, failed, cancelled}, AND
      3. status.json's mtime is older than the threshold, AND
      4. the directory is NOT in any tracking dict (_last_polled_at,
         _cancel_flags) — i.e. the in-process state has moved on.

    Anything that fails the checks stays. Aggressive enough to reclaim
    space, gentle enough that you can't accidentally delete an in-flight
    job by tweaking a timestamp."""
    import shutil
    log.info(
        "disk_cleaner started (keep terminal jobs %dd, scan every %ds)",
        DAYS_TO_KEEP_TERMINAL_JOBS, CLEANUP_INTERVAL_SECONDS,
    )
    while True:
        try:
            time.sleep(CLEANUP_INTERVAL_SECONDS)
            cutoff = time.time() - (DAYS_TO_KEEP_TERMINAL_JOBS * 86400)
            if not _JOBS_DIR.exists():
                continue

            deleted = 0
            freed_bytes = 0
            for entry in _JOBS_DIR.iterdir():
                # Skip the persistent token map and any non-directories.
                if not entry.is_dir() or entry.name.startswith("_"):
                    continue
                status_path = entry / "status.json"
                if not status_path.exists():
                    continue
                try:
                    payload = json.loads(status_path.read_text())
                except Exception:                                        # noqa: BLE001
                    continue
                if payload.get("status") not in {"done", "failed", "cancelled"}:
                    continue
                if status_path.stat().st_mtime > cutoff:
                    continue
                # In-process tracking guard — don't delete an entry the
                # orphan_canceller or cancel-flag map still references.
                with _poll_lock:
                    if entry.name in _last_polled_at:
                        continue
                with _cancel_lock:
                    if entry.name in _cancel_flags:
                        continue

                # Estimate size before delete for the log line.
                try:
                    size = sum(
                        f.stat().st_size for f in entry.rglob("*") if f.is_file()
                    )
                except Exception:                                        # noqa: BLE001
                    size = 0
                try:
                    shutil.rmtree(entry)
                    deleted += 1
                    freed_bytes += size
                    log.info(
                        "disk_cleaner: deleted %s (%d MB, status=%s, age=%dd)",
                        entry.name, size // (1024 * 1024),
                        payload.get("status"),
                        int((time.time() - status_path.stat().st_mtime) / 86400),
                    )
                except Exception as e:                                   # noqa: BLE001
                    log.warning("disk_cleaner: failed to delete %s: %s", entry, e)

            if deleted > 0:
                log.info(
                    "disk_cleaner: pass complete — deleted %d jobs, freed %.1f GB",
                    deleted, freed_bytes / (1024 ** 3),
                )
        except Exception as e:                                           # noqa: BLE001
            log.exception("disk_cleaner iteration failed: %s", e)


_cleaner_thread = threading.Thread(
    target=_disk_cleaner,
    name="fep_disk_cleaner",
    daemon=True,
)
_cleaner_thread.start()


# ─── (U4) Idle GPU-memory recovery via self-restart ──────────────────────
#
# OpenMM allocates a CUDA context the first time it touches the GPU, and
# that context (plus pytorch caching-allocator pools) stays resident for
# the entire Python-process lifetime — typically ~6 GB. Even with no
# active edges, fep_server hogs GPU memory and conflicts with the
# co-located dock_server's vina-gpu calls (causes vina-gpu rc=255 +
# CUDA-OOM cascades on docking jobs).
#
# Fix: when the server has been completely idle (no active edges, no
# recent polls) for IDLE_RESTART_AFTER_SECONDS, exit cleanly so
# supervisord restarts us. The fresh process starts with 0 GPU memory
# until the next /fep_edge_start lands.
#
# Idle is defined as:
#   1. No entries in _last_polled_at AND _cancel_flags maps.
#   2. No JSON file under /workspace/fep_jobs/ with status in
#      {pending, running, dispatching} written in the last
#      IDLE_RESTART_AFTER_SECONDS.
#
# Tunable via FEP_IDLE_RESTART_S env var. Default 30 min — long enough
# that a study queued behind a slow edge doesn't get punished.


IDLE_RESTART_AFTER_SECONDS = int(os.environ.get("FEP_IDLE_RESTART_S", "1800"))


def _idle_restarter() -> None:
    """Background thread: if fep_server is idle (no active edges) for
    IDLE_RESTART_AFTER_SECONDS, sys.exit() so supervisord respawns us.

    The fresh process releases the entire CUDA context + memory pool
    that OpenMM/PyTorch caching-allocator held — typically reclaims
    ~6 GB. Dock-side vina-gpu calls then run conflict-free.

    Safety: we ALSO check the on-disk status files, so a job that
    arrived AFTER our last poll-map update but before we re-checked
    won't get killed mid-flight.
    """
    log.info(
        "idle_restarter started (restart after %ds idle, check every 120s)",
        IDLE_RESTART_AFTER_SECONDS,
    )
    started_at = time.time()
    # Grace period at boot — give us at least IDLE_RESTART_AFTER_SECONDS
    # before we even consider restarting. Otherwise a slow startup followed
    # by no work could ping-pong us.
    while True:
        try:
            time.sleep(120)
            now = time.time()
            if now - started_at < IDLE_RESTART_AFTER_SECONDS:
                continue
            with _poll_lock:
                live_polls = len(_last_polled_at)
            with _cancel_lock:
                live_flags = sum(1 for f in _cancel_flags.values() if not f.is_set())
            if live_polls > 0 or live_flags > 0:
                continue
            recent_active_jobs = False
            cutoff = now - IDLE_RESTART_AFTER_SECONDS
            try:
                for entry in _JOBS_DIR.iterdir():
                    if entry.name.startswith("_"):
                        continue
                    status_path = entry / "status.json"
                    if not status_path.exists():
                        continue
                    if status_path.stat().st_mtime < cutoff:
                        continue
                    try:
                        payload = json.loads(status_path.read_text())
                        if payload.get("status") in {"pending", "running", "dispatching"}:
                            recent_active_jobs = True
                            break
                    except Exception:                                    # noqa: BLE001
                        continue
            except Exception:                                            # noqa: BLE001
                recent_active_jobs = True   # fail-safe: don't restart on scan error
            if recent_active_jobs:
                continue
            log.warning(
                "idle_restarter: %ds idle, restarting fep_server to release "
                "GPU memory (supervisord will respawn)",
                IDLE_RESTART_AFTER_SECONDS,
            )
            # Clean exit code 0 — supervisord autorestart=true catches us.
            os._exit(0)
        except Exception as e:                                           # noqa: BLE001
            log.exception("idle_restarter iteration failed: %s", e)


_idle_thread = threading.Thread(
    target=_idle_restarter,
    name="fep_idle_restarter",
    daemon=True,
)
_idle_thread.start()


def _deps_loaded() -> bool:
    """Best-effort check that the FEP scientific stack is importable
    in the current python env. Returns False if anything's missing —
    operator can use the /health response to diagnose conda-env
    breakage without firing a real edge."""
    try:
        import openfe                # noqa: F401
        import openmmtools           # noqa: F401
        import pymbar                # noqa: F401
        from openff.toolkit import Molecule  # noqa: F401
        return True
    except Exception:                                                # noqa: BLE001
        return False
