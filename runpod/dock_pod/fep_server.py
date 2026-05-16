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
    exception is caught and persisted as status='failed'."""
    started = time.time()

    def _cb(stage: str) -> None:
        _write_status(job_id, {
            "status": "running",
            "stage": stage,
            "started_at": started,
            "elapsed_seconds": round(time.time() - started, 1),
        })

    _write_status(job_id, {
        "status": "running",
        "stage": "queued",
        "started_at": started,
        "elapsed_seconds": 0.0,
    })
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
            "started_at": started,
            "elapsed_seconds": round(time.time() - started, 1),
            "result": result,
        })
    except Exception as e:                                               # noqa: BLE001
        log.exception("fep_edge_worker crashed for job %s", job_id)
        _write_status(job_id, {
            "status": "done",
            "stage": "crashed",
            "started_at": started,
            "elapsed_seconds": round(time.time() - started, 1),
            "result": {
                "ok": False,
                "error": f"worker crashed: {type(e).__name__}: {e}",
                "kind": "runtime",
                "wall_seconds": round(time.time() - started, 1),
            },
        })


@app.post("/fep_edge_start")
def fep_edge_start_endpoint(req: FepEdgeRequest, _auth: None = None) -> dict:
    """Spawn a background worker that runs the edge async. Returns
    {job_id} immediately so the client can poll /fep_edge_status/{id}
    every 30s. Same auth + same request shape as /fep_edge.

    Why async: a real edge is 10+ GPU-hours wall and that exceeds
    Cloudflare's 100s timeout and RunPod's 10h proxy idle ceiling.
    The polling pattern decouples client liveness from edge length."""
    require_pod_secret()  # noqa: F811
    job_id = uuid.uuid4().hex
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
    """Polled by the backend's fep_runner every 30s. Returns:
      {"status": "queued"|"running"|"done", "stage": "<name>",
       "started_at": <unix_ts>, "elapsed_seconds": <float>,
       "result": <dict if done, else absent>}
    404 if the job_id isn't known (cleared after a long retention)."""
    require_pod_secret()  # noqa: F811
    status = _read_status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="unknown job_id")
    return status


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
