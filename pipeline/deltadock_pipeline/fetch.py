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

    # Cache validity check: file must (a) exist, (b) be non-empty, (c) actually
    # contain ATOM records on at least one chain. Without this, a previous
    # 404 / HTTP error / partial download saved as "1T0L.pdb" silently sticks
    # around forever and breaks every job for that PDB. Seen in prod for 1T0L.
    def _looks_like_valid_pdb(p: Path) -> bool:
        try:
            with p.open() as fh:
                for line in fh:
                    if line.startswith("ATOM"):
                        return True
        except OSError:
            pass
        return False

    if out.exists() and out.stat().st_size > 0 and _looks_like_valid_pdb(out):
        log.debug("PDB %s already cached at %s", pdb_id, out)
        return out

    if out.exists():
        log.warning("Cached %s exists but is invalid (no ATOM records) — refetching", out.name)
        try:
            out.unlink()
        except OSError:
            pass

    url = RCSB_URL.format(pdb_id=pdb_id)
    # CloudFront in front of RCSB occasionally returns truncated responses
    # (HEADER + TITLE only, no ATOMs) for clients without a User-Agent or
    # without accept-encoding negotiation. Setting a real UA + retrying
    # once on truncation handles this.
    headers = {
        "User-Agent": "Liganx/0.1 (https://liganx.com; mutation-aware docking)",
        "Accept": "text/plain, */*",
    }

    last_err = None
    for attempt in range(3):
        log.info("Fetching %s from %s (attempt %d)", pdb_id, url, attempt + 1)
        try:
            resp = requests.get(url, timeout=30, headers=headers)
        except requests.RequestException as e:
            last_err = f"network error: {e}"
            continue
        if resp.status_code != 200:
            last_err = f"HTTP {resp.status_code}: {resp.text[:200]}"
            continue

        # CloudFront sometimes lies about Content-Length — verify we got a
        # complete-looking PDB by counting ATOM-line occurrences in the body.
        body = resp.content
        atom_count = body.count(b"\nATOM ")
        if atom_count == 0:
            last_err = (
                f"truncated response: 200 OK but {len(body)} bytes contains "
                f"zero ATOM records (first 200 bytes: {body[:200]!r})"
            )
            continue

        out.write_bytes(body)
        # Final on-disk validation — paranoid but cheap
        if not _looks_like_valid_pdb(out):
            try:
                out.unlink()
            except OSError:
                pass
            last_err = "wrote file but on-disk read found no ATOM lines"
            continue

        log.info("Cached %s (%d bytes, %d ATOM records)", out, len(body), atom_count)
        return out

    raise FetchError(
        f"Downloaded {pdb_id} from RCSB but all 3 attempts failed: {last_err}. "
        "Cache cleared."
    )
