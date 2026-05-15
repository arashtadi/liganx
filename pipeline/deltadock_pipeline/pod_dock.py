"""Pod-hosted GPU docking client.

When POD_DOCK_URL is configured, dockings are POSTed to a long-running
FastAPI service on a RunPod *Pod* (not serverless) that wraps QuickVina2-GPU.
The Pod is always warm — no cold starts — so we can use a tight timeout
and skip the queue/poll dance the serverless path needs.

Wire flow:
    runner.py  →  dock_one_pod()  →  HTTPS POST /dock  →  Pod (always-on)
        →  QuickVina2-GPU on GPU  →  pose PDBQT + score  →  back to caller

Why GPU + always-on instead of serverless CPU:
- Same QuickVina scoring function as Vina/QuickVina-CPU, just ~30x faster
  on a single docking thanks to OpenCL parallelism.
- No cold-start latency (Pod stays warm 24/7).
- Cost matches what's already being paid for the Pod whether or not we
  use it; serverless was extra spend on top.

The Pod's `dock_server.py` returns:
    {pose_pdbqt_b64, modes, log, engine, vina_returncode}

Same shape the serverless handler returns, so the caller doesn't need to
care which engine ran the docking.
"""

from __future__ import annotations

import base64
import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .dock import DockingMode, DockingResult, PocketBox

log = logging.getLogger(__name__)


class PodDockError(RuntimeError):
    """Raised on any failure talking to the Pod docking service. Caller is
    expected to fall back to local Vina rather than fail the whole job."""


@dataclass
class PodDockConfig:
    base_url: str          # e.g. https://4cli33cxvf58lb-7861.proxy.runpod.net
    timeout_s: int = 60    # Pod is always warm, so this is real worst-case docking time


def dock_one_pod(
    receptor_pdbqt: Path | str,
    ligand_pdbqt: Path | str,
    box: PocketBox,
    work_dir: Path | str,
    cfg: PodDockConfig,
    *,
    exhaustiveness: int = 8,
    num_modes: int = 9,
    seed: int = 42,
    thread: int = 8000,
) -> DockingResult:
    """Run a single docking on the GPU Pod. Returns the same DockingResult
    shape as local `dock_one`, so callers can swap engines transparently.

    The pose PDBQT is decoded and written to `work_dir` so the rest of the
    pipeline (validation, persistence, viewer) sees a normal file on disk —
    matching exactly what the local and RunPod-serverless paths produce.
    """
    receptor_pdbqt = Path(receptor_pdbqt)
    ligand_pdbqt = Path(ligand_pdbqt)
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    if not receptor_pdbqt.exists():
        raise PodDockError(f"Receptor PDBQT not found: {receptor_pdbqt}")
    if not ligand_pdbqt.exists():
        raise PodDockError(f"Ligand PDBQT not found: {ligand_pdbqt}")

    payload = {
        "receptor_pdbqt_b64": _b64(receptor_pdbqt.read_bytes()),
        "ligand_pdbqt_b64": _b64(ligand_pdbqt.read_bytes()),
        "box": {
            "center_x": box.center_x, "center_y": box.center_y, "center_z": box.center_z,
            "size_x": box.size_x,     "size_y": box.size_y,     "size_z": box.size_z,
        },
        "exhaustiveness": exhaustiveness,
        "num_modes": num_modes,
        "seed": seed,
        "thread": thread,
    }

    url = cfg.base_url.rstrip("/") + "/dock"
    log.info("Dispatching to Pod %s (%s vs %s)", cfg.base_url, receptor_pdbqt.name, ligand_pdbqt.name)

    output = _post_json(url=url, body=payload, timeout_s=cfg.timeout_s)

    # Worker contract: returns base64 pose PDBQT + parsed mode rows + engine name
    pose_b64 = output.get("pose_pdbqt_b64")
    modes_raw = output.get("modes")
    engine = output.get("engine")
    if engine:
        log.info("Pod reported engine=%s", engine)

    if not pose_b64 or not modes_raw:
        raise PodDockError(f"Malformed Pod response (missing pose/modes): {str(output)[:200]}")

    pose_path = work_dir / f"{ligand_pdbqt.stem}_dock.pdbqt"
    pose_path.write_bytes(base64.b64decode(pose_b64))

    log_path = work_dir / f"{ligand_pdbqt.stem}_dock.log"
    log_path.write_text(output.get("log", "") or "(pod: no log captured)")

    modes = [
        DockingMode(
            rank=int(m["rank"]),
            affinity_kcal_mol=float(m["affinity_kcal_mol"]),
            rmsd_lb=float(m.get("rmsd_lb", 0.0)),
            rmsd_ub=float(m.get("rmsd_ub", 0.0)),
        )
        for m in modes_raw
    ]
    if not modes:
        raise PodDockError("Pod returned 0 docking modes")

    return DockingResult(
        receptor_pdbqt=receptor_pdbqt,
        ligand_pdbqt=ligand_pdbqt,
        pose_pdbqt=pose_path,
        log_path=log_path,
        modes=modes,
    )


@dataclass
class BatchLigand:
    """One ligand in a batch dispatch. `id` is the caller's identifier
    (e.g. compound_id stringified) — used both as the input filename stem
    on the Pod and as the key in the response so we can map results back."""
    id: str
    pdbqt_path: Path


@dataclass
class BatchDockResult:
    """One ligand's result from a batched dispatch. Either populated with a
    real DockingResult (success) or with `error` (per-ligand failure that
    didn't take down the whole batch)."""
    id: str
    result: DockingResult | None = None
    error: str | None = None


def dock_batch_pod(
    receptor_pdbqt: Path | str,
    ligands: list[BatchLigand],
    box: PocketBox,
    work_dir: Path | str,
    cfg: PodDockConfig,
    *,
    exhaustiveness: int = 8,
    num_modes: int = 9,
    seed: int = 42,
    thread: int = 8000,
) -> list[BatchDockResult]:
    """Dock N ligands against ONE receptor in a single GPU call.

    QuickVina2-GPU exposes --ligand_directory / --output_directory, so the
    Pod's /dock_batch endpoint loads the receptor once and runs all N
    dockings in the same process. That's the actual throughput multiplier
    vs. our old "one HTTP call per ligand" loop, which paid the GPU init +
    receptor load cost on every cell.

    Per-ligand failures don't kill the whole batch — the response carries
    `{"id": ..., "error": "..."}` for failures alongside successful results.

    Args:
        receptor_pdbqt: Receptor PDBQT, sent once for the whole batch.
        ligands: List of (id, pdbqt_path) tuples — the `id` is preserved
                 in the response so the caller can map results back to
                 cells without ambiguity.
        box, exhaustiveness, num_modes, seed, thread: forwarded as-is.
        work_dir: Where to write per-ligand pose+log files (one per success).
        cfg: Pod URL + base timeout. The actual request timeout is auto-
             scaled with batch size (see below).

    Returns a list of BatchDockResult, one per input ligand, in the same
    order as `ligands`. Caller iterates to persist DB rows.
    """
    receptor_pdbqt = Path(receptor_pdbqt)
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    if not receptor_pdbqt.exists():
        raise PodDockError(f"Receptor PDBQT not found: {receptor_pdbqt}")
    if not ligands:
        return []

    # Build the payload once. Missing/unreadable ligands fail upfront with
    # a per-ligand error, not a whole-batch raise — the caller decides
    # whether to retry just those cells via the legacy single-ligand path.
    ligand_payloads: list[dict] = []
    upfront_errors: dict[str, str] = {}
    for lig in ligands:
        p = Path(lig.pdbqt_path)
        if not p.exists() or p.stat().st_size == 0:
            upfront_errors[lig.id] = f"ligand pdbqt missing or empty: {p.name}"
            continue
        try:
            ligand_payloads.append({"id": lig.id, "pdbqt_b64": _b64(p.read_bytes())})
        except Exception as e:
            upfront_errors[lig.id] = f"could not read ligand: {e}"

    if not ligand_payloads:
        # Every ligand failed prep — return per-ligand errors, no HTTP call.
        return [
            BatchDockResult(id=lig.id, error=upfront_errors.get(lig.id, "no payload"))
            for lig in ligands
        ]

    payload = {
        "receptor_pdbqt_b64": _b64(receptor_pdbqt.read_bytes()),
        "ligands": ligand_payloads,
        "box": {
            "center_x": box.center_x, "center_y": box.center_y, "center_z": box.center_z,
            "size_x": box.size_x,     "size_y": box.size_y,     "size_z": box.size_z,
        },
        "exhaustiveness": exhaustiveness,
        "num_modes": num_modes,
        "seed": seed,
        "thread": thread,
    }

    url = cfg.base_url.rstrip("/") + "/dock_batch"
    # Timeout scales with batch size: GPU init (~5-10s) plus ~5s per
    # ligand at exhaustiveness=8 with generous headroom. The Pod-side
    # cap is the same shape (max(300, 30 + 6*N)) so we want client > Pod.
    batch_timeout = max(cfg.timeout_s, 60 + 8 * len(ligand_payloads))
    log.info(
        "Dispatching batch to Pod %s (1 receptor × %d ligands, timeout=%ds)",
        cfg.base_url, len(ligand_payloads), batch_timeout,
    )

    output = _post_json(url=url, body=payload, timeout_s=batch_timeout)

    # Pod contract:
    #   {"results": [{"id":..., "pose_pdbqt_b64":..., "modes":[...]} OR
    #                {"id":..., "error":...}, ...],
    #    "engine": "QuickVina2-GPU-2.1",
    #    "log": "...",
    #    "ligands_total": N, "ligands_succeeded": M}
    raw_results = output.get("results")
    if not isinstance(raw_results, list):
        raise PodDockError(f"Malformed batch response (no 'results' list): {str(output)[:200]}")
    engine = output.get("engine")
    if engine:
        log.info(
            "Pod batch done: engine=%s, %d/%d succeeded",
            engine, output.get("ligands_succeeded", 0), output.get("ligands_total", 0),
        )

    by_id: dict[str, dict] = {}
    for r in raw_results:
        if isinstance(r, dict) and r.get("id"):
            by_id[r["id"]] = r

    out: list[BatchDockResult] = []
    for lig in ligands:
        if lig.id in upfront_errors:
            out.append(BatchDockResult(id=lig.id, error=upfront_errors[lig.id]))
            continue
        r = by_id.get(lig.id)
        if r is None:
            out.append(BatchDockResult(
                id=lig.id, error="missing from batch response (bug or partial response)",
            ))
            continue
        if "error" in r and r.get("error"):
            out.append(BatchDockResult(id=lig.id, error=str(r["error"])))
            continue
        pose_b64 = r.get("pose_pdbqt_b64")
        modes_raw = r.get("modes") or []
        if not pose_b64 or not modes_raw:
            out.append(BatchDockResult(id=lig.id, error="missing pose/modes in result"))
            continue

        # Write pose + log to work_dir matching the per-cell layout the
        # rest of the pipeline expects (validation, ProLIF, persistence
        # all read from work_dir using these filenames).
        ligand_path = Path(lig.pdbqt_path)
        pose_path = work_dir / f"{ligand_path.stem}_dock.pdbqt"
        pose_path.write_bytes(base64.b64decode(pose_b64))

        log_path = work_dir / f"{ligand_path.stem}_dock.log"
        # Batched dock doesn't have a per-ligand stdout (QuickVina-GPU
        # interleaves them all), so we attach the batch-level log tail
        # for context. Sufficient for debugging; PoseBusters / ProLIF
        # don't depend on log content.
        log_path.write_text(output.get("log", "") or "(pod batch: no log captured)")

        try:
            modes = [
                DockingMode(
                    rank=int(m["rank"]),
                    affinity_kcal_mol=float(m["affinity_kcal_mol"]),
                    rmsd_lb=float(m.get("rmsd_lb", 0.0)),
                    rmsd_ub=float(m.get("rmsd_ub", 0.0)),
                )
                for m in modes_raw
            ]
        except (KeyError, TypeError, ValueError) as e:
            out.append(BatchDockResult(id=lig.id, error=f"malformed modes: {e}"))
            continue

        if not modes:
            out.append(BatchDockResult(id=lig.id, error="zero docking modes returned"))
            continue

        out.append(BatchDockResult(
            id=lig.id,
            result=DockingResult(
                receptor_pdbqt=receptor_pdbqt,
                ligand_pdbqt=ligand_path,
                pose_pdbqt=pose_path,
                log_path=log_path,
                modes=modes,
            ),
        ))

    return out


# ─────────────────── ensemble (receptor relaxation) ───────────────────

def relax_ensemble_pod(
    receptor_pdb: Path | str,
    box_center: tuple[float, float, float],
    out_dir: Path | str,
    cfg: PodDockConfig,
    *,
    n_relaxed: int = 4,
    md_ps: float = 250.0,
    equil_ps: float = 20.0,
    pocket_radius: float = 12.0,
    timeout_s: int = 240,
) -> list[Path]:
    """Generate a receptor conformer ensemble on the GPU Pod.

    POSTs a cleaned receptor PDB (heavy atoms, original numbering — the
    output of prep.fix_pdb / the mutant builder) to the Pod's
    ``/relax_ensemble`` endpoint, which runs a short restrained GPU MD
    (see runpod/dock_pod/ensemble_pod.py) and returns ``[input] + N``
    relaxed receptor conformers as PDB text. The relaxed conformers are
    written to ``out_dir`` as files; element 0 of the returned list is the
    ORIGINAL ``receptor_pdb`` path (unchanged on disk), so ensemble docking
    can never score worse than standard single-conformation docking.

    Fail-soft contract — this function NEVER raises. On any failure (Pod
    down, HTTP error, malformed response, MD blow-up on the Pod, file
    write error) it returns just ``[receptor_pdb]``: the caller
    transparently degrades to exactly today's single-conformation
    behaviour. The worst case is "ensemble mode silently behaved like
    standard mode", never "the job crashed".

    Args:
        receptor_pdb:  cleaned receptor PDB path (heavy atoms). NOT a PDBQT.
        box_center:    (x, y, z) docking-box centre in PDB Å — defines which
                       residues the Pod treats as "pocket" (side chains free).
        out_dir:       directory the relaxed conformer PDBs are written to.
        cfg:           Pod URL + base timeout (only base_url is used here).
        n_relaxed:     how many MD-snapshot conformers to request.
        md_ps:         total MD length (ps) after equilibration.
        equil_ps:      equilibration discarded before snapshotting.
        pocket_radius: residues with Cα within this (Å) of box_center keep
                       their side chains free; everything else is restrained.
        timeout_s:     HTTP timeout. Restrained MD on the Pod GPU is fast
                       (~5 s for a typical kinase domain) but big receptors
                       or a cold OpenMM context warrant generous headroom.

    Returns:
        A list of receptor PDB paths to dock against. Length is between 1
        and (1 + n_relaxed). ALWAYS contains at least ``[receptor_pdb]`` —
        on any failure that single-element list is what comes back.
    """
    receptor_pdb = Path(receptor_pdb)
    fallback = [receptor_pdb]
    if not receptor_pdb.exists():
        log.warning("relax_ensemble_pod: receptor PDB not found: %s", receptor_pdb)
        return fallback
    if n_relaxed <= 0:
        return fallback

    out_dir = Path(out_dir)
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        receptor_text = receptor_pdb.read_text()
    except Exception as e:  # noqa: BLE001
        log.warning("relax_ensemble_pod: could not read receptor / make out_dir: %s", e)
        return fallback

    payload = {
        "receptor_pdb": receptor_text,
        "box_center": [float(box_center[0]), float(box_center[1]), float(box_center[2])],
        "n_relaxed": n_relaxed,
        "md_ps": md_ps,
        "equil_ps": equil_ps,
        "pocket_radius": pocket_radius,
    }
    url = cfg.base_url.rstrip("/") + "/relax_ensemble"
    log.info("Requesting receptor ensemble from Pod %s (%s, n_relaxed=%d)",
             cfg.base_url, receptor_pdb.name, n_relaxed)

    try:
        output = _post_json(url=url, body=payload, timeout_s=timeout_s)
    except PodDockError as e:
        # Fail-soft: a Pod hiccup must not take down the dock — the caller
        # just docks against the single crystal conformer instead.
        log.warning("relax_ensemble_pod: Pod call failed, single-conformer fallback: %s", e)
        return fallback

    # Pod contract (see runpod/dock_pod/relax_ensemble_endpoint.txt):
    #   {"ok": bool, "n": int, "conformers": [pdb_str, ...]}
    # conformers[0] is always the un-relaxed input text; conformers[1:] are
    # the MD-relaxed snapshots. We keep the ORIGINAL receptor_pdb path as
    # element 0 (no need to round-trip the input through a file) and write
    # only the relaxed snapshots to disk.
    conformers = output.get("conformers")
    if not isinstance(conformers, list) or len(conformers) < 2:
        # ok=False, or the Pod's own MD fail-soft kicked in and returned
        # just [input]. Either way: degrade to single-conformer.
        if not output.get("ok", False):
            log.warning("relax_ensemble_pod: Pod reported failure (%s) — single-conformer fallback",
                        str(output.get("error"))[:160])
        else:
            log.info("relax_ensemble_pod: Pod returned no relaxed conformers — single-conformer fallback")
        return fallback

    out_paths: list[Path] = [receptor_pdb]
    for i, conf_text in enumerate(conformers[1:], start=1):
        if not isinstance(conf_text, str) or not conf_text.strip():
            log.warning("relax_ensemble_pod: conformer %d empty/non-string — skipping", i)
            continue
        try:
            conf_path = out_dir / f"{receptor_pdb.stem}_conf{i}.pdb"
            conf_path.write_text(conf_text)
            out_paths.append(conf_path)
        except Exception as e:  # noqa: BLE001
            # One bad snapshot shouldn't lose the others (or the input).
            log.warning("relax_ensemble_pod: could not write conformer %d: %s", i, e)

    log.info("relax_ensemble_pod: ensemble ready for %s (1 input + %d relaxed)",
             receptor_pdb.name, len(out_paths) - 1)
    return out_paths


# ───────────────────────── helpers ─────────────────────────

def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _post_json(url: str, body: dict, timeout_s: int) -> dict:
    """Minimal stdlib HTTPS POST to the Pod's /dock endpoint. Surfaces the
    response body on HTTP errors so the caller can record a useful message.

    User-Agent matters here: RunPod's proxy is fronted by Cloudflare, which
    blocks the default `Python-urllib/X.Y` UA with error code 1010. We send
    a deltadock-branded UA that looks like a real client to slip past the
    bot filter. (No other auth needed — the Pod proxy URL is per-pod and
    unauthenticated by design.)"""
    raw = json.dumps(body).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "deltadock-backend/0.1 (+https://deltadock.bio)",
        "Accept": "application/json",
    }
    req = urllib.request.Request(url, data=raw, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = ""
        try:
            body_text = e.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            pass
        raise PodDockError(f"HTTP {e.code} from Pod: {body_text}") from e
    except urllib.error.URLError as e:
        raise PodDockError(f"Network error reaching Pod: {e.reason}") from e
    except TimeoutError as e:
        raise PodDockError(f"Pod call timed out after {timeout_s}s") from e
