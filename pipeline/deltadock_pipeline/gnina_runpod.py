"""GNINA docking client — RunPod GPU **serverless** endpoint.

The serverless sibling of `gnina_dock.py` (which targets an always-on Pod).
Same GNINA engine + CNN rescoring, but dispatched to a RunPod serverless
endpoint (`runpod/gnina_worker/handler.py`) that scales to zero and cold-
starts on demand. This is the preferred production path — no idle GPU cost.

Wire flow:
    runner.py  →  dock_one_gnina_runpod()  →  HTTPS POST /runsync  →
        (poll /status on cold start)  →  gnina_worker (Docker, GPU)  →
        GNINA  →  pose PDBQT + Vina affinity + CNN scores  →  DockingResult

Contract mirrors `runpod_dock.dock_one_runpod` (serverless invoke + poll)
PLUS the GNINA specifics from `gnina_dock`: the request carries `cnn_mode`
and the response modes carry `cnn_score` / `cnn_affinity`. We reuse
`gnina_dock._parse_gnina_mode` so CNN parsing lives in exactly one place,
and we raise `GninaDockError` (imported from gnina_dock) so runner.py's
per-cell `except GninaDockError` catches BOTH clients identically.
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

from .dock import DockingResult, PocketBox
from .gnina_dock import GninaDockError, _parse_gnina_mode

log = logging.getLogger(__name__)


@dataclass
class GninaRunpodConfig:
    api_key: str
    endpoint_id: str
    cnn_mode: str = "rescore"   # "rescore" (fast) | "refine" | "all" | "none"
    timeout_s: int = 300        # GNINA + CNN + cold start; keep generous

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
    """Single-ligand GNINA docking on a RunPod serverless GPU worker.

    Returns a `DockingResult` whose modes carry cnn_score / cnn_affinity,
    shaped identically to `gnina_dock.dock_one_gnina` so the runner and the
    rest of the validation/persistence pipeline don't care which GNINA
    backend ran. Raises `GninaDockError` on any failure so the caller can
    fall back to QuickVina2-GPU.
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
        # A real UA avoids RunPod's Cloudflare 1010 block on Python-urllib.
        "User-Agent": "liganx-backend/0.1 (+https://liganx.com)",
        "Accept": "application/json",
    }

    log.info("Dispatching GNINA to RunPod serverless endpoint %s (%s vs %s, cnn=%s)",
             cfg.endpoint_id, receptor_pdbqt.name, ligand_pdbqt.name, cfg.cnn_mode)

    # /runsync fast path; fall through to /status polling on cold start.
    response = _post_json(cfg.runsync_url, payload, headers, timeout_s=min(95, cfg.timeout_s))
    status = response.get("status")
    job_id = response.get("id")
    if status in ("IN_QUEUE", "IN_PROGRESS") and job_id:
        log.info("GNINA /runsync returned %s; polling /status/%s (cold start)", status, job_id)
        response = _poll_until_done(cfg, job_id, cfg.timeout_s, headers)
        status = response.get("status")

    if status not in ("COMPLETED", "OK"):
        raise GninaDockError(f"RunPod GNINA returned status={status!r}: {str(response)[:200]}")

    output = response.get("output") or {}
    if "error" in output:
        raise GninaDockError(f"GNINA worker error: {output['error']}")

    pose_b64 = output.get("pose_pdbqt_b64")
    modes_raw = output.get("modes")
    if not pose_b64 or not modes_raw:
        raise GninaDockError(f"Malformed GNINA response (missing pose/modes): {str(output)[:200]}")

    pose_path = work_dir / f"{ligand_pdbqt.stem}_dock.pdbqt"
    pose_path.write_bytes(base64.b64decode(pose_b64))
    log_path = work_dir / f"{ligand_pdbqt.stem}_dock.log"
    log_path.write_text(output.get("log", "") or "(gnina runpod: no log captured)")

    try:
        modes = [_parse_gnina_mode(m) for m in modes_raw]
    except (KeyError, TypeError, ValueError) as e:
        raise GninaDockError(f"GNINA malformed modes: {e}") from e
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

def _poll_until_done(cfg: GninaRunpodConfig, job_id: str, timeout_s: int, headers: dict) -> dict:
    """Poll /status/{id} until terminal. Backs off 2s→10s. Raises
    GninaDockError on FAILED/CANCELLED/TIMED_OUT or overall timeout."""
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


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


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
