"""Client for the GPU pod's /esm2/fitness endpoint.

Free-tier /calibrate/score calls this for any (gene, position, mutant)
that isn't in our local 49-event cache, so users actually get a real
ESM-2 score instead of the BLOSUM62 fallback. Cost: ~1 second of pod
GPU time per cache-missed call, then $0 for every repeat lookup
(the pod-side sqlite cache + this backend's local cache combine to
ensure the second user asking the same question pays nothing).

Architecture:
  /calibrate/score → _score_row → if not in local 49-event cache,
  → fetch_pod_fitness → HTTP POST {settings.pod_dock_url}/esm2/fitness
  → cache result in /tmp/liganx_esm2_local_cache.json
  → return to caller

Failure mode: if the pod is asleep or the call errors, we fall back
to BLOSUM62. The score_source field in the response makes this
transparent ("cached_esm2_local", "live_esm2_pod", "blosum_proxy").
"""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# Local persistent cache. Backed by /tmp on Fly (ephemeral per machine
# restart, which is fine — the pod-side sqlite cache is the source of
# truth and survives restarts). On Fly with a mounted volume this
# could move to /var/lib/liganx/esm2_cache.json for true persistence;
# for v1 the per-machine ephemeral cache is good enough.
_LOCAL_CACHE_PATH = Path("/tmp/liganx_esm2_local_cache.json")

_LOCAL_CACHE: dict[str, dict] | None = None
_LOCAL_CACHE_LOCK = threading.Lock()


def _cache_key(gene: str, position: int, wt: str, mut: str) -> str:
    return f"{gene.upper()}:{position}:{wt.upper()}:{mut.upper()}"


def _load_local_cache() -> dict[str, dict]:
    global _LOCAL_CACHE
    if _LOCAL_CACHE is not None:
        return _LOCAL_CACHE
    with _LOCAL_CACHE_LOCK:
        if _LOCAL_CACHE is not None:
            return _LOCAL_CACHE
        if _LOCAL_CACHE_PATH.exists():
            try:
                _LOCAL_CACHE = json.loads(_LOCAL_CACHE_PATH.read_text())
            except Exception as e:  # noqa: BLE001
                log.warning("esm2_pod_client: cache load failed (%s); starting fresh", e)
                _LOCAL_CACHE = {}
        else:
            _LOCAL_CACHE = {}
    return _LOCAL_CACHE


def _save_local_cache() -> None:
    if _LOCAL_CACHE is None:
        return
    try:
        _LOCAL_CACHE_PATH.write_text(json.dumps(_LOCAL_CACHE))
    except Exception as e:  # noqa: BLE001
        log.warning("esm2_pod_client: cache save failed: %s", e)


def fetch_pod_fitness(
    gene: str,
    position: int,
    wt: str,
    mut: str,
    timeout_s: float = 30.0,
) -> dict[str, Any] | None:
    """Call the pod's /esm2/fitness endpoint for one substitution.

    Returns:
      dict with fitness + bookkeeping fields on success.
      None on any failure (caller falls back to BLOSUM62).

    Caches successful results in /tmp so repeat lookups never hit the
    pod twice within a machine lifetime. The pod itself also caches
    via sqlite so even after our /tmp cache is wiped on Fly redeploy,
    the second-ever request still pays $0.
    """
    cache = _load_local_cache()
    key = _cache_key(gene, position, wt, mut)
    cached = cache.get(key)
    if cached:
        return {**cached, "score_source": "cached_esm2_local"}

    from ..config import get_settings, pod_auth_headers
    settings = get_settings()
    pod_url = (settings.pod_dock_url or "").rstrip("/")
    if not pod_url:
        log.info("esm2_pod_client: pod_dock_url not configured; can't fetch live ESM2")
        return None

    import httpx
    try:
        with httpx.Client(timeout=timeout_s) as client:
            resp = client.post(
                f"{pod_url}/esm2/fitness",
                json={"gene": gene, "position": position, "wt": wt, "mut": mut},
                # Shared-secret auth — empty dict until POD_SHARED_SECRET
                # is set on both ends, so this is a safe no-op until then.
                headers=pod_auth_headers(),
            )
        if resp.status_code == 400:
            log.info("esm2_pod_client: pod rejected request (400): %s", resp.text[:200])
            return None
        if resp.status_code >= 500:
            log.warning("esm2_pod_client: pod 5xx for %s: %s", key, resp.text[:200])
            return None
        if not resp.is_success:
            log.warning("esm2_pod_client: pod HTTP %d for %s", resp.status_code, key)
            return None
        payload = resp.json()
    except Exception as e:  # noqa: BLE001
        log.warning("esm2_pod_client: pod call failed for %s: %s", key, e)
        return None

    # Stash and return. The pod tags `cache_hit=True` when its own
    # sqlite returned the result without firing the GPU; we surface
    # the same flag so the UI can show "instant" vs "GPU-warm" times.
    result = {
        "fitness": payload.get("fitness"),
        "log_p_wt": payload.get("log_p_wt"),
        "log_p_mut": payload.get("log_p_mut"),
        "seq_len": payload.get("seq_len"),
        "windowed": payload.get("windowed", False),
        "pod_cache_hit": payload.get("cache_hit", False),
        "uniprot_id": payload.get("uniprot_id"),
    }
    if result["fitness"] is None:
        return None
    cache[key] = result
    _save_local_cache()
    return {**result, "score_source": "live_esm2_pod"}
