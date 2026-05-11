"""admet-ai wrapper for the Liganx dock pod.

Why a separate module: admet-ai pulls in PyTorch + Lightning, both of
which check GPU capabilities at import time. On the current production
GPU (RTX 4090, sm_89) torch 2.4.1+cu124 supports CUDA, but we force
admet-ai onto CPU because the lazy-init + model size combo doesn't
benefit from GPU in practice (Chemprop ensembles are tiny). On the
previous Blackwell pod (sm_120) torch couldn't use CUDA at all and CPU
was mandatory; the same code works in both cases.

Critical fix (2026-05-11): we DO NOT set
`os.environ["CUDA_VISIBLE_DEVICES"] = ""` at module top-level. That
poisons the uvicorn process's environment, and every subsequent
subprocess.Popen call (including dock_server's vina-gpu invocation)
inherits the empty value -> Err-1001:CL_PLATFORM_NOT_FOUND_KHR rc=255.
Instead, we scope the env override to JUST the admet-ai import + model
load inside `_get_model()`, then restore the previous value. admet-ai's
torch CUDA detection is one-shot at import, so the CPU-only selection
persists in-process even after we restore the env, but new subprocesses
see the GPU normally.

Import this module from dock_server.py and call predict_smiles(s).
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
import warnings
from typing import Any

warnings.filterwarnings("ignore")

log = logging.getLogger("deltadock-pod-admet")

_DB_PATH = "/workspace/admet_cache.sqlite"
_MODEL = None
_MODEL_LOCK = threading.Lock()


def _ensure_db() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, isolation_level=None, check_same_thread=False)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS admet_cache "
        "(smiles TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at REAL NOT NULL)"
    )
    return conn


_DB = _ensure_db()
_DB_LOCK = threading.Lock()


def _canonical(smiles: str) -> str:
    """RDKit-canonicalize for stable cache keys. Falls back to the raw
    string if RDKit can't parse it — caller will get fresh predictions
    for every typo, which is fine."""
    try:
        from rdkit import Chem  # type: ignore
        m = Chem.MolFromSmiles(smiles)
        if m is None:
            return smiles
        return Chem.MolToSmiles(m, canonical=True)
    except Exception:
        return smiles


def _get_model():
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    with _MODEL_LOCK:
        if _MODEL is not None:
            return _MODEL
        log.info("admet_pod: loading ADMETModel (first call, ~5-10 s)")
        t0 = time.time()
        # Scope CUDA_VISIBLE_DEVICES="" to JUST the admet-ai import +
        # model load. Restoring the original value afterwards is
        # critical — every subprocess.Popen call from this process
        # (e.g. dock_server's vina-gpu invocation) inherits os.environ,
        # and a permanently-empty CUDA_VISIBLE_DEVICES makes the GPU
        # invisible to vina-gpu (CL_PLATFORM_NOT_FOUND_KHR rc=255).
        # admet-ai's torch import is one-shot, so the CPU-only
        # selection persists in-process even after we restore the env.
        prev = os.environ.get("CUDA_VISIBLE_DEVICES")
        os.environ["CUDA_VISIBLE_DEVICES"] = ""
        try:
            from admet_ai import ADMETModel  # type: ignore
            _MODEL = ADMETModel()
        finally:
            if prev is None:
                os.environ.pop("CUDA_VISIBLE_DEVICES", None)
            else:
                os.environ["CUDA_VISIBLE_DEVICES"] = prev
        log.info("admet_pod: model loaded in %.1fs", time.time() - t0)
    return _MODEL


def predict_smiles(smiles: str) -> dict[str, Any]:
    """Predict ADMET properties for one SMILES. Returns the full admet-ai
    output dict (~100 keys: hERG, DILI, BBB_Martins, CYP*_Veith, ...).
    Cached on canonical SMILES — same input → same output forever.
    """
    if not smiles or not isinstance(smiles, str):
        raise ValueError("smiles must be a non-empty string")
    canon = _canonical(smiles)
    with _DB_LOCK:
        row = _DB.execute(
            "SELECT payload FROM admet_cache WHERE smiles = ?", (canon,)
        ).fetchone()
    if row is not None:
        return {"smiles": canon, "cached": True, "properties": json.loads(row[0])}
    model = _get_model()
    t0 = time.time()
    df = model.predict(smiles=canon)
    elapsed = round(time.time() - t0, 2)
    # admet-ai returns dict for single SMILES, DataFrame for batch.
    if hasattr(df, "to_dict"):
        # DataFrame fallback (one-row)
        props = {k: float(v) if hasattr(v, "__float__") else v
                 for k, v in df.iloc[0].to_dict().items()}
    else:
        props = {k: float(v) if hasattr(v, "__float__") else v
                 for k, v in dict(df).items()}
    with _DB_LOCK:
        _DB.execute(
            "INSERT OR REPLACE INTO admet_cache (smiles, payload, created_at) VALUES (?, ?, ?)",
            (canon, json.dumps(props), time.time()),
        )
    return {"smiles": canon, "cached": False, "elapsed_s": elapsed, "properties": props}
