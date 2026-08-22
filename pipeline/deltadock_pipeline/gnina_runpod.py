"""GNINA docking client — RunPod GPU serverless.

Serverless twin of gnina_dock.py (which targets a long-running Pod). Same
GNINA engine (Vina pose search + CNN rescoring), same DockingResult with
cnn_score / cnn_affinity on each mode — but dispatched to a pay-per-use
RunPod GPU serverless endpoint instead of a Pod HTTP route.

Mirrors runpod_dock.py's /runsync + /status polling (cold-start safe), and
sends the extra `cnn_mode` field the GNINA worker expects. Raises the same
GninaDockError as gnina_dock so runner.py's fallback logic is unchanged.

Wire flow:
    runner.py → dock_one_gnina_runpod() → POST /v2/{endpoint}/runsync →
        GPU worker (runpod/gnina_worker) → gnina → pose + CNN scores → caller
"""

from __future__ import annotations

import base64
import json
import logging
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .dock import DockingMode, DockingResult, PocketBox
from .gnina_dock import GninaDockError  # reuse the same exception type

log = logging.getLogger(__name__)


@dataclass
class GninaRunpodConfig:
    api_key: str
    endpoint_id: str
    cnn_mode: str = "rescore"     # rescore (fast) | refine (slower) | all | none
    timeout_s: int = 300          # GNINA cold-start + CNN scoring headroom

    @property
    def runsync_url(self) -> str:
        return f"https://api.runpod.ai/v2/{self.endpoint_id}/runsync"

    def status_url(self, job_id: str) -> str:
        return f"https://api.runpod.ai/v2/{self.endpoint_id}/status/{job_id}"


def dock_one_gnina_runpod(
    receptor_pdbqt: Path | str,
    ligand_pdbqt: Path | str,
    box: PocketBox,
    work_dir: Path | str,
    cfg: GninaRunpodConfig,
    *,
    exhaustiveness: int = 8,
    num_modes: int = 9,
    seed: int = 42,
) -> DockingResult:
    """Single-ligand GNINA docking on a RunPod GPU serverless worker.

    Returns a DockingResult with cnn_score / cnn_affinity populated on each
    mode. Same shape/contract as gnina_dock.dock_one_gnina so the runner is
    engine-agnostic. Raises GninaDockError on any failure (caller falls back
    to QuickVina/local).
    """
    receptor_pdbqt = Path(receptor_pdbqt)
    ligand_pdbqt = Path(ligand_pdbqt)
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    if not receptor_pdbqt.exists():
        raise GninaDockError(f"Receptor PDBQT not found: {receptor_pdbqt}")
    if not ligand_pdbqt.exists():
        raise GninaDockError(f"Ligand PDBQT not found: {ligand_pdbqt}")

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
            "cnn_mode": cfg.cnn_mode,
        }
    }

    headers = {
        "Authorization": f"Bearer {cfg.api_key}",
        "Content-Type": "application/json",
    }
    log.info("Dispatching GNINA to RunPod GPU endpoint %s (%s vs %s, cnn=%s)",
             cfg.endpoint_id, receptor_pdbqt.name, ligand_pdbqt.name, cfg.cnn_mode)

    response = _post_json(
        url=cfg.runsync_url, body=payload, headers=headers,
        timeout_s=min(95, cfg.timeout_s),
    )
    status = response.get("status")
    job_id = response.get("id")
    if status in ("IN_QUEUE", "IN_PROGRESS") and job_id:
        log.info("GNINA /runsync returned %s; polling /status/%s (cold start)", status, job_id)
        response = _poll_until_done(cfg, job_id, cfg.timeout_s, headers)
        status = response.get("status")

    if status not in ("COMPLETED", "OK"):
        raise GninaDockError(f"RunPod GNINA status={status!r}: {str(response)[:200]}")
    output = response.get("output") or {}
    if "error" in output:
        raise GninaDockError(f"GNINA worker error: {output['error']}")

    engine = output.get("engine")
    if engine:
        log.info("GNINA worker reported engine=%s cnn=%s", engine, output.get("cnn_mode"))

    pose_b64 = output.get("pose_pdbqt_b64")
    modes_raw = output.get("modes")
    if not pose_b64 or not modes_raw:
        raise GninaDockError(f"Malformed GNINA response (missing pose/modes): {str(output)[:200]}")

    pose_path = work_dir / f"{ligand_pdbqt.stem}_dock.pdbqt"
    pose_path.write_bytes(base64.b64decode(pose_b64))
    log_path = work_dir / f"{ligand_pdbqt.stem}_dock.log"
    log_path.write_text(output.get("log", "") or "(gnina runpod: no log captured)")

    modes = [_parse_mode(m) for m in modes_raw]
    if not modes:
        raise GninaDockError("GNINA returned 0 docking modes")

    return DockingResult(
        receptor_pdbqt=receptor_pdbqt,
        ligand_pdbqt=ligand_pdbqt,
        pose_pdbqt=pose_path,
        log_path=log_path,
        modes=modes,
    )


# ───────────────────────── helpers ─────────────────────────

def _parse_mode(m: dict) -> DockingMode:
    return DockingMode(
        rank=int(m["rank"]),
        affinity_kcal_mol=float(m["affinity_kcal_mol"]),
        rmsd_lb=float(m.get("rmsd_lb", 0.0)),
        rmsd_ub=float(m.get("rmsd_ub", 0.0)),
        cnn_score=_maybe_float(m.get("cnn_score")),
        cnn_affinity=_maybe_float(m.get("cnn_affinity")),
    )


def _maybe_float(x):
    if x is None:
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _poll_until_done(cfg: GninaRunpodConfig, job_id: str, timeout_s: int, headers: dict) -> dict:
    start = time.monotonic()
    interval = 2.0
    while True:
        if time.monotonic() - start >= timeout_s:
            raise GninaDockError(f"RunPod GNINA job {job_id} did not finish within {timeout_s}s")
        try:
            req = urllib.request.Request(cfg.status_url(job_id), headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=15) as r:
                resp = json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as e:
            log.warning("Polling GNINA /status/%s failed (%s); retrying", job_id, e)
            time.sleep(interval)
            interval = min(interval * 1.5, 10.0)
            continue
        status = resp.get("status")
        if status in ("COMPLETED", "OK"):
            return resp
        if status in ("FAILED", "CANCELLED", "TIMED_OUT"):
            raise GninaDockError(f"RunPod GNINA job {job_id} ended status={status!r}: {str(resp)[:200]}")
        time.sleep(interval)
        interval = min(interval * 1.5, 10.0)


def _post_json(url: str, body: dict, headers: dict, timeout_s: int) -> dict:
    raw = json.dumps(body).encode("utf-8")
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
        raise GninaDockError(f"HTTP {e.code} from RunPod GNINA: {body_text}") from e
    except urllib.error.URLError as e:
        raise GninaDockError(f"Network error reaching RunPod GNINA: {e.reason}") from e
    except TimeoutError as e:
        raise GninaDockError(f"RunPod GNINA call timed out after {timeout_s}s") from e
