"""Boltz-2 prediction server with async + sync endpoints.

The original sync /predict_boltz2 endpoint had a fatal flaw: each call
spawns a fresh `boltz predict` subprocess that takes 60-90 s to boot
Python + load 4.4 GB of model weights into the GPU + run inference.
That exceeds Cloudflare's edge timeout on the RunPod proxy (~100 s),
so every call from the API client returned HTTP 524 "A timeout occurred"
even though the prediction itself was running fine inside the pod.

This server adds an async polling pattern alongside the existing sync
endpoint so the runner can:
  1. POST /predict_boltz2_async → 202 with {job_id}.
  2. Poll GET /predict_boltz2_status/{job_id} every few seconds.
     Each poll is a sub-second HTTP request that easily clears the
     edge timeout, no matter how long the actual GPU work takes.
  3. When status=done, the response carries the same payload shape
     the sync endpoint returned (predicted_pdb_b64, affinity values).

The sync endpoint is preserved for backward compatibility and for
pod-internal warmup calls that bypass Cloudflare entirely.

In-memory JOBS dict is fine here: the boltz pod is single-process
(uvicorn workers=1) and we only need history for as long as the
runner's poll loop. Old entries are cleaned up by a TTL sweep.
"""

from __future__ import annotations

import base64
import json
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path

import yaml
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


app = FastAPI()


class PredictReq(BaseModel):
    receptor_sequence: str
    ligand_smiles: str
    chain_id: str = "A"
    pocket_residues: list[int] = []
    use_msa: bool = False
    num_samples: int = 1


# job_id → {"status": "queued"|"running"|"done"|"error",
#           "started_at": float,
#           "result": dict | None,
#           "error": str | None}
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
JOB_TTL_S = 600  # discard jobs older than 10 min on the next access


def _sweep_old_jobs() -> None:
    """Drop entries older than JOB_TTL_S so JOBS doesn't grow unbounded.
    Cheap to call inline because the dict stays small in practice."""
    now = time.time()
    with JOBS_LOCK:
        stale = [
            jid for jid, j in JOBS.items()
            if now - j.get("started_at", now) > JOB_TTL_S
            and j.get("status") in ("done", "error")
        ]
        for jid in stale:
            JOBS.pop(jid, None)


def _set_status(job_id: str, **kwargs) -> None:
    with JOBS_LOCK:
        if job_id in JOBS:
            JOBS[job_id].update(kwargs)


def _run_boltz_subprocess(req: PredictReq) -> dict:
    """The actual prediction — same logic as the original sync endpoint.
    Spawns `boltz predict` and parses its outputs. Raises on error."""
    workdir = Path(tempfile.mkdtemp(prefix="boltz2_"))
    yaml_path = workdir / "input.yaml"
    spec = {
        "sequences": [
            {"protein": {"id": req.chain_id, "sequence": req.receptor_sequence, "msa": "empty"}},
            {"ligand": {"id": "L", "smiles": req.ligand_smiles}},
        ],
        "properties": [{"affinity": {"binder": "L"}}],
    }
    if req.pocket_residues:
        spec["constraints"] = [
            {"pocket": {"binder": "L", "contacts": [[req.chain_id, r] for r in req.pocket_residues]}}
        ]
    yaml_path.write_text(yaml.safe_dump(spec))

    cmd = [
        "boltz", "predict", str(yaml_path),
        "--out_dir", str(workdir),
        "--cache", "/workspace/boltz2_cache",
        "--output_format", "pdb",
        "--diffusion_samples", str(req.num_samples),
        "--override",
    ]
    if req.use_msa:
        cmd.append("--use_msa_server")

    # Long timeout — boltz cold start is ~90 s but warm path is ~20 s.
    # 600 s is a generous ceiling that covers the worst case without
    # ever leaving a zombie subprocess.
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        raise RuntimeError(
            f"boltz_predict_failed (rc={proc.returncode}): {proc.stderr[-2000:]}"
        )

    pred_dir = workdir / "boltz_results_input" / "predictions" / "input"
    aff_files = list(pred_dir.glob("affinity_*.json"))
    pdb_files = list(pred_dir.glob("*.pdb"))
    if not aff_files or not pdb_files:
        raise RuntimeError(
            f"boltz_output_missing in {pred_dir} "
            f"(stderr tail: {proc.stderr[-500:]})"
        )

    aff = json.loads(aff_files[0].read_text())
    pdb_b64 = base64.b64encode(pdb_files[0].read_bytes()).decode("ascii")
    return {
        "predicted_pdb_b64": pdb_b64,
        "affinity_pred_value": aff.get("affinity_pred_value"),
        "affinity_probability_binary": aff.get("affinity_probability_binary"),
        "engine": "boltz2",
    }


def _job_worker(job_id: str, req_dict: dict) -> None:
    """Background worker: runs the prediction, writes result/error to JOBS."""
    req = PredictReq(**req_dict)
    _set_status(job_id, status="running")
    try:
        out = _run_boltz_subprocess(req)
        _set_status(job_id, status="done", result=out)
    except Exception as e:
        _set_status(job_id, status="error", error=str(e)[:1500])


@app.get("/health")
def health():
    return {"ok": True, "engine": "boltz-2"}


@app.post("/predict_boltz2")
def predict_boltz2(req: PredictReq):
    """Synchronous prediction. Subject to Cloudflare's 100 s edge timeout.
    Useful for pod-internal warmup calls (curl localhost:7862) where the
    proxy isn't in the path — for production traffic, use the async endpoints."""
    try:
        return _run_boltz_subprocess(req)
    except Exception as e:
        return {"error": str(e)[:1500]}


@app.post("/predict_boltz2_async")
def predict_async(req: PredictReq):
    """Kick off a prediction in the background and return immediately with
    a job_id. The caller polls /predict_boltz2_status/{job_id} until the
    status flips to 'done' or 'error'. This pattern bypasses Cloudflare's
    edge timeout because each individual HTTP call returns in milliseconds."""
    _sweep_old_jobs()
    job_id = uuid.uuid4().hex
    with JOBS_LOCK:
        JOBS[job_id] = {
            "status": "queued",
            "started_at": time.time(),
            "result": None,
            "error": None,
        }
    # Spawn a daemon thread per request. boltz subprocess itself is the
    # heavy lifter; the Python side here is just plumbing so we don't need
    # an executor pool. RTX 4090 has one CUDA context anyway, so two
    # concurrent boltz calls would just thrash GPU memory.
    threading.Thread(
        target=_job_worker, args=(job_id, req.dict()), daemon=True,
    ).start()
    return {"job_id": job_id, "status": "queued"}


@app.get("/predict_boltz2_status/{job_id}")
def predict_status(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job_not_found_or_expired")
    # Shallow copy so we don't accidentally leak the lock-protected dict.
    out = {
        "status": job["status"],
        "elapsed_s": round(time.time() - job["started_at"], 1),
    }
    if job["status"] == "done":
        out.update(job["result"])
    elif job["status"] == "error":
        out["error"] = job["error"]
    return out
