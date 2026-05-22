"""Dock result cache (services/dock_cache.py).

A repeat dock of an *identical* molecule under *identical* conditions is served
instantly from the ``dock_cache`` table (the app DB) instead of re-running the
GPU on the pod.

Molecular identity = full canonical isomeric **InChIKey**. Identical molecules
(written any way) collapse to the same key; ANY structural change to the ligand
— one added atom, a changed bond, a flipped stereocenter — yields a different
InChIKey, hence a different cache key, hence a cache MISS and a fresh dock. Only
an untouched, identical compound is ever served from cache.

The cache key also folds in pdb_id / chain / variant / engine / engine_version /
exhaustiveness / box geometry / prep_version, so a different target, mutation,
engine, box, or prep pipeline can never collide with a stored result. Bump
``DOCK_CACHE_PREP_VERSION`` (or the engine version) to invalidate en masse.

Design rules (all load-bearing):
  * **Fail-open.** Every public function swallows exceptions and returns the
    "no cache" answer (None / no-op). A cache problem can NEVER break docking.
  * **Flag-gated.** When ``settings.dock_cache_enabled`` is False, ``lookup``
    always misses and ``store`` is a no-op — the feature is completely inert.
  * **App-DB only.** Nothing is ever written to the RunPod pod.
  * **Own session.** Cache reads/writes run in their own short-lived Session so
    they never commit or roll back the caller's (runner's) transaction.
"""
from __future__ import annotations

import hashlib
import logging
from typing import Any, Optional

from sqlalchemy import text
from sqlmodel import Session

from ..config import settings
from ..db import engine

log = logging.getLogger(__name__)

# Cache-key format version. Bump if the key construction below ever changes.
_KEY_FORMAT = "k1"


def canonical_inchikey(smiles: str) -> Optional[str]:
    """Canonical molecular-identity string for a SMILES, or None if RDKit can't
    parse it. Same molecule (written any way) -> same string; ANY structural
    change (one atom, a bond, a flipped stereocenter) -> a different string.

    Uses canonical *isomeric SMILES*, NOT an InChIKey: this codebase's RDKit
    build is standardized on MolToSmiles and InChI support is not guaranteed —
    MolToInchiKey was silently raising here, returning None, and leaving the
    cache empty (no rows ever stored). Canonical isomeric SMILES is an equally
    strict identity for cache-key purposes and is what the rest of the codebase
    relies on. (Function name kept for call-site stability; the returned value
    is the identity fingerprint, whatever its exact form.)"""
    if not smiles:
        return None
    try:
        from rdkit import Chem  # local import: rdkit is heavy
        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return None
        return Chem.MolToSmiles(mol, isomericSmiles=True, canonical=True) or None
    except Exception as e:  # noqa: BLE001
        log.info("dock_cache: canonical SMILES failed for %r: %s", (smiles or "")[:40], e)
        return None


def make_cache_key(
    *,
    inchikey: str,
    pdb_id: str,
    chain: str,
    variant: str,
    engine: str,
    engine_version: str,
    exhaustiveness: int,
    box: tuple[float, float, float, float, float, float],
    prep_version: str,
) -> str:
    """Deterministic sha256 over every input that affects a docking result.

    Box floats are rounded to 3 dp so trivial float noise doesn't fragment the
    key; a genuinely different box still yields a different key."""
    box_str = ",".join(f"{float(v):.3f}" for v in box)
    raw = "|".join([
        _KEY_FORMAT,
        inchikey,
        (pdb_id or "").upper(),
        chain or "",
        variant or "",
        (engine or "").lower(),
        engine_version or "",
        str(int(exhaustiveness)),
        box_str,
        prep_version or "",
    ])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def lookup(cache_key: str) -> Optional[dict[str, Any]]:
    """Return ``{best_score, pose_pdbqt, extra}`` on a cache hit, else None.

    Returns None (miss) when the cache is disabled or on any error."""
    if not settings.dock_cache_enabled or not cache_key:
        return None
    try:
        with Session(engine) as s:
            row = s.execute(
                text(
                    "SELECT best_score, pose_pdbqt, extra FROM dock_cache "
                    "WHERE cache_key = :k LIMIT 1"
                ),
                {"k": cache_key},
            ).first()
            if row is None:
                return None
            try:
                s.execute(
                    text(
                        "UPDATE dock_cache SET hit_count = hit_count + 1, "
                        "last_hit_at = now() WHERE cache_key = :k"
                    ),
                    {"k": cache_key},
                )
                s.commit()
            except Exception:  # noqa: BLE001 — hit accounting is best-effort
                s.rollback()
            return {
                "best_score": float(row[0]),
                "pose_pdbqt": row[1],
                "extra": row[2],
            }
    except Exception as e:  # noqa: BLE001
        log.info("dock_cache lookup failed (%s) — treating as miss", e)
        return None


def store(
    *,
    cache_key: str,
    inchikey: str,
    pdb_id: str,
    chain: str,
    variant: str,
    engine: str,
    engine_version: str,
    exhaustiveness: int,
    prep_version: str,
    best_score: float,
    pose_pdbqt: Optional[str],
    extra: Optional[str],
) -> None:
    """Insert a freshly-docked result. No-op when disabled. Non-fatal: a write
    failure must never break the (already-successful) dock. ``ON CONFLICT DO
    NOTHING`` makes concurrent docks of the same key safe."""
    if not settings.dock_cache_enabled or not cache_key or not inchikey:
        return
    try:
        with Session(engine) as s:
            s.execute(
                text(
                    "INSERT INTO dock_cache (cache_key, inchikey, pdb_id, chain, "
                    "variant, engine, engine_version, exhaustiveness, prep_version, "
                    "best_score, pose_pdbqt, extra) VALUES (:cache_key, :inchikey, "
                    ":pdb_id, :chain, :variant, :engine, :engine_version, "
                    ":exhaustiveness, :prep_version, :best_score, :pose_pdbqt, "
                    ":extra) ON CONFLICT (cache_key) DO NOTHING"
                ),
                {
                    "cache_key": cache_key,
                    "inchikey": inchikey,
                    "pdb_id": (pdb_id or "").upper(),
                    "chain": chain or "",
                    "variant": variant or "",
                    "engine": (engine or "").lower(),
                    "engine_version": engine_version or "",
                    "exhaustiveness": int(exhaustiveness),
                    "prep_version": prep_version or "",
                    "best_score": float(best_score),
                    "pose_pdbqt": pose_pdbqt,
                    "extra": extra,
                },
            )
            s.commit()
            log.info("dock_cache: STORED key=%s engine=%s %s/%s/%s",
                     cache_key[:10], engine, pdb_id, chain, variant)
    except Exception as e:  # noqa: BLE001
        log.info("dock_cache store failed (%s) — non-fatal, result not cached", e)
