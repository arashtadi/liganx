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
    """Resolve a PDB to a local file path. Two source modes:

    * Standard 4-char RCSB ID  → download from RCSB (cached after first hit)
    * "USR_xxxxxxxx" prefix    → user upload that the lookup router already
                                  wrote to {cache_dir}/{pdb_id}.pdb. Just
                                  return the path; raise if it's missing
                                  (the upload was supposed to put it there).

    Args:
        pdb_id: 4-character RCSB code (case-insensitive) OR "USR_<8 hex>".
        cache_dir: Directory used for both modes (~/.deltadock/pdb in prod).

    Returns:
        Path to the local .pdb file.

    Raises:
        FetchError: if download fails or the user-uploaded file isn't there.
    """
    pdb_id = pdb_id.strip()
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    # User-uploaded PDB: bypass RCSB and read what the upload endpoint stored.
    if pdb_id.startswith("USR_"):
        out = cache_dir / f"{pdb_id}.pdb"
        if out.exists() and out.stat().st_size > 0:
            log.debug("Using user-uploaded PDB %s at %s", pdb_id, out)
            return out
        raise FetchError(
            f"User-uploaded PDB {pdb_id!r} not found at {out}. "
            "The upload may have been on a different machine, or the cache was cleared."
        )

    pdb_id = pdb_id.upper()
    if len(pdb_id) != 4:
        raise FetchError(f"Invalid PDB ID: {pdb_id!r}")

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
