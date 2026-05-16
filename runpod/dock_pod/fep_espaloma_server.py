"""Sibling FastAPI server for the ESPALOMA tier of FEP (K2).

This is a near-clone of fep_server.py — same routes, same auth, same
async polling pattern — except:

  • imports `fep_pod_espaloma` instead of `fep_pod`
  • listens on port 7863 (not 7861/7862)
  • status files live in /workspace/fep_jobs_espaloma/ (not fep_jobs/)
  • logs to fep_espaloma_server_boot.log

Runs out of the sibling conda env /workspace/miniconda3/envs/fep_espaloma/
which is fully independent of the existing /workspace/miniconda3/envs/fep/
(Sage tier). The two FEP servers coexist on the same pod, same GPU; the
dispatcher in dock_server.py (K4) picks which one to forward to based on
the FepEdgeRequest's force_field_engine field.

Deploy on pod:
    curl -L -o /workspace/fep_espaloma_server.py \\
        https://raw.githubusercontent.com/arashtadi/liganx/main/runpod/dock_pod/fep_espaloma_server.py
    curl -L -o /workspace/fep_pod_espaloma.py \\
        https://raw.githubusercontent.com/arashtadi/liganx/main/runpod/dock_pod/fep_pod_espaloma.py
    source /workspace/miniconda3/etc/profile.d/conda.sh
    conda activate fep_espaloma
    cd /workspace && nohup uvicorn fep_espaloma_server:app \\
        --host 0.0.0.0 --port 7863 \\
        > /workspace/fep_espaloma_server_boot.log 2>&1 &

ZERO writes to the Sage env. ZERO edits to fep_server.py / fep_pod.py.
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

# Per-job status files live here. Sibling of the Sage tier's
# /workspace/fep_jobs/ so the two engines never compete on filenames.
_JOBS_DIR = Path("/workspace/fep_jobs_espaloma")
_JOBS_DIR.mkdir(parents=True, exist_ok=True)

import fep_pod_espaloma as fep_pod_engine

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("fep_espaloma_server")

app = FastAPI(title="Liganx FEP+ edge server (Espaloma tier)", version="0.1")


def require_pod_secret(x_pod_secret: str = Header(default="")) -> None:
    """Same shared-secret auth as the Sage server. Fails open if
    POD_SHARED_SECRET is empty, otherwise 401 on mismatch."""
    expected = os.environ.get("POD_SHARED_SECRET", "").strip()
    if not expected:
        return
    if x_pod_secret.strip() != expected:
        raise HTTPException(status_code=401, detail="bad X-Pod-Secret")


class FepEdgeRequest(BaseModel):
    """Identical request shape to the Sage tier — the only difference
    is which engine receives it. Backend's dispatcher knows."""
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
    """Liveness probe. The backend's /admin/pod-status card will get
    extended (K3) to poll this too so operators see Espaloma server
    health alongside the Sage server."""
    return {
        "ok": True,
        "service": "fep_espaloma_server",
        "version": "0.1",
        "engine": "espaloma",
        "deps_ok": _deps_loaded(),
    }


@app.post("/fep_edge")
def fep_edge_endpoint(req: FepEdgeRequest, _auth: None = None) -> dict:
    """Synchronous edge — kept for parity with the Sage server. Real
    callers should use /fep_edge_start (async polling) since edges are
    8–12 GPU-hours wall."""
    require_pod_secret()
    try:
        return fep_pod_engine.run_edge(
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
        log.exception("fep_edge_endpoint failed (Espaloma)")
        return {
            "ok": False,
            "error": f"{type(e).__name__}: {e}",
            "kind": "runtime",
            "engine": "espaloma",
            "wall_seconds": 0.0,
        }


# ─────────────────────── async start/status ───────────────────────


def _status_path(job_id: str) -> Path:
    if not job_id or "/" in job_id or ".." in job_id:
        raise HTTPException(status_code=400, detail="bad job_id")
    return _JOBS_DIR / f"{job_id}.json"


def _write_status(job_id: str, payload: dict) -> None:
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
    except Exception:                                                # noqa: BLE001
        return None


def _run_edge_worker(job_id: str, req: "FepEdgeRequest") -> None:
    """Daemon-thread target. Same stage-callback + (M7) heartbeat
    pattern as the Sage server's worker — writes status JSON atomically
    on each stage transition AND every 60s for ongoing stages."""
    started = time.time()

    current_stage = ["queued"]
    stage_started_at = [time.time()]

    def _cb(stage: str) -> None:
        current_stage[0] = stage
        stage_started_at[0] = time.time()
        _write_status(job_id, {
            "status": "running",
            "stage": stage,
            "stage_elapsed_seconds": 0.0,
            "engine": "espaloma",
            "started_at": started,
            "elapsed_seconds": round(time.time() - started, 1),
        })

    _write_status(job_id, {
        "status": "running",
        "stage": "queued",
        "stage_elapsed_seconds": 0.0,
        "engine": "espaloma",
        "started_at": started,
        "elapsed_seconds": 0.0,
    })

    # (M7) Heartbeat thread — see fep_server.py for full docs.
    stop_heartbeat = threading.Event()

    def _heartbeat() -> None:
        while not stop_heartbeat.wait(60):
            now = time.time()
            stage_age = now - stage_started_at[0]
            if stage_age < 30:
                continue
            try:
                _write_status(job_id, {
                    "status": "running",
                    "stage": current_stage[0],
                    "stage_elapsed_seconds": round(stage_age, 1),
                    "engine": "espaloma",
                    "started_at": started,
                    "elapsed_seconds": round(now - started, 1),
                })
            except Exception as hb_e:                                # noqa: BLE001
                log.warning("heartbeat write failed for %s (Espaloma): %s", job_id, hb_e)

    hb_thread = threading.Thread(
        target=_heartbeat,
        name=f"fep_espaloma_heartbeat_{job_id[:8]}",
        daemon=True,
    )
    hb_thread.start()

    try:
        result = fep_pod_engine.run_edge(
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
        _write_status(job_id, {
            "status": "done",
            "stage": "done" if result.get("ok") else "failed",
            "stage_elapsed_seconds": 0.0,
            "engine": "espaloma",
            "started_at": started,
            "elapsed_seconds": round(time.time() - started, 1),
            "result": result,
        })
    except Exception as e:                                            # noqa: BLE001
        log.exception("fep_edge_worker crashed for job %s (Espaloma)", job_id)
        _write_status(job_id, {
            "status": "done",
            "stage": "crashed",
            "stage_elapsed_seconds": 0.0,
            "engine": "espaloma",
            "started_at": started,
            "elapsed_seconds": round(time.time() - started, 1),
            "result": {
                "ok": False,
                "error": f"worker crashed: {type(e).__name__}: {e}",
                "kind": "runtime",
                "engine": "espaloma",
                "wall_seconds": round(time.time() - started, 1),
            },
        })
    finally:
        stop_heartbeat.set()


@app.post("/fep_edge_start")
def fep_edge_start_endpoint(req: FepEdgeRequest, _auth: None = None) -> dict:
    """Spawn an async worker. Returns {job_id} immediately; client polls
    /fep_edge_status/{job_id} every 30s. Same auth as the Sage server."""
    require_pod_secret()
    job_id = uuid.uuid4().hex
    _write_status(job_id, {
        "status": "queued",
        "stage": "queued",
        "engine": "espaloma",
        "started_at": time.time(),
        "elapsed_seconds": 0.0,
    })
    t = threading.Thread(
        target=_run_edge_worker,
        args=(job_id, req),
        name=f"fep_espaloma_worker_{job_id[:8]}",
        daemon=True,
    )
    t.start()
    return {"job_id": job_id, "ok": True, "engine": "espaloma"}


@app.get("/fep_edge_status/{job_id}")
def fep_edge_status_endpoint(job_id: str, _auth: None = None) -> dict:
    require_pod_secret()
    status = _read_status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="unknown job_id")
    return status


def _deps_loaded() -> bool:
    """Imports the heavy Espaloma-tier stack to confirm the sibling
    conda env is intact. Surfaced via /health for operator triage
    without firing a real edge."""
    try:
        import openfe                # noqa: F401
        import openmmtools           # noqa: F401
        import pymbar                # noqa: F401
        import openmmforcefields     # noqa: F401
        import espaloma              # noqa: F401
        from openff.toolkit import Molecule  # noqa: F401
        return True
    except Exception:                                                # noqa: BLE001
        return False
