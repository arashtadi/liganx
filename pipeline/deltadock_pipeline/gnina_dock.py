"""GNINA docking client (Pod-hosted).

Companion to `pod_dock.py` (QuickVina2-GPU). Same Pod, same NVIDIA GPU,
different binary, different scoring head: GNINA wraps Vina's pose-search
algorithm with a CNN-based rescoring stage trained on PDBbind. The
output carries both a Vina-style affinity (kcal/mol) AND CNN scores
(`cnn_score` 0–1 confidence + `cnn_affinity` pK_d) — those CNN columns
are the differentiator and what users pick GNINA for.

Wire flow:
    runner.py  →  dock_one_gnina()  →  HTTPS POST /dock_gnina  →  Pod
        →  GNINA on GPU  →  pose PDBQT + Vina affinity + CNN scores
        →  back to caller as a DockingResult with cnn_* fields populated.

The Pod-side endpoint is added by `pod/gnina_endpoints_patch.py`. See
`pod/GNINA_INSTALL.md` for the install runbook.

Why a separate module instead of extending pod_dock.py: GNINA's request
shape has a `cnn_mode` field that doesn't exist on QuickVina, and the
parsing of CNN remarks is unique to GNINA's output format. Keeping the
two clients separate makes the dispatch logic in runner.py a clean
two-line switch instead of a tangle of conditionals.
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


class GninaDockError(RuntimeError):
    """Raised on any failure talking to the Pod's GNINA endpoint. Caller
    is expected to fall back to QuickVina2-GPU or local Vina rather than
    failing the whole job — same contract as PodDockError."""


@dataclass
class GninaDockConfig:
    base_url: str          # same Pod URL as QuickVina; just hits a different route
    timeout_s: int = 120   # GNINA is ~2-3x slower than QuickVina2-GPU per ligand
    cnn_mode: str = "rescore"  # "rescore" (fast) | "refine" (slower, more accurate) | "none"


def dock_one_gnina(
    receptor_pdbqt: Path | str,
    ligand_pdbqt: Path | str,
    box: PocketBox,
    work_dir: Path | str,
    cfg: GninaDockConfig,
    *,
    exhaustiveness: int = 8,
    num_modes: int = 9,
    seed: int = 42,
) -> DockingResult:
    """Single-ligand GNINA docking via the Pod.

    Returns a `DockingResult` with CNN scores populated on each mode
    (cnn_score, cnn_affinity). The pose PDBQT is written to `work_dir`
    so the rest of the validation pipeline (PoseBusters, ProLIF, strain)
    works on it identically to QuickVina2-GPU output.
    """
    receptor_pdbqt = Path(receptor_pdbqt)
    ligand_pdbqt = Path(ligand_pdbqt)
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    if not receptor_pdbqt.exists():
        raise GninaDockError(f"Receptor PDBQT not found: {receptor_pdbqt}")
    if not ligand_pdbqt.exists():
        raise GninaDockError(f"Ligand PDBQT not found: {ligand_pdbqt}")

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
        "cnn_mode": cfg.cnn_mode,
    }

    url = cfg.base_url.rstrip("/") + "/dock_gnina"
    log.info("Dispatching GNINA on Pod %s (%s vs %s, cnn=%s)",
             cfg.base_url, receptor_pdbqt.name, ligand_pdbqt.name, cfg.cnn_mode)

    output = _post_json(url=url, body=payload, timeout_s=cfg.timeout_s)

    pose_b64 = output.get("pose_pdbqt_b64")
    modes_raw = output.get("modes")
    engine = output.get("engine")
    if engine:
        log.info("Pod reported engine=%s", engine)

    if not pose_b64 or not modes_raw:
        raise GninaDockError(f"Malformed GNINA response (missing pose/modes): {str(output)[:200]}")

    pose_path = work_dir / f"{ligand_pdbqt.stem}_dock.pdbqt"
    pose_path.write_bytes(base64.b64decode(pose_b64))

    log_path = work_dir / f"{ligand_pdbqt.stem}_dock.log"
    log_path.write_text(output.get("log", "") or "(gnina: no log captured)")

    modes = [_parse_gnina_mode(m) for m in modes_raw]
    if not modes:
        raise GninaDockError("GNINA returned 0 docking modes")

    return DockingResult(
        receptor_pdbqt=receptor_pdbqt,
        ligand_pdbqt=ligand_pdbqt,
        pose_pdbqt=pose_path,
        log_path=log_path,
        modes=modes,
    )


@dataclass
class GninaBatchLigand:
    """One ligand in a GNINA batch dispatch. Mirrors BatchLigand from
    pod_dock.py — separate class to keep the two engines decoupled."""
    id: str
    pdbqt_path: Path


@dataclass
class GninaBatchResult:
    id: str
    result: DockingResult | None = None
    error: str | None = None


def dock_batch_gnina(
    receptor_pdbqt: Path | str,
    ligands: list[GninaBatchLigand],
    box: PocketBox,
    work_dir: Path | str,
    cfg: GninaDockConfig,
    *,
    exhaustiveness: int = 8,
    num_modes: int = 9,
    seed: int = 42,
) -> list[GninaBatchResult]:
    """Dock N ligands against ONE receptor in a single GNINA HTTP call.

    Note GNINA doesn't have a native ligand-directory mode like QuickVina
    does — the Pod-side handler runs ligands sequentially under the hood.
    The win vs N separate /dock_gnina calls is purely network: one HTTP
    round-trip, one receptor decode. Cap at 50 ligands per batch (vs 200
    for QuickVina) since each ligand serializes on the GPU anyway.
    """
    receptor_pdbqt = Path(receptor_pdbqt)
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    if not receptor_pdbqt.exists():
        raise GninaDockError(f"Receptor PDBQT not found: {receptor_pdbqt}")
    if not ligands:
        return []
    if len(ligands) > 50:
        raise GninaDockError(f"GNINA batch capped at 50 ligands; got {len(ligands)}")

    payload_ligands: list[dict] = []
    for lig in ligands:
        if not Path(lig.pdbqt_path).exists():
            return [GninaBatchResult(id=lig.id, error=f"missing PDBQT: {lig.pdbqt_path}")
                    for lig in ligands]
        payload_ligands.append({
            "id": lig.id,
            "pdbqt_b64": _b64(Path(lig.pdbqt_path).read_bytes()),
        })

    payload = {
        "receptor_pdbqt_b64": _b64(receptor_pdbqt.read_bytes()),
        "box": {
            "center_x": box.center_x, "center_y": box.center_y, "center_z": box.center_z,
            "size_x": box.size_x,     "size_y": box.size_y,     "size_z": box.size_z,
        },
        "ligands": payload_ligands,
        "exhaustiveness": exhaustiveness,
        "num_modes": num_modes,
        "seed": seed,
        "cnn_mode": cfg.cnn_mode,
    }

    url = cfg.base_url.rstrip("/") + "/dock_batch_gnina"
    # Auto-scale timeout: GNINA per-ligand worst case ~120 s with cnn=refine,
    # ~60 s with cnn=rescore. Add HTTP/queue headroom.
    per_lig = 120 if cfg.cnn_mode == "refine" else 60
    timeout = max(cfg.timeout_s, 30 + per_lig * len(ligands))
    log.info("Dispatching GNINA batch on Pod %s (%d ligands, cnn=%s, timeout=%ds)",
             cfg.base_url, len(ligands), cfg.cnn_mode, timeout)

    output = _post_json(url=url, body=payload, timeout_s=timeout)
    results_raw = output.get("results") or []

    out: list[GninaBatchResult] = []
    by_id = {str(r.get("id")): r for r in results_raw if r.get("id") is not None}

    for lig in ligands:
        r = by_id.get(str(lig.id))
        if r is None:
            out.append(GninaBatchResult(id=lig.id, error="missing from batch response"))
            continue
        if r.get("error"):
            out.append(GninaBatchResult(id=lig.id, error=str(r["error"])))
            continue
        pose_b64 = r.get("pose_pdbqt_b64")
        modes_raw = r.get("modes") or []
        if not pose_b64 or not modes_raw:
            out.append(GninaBatchResult(id=lig.id, error="missing pose/modes in result"))
            continue

        ligand_path = Path(lig.pdbqt_path)
        pose_path = work_dir / f"{ligand_path.stem}_dock.pdbqt"
        pose_path.write_bytes(base64.b64decode(pose_b64))
        log_path = work_dir / f"{ligand_path.stem}_dock.log"
        log_path.write_text(output.get("log", "") or "(gnina batch: no log captured)")

        try:
            modes = [_parse_gnina_mode(m) for m in modes_raw]
        except (KeyError, TypeError, ValueError) as e:
            out.append(GninaBatchResult(id=lig.id, error=f"malformed modes: {e}"))
            continue

        if not modes:
            out.append(GninaBatchResult(id=lig.id, error="zero docking modes returned"))
            continue

        out.append(GninaBatchResult(
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


# ───────────────────────── helpers ─────────────────────────

def _parse_gnina_mode(m: dict) -> DockingMode:
    """Build a DockingMode from a GNINA result row.

    GNINA doesn't return rmsd_lb / rmsd_ub in the same way Vina does
    (those are search-tree artifacts; GNINA's CNN refinement reshapes
    the output). Default them to 0.0 — downstream consumers tolerate
    that. The interesting fields are `cnn_score` and `cnn_affinity`.
    """
    return DockingMode(
        rank=int(m["rank"]),
        affinity_kcal_mol=float(m["affinity_kcal_mol"]),
        rmsd_lb=float(m.get("rmsd_lb", 0.0)),
        rmsd_ub=float(m.get("rmsd_ub", 0.0)),
        cnn_score=_maybe_float(m.get("cnn_score")),
        cnn_affinity=_maybe_float(m.get("cnn_affinity")),
    )


def _maybe_float(x) -> float | None:
    if x is None:
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _post_json(url: str, body: dict, timeout_s: int) -> dict:
    """Same minimal HTTPS POST helper as pod_dock._post_json — duplicated
    here to keep the GNINA module self-contained (the two engines may
    diverge on auth / headers / error handling later)."""
    raw = json.dumps(body).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        # User-Agent matters: RunPod's Cloudflare proxy blocks the default
        # `Python-urllib/X.Y` UA with error 1010. Send a real-looking UA.
        "User-Agent": "liganx-backend/0.1 (+https://liganx.com)",
        "Accept": "application/json",
    }
    req = urllib.request.Request(url, data=raw, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_excerpt = ""
        try:
            body_excerpt = e.read().decode("utf-8", errors="replace")[:500]
        except Exception:
            pass
        raise GninaDockError(
            f"Pod /dock_gnina returned HTTP {e.code} {e.reason}: {body_excerpt}"
        ) from e
    except urllib.error.URLError as e:
        raise GninaDockError(f"Pod GNINA URL error: {e.reason}") from e
    except Exception as e:
        raise GninaDockError(f"Pod GNINA dispatch failed: {e}") from e
