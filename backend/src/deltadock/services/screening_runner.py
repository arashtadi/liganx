"""Screening runner — orchestrates library-scale docking.

Different shape from services/runner.py because the screening workload
diverges from /jobs in three ways:

  1. Receptor prep happens ONCE per (target, variant), not per compound.
     A 1000-compound screen would otherwise rebuild the FoldX mutant
     1000 times — wasteful. The runner caches the WT and mutant
     receptors after the first build, then streams compound SMILES
     through the pod's /dock endpoint with the cached receptor PDBQT.

  2. Per-cell ADMET runs through admet-ai on the pod once per unique
     SMILES (cached in the pod's sqlite). Same predicate-skip rule:
     RDKit parse fails → row marked status='failed', no ADMET attempted.

  3. Δ-vs-WT + selectivity_index are computed at result-write time,
     not in a follow-up pass. The result row carries everything the
     UI needs to render and sort — no joins, no recomputation. See
     services/runner.py for the full /jobs pipeline; that one cares
     about per-cell validation + ProLIF + PoseBusters because each
     /jobs cell goes through a deep analysis. /screening cells don't —
     the value is RANKING, not the per-cell deep dive.

Wiring status (2026-05-11): foundational skeleton only. Actual pod
docking is gated behind LIGANX_SCREENING_DRY_RUN=1 (default ON) until
the 4090 cutover is green — calling the pod from inside a 1000-cell
loop on the Blackwell pod (no GNINA CNN, slower than 4090) would lock
up the GPU for ~30+ min and starve /jobs traffic. After cutover, drop
the env var and the same code path lights up real docks.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime
from typing import Any, Optional

from sqlmodel import Session, select

from ..db import engine
from ..models import Compound, ScreeningJob, ScreeningResult, ScreeningStatus

log = logging.getLogger(__name__)


def _dry_run() -> bool:
    """Default ON until 4090 cutover lands. Set env LIGANX_SCREENING_DRY_RUN=0
    to enable real pod calls. Belt-and-suspenders: the in-process flag also
    protects against accidentally starting a 1000-compound screen on the
    Blackwell pod which can't keep up.
    """
    return os.environ.get("LIGANX_SCREENING_DRY_RUN", "1") not in ("0", "false", "False", "")


def _selectivity_index(mutant_score: Optional[float], wt_score: Optional[float]) -> Optional[float]:
    """Composite ranking metric.

    Pure Δ (mutant_score - wt_score) is the obvious sort key but it has a
    failure mode: a compound that barely binds either WT (-3.1) or mutant
    (-3.5) gets Δ=-0.4 and ranks above a compound that binds both well
    (WT -8.1, mutant -8.3, Δ=-0.2). The first compound is noise; the
    second is a real selective binder.

    selectivity_index = |mutant_score| * sigmoid(-Δ * 4)
                        ^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^
                        absolute affinity  selectivity weight (0..1)

    The sigmoid sharpens around Δ=0: small selectivity differences score
    near 0.5, strong selectivity (Δ < -0.5) saturates near 1.0. Multiplying
    by |mutant_score| pushes weak binders down regardless of their Δ.

    Returns None if either score is missing (WT-only screen or mutant
    failed). The results page sorts by selectivity_index DESC, then by
    best_score ASC as a tiebreaker.
    """
    if mutant_score is None:
        return None
    if wt_score is None:
        # WT-only screen — no Δ available, fall back to absolute affinity.
        return abs(mutant_score)
    delta = mutant_score - wt_score
    # sigmoid(-Δ * 4) — Δ < 0 (selective for mutant) → > 0.5 → 1.0
    #                  Δ > 0 (selective for WT)     → < 0.5 → 0.0
    # scale=4 gives the desired sharpness: Δ=-0.5 yields sigmoid(2)≈0.88,
    # Δ=-1.0 yields sigmoid(4)≈0.98 (effectively saturated).
    import math
    weight = 1.0 / (1.0 + math.exp(delta * 4))
    return abs(mutant_score) * weight


def _set_job_status(
    session: Session,
    screening_id: int,
    *,
    status: ScreeningStatus,
    error_message: Optional[str] = None,
) -> None:
    """Terminal-state writer that survives Postgres idle drops the same
    way services/runner.py does — see commit 9f6a217 for the postmortem
    on why every status write needs retry-with-rollback."""
    for attempt in range(3):
        try:
            sj = session.get(ScreeningJob, screening_id)
            if sj is None:
                log.warning("screening %s vanished mid-run", screening_id)
                return
            sj.status = status
            if error_message is not None:
                sj.error_message = error_message
            sj.updated_at = datetime.utcnow()
            session.add(sj)
            session.commit()
            return
        except Exception as e:
            log.warning("set_job_status attempt %d failed: %s", attempt, e)
            try:
                session.rollback()
            except Exception:
                pass
            time.sleep(0.5 * (attempt + 1))
    log.error("set_job_status exhausted retries for screening %s", screening_id)


def run_screening_in_background(screening_id: int) -> None:
    """Entry point dispatched from POST /screening via BackgroundTasks.

    Each run gets its own short-lived Session — long-lived sessions in a
    1000-cell loop hold a Postgres connection open through dozens of
    minutes of GPU work, defeating the pool. Re-open per-batch instead.
    """
    log.info("screening run %s starting (dry_run=%s)", screening_id, _dry_run())
    with Session(engine) as session:
        sj = session.get(ScreeningJob, screening_id)
        if sj is None:
            log.error("screening %s not found at run start", screening_id)
            return
        if sj.status not in (ScreeningStatus.PENDING, ScreeningStatus.RUNNING):
            log.info("screening %s already in terminal state %s; skipping", screening_id, sj.status)
            return
        sj.status = ScreeningStatus.RUNNING
        sj.updated_at = datetime.utcnow()
        session.add(sj)
        session.commit()

        # Pull the pre-staged ScreeningResult rows (one per (compound, variant)
        # pair, created at submit time so the progress bar has its denominator
        # immediately).
        rows = session.exec(
            select(ScreeningResult).where(ScreeningResult.screening_job_id == screening_id)
        ).all()

        if _dry_run():
            # Dry-run: mark everything as 'skipped' with a clear reason. Lets
            # us ship the API + UI integration before the GPU loop is wired.
            # After the 4090 cutover, set LIGANX_SCREENING_DRY_RUN=0 and the
            # real per-compound docking path below takes over.
            for r in rows:
                r.status = "skipped"
                r.error_message = (
                    "Screening engine not yet enabled on this deployment. "
                    "Set LIGANX_SCREENING_DRY_RUN=0 once the 4090 cutover ships."
                )
                session.add(r)
            session.commit()
            _set_job_status(
                session,
                screening_id,
                status=ScreeningStatus.COMPLETED,
                error_message=(
                    "Screening API live but execution disabled (dry-run mode). "
                    "Real docks light up after the 4090 + GNINA cutover."
                ),
            )
            log.info("screening %s completed in dry-run mode (%d cells skipped)", screening_id, len(rows))
            return

        # Real-dock path. Wired in the follow-up #207b commit after the
        # 4090 cutover lands and we can verify a 1000-cell loop doesn't
        # starve the GPU. Pseudo-code outline:
        #
        #   from ..config import get_settings
        #   from deltadock_pipeline.docking_quickvina_gpu import dock_one
        #   settings = get_settings()
        #   # Prep receptors ONCE per variant
        #   wt_receptor_pdbqt = prep_receptor(sj.pdb_id, sj.chain, mutations=[])
        #   mutant_receptor_pdbqt = prep_receptor(sj.pdb_id, sj.chain,
        #                                         mutations=sj.mutations.split(","))
        #   # Stream compounds through pod /dock
        #   for r in rows:
        #       compound = session.get(Compound, r.compound_id)
        #       receptor = wt_receptor_pdbqt if r.variant == "WT" else mutant_receptor_pdbqt
        #       score, pose_uri = dock_one(compound.smiles, receptor,
        #                                  exhaustiveness=sj.exhaustiveness,
        #                                  engine=sj.engine,
        #                                  pod_url=settings.pod_dock_url)
        #       r.best_score = score
        #       r.pose_uri = pose_uri
        #       r.status = "ok" if score is not None else "failed"
        #       # Side-effect: if both WT and mutant for this compound have
        #       # completed, compute the selectivity column on the mutant
        #       # row so the results page can sort without a self-join.
        #       _materialize_selectivity(session, r)
        #       session.commit()
        #       sj.n_completed += 1
        #       session.add(sj); session.commit()
        #
        # Until then, dry-run keeps the API observable end-to-end.
        log.warning(
            "screening %s reached real-dock path but execution is not wired yet; "
            "marking as failed to surface the gap clearly",
            screening_id,
        )
        _set_job_status(
            session,
            screening_id,
            status=ScreeningStatus.FAILED,
            error_message="Screening real-dock path not yet wired — see services/screening_runner.py",
        )
