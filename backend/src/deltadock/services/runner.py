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

# Persistent receptor cache so we don't re-prep the same PDB across jobs
RECEPTOR_CACHE = Path.home() / ".deltadock" / "receptors"
PDB_CACHE = Path.home() / ".deltadock" / "pdb"
FOLDX_CACHE = Path.home() / ".deltadock" / "foldx-cache"
# Persistent pose cache — runner's tmpdir gets cleaned, but the API needs poses
# to outlive the run so users can re-open jobs and the 3D viewer still works.
# In production this is overridden by `pose_cache_dir` (Fly.io volume mount);
# in dev it stays under ~/.deltadock so existing rows keep resolving without
# a data migration. See also services/pose_store.py for the R2 abstraction
# that supersedes this directory when R2 is configured.
POSE_CACHE = Path(settings.pose_cache_dir) if settings.pose_cache_dir else Path.home() / ".deltadock" / "poses"
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


def run_job_in_background(job_id: int) -> None:
    """Background entrypoint. Pulls the job, runs docking, writes results."""
    log.info("Running job %s", job_id)
    with Session(engine) as session:
        job = session.get(Job, job_id)
        if not job:
            log.error("Job %s not found", job_id)
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

            job.status = JobStatus.COMPLETED
            job.updated_at = datetime.utcnow()
            session.add(job)
            session.commit()
            log.info("Job %s completed", job_id)
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

    runpod_on = settings.runpod_enabled and not pod_on  # Pod takes precedence
    if runpod_on:
        from deltadock_pipeline.runpod_dock import dock_one_runpod, RunPodConfig, RunPodError
        runpod_cfg = RunPodConfig(
            api_key=settings.runpod_api_key,
            endpoint_id=settings.runpod_endpoint_id,
            timeout_s=settings.runpod_timeout_s,
        )
        log.info("RunPod serverless dispatch enabled → endpoint %s", settings.runpod_endpoint_id)

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
    cleaned_pdb = PDB_CACHE / f"{pdb_id}_{chain}.clean.pdb"
    if not cleaned_pdb.exists() or cleaned_pdb.stat().st_size == 0:
        log.info("Cleaning %s with PDBFixer", pdb_id)
        try:
            fix_pdb(raw_pdb, cleaned_pdb, chain=chain)
        except Exception as e:
            raise RuntimeError(
                f"prep_step=fix_pdb pdb={pdb_id} chain={chain}: {type(e).__name__}: {e}"
            ) from e

    # Step 2: prep WT receptor once. Cached across jobs.
    RECEPTOR_CACHE.mkdir(parents=True, exist_ok=True)
    wt_receptor = RECEPTOR_CACHE / f"{pdb_id}_{chain}_WT.pdbqt"
    if not wt_receptor.exists() or wt_receptor.stat().st_size == 0:
        log.info("Prepping WT receptor %s chain %s", pdb_id, chain)
        try:
            prepare_receptor(cleaned_pdb, wt_receptor, chain=chain)
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

    FOLDX_CACHE.mkdir(parents=True, exist_ok=True)
    for mut in [m for m in job.mutations.split(",") if m]:
        # PRECACHE FIRST — many mutant receptors were built offline with FoldX
        # and baked into the Docker image (see backend/precache/receptors/).
        # Without this check, prod (where FoldX isn't installed) would
        # silently dock every mutant against WT and produce IDENTICAL
        # scores per row — the bug reported as "WT and mutation always
        # have the same value".
        cached_mut_pdbqt = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.pdbqt"
        if cached_mut_pdbqt.exists() and cached_mut_pdbqt.stat().st_size > 0:
            # VERIFY the precached receptor actually contains the mutation.
            # PDBFixer used to silently renumber residues, causing FoldX to
            # mutate the wrong atom and produce mutant files that look right
            # but are biophysically WT. If verification fails, we mark this
            # variant so the per-cell loop writes a loud error instead of
            # docking against a corrupt receptor.
            ok, reason = verify_mutation_applied(cached_mut_pdbqt, chain, mut)
            if ok:
                receptor_for_variant[mut] = cached_mut_pdbqt
                cached_mut_pdb = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{mut}.clean.pdb"
                if cached_mut_pdb.exists():
                    receptor_pdb_for_variant[mut] = cached_mut_pdb
                variant_extra[mut] = "foldx_precached"
                log.info("Using precached mutant receptor %s (verified)", cached_mut_pdbqt.name)
            else:
                # Don't dock — the precache is corrupt. Mark for loud failure.
                log.warning("Precached mutant %s FAILED verification: %s", cached_mut_pdbqt.name, reason)
                receptor_for_variant[mut] = None  # type: ignore[assignment]
                variant_extra[mut] = f"mutant_verify_failed: {reason}"
            continue
        if not foldx_on:
            receptor_for_variant[mut] = wt_receptor
            variant_extra[mut] = "no_foldx_dock_against_wt"
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

    # Step 4+5: prep each ligand and dock against each variant's receptor
    with tempfile.TemporaryDirectory(prefix=f"deltadock-job{job.id}-") as work_str:
        work = Path(work_str)
        for compound in compounds:
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
                    if pod_on:
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
                            log.warning("Pod GPU failed for c%s × %s: %s — falling back to local",
                                        compound.id, variant, pde)
                            engine_used = "local_after_pod_fail"
                    elif runpod_on:
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
