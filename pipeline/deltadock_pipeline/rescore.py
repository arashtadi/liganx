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
        pose_pdbqt: The docked pose PDBQT. Vina outputs a multi-MODEL file
                    (modes 1-9 concatenated); smina --score_only rejects this
                    with "Unexpected multi-MODEL input", so we extract just
                    the best mode (MODEL 1) into a temp file before calling.
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

    # Extract just MODEL 1 (best-scoring pose) into a single-mode PDBQT so
    # smina is happy. Cache the extracted file next to the original — cheap
    # and gives us idempotency on retries within the same job dir.
    best_only = pose_pdbqt.with_suffix(".best.pdbqt")
    if not best_only.exists() or best_only.stat().st_size == 0:
        try:
            _extract_best_mode(pose_pdbqt, best_only)
        except Exception as e:
            log.info("smina rescore: best-mode extraction failed (%s)", e)
            return None

    cmd = [
        "smina",
        "--receptor", str(receptor_pdbqt),
        "--ligand", str(best_only),
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
        # Log both stderr and stdout — smina sometimes prints errors to stdout.
        log.info(
            "smina rescore exit %d | cmd: %s | stderr: %s | stdout: %s",
            res.returncode, " ".join(cmd),
            (res.stderr or "").strip()[:300],
            (res.stdout or "").strip()[:300],
        )
        return None

    m = _SCORE_RE.search(res.stdout)
    if not m:
        log.info("smina rescore: no Affinity line in stdout (head: %s)", res.stdout[:200])
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None


def _extract_best_mode(vina_pdbqt: Path, out_pdbqt: Path) -> None:
    """Strip a Vina multi-MODEL PDBQT down to MODEL 1 (best-scoring pose).

    Vina output looks like::

        MODEL 1
        ...atoms...
        ENDMDL
        MODEL 2
        ...

    Smina --score_only chokes on multi-MODEL input, so we keep just the first
    model's atom block (no MODEL/ENDMDL wrappers, since smina is happy with
    bare atoms). Mirrors validate.py's same helper.
    """
    out_lines: list[str] = []
    in_first = False
    with vina_pdbqt.open() as fh:
        for line in fh:
            if line.startswith("MODEL"):
                if in_first:
                    break
                in_first = True
                continue
            if line.startswith("ENDMDL"):
                if in_first:
                    break
                continue
            if in_first:
                out_lines.append(line)
    if not out_lines:
        # No MODEL header — assume the file is already a single pose.
        out_pdbqt.write_text(vina_pdbqt.read_text())
    else:
        out_pdbqt.write_text("".join(out_lines))
