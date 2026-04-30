"""Job runner.

Phase 1.5: real Vina docking, in-process.

For each (compound, variant) pair:
  - fetch the WT PDB (cached)
  - prepare receptor (PDBFixer + Open Babel → PDBQT)
  - prepare ligand (RDKit + Meeko → PDBQT)
  - dock with AutoDock Vina

Mutations aren't actually applied to the structure yet — that lands in Phase 3
(FoldX BuildModel). For now mutant docking uses the WT structure but the variant
column is preserved in the DB so the matrix layout works end-to-end.

If Vina or Meeko aren't installed, falls back to the deterministic placeholder
so the UI stays functional in dev environments without the binaries.
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

from sqlmodel import Session, select

from ..catalog import get_target
from ..config import get_settings
from ..db import engine
from ..models import Compound, DockingResult, Job, JobStatus

log = logging.getLogger(__name__)
settings = get_settings()

# Cache roots — env-overridable so production can put them on the mounted
# Fly volume (/var/lib/liganx) instead of the OverlayFS upper layer (~/.deltadock).
# When LIGANX_CACHE_ROOT is unset (dev), files land under ~/.deltadock as
# before. When set (prod), all cleaned receptors and FoldX scratch live on
# the persistent volume so they survive redeploys. The 3D viewer at
# GET /structures/{pdb}/{chain}/{variant} reads from the same root.
_CACHE_ROOT = Path(settings.cache_root) if settings.cache_root else Path.home() / ".deltadock"
RECEPTOR_CACHE = _CACHE_ROOT / "receptors"
PDB_CACHE = _CACHE_ROOT / "pdb"
FOLDX_CACHE = _CACHE_ROOT / "foldx-cache"
# Persistent pose cache — runner's tmpdir gets cleaned, but the API needs poses
# to outlive the run so users can re-open jobs and the 3D viewer still works.
# In production this is overridden by `pose_cache_dir` (Fly.io volume mount);
# in dev it stays under ~/.deltadock so existing rows keep resolving without
# a data migration. See also services/pose_store.py for the R2 abstraction
# that supersedes this directory when R2 is configured.
POSE_CACHE = (
    Path(settings.pose_cache_dir) if settings.pose_cache_dir
    else _CACHE_ROOT / "poses"
)
FOLDX_PATH = os.environ.get("FOLDX_PATH", str(Path.home() / ".local" / "bin" / "foldx"))


def _real_pipeline_available() -> tuple[bool, str | None]:
    """Check that all the binaries needed for real docking are present."""
    if not shutil.which(settings.vina_path):
        return False, f"vina binary not found ({settings.vina_path!r})"
    if not shutil.which("obabel"):
        return False, "obabel not on PATH"
    if not shutil.which("mk_prepare_ligand.py"):
        return False, "mk_prepare_ligand.py not on PATH"
    try:
        import rdkit  # noqa: F401
        import meeko  # noqa: F401
        from pdbfixer import PDBFixer  # noqa: F401
    except ImportError as e:
        return False, f"missing python dep: {e}"
    return True, None


def _foldx_available() -> bool:
    """Whether real mutation building is wired up. If False, mutants get docked
    against the WT receptor with an explicit warning recorded on each result."""
    return shutil.which(FOLDX_PATH) is not None


def _run_crossdock_in_background(pdb_id: str, chain: str) -> None:
    """Self-dock the bound co-crystal ligand for this (pdb_id, chain) and
    cache the heavy-atom RMSD-vs-crystal as a 'PDB quality' badge.

    Runs entirely off the request thread so it never blocks user-facing
    docking. Cached on disk in ~/.deltadock/crossdock-cache/ — every later
    job for the same (pdb_id, chain) hits the cache instantly.

    On any failure (apo structure, ligand prep crash, etc.) we silently
    skip; the JobPage header just doesn't show the quality badge — better
    than a noisy error. The check is informational, not on the critical
    path of producing a docking score.
    """
    try:
        import tempfile
        from pathlib import Path as _Path
        from datetime import datetime as _dt
        from deltadock_pipeline.crossdock import (
            CrossDockResult, extract_cocrystal_ligand, heavy_atom_rmsd,
            save_cached, verdict_from_rmsd,
        )
        from deltadock_pipeline.fetch import fetch_pdb
        from deltadock_pipeline.prep import fix_pdb, prepare_ligand, prepare_receptor
        from deltadock_pipeline.dock import dock_one
        from deltadock_pipeline.pocket import detect_pocket

        raw_pdb = fetch_pdb(pdb_id, PDB_CACHE)
        info = extract_cocrystal_ligand(raw_pdb, chain=chain)
        if info is None:
            log.info("crossdock %s/%s: no co-crystal ligand", pdb_id, chain)
            return

        # Reuse the existing receptor cache; if it's not there yet, do the
        # cleanup ourselves. fix_pdb is idempotent on its output path.
        clean_pdb = PDB_CACHE / f"{pdb_id}_{chain}.clean.pdb"
        if not clean_pdb.exists():
            fix_pdb(raw_pdb, clean_pdb, chain=chain)
        receptor = RECEPTOR_CACHE / f"{pdb_id}_{chain}_WT.pdbqt"
        if not receptor.exists():
            RECEPTOR_CACHE.mkdir(parents=True, exist_ok=True)
            prepare_receptor(clean_pdb, receptor)

        pocket = detect_pocket(raw_pdb, chain=chain)
        if pocket is None:
            log.info("crossdock %s/%s: no pocket centroid — skipping", pdb_id, chain)
            return

        # Box: 22.5 Å cube centred on the ligand centroid, matching what the
        # main runner uses for auto-detected pockets. dock_one expects a
        # PocketBox dataclass (center_x/y/z + size_x/y/z) — passing a dict
        # silently AttributeErrors deep inside the Vina argv builder.
        from deltadock_pipeline.dock import PocketBox
        box = PocketBox(
            center_x=pocket.center[0], center_y=pocket.center[1], center_z=pocket.center[2],
            size_x=22.5, size_y=22.5, size_z=22.5,
        )

        with tempfile.TemporaryDirectory(prefix=f"xdock-{pdb_id}-") as td:
            work = _Path(td)
            lig_pdbqt = work / "ligand.pdbqt"
            try:
                prepare_ligand(info["smiles"], lig_pdbqt)
            except Exception as e:
                log.info("crossdock %s/%s: ligand prep failed: %s", pdb_id, chain, e)
                return

            # Cheap exhaustiveness — we just need a position estimate, not
            # a publication-quality pose. 8 = matches the user's default.
            settings = get_settings()
            result = dock_one(
                receptor_pdbqt=receptor,
                ligand_pdbqt=lig_pdbqt,
                box=box,
                work_dir=work,
                exhaustiveness=8,
                num_modes=9,
                vina_path=settings.vina_path,
            )

            # Convert best mode of the docked PDBQT to SDF, then RMSD-compare
            # against the crystal PDB we extracted earlier.
            from deltadock_pipeline.validate import _convert, _extract_best_mode
            best = work / "best.pdbqt"
            _extract_best_mode(result.pose_pdbqt, best)
            docked_sdf = work / "docked.sdf"
            _convert(best, docked_sdf)

            rmsd = heavy_atom_rmsd(docked_sdf, _Path(info["lig_pdb_path"]))
            if rmsd is None:
                log.info("crossdock %s/%s: RMSD calc failed", pdb_id, chain)
                return

            res = CrossDockResult(
                pdb_id=pdb_id,
                chain=chain,
                ligand_resname=info["resname"],
                rmsd_angstroms=round(rmsd, 2),
                verdict=verdict_from_rmsd(rmsd),
                smiles=info["smiles"],
                crystal_atom_count=info["atom_count"],
                docked_atom_count=info["atom_count"],
                timestamp=_dt.utcnow().isoformat(),
            )
            save_cached(res)
            log.info(
                "crossdock %s/%s: %s ligand RMSD=%.2f Å (%s)",
                pdb_id, chain, info["resname"], rmsd, res.verdict,
            )
    except Exception as e:
        log.warning("crossdock background failed for %s/%s: %s", pdb_id, chain, e)


class JobCancelled(Exception):
    """Raised by the runner's per-cell cancellation check when a user has
    flipped this job's status to CANCELLED via POST /jobs/{key}/cancel.
    Propagates up to run_job_in_background, which logs the cancellation
    and leaves the status as CANCELLED (does NOT overwrite with FAILED)."""


def set_stage(session: Session, job_id: int, stage: str | None) -> None:
    """Write a short stage slug onto the job row so the JobPage's progress
    banner can show the user what's happening RIGHT NOW.

    Stages are short slugs the frontend translates to friendly labels
    ("fetching_pdb" → "Fetching protein structure"). Free-form text means
    we can add new stages without coordinating a migration each time.

    Cheap: one short UPDATE, no transaction wrap. Caller should already
    have an open session. Session.refresh(job) before reading stage in
    the same call site, since SQLModel doesn't auto-invalidate after
    a bare UPDATE.
    """
    fresh = session.get(Job, job_id)
    if fresh is None:
        return
    fresh.stage = stage
    fresh.updated_at = datetime.utcnow()
    session.add(fresh)
    session.commit()


def is_cancelled(session: Session, job_id: int) -> bool:
    """Cheap re-read of the job's status from the DB. Used between cells
    in the per-cell loop. Refreshes the in-memory copy so callers see the
    latest status without us needing a Job instance threaded everywhere.
    """
    # Fetch a fresh copy via primary key — bypasses any session-cached
    # stale state from the original `job` object the runner is holding.
    fresh = session.get(Job, job_id)
    return bool(fresh and fresh.status == JobStatus.CANCELLED)


def run_job_in_background(job_id: int) -> None:
    """Background entrypoint. Pulls the job, runs docking, writes results."""
    log.info("Running job %s", job_id)
    with Session(engine) as session:
        job = session.get(Job, job_id)
        if not job:
            log.error("Job %s not found", job_id)
            return

        # If the user cancelled before the worker even picked it up, honour
        # that immediately rather than transitioning to RUNNING just to
        # check again on the first cell.
        if job.status == JobStatus.CANCELLED:
            log.info("Job %s already cancelled before runner started; nothing to do", job_id)
            return

        job.status = JobStatus.RUNNING
        job.updated_at = datetime.utcnow()
        session.add(job)
        session.commit()

        try:
            available, reason = _real_pipeline_available()
            if available:
                log.info("Real Vina pipeline available — using it")
                _run_real(session, job)
            else:
                log.warning("Real pipeline unavailable (%s) — falling back to placeholder", reason)
                _run_placeholder(session, job, reason)

            # Re-read in case the runner loop saw a cancel between cells.
            # If the user cancelled mid-run, _run_real raised JobCancelled,
            # which we catch below — but a "natural" completion that
            # raced with cancel would land here. Either way: don't
            # clobber a CANCELLED status with COMPLETED.
            session.refresh(job)
            if job.status != JobStatus.CANCELLED:
                job.status = JobStatus.COMPLETED
                # Clear the pre-flight stage marker — the job is done, the
                # frontend's progress banner shouldn't keep showing
                # "validating_poses" or whatever the last stage was.
                job.stage = None
                job.updated_at = datetime.utcnow()
                session.add(job)
                session.commit()
                log.info("Job %s completed", job_id)
            else:
                log.info("Job %s ended in CANCELLED state — preserving it", job_id)
        except JobCancelled:
            log.info("Job %s cancelled by user mid-run", job_id)
            # The cancel endpoint already set status=CANCELLED and the
            # error_message; no need to overwrite.
        except Exception as e:
            log.exception("Job %s failed", job_id)
            job.status = JobStatus.FAILED
            job.error_message = str(e)[:500]
            job.updated_at = datetime.utcnow()
            session.add(job)
            session.commit()


# ──────────────────────────────────────────────────────────────────────
# Real Vina pipeline
# ──────────────────────────────────────────────────────────────────────

def _drain_pending_validations(pending: list[dict], session: Session) -> None:
    """Run deferred PoseBusters/ProLIF/strain validation in parallel.

    `pending` is a list of dicts (built by _finalize_cell when
    defer_validation is on) containing everything one validation pass
    needs: receptor pdbqt, receptor pdb, pose pdbqt path (still alive
    in the runner's tempdir), ligand SMILES, and the row's current
    `extra` string so we can append the new validation segment.

    Updates DockingResult.extra in place via the same `session` —
    rows already have `validate=pending` from _finalize_cell, which we
    overwrite with the real validation string. Frontend's 2s polling
    sees the update on the next /jobs fetch.

    Concurrency: uses ThreadPoolExecutor. PoseBusters + ProLIF + strain
    each run as their own subprocess (RDKit segfault isolation), so
    real parallelism comes from the OS scheduler, not the Python GIL.
    Cap at 4 concurrent because each validation spawns ~3 subprocesses
    and the Fly machine has 2 vCPU — going wider would just cause
    context-switch thrash without speedup.

    No-op when `pending` is empty (eager-validation path doesn't
    populate the list).
    """
    if not pending:
        return
    try:
        from deltadock_pipeline.validate import validate_pose
    except ImportError:
        log.warning("validate_pose unavailable; deferred validation skipped")
        return

    from concurrent.futures import ThreadPoolExecutor, as_completed

    def _one_validation(item: dict) -> tuple[int, str, str | None, str | None]:
        """Returns (compound_id, variant, validation_segment, error)."""
        try:
            v = validate_pose(
                receptor_pdbqt=item["receptor"],
                pose_pdbqt=item["pose_pdbqt"],
                receptor_pdb=item["receptor_pdb"],
                work_dir=item["run_dir"],
                ligand_smiles=item["ligand_smiles"],
            )
            return (item["compound_id"], item["variant"], v.to_extra_string(), None)
        except Exception as ve:
            return (item["compound_id"], item["variant"], None, f"validate_err={str(ve)[:80]}")

    log.info("Deferred validation: draining %d cells in parallel", len(pending))
    by_key = {(it["compound_id"], it["variant"]): it for it in pending}
    # All pending items share a job_id (one runner = one job) — capture once.
    job_id_for_rows = pending[0].get("job_id") if pending and pending[0].get("job_id") is not None else None
    # Fallback: derive from a query against compound_id+variant — but every
    # pending item came from this runner so they all carry the same job_id
    # if it was set at enqueue time. Add it now if missing (older callers).
    # We use the first pending item's job_id; matches the model.

    with ThreadPoolExecutor(max_workers=4) as ex:
        futures = [ex.submit(_one_validation, it) for it in pending]
        for fut in as_completed(futures):
            try:
                compound_id, variant, segment, err = fut.result()
            except Exception as e:
                log.warning("Validation worker crashed: %s", e)
                continue

            current_extra = by_key[(compound_id, variant)].get("current_extra") or ""
            new_segment = segment if segment else (err or "validate_err=unknown")
            # Strip the placeholder so the final extra is clean.
            cleaned = "|".join(
                p for p in current_extra.split("|")
                if p and p != "validate=pending"
            )
            final_extra = (cleaned + "|" + new_segment) if cleaned else new_segment

            # Find and update the row. Filter by job_id when we have it
            # (avoids cross-job collisions in the same compound_id space).
            stmt = select(DockingResult).where(
                DockingResult.compound_id == compound_id,
                DockingResult.variant == variant,
            )
            if job_id_for_rows is not None:
                stmt = stmt.where(DockingResult.job_id == job_id_for_rows)
            for r in session.exec(stmt):
                r.extra = final_extra
                session.add(r)
            session.commit()
    log.info("Deferred validation: done")


def _run_boltz2_dispatch(
    session: Session,
    job: Job,
    cleaned_pdb: Path,
    chain: str,
    pocket_centre: tuple[float, float, float],
    pocket_size: tuple[float, float, float],
    pocket_source: str | None,
    boltz2_pod_url: str,
    compounds: list,
    variants: list[str],
) -> None:
    """Boltz-2-only per-cell dispatch.

    Called from `_run_real` when `job.engine == "boltz2"`. Independent
    flow because Boltz-2 takes a sequence + ligand SMILES, not a PDBQT
    receptor + box, so almost none of the Vina/GNINA scaffolding
    applies. Skipped: receptor PDBQT prep, FoldX mutation builder,
    Vina/GNINA dispatch, Vinardo rescoring, PoseBusters/ProLIF
    validation. Those are all physics-pipeline concepts that don't
    map onto a foundation-model prediction.

    What we DO share with the Vina path: PDB fetch, PDBFixer cleanup,
    pocket-box auto-detection (catalog → fpocket fallback → origin),
    DocketResult row shape, R2 pose persistence, cooperative
    cancellation between cells.

    Per-cell behaviour:
      - WT cell: dock the unmodified chain sequence.
      - Mutation cell: apply substitution to the sequence string and
        dock that. If the mutation references a residue not in the
        chain (gap, wrong chain ID, wrong WT letter), write a clean
        failure row instead of silently sending WT to the model.
      - Pocket constraint: residues whose CA is within (min half-edge
        of pocket box) Å of pocket centre. Empty list is OK; Boltz-2
        falls back to its learned pocket prior.

    Score field (DocketResult.best_score): we store affinity_pred_value
    directly. It's log10(IC50 in μM), so more-negative = stronger binder
    (matches Vina's sign convention even though the units are different).
    The matrix renders Δ as (mutant - WT) — same direction signal
    regardless of units.
    """
    # Late imports — module is only meaningful in the boltz2 path.
    import sys
    pipeline_path = Path(__file__).parents[3].parent / "pipeline"
    if str(pipeline_path) not in sys.path:
        sys.path.insert(0, str(pipeline_path))
    from deltadock_pipeline.boltz2_dock import (
        Boltz2DockConfig, Boltz2DockError, predict_one_boltz2,
    )
    from deltadock_pipeline.boltz2_seq import (
        apply_mutation_to_sequence, extract_sequence_from_pdb,
        pocket_residues_within,
    )

    cx, cy, cz = pocket_centre
    sx, sy, sz = pocket_size

    # Boltz-2 client config — picked up from the runtime settings so a
    # restart with new env (longer timeout, MSA toggle) takes effect
    # without code changes.
    cfg = Boltz2DockConfig(
        base_url=boltz2_pod_url,
        timeout_s=settings.boltz2_timeout_s,
        use_msa=settings.boltz2_use_msa,
        num_samples=settings.boltz2_num_samples,
    )

    # Step 1: extract WT sequence + residue→index map from the cleaned PDB.
    # Failures here are catastrophic for the whole job (no sequence → no
    # boltz prediction possible), so let them propagate up to the run_job
    # exception handler which marks the job FAILED with a useful reason.
    set_stage(session, job.id, "extracting_sequence")
    try:
        wt_sequence = extract_sequence_from_pdb(cleaned_pdb, chain)
    except ValueError as e:
        raise RuntimeError(
            f"prep_step=extract_sequence pdb={cleaned_pdb.name} "
            f"chain={chain}: {e}"
        ) from e

    # Step 2: build pocket-residue list (CA atoms inside the docking box).
    # Use the smallest half-edge so the constraint stays inside the box
    # the user expects — same convention as the Vina path's
    # POCKET_RADIUS_A.
    pocket_radius_a = min(sx, sy, sz) / 2.0
    pocket_residues = pocket_residues_within(
        cleaned_pdb, chain, pocket_centre, pocket_radius_a,
    )
    log.info(
        "Boltz-2: WT sequence %d residues, pocket constraint %d residues",
        len(wt_sequence.seq), len(pocket_residues),
    )

    # Step 3: per-variant sequence map. Same structure as receptor_for_variant
    # in the Vina path. variant_extra carries telemetry that gets glued onto
    # the per-cell `extra` string so the user sees what produced the score.
    sequence_for_variant: dict[str, str | None] = {"WT": wt_sequence.seq}
    variant_extra: dict[str, str | None] = {"WT": pocket_source}
    for mut in [m for m in job.mutations.split(",") if m]:
        new_seq, err = apply_mutation_to_sequence(wt_sequence, mut)
        if err is not None:
            log.warning("Boltz-2: mutation %s rejected: %s", mut, err)
            sequence_for_variant[mut] = None
            variant_extra[mut] = f"mutation_rejected: {err}"
        else:
            sequence_for_variant[mut] = new_seq
            variant_extra[mut] = "boltz2_seq_mutation_applied"

    # Step 4: per-cell loop. Boltz-2 has no native ligand-batch endpoint
    # yet (see predict_batch_boltz2 stub), so we iterate compound × variant
    # one HTTP call at a time. Each call is ~20 s on a warm RTX 4090.
    #
    # Track WT predicted complexes by (compound_id, "WT") so we can align
    # mutant complexes to them. Key: (compound_id, "WT"), value: Path to predicted_pdb.
    wt_predicted_pdbs: dict[tuple[int, str], Path] = {}
    total_cells = len(compounds) * len(variants)
    cell_idx = 0
    with tempfile.TemporaryDirectory(prefix=f"boltz2-job{job.id}-") as work_str:
        work = Path(work_str)
        for compound in compounds:
            if is_cancelled(session, job.id):
                log.info("Job %s cancelled — stopping Boltz-2 loop", job.id)
                raise JobCancelled()
            for variant in variants:
                if is_cancelled(session, job.id):
                    raise JobCancelled()
                cell_idx += 1
                # Stage tells the user which cell we're on right now —
                # critical for Boltz-2 because each cell takes ~130 s.
                set_stage(session, job.id, f"predicting_{cell_idx}_of_{total_cells}")
                seq = sequence_for_variant.get(variant)
                if seq is None:
                    # Mutation rejected upstream; emit a clean failure row.
                    fail = variant_extra.get(variant) or "mutation_rejected"
                    session.add(DockingResult(
                        job_id=job.id, compound_id=compound.id, variant=variant,
                        best_score=0.0, extra=fail,
                    ))
                    session.commit()
                    continue

                cell_dir = work / f"compound_{compound.id}_{variant}"
                cell_dir.mkdir(exist_ok=True)
                parts: list[str] = []
                if variant_extra.get(variant):
                    parts.append(variant_extra[variant])
                parts.append("engine=boltz2")

                try:
                    result = predict_one_boltz2(
                        receptor_sequence=seq,
                        ligand_smiles=compound.smiles,
                        work_dir=cell_dir,
                        cfg=cfg,
                        pocket_residues=pocket_residues or None,
                        chain_id=chain,
                    )
                    # Track WT poses for later alignment of mutants
                    if variant == "WT":
                        wt_predicted_pdbs[(compound.id, "WT")] = result.predicted_pdb
                except Boltz2DockError as bde:
                    log.warning(
                        "Boltz-2 failed for c%s × %s: %s",
                        compound.id, variant, bde,
                    )
                    session.add(DockingResult(
                        job_id=job.id, compound_id=compound.id, variant=variant,
                        best_score=0.0,
                        extra="|".join(parts + [f"boltz2_failed: {str(bde)[:120]}"]),
                    ))
                    session.commit()
                    continue
                except Exception as e:
                    log.exception(
                        "Boltz-2 unexpected error for c%s × %s",
                        compound.id, variant,
                    )
                    session.add(DockingResult(
                        job_id=job.id, compound_id=compound.id, variant=variant,
                        best_score=0.0,
                        extra="|".join(parts + [f"boltz2_err:{type(e).__name__}:{str(e)[:80]}"]),
                    ))
                    session.commit()
                    continue

                # Boltz-2 returns the predicted protein-ligand COMPLEX as a
                # single PDB. Persist it as the cell's pose so the 3D
                # viewer can display it.
                # PoseBusters/strain are deliberately skipped — they're
                # physics validators that flag ML-generated geometries
                # as "Suspect" even when the binding mode is fine.
                # ProLIF is NOT a physics validator (it just measures
                # contacts), so we do run it — split the complex into
                # protein-only + ligand-only PDBs first, then call the
                # same subprocess-isolated runner the Vina path uses.
                from .pose_store import get_pose_store

                # For non-WT variants, attempt Cα alignment to the WT predicted
                # complex (when available). If alignment succeeds with RMSD < 3.0 Å,
                # overwrite the mutant pose with the aligned version.
                pose_to_write = result.predicted_pdb
                alignment_note = None
                if variant != "WT" and (compound.id, "WT") in wt_predicted_pdbs:
                    try:
                        from deltadock_pipeline.boltz2_align import align_complex_to
                        wt_pdb = wt_predicted_pdbs[(compound.id, "WT")]
                        aligned_out = cell_dir / f"aligned_{variant}.pdb"
                        rmsd, ok_flag = align_complex_to(
                            target_pdb=wt_pdb,
                            source_pdb=pose_to_write,
                            out_pdb=aligned_out,
                            chain_id=chain,
                        )
                        if ok_flag:
                            # RMSD < 3.0 Å — overlay is meaningful
                            pose_to_write = aligned_out
                            alignment_note = f"boltz2_aligned_to_wt={rmsd}A"
                            log.info(
                                "Boltz-2 c%s × %s: aligned to WT, RMSD=%.1f Å",
                                compound.id, variant, rmsd,
                            )
                        else:
                            # RMSD >= 3.0 Å — fold has diverged, skip overlay
                            alignment_note = f"boltz2_alignment_skipped: RMSD={rmsd}A >= 3.0A (fold diverged)"
                            log.info(
                                "Boltz-2 c%s × %s: alignment RMSD=%.1f Å >= 3.0 — skipping (fold diverged)",
                                compound.id, variant, rmsd,
                            )
                    except Exception as ae:
                        alignment_note = f"boltz2_alignment_skipped: {type(ae).__name__}:{str(ae)[:60]}"
                        log.warning(
                            "Boltz-2 c%s × %s alignment failed: %s",
                            compound.id, variant, ae,
                        )

                try:
                    pose_uri = get_pose_store().write(
                        job.id, compound.id, variant, pose_to_write,
                    )
                except Exception as e:
                    log.warning(
                        "Could not persist Boltz-2 pose for c%s × %s: %s",
                        compound.id, variant, e,
                    )
                    pose_uri = str(pose_to_write)

                # Telemetry that the JobPage + parseExtra.ts surface back
                # to the user: the raw affinity, the binder probability,
                # pocket-residue count (so they know the constraint was
                # honored).
                parts.append(f"aff_value={result.affinity_pred_value:.3f}")
                parts.append(f"aff_prob={result.affinity_probability_binary:.3f}")
                parts.append(f"pocket_residues={len(pocket_residues)}")

                # Append alignment outcome to the extra string so the frontend
                # can detect whether this mutant was aligned and at what RMSD.
                if alignment_note:
                    parts.append(alignment_note)

                # ProLIF on the Boltz-2 complex. Fail-soft — if anything
                # goes wrong (split fails, ProLIF subprocess crashes, no
                # contacts found), we just skip the contacts segment and
                # the user sees the cell without a 2D map / contact list.
                # Same pattern the Vina path uses for ProLIF errors.
                try:
                    from deltadock_pipeline.boltz2_seq import split_complex_pdb
                    from deltadock_pipeline.validate import _run_prolif_safe
                    protein_only, ligand_only = split_complex_pdb(
                        result.predicted_pdb, cell_dir,
                        ligand_chain="L", protein_chain=chain,
                    )
                    contacts = _run_prolif_safe(
                        pose_pdb=ligand_only,
                        receptor_pdb=protein_only,
                        ligand_smiles=compound.smiles,
                        timeout=60.0,
                    )
                    if contacts:
                        # Same compact format the Vina path uses so the
                        # frontend's parseExtra.ts can read both: comma-
                        # separated list of "RES:Type:distance" tokens.
                        # We don't have a distance from ProLIF's bare
                        # output here, so we elide the third field;
                        # parseExtra handles 2-field tokens fine.
                        toks = []
                        for c in contacts:
                            res = c.get("residue") or c.get("res") or ""
                            typ = c.get("type") or c.get("interaction") or "Contact"
                            if res:
                                toks.append(f"{res}:{typ}")
                        if toks:
                            parts.append("contacts=" + ",".join(toks))
                            parts.append("prolif=ok")
                        else:
                            parts.append("prolif=empty")
                    else:
                        parts.append("prolif=empty")
                except Exception as pe:
                    log.warning(
                        "Boltz-2 ProLIF failed for c%s × %s: %s",
                        compound.id, variant, pe,
                    )
                    parts.append(f"prolif=err:{str(pe)[:40]}")

                session.add(DockingResult(
                    job_id=job.id, compound_id=compound.id, variant=variant,
                    best_score=float(result.score),
                    pose_uri=pose_uri,
                    extra="|".join(parts),
                ))
                session.commit()
                log.info(
                    "Boltz-2 c%s × %s: aff=%.3f prob=%.3f",
                    compound.id, variant,
                    result.affinity_pred_value,
                    result.affinity_probability_binary,
                )


def _run_real(session: Session, job: Job) -> None:
    # Late import — keeps the placeholder-only path lightweight
    import sys
    pipeline_path = Path(__file__).parents[3].parent / "pipeline"
    if str(pipeline_path) not in sys.path:
        sys.path.insert(0, str(pipeline_path))
    from deltadock_pipeline.fetch import fetch_pdb
    from deltadock_pipeline.prep import prepare_receptor, prepare_ligand, fix_pdb
    from deltadock_pipeline.dock import dock_one, PocketBox

    foldx_on = _foldx_available()
    if foldx_on:
        from deltadock_pipeline.foldx import build_mutant, FoldXError
    else:
        log.warning("FoldX not available — mutants will be docked against the WT receptor")

    # Two opt-in remote engines, tried in this order:
    #   1. Pod-hosted GPU docking (settings.pod_dock_url) — long-running FastAPI
    #      service on a dedicated GPU Pod; always-warm, ~30x faster than CPU.
    #   2. RunPod serverless (settings.runpod_enabled) — pay-per-second, has
    #      cold-start latency.
    # Both fail-soft to local Vina on any error so a single bad call doesn't
    # take down the whole job. The engine that ran each cell is annotated in
    # the result's `extra` field (engine=pod_gpu | runpod | local | local_after_*).
    pod_on = settings.pod_dock_enabled
    if pod_on:
        from deltadock_pipeline.pod_dock import dock_one_pod, PodDockConfig, PodDockError
        pod_cfg = PodDockConfig(
            base_url=settings.pod_dock_url,
            timeout_s=settings.pod_dock_timeout_s,
        )
        log.info("Pod GPU dispatch enabled → %s", settings.pod_dock_url)

    # When pod_batch_dock is on, we can group cells of the same variant into
    # one HTTP call so the GPU loads the receptor once per variant instead
    # of once per cell. Pod-side endpoint (POST /dock_batch) must be live —
    # check via env, not via probe, so a transient Pod hiccup at startup
    # doesn't permanently disable the fast path. Falls back to per-cell
    # dispatch on per-batch error.
    pod_batch_on = pod_on and settings.pod_batch_dock
    if pod_batch_on:
        from deltadock_pipeline.pod_dock import dock_batch_pod, BatchLigand
        log.info("Pod GPU batch dispatch enabled (one HTTP call per variant)")

    # RunPod serverless can run *alongside* Pod GPU as a burst-overflow path:
    # when the Pod is busy / 5xx / timing out, individual cells fall through
    # to RunPod instead of dropping straight to local CPU. When Pod is off,
    # RunPod is the primary remote engine. When both are off, everything
    # runs locally.
    runpod_on = settings.runpod_enabled
    if runpod_on:
        from deltadock_pipeline.runpod_dock import dock_one_runpod, RunPodConfig, RunPodError
        runpod_cfg = RunPodConfig(
            api_key=settings.runpod_api_key,
            endpoint_id=settings.runpod_endpoint_id,
            timeout_s=settings.runpod_timeout_s,
        )
        if pod_on:
            log.info("RunPod serverless burst overflow enabled → endpoint %s", settings.runpod_endpoint_id)
        else:
            log.info("RunPod serverless dispatch enabled → endpoint %s", settings.runpod_endpoint_id)

    # GNINA dispatch is opt-in per-job via job.engine. The Pod-side endpoint
    # /dock_gnina has to be installed first (see pod/GNINA_INSTALL.md) and
    # the GNINA_ENABLED Fly secret set. When all that's in place, jobs that
    # arrive with engine=gnina dispatch through the GNINA client; everything
    # else continues to use QuickVina2-GPU. We deliberately do NOT use
    # GNINA as an automatic fallback — users picked their engine on
    # purpose, falling them back silently to a different scoring function
    # would be misleading.
    gnina_requested = (
        getattr(job, "engine", None) == "gnina"
        and settings.gnina_enabled
        and pod_on  # GNINA hits the same Pod, so requires pod_dock_url
    )
    if gnina_requested:
        from deltadock_pipeline.gnina_dock import (
            dock_one_gnina, dock_batch_gnina, GninaDockConfig, GninaDockError, GninaBatchLigand,
        )
        gnina_cfg = GninaDockConfig(
            base_url=settings.pod_dock_url,
            timeout_s=settings.gnina_timeout_s,
            cnn_mode=settings.gnina_cnn_mode,
        )
        log.info("GNINA dispatch active for this job (cnn=%s)", settings.gnina_cnn_mode)
    elif getattr(job, "engine", None) == "gnina":
        # User asked for GNINA but the flag's off OR Pod isn't configured.
        # Log loudly so we can spot misconfiguration; the runner will fall
        # through to QuickVina2-GPU below.
        log.warning(
            "Job %s requested engine=gnina but GNINA_ENABLED=%s pod_on=%s — falling back to quickvina2_gpu",
            job.id, settings.gnina_enabled, pod_on,
        )

    # ── Boltz-2 ML engine (#104, third engine option) ─────────────────────
    # Boltz-2 takes a protein SEQUENCE + ligand SMILES — fundamentally
    # different inputs from Vina/GNINA's PDBQT receptor. We still share
    # the PDB fetch + clean step with the Vina path (the cleaned PDB is
    # the source of the WT sequence), so the boltz2 branch fires AFTER
    # cleaned_pdb is computed (~line 700) — see `if boltz2_dispatch:`
    # below. Here we only fail fast if the user asked for boltz2 but the
    # required config is missing.
    boltz2_dispatch = (
        getattr(job, "engine", None) == "boltz2"
        and settings.boltz2_enabled
    )
    if boltz2_dispatch:
        # Pod URL: dedicated boltz2 pod if configured, else fall back to
        # the Vina/GNINA pod (legacy single-pod deploy).
        boltz2_pod_url = settings.boltz2_pod_url or settings.pod_dock_url
        if not boltz2_pod_url:
            raise RuntimeError(
                "engine=boltz2 requested but neither BOLTZ2_POD_URL nor "
                "POD_DOCK_URL is configured."
            )
        log.info("Boltz-2 dispatch active for this job → %s", boltz2_pod_url)
    elif getattr(job, "engine", None) == "boltz2":
        log.warning(
            "Job %s requested engine=boltz2 but BOLTZ2_ENABLED=%s — "
            "engine is not currently available; the API should have rejected at submit time",
            job.id, settings.boltz2_enabled,
        )
        raise RuntimeError(
            "Boltz-2 engine not enabled on this deployment. "
            "Set BOLTZ2_ENABLED=1 on the API once the Pod-side endpoint is live."
        )

    if not pod_on and not runpod_on:
        log.info("No remote engine configured — running Vina locally")

    # Validation (PoseBusters + ProLIF) is optional too — if it crashes for any
    # reason it just won't add `extra` info, the docking still works.
    try:
        from deltadock_pipeline.validate import validate_pose
        validate_on = True
    except Exception as e:
        log.warning("Validation pipeline not available: %s", e)
        validate_on = False

    # WT is included by default; users can opt out via the New Job form when
    # they don't need a baseline. When skipped, the matrix has no REF column
    # and no Δ values, but the rest of the pipeline still works (FoldX still
    # builds mutant receptors off the WT crystal structure).
    requested_mutations = [m for m in job.mutations.split(",") if m]
    variants = (["WT"] if job.include_wt else []) + requested_mutations
    if not variants:
        # Defensive: include_wt=False AND no mutations leaves nothing to dock.
        raise ValueError(
            "Job has no variants to dock — enable WT comparison or list at least one mutation."
        )

    # Per-job exhaustiveness, with a sane fallback for legacy rows that don't
    # have the column populated (defaults to Vina's own default of 8).
    exhaustiveness = int(getattr(job, "exhaustiveness", None) or 8)
    log.info("Docking with exhaustiveness=%d, variants=%s", exhaustiveness, variants)

    compounds = session.exec(select(Compound).where(Compound.job_id == job.id)).all()

    # Preserve USR_ upload-id case (lowercase hex tail) — uppercase only
    # standard RCSB IDs. Forcing .upper() here previously broke uploads
    # because the lookup-router stored files with lowercase hex.
    pdb_id = job.pdb_id if job.pdb_id.startswith("USR_") else job.pdb_id.upper()
    chain = job.chain or "A"

    # Cross-docking sanity check: if we don't have a cached self-dock RMSD
    # for this (pdb_id, chain), trigger one in a background thread. It uses
    # the same Vina/QuickVina-GPU path the user's compounds will use, then
    # measures heavy-atom RMSD between the docked pose and the original
    # crystal pose. Cached forever after — surfaces in the JobPage header
    # via the next /jobs response after it completes. Doesn't block the
    # user's actual results.
    try:
        from deltadock_pipeline.crossdock import load_cached
        if load_cached(pdb_id, chain) is None:
            import threading as _th
            _th.Thread(
                target=_run_crossdock_in_background,
                args=(pdb_id, chain),
                name=f"crossdock-{pdb_id}-{chain}",
                daemon=True,
            ).start()
            log.info("Spawned cross-dock sanity check for %s/%s", pdb_id, chain)
    except Exception as e:
        log.info("Could not spawn cross-dock for %s/%s: %s", pdb_id, chain, e)

    # Step 1: fetch the raw PDB FIRST so pocket auto-detection has it to scan.
    # The cleaned version is what FoldX operates on (it doesn't like raw PDBs
    # with heterogens) AND what we use to prep the WT receptor.
    # Each prep step is wrapped to convert a generic "list index out of range"
    # style traceback into a step-tagged error the user can act on.
    set_stage(session, job.id, "fetching_pdb")
    PDB_CACHE.mkdir(parents=True, exist_ok=True)
    try:
        raw_pdb = fetch_pdb(pdb_id, PDB_CACHE)
    except Exception as e:
        raise RuntimeError(f"prep_step=fetch_pdb pdb={pdb_id}: {type(e).__name__}: {e}") from e

    # Pocket box: catalog first, then auto-detect from co-crystal HETATM,
    # finally fall back to origin (won't dock anything sensible — but the job
    # finishes and the user gets a clear "wrong pocket" hint in the result).
    catalog_target = next(
        (t for t in [get_target(c) for c in [pdb_id.lower()]] if t),
        None,
    ) or _catalog_by_pdb(pdb_id)
    pocket_source = None  # appended to per-result extra string for telemetry

    if catalog_target:
        try:
            cx, cy, cz = catalog_target.pocket.center
            sx, sy, sz = catalog_target.pocket.size
        except (ValueError, TypeError) as e:
            raise RuntimeError(
                f"prep_step=catalog_pocket target={catalog_target.id}: "
                f"pocket center/size malformed ({type(e).__name__}: {e})"
            ) from e
        pocket_source = "pocket=catalog"
    else:
        try:
            from deltadock_pipeline.pocket import detect_pocket
            detected = detect_pocket(raw_pdb, chain=chain)
        except Exception as e:
            log.warning("Pocket auto-detect crashed: %s", e)
            detected = None

        if detected:
            cx, cy, cz = detected.center
            sx, sy, sz = 22.0, 22.0, 22.0
            pocket_source = f"pocket=auto({detected.source_het})"
        else:
            log.warning("No catalog entry and no co-crystal in %s — pocket box defaulting to origin (LIKELY WRONG)", pdb_id)
            cx, cy, cz = 0.0, 0.0, 0.0
            sx, sy, sz = 22.0, 22.0, 22.0
            pocket_source = "pocket=default_origin_LIKELY_WRONG"

    box = PocketBox(center_x=cx, center_y=cy, center_z=cz, size_x=sx, size_y=sy, size_z=sz)

    # Prep version stamp. When this changes, all cached cleaned PDBs and
    # derived receptors get auto-invalidated and rebuilt with the new prep.
    # v2 = numbering-preserving fix_pdb (skips findMissingResidues that used
    # to silently renumber every residue). Bumping this is the cleanest way
    # to force a one-time precache rebuild without manual file deletion.
    # v3 (2026-04-30): mutant builds now run a 200-step amber99sb-ildn vacuum
    # minimisation after PDBFixer applyMutations to relieve substitution
    # clash artefacts. Bumping the prep version invalidates every cached
    # mutant *.clean.pdb and *.pdbqt so the next request rebuilds with the
    # new minimised structure. WT-only caches are unaffected (no change
    # to WT prep), but we share one PREP_VERSION for simplicity — the
    # extra ~10 s of WT re-prep on first hit per target is fine and avoids
    # a divergent versioning scheme that's easy to get wrong.
    #
    # v4 (2026-04-30): per-target minimize_mutant flag (catalog.py Target).
    # BRAF flips to False because V600E activation-loop biology doesn't
    # survive a local-energy-minimum search — the validation suite went
    # -2.90 → -0.70 → +2.20 across three samples. Bumping to v4 forces
    # BRAF mutant rebuilds with minimisation skipped on next request.
    PREP_VERSION = "v4-per-target-min"

    def _is_stale(path: Path) -> bool:
        """A cache file is stale if its sibling .prep_version marker is missing
        or doesn't match PREP_VERSION. Used to recover from old precaches that
        were built with the renumbering bug."""
        if not path.exists() or path.stat().st_size == 0:
            return True
        marker = path.with_suffix(path.suffix + ".prep_version")
        if not marker.exists():
            return True
        return marker.read_text().strip() != PREP_VERSION

    def _stamp(path: Path) -> None:
        marker = path.with_suffix(path.suffix + ".prep_version")
        marker.write_text(PREP_VERSION + "\n")

    cleaned_pdb = PDB_CACHE / f"{pdb_id}_{chain}.clean.pdb"
    if _is_stale(cleaned_pdb):
        set_stage(session, job.id, "cleaning_pdb")
        log.info("Cleaning %s with PDBFixer (prep %s)", pdb_id, PREP_VERSION)
        # Two-attempt loop. First attempt may use a cached raw_pdb that's
        # truncated (RCSB CloudFront has flaky cold-cache hits) or partially
        # cleaned. On failure we nuke ALL related files and re-fetch +
        # re-clean from scratch. If the second attempt also fails, it's a
        # real PDB-level problem (DNA-only entry, malformed structure, etc.)
        # and we surface the error to the user.
        last_err: Exception | None = None
        for attempt in (1, 2):
            try:
                fix_pdb(raw_pdb, cleaned_pdb, chain=chain)
                _stamp(cleaned_pdb)
                last_err = None
                break
            except Exception as e:
                last_err = e
                # Self-heal: ANY failure inside fix_pdb suggests the cached
                # raw or cleaned files are in a bad state — could be:
                #   - "No ATOM lines kept": empty/truncated download
                #   - IndexError from PDBFixer: corrupt residue records
                #   - PrepError from obabel/PDBFixer: malformed coordinates
                #   - ValueError parsing coordinate fields
                #   - "Misaligned residue name": malformed ATOM records
                # In all cases the cure is the same: nuke both the raw
                # cached file (forces refetch from RCSB) and any partial
                # cleaned output (forces re-clean). USR_ uploads are exempt
                # from raw-file deletion since we can't refetch user uploads.
                if pdb_id.startswith("USR_"):
                    # Custom uploads can't be re-fetched, so a single
                    # failure is terminal. Skip the retry.
                    break
                for stale_path in (raw_pdb, cleaned_pdb,
                                   cleaned_pdb.with_suffix(cleaned_pdb.suffix + ".prep_version"),
                                   cleaned_pdb.with_suffix(".prestrip.pdb")):
                    try:
                        if stale_path.exists():
                            stale_path.unlink()
                    except OSError:
                        pass
                if attempt == 1:
                    log.warning(
                        "fix_pdb failed for %s on attempt 1 — re-fetching from "
                        "RCSB and retrying once. Original error: %s",
                        pdb_id, str(e)[:160],
                    )
                    # Re-fetch the raw PDB before the second attempt.
                    raw_pdb = fetch_pdb(pdb_id, PDB_CACHE)
                else:
                    log.error(
                        "fix_pdb failed for %s on retry — surfacing to user. "
                        "Error: %s", pdb_id, str(e)[:160],
                    )
        if last_err is not None:
            raise RuntimeError(
                f"prep_step=fix_pdb pdb={pdb_id} chain={chain}: "
                f"{type(last_err).__name__}: {last_err}"
            ) from last_err

    # ── Boltz-2 dispatch branch ─────────────────────────────────────────
    # Now that cleaned_pdb + pocket box are ready, route Boltz-2 jobs
    # through their own loop and return — they don't need the WT-receptor
    # PDBQT prep, FoldX mutant builder, or Vina/GNINA dispatch below.
    # Everything from here down is for Vina/GNINA only.
    if boltz2_dispatch:
        _run_boltz2_dispatch(
            session=session,
            job=job,
            cleaned_pdb=cleaned_pdb,
            chain=chain,
            pocket_centre=(cx, cy, cz),
            pocket_size=(sx, sy, sz),
            pocket_source=pocket_source,
            boltz2_pod_url=boltz2_pod_url,
            compounds=compounds,
            variants=variants,
        )
        return

    set_stage(session, job.id, "preparing_receptor")
    # Step 2: prep WT receptor once. Cached across jobs. The WT receptor is
    # derived from cleaned_pdb so when the latter gets re-built (stale
    # invalidation), the WT PDBQT must also be rebuilt — otherwise it'd
    # still reference the old renumbered residues.
    RECEPTOR_CACHE.mkdir(parents=True, exist_ok=True)
    wt_receptor = RECEPTOR_CACHE / f"{pdb_id}_{chain}_WT.pdbqt"
    if _is_stale(wt_receptor):
        log.info("Prepping WT receptor %s chain %s (prep %s)", pdb_id, chain, PREP_VERSION)
        try:
            prepare_receptor(cleaned_pdb, wt_receptor, chain=chain)
            _stamp(wt_receptor)
        except Exception as e:
            raise RuntimeError(
                f"prep_step=prepare_receptor pdb={pdb_id} chain={chain}: {type(e).__name__}: {e}"
            ) from e

    # Step 3: build a mutant receptor PDBQT for every requested mutation.
    # Cached on (PDB hash, chain, mutation) — FoldX is the slowest step (~30s).
    # Track three things per variant: the docking receptor (PDBQT), the cleaned
    # PDB (for ProLIF), and any prefix info we'll glue onto the result's extra.
    receptor_for_variant: dict[str, Path] = {"WT": wt_receptor}
    receptor_pdb_for_variant: dict[str, Path] = {"WT": cleaned_pdb}
    # Tag the WT row with where the pocket box came from so the user sees if
    # we auto-detected vs catalog-pulled vs defaulted.
    variant_extra: dict[str, str | None] = {"WT": pocket_source}
    variant_ddg: dict[str, float | None] = {"WT": None}

    # Late-import the verification helper — checks each mutant receptor
    # actually contains the requested substitution before we waste compute
    # docking against a silently-broken file.
    from deltadock_pipeline.prep import verify_mutation_applied

    def _residue_distance_to_pocket(pdb_path: Path, ch: str, resnum: int) -> float | None:
        """Distance from residue's CA atom to the docking box center.
        Used to flag mutations that are too far from the pocket for
        single-conformation docking to capture their effect — the user
        sees a clear "outside_pocket" tag instead of a confusing
        zero-delta result."""
        try:
            with pdb_path.open() as fh:
                for line in fh:
                    if not line.startswith("ATOM") or len(line) < 54:
                        continue
                    if line[21] != ch or line[22:26].strip() != str(resnum):
                        continue
                    if line[12:16].strip() != "CA":
                        continue
                    x = float(line[30:38]); y = float(line[38:46]); z = float(line[46:54])
                    return ((x-cx)**2 + (y-cy)**2 + (z-cz)**2) ** 0.5
        except (OSError, ValueError):
            pass
        return None

    # The Vina box only "sees" atoms within ~half-edge of box center. The
    # threshold for the "outside_pocket" badge is therefore the smallest
    # half-edge of the actual docking box, NOT a hardcoded constant —
    # otherwise widening a target's box (e.g. EGFR went from 22 → 30 Å on
    # 2026-04-30 to capture L858R on the activation loop) leaves the badge
    # firing on residues Vina can in fact sample. Using the box's own
    # half-edge ties the honest-tagging logic to the actual sampling
    # volume, so any future per-target box adjustments stay consistent.
    POCKET_RADIUS_A = min(sx, sy, sz) / 2.0

    FOLDX_CACHE.mkdir(parents=True, exist_ok=True)
    # Pre-compute pocket-distance for each mutation. Outside-pocket mutations
    # CAN'T produce a meaningful Vina delta in single-conformation docking
    # because Vina only sees atoms within ~22 Å of box center. Track per-mut
    # so we can append a hint to variant_extra.
    pocket_hints: dict[str, str | None] = {}
    for mut in [m for m in job.mutations.split(",") if m]:
        try:
            first_resnum = int("".join(c for c in mut.split("+")[0] if c.isdigit()))
            d = _residue_distance_to_pocket(cleaned_pdb, chain, first_resnum)
            if d is not None and d > POCKET_RADIUS_A:
                pocket_hints[mut] = f"mutation_outside_pocket={d:.1f}A"
                log.info("Mutation %s residue %s is %.1f Å from pocket center — Vina won't see it",
                         mut, first_resnum, d)
            else:
                pocket_hints[mut] = None
        except (ValueError, AttributeError):
            pocket_hints[mut] = None

    for mut in [m for m in job.mutations.split(",") if m]:
        set_stage(session, job.id, f"building_mutant_{mut}")
        # PRECACHE FIRST — many mutant receptors were built offline with FoldX
        # and baked into the Docker image (see backend/precache/receptors/).
        # Without this check, prod (where FoldX isn't installed) would
        # silently dock every mutant against WT and produce IDENTICAL
        # scores per row — the bug reported as "WT and mutation always
        # have the same value".
        cached_mut_pdbqt = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.pdbqt"
        cached_mut_pdb = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.clean.pdb"
        # Skip the precache lookup if the file is missing OR stale (built with
        # the old renumbering-broken prep). In the stale case, fall through
        # to the PDBFixer mutation builder which will produce a v2 file.
        if cached_mut_pdbqt.exists() and cached_mut_pdbqt.stat().st_size > 0 and not _is_stale(cached_mut_pdbqt):
            # VERIFY the precached mutant actually contains the substitution.
            # We check the sibling .clean.pdb (preserved numbering), not the
            # PDBQT (which obabel renumbers). If the sibling PDB doesn't exist
            # we conservatively treat the precache as unverifiable and force
            # a fresh rebuild via the PDBFixer fallback below.
            if cached_mut_pdb.exists():
                ok, reason = verify_mutation_applied(cached_mut_pdb, chain, mut)
            else:
                ok, reason = False, f"sibling .clean.pdb missing for {cached_mut_pdbqt.name} — cannot verify"
            if ok:
                receptor_for_variant[mut] = cached_mut_pdbqt
                cached_mut_pdb = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.clean.pdb"
                if cached_mut_pdb.exists():
                    receptor_pdb_for_variant[mut] = cached_mut_pdb
                hint = pocket_hints.get(mut)
                variant_extra[mut] = f"foldx_precached|{hint}" if hint else "foldx_precached"
                log.info("Using precached mutant receptor %s (verified)", cached_mut_pdbqt.name)
            else:
                # Precache is corrupt (was built with the old PDBFixer-renumbering
                # bug). Don't give up — try the PDBFixer mutation builder as a
                # second chance. If THAT works, we get a real mutant; if it
                # fails too, then we mark the cell with both reasons.
                log.warning("Precached mutant %s FAILED verification (%s) — trying PDBFixer fallback",
                            cached_mut_pdbqt.name, reason)
                try:
                    from deltadock_pipeline.mutate import build_mutant_pdbfixer
                    fresh_pdb = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.fresh.clean.pdb"
                    fresh_pdbqt = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.fresh.pdbqt"
                    build_mutant_pdbfixer(
                        pdb_path=cleaned_pdb,
                        chain=chain,
                        mutation_code=mut,
                        out_path=fresh_pdb,
                        # Per-target opt-out from the post-PDBFixer OpenMM
                        # vacuum minimisation. Default True; BRAF flips this
                        # to False because V600E activation-loop biology
                        # doesn't survive a local-minimum search. See the
                        # Target.minimize_mutant docstring in catalog.py.
                        minimize=catalog_target.minimize_mutant if catalog_target else True,
                    )
                    prepare_receptor(fresh_pdb, fresh_pdbqt, chain=chain)
                    _stamp(fresh_pdbqt)
                    _stamp(fresh_pdb)
                    # Verify against the PDB (preserves residue numbering);
                    # the PDBQT obabel writes is renumbered.
                    ok2, reason2 = verify_mutation_applied(fresh_pdb, chain, mut)
                    if ok2:
                        receptor_for_variant[mut] = fresh_pdbqt
                        receptor_pdb_for_variant[mut] = fresh_pdb
                        hint = pocket_hints.get(mut)
                        variant_extra[mut] = (
                            f"pdbfixer_mutated_after_bad_precache|{hint}" if hint
                            else "pdbfixer_mutated_after_bad_precache"
                        )
                        log.info("Recovered %s via PDBFixer fallback", mut)
                    else:
                        receptor_for_variant[mut] = None  # type: ignore[assignment]
                        variant_extra[mut] = (
                            f"mutant_verify_failed: precache={reason} pdbfixer={reason2}"
                        )
                except Exception as me:
                    receptor_for_variant[mut] = None  # type: ignore[assignment]
                    variant_extra[mut] = (
                        f"mutant_verify_failed: precache={reason} "
                        f"pdbfixer_err={type(me).__name__}:{str(me)[:60]}"
                    )
            continue
        if not foldx_on:
            # NEW: PDBFixer-based mutation building. We can't use FoldX in prod
            # (license-restricted Linux binary not vendored), but PDBFixer's
            # applyMutations() does a perfectly serviceable side-chain swap
            # using its built-in rotamer library. We lose the ΔΔG number but
            # GAIN correct mutant geometry — a much better deal than silently
            # docking against WT and pretending it's the mutant.
            try:
                from deltadock_pipeline.mutate import build_mutant_pdbfixer, MutateError
                mut_pdb_out = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.clean.pdb"
                mut_receptor_out = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.pdbqt"
                if _is_stale(mut_receptor_out):
                    log.info("PDBFixer mutation: %s on %s chain %s", mut, pdb_id, chain)
                    build_mutant_pdbfixer(
                        pdb_path=cleaned_pdb,
                        chain=chain,
                        mutation_code=mut,
                        out_path=mut_pdb_out,
                        # Per-target minimisation flag — see other call site
                        # plus catalog.py Target.minimize_mutant docstring.
                        minimize=catalog_target.minimize_mutant if catalog_target else True,
                    )
                    prepare_receptor(mut_pdb_out, mut_receptor_out, chain=chain)
                    _stamp(mut_pdb_out)
                    _stamp(mut_receptor_out)
                # Verify the resulting receptor actually has the substitution
                # Verify against the PDB (mut_pdb_out), not the PDBQT.
                # obabel renumbers residues when writing PDBQT (collapses
                # 600-947 → 1-N), so the residue numbers we typed only
                # survive in the PDB. Vina/QuickVina doesn't care about
                # residue numbers — it only reads atomic coordinates — so
                # this discrepancy doesn't affect docking, only verification.
                ok, reason = verify_mutation_applied(mut_pdb_out, chain, mut)
                if ok:
                    receptor_for_variant[mut] = mut_receptor_out
                    receptor_pdb_for_variant[mut] = mut_pdb_out
                    hint = pocket_hints.get(mut)
                    variant_extra[mut] = f"pdbfixer_mutated|{hint}" if hint else "pdbfixer_mutated"
                else:
                    log.warning("PDBFixer mutation %s verification failed: %s", mut, reason)
                    receptor_for_variant[mut] = None  # type: ignore[assignment]
                    variant_extra[mut] = f"mutant_verify_failed: {reason}"
            except Exception as me:
                log.warning("PDBFixer mutation %s failed: %s — docking against WT", mut, me)
                receptor_for_variant[mut] = wt_receptor
                variant_extra[mut] = f"mutant_build_failed:{type(me).__name__}:{str(me)[:60]}"
            continue
        try:
            log.info("FoldX BuildModel: %s on %s chain %s", mut, pdb_id, chain)
            with tempfile.TemporaryDirectory(prefix=f"foldx-{job.id}-{mut}-") as fx_work:
                res = build_mutant(
                    pdb_path=cleaned_pdb,
                    chain=chain,
                    mutation_code=mut,
                    out_dir=fx_work,
                    foldx_path=FOLDX_PATH,
                    cache_dir=FOLDX_CACHE,
                )
                # Now turn the mutant PDB into a PDBQT receptor
                mut_receptor = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.pdbqt"
                if not mut_receptor.exists() or mut_receptor.stat().st_size == 0:
                    prepare_receptor(res.mutant_pdb, mut_receptor, chain=chain)
                # Also cache the cleaned mutant PDB for ProLIF (no PDBQT round-trip)
                mut_pdb_cached = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.clean.pdb"
                if not mut_pdb_cached.exists() or mut_pdb_cached.stat().st_size == 0:
                    shutil.copy(res.mutant_pdb, mut_pdb_cached)
                receptor_for_variant[mut] = mut_receptor
                receptor_pdb_for_variant[mut] = mut_pdb_cached
                variant_ddg[mut] = res.ddg_kcal_mol
                variant_extra[mut] = (
                    f"foldx_ddg={res.ddg_kcal_mol:.2f}" if res.ddg_kcal_mol is not None
                    else "foldx_ok"
                )
        except FoldXError as e:
            log.warning("FoldX failed for %s: %s — falling back to WT receptor", mut, e)
            receptor_for_variant[mut] = wt_receptor
            receptor_pdb_for_variant[mut] = cleaned_pdb
            variant_extra[mut] = f"foldx_failed: {e}"

    set_stage(session, job.id, "preparing_compounds")
    # Step 4+5: prep each ligand and dock against each variant's receptor.
    # We check job.status between cells (cooperative cancellation) — if the
    # user has hit POST /jobs/{key}/cancel via the UI, we bail out as soon
    # as the currently-in-flight Pod GPU call returns. This stops further
    # compute spend within ~3 s of the cancel click.
    with tempfile.TemporaryDirectory(prefix=f"deltadock-job{job.id}-") as work_str:
        work = Path(work_str)

        # ── Pending-validation queue. When defer_validation is on, validation
        # is skipped inside _finalize_cell and queued here. After the main
        # docking loop finishes (and the job is marked COMPLETED so the user
        # sees scores immediately), we drain this queue in a ThreadPoolExecutor
        # that updates row.extra as each validation finishes. The frontend's
        # 2s polling picks up the updates piecewise.
        pending_validations: list[dict] = []
        defer_val = settings.defer_validation and validate_on

        # ── Per-cell finalize: shared between the legacy per-cell path and
        # the new batched-per-variant path. Runs vinardo rescore + (eagerly
        # OR deferred) ProLIF/PoseBusters validation, persists the pose to
        # R2 (or local), and writes the DB row. Pure side effects on
        # `session`; caller commits.
        def _finalize_cell(compound, variant, receptor, receptor_pdb, run_dir, result, engine_used):
            parts = [variant_extra.get(variant)] if variant_extra.get(variant) else []
            parts.append(f"engine={engine_used}")
            try:
                from deltadock_pipeline.rescore import smina_rescore
                v_score = smina_rescore(receptor, result.pose_pdbqt, scoring="vinardo")
                if v_score is not None:
                    parts.append(f"vinardo={v_score:.2f}")
            except Exception as e:
                log.info("Vinardo rescore failed for c%s × %s: %s", compound.id, variant, e)
            if validate_on and not defer_val:
                # Eager (legacy) validation — runs synchronously before the
                # row is written. Slow but simpler.
                try:
                    v = validate_pose(
                        receptor_pdbqt=receptor,
                        pose_pdbqt=result.pose_pdbqt,
                        receptor_pdb=receptor_pdb,
                        work_dir=run_dir,
                        ligand_smiles=compound.smiles,
                    )
                    parts.append(v.to_extra_string())
                except Exception as ve:
                    log.warning("Validation crashed for c%s × %s: %s", compound.id, variant, ve)
                    parts.append(f"validate_err={str(ve)[:80]}")
            elif defer_val:
                # Deferred — write a placeholder so the matrix UI knows to
                # show "validation pending" rather than a missing column.
                parts.append("validate=pending")

            # ── Phase 0 water-displacement analysis (#103). Cheap, inline,
            # fail-soft. Pulls HOH records from raw_pdb (preserved by
            # fetch_pdb before strip_hetatm) and counts crystallographic
            # waters the pose displaces vs the count of pocket waters.
            # Format on extra: "water=N/M" where N=displaced, M=pocket
            # waters. Frontend renders a Water Analysis panel from this
            # plus a "Phase 0: not WaterMap" honesty caveat.
            try:
                from deltadock_pipeline.water import analyse_pose_water_displacement
                wresult = analyse_pose_water_displacement(
                    receptor_pdb=raw_pdb,
                    pose_pdb=result.pose_pdbqt,
                    pocket_centre=(cx, cy, cz),
                    pose_id=f"c{compound.id}_{variant}",
                )
                # Compact representation for the extra string. Rich per-water
                # detail isn't needed for Phase 0 because the JobPage panel
                # surfaces just the counts + interpretation copy. Phase 1
                # (3D-RISM) will warrant a separate JSON column.
                parts.append(f"water={wresult.displaced_count}/{wresult.pocket_water_count}")
            except Exception as we:
                # Fail-soft: water analysis is informational, not blocking.
                # Don't even log warning unless debug — it's expected to
                # fail on cryo-EM PDBs without deposited waters.
                log.debug("Water analysis skipped for c%s × %s: %s", compound.id, variant, we)

            from .pose_store import get_pose_store
            try:
                pose_uri = get_pose_store().write(
                    job.id, compound.id, variant, Path(result.pose_pdbqt)
                )
            except Exception as e:
                log.warning("Could not persist pose for c%s × %s: %s", compound.id, variant, e)
                pose_uri = str(result.pose_pdbqt)
            session.add(DockingResult(
                job_id=job.id, compound_id=compound.id, variant=variant,
                best_score=result.best_score,
                pose_uri=pose_uri,
                extra="|".join(parts) if parts else None,
            ))
            if defer_val:
                # Capture everything the validation thread needs. Note we
                # snapshot the pose_pdbqt path WHILE the runner's tempdir
                # still exists — the validation pass must finish before the
                # outer `with tempfile.TemporaryDirectory()` block exits,
                # otherwise the pose file gets unlinked out from under it.
                pending_validations.append({
                    "job_id": job.id,
                    "compound_id": compound.id,
                    "variant": variant,
                    "receptor": receptor,
                    "receptor_pdb": receptor_pdb,
                    "pose_pdbqt": result.pose_pdbqt,
                    "run_dir": run_dir,
                    "ligand_smiles": compound.smiles,
                    "current_extra": "|".join(parts) if parts else None,
                })

        # ── Batched-per-variant dispatch path. Activates when pod_batch_on
        # AND the matrix has more than one cell. Inverts the loop nesting:
        # for each variant, prep all compound ligands once, then send the
        # whole list to the Pod's /dock_batch endpoint in a single HTTP call.
        # The GPU loads the receptor once per variant instead of once per
        # cell — major throughput win on suite jobs.
        # On any whole-batch HTTP failure we fall back to the per-cell Pod
        # call for that variant, which is exactly what the legacy path does
        # anyway, so reliability is unchanged.
        if pod_batch_on and len(compounds) * len(variants) > 1:
            log.info(
                "Using batched dispatch: %d compounds x %d variants",
                len(compounds), len(variants),
            )

            # Phase 1: prep every ligand once. Failed-prep compounds get a
            # ligand_prep_failed row written for every variant up front so
            # the user sees them immediately and we don't waste GPU on them.
            prepped: dict[int, Path] = {}
            for compound in compounds:
                if is_cancelled(session, job.id):
                    log.info("Job %s cancelled during ligand prep", job.id)
                    raise JobCancelled()
                try:
                    lig_pdbqt = work / f"compound_{compound.id}.pdbqt"
                    prepare_ligand(compound.smiles, lig_pdbqt, name=compound.name or f"c{compound.id}")
                    prepped[compound.id] = lig_pdbqt
                except Exception as e:
                    log.warning("Ligand prep failed for compound %s: %s", compound.id, e)
                    for variant in variants:
                        session.add(DockingResult(
                            job_id=job.id, compound_id=compound.id, variant=variant,
                            best_score=0.0, extra=f"ligand_prep_failed: {e}",
                        ))
                    session.commit()

            # Phase 2: per-variant batched dispatch.
            for variant in variants:
                if is_cancelled(session, job.id):
                    log.info("Job %s cancelled — skipping remaining variants", job.id)
                    raise JobCancelled()
                receptor = receptor_for_variant.get(variant, wt_receptor)
                receptor_pdb = receptor_pdb_for_variant.get(variant, cleaned_pdb)
                # Sentinel: receptor=None means upstream caught a corrupt
                # precache. Write the failure row for every prepped compound
                # in this variant, then move on to the next variant.
                if receptor is None:
                    fail_reason = variant_extra.get(variant, "mutant_verify_failed")
                    log.warning("Variant %s receptor unavailable: %s", variant, fail_reason)
                    for c in compounds:
                        if c.id in prepped:
                            session.add(DockingResult(
                                job_id=job.id, compound_id=c.id, variant=variant,
                                best_score=0.0, extra=fail_reason,
                            ))
                    session.commit()
                    continue

                run_dir = work / f"batch_{variant}"
                run_dir.mkdir(exist_ok=True)

                batch_ligs = [
                    BatchLigand(id=str(c.id), pdbqt_path=prepped[c.id])
                    for c in compounds if c.id in prepped
                ]
                if not batch_ligs:
                    continue

                # Single HTTP call — the Pod loads the receptor once and
                # docks every ligand in one GPU session.
                try:
                    batch_results = dock_batch_pod(
                        receptor_pdbqt=receptor,
                        ligands=batch_ligs,
                        box=box,
                        work_dir=run_dir,
                        cfg=pod_cfg,
                        exhaustiveness=exhaustiveness,
                        num_modes=9,
                    )
                    results_by_id = {br.id: br for br in batch_results}
                    engine_label = "pod_gpu_batch"
                except PodDockError as pde:
                    # Whole-batch failure: fall back to per-cell single-
                    # ligand /dock for this variant. Exact same code path
                    # as the legacy loop uses for a per-cell error, just
                    # scoped to this variant's compounds.
                    log.warning(
                        "Batch dispatch failed for %s: %s — falling back per-cell",
                        variant, pde,
                    )
                    for c in compounds:
                        if c.id not in prepped:
                            continue
                        if is_cancelled(session, job.id):
                            raise JobCancelled()
                        cell_dir = work / f"compound_{c.id}_{variant}"
                        cell_dir.mkdir(exist_ok=True)
                        try:
                            result = dock_one_pod(
                                receptor_pdbqt=receptor,
                                ligand_pdbqt=prepped[c.id],
                                box=box,
                                work_dir=cell_dir,
                                cfg=pod_cfg,
                                exhaustiveness=exhaustiveness,
                                num_modes=9,
                            )
                            _finalize_cell(c, variant, receptor, receptor_pdb, cell_dir, result, "pod_gpu_after_batch_fail")
                        except Exception as e:
                            # Per-cell Pod retry failed too. Burst overflow:
                            # try RunPod serverless if configured before
                            # giving up on this cell.
                            if runpod_on:
                                log.warning("Per-cell Pod fallback failed for c%s × %s: %s — overflowing to RunPod",
                                            c.id, variant, e)
                                try:
                                    result = dock_one_runpod(
                                        receptor_pdbqt=receptor,
                                        ligand_pdbqt=prepped[c.id],
                                        box=box,
                                        work_dir=cell_dir,
                                        cfg=runpod_cfg,
                                        exhaustiveness=exhaustiveness,
                                        num_modes=9,
                                    )
                                    _finalize_cell(c, variant, receptor, receptor_pdb, cell_dir, result, "runpod_after_batch_fail")
                                except Exception as e2:
                                    log.warning("RunPod also failed for c%s × %s: %s", c.id, variant, e2)
                                    session.add(DockingResult(
                                        job_id=job.id, compound_id=c.id, variant=variant,
                                        best_score=0.0, extra=f"docking_failed: {e2}",
                                    ))
                            else:
                                log.warning("Per-cell fallback failed for c%s × %s: %s", c.id, variant, e)
                                session.add(DockingResult(
                                    job_id=job.id, compound_id=c.id, variant=variant,
                                    best_score=0.0, extra=f"docking_failed: {e}",
                                ))
                    session.commit()
                    continue

                # Per-cell post-processing on batch results.
                for c in compounds:
                    if c.id not in prepped:
                        continue
                    br = results_by_id.get(str(c.id))
                    try:
                        if br is None:
                            raise RuntimeError("missing from batch response")
                        if br.error or not br.result:
                            raise RuntimeError(f"batch err: {br.error or 'no result'}")
                        _finalize_cell(c, variant, receptor, receptor_pdb, run_dir, br.result, engine_label)
                    except Exception as e:
                        log.warning("Docking failed for c%s × %s: %s", c.id, variant, e)
                        session.add(DockingResult(
                            job_id=job.id, compound_id=c.id, variant=variant,
                            best_score=0.0, extra=f"docking_failed: {e}",
                        ))
                session.commit()
            # Mark COMPLETED *before* validation drain so the user sees
            # the matrix as soon as docking finishes, not after PoseBusters/
            # ProLIF (~30-60s of blocking subprocess work).
            if pending_validations:
                session.refresh(job)
                if job.status != JobStatus.CANCELLED:
                    job.status = JobStatus.COMPLETED
                    job.updated_at = datetime.utcnow()
                    session.add(job)
                    session.commit()
                    log.info("Job %s docking phase complete; running validation in background", job.id)
            set_stage(session, job.id, "validating_poses" if pending_validations else None)
            _drain_pending_validations(pending_validations, session)
            set_stage(session, job.id, None)
            return  # batched path done; skip the legacy per-cell loop below

        # ── Legacy per-cell dispatch (untouched). Kept as fallback for
        # local Vina runs (no Pod), per-cell debugging, and as the safety
        # net while the batched path stabilizes.
        for compound in compounds:
            if is_cancelled(session, job.id):
                log.info("Job %s cancelled — skipping remaining compounds", job.id)
                raise JobCancelled()
            try:
                lig_pdbqt = work / f"compound_{compound.id}.pdbqt"
                prepare_ligand(compound.smiles, lig_pdbqt, name=compound.name or f"c{compound.id}")
            except Exception as e:
                log.warning("Ligand prep failed for compound %s: %s", compound.id, e)
                for variant in variants:
                    session.add(DockingResult(
                        job_id=job.id, compound_id=compound.id, variant=variant,
                        best_score=0.0, extra=f"ligand_prep_failed: {e}",
                    ))
                session.commit()
                continue

            for variant in variants:
                if is_cancelled(session, job.id):
                    log.info("Job %s cancelled — skipping remaining variants", job.id)
                    raise JobCancelled()
                receptor = receptor_for_variant.get(variant, wt_receptor)
                receptor_pdb = receptor_pdb_for_variant.get(variant, cleaned_pdb)
                # Sentinel: receptor=None means we caught a corrupt precache
                # upstream. Emit a clear failure row and skip docking entirely.
                if receptor is None:
                    fail_reason = variant_extra.get(variant, "mutant_verify_failed")
                    log.warning("Skipping c%s × %s: %s", compound.id, variant, fail_reason)
                    session.add(DockingResult(
                        job_id=job.id, compound_id=compound.id, variant=variant,
                        best_score=0.0, extra=fail_reason,
                    ))
                    session.commit()
                    continue
                run_dir = work / f"compound_{compound.id}_{variant}"
                run_dir.mkdir(exist_ok=True)
                try:
                    # Try the configured remote engine first (Pod GPU > RunPod
                    # serverless > local). On any error fall back to local Vina
                    # so one bad call doesn't take down the whole job.
                    engine_used = "local"
                    result = None
                    # When the user picked engine=gnina on this job AND the
                    # feature flag is on AND the Pod is reachable, GNINA
                    # takes priority over QuickVina2-GPU for the cell. Same
                    # error-handling shape: GNINA failure → fall through to
                    # Pod (QuickVina), then to local Vina, just like the
                    # Pod path does for RunPod overflow.
                    if gnina_requested:
                        try:
                            result = dock_one_gnina(
                                receptor_pdbqt=receptor,
                                ligand_pdbqt=lig_pdbqt,
                                box=box,
                                work_dir=run_dir,
                                cfg=gnina_cfg,
                                exhaustiveness=exhaustiveness,
                                num_modes=9,
                            )
                            engine_used = f"gnina_{settings.gnina_cnn_mode}"
                        except GninaDockError as gde:
                            log.warning("GNINA failed for c%s × %s: %s — falling back to QuickVina2-GPU",
                                        compound.id, variant, gde)
                            # Don't set engine_used yet — let the Pod branch
                            # below run and overwrite engine_used appropriately.
                    if result is None and pod_on:
                        try:
                            result = dock_one_pod(
                                receptor_pdbqt=receptor,
                                ligand_pdbqt=lig_pdbqt,
                                box=box,
                                work_dir=run_dir,
                                cfg=pod_cfg,
                                exhaustiveness=exhaustiveness,
                                num_modes=9,
                            )
                            engine_used = "pod_gpu"
                        except PodDockError as pde:
                            # Burst overflow: Pod busy / down → try RunPod
                            # serverless before falling to local CPU. This
                            # is the whole point of having both engines on.
                            if runpod_on:
                                log.warning("Pod GPU failed for c%s × %s: %s — overflowing to RunPod serverless",
                                            compound.id, variant, pde)
                                try:
                                    result = dock_one_runpod(
                                        receptor_pdbqt=receptor,
                                        ligand_pdbqt=lig_pdbqt,
                                        box=box,
                                        work_dir=run_dir,
                                        cfg=runpod_cfg,
                                        exhaustiveness=exhaustiveness,
                                        num_modes=9,
                                    )
                                    engine_used = "runpod_after_pod_busy"
                                except RunPodError as rpe:
                                    log.warning("RunPod also failed for c%s × %s: %s — falling back to local",
                                                compound.id, variant, rpe)
                                    engine_used = "local_after_pod_and_runpod_fail"
                            else:
                                log.warning("Pod GPU failed for c%s × %s: %s — falling back to local",
                                            compound.id, variant, pde)
                                engine_used = "local_after_pod_fail"
                    # RunPod-only path: Pod not configured (or GNINA path
                    # already covered Pod). Pod-busy overflow is handled
                    # inside the `if result is None and pod_on:` branch
                    # above; this branch fires only when there's no Pod
                    # at all so RunPod is the *primary* remote engine.
                    if result is None and runpod_on and not pod_on:
                        try:
                            result = dock_one_runpod(
                                receptor_pdbqt=receptor,
                                ligand_pdbqt=lig_pdbqt,
                                box=box,
                                work_dir=run_dir,
                                cfg=runpod_cfg,
                                exhaustiveness=exhaustiveness,
                                num_modes=9,
                            )
                            engine_used = "runpod"
                        except RunPodError as rpe:
                            log.warning("RunPod failed for c%s × %s: %s — falling back to local",
                                        compound.id, variant, rpe)
                            engine_used = "local_after_runpod_fail"
                    if result is None:
                        result = dock_one(
                            receptor_pdbqt=receptor,
                            ligand_pdbqt=lig_pdbqt,
                            box=box,
                            work_dir=run_dir,
                            exhaustiveness=exhaustiveness,
                            num_modes=9,
                            vina_path=settings.vina_path,
                        )
                    # Build the `extra` string by combining variant info + validation
                    parts = [variant_extra.get(variant)] if variant_extra.get(variant) else []
                    parts.append(f"engine={engine_used}")

                    # Vinardo rescoring (smina --score_only). Cheap second-pass
                    # score that often discriminates close analogs better than
                    # raw Vina. Failure here is silent — the original Vina
                    # score still ships; we just skip the refined column.
                    try:
                        from deltadock_pipeline.rescore import smina_rescore
                        v_score = smina_rescore(receptor, result.pose_pdbqt, scoring="vinardo")
                        if v_score is not None:
                            parts.append(f"vinardo={v_score:.2f}")
                    except Exception as e:
                        log.info("Vinardo rescore failed for c%s × %s: %s", compound.id, variant, e)

                    if validate_on:
                        try:
                            v = validate_pose(
                                receptor_pdbqt=receptor,
                                pose_pdbqt=result.pose_pdbqt,
                                receptor_pdb=receptor_pdb,
                                work_dir=run_dir,
                                # Pass the original SMILES so ProLIF can re-template
                                # bond orders that obabel's PDBQT round-trip drops.
                                # This is the difference between "no interactions"
                                # and a real contact list on aromatic-rich ligands.
                                ligand_smiles=compound.smiles,
                            )
                            parts.append(v.to_extra_string())
                        except Exception as ve:
                            log.warning("Validation crashed for c%s × %s: %s", compound.id, variant, ve)
                            parts.append(f"validate_err={str(ve)[:80]}")

                    # Persist the pose via the storage abstraction so the API
                    # endpoint still finds it after the runner's tmpdir is
                    # cleaned. Backend is R2 in prod, local disk otherwise.
                    from .pose_store import get_pose_store
                    try:
                        pose_uri = get_pose_store().write(
                            job.id, compound.id, variant, Path(result.pose_pdbqt)
                        )
                    except Exception as e:
                        log.warning("Could not persist pose for c%s × %s: %s", compound.id, variant, e)
                        pose_uri = str(result.pose_pdbqt)  # fallback to tmp

                    session.add(DockingResult(
                        job_id=job.id, compound_id=compound.id, variant=variant,
                        best_score=result.best_score,
                        pose_uri=pose_uri,
                        extra="|".join(parts) if parts else None,
                    ))
                except Exception as e:
                    log.warning("Docking failed for compound %s × %s: %s", compound.id, variant, e)
                    session.add(DockingResult(
                        job_id=job.id, compound_id=compound.id, variant=variant,
                        best_score=0.0, extra=f"docking_failed: {e}",
                    ))
                session.commit()
        # Common drain for both batched and legacy paths. Runs deferred
        # validation (when DEFER_VALIDATION=1) in a thread pool that
        # updates rows in place; tempdir is still alive so pose files
        # are readable. We mark the job COMPLETED *before* the drain so
        # the user sees scores immediately while validation columns fill
        # in via the frontend's polling.
        if pending_validations:
            session.refresh(job)
            if job.status != JobStatus.CANCELLED:
                job.status = JobStatus.COMPLETED
                job.updated_at = datetime.utcnow()
                session.add(job)
                session.commit()
                log.info("Job %s docking phase complete; running validation in background", job.id)
        set_stage(session, job.id, "validating_poses" if pending_validations else None)
        _drain_pending_validations(pending_validations, session)
        set_stage(session, job.id, None)


def _catalog_by_pdb(pdb_id: str):
    """Find a catalog Target by PDB ID rather than slug."""
    from ..catalog import CATALOG
    for t in CATALOG:
        if t.pdb_id.upper() == pdb_id.upper():
            return t
    return None


# ──────────────────────────────────────────────────────────────────────
# Placeholder fallback (used when real binaries aren't installed)
# ──────────────────────────────────────────────────────────────────────

def _run_placeholder(session: Session, job: Job, reason: str | None) -> None:
    log.info("Placeholder run for job %s (reason: %s)", job.id, reason)
    requested_mutations = [m for m in job.mutations.split(",") if m]
    variants = (["WT"] if job.include_wt else []) + requested_mutations
    if not variants:
        log.warning("Placeholder job %s has no variants — nothing to render", job.id)
        return
    compounds = session.exec(select(Compound).where(Compound.job_id == job.id)).all()

    for compound in compounds:
        for variant in variants:
            score = _placeholder_score(compound.smiles, variant)
            session.add(DockingResult(
                job_id=job.id, compound_id=compound.id, variant=variant,
                best_score=score, extra=f"placeholder ({reason})",
            ))
    session.commit()


def _placeholder_score(smiles: str, variant: str) -> float:
    seed = (sum(ord(c) for c in smiles) + sum(ord(c) for c in variant)) % 800
    return -(4 + seed / 100.0)
