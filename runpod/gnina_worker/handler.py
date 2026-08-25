"""RunPod GPU serverless worker — a single GNINA docking request.

Engine: GNINA (AutoDock Vina pose search + CNN rescoring on GPU). Same request
shape as the CPU QuickVina worker (../handler.py) PLUS a `cnn_mode` field, and
the response modes additionally carry `cnn_score` (0-1 pose confidence) and
`cnn_affinity` (predicted pKd) — the columns users pick GNINA for.

Wire contract (matches pipeline/deltadock_pipeline/gnina_dock.py mode parser):
  input : { receptor_pdbqt_b64, ligand_pdbqt_b64, box{center_*,size_*},
            exhaustiveness, num_modes, seed, cnn_mode }
  output: { pose_pdbqt_b64, modes[ {rank, affinity_kcal_mol, cnn_score,
            cnn_affinity} ], log, engine="gnina" }   (or { error })
"""

from __future__ import annotations

import base64
import logging
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import runpod  # provided by the RunPod base layer

# gnina + its libs live on the mounted network volume. Point OpenBabel at its
# bundled format plugins / data files, and make sure nvrtc (dlopen'd by libtorch
# at runtime, so not on the ELF NEEDED list) is on the library path.
_GNINA_LIB = "/runpod-volume/gnina/lib"
os.environ.setdefault("BABEL_LIBDIR", _GNINA_LIB + "/openbabel")
os.environ.setdefault("BABEL_DATADIR", "/runpod-volume/gnina/share/openbabel")
os.environ["LD_LIBRARY_PATH"] = _GNINA_LIB + ":" + os.environ.get("LD_LIBRARY_PATH", "")

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("liganx-gnina-worker")

GNINA_BIN = shutil.which("gnina") or "/usr/local/bin/gnina"

_VALID_CNN = {"rescore", "refine", "all", "none"}

# A data row in gnina's mode table: an integer rank followed by ≥1 floats.
# gnina's default column order is: affinity (kcal/mol) | CNN pose score | CNN
# affinity — CNN columns are LAST, so we read affinity=first, cnn=last two.
_MODE_ROW = re.compile(r"^\s*(\d+)\s+(-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?)+)\s*$")


def handler(event: dict[str, Any]) -> dict[str, Any]:
    inp = event.get("input") or {}

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
    cnn_mode = str(inp.get("cnn_mode", "rescore")).strip().lower()
    if cnn_mode not in _VALID_CNN:
        cnn_mode = "rescore"

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
            GNINA_BIN,
            "-r", str(receptor),
            "-l", str(ligand),
            "--center_x", str(box["center_x"]),
            "--center_y", str(box["center_y"]),
            "--center_z", str(box["center_z"]),
            "--size_x", str(box["size_x"]),
            "--size_y", str(box["size_y"]),
            "--size_z", str(box["size_z"]),
            "--exhaustiveness", str(exhaustiveness),
            "--num_modes", str(num_modes),
            "--seed", str(seed),
            "--cnn_scoring", cnn_mode,
            "-o", str(pose),
        ]

        log.info("gnina cnn=%s exhaustiveness=%d num_modes=%d", cnn_mode, exhaustiveness, num_modes)
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=280)
        except subprocess.TimeoutExpired:
            return {"error": "gnina exceeded 280s — try cnn_mode=rescore or lower exhaustiveness"}

        if res.returncode != 0:
            err = (res.stderr or res.stdout or "").strip()
            # Capture the HEAD (the C++ exception `what()` message + top stack
            # frames — the actual cause) as well as the tail. A plain [-600:]
            # only shows deep frames and hides why gnina aborted.
            head = err[:1400]
            tail = err[-500:]
            return {"error": f"gnina exited {res.returncode}: HEAD>> {head} <<TAIL>> {tail}"}

        modes = _parse_modes(res.stdout)
        if not modes:
            return {"error": f"gnina produced no parseable modes. log tail: {(res.stdout or '')[-400:]}"}

        if not pose.exists() or pose.stat().st_size == 0:
            return {"error": "gnina wrote no pose file"}

        return {
            "pose_pdbqt_b64": base64.b64encode(pose.read_bytes()).decode("ascii"),
            "modes": modes,
            "log": (res.stdout or "")[-4000:],
            "engine": "gnina",
            "cnn_mode": cnn_mode,
            "gnina_returncode": res.returncode,
        }


def _parse_modes(log_text: str) -> list[dict[str, float]]:
    """Parse gnina's mode table. Column order is affinity | ... | CNNscore |
    CNNaffinity, so affinity is the first float and the CNN pair is the last
    two — robust to an optional middle 'intramol' column across gnina builds."""
    out: list[dict[str, float]] = []
    for line in log_text.splitlines():
        m = _MODE_ROW.match(line)
        if not m:
            continue
        rank = int(m.group(1))
        nums = [float(x) for x in m.group(2).split()]
        if not nums:
            continue
        row: dict[str, float] = {"rank": rank, "affinity_kcal_mol": nums[0]}
        if len(nums) >= 3:
            # last two = CNN pose score, CNN affinity
            row["cnn_score"] = nums[-2]
            row["cnn_affinity"] = nums[-1]
        elif len(nums) == 2:
            row["cnn_score"] = nums[1]
        out.append(row)
    return out


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
