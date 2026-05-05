"""Pocket-best pose selection for docking calls.

Background — 2026-05-04
~~~~~~~~~~~~~~~~~~~~~~~
Quick Dock (`services/quick_dock.py`) hardens against off-pocket Vina
draws by re-rolling up to 3 times and picking the pose closest to the
pocket-box centroid (commit 01cd66d region). The full-job runner
(`services/runner.py`) called `dock_one_pod` / `dock_batch_pod` once
and trusted whatever single pose came back — so a compound that
scored -10.80 in-pocket via Quick Dock could turn into Skipped /
outside-pocket in the full job because the single Vina draw drifted
to the protein surface.

This module brings the full-job paths up to Quick Dock parity by
exposing the same 3× pocket-best loop as a shared primitive.

Design
~~~~~~
Cost-aware retry: the first dock always runs. If the resulting pose
is in-pocket (offset ≤ _POSE_DRIFT_THRESHOLD_A), we return immediately
— no extra cost on the happy path (~50-70% of cells). Only when the
first pose drifts do we re-roll up to 2 more times (varying the Vina
seed each time) and pick the best-scoring pose with offset ≤ threshold.
If no attempt lands in-pocket, we return the best-scoring overall and
flag pose_in_pocket=False so the caller can label the result honestly.

Median per-cell overhead: +33% (8s vs 6s baseline) — much less than
3× because most cells dock in-pocket on the first try. For a
100-compound × 3-variant job this is +15 minutes of wall time —
worth it for "Quick Dock and full job agree", which is the moat for
trust in the platform.

Wiring
~~~~~~
Used from:
  - services/runner.py legacy per-cell path (line ~1727):
      result = dock_one_with_pocket_best(dock_one_pod, ..., box=box, ...)
  - services/runner.py batch-fallback path (line ~1580): same wrapper
  - services/runner.py batched path (line ~1552): post-process the
    BatchDockResult list with `pocket_best_post_filter()` to re-roll
    just the off-pocket cells via dock_one_pod (preserves the batch
    throughput win for in-pocket cells).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

# Reuse the existing helper rather than duplicating the parser. Living
# in quick_dock keeps it next to the editor's drift-badge code; if the
# pose-format ever changes we update one place.
from .quick_dock import compute_pose_offset_a

log = logging.getLogger(__name__)


# Distance from pose centroid to pocket-box center beyond which a
# pose is considered "drifted off-pocket". Calibrated against the
# canonical 22-Å docking box: at 6 Å the pose can still touch real
# pocket residues; beyond that it's almost always sitting on the
# protein surface. Mirrors quick_dock.py's _POSE_DRIFT_THRESHOLD_A.
_POSE_DRIFT_THRESHOLD_A = 6.0

# Total attempts including the first dock. 3 is enough — in practice,
# if a ligand can't land in pocket in 3 stochastic Vina draws the
# pocket-box geometry is usually wrong (catalog-edit territory), not
# something more retries can salvage. Same constant as quick_dock.
_MAX_POCKET_RETRIES = 3

# Seed used on the FIRST dock attempt. Subsequent retries use seed +
# attempt_index so each draw is reproducible but distinct. We keep the
# first seed equal to the legacy default so existing single-attempt
# happy-path behaviour is bit-for-bit identical to what the runner
# produced before this filter existed.
_BASE_SEED = 42


@dataclass
class PocketBestMetadata:
    """Accounting attached to every pocket-best dock so the caller can
    surface the retry behavior in engine labels and UI tooltips.

    - attempts: how many actual dock calls happened (1, 2, or 3).
    - pose_offset_a: centroid-to-box-center distance of the chosen pose.
    - pose_in_pocket: True iff offset ≤ _POSE_DRIFT_THRESHOLD_A.
    - retried: True iff attempts > 1 (sugar; the engine-label suffix
      builder uses this).
    """

    attempts: int
    pose_offset_a: float
    pose_in_pocket: bool

    @property
    def retried(self) -> bool:
        return self.attempts > 1


def dock_one_with_pocket_best(
    dock_fn: Callable[..., Any],
    *,
    box,
    work_dir: Path | str,
    **dock_kwargs: Any,
) -> tuple[Any, PocketBestMetadata]:
    """Wrap a single-ligand docking call with the 3× pocket-best loop.

    Parameters
    ----------
    dock_fn : Callable
        The underlying docking primitive. Must accept ``box``, ``work_dir``,
        and ``seed`` kwargs (or positional equivalents) and return an
        object with a ``pose_pdbqt: Path`` attribute and ``modes`` list
        whose first entry has ``affinity_kcal_mol``. ``dock_one_pod``,
        ``dock_one_gnina``, and ``dock_one_runpod`` all match this shape.
    box : PocketBox
        The pocket box passed to the docking call. Its ``center_x/y/z``
        define the pocket center we measure pose-drift against.
    work_dir : Path | str
        Per-cell working directory. Each retry writes its pose into a
        sub-directory ``attempt_<N>/`` so the chosen attempt's pose
        file remains stable across retries (the caller-visible result
        path doesn't change).
    **dock_kwargs
        Forwarded to ``dock_fn``. The ``seed`` kwarg is overwritten by
        this wrapper on each attempt; pass the rest unchanged.

    Returns
    -------
    (DockingResult, PocketBestMetadata)
        The chosen pose and the accounting needed to label the engine.
    """
    work_dir = Path(work_dir)
    box_center = (box.center_x, box.center_y, box.center_z)

    attempts: list[tuple[Any, float]] = []
    last_exc: Exception | None = None

    for attempt_idx in range(_MAX_POCKET_RETRIES):
        seed = _BASE_SEED + attempt_idx
        # Per-attempt subdir keeps the previous attempt's pose file from
        # being overwritten — useful for post-mortem on weird drifts.
        attempt_dir = work_dir / f"attempt_{attempt_idx + 1}"
        attempt_dir.mkdir(parents=True, exist_ok=True)
        try:
            result = dock_fn(box=box, work_dir=attempt_dir, seed=seed, **dock_kwargs)
        except Exception as e:  # noqa: BLE001
            # Underlying docker errored on this attempt. Note it and
            # try the next seed — sometimes vina-gpu chokes on a
            # specific seed but happily docks the same ligand with a
            # neighbouring one.
            log.info(
                "pocket_best: attempt %d/%d errored — %s",
                attempt_idx + 1, _MAX_POCKET_RETRIES, e,
            )
            last_exc = e
            continue
        offset = compute_pose_offset_a(pose_pdbqt=result.pose_pdbqt, box_center=box_center)
        attempts.append((result, offset))
        log.info(
            "pocket_best: attempt %d/%d → offset=%.2f Å, score=%.2f kcal/mol",
            attempt_idx + 1,
            _MAX_POCKET_RETRIES,
            offset,
            result.modes[0].affinity_kcal_mol if result.modes else 0.0,
        )
        # Happy path: first in-pocket attempt — exit immediately and
        # don't burn extra GPU time. Most cells go through this branch.
        if offset <= _POSE_DRIFT_THRESHOLD_A:
            return result, PocketBestMetadata(
                attempts=attempt_idx + 1,
                pose_offset_a=offset,
                pose_in_pocket=True,
            )

    # No attempt succeeded at all (every dock_fn call raised). Surface
    # the most recent exception so the caller's existing error path
    # records the right reason in the DB.
    if not attempts:
        if last_exc is not None:
            raise last_exc
        # Defensive: shouldn't happen because last_exc is always set
        # when attempts is empty, but guard against future refactors.
        raise RuntimeError("pocket_best: zero successful attempts and no captured exception")

    # All attempts succeeded but none landed in-pocket. Rank by score
    # FIRST (best binding wins); break ties by smallest offset. This
    # gives the caller the most defensible pose to label "outside
    # pocket" — at least the score is the best Vina could find.
    attempts.sort(key=lambda pair: (pair[0].modes[0].affinity_kcal_mol, pair[1]))
    best_result, best_offset = attempts[0]
    log.warning(
        "pocket_best: all %d attempts drifted off-pocket "
        "(best offset=%.2f Å > threshold %.1f); returning best-scoring pose",
        len(attempts), best_offset, _POSE_DRIFT_THRESHOLD_A,
    )
    return best_result, PocketBestMetadata(
        attempts=len(attempts),
        pose_offset_a=best_offset,
        pose_in_pocket=False,
    )


def engine_label_with_attempts(base: str, meta: PocketBestMetadata) -> str:
    """Build the engine-label string the runner records on each cell.

    Sugar so the runner doesn't have to inline the formatting in
    multiple places. Examples:
      - in-pocket on first try → "pod_gpu" (unchanged)
      - in-pocket after 2 attempts → "pod_gpu_retried_2"
      - 3 attempts all drifted → "pod_gpu_retried_3_off_pocket"
    """
    if not meta.retried and meta.pose_in_pocket:
        return base
    suffix = f"_retried_{meta.attempts}"
    if not meta.pose_in_pocket:
        suffix += "_off_pocket"
    return base + suffix
