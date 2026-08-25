"""Boltz-2 client — RunPod GPU **serverless** endpoint.

The serverless sibling of `boltz2_dock.py` (which targets an always-on Pod
via an async /predict_boltz2_async + poll pattern). Same Boltz-2 engine, but
dispatched to a RunPod serverless endpoint (`runpod/boltz2_worker/handler.py`)
that scales to zero and cold-starts on demand — no idle GPU cost, and it draws
from RunPod's serverless pool instead of the on-demand pod pool.

Wire flow:
    runner._run_boltz2_dispatch  →  predict_one_boltz2_runpod()  →
        HTTPS POST /runsync  →  (poll /status on cold start)  →
        boltz2_worker (Docker, GPU)  →  Boltz-2  →
        predicted complex PDB + affinity heads  →  Boltz2Result

This mirrors `gnina_runpod.dock_one_gnina_runpod` (serverless invoke + poll)
and returns the SAME `Boltz2Result` as `boltz2_dock.predict_one_boltz2`, and
raises the SAME `Boltz2DockError`, so `runner._run_boltz2_dispatch` can call
either client behind one `predict_fn` and its `except Boltz2DockError` catches
both identically.

Worker wire contract (runpod/boltz2_worker/handler.py):
  input : { receptor_sequence, ligand_smiles, chain_id, pocket_residues,
            use_msa, num_samples }
  output: { predicted_pdb_b64, affinity_pred_value,
            affinity_probability_binary, engine="boltz2" }  (or { error })
"""

from __future__ import annotations

import base64
import json
import logging
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .boltz2_dock import Boltz2DockError, Boltz2Result

log = logging.getLogger(__name__)


@dataclass
class Boltz2RunpodConfig:
    """Endpoint + sampling knobs for a serverless Boltz-2 prediction.

    Defaults match the mutation-comparison use case: single-sequence mode
    (use_msa=False) so WT and mutant predictions don't diverge on MSA
    construction, and one sample (Boltz-2 is deterministic at temperature 0).
    timeout_s is generous because a cold worker cold-pulls the image (~5 min)
    and — only on a fresh volume — downloads ~5 GB of weights.
    """
    api_key: str
    endpoint_id: str
    use_msa: bool = False
    num_samples: int = 1
    timeout_s: int = 1200

    @property
    def runsync_url(self) -> str:
        return f"https://api.runpod.ai/v2/{self.endpoint_id}/runsync"

    def status_url(self, job_id: str) -> str:
        return f"https://api.runpod.ai/v2/{self.endpoint_id}/status/{job_id}"


def predict_one_boltz2_runpod(
    receptor_sequence: str,
    ligand_smiles: str,
    work_dir: Path | str,
    cfg: Boltz2RunpodConfig,
    *,
    pocket_residues: list[int] | None = None,
    chain_id: str = "A",
) -> Boltz2Result:
    """Single (sequence, SMILES) → Boltz-2 prediction on a RunPod serverless
    GPU worker. Returns a `Boltz2Result` shaped identically to
    `boltz2_dock.predict_one_boltz2`. Raises `Boltz2DockError` on any failure
    so the caller can degrade gracefully."""
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    if not receptor_sequence or not all(c.isalpha() for c in receptor_sequence):
        raise Boltz2DockError(
            f"Invalid receptor sequence (empty or non-alphabetic): "
            f"{receptor_sequence[:40]!r}..."
        )
    if not ligand_smiles or len(ligand_smiles) < 2:
        raise Boltz2DockError(f"Invalid ligand SMILES: {ligand_smiles!r}")

    payload = {
        "input": {
            "receptor_sequence": receptor_sequence,
            "ligand_smiles": ligand_smiles,
            "chain_id": chain_id,
            "pocket_residues": pocket_residues or [],
            "use_msa": cfg.use_msa,
            "num_samples": cfg.num_samples,
        }
    }
    headers = {
        "Authorization": f"Bearer {cfg.api_key}",
        "Content-Type": "application/json",
        # A real UA avoids RunPod's Cloudflare 1010 block on Python-urllib.
        "User-Agent": "liganx-backend/0.1 (+https://liganx.com)",
        "Accept": "application/json",
    }

    log.info(
        "Dispatching Boltz-2 to RunPod serverless endpoint %s "
        "(seq_len=%d, smiles_len=%d, pocket=%d)",
        cfg.endpoint_id, len(receptor_sequence), len(ligand_smiles),
        len(pocket_residues) if pocket_residues else 0,
    )

    # /runsync fast path; fall through to /status polling on cold start.
    response = _post_json(cfg.runsync_url, payload, headers, timeout_s=min(95, cfg.timeout_s))
    status = response.get("status")
    job_id = response.get("id")
    if status in ("IN_QUEUE", "IN_PROGRESS") and job_id:
        log.info("Boltz-2 /runsync returned %s; polling /status/%s (cold start)", status, job_id)
        response = _poll_until_done(cfg, job_id, cfg.timeout_s, headers)
        status = response.get("status")

    if status not in ("COMPLETED", "OK"):
        raise Boltz2DockError(f"RunPod Boltz-2 returned status={status!r}: {str(response)[:200]}")

    output = response.get("output") or {}
    if "error" in output:
        detail = output.get("stderr_tail") or output.get("stdout_tail") or ""
        raise Boltz2DockError(f"Boltz-2 worker error: {output['error']} {str(detail)[:200]}")

    pdb_b64 = output.get("predicted_pdb_b64")
    affinity_pred = output.get("affinity_pred_value")
    affinity_prob = output.get("affinity_probability_binary")
    if pdb_b64 is None or affinity_pred is None:
        raise Boltz2DockError(
            f"Malformed Boltz-2 response (missing pdb/affinity): {str(output)[:200]}"
        )

    # Write the predicted complex under a `boltz2/` subdir — identical path
    # convention to boltz2_dock.predict_one_boltz2 so downstream (alignment,
    # 3D viewer, split_complex_pdb) doesn't care which client produced it.
    pdb_path = work_dir / "boltz2" / "predicted_complex.pdb"
    pdb_path.parent.mkdir(parents=True, exist_ok=True)
    pdb_path.write_bytes(base64.b64decode(pdb_b64))

    return Boltz2Result(
        receptor_sequence=receptor_sequence,
        ligand_smiles=ligand_smiles,
        predicted_pdb=pdb_path,
        affinity_pred_value=float(affinity_pred),
        affinity_probability_binary=float(affinity_prob) if affinity_prob is not None else 0.0,
        raw=output,
    )


# ───────────────────────── helpers ─────────────────────────

def _poll_until_done(cfg: Boltz2RunpodConfig, job_id: str, timeout_s: int, headers: dict) -> dict:
    """Poll /status/{id} until terminal. Backs off 2s→10s. Raises
    Boltz2DockError on FAILED/CANCELLED/TIMED_OUT or overall timeout."""
    start = time.monotonic()
    interval = 2.0
    while True:
        if time.monotonic() - start >= timeout_s:
            raise Boltz2DockError(f"RunPod Boltz-2 job {job_id} did not finish within {timeout_s}s")
        try:
            req = urllib.request.Request(cfg.status_url(job_id), headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=15) as r:
                resp = json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as e:
            log.warning("Polling Boltz-2 /status/%s failed (%s); retrying", job_id, e)
            time.sleep(interval)
            interval = min(interval * 1.5, 10.0)
            continue
        status = resp.get("status")
        if status in ("COMPLETED", "OK"):
            return resp
        if status in ("FAILED", "CANCELLED", "TIMED_OUT"):
            raise Boltz2DockError(f"RunPod Boltz-2 job {job_id} ended status={status!r}: {str(resp)[:200]}")
        time.sleep(interval)
        interval = min(interval * 1.5, 10.0)


def _post_json(url: str, body: dict, headers: dict, timeout_s: int) -> dict:
    raw = json.dumps(body).encode("utf-8")
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
        raise Boltz2DockError(f"HTTP {e.code} from RunPod Boltz-2: {body_text}") from e
    except urllib.error.URLError as e:
        raise Boltz2DockError(f"Network error reaching RunPod Boltz-2: {e.reason}") from e
    except TimeoutError as e:
        raise Boltz2DockError(f"RunPod Boltz-2 call timed out after {timeout_s}s") from e
