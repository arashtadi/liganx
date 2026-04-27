"""Pod-hosted GPU docking client.

When POD_DOCK_URL is configured, dockings are POSTed to a long-running
FastAPI service on a RunPod *Pod* (not serverless) that wraps QuickVina2-GPU.
The Pod is always warm — no cold starts — so we can use a tight timeout
and skip the queue/poll dance the serverless path needs.

Wire flow:
    runner.py  →  dock_one_pod()  →  HTTPS POST /dock  →  Pod (always-on)
        →  QuickVina2-GPU on GPU  →  pose PDBQT + score  →  back to caller

Why GPU + always-on instead of serverless CPU:
- Same QuickVina scoring function as Vina/QuickVina-CPU, just ~30x faster
  on a single docking thanks to OpenCL parallelism.
- No cold-start latency (Pod stays warm 24/7).
- Cost matches what's already being paid for the Pod whether or not we
  use it; serverless was extra spend on top.

The Pod's `dock_server.py` returns:
    {pose_pdbqt_b64, modes, log, engine, vina_returncode}

Same shape the serverless handler returns, so the caller doesn't need to
care which engine ran the docking.
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


class PodDockError(RuntimeError):
    """Raised on any failure talking to the Pod docking service. Caller is
    expected to fall back to local Vina rather than fail the whole job."""


@dataclass
class PodDockConfig:
    base_url: str          # e.g. https://4cli33cxvf58lb-7861.proxy.runpod.net
    timeout_s: int = 60    # Pod is always warm, so this is real worst-case docking time


def dock_one_pod(
    receptor_pdbqt: Path | str,
    ligand_pdbqt: Path | str,
    box: PocketBox,
    work_dir: Path | str,
    cfg: PodDockConfig,
    *,
    exhaustiveness: int = 8,
    num_modes: int = 9,
    seed: int = 42,
    thread: int = 8000,
) -> DockingResult:
    """Run a single docking on the GPU Pod. Returns the same DockingResult
    shape as local `dock_one`, so callers can swap engines transparently.

    The pose PDBQT is decoded and written to `work_dir` so the rest of the
    pipeline (validation, persistence, viewer) sees a normal file on disk —
    matching exactly what the local and RunPod-serverless paths produce.
    """
    receptor_pdbqt = Path(receptor_pdbqt)
    ligand_pdbqt = Path(ligand_pdbqt)
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    if not receptor_pdbqt.exists():
        raise PodDockError(f"Receptor PDBQT not found: {receptor_pdbqt}")
    if not ligand_pdbqt.exists():
        raise PodDockError(f"Ligand PDBQT not found: {ligand_pdbqt}")

    payload = {
        "receptor_pdbqt_b64": _b64(receptor_pdbqt.read_bytes()),
        "ligand_pdbqt_b64": _b64(ligand_pdbqt.read_bytes()),
        "box": {
            "center_x": box.center_x, "center_y": box.center_y, "center_z": box.center_z,
            "size_x": box.size_x,     "size_y": box.size_y,     "size_z": box.size_z,
        },
        "exhaustiveness": exhaustiveness,
        "num_modes": num_modes,
        "seed": seed,
        "thread": thread,
    }

    url = cfg.base_url.rstrip("/") + "/dock"
    log.info("Dispatching to Pod %s (%s vs %s)", cfg.base_url, receptor_pdbqt.name, ligand_pdbqt.name)

    output = _post_json(url=url, body=payload, timeout_s=cfg.timeout_s)

    # Worker contract: returns base64 pose PDBQT + parsed mode rows + engine name
    pose_b64 = output.get("pose_pdbqt_b64")
    modes_raw = output.get("modes")
    engine = output.get("engine")
    if engine:
        log.info("Pod reported engine=%s", engine)

    if not pose_b64 or not modes_raw:
        raise PodDockError(f"Malformed Pod response (missing pose/modes): {str(output)[:200]}")

    pose_path = work_dir / f"{ligand_pdbqt.stem}_dock.pdbqt"
    pose_path.write_bytes(base64.b64decode(pose_b64))

    log_path = work_dir / f"{ligand_pdbqt.stem}_dock.log"
    log_path.write_text(output.get("log", "") or "(pod: no log captured)")

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
        raise PodDockError("Pod returned 0 docking modes")

    return DockingResult(
        receptor_pdbqt=receptor_pdbqt,
        ligand_pdbqt=ligand_pdbqt,
        pose_pdbqt=pose_path,
        log_path=log_path,
        modes=modes,
    )


# ───────────────────────── helpers ─────────────────────────

def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _post_json(url: str, body: dict, timeout_s: int) -> dict:
    """Minimal stdlib HTTPS POST to the Pod's /dock endpoint. Surfaces the
    response body on HTTP errors so the caller can record a useful message.

    User-Agent matters here: RunPod's proxy is fronted by Cloudflare, which
    blocks the default `Python-urllib/X.Y` UA with error code 1010. We send
    a deltadock-branded UA that looks like a real client to slip past the
    bot filter. (No other auth needed — the Pod proxy URL is per-pod and
    unauthenticated by design.)"""
    raw = json.dumps(body).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "deltadock-backend/0.1 (+https://deltadock.bio)",
        "Accept": "application/json",
    }
    req = urllib.request.Request(url, data=raw, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = ""
        try:
            body_text = e.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            pass
        raise PodDockError(f"HTTP {e.code} from Pod: {body_text}") from e
    except urllib.error.URLError as e:
        raise PodDockError(f"Network error reaching Pod: {e.reason}") from e
    except TimeoutError as e:
        raise PodDockError(f"Pod call timed out after {timeout_s}s") from e
