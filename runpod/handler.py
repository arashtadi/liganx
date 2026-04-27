"""RunPod serverless worker — handles a single docking request.

Engine: QuickVina 2.1 (qvina2.1). Same CLI flags + same Vina scoring function
as AutoDock Vina, just ~3-5x faster on drug-like ligands. The binary is
installed at /usr/local/bin/qvina2.1 by the Dockerfile.

Lifecycle:
  1. RunPod's runtime calls `handler(event)` with `event["input"]` = JSON we
     POSTed from the backend (see `pipeline/deltadock_pipeline/runpod_dock.py`).
  2. We decode the receptor + ligand PDBQT, drop them on a tmpfs scratch dir,
     run QuickVina with the requested box + exhaustiveness, parse the log for
     mode scores, and return the pose PDBQT (base64) + parsed modes.
  3. RunPod wraps our return in `{"status": "COMPLETED", "output": ...}` and
     ships it back as the HTTPS response.

Errors are caught and surfaced as `{"error": "..."}` in the output so the
caller can record a useful message instead of a generic 500.

Build + deploy:
  Push to GitHub → RunPod auto-rebuilds the worker image and rolls it out.
"""

from __future__ import annotations

import base64
import logging
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import runpod  # type: ignore[import-not-found]  # provided by the runpod base image

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("deltadock-worker")

# Resolve the docking binary. Prefer QuickVina (faster) and fall back to plain
# Vina if a future build switches engines without touching this file.
DOCK_BIN = (
    shutil.which("qvina2.1")
    or shutil.which("qvina2")
    or shutil.which("vina")
    or "/usr/local/bin/qvina2.1"
)
ENGINE_NAME = Path(DOCK_BIN).name  # surfaced in the response so the caller can confirm

_AFFINITY_LINE = re.compile(
    r"^\s*(\d+)\s+(-?\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s*$"
)


def handler(event: dict[str, Any]) -> dict[str, Any]:
    """Entry point that RunPod's serverless runtime calls per request."""
    inp = event.get("input") or {}

    # Validate required fields up front so we fail fast with a useful message
    for k in ("receptor_pdbqt_b64", "ligand_pdbqt_b64", "box"):
        if k not in inp:
            return {"error": f"missing required field: {k}"}

    box = inp["box"]
    for k in ("center_x", "center_y", "center_z", "size_x", "size_y", "size_z"):
        if k not in box:
            return {"error": f"box.{k} missing"}

    exhaustiveness = int(inp.get("exhaustiveness", 8))
    num_modes = int(inp.get("num_modes", 9))
    seed = int(inp.get("seed", 42))

    try:
        receptor_bytes = base64.b64decode(inp["receptor_pdbqt_b64"])
        ligand_bytes = base64.b64decode(inp["ligand_pdbqt_b64"])
    except Exception as e:
        return {"error": f"base64 decode failed: {e}"}

    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        receptor = work / "receptor.pdbqt"
        ligand = work / "ligand.pdbqt"
        pose = work / "pose.pdbqt"
        receptor.write_bytes(receptor_bytes)
        ligand.write_bytes(ligand_bytes)

        cmd = [
            DOCK_BIN,
            "--receptor", str(receptor),
            "--ligand", str(ligand),
            "--center_x", str(box["center_x"]),
            "--center_y", str(box["center_y"]),
            "--center_z", str(box["center_z"]),
            "--size_x", str(box["size_x"]),
            "--size_y", str(box["size_y"]),
            "--size_z", str(box["size_z"]),
            "--exhaustiveness", str(exhaustiveness),
            "--num_modes", str(num_modes),
            "--seed", str(seed),
            "--out", str(pose),
        ]

        log.info("%s exhaustiveness=%d num_modes=%d", ENGINE_NAME, exhaustiveness, num_modes)
        # Hard cap at 240s — anything longer means we should have used /run + polling.
        # QuickVina at exhaustiveness=8 typically completes in 5-15s, so this is
        # very generous; mostly defends against a runaway process.
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=240)
        except subprocess.TimeoutExpired:
            return {"error": f"{ENGINE_NAME} exceeded 240s — try lower exhaustiveness"}

        if res.returncode != 0:
            tail = (res.stderr or res.stdout or "").strip()[-500:]
            return {"error": f"{ENGINE_NAME} exited {res.returncode}: {tail}"}

        modes = _parse_modes(res.stdout)
        if not modes:
            return {"error": f"{ENGINE_NAME} produced no parseable modes. log tail: {(res.stdout or '')[-300:]}"}

        if not pose.exists() or pose.stat().st_size == 0:
            return {"error": f"{ENGINE_NAME} wrote no pose file"}

        return {
            "pose_pdbqt_b64": base64.b64encode(pose.read_bytes()).decode("ascii"),
            "modes": modes,
            "log": res.stdout[-4000:],   # tail only to keep response small
            "engine": ENGINE_NAME,        # e.g. "qvina2.1" — caller records this for telemetry
            "vina_returncode": res.returncode,
        }


def _parse_modes(log_text: str) -> list[dict[str, float]]:
    """Pull the 9-mode affinity table out of Vina's stdout.
    Same parser as the backend's `dock.parse_vina_log`, kept inline so the
    worker has zero pipeline-package dependency."""
    out: list[dict[str, float]] = []
    for line in log_text.splitlines():
        m = _AFFINITY_LINE.match(line)
        if m:
            out.append({
                "rank": int(m.group(1)),
                "affinity_kcal_mol": float(m.group(2)),
                "rmsd_lb": float(m.group(3)),
                "rmsd_ub": float(m.group(4)),
            })
    return out


if __name__ == "__main__":
    # When the container starts, hand control to RunPod's runtime which will
    # forward each incoming request to handler().
    runpod.serverless.start({"handler": handler})
