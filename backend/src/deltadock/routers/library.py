"""Precomputed library screening endpoints (v1.23, #211).

A "precomputed screening" is a snapshotted result of running a curated
compound library (e.g. 30 FDA-launched kinase inhibitors) against a
catalog target + a single mutation. The pre-compute script
(`backend/scripts/precompute_library_screening.py`) runs the screening
through the regular API + dumps the result JSON to
`backend/data/precomputed_screenings/<slug>.json`.

These endpoints read that directory at process startup, cache the
loaded JSONs in memory, and serve them:

  GET /library/precomputed                    — list available
  GET /library/precomputed/{slug}             — fetch one

The /{slug} endpoint returns a ScreeningOut-shaped payload so the
existing frontend ScreeningPage component renders it without any
modification. id / created_at / updated_at are synthesized — they
satisfy the schema but mark the record as a precomputed snapshot
(id = -1, status = COMPLETED, share_id = the slug).

No auth required: precomputed screenings are public marketing pages —
they live at /library/<slug> on the frontend and are explicitly meant
to be indexed by search engines.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

log = logging.getLogger(__name__)

router = APIRouter(prefix="/library", tags=["library"])

# Resolves to backend/data/precomputed_screenings/ — the same directory
# the precompute script writes to. Kept relative to the repo root so
# Fly's image layout matches dev (Dockerfile copies backend/ verbatim).
_DATA_DIR = (
    Path(__file__).resolve().parent.parent.parent.parent
    / "data"
    / "precomputed_screenings"
)


class PrecomputedSummary(BaseModel):
    """Lean list-view shape — what the /library landing page consumes
    to render its card grid. Doesn't include the per-cell results
    array because the list endpoint might cover 50+ screenings later
    and we don't want to ship megabytes for a landing page render."""
    slug: str
    library_id: str
    library_name: str
    library_compound_count: int
    pdb_id: str
    chain: str
    mutations: list[str]
    n_total: int
    n_completed: int
    n_failed: int
    n_hits: int  # rows with selectivity_index >= 1.0 (heuristic)
    top_hit_name: str | None
    top_hit_selectivity: float | None
    computed_at: str | None


# In-memory cache. Built lazily on first request rather than at import
# time so the rest of the app can boot even if a JSON is malformed —
# a bad file blocks only its own slug, not the whole /library route.
_CACHE: dict[str, dict[str, Any]] | None = None


def _load_all() -> dict[str, dict[str, Any]]:
    """Scan the precomputed_screenings directory, parse every JSON,
    return a {slug: payload} map. Skips files that don't parse and
    logs them — better to keep serving the rest than to 500 the whole
    /library page because of one bad file."""
    out: dict[str, dict[str, Any]] = {}
    if not _DATA_DIR.exists():
        log.info("library: precomputed dir %s does not exist; serving empty", _DATA_DIR)
        return out
    for path in sorted(_DATA_DIR.glob("*.json")):
        slug = path.stem
        try:
            payload = json.loads(path.read_text())
        except Exception as e:
            log.warning("library: skipping malformed %s: %s", path.name, e)
            continue
        # Defensive: the precompute script writes consistent shapes,
        # but a partial run could leave half-filled JSON. Require the
        # minimum fields to render.
        if "results" not in payload or "pdb_id" not in payload:
            log.warning("library: skipping %s (missing required fields)", path.name)
            continue
        out[slug] = payload
    log.info("library: loaded %d precomputed screening(s) from %s", len(out), _DATA_DIR)
    return out


def _cache() -> dict[str, dict[str, Any]]:
    global _CACHE
    if _CACHE is None:
        _CACHE = _load_all()
    return _CACHE


def _summary_from(slug: str, payload: dict[str, Any]) -> PrecomputedSummary:
    results = payload.get("results", [])
    # Selectivity hits: any row with selectivity_index >= 1.0. The
    # threshold is a soft heuristic — selectivity_index is unbounded
    # but ~1 is the rough "tighter on mutant than WT by a real margin"
    # signal. Lower can still be informative; this is just for the card.
    hits = [
        r for r in results
        if r.get("selectivity_index") is not None and r["selectivity_index"] >= 1.0
    ]
    top = None
    if hits:
        # Results are pre-sorted by selectivity DESC by the precompute
        # script, so the first hit is the top one. Don't re-sort here
        # in case the sort changes downstream.
        top = hits[0]
    return PrecomputedSummary(
        slug=slug,
        library_id=payload.get("library_id", "unknown"),
        library_name=payload.get("library_name", "Unknown library"),
        library_compound_count=int(payload.get("library_compound_count", 0)),
        pdb_id=payload.get("pdb_id", "?"),
        chain=payload.get("chain", "A"),
        mutations=list(payload.get("mutations", [])),
        n_total=int(payload.get("n_total", 0)),
        n_completed=int(payload.get("n_completed", 0)),
        n_failed=int(payload.get("n_failed", 0)),
        n_hits=len(hits),
        top_hit_name=(top or {}).get("compound_name"),
        top_hit_selectivity=(top or {}).get("selectivity_index"),
        computed_at=payload.get("computed_at"),
    )


@router.get("/precomputed", response_model=list[PrecomputedSummary])
def list_precomputed() -> list[PrecomputedSummary]:
    """List every available precomputed screening. The /library landing
    page consumes this to render its card grid."""
    cache = _cache()
    return [_summary_from(slug, payload) for slug, payload in cache.items()]


@router.get("/precomputed/{slug}")
def get_precomputed(slug: str) -> dict[str, Any]:
    """Return the full snapshot JSON for one precomputed screening.

    Shape matches ScreeningOut (with synthesized id / timestamps) so
    the frontend ScreeningPage component renders it without any path
    branching. We deliberately return a plain dict instead of
    `response_model=ScreeningOut` because the precompute snapshot
    drops a few sensitive server-side fields (user_id auto-set to
    None, etc.) and adds a `precomputed: true` marker the frontend
    uses to disable the Promote / Cancel buttons that don't apply to
    snapshots."""
    cache = _cache()
    if slug not in cache:
        raise HTTPException(status_code=404, detail="Precomputed screening not found")
    src = cache[slug]
    now = datetime.utcnow().isoformat() + "Z"
    return {
        # Synthesized envelope fields. id=-1 signals "this is a
        # precomputed snapshot, not a live screening" — any client
        # code that branches on id (cancel, refresh, etc.) should
        # treat negative ids as read-only.
        "id": -1,
        "share_id": slug,
        "pdb_id": src.get("pdb_id"),
        "chain": src.get("chain", "A"),
        "uniprot_id": None,
        "mutations": list(src.get("mutations", [])),
        "engine": src.get("engine", "quickvina2_gpu"),
        "exhaustiveness": int(src.get("exhaustiveness", 4)),
        "n_total": int(src.get("n_total", 0)),
        "n_completed": int(src.get("n_completed", 0)),
        "n_failed": int(src.get("n_failed", 0)),
        # ScreeningStatus enum value as a string; serialized form is
        # "completed" lowercase (matches what /screening returns).
        "status": "completed",
        "error_message": None,
        "created_at": src.get("computed_at") or now,
        "updated_at": src.get("computed_at") or now,
        "user_id": None,
        # Auto-title that explains what the user is looking at when
        # they hit this URL from the landing page or a search engine.
        "title": (
            f"{src.get('library_name', 'Library')} vs "
            f"{src.get('pdb_id', '?')}"
            + (
                f" / {src['mutations'][0]}"
                if src.get("mutations")
                else " (WT)"
            )
        ),
        "tags": ["precomputed", f"library:{src.get('library_id','?')}"],
        "results": src.get("results", []),
        # Frontend marker — set on the response so the
        # ScreeningPage component can hide "Promote N to Full Job"
        # and Cancel/Delete buttons that don't apply to snapshots.
        "precomputed": True,
        "library_id": src.get("library_id"),
        "library_name": src.get("library_name"),
        "library_compound_count": src.get("library_compound_count"),
    }


def reload_cache() -> int:
    """Manually flush + rebuild the in-memory cache. Useful after
    adding a new precomputed JSON without restarting the process.
    Returns the new count. Not exposed as an HTTP endpoint yet —
    invoked by tests + the future admin reload action."""
    global _CACHE
    _CACHE = _load_all()
    return len(_CACHE)
