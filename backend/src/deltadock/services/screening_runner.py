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
        # WT dock failed (or this is a WT-only screen) — there is no Δ to
        # compute, so no honest selectivity ranking is possible. Returning
        # None tells the results page to sort these rows to the bottom and
        # surface a "WT failed" badge instead of inventing a number from
        # |mut_score| alone. Older builds returned abs(mutant_score) here,
        # which inflated rankings for one-sided rows — found in the May
        # 2026 audit; see #245.
        return None
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

        # Real-dock path (v1.20). Wired end-to-end: prep receptors per
        # variant once, dock each (compound, variant) cell through the pod
        # /dock endpoint, write scores back, materialize selectivity
        # per-compound. 10-compound cap until the 4090 cutover ships
        # because the shared production pod also serves /jobs traffic.
        _run_real_screening(session, sj, rows)


# ──────────────────────────────────────────────────────────────────────
# Real-dock implementation (v1.20 / #227)
# ──────────────────────────────────────────────────────────────────────

# Hard cap on compounds per real-dock screening until the 4090 pod is
# the dedicated screening node. Above this, every compound docks ≥1
# variant ≈ 5-15s on the pod, so 10 compounds × 3 variants = 30 cells
# ≈ 2.5-7 minutes wall time, which is the longest we want to block the
# shared /jobs queue. The cap is enforced in the runner; the schema
# limit is 2000 (room to grow). Keep them mismatched on purpose —
# raising this constant only requires a code change, not a deploy of
# the schema or migration.
_REAL_DOCK_COMPOUND_CAP = 10


def _prep_receptor_for_variant(
    pdb_id: str,
    chain: str,
    variant: str,
):
    """Resolve a receptor PDBQT path for a (pdb_id, chain, variant).

    Reuses the same on-disk caches that services/runner.py uses
    (RECEPTOR_CACHE, PDB_CACHE, FOLDX_CACHE) so a screening run on
    the same target as a recent /jobs run pays zero prep cost.

    Returns: tuple of (receptor_pdbqt_path: Path, clean_pdb_path: Path
    or None, foldx_ddg: float or None). Raises RuntimeError on failure
    (caller logs + fails the row).
    """
    from pathlib import Path
    from .runner import RECEPTOR_CACHE, PDB_CACHE, FOLDX_CACHE
    from deltadock_pipeline.fetch import fetch_pdb
    from deltadock_pipeline.prep import fix_pdb, prepare_receptor

    PDB_CACHE.mkdir(parents=True, exist_ok=True)
    RECEPTOR_CACHE.mkdir(parents=True, exist_ok=True)

    # Step 1: raw PDB.
    raw_pdb = fetch_pdb(pdb_id, PDB_CACHE)

    # Step 2: cleaned WT PDB.
    clean_wt = PDB_CACHE / f"{pdb_id}_{chain}.clean.pdb"
    if not clean_wt.exists():
        fix_pdb(raw_pdb, clean_wt, chain=chain)

    # Step 3: receptor PDBQT path.
    receptor_path = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{variant}.pdbqt"
    clean_for_variant: Path | None = None
    foldx_ddg: float | None = None

    if variant == "WT":
        if not receptor_path.exists():
            prepare_receptor(clean_wt, receptor_path)
        clean_for_variant = clean_wt
        return receptor_path, clean_for_variant, foldx_ddg

    # Mutant path — build via FoldX if the PDBQT is missing.
    if not receptor_path.exists():
        FOLDX_CACHE.mkdir(parents=True, exist_ok=True)
        try:
            from deltadock_pipeline.foldx import build_mutant, FoldXError
            from ..config import get_settings
            settings = get_settings()
            foldx_path = settings.foldx_path
            mutant = build_mutant(
                pdb_path=clean_wt,
                chain=chain,
                mutation_code=variant,
                out_dir=FOLDX_CACHE,
                foldx_path=foldx_path,
                cache_dir=FOLDX_CACHE,
            )
            # build_mutant returns FoldXResult (dataclass), not dict.
            # Attribute access — see foldx.py lines 36-41 for the shape.
            # Runner.py line 1505+ uses the same access pattern.
            mutant_pdb = Path(mutant.mutant_pdb)
            foldx_ddg = mutant.ddg_kcal_mol
            clean_mutant = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{variant}.clean.pdb"
            fix_pdb(mutant_pdb, clean_mutant, chain=chain)
            prepare_receptor(clean_mutant, receptor_path)
            clean_for_variant = clean_mutant
        except FoldXError as e:
            # FoldX can fail when the residue isn't in the structure —
            # surface a clear error so the runner can mark the cells
            # for this variant as "failed" rather than crashing the whole
            # screening.
            raise RuntimeError(f"FoldX build failed for {variant}: {e}") from e
        except Exception as e:
            raise RuntimeError(f"Mutant prep failed for {variant}: {e}") from e
    else:
        clean_for_variant = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{variant}.clean.pdb"
        if not clean_for_variant.exists():
            clean_for_variant = None

    return receptor_path, clean_for_variant, foldx_ddg


def _resolve_pocket_box(pdb_id: str, chain: str):
    """Return a PocketBox for the docking target.

    Prefer catalog-curated pocket coordinates when present; fall back
    to auto-detect via `deltadock_pipeline.pocket.detect_pocket` for
    ad-hoc PDB targets the user picked via the RCSB search. Same
    precedence runner.py uses.
    """
    from deltadock_pipeline.dock import PocketBox
    from deltadock_pipeline.fetch import fetch_pdb
    from .runner import PDB_CACHE
    from ..catalog import CATALOG
    # Try catalog first — curated pockets are more reliable than
    # detect_pocket, which can drift on weak co-crystal ligands.
    for target in CATALOG:
        if target.pdb_id.upper() == pdb_id.upper():
            return PocketBox(
                center_x=target.pocket.center[0],
                center_y=target.pocket.center[1],
                center_z=target.pocket.center[2],
                size_x=target.pocket.size[0],
                size_y=target.pocket.size[1],
                size_z=target.pocket.size[2],
            )
    # Ad-hoc PDB — auto-detect.
    from deltadock_pipeline.pocket import detect_pocket
    raw_pdb = fetch_pdb(pdb_id, PDB_CACHE)
    detected = detect_pocket(raw_pdb, chain=chain)
    if detected is None:
        # Last resort — a wide centered box. Won't dock anything
        # meaningful, but won't crash the run either.
        return PocketBox(
            center_x=0.0, center_y=0.0, center_z=0.0,
            size_x=22.5, size_y=22.5, size_z=22.5,
        )
    return PocketBox(
        center_x=detected.center[0],
        center_y=detected.center[1],
        center_z=detected.center[2],
        size_x=22.5, size_y=22.5, size_z=22.5,
    )


def _run_real_screening(
    session: Session,
    sj: ScreeningJob,
    rows: list[ScreeningResult],
) -> None:
    """Heavy lift — real Vina docking for every (compound, variant) pair.

    Strategy:
      1. Pull compounds by id into a dict.
      2. Group rows by variant — prep receptor once per variant, then
         dock each compound against it.
      3. Per cell: prepare ligand PDBQT (per-screening tmp dir, NOT
         cached — ligand prep is cheap and SMILES-cached on the pod
         already), call dock_one_pod, write result row.
      4. After every compound completes all its variants, call
         _materialize_selectivity so selectivity_index lands on the
         mutant rows as soon as their WT pair is done.
      5. Cancellation check at variant boundaries (cheap re-read of
         status from DB).
      6. On any failure, row goes to status='failed' + error_message;
         the screening continues — one bad compound shouldn't kill
         9 others.
      7. Counters (n_completed, n_failed) are updated as cells finish.
    """
    import tempfile
    from pathlib import Path

    from ..config import get_settings
    from deltadock_pipeline.pod_dock import dock_one_pod, PodDockConfig, PodDockError
    from deltadock_pipeline.prep import prepare_ligand

    settings = get_settings()

    # Defensive: cap compounds at the runner-side ceiling. The screening
    # was already pre-staged at submit time, so if the user submitted
    # 11 compounds we'd have 11+ result rows. Run only the first
    # _REAL_DOCK_COMPOUND_CAP and mark the rest as skipped with a
    # clear reason.
    compound_ids = list({r.compound_id for r in rows})
    if len(compound_ids) > _REAL_DOCK_COMPOUND_CAP:
        log.warning(
            "screening %s has %d compounds; real-dock cap is %d. "
            "Marking overflow as skipped.",
            sj.id, len(compound_ids), _REAL_DOCK_COMPOUND_CAP,
        )
        kept = set(compound_ids[:_REAL_DOCK_COMPOUND_CAP])
        for r in rows:
            if r.compound_id not in kept:
                r.status = "skipped"
                r.error_message = (
                    f"Compound beyond {_REAL_DOCK_COMPOUND_CAP}-compound cap "
                    "for real-dock screening. Re-submit in smaller batches."
                )
                session.add(r)
        session.commit()
        compound_ids = list(kept)

    # Pull Compound rows by id.
    compounds_by_id: dict[int, Compound] = {}
    for c in session.exec(
        select(Compound).where(Compound.id.in_(compound_ids))
    ).all():
        compounds_by_id[c.id] = c

    # Group rows by variant for efficient receptor reuse.
    variants_in_play = sorted({r.variant for r in rows}, key=lambda v: 0 if v == "WT" else 1)

    # Pod config.
    pod_cfg = PodDockConfig(
        base_url=(settings.pod_dock_url or "").rstrip("/"),
        timeout_s=settings.pod_dock_timeout_s,
    )
    if not pod_cfg.base_url:
        _set_job_status(
            session, sj.id,
            status=ScreeningStatus.FAILED,
            error_message="POD_DOCK_URL not configured on this deployment.",
        )
        return

    # Box once per target (variants share the same pocket).
    try:
        box = _resolve_pocket_box(sj.pdb_id, sj.chain)
    except Exception as e:
        log.exception("screening %s: pocket box resolution failed", sj.id)
        _set_job_status(
            session, sj.id,
            status=ScreeningStatus.FAILED,
            error_message=f"Couldn't resolve docking box for {sj.pdb_id}: {e}",
        )
        return

    # Track which compounds had at least one variant succeed so we
    # know when to materialize selectivity (after their last variant
    # in the loop finishes).
    docked_per_compound: dict[int, set[str]] = {cid: set() for cid in compound_ids}
    target_variants = set(variants_in_play)

    with tempfile.TemporaryDirectory(prefix=f"screen-{sj.id}-") as tmp:
        work = Path(tmp)
        # Ligand PDBQT cache by compound_id (cheap, but we'd rather not
        # re-prepare the same SMILES every variant). Keys are
        # compound_id; values are Path to the prepared PDBQT, or
        # None if prep failed.
        ligand_paths: dict[int, Path | None] = {}

        for variant in variants_in_play:
            # Cancellation check before each variant's prep.
            # session.get returns the cached identity-map object — the cancel
            # endpoint commits from a DIFFERENT Session, so we'd never see
            # the new status without expiring our cache first. Expire +
            # re-read forces a SELECT.
            session.expire(sj)
            sj_fresh = session.get(ScreeningJob, sj.id)
            if sj_fresh is None or sj_fresh.status == ScreeningStatus.CANCELLED:
                log.info("screening %s cancelled mid-run; bailing.", sj.id)
                return

            log.info("screening %s: prepping receptor for variant %s", sj.id, variant)
            try:
                receptor_path, _clean, foldx_ddg = _prep_receptor_for_variant(
                    sj.pdb_id, sj.chain, variant,
                )
            except Exception as e:
                log.warning(
                    "screening %s: receptor prep failed for %s: %s; "
                    "marking all %s cells as failed",
                    sj.id, variant, e, variant,
                )
                for r in rows:
                    if r.variant == variant and r.status == "pending":
                        r.status = "failed"
                        r.error_message = f"receptor_prep_failed: {e}"
                        session.add(r)
                session.commit()
                continue

            # Dock each compound against this variant.
            for r in rows:
                if r.variant != variant or r.status != "pending":
                    continue
                if r.compound_id not in compounds_by_id:
                    r.status = "failed"
                    r.error_message = "compound row missing"
                    session.add(r)
                    session.commit()
                    continue
                compound = compounds_by_id[r.compound_id]

                # Per-cell cancellation check. Same identity-map caveat
                # as the variant-boundary check above — expire to force
                # a real SELECT so we actually see a concurrent cancel.
                session.expire(sj)
                sj_fresh = session.get(ScreeningJob, sj.id)
                if sj_fresh is None or sj_fresh.status == ScreeningStatus.CANCELLED:
                    log.info("screening %s cancelled mid-cell; bailing.", sj.id)
                    return

                # Ligand prep (cached per-compound in this run).
                if compound.id not in ligand_paths:
                    lig_path: Path | None = None
                    try:
                        lig_path = work / f"lig_{compound.id}.pdbqt"
                        prepare_ligand(compound.smiles, lig_path, name=compound.name or "compound")
                    except Exception as e:
                        ligand_paths[compound.id] = None
                        # Mark THIS cell as failed; we'll fail this compound's
                        # remaining variants below when we hit them too.
                        r.status = "failed"
                        r.error_message = f"ligand_prep_failed: {e}"
                        session.add(r)
                        session.commit()
                        continue
                    ligand_paths[compound.id] = lig_path
                else:
                    lig_path = ligand_paths[compound.id]
                    if lig_path is None:
                        # We already failed prep for this compound on an earlier variant.
                        r.status = "failed"
                        r.error_message = "ligand_prep_failed (earlier variant)"
                        session.add(r)
                        session.commit()
                        continue

                # Per-cell working dir for the pod call.
                cell_dir = work / f"cell_{compound.id}_{variant}"
                cell_dir.mkdir(parents=True, exist_ok=True)
                try:
                    dock_result = dock_one_pod(
                        receptor_pdbqt=receptor_path,
                        ligand_pdbqt=lig_path,
                        box=box,
                        work_dir=cell_dir,
                        cfg=pod_cfg,
                        exhaustiveness=sj.exhaustiveness or 4,
                        num_modes=9,
                        seed=42,
                        # thread = OpenCL work-item count for QuickVina-GPU
                        # (NOT a CPU thread count). 8000 matches the pod's
                        # default + what services/runner.py uses for /jobs.
                        thread=8000,
                    )
                    best_score = dock_result.best_score
                    pose_uri = None
                    # Persist pose via pose_store so the JobPage-style
                    # pose viewer would work on a future
                    # /screening/:share_id/pose endpoint.
                    try:
                        from .pose_store import get_pose_store
                        # kind="screening" namespaces this file separately
                        # from /jobs writes. Otherwise Job.id=N and
                        # ScreeningJob.id=N collide on the same pose key
                        # — silent data loss, found in May 2026 audit #252.
                        pose_uri = get_pose_store().write(
                            sj.id, compound.id, variant, Path(dock_result.pose_pdbqt),
                            kind="screening",
                        )
                    except Exception as e:
                        log.warning("screening %s: pose store write failed for %s/%s: %s",
                                    sj.id, compound.id, variant, e)

                    r.best_score = best_score
                    r.pose_uri = pose_uri
                    r.status = "ok"
                    r.error_message = None
                    # Pipe-delimited extras matching DockingResult.extra
                    # so AI panel + UI flag parsing reuses the same code.
                    parts = ["engine=pod_real"]
                    if foldx_ddg is not None and variant != "WT":
                        parts.append(f"foldx_ddg={foldx_ddg:.3f}")
                    r.extra = "|".join(parts)
                    session.add(r)
                    docked_per_compound[compound.id].add(variant)
                except PodDockError as e:
                    r.status = "failed"
                    r.error_message = f"docking_failed: {e}"
                    session.add(r)
                except Exception as e:
                    r.status = "failed"
                    r.error_message = f"docking_failed: {e}"
                    session.add(r)

                # Commit each cell so progress is visible from the
                # frontend's polling. Use _commit_retry-style guard
                # so a single Postgres idle-drop doesn't poison the
                # whole screening.
                try:
                    session.commit()
                except Exception as e:
                    log.warning("screening %s: cell commit failed: %s; rolling back + retrying",
                                sj.id, e)
                    try: session.rollback()
                    except Exception: pass
                    try: session.commit()
                    except Exception: pass

                # Bump counters.
                sj_obj = session.get(ScreeningJob, sj.id)
                if sj_obj is not None:
                    if r.status == "ok":
                        sj_obj.n_completed = (sj_obj.n_completed or 0) + 1
                    elif r.status == "failed":
                        sj_obj.n_failed = (sj_obj.n_failed or 0) + 1
                    sj_obj.updated_at = datetime.utcnow()
                    session.add(sj_obj)
                    try: session.commit()
                    except Exception:
                        try: session.rollback()
                        except Exception: pass

                # If this compound has now docked every variant it was
                # supposed to, materialize its selectivity index. We
                # check the FULL variant set so partial completion (one
                # variant failed) still triggers a materialize call —
                # the function handles missing scores gracefully.
                done_for_compound = docked_per_compound.get(compound.id, set())
                if done_for_compound and done_for_compound | {r.variant} >= target_variants:
                    try:
                        _materialize_selectivity(session, sj.id, compound.id)
                    except Exception as e:
                        log.warning(
                            "screening %s: materialize_selectivity for compound %s failed: %s",
                            sj.id, compound.id, e,
                        )

    # End of variant loop. Final pass to materialize selectivity for
    # any compound we missed (defensive — the per-cell trigger above
    # should already have covered them).
    for cid in compound_ids:
        try:
            _materialize_selectivity(session, sj.id, cid)
        except Exception as e:
            log.warning("screening %s: late materialize for %s failed: %s", sj.id, cid, e)

    # Final status.
    sj_final = session.get(ScreeningJob, sj.id)
    any_ok = any(r.status == "ok" for r in rows)
    if sj_final is not None and sj_final.status == ScreeningStatus.CANCELLED:
        return
    final_status = ScreeningStatus.COMPLETED if any_ok else ScreeningStatus.FAILED
    final_msg = None if any_ok else "All cells failed — see per-row error_message for details."
    _set_job_status(session, sj.id, status=final_status, error_message=final_msg)
    log.info(
        "screening %s: real-dock loop complete. compounds=%d, variants=%s, "
        "ok=%d, failed=%d, skipped=%d",
        sj.id, len(compound_ids), list(target_variants),
        sum(1 for r in rows if r.status == "ok"),
        sum(1 for r in rows if r.status == "failed"),
        sum(1 for r in rows if r.status == "skipped"),
    )
