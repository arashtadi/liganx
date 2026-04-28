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

    # Prep version stamp. When this changes, all cached cleaned PDBs and
    # derived receptors get auto-invalidated and rebuilt with the new prep.
    # v2 = numbering-preserving fix_pdb (skips findMissingResidues that used
    # to silently renumber every residue). Bumping this is the cleanest way
    # to force a one-time precache rebuild without manual file deletion.
    PREP_VERSION = "v2"

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
        log.info("Cleaning %s with PDBFixer (prep %s)", pdb_id, PREP_VERSION)
        try:
            fix_pdb(raw_pdb, cleaned_pdb, chain=chain)
            _stamp(cleaned_pdb)
        except Exception as e:
            # Self-heal: ANY failure inside fix_pdb suggests the cached raw
            # or cleaned files are in a bad state — could be:
            #   - "No ATOM lines kept": empty/truncated download
            #   - IndexError from PDBFixer: corrupt residue records
            #   - PrepError from obabel/PDBFixer: malformed coordinates
            #   - ValueError parsing coordinate fields
            # In all cases the cure is the same: nuke both the raw cached
            # file (forces refetch from RCSB) and any partial cleaned
            # output (forces re-clean). Cleanup is best-effort — failures
            # to unlink are silently ignored. USR_ uploads are exempt
            # from raw-file deletion since we can't refetch user uploads.
            if not pdb_id.startswith("USR_"):
                for stale_path in (raw_pdb, cleaned_pdb,
                                   cleaned_pdb.with_suffix(cleaned_pdb.suffix + ".prep_version"),
                                   cleaned_pdb.with_suffix(".prestrip.pdb")):
                    try:
                        if stale_path.exists():
                            stale_path.unlink()
                    except OSError:
                        pass
                log.warning(
                    "fix_pdb failed for %s — deleted raw + cleaned caches "
                    "so the next attempt rebuilds from a fresh RCSB fetch. "
                    "Original error: %s",
                    pdb_id, str(e)[:160],
                )
            raise RuntimeError(
                f"prep_step=fix_pdb pdb={pdb_id} chain={chain}: {type(e).__name__}: {e}"
            ) from e

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

    # The Vina box only "sees" atoms within ~half-edge of box center. Box
    # is 22 Å so half-edge is 11 Å. ANY mutation residue whose CA is more
    # than that distance away can't influence the dock — even FLT3 D835V
    # at 12.6 Å (just outside the box) reproducibly produces identical WT
    # and mutant scores. We use the strict 11 Å so we honestly tag every
    # such case rather than mislead the user with apparent "no effect".
    POCKET_RADIUS_A = 11.0

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

    # Step 4+5: prep each ligand and dock against each variant's receptor.
    # We check job.status between cells (cooperative cancellation) — if the
    # user has hit POST /jobs/{key}/cancel via the UI, we bail out as soon
    # as the currently-in-flight Pod GPU call returns. This stops further
    # compute spend within ~3 s of the cancel click.
    with tempfile.TemporaryDirectory(prefix=f"deltadock-job{job.id}-") as work_str:
        work = Path(work_str)
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
