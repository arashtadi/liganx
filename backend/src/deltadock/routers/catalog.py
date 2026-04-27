"""Curated mutation library endpoint."""

from fastapi import APIRouter, HTTPException

from ..catalog import catalog_dict, get_target

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("")
def list_targets() -> list[dict]:
    """Return the full curated target/mutation/compound library."""
    return catalog_dict()


@router.get("/{target_id}")
def get_target_endpoint(target_id: str) -> dict:
    target = get_target(target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
    from dataclasses import asdict
    return asdict(target)
