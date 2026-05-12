"""Resistance Atlas — public landing pages per FDA-approved targeted drug.

Each `/atlas/<drug-slug>` endpoint returns a forecast snapshot: top
predicted resistance mutations, ranked by a calibrated probability
(currently back-filled from the Δ-baseline; ESM2 + accessibility lift
lands in spike #6/#7). Public — no auth — because the atlas IS the
credibility ledger.

Data lives in `backend/data/atlas/<drug-slug>.json` (one file per
drug). New entries land via the auto-generation pipeline (cron + the
calibration code), not by hand-editing in production.

Routes:
    GET /atlas               — list every drug atlas
    GET /atlas/<slug>        — full forecast snapshot for one drug
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException

log = logging.getLogger(__name__)

router = APIRouter(prefix="/atlas", tags=["atlas"])

# Backend data dir. The runner image deploys to /app, so atlas/ sits
# alongside the existing precomputed_screenings/.
_ATLAS_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data" / "atlas"


_atlas_cache: dict[str, dict] = {}
_summary_cache: list[dict] | None = None


def _load_atlas_file(slug: str) -> dict | None:
    if slug in _atlas_cache:
        return _atlas_cache[slug]
    path = _ATLAS_DIR / f"{slug}.json"
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except Exception as e:  # noqa: BLE001
        log.warning("atlas: failed to parse %s: %s", path, e)
        return None
    _atlas_cache[slug] = data
    return data


def _summarise(data: dict) -> dict:
    """Compact card-grid summary — leaner than the full forecast."""
    return {
        "slug": data.get("drug_slug"),
        "drug_name": data.get("drug_name"),
        "primary_target": data.get("primary_target"),
        "primary_pdb": data.get("primary_pdb"),
        "indications": data.get("indications", []),
        "approved_year": data.get("approved_year"),
        "atlas_version": data.get("atlas_version"),
        "generated_at": data.get("generated_at"),
        "top_mutation": (data.get("predicted_resistance") or [{}])[0].get("mutation"),
        "top_delta_kcal": (data.get("predicted_resistance") or [{}])[0].get("delta_kcal"),
        "literature_confirmed_count": data.get("literature_confirmed_count", 0),
        "n_predictions": len(data.get("predicted_resistance") or []),
        "has_covalent_caveat": "covalent_caveat" in data,
    }


@router.get("")
def list_atlases() -> list[dict]:
    """List every drug atlas as a lean summary suitable for a card grid.

    Cached after first build to avoid hitting disk on every request —
    the atlas files only change when the auto-generator runs (daily-ish).
    """
    global _summary_cache
    if _summary_cache is not None:
        return _summary_cache
    out: list[dict] = []
    if _ATLAS_DIR.exists():
        for p in sorted(_ATLAS_DIR.glob("*.json")):
            try:
                data = json.loads(p.read_text())
                out.append(_summarise(data))
                _atlas_cache[p.stem] = data
            except Exception as e:  # noqa: BLE001
                log.warning("atlas: skipping malformed %s: %s", p, e)
    _summary_cache = out
    return out


@router.get("/{slug}")
def get_atlas(slug: str) -> dict:
    """Full forecast snapshot for one drug. 404 on unknown slug."""
    safe = slug.lower().strip()
    if not safe.replace("-", "").replace("_", "").isalnum():
        raise HTTPException(status_code=400, detail="invalid slug")
    data = _load_atlas_file(safe)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Atlas not found: {safe}")
    return data
