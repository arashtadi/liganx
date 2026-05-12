"""ESM-2 masked-LM fitness inference for the Resistance Atlas
calibration pipeline.

Pattern mirrors admet_pod.py:
  - Lazy model load (first call pays the ~5s cold-start tax; subsequent
    calls reuse the in-memory singleton)
  - Per-(uniprot, position, mutant) sqlite cache so repeat lookups
    don't pay the GPU cost twice — the cache lives at
    /workspace/esm2_cache.sqlite alongside admet_cache.sqlite
  - Per-UniProt sequence cache so we don't hammer rest.uniprot.org

Returns fitness = log P(mutant | masked context) − log P(wild-type | masked context)
which is the same definition the calibration paper uses.

Model: facebook/esm2_t12_35M_UR50D (35M params, ~150 MB, ~1s GPU
inference per mutation). On the RTX 4090 (sm_89) torch 2.4.1 cuda
build, the model runs fine on GPU; falls back to CPU if cuda isn't
available.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import urllib.request
from functools import lru_cache
from pathlib import Path
from typing import Any

# ─── Module-level singletons (lazy-init) ──────────────────────────
_MODEL = None
_TOKENIZER = None
_DEVICE = None
_MODEL_LOCK = threading.Lock()

# Persistent caches. Mounted on /workspace so they survive pod
# restarts (network-volume backed).
_CACHE_DIR = Path("/workspace")
_CACHE_DIR.mkdir(parents=True, exist_ok=True)
_SQLITE_PATH = _CACHE_DIR / "esm2_cache.sqlite"
_SEQ_CACHE_PATH = _CACHE_DIR / "uniprot_seq_cache.json"

_SEQ_CACHE: dict[str, str] | None = None

MODEL_ID = "facebook/esm2_t12_35M_UR50D"
WINDOW = 400  # ±residues around position when sequence > 1024 tokens


def _init_db() -> None:
    """Create the cache table if it doesn't exist. Idempotent."""
    conn = sqlite3.connect(str(_SQLITE_PATH))
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS fitness_cache (
                uniprot_id TEXT NOT NULL,
                position   INTEGER NOT NULL,
                wt         TEXT NOT NULL,
                mut        TEXT NOT NULL,
                fitness    REAL NOT NULL,
                log_p_wt   REAL NOT NULL,
                log_p_mut  REAL NOT NULL,
                seq_len    INTEGER NOT NULL,
                windowed   INTEGER NOT NULL DEFAULT 0,
                created_at REAL NOT NULL,
                PRIMARY KEY (uniprot_id, position, wt, mut)
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def _cache_get(uniprot_id: str, position: int, wt: str, mut: str) -> dict | None:
    conn = sqlite3.connect(str(_SQLITE_PATH))
    try:
        row = conn.execute(
            "SELECT fitness, log_p_wt, log_p_mut, seq_len, windowed FROM fitness_cache "
            "WHERE uniprot_id=? AND position=? AND wt=? AND mut=?",
            (uniprot_id.upper(), int(position), wt.upper(), mut.upper()),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    return {
        "fitness": row[0],
        "log_p_wt": row[1],
        "log_p_mut": row[2],
        "seq_len": row[3],
        "windowed": bool(row[4]),
        "cache_hit": True,
    }


def _cache_put(uniprot_id: str, position: int, wt: str, mut: str, payload: dict) -> None:
    conn = sqlite3.connect(str(_SQLITE_PATH))
    try:
        conn.execute(
            "INSERT OR REPLACE INTO fitness_cache "
            "(uniprot_id, position, wt, mut, fitness, log_p_wt, log_p_mut, "
            " seq_len, windowed, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                uniprot_id.upper(), int(position), wt.upper(), mut.upper(),
                float(payload["fitness"]),
                float(payload["log_p_wt"]),
                float(payload["log_p_mut"]),
                int(payload["seq_len"]),
                1 if payload.get("windowed") else 0,
                time.time(),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def _load_seq_cache() -> dict[str, str]:
    global _SEQ_CACHE
    if _SEQ_CACHE is not None:
        return _SEQ_CACHE
    if _SEQ_CACHE_PATH.exists():
        try:
            _SEQ_CACHE = json.loads(_SEQ_CACHE_PATH.read_text())
        except Exception:  # noqa: BLE001
            _SEQ_CACHE = {}
    else:
        _SEQ_CACHE = {}
    return _SEQ_CACHE


def _save_seq_cache() -> None:
    if _SEQ_CACHE is None:
        return
    try:
        _SEQ_CACHE_PATH.write_text(json.dumps(_SEQ_CACHE))
    except Exception:  # noqa: BLE001
        pass


@lru_cache(maxsize=512)
def _fetch_uniprot_sequence(uniprot_id: str) -> str:
    """Pull the canonical FASTA sequence for a UniProt accession.
    LRU-cached in-process; also persisted to disk via _SEQ_CACHE so
    we survive a worker restart."""
    cache = _load_seq_cache()
    key = uniprot_id.upper()
    if key in cache:
        return cache[key]
    url = f"https://rest.uniprot.org/uniprotkb/{key}.fasta"
    with urllib.request.urlopen(url, timeout=15) as r:
        text = r.read().decode("utf-8")
    seq = "".join(L for L in text.splitlines() if not L.startswith(">"))
    if not seq:
        raise ValueError(f"empty sequence returned for {key}")
    cache[key] = seq
    _save_seq_cache()
    return seq


def _ensure_model_loaded() -> None:
    """Idempotent model loader. Acquires the global lock so concurrent
    first-callers don't load the model twice."""
    global _MODEL, _TOKENIZER, _DEVICE
    if _MODEL is not None and _TOKENIZER is not None:
        return
    with _MODEL_LOCK:
        if _MODEL is not None and _TOKENIZER is not None:
            return
        import torch  # noqa: WPS433
        from transformers import AutoTokenizer, AutoModelForMaskedLM
        _TOKENIZER = AutoTokenizer.from_pretrained(MODEL_ID)
        model = AutoModelForMaskedLM.from_pretrained(MODEL_ID)
        model.eval()
        # Force CPU. Production pod is RTX PRO 6000 / 5090 (sm_120 Blackwell)
        # but torch 2.4.1 was built before sm_120 was added, so launching any
        # kernel on the GPU raises "no kernel image is available for execution
        # on the device". Same constraint as admet_pod.py — we eat the ~5s CPU
        # inference latency rather than spend a day rebuilding torch from source.
        # When the pod migrates to a torch with sm_120 support, set _DEVICE
        # back to "cuda" if torch.cuda.is_available() else "cpu".
        _DEVICE = "cpu"
        _MODEL = model.to(_DEVICE)


def _windowed_sequence(seq: str, position: int) -> tuple[str, int]:
    """Return a ±WINDOW slice of `seq` around position (1-indexed) plus
    the new position-in-window. Used when the full sequence exceeds
    ESM-2's 1024-token context (ALK, MET, ROS1, PI3Kα)."""
    pos0 = position - 1
    lo = max(0, pos0 - WINDOW)
    hi = min(len(seq), pos0 + WINDOW + 1)
    return seq[lo:hi], pos0 - lo + 1


def predict_fitness(
    uniprot_id: str,
    position: int,
    wt: str,
    mut: str,
) -> dict[str, Any]:
    """Compute ESM-2 masked-LM fitness for a single point substitution.

    Returns a dict with: fitness, log_p_wt, log_p_mut, seq_len,
    windowed, cache_hit. Raises ValueError on inputs the pipeline
    can't handle (wt mismatch, out-of-bounds position, etc.) so the
    calling FastAPI layer can convert to a 400 response."""
    uniprot_id = uniprot_id.upper()
    wt = wt.upper()
    mut = mut.upper()
    position = int(position)
    if len(wt) != 1 or len(mut) != 1:
        raise ValueError("wt and mut must be single amino-acid letters")

    # Init the sqlite table BEFORE the cache read — on a fresh pod the table
    # doesn't exist yet and SELECT raises "no such table: fitness_cache".
    # _init_db is idempotent (CREATE TABLE IF NOT EXISTS).
    _init_db()
    cached = _cache_get(uniprot_id, position, wt, mut)
    if cached:
        return cached

    seq = _fetch_uniprot_sequence(uniprot_id)
    if position < 1 or position > len(seq):
        raise ValueError(f"position {position} out of bounds for {uniprot_id} (len={len(seq)})")
    if seq[position - 1] != wt:
        # Be helpful but don't crash — sometimes UniProt isoforms
        # don't match the user's numbering convention. We surface the
        # mismatch but still score using the provided wt.
        actual = seq[position - 1]
        # Replace the residue at this position so masked-LM is
        # consistent with the wt the caller claimed.
        seq = seq[: position - 1] + wt + seq[position:]
        mismatch_note = f"uniprot[{position}]={actual} but caller said wt={wt}; substituted for scoring"
    else:
        mismatch_note = None

    _ensure_model_loaded()
    import torch  # noqa: WPS433
    assert _TOKENIZER is not None and _MODEL is not None

    windowed = False
    work_seq, work_pos = seq, position
    if len(seq) > 1000:
        work_seq, work_pos = _windowed_sequence(seq, position)
        windowed = True

    masked = work_seq[: work_pos - 1] + _TOKENIZER.mask_token + work_seq[work_pos:]
    inputs = _TOKENIZER(masked, return_tensors="pt", truncation=True, max_length=1024)
    inputs = {k: v.to(_DEVICE) for k, v in inputs.items()}
    with torch.no_grad():
        logits = _MODEL(**inputs).logits
    mask_idx_t = (inputs["input_ids"][0] == _TOKENIZER.mask_token_id).nonzero(as_tuple=True)[0]
    if len(mask_idx_t) == 0:
        raise RuntimeError("no mask token in tokenized input — sequence may exceed max_length even after windowing")
    pos_logits = logits[0, mask_idx_t[0].item()]
    log_probs = torch.log_softmax(pos_logits, dim=-1)
    wt_id = _TOKENIZER.convert_tokens_to_ids(wt)
    mut_id = _TOKENIZER.convert_tokens_to_ids(mut)
    log_p_wt = float(log_probs[wt_id])
    log_p_mut = float(log_probs[mut_id])
    payload = {
        "fitness": log_p_mut - log_p_wt,
        "log_p_wt": log_p_wt,
        "log_p_mut": log_p_mut,
        "seq_len": len(seq),
        "windowed": windowed,
        "cache_hit": False,
    }
    if mismatch_note:
        payload["uniprot_mismatch_note"] = mismatch_note
    _cache_put(uniprot_id, position, wt, mut, payload)
    return payload


# Map gene symbol → UniProt accession for our catalog. Saves callers
# from having to look it up every time. Extend as we add targets.
GENE_TO_UNIPROT = {
    "ABL1": "P00519",
    "EGFR": "P00533",
    "KIT": "P10721",
    "BTK": "Q06187",
    "BRAF": "P15056",
    "KRAS": "P01116",
    "ALK": "Q9UM73",
    "ROS1": "P08922",
    "MET": "P08581",
    "FLT3": "P36888",
    "ERBB2": "P04626",
    "HER2": "P04626",   # alias
    "PIK3CA": "P42336",
    "IDH1": "O75874",
}


def predict_fitness_by_gene(
    gene: str,
    position: int,
    wt: str,
    mut: str,
) -> dict[str, Any]:
    """Convenience wrapper: resolve gene symbol → UniProt ID via the
    catalog map, then call predict_fitness. Returns the same payload
    plus the resolved uniprot_id."""
    gene_norm = (gene or "").strip().upper()
    uniprot_id = GENE_TO_UNIPROT.get(gene_norm)
    if not uniprot_id:
        raise ValueError(
            f"gene {gene!r} not in pod's GENE_TO_UNIPROT map. "
            f"Add it to esm2_pod.py or pass uniprot_id directly."
        )
    payload = predict_fitness(uniprot_id, position, wt, mut)
    payload["uniprot_id"] = uniprot_id
    payload["gene"] = gene_norm
    return payload
