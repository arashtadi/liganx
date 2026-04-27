"""RunPod serverless docking client.

When the backend has a RunPod API key + endpoint ID configured, dockings get
dispatched to a remote serverless worker instead of running Vina locally.
The worker runs the same `dock_one` pipeline (Vina + Open Babel) inside a
prebuilt Docker image — see `runpod/handler.py` and `runpod/Dockerfile`.

Wire flow:
    runner.py  →  dock_one_runpod()  →  HTTPS POST  →  RunPod /runsync  →
        worker (Docker)  →  Vina  →  pose PDBQT + score  →  back to caller

Why serverless instead of long-running pods:
- Pay only for actual compute (~$0.0002/sec for a CPU worker)
- No idle cost when the lab isn't running jobs
- Workers scale to zero, then cold-start on demand (~3-10s overhead)

Cold-start latency means we use generous timeouts (default 4 min). For
production batches you'd want to use /run (async) + a polling loop instead
of /runsync (sync, capped at 5 min).
"""

from __future__ import annotations

import base64
import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .dock import DockingMode, DockingResult, PocketBox

log = logging.getLogger(__name__)


class RunPodError(RuntimeError):
    """Surfaces RunPod-side failures (auth, timeout, worker crash, malformed
    response). Caller is expected to fall back to local docking."""


@dataclass
class RunPodConfig:
    api_key: str
    endpoint_id: str
    timeout_s: int = 240

    @property
    def runsync_url(self) -> str:
        return f"https://api.runpod.ai/v2/{self.endpoint_id}/runsync"

    @property
    def run_url(self) -> str:
        return f"https://api.runpod.ai/v2/{self.endpoint_id}/run"

    def status_url(self, job_id: str) -> str:
        return f"https://api.runpod.ai/v2/{self.endpoint_id}/status/{job_id}"


def dock_one_runpod(
    receptor_pdbqt: Path | str,
    ligand_pdbqt: Path | str,
    box: PocketBox,
    work_dir: Path | str,
    cfg: RunPodConfig,
    *,
    exhaustiveness: int = 8,
    num_modes: int = 9,
    seed: int = 42,
) -> DockingResult:
    """Run a single docking on RunPod and return a DockingResult shaped like the
    local `dock_one` so the caller doesn't care which engine ran it.

    The worker receives the receptor + ligand as base64-encoded PDBQT inside
    the JSON request, runs Vina, and returns the pose PDBQT + parsed scores
    in the response. We write the pose to `work_dir` so the rest of the
    pipeline (validation, persistence, viewer) sees a normal file on disk.
    """
    receptor_pdbqt = Path(receptor_pdbqt)
    ligand_pdbqt = Path(ligand_pdbqt)
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    if not receptor_pdbqt.exists():
        raise RunPodError(f"Receptor PDBQT not found: {receptor_pdbqt}")
    if not ligand_pdbqt.exists():
        raise RunPodError(f"Ligand PDBQT not found: {ligand_pdbqt}")

    payload = {
        "input": {
            "receptor_pdbqt_b64": _b64(receptor_pdbqt.read_bytes()),
            "ligand_pdbqt_b64": _b64(ligand_pdbqt.read_bytes()),
            "box": {
                "center_x": box.center_x, "center_y": box.center_y, "center_z": box.center_z,
                "size_x": box.size_x,     "size_y": box.size_y,     "size_z": box.size_z,
            },
            "exhaustiveness": exhaustiveness,
            "num_modes": num_modes,
            "seed": seed,
        }
    }

    log.info("Dispatching to RunPod endpoint %s (%s vs %s)",
             cfg.endpoint_id, receptor_pdbqt.name, ligand_pdbqt.name)
    headers = {
        "Authorization": f"Bearer {cfg.api_key}",
        "Content-Type": "application/json",
    }
    # Try /runsync first — fast path when a worker is already warm. If RunPod
    # can't finish within its server-side cap (~90s), it returns the request
    # as IN_QUEUE / IN_PROGRESS with a job id, which we then poll via /status.
    # This handles cold starts (container pulling + booting) without falsely
    # reporting failure.
    response = _post_json(
        url=cfg.runsync_url,
        body=payload,
        headers=headers,
        timeout_s=min(95, cfg.timeout_s),  # /runsync caps at ~90s anyway
    )
    status = response.get("status")
    job_id = response.get("id")

    # If still queued or running on the server, poll /status until done. This
    # is the cold-start / long-task path. We respect the caller's overall
    # timeout_s budget; whatever time was already spent in /runsync counts.
    if status in ("IN_QUEUE", "IN_PROGRESS") and job_id:
        log.info("RunPod /runsync returned %s; polling /status/%s", status, job_id)
        response = _poll_until_done(cfg, job_id, cfg.timeout_s, headers)
        status = response.get("status")

    if status not in ("COMPLETED", "OK"):
        raise RunPodError(
            f"RunPod returned status={status!r}: {str(response)[:200]}"
        )
    output = response.get("output") or {}
    if "error" in output:
        raise RunPodError(f"Worker error: {output['error']}")
    # The handler reports which docking binary it actually used (e.g. "qvina2.1").
    engine = output.get("engine")
    if engine:
        log.info("Worker reported engine=%s", engine)

    # Worker contract: returns base64 pose PDBQT + parsed mode rows.
    pose_b64 = output.get("pose_pdbqt_b64")
    modes_raw = output.get("modes")
    if not pose_b64 or not modes_raw:
        raise RunPodError(f"Malformed worker response (missing pose/modes): {str(output)[:200]}")

    # Persist the pose so the rest of the pipeline (validation, /jobs/poses
    # endpoint, 3D viewer) sees the same shape as a local run.
    pose_path = work_dir / f"{ligand_pdbqt.stem}_dock.pdbqt"
    pose_path.write_bytes(base64.b64decode(pose_b64))

    log_path = work_dir / f"{ligand_pdbqt.stem}_dock.log"
    log_path.write_text(output.get("log", "") or "(runpod: no log captured)")

    modes = [
        DockingMode(
            rank=int(m["rank"]),
            affinity_kcal_mol=float(m["affinity_kcal_mol"]),
            rmsd_lb=float(m.get("rmsd_lb", 0.0)),
            rmsd_ub=float(m.get("rmsd_ub", 0.0)),
        )
        for m in modes_raw
    ]
    if not modes:
        raise RunPodError("Worker returned 0 docking modes")

    return DockingResult(
        receptor_pdbqt=receptor_pdbqt,
        ligand_pdbqt=ligand_pdbqt,
        pose_pdbqt=pose_path,
        log_path=log_path,
        modes=modes,
    )


# ───────────────────────── helpers ─────────────────────────

def _poll_until_done(
    cfg: "RunPodConfig",
    job_id: str,
    timeout_s: int,
    headers: dict,
) -> dict:
    """Poll RunPod's /status/{id} until the request reaches a terminal state.

    Used when /runsync's 90s server-side cap expires before the worker is
    finished (typically cold-start). We back off the polling interval — quick
    polls early to catch fast finishers, longer polls later to avoid hammering
    the API while a slow docking runs.

    Raises RunPodError on terminal failure states (FAILED, CANCELLED, TIMED_OUT).
    """
    import time
    import urllib.request

    start = time.monotonic()
    interval = 2.0  # seconds; grows up to ~10s as we wait
    while True:
        elapsed = time.monotonic() - start
        if elapsed >= timeout_s:
            raise RunPodError(f"RunPod job {job_id} did not finish within {timeout_s}s")

        try:
            req = urllib.request.Request(cfg.status_url(job_id), headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=15) as r:
                resp = json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as e:
            # Transient network issue — keep trying until the overall timeout
            log.warning("Polling /status/%s failed (%s); will retry", job_id, e)
            time.sleep(interval)
            interval = min(interval * 1.5, 10.0)
            continue

        status = resp.get("status")
        if status in ("COMPLETED", "OK"):
            return resp
        if status in ("FAILED", "CANCELLED", "TIMED_OUT"):
            raise RunPodError(f"RunPod job {job_id} ended with status={status!r}: {str(resp)[:200]}")
        # IN_QUEUE / IN_PROGRESS — keep polling
        time.sleep(interval)
        interval = min(interval * 1.5, 10.0)


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _post_json(url: str, body: dict, headers: dict, timeout_s: int) -> dict:
    """Minimal stdlib HTTPS POST. Avoids adding requests/httpx as runtime
    deps for the pipeline package — the backend already has httpx, but we
    want the pipeline to stay shippable on its own."""
    raw = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=raw, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # Surface the response body so the caller sees a useful error
        body_text = ""
        try:
            body_text = e.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            pass
        raise RunPodError(f"HTTP {e.code} from RunPod: {body_text}") from e
    except urllib.error.URLError as e:
        raise RunPodError(f"Network error reaching RunPod: {e.reason}") from e
    except TimeoutError as e:
        raise RunPodError(f"RunPod call timed out after {timeout_s}s") from e
