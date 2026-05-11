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
import math
import os
import random
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
    weight = 1.0 / (1.0 + math.exp(delta * 4))
    return abs(mutant_score) * weight


def _materialize_selectivity(
    session: Session,
    screening_id: int,
    compound_id: int,
) -> None:
    """Compute and persist Δ-vs-WT + selectivity_index for one compound's
    rows in a screening job. Called after every cell completes a dock so
    the columns are populated as soon as both the WT and mutant scores
    are available — no batch pass at the end.

    Strategy:
      1. Load every ScreeningResult for (screening_id, compound_id).
      2. Find the WT row's best_score (None if WT row isn't done yet).
      3. For each non-WT row that has a best_score, denormalize wt_score
         onto it, compute delta_score = mutant_score - wt_score, and
         compute selectivity_index from those two.
      4. Commit. Robust to re-runs — calling this twice produces the
         same values.

    Why denormalize onto the mutant row instead of computing on read:
    the results endpoint serves the page in a single SELECT … ORDER BY
    selectivity_index DESC. A self-join to compute Δ at read time would
    cost a full table scan per page load — fine for 100 rows, awful for
    10000. With this function running per-completion, the ORDER BY hits
    an index and the page renders instantly.

    The WT row itself never gets a delta/selectivity_index written; only
    mutant rows carry that data. The _result_to_out shaper makes WT
    rows surface delta=null which the UI treats as "this is the
    reference, not a Δ candidate".
    """
    rows = session.exec(
        select(ScreeningResult).where(
            ScreeningResult.screening_job_id == screening_id,
            ScreeningResult.compound_id == compound_id,
        )
    ).all()

    wt_row = next((r for r in rows if r.variant == "WT"), None)
    wt_score = wt_row.best_score if (wt_row and wt_row.status == "ok") else None

    dirty = False
    for r in rows:
        if r.variant == "WT":
            continue
        # Only enrich rows that have a real mutant score. Failed /
        # pending rows stay None.
        if r.status != "ok" or r.best_score is None:
            continue
        new_wt = wt_score
        new_delta = (r.best_score - wt_score) if wt_score is not None else None
        new_sel = _selectivity_index(r.best_score, wt_score)
        # Only write if changed — avoids spurious UPDATEs on idempotent
        # re-runs of the runner.
        if (r.wt_score != new_wt
                or r.delta_score != new_delta
                or r.selectivity_index != new_sel):
            r.wt_score = new_wt
            r.delta_score = new_delta
            r.selectivity_index = new_sel
            session.add(r)
            dirty = True

    if dirty:
        session.commit()


def _synthetic_score(variant: str, smiles: str) -> tuple[float, str]:
    """Deterministic but plausible synthetic score for dry-run mode.

    Real screening produces Vina kcal/mol scores typically in [-10, -4].
    For demo + integration testing we want:
      - WT scores spread realistically across that range
      - mutant scores correlated with WT but with a small Δ (some
        compounds tighter on mutant, some weaker)
      - Determinism: the same (variant, smiles) returns the same number
        so reruns are reproducible
      - One in ten cells flagged "outside_pocket" so the downstream UI
        treatment can be exercised even without real receptor geometry

    We seed Python's PRNG with hash((smiles, "wt"|"mut")) so the output
    is stable across runs. The seed key is intentionally NOT the raw
    variant because we want all non-WT variants to share the same
    baseline correlated with WT; only the Δ component varies.
    """
    rng = random.Random(hash((smiles, "wt-seed")))
    wt_score = round(rng.uniform(-9.5, -5.0), 2)
    if variant == "WT":
        return wt_score, ""
    rng_mut = random.Random(hash((smiles, variant)))
    # Δ skewed slightly negative so a useful fraction of mutant rows
    # appear "selective" — keeps the demo interesting instead of
    # showing a symmetric uniform distribution.
    delta = round(rng_mut.gauss(-0.2, 0.7), 2)
    mut_score = round(wt_score + delta, 2)
    # Synthetic extras — outside-pocket flag for ~10% of mutant rows so
    # the UI's parseExtra path is exercised.
    extras: list[str] = ["engine=synthetic"]
    if rng_mut.random() < 0.10:
        extras.append(f"mutation_outside_pocket={round(rng_mut.uniform(12.0, 25.0), 1)}A")
    return mut_score, "|".join(extras)


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
            # Dry-run mode (v1.14, #208): emit DETERMINISTIC SYNTHETIC scores
            # instead of marking every cell as skipped. The original behaviour
            # ("status=skipped on every cell, COMPLETED job with a 'not wired'
            # error_message") shipped the API but left the entire ranking
            # pipeline untested — Δ-vs-WT, selectivity_index, the sort, the
            # outside-pocket-flag treatment downstream, all of it.
            #
            # By generating plausible Vina-range numbers with a fixed seed
            # keyed on (smiles, variant), we make the ranking layer fully
            # exercisable end-to-end without any GPU. Once
            # LIGANX_SCREENING_DRY_RUN is flipped to 0 (post-4090 cutover),
            # the real-dock branch below replaces this loop with pod calls
            # that produce the SAME column shape — so the read path,
            # frontend rendering, and ordering keep working unchanged.
            #
            # We need the Compound row to seed the PRNG by SMILES, so pull
            # them in a single query keyed by compound_id.
            compound_ids = list({r.compound_id for r in rows})
            compounds_by_id: dict[int, Compound] = {}
            if compound_ids:
                for c in session.exec(
                    select(Compound).where(Compound.id.in_(compound_ids))
                ).all():
                    compounds_by_id[c.id] = c

            touched_compound_ids: set[int] = set()
            for r in rows:
                compound = compounds_by_id.get(r.compound_id)
                if compound is None:
                    # Shouldn't happen — submit handler creates the FK
                    # — but be defensive instead of crashing the run.
                    r.status = "failed"
                    r.error_message = "compound row missing"
                    session.add(r)
                    continue
                score, extra = _synthetic_score(r.variant, compound.smiles)
                r.best_score = score
                r.extra = extra or None
                r.status = "ok"
                r.error_message = None
                session.add(r)
                touched_compound_ids.add(r.compound_id)

            # Bump the job's progress counters to match — n_completed mirrors
            # how many cells have a real score, n_failed stays 0 unless we
            # hit the defensive branch above.
            sj = session.get(ScreeningJob, screening_id)
            if sj is not None:
                sj.n_completed = sum(1 for r in rows if r.status == "ok")
                sj.n_failed = sum(1 for r in rows if r.status == "failed")
                sj.updated_at = datetime.utcnow()
                session.add(sj)
            session.commit()

            # Materialize Δ + selectivity_index now that every cell has a
            # score. Run per-compound so the function's batching contract
            # stays the same as the real-dock path (which calls it after
            # each compound's final variant lands).
            for cid in touched_compound_ids:
                _materialize_selectivity(session, screening_id, cid)

            _set_job_status(
                session,
                screening_id,
                status=ScreeningStatus.COMPLETED,
                error_message=(
                    "Synthetic-score mode (LIGANX_SCREENING_DRY_RUN=1). "
                    "Scores are deterministic placeholders, not real Vina "
                    "calculations. Set LIGANX_SCREENING_DRY_RUN=0 after the "
                    "4090 cutover to enable real docks."
                ),
            )
            log.info(
                "screening %s completed in synthetic-score mode "
                "(%d compounds, %d cells, n_completed=%d, n_failed=%d)",
                screening_id,
                len(touched_compound_ids),
                len(rows),
                sj.n_completed if sj else 0,
                sj.n_failed if sj else 0,
            )
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
