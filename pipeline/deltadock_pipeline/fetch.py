"""Fetch and cache PDB structures from RCSB."""

from __future__ import annotations

import logging
from pathlib import Path

import requests

log = logging.getLogger(__name__)

RCSB_URL = "https://files.rcsb.org/download/{pdb_id}.pdb"


class FetchError(RuntimeError):
    pass


def fetch_pdb(pdb_id: str, cache_dir: Path | str) -> Path:
    """Download a PDB file by ID, cache it, and return the local path.

    Args:
        pdb_id: 4-character PDB code (e.g. "1M17"). Case-insensitive.
        cache_dir: Directory to cache downloads in. Created if missing.

    Returns:
        Path to the local .pdb file.

    Raises:
        FetchError: if the download fails.
    """
    pdb_id = pdb_id.strip().upper()
    if len(pdb_id) != 4:
        raise FetchError(f"Invalid PDB ID: {pdb_id!r}")

    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    out = cache_dir / f"{pdb_id}.pdb"

    if out.exists() and out.stat().st_size > 0:
        log.debug("PDB %s already cached at %s", pdb_id, out)
        return out

    url = RCSB_URL.format(pdb_id=pdb_id)
    log.info("Fetching %s from %s", pdb_id, url)
    resp = requests.get(url, timeout=30)
    if resp.status_code != 200:
        raise FetchError(f"RCSB returned {resp.status_code} for {pdb_id}: {resp.text[:200]}")

    out.write_bytes(resp.content)
    log.info("Cached %s (%d bytes)", out, len(resp.content))
    return out
