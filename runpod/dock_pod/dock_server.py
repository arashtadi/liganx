"""DeltaDock Pod-side docking service.

Single endpoint POST /dock that runs QuickVina2-GPU on the Pod's GPU and
returns the pose PDBQT + parsed mode table. Same payload contract as the
old serverless handler so the backend can swap between them with one URL
change.

Why a long-running service instead of serverless: the Pod is already
running 24/7. There's no cold-start, no per-second-billed worker churn,
and we get the GPU's ~30x speed-up over CPU QuickVina that the user's
old project was getting (7+ compounds/sec).

The QuickVina2-GPU binary needs to be invoked from its install directory
because --opencl_binary_path defaults to "." and the OpenCL kernels live
alongside the binary. We chdir before subprocess.run.
"""
from __future__ import annotations

import base64
import hmac
import logging
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("deltadock-pod")

VINA_DIR = Path("/workspace/Vina-GPU-2.1/QuickVina2-GPU-2.1")
VINA_BIN = VINA_DIR / "QuickVina2-GPU-2-1"
ENGINE_NAME = "QuickVina2-GPU-2.1"

# Vina prints a 9-row affinity table at the end of stdout; same shape as CPU Vina
_AFFINITY = re.compile(r"^\s*(\d+)\s+(-?\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s*$")

# ─────────────────────── shared-secret auth ───────────────────────
# The pod's proxy URL (https://<podid>-7861.proxy.runpod.net) is NOT a
# secret — it has appeared in git history and handoff docs, and RunPod's
# proxy does no auth of its own. Without a check here, anyone with the
# URL could spend this pod's GPU budget (or worse). So every request
# must carry an X-Pod-Secret header matching the POD_SHARED_SECRET env
# var.
#
# Fail-OPEN when POD_SHARED_SECRET is unset: this lets the new code be
# deployed to the pod BEFORE the secret is configured, so the rollout
# can't brick docking. Enforcement switches on the moment the env var is
# set (and the backend is sending a matching header). /health is always
# exempt so RunPod / monitoring liveness probes keep working.
_POD_SHARED_SECRET = os.environ.get("POD_SHARED_SECRET", "").strip()


async def require_pod_secret(request: Request) -> None:
    if request.url.path == "/health":
        return
    if not _POD_SHARED_SECRET:
        return
    supplied = request.headers.get("x-pod-secret", "")
    # Constant-time compare — never leak secret length/prefix via timing.
    if not hmac.compare_digest(supplied, _POD_SHARED_SECRET):
        raise HTTPException(status_code=401, detail="bad or missing X-Pod-Secret")


app = FastAPI(
    title="deltadock-pod-dock",
    version="0.1",
    dependencies=[Depends(require_pod_secret)],
)


class Box(BaseModel):
    center_x: float
    center_y: float
    center_z: float
    size_x: float
    size_y: float
    size_z: float


class DockRequest(BaseModel):
    receptor_pdbqt_b64: str
    ligand_pdbqt_b64: str
    box: Box
    exhaustiveness: int = 8   # mapped onto search_depth for GPU build
    num_modes: int = 9
    seed: int = 42
    thread: int = 8000        # GPU lanes; defaults to high parallelism for single-shot


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": VINA_BIN.exists(),
        "engine": ENGINE_NAME,
        "binary": str(VINA_BIN),
    }


@app.post("/dock")
def dock(req: DockRequest) -> dict[str, Any]:
    if not VINA_BIN.exists():
        raise HTTPException(500, f"binary missing at {VINA_BIN}")

    try:
        receptor_bytes = base64.b64decode(req.receptor_pdbqt_b64)
        ligand_bytes = base64.b64decode(req.ligand_pdbqt_b64)
    except Exception as e:
        raise HTTPException(400, f"base64 decode failed: {e}")

    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        receptor = work / "receptor.pdbqt"
        ligand = work / "ligand.pdbqt"
        pose = work / "pose.pdbqt"
        receptor.write_bytes(receptor_bytes)
        ligand.write_bytes(ligand_bytes)

        cmd = [
            str(VINA_BIN),
            "--receptor", str(receptor),
            "--ligand", str(ligand),
            "--center_x", str(req.box.center_x),
            "--center_y", str(req.box.center_y),
            "--center_z", str(req.box.center_z),
            "--size_x", str(req.box.size_x),
            "--size_y", str(req.box.size_y),
            "--size_z", str(req.box.size_z),
            "--out", str(pose),
            "--seed", str(req.seed),
            "--num_modes", str(req.num_modes),
            "--thread", str(req.thread),
        ]
        log.info("dispatching: %s", " ".join(cmd[:4]) + " ...")
        try:
            res = subprocess.run(
                cmd, cwd=str(VINA_DIR), capture_output=True, text=True, timeout=180
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(504, "QuickVina2-GPU exceeded 180s")

        if res.returncode != 0:
            tail = (res.stderr or res.stdout or "").strip()[-600:]
            raise HTTPException(500, f"vina-gpu rc={res.returncode}: {tail}")

        modes = []
        for line in res.stdout.splitlines():
            m = _AFFINITY.match(line)
            if m:
                modes.append({
                    "rank": int(m.group(1)),
                    "affinity_kcal_mol": float(m.group(2)),
                    "rmsd_lb": float(m.group(3)),
                    "rmsd_ub": float(m.group(4)),
                })

        if not modes:
            raise HTTPException(500, f"no modes parsed; log tail: {res.stdout[-400:]}")
        if not pose.exists() or pose.stat().st_size == 0:
            raise HTTPException(500, "no pose file written")

        return {
            "pose_pdbqt_b64": base64.b64encode(pose.read_bytes()).decode("ascii"),
            "modes": modes,
            "log": res.stdout[-4000:],
            "engine": ENGINE_NAME
        }


# ------------------------------------------------------------------------
# Batched docking -- one HTTP call, one GPU init, N ligands.
#
# QuickVina2-GPU exposes --ligand_directory + --output_directory which
# loads the receptor once and processes every PDBQT in the directory in
# a single GPU session. That's the actual throughput multiplier vs. our
# old "one HTTP call per ligand" loop, which paid the GPU init + receptor
# load cost on every cell.
#
# Caller is expected to group same-receptor cells (one receptor + N
# ligands per request). The caller-supplied `id` is used as the filename
# stem in the scratch dir, so we sanitize it to a safe path component.
# ------------------------------------------------------------------------

import re as _re_batch
_ID_RE = _re_batch.compile(r"[^A-Za-z0-9_.-]")


def _safe_id(s: str) -> str:
    """Cap caller IDs to a safe 64-char filename stem.

    We pass these straight to QuickVina-GPU as ligand_directory entries,
    so anything path-traversal-y (slashes, dots, null bytes) becomes "_".
    """
    s = _ID_RE.sub("_", s)
    return (s or "_")[:64]


class LigandIn(BaseModel):
    id: str          # caller's identifier (compound_id, variant tag, etc.)
    pdbqt_b64: str


class BatchDockRequest(BaseModel):
    receptor_pdbqt_b64: str
    box: Box
    ligands: list[LigandIn]
    exhaustiveness: int = 8
    num_modes: int = 9
    seed: int = 42
    thread: int = 8000


@app.post("/dock_batch")
def dock_batch(req: BatchDockRequest) -> dict:
    """Run N ligands against one receptor in a single QuickVina-GPU call.

    Response shape:
        {
          "results": [
            {"id": "...", "pose_pdbqt_b64": "...", "modes": [...]},
            {"id": "...", "error": "..."},
            ...
          ],
          "engine": "QuickVina2-GPU-2.1",
          "log": "...stdout tail...",
          "ligands_total": N,
          "ligands_succeeded": M
        }

    Per-ligand failures don't fail the whole batch -- they come back with
    `{"id": ..., "error": "..."}` and the caller decides whether to retry.
    """
    if not req.ligands:
        raise HTTPException(400, "no ligands provided")
    if len(req.ligands) > 200:
        raise HTTPException(400, "max 200 ligands per batch")
    try:
        receptor_bytes = base64.b64decode(req.receptor_pdbqt_b64)
    except Exception as e:
        raise HTTPException(400, f"receptor base64 decode failed: {e}")

    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        receptor = work / "receptor.pdbqt"
        receptor.write_bytes(receptor_bytes)
        in_dir = work / "in"
        out_dir = work / "out"
        in_dir.mkdir()
        out_dir.mkdir()

        # Map sanitized stem ? caller's original id so we can return
        # results keyed by what the caller sent, even if sanitization
        # rewrote characters or de-duplicated collisions.
        id_map: dict[str, str] = {}
        for lig in req.ligands:
            safe = _safe_id(lig.id)
            base_safe = safe
            n = 1
            while safe in id_map:
                safe = f"{base_safe}_{n}"
                n += 1
            id_map[safe] = lig.id
            try:
                (in_dir / f"{safe}.pdbqt").write_bytes(base64.b64decode(lig.pdbqt_b64))
            except Exception as e:
                raise HTTPException(400, f"ligand {lig.id!r} base64 decode failed: {e}")

        cmd = [
            str(VINA_BIN),
            "--receptor", str(receptor),
            "--ligand_directory", str(in_dir),
            "--output_directory", str(out_dir),
            "--center_x", str(req.box.center_x),
            "--center_y", str(req.box.center_y),
            "--center_z", str(req.box.center_z),
            "--size_x", str(req.box.size_x),
            "--size_y", str(req.box.size_y),
            "--size_z", str(req.box.size_z),
            "--seed", str(req.seed),
            "--num_modes", str(req.num_modes),
            "--thread", str(req.thread),
            "--opencl_binary_path", str(VINA_DIR),
        ]
        log.info("batch dispatch: %d ligands | %s ...", len(req.ligands), " ".join(cmd[:6]))

        # QuickVina-GPU does ~3-4s per ligand once the GPU is warm; the
        # first ligand pays the OpenCL init cost (~5-10s). Add headroom
        # for slow batches and prep variance.
        timeout = max(300, 30 + 6 * len(req.ligands))
        try:
            res = subprocess.run(
                cmd, cwd=str(VINA_DIR), capture_output=True, text=True, timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(504, f"QuickVina2-GPU batch exceeded {timeout}s")

        if res.returncode != 0:
            tail = (res.stderr or res.stdout or "").strip()[-600:]
            raise HTTPException(500, f"vina-gpu batch rc={res.returncode}: {tail}")

        # QuickVina-GPU writes one output PDBQT per input. The output
        # naming convention varies by version: some emit `{stem}_out.pdbqt`,
        # others preserve `{stem}.pdbqt` in the output dir. Try both.
        results: list[dict] = []
        for safe, orig_id in id_map.items():
            candidates = [
                out_dir / f"{safe}_out.pdbqt",
                out_dir / f"{safe}.pdbqt",
            ]
            pose_path = next((p for p in candidates if p.exists() and p.stat().st_size > 0), None)
            if pose_path is None:
                results.append({"id": orig_id, "error": "no pose written"})
                continue

            # Parse modes from the pose file's own REMARK VINA RESULT
            # lines, NOT from stdout (stdout interleaves all ligands and
            # is hard to reattribute reliably).
            try:
                pose_text = pose_path.read_text()
            except Exception as e:
                results.append({"id": orig_id, "error": f"read pose: {e}"})
                continue
            modes: list[dict] = []
            for line in pose_text.splitlines():
                if line.startswith("REMARK VINA RESULT"):
                    parts = line.split()
                    if len(parts) >= 6:
                        try:
                            modes.append({
                                "rank": len(modes) + 1,
                                "affinity_kcal_mol": float(parts[3]),
                                "rmsd_lb": float(parts[4]),
                                "rmsd_ub": float(parts[5]),
                            })
                        except ValueError:
                            pass
            if not modes:
                results.append({
                    "id": orig_id,
                    "error": "no modes parsed",
                    "raw_excerpt": pose_text[:200],
                })
                continue
            results.append({
                "id": orig_id,
                "pose_pdbqt_b64": base64.b64encode(pose_path.read_bytes()).decode("ascii"),
                "modes": modes,
            })

        return {
            "results": results,
            "engine": ENGINE_NAME,
            "log": res.stdout[-2000:],
            "ligands_total": len(req.ligands),
            "ligands_succeeded": sum(1 for r in results if "error" not in r),
        }


# ── GNINA endpoints (Vina fork with CNN rescoring) ──────────────────────
#
# GNINA is a Vina derivative (Koes lab, Pittsburgh) that adds a CNN-based
# pose-rescoring head trained on PDBbind. It accepts the same PDBQT
# receptor + PDBQT ligand + box inputs as Vina, runs on the same NVIDIA
# GPU, and returns both a Vina-style affinity (kcal/mol) AND a 0-1 CNN
# confidence score.
#
# These endpoints sit alongside the existing /dock and /dock_batch
# QuickVina2-GPU routes — same input shapes, different binary, different
# scoring head. The runner picks one or the other based on the user's
# engine choice on NewJobPage.
#
# Why same-shape inputs/outputs: keeps the runner.py dispatch logic
# trivial (just swap the URL path) and lets us run engine A/B tests
# without any data-model changes.

import shutil as _shutil_gnina

GNINA_BIN = _shutil_gnina.which("gnina") or "/usr/local/bin/gnina"


class GninaDockRequest(BaseModel):
    receptor_pdbqt_b64: str
    ligand_pdbqt_b64: str
    box: Box
    exhaustiveness: int = 8
    num_modes: int = 9
    seed: int = 42
    # CNN scoring mode. "rescore" runs Vina docking then CNN-rescores
    # the top poses (fast, ~2x QuickVina time). "refine" also re-docks
    # using CNN gradients (slower, more accurate). Default to rescore
    # since users will typically be doing matrix screens where speed
    # matters more than the marginal pose-refinement gain.
    cnn_mode: str = "rescore"   # one of: "rescore", "refine", "none"


@app.post("/dock_gnina")
def dock_gnina(req: GninaDockRequest) -> dict:
    """Single-ligand docking via GNINA.

    Response shape mirrors /dock (the QuickVina2-GPU endpoint) so the
    runner dispatch is symmetric:

        {
          "pose_pdbqt_b64": "...",
          "modes": [
            {"rank": 1, "affinity_kcal_mol": -8.4, "cnn_score": 0.71, "cnn_affinity": -7.9},
            ...
          ],
          "engine": "GNINA-1.3",
          "log": "...stdout tail..."
        }

    The CNN columns (cnn_score, cnn_affinity) are unique to GNINA and
    are what the user is paying for compared to vanilla Vina — they're
    the trained-on-PDBbind ranking signal.
    """
    try:
        receptor_bytes = base64.b64decode(req.receptor_pdbqt_b64)
        ligand_bytes = base64.b64decode(req.ligand_pdbqt_b64)
    except Exception as e:
        raise HTTPException(400, f"base64 decode failed: {e}")

    if req.cnn_mode not in {"rescore", "refine", "none"}:
        raise HTTPException(400, f"cnn_mode must be rescore|refine|none, got {req.cnn_mode!r}")

    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        receptor = work / "receptor.pdbqt"
        ligand = work / "ligand.pdbqt"
        out_pose = work / "pose.pdbqt"
        receptor.write_bytes(receptor_bytes)
        ligand.write_bytes(ligand_bytes)

        cmd = [
            GNINA_BIN,
            "--receptor", str(receptor),
            "--ligand", str(ligand),
            "--out", str(out_pose),
            "--center_x", str(req.box.center_x),
            "--center_y", str(req.box.center_y),
            "--center_z", str(req.box.center_z),
            "--size_x", str(req.box.size_x),
            "--size_y", str(req.box.size_y),
            "--size_z", str(req.box.size_z),
            "--seed", str(req.seed),
            "--num_modes", str(req.num_modes),
            "--exhaustiveness", str(req.exhaustiveness),
            "--cnn_scoring", req.cnn_mode,
        ]
        log.info("gnina dispatch: %s ...", " ".join(cmd[:8]))

        # GNINA on a 4090 takes ~10-30s per ligand for cnn=rescore,
        # 30-90s for cnn=refine. Wallclock budget similar to Vina with
        # a generous ceiling.
        timeout = 180 if req.cnn_mode == "refine" else 90
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise HTTPException(504, f"gnina exceeded {timeout}s")

        if res.returncode != 0:
            tail = (res.stderr or res.stdout or "").strip()[-600:]
            raise HTTPException(500, f"gnina rc={res.returncode}: {tail}")

        if not out_pose.exists() or out_pose.stat().st_size == 0:
            raise HTTPException(500, "gnina wrote no pose file")

        # GNINA writes its REMARK lines slightly differently from Vina:
        #   REMARK minimizedAffinity -8.42
        #   REMARK CNNscore 0.7128
        #   REMARK CNNaffinity 7.9123
        # We parse all three so the runner can record them. CNNscore is
        # the headline 0-1 confidence; CNNaffinity is the CNN's pK_d
        # estimate (positive = stronger binder, opposite sign from Vina).
        pose_text = out_pose.read_text()
        modes: list[dict] = []
        current: dict = {}
        for line in pose_text.splitlines():
            if line.startswith("MODEL "):
                current = {"rank": len(modes) + 1}
            elif line.startswith("REMARK minimizedAffinity"):
                try:
                    current["affinity_kcal_mol"] = float(line.split()[-1])
                except (ValueError, IndexError):
                    pass
            elif line.startswith("REMARK CNNscore"):
                try:
                    current["cnn_score"] = float(line.split()[-1])
                except (ValueError, IndexError):
                    pass
            elif line.startswith("REMARK CNNaffinity"):
                try:
                    current["cnn_affinity"] = float(line.split()[-1])
                except (ValueError, IndexError):
                    pass
            elif line.startswith("ENDMDL"):
                if "affinity_kcal_mol" in current:
                    modes.append(current)
                current = {}
        # Some GNINA builds emit a single pose without MODEL/ENDMDL framing —
        # handle that by treating any leftover `current` as the only mode.
        if current and "affinity_kcal_mol" in current and not modes:
            current["rank"] = 1
            modes.append(current)

        if not modes:
            raise HTTPException(500, "gnina produced no parseable modes")

        return {
            "pose_pdbqt_b64": base64.b64encode(out_pose.read_bytes()).decode("ascii"),
            "modes": modes,
            "engine": "GNINA-1.3",
            "log": (res.stdout or "")[-1000:],
        }


class GninaBatchRequest(BaseModel):
    receptor_pdbqt_b64: str
    box: Box
    ligands: list[LigandIn]
    exhaustiveness: int = 8
    num_modes: int = 9
    seed: int = 42
    cnn_mode: str = "rescore"


@app.post("/dock_batch_gnina")
def dock_batch_gnina(req: GninaBatchRequest) -> dict:
    """Batched GNINA — N ligands against one receptor.

    GNINA doesn't have a native ligand-directory mode like QuickVina2-GPU,
    so this is sequential per-ligand under the hood. The win compared to
    N separate /dock_gnina calls is purely network — one HTTP round-trip,
    one receptor decode. The GPU still sees one ligand at a time.
    """
    if not req.ligands:
        raise HTTPException(400, "no ligands provided")
    if len(req.ligands) > 50:
        # Lower cap than QuickVina batch (200) because GNINA is sequential
        # internally — we don't want a single batch to monopolise the GPU
        # for >20 minutes.
        raise HTTPException(400, "max 50 ligands per gnina batch")
    if req.cnn_mode not in {"rescore", "refine", "none"}:
        raise HTTPException(400, f"cnn_mode must be rescore|refine|none, got {req.cnn_mode!r}")

    try:
        receptor_bytes = base64.b64decode(req.receptor_pdbqt_b64)
    except Exception as e:
        raise HTTPException(400, f"receptor base64 decode failed: {e}")

    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        receptor = work / "receptor.pdbqt"
        receptor.write_bytes(receptor_bytes)
        results: list[dict] = []

        per_ligand_timeout = 120 if req.cnn_mode == "refine" else 60

        for lig in req.ligands:
            try:
                ligand_bytes = base64.b64decode(lig.pdbqt_b64)
            except Exception as e:
                results.append({"id": lig.id, "error": f"base64 decode: {e}"})
                continue

            safe = _safe_id(lig.id)
            ligand = work / f"{safe}.pdbqt"
            out_pose = work / f"{safe}_out.pdbqt"
            ligand.write_bytes(ligand_bytes)

            cmd = [
                GNINA_BIN,
                "--receptor", str(receptor),
                "--ligand", str(ligand),
                "--out", str(out_pose),
                "--center_x", str(req.box.center_x),
                "--center_y", str(req.box.center_y),
                "--center_z", str(req.box.center_z),
                "--size_x", str(req.box.size_x),
                "--size_y", str(req.box.size_y),
                "--size_z", str(req.box.size_z),
                "--seed", str(req.seed),
                "--num_modes", str(req.num_modes),
                "--exhaustiveness", str(req.exhaustiveness),
                "--cnn_scoring", req.cnn_mode,
            ]

            try:
                res = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=per_ligand_timeout,
                )
            except subprocess.TimeoutExpired:
                results.append({"id": lig.id, "error": f"timeout after {per_ligand_timeout}s"})
                continue

            if res.returncode != 0:
                tail = (res.stderr or res.stdout or "").strip()[-300:]
                results.append({"id": lig.id, "error": f"rc={res.returncode}: {tail}"})
                continue
            if not out_pose.exists() or out_pose.stat().st_size == 0:
                results.append({"id": lig.id, "error": "no pose file"})
                continue

            # Same parser as the single endpoint — duplicated rather than
            # factored out because the patch file is appended verbatim
            # and we don't want to assume helper functions exist in the
            # parent dock_server.py's scope.
            pose_text = out_pose.read_text()
            modes: list[dict] = []
            current: dict = {}
            for line in pose_text.splitlines():
                if line.startswith("MODEL "):
                    current = {"rank": len(modes) + 1}
                elif line.startswith("REMARK minimizedAffinity"):
                    try: current["affinity_kcal_mol"] = float(line.split()[-1])
                    except (ValueError, IndexError): pass
                elif line.startswith("REMARK CNNscore"):
                    try: current["cnn_score"] = float(line.split()[-1])
                    except (ValueError, IndexError): pass
                elif line.startswith("REMARK CNNaffinity"):
                    try: current["cnn_affinity"] = float(line.split()[-1])
                    except (ValueError, IndexError): pass
                elif line.startswith("ENDMDL"):
                    if "affinity_kcal_mol" in current: modes.append(current)
                    current = {}
            if current and "affinity_kcal_mol" in current and not modes:
                current["rank"] = 1
                modes.append(current)

            if not modes:
                results.append({"id": lig.id, "error": "no modes parsed"})
                continue
            results.append({
                "id": lig.id,
                "pose_pdbqt_b64": base64.b64encode(out_pose.read_bytes()).decode("ascii"),
                "modes": modes,
            })

        return {
            "results": results,
            "engine": "GNINA-1.3",
            "ligands_total": len(req.ligands),
            "ligands_succeeded": sum(1 for r in results if "pose_pdbqt_b64" in r),
        }


# ---------------------------------------------------------------
# admet-ai endpoint (added 2026-05-08)
#
# Lazy-loads on first call so the dock_server boots fast and the
# admet-ai PyTorch import only happens if someone actually calls
# /admet/predict. CPU inference (sm_120 not supported by torch 2.4.1).
# Per-SMILES sqlite cache lives at /workspace/admet_cache.sqlite.
# ---------------------------------------------------------------
class _AdmetReq(BaseModel):
    smiles: str


@app.post("/admet/predict")
def admet_predict(req: _AdmetReq) -> dict[str, Any]:
    try:
        # Imported lazily so a broken admet_pod install can't take
        # down the dock_server boot. Errors here surface as 500 only
        # when someone actually calls /admet/predict.
        from admet_pod import predict_smiles  # type: ignore
        return predict_smiles(req.smiles)
    except Exception as e:  # noqa: BLE001
        log.exception("admet_predict failed for smiles=%r", req.smiles)
        raise HTTPException(status_code=500, detail=f"admet predict failed: {e}")


# ────────────────────────────────────────────────────────────────────
# /esm2/fitness — ESM-2 masked-LM fitness for (uniprot, position, wt,
# mut) or (gene, position, wt, mut). Powers the public /calibrate/score
# free-tier endpoint on the Liganx backend. Same lazy-load + sqlite
# cache pattern as /admet/predict. Cache lives at
# /workspace/esm2_cache.sqlite and survives pod restarts.
# ────────────────────────────────────────────────────────────────────
class _Esm2Req(BaseModel):
    gene: str | None = None
    uniprot_id: str | None = None
    position: int
    wt: str
    mut: str


@app.post("/esm2/fitness")
def esm2_fitness(req: _Esm2Req) -> dict[str, Any]:
    if not (req.gene or req.uniprot_id):
        raise HTTPException(status_code=400, detail="provide gene or uniprot_id")
    try:
        from esm2_pod import predict_fitness, predict_fitness_by_gene  # type: ignore
        if req.uniprot_id:
            payload = predict_fitness(
                req.uniprot_id, req.position, req.wt, req.mut,
            )
            payload["uniprot_id"] = req.uniprot_id.upper()
        else:
            payload = predict_fitness_by_gene(
                req.gene or "", req.position, req.wt, req.mut,
            )
        return payload
    except ValueError as e:
        # Input-level error (bad gene, out-of-bounds position, etc.) —
        # return 400 so the backend doesn't retry it as a transient
        # failure.
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        log.exception("esm2_fitness failed for %r", req.dict())
        raise HTTPException(status_code=500, detail=f"esm2 inference failed: {e}")


# ═══════════════════════════════════════════════════════════════════════
# Ensemble relaxation endpoint  (appended to dock_server.py — NOT a
# standalone module; it references the `app` defined above).
#
# Why appended rather than spliced in: the live pod's dock_server.py has
# drifted from the repo copy (hand-edits over time), so a pure append is
# the zero-risk way to add a route — it defines new symbols on the
# existing `app` and touches no existing code.
#
# Deploy: curl this fragment onto the pod and `cat >>` it onto
# /workspace/dock_server.py, then restart uvicorn. See ensemble_pod.py
# for the actual restrained-MD logic.
# ═══════════════════════════════════════════════════════════════════════
from pydantic import BaseModel as _EnsBaseModel  # noqa: E402
import ensemble_pod as _ensemble_pod  # noqa: E402


class RelaxEnsembleRequest(_EnsBaseModel):
    """Request body for /relax_ensemble."""
    receptor_pdb: str                 # cleaned receptor PDB text (heavy atoms)
    box_center: list[float]           # [x, y, z] docking-box centre, PDB Å
    n_relaxed: int = 4
    md_ps: float = 250.0
    equil_ps: float = 20.0
    pocket_radius: float = 12.0


@app.post("/relax_ensemble")
def relax_ensemble_endpoint(req: RelaxEnsembleRequest):
    """Generate a receptor conformer ensemble via short restrained GPU MD.

    Returns ``[input_pdb] + N`` MD-relaxed receptor conformer PDB strings.
    Element 0 is always the un-relaxed input, so ensemble docking can
    never score worse than standard single-conformation docking.

    Fail-soft on two levels: ensemble_pod.relax_ensemble never raises
    (returns ``[receptor_pdb]`` on any error), and the try/except here is
    a belt-and-suspenders guard so the endpoint never 500s the backend —
    the caller transparently falls back to single-conformation docking.
    """
    try:
        confs = _ensemble_pod.relax_ensemble(
            req.receptor_pdb,
            tuple(req.box_center),
            n_relaxed=req.n_relaxed,
            md_ps=req.md_ps,
            equil_ps=req.equil_ps,
            pocket_radius=req.pocket_radius,
        )
        return {"ok": True, "n": len(confs), "conformers": confs}
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "error": f"{type(e).__name__}: {e}",
            "n": 1,
            "conformers": [req.receptor_pdb],
        }


# ═══════════════════════════════════════════════════════════════════════
# Feature: MM-GBSA rescoring (Phase A of the FEP+ programme)
#
# Single-snapshot one-trajectory MM-GBSA on a docked complex — implicit-
# solvent (OBC2) Amber14SB + OpenFF Sage 2.2 energy decomposition.
# ΔG_bind = E_complex − E_protein − E_ligand on the minimised geometry.
# Optional second-pass rescoring layer above Vina; not auto-triggered.
#
# See runpod/dock_pod/mmgbsa_pod.py for the protocol, force-field
# choices, and the "what this is NOT" caveats.
#
# Deploy: same as the ensemble route — append to /workspace/dock_server.py
# on the pod, restart uvicorn. Requires openff-toolkit +
# openmmforcefields installed on the pod:
#
#     pip install --no-cache-dir 'openff-toolkit==0.16.*' \
#         'openmmforcefields==0.14.*' 'openff-interchange==0.4.*'
#
# If those are missing the route returns ok=False with a clear error
# message; the backend surfaces this as a 503 to the caller, so we can
# ship the route BEFORE the pod has the deps and turn it on by pip-
# installing in place.
# ═══════════════════════════════════════════════════════════════════════
import mmgbsa_pod as _mmgbsa_pod  # noqa: E402


class MmgbsaRescoreRequest(_EnsBaseModel):
    """Request body for /mmgbsa/rescore.

    Inputs are TEXT (PDB and SDF) so the HTTP boundary is human-readable
    and the pod doesn't have to know about base64 here (unlike the
    docking endpoints, which take PDBQT-base64 because Vina-toolchain).
    """
    receptor_pdb: str                 # cleaned receptor PDB text
    ligand_sdf: str                   # docked-pose ligand SDF (3D coords)
    max_minimization_steps: int = 500
    force_tolerance_kj_mol_nm: float = 10.0


@app.post("/mmgbsa/rescore")
def mmgbsa_rescore_endpoint(req: MmgbsaRescoreRequest):
    """Rescore a docked pose with single-snapshot one-trajectory MM-GBSA.

    Returns ``{ok: True, dg_bind_kcal_mol, e_complex, e_protein, e_ligand,
    method, wall_seconds}`` on success, or ``{ok: False, error}`` on
    parameterisation / simulation / missing-deps failure.

    Never raises — failures are returned as structured JSON so the
    backend can surface a clean error to the user.
    """
    try:
        return _mmgbsa_pod.rescore_pose(
            req.receptor_pdb,
            req.ligand_sdf,
            max_minimization_steps=req.max_minimization_steps,
            force_tolerance_kj_mol_nm=req.force_tolerance_kj_mol_nm,
        )
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "error": f"{type(e).__name__}: {e}",
            "wall_seconds": 0.0,
        }


# ═══════════════════════════════════════════════════════════════════════
# Feature: FEP+ alchemical edge (Phase B of the FEP+ programme)
#
# One call = one relative-FEP edge A→B. Two-leg HREX alchemy in
# complex + solvent, MBAR analysis, forward/reverse hysteresis. The
# backend's fep_runner dispatches edges sequentially via this route.
#
# Cost: ~8-12 GPU-hours per edge on Blackwell sm_120 (60K-atom kinase
# complex). DEDICATED FEP POD recommended — see DEPLOY_FEP_POD.md.
# Running on the same pod that serves Vina cells will starve them
# because the alchemy holds GPU memory for the duration.
#
# Why this is a thin REVERSE-PROXY and not a direct call to fep_pod:
# the FEP scientific stack (openfe + openmmtools + pymbar + openff-
# toolkit) is conda-only. It lives in an isolated /workspace/miniconda3
# env served by fep_server.py on port 7862 — NOT the system Python that
# dock_server.py runs in. We forward the request to localhost:7862 so
# the HTTP boundary stays single-URL (POD_DOCK_URL/fep_edge) while
# python-environment separation is preserved. See fep_server.py for the
# conda-side endpoint.
# ═══════════════════════════════════════════════════════════════════════
import urllib.error as _fep_urlerr  # noqa: E402
import urllib.request as _fep_urlreq  # noqa: E402
import json as _fep_json  # noqa: E402

# Reachable via the pod's loopback only; fep_server doesn't expose 7862
# externally (RunPod's HTTPS proxy doesn't route it). System python →
# conda python over plain HTTP on the loopback is intentional.
_FEP_SERVER_URL = os.environ.get("FEP_SERVER_URL", "http://localhost:7862").rstrip("/")


class FepEdgeRequest(_EnsBaseModel):
    """Request body for /fep_edge.

    Inputs are TEXT (PDB + SDF) so the HTTP boundary is human-readable.
    All protocol knobs are optional; defaults match the post-audit
    consensus (12 windows × 7 ns/window with 2 ns equilibration).
    """
    receptor_pdb: str
    ligand_a_sdf: str
    ligand_b_sdf: str
    n_lambda_windows: int = 12
    ns_per_window: float = 7.0
    ns_equilibration: float = 2.0
    salt_conc_mol_per_l: float = 0.15
    temperature_k: float = 298.15
    hmr_mass_amu: float = 3.0
    timestep_fs: float = 4.0


@app.post("/fep_edge")
def fep_edge_endpoint(req: FepEdgeRequest):
    """Reverse-proxy to fep_server (conda env, localhost:7862). The FEP
    deps are heavy and conda-only, so the actual alchemy runs in a
    separate python env on a separate port; dock_server is just a thin
    HTTP forwarder so the backend keeps a single URL (POD_DOCK_URL).

    Returns ``{ok: True, ddg_binding_kcal_mol, ddg_uncertainty,
    hysteresis_kcal_mol, convergence_flag, mbar_diagnostics_json,
    method, wall_seconds}`` on success, or ``{ok: False, error, kind}``
    on transport / parameterisation / runtime failure.

    HTTP timeout caveat: backend should set client timeout ≥ 13 hours.
    Cloudflare/RunPod proxies have 100s/10h idle ceilings — for long
    edges, switch to async pod-side worker + result-polling (Phase B.1).
    """
    body = _fep_json.dumps(req.model_dump()).encode("utf-8")
    request = _fep_urlreq.Request(
        f"{_FEP_SERVER_URL}/fep_edge",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        # 13 h ceiling matches the worst-case edge wall time. Loopback
        # so there's no proxy-layer timeout in between.
        with _fep_urlreq.urlopen(request, timeout=13 * 3600) as resp:
            return _fep_json.loads(resp.read().decode("utf-8"))
    except _fep_urlerr.HTTPError as e:
        return {
            "ok": False,
            "error": f"fep_server HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}",
            "kind": "transport",
            "wall_seconds": 0.0,
        }
    except _fep_urlerr.URLError as e:
        return {
            "ok": False,
            "error": f"fep_server unreachable at {_FEP_SERVER_URL}: {e.reason}",
            "kind": "transport",
            "wall_seconds": 0.0,
        }
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "error": f"{type(e).__name__}: {e}",
            "kind": "runtime",
            "wall_seconds": 0.0,
        }
