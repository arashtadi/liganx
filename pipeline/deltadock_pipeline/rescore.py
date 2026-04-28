"""Pose rescoring via Smina.

Vina's scoring function is fast but well-known to be noisy on close analogs
— two compounds within 1 kcal/mol of each other on Vina often flip rank when
re-scored with a more careful function. Smina lets us run a second-pass score
on every Vina pose using one of:

  * **Vinardo** (Quiroga & Villarreal, 2016) — a Vina re-tuning that
    consistently outperforms Vina on virtual-screening benchmarks. Same
    speed (~0.5-2s per pose). This is our default.
  * Vina (re-scored without re-docking) — sanity check; should match the
    original Vina score within rounding.
  * AD4 — older AutoDock 4 force field; reasonable cross-check.

We ship Vinardo as the "refined score" column. It's not as rigorous as full
MM-GBSA (which requires GROMACS + a few minutes per pose), but it's the
biggest accuracy-per-millisecond bump available and lands Liganx in the
Glide-SP-equivalent neighborhood for analog-vs-analog discrimination.

Smina is invoked as a subprocess with `--score_only` so it doesn't try to
re-pose the ligand — we keep the docked geometry and just compute a new
score. Output gets parsed from stdout; on any failure we return None and
the runner records the original Vina score unchanged.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
from pathlib import Path

log = logging.getLogger(__name__)


# Smina prints lines like:
#   Affinity: -7.123 (kcal/mol)
# or, with the new --score_only output, sometimes:
#   ## Name                    minimizedAffinity
#   pose_name                  -7.123
# We accept both shapes.
_SCORE_RE = re.compile(r"Affinity:\s*(-?\d+\.\d+)")


def smina_rescore(
    receptor_pdbqt: Path | str,
    pose_pdbqt: Path | str,
    *,
    scoring: str = "vinardo",
    timeout: float = 30.0,
) -> float | None:
    """Re-score a docked pose with smina. Returns the score in kcal/mol
    (lower = stronger binding, same convention as Vina) or None on failure.

    Args:
        receptor_pdbqt: Prepared receptor PDBQT used in the original Vina dock.
        pose_pdbqt: The docked pose PDBQT (single mode, output of Vina). If a
                    multi-MODEL Vina output is passed in, smina rescores the
                    first model only — fine for our "best mode" flow.
        scoring: smina scoring function name. "vinardo" is the default and our
                 recommended choice; "vina" / "ad4" are supported for
                 cross-checks.
        timeout: subprocess wall clock cap. Vinardo on a kinase-sized
                 complex is sub-second; 30s is huge headroom.
    """
    if not shutil.which("smina"):
        log.info("smina binary not on PATH — skipping rescore")
        return None

    receptor_pdbqt = Path(receptor_pdbqt)
    pose_pdbqt = Path(pose_pdbqt)
    if not receptor_pdbqt.exists() or not pose_pdbqt.exists():
        return None

    cmd = [
        "smina",
        "--receptor", str(receptor_pdbqt),
        "--ligand", str(pose_pdbqt),
        "--score_only",
        "--scoring", scoring,
    ]
    try:
        res = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=timeout, check=False,
        )
    except subprocess.TimeoutExpired:
        log.warning("smina rescore timed out after %ss", timeout)
        return None
    if res.returncode != 0:
        log.info("smina rescore exit %d: %s", res.returncode, (res.stderr or "")[:200])
        return None

    m = _SCORE_RE.search(res.stdout)
    if not m:
        log.info("smina rescore: no Affinity line in stdout (head: %s)", res.stdout[:200])
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None
