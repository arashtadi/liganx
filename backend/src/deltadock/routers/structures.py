"""Serve cached PDB structures (WT-clean and FoldX-mutated) to the frontend.

Why we don't just point the viewer at RCSB: for mutants, the only place the
FoldX-built structure exists is on the local disk. Plus, having a single endpoint
shape lets us swap to R2-backed storage in Phase B without changing the frontend.

Both PDB_CACHE (WT cleaned PDBs) and RECEPTOR_CACHE (mutant FoldX builds) are
imported from runner.py so the env-configurable cache root flows through to
this router automatically. In production these point at the Fly volume so the
3D viewer keeps working across redeploys.

Self-heal for WT (added 2026-04-30): if the WT cleaned PDB is missing — which
happened in bulk when a deploy wiped the receptor cache that used to live on
ephemeral disk — we regenerate it on demand by fetching from RCSB and running
the same fix_pdb() prep the runner uses. Adds ~15-30 s to the first request
for an old job, then the cached file works normally for everyone after. We
deliberately do NOT self-heal mutant variants — they require FoldX which is
slow and stateful; the user can re-submit the job to rebuild them.
"""

import logging
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from ..services.runner import PDB_CACHE, RECEPTOR_CACHE

log = logging.getLogger(__name__)

router = APIRouter(prefix="/structures", tags=["structures"])

# Format guards. URL params get baked into filesystem paths below, so anything
# that could escape the cache directory must be rejected here. Accepts either
# standard 4-char RCSB IDs or user-uploaded "USR_xxxxxxxx" tokens.
_PDB_RE = re.compile(r"^([A-Za-z0-9]{4}|USR_[0-9a-f]{8})$")
_CHAIN_RE = re.compile(r"^[A-Za-z0-9]{1,2}$")
_VARIANT_RE = re.compile(r"^(WT|[A-Za-z][0-9]+[A-Za-z]([+_][A-Za-z0-9]+)*(del|ins[A-Za-z]+)?)$")


@router.get("/{pdb_id}/{chain}/{variant}", response_class=PlainTextResponse)
def get_structure(pdb_id: str, chain: str, variant: str) -> str:
    """Return the cleaned PDB text for a given (target, chain, variant).

    For variant="WT" we serve the PDBFixer-cleaned WT structure.
    For mutations like "T790M" we serve the FoldX-mutated structure.
    """
    # Validate first — never trust path components from URLs.
    if not _PDB_RE.match(pdb_id):
        raise HTTPException(status_code=400, detail="invalid pdb_id format")
    if not _CHAIN_RE.match(chain):
        raise HTTPException(status_code=400, detail="invalid chain format")
    if not _VARIANT_RE.match(variant):
        raise HTTPException(status_code=400, detail="invalid variant format")

    # User uploads keep their case-significant USR_ prefix; only standard
    # RCSB IDs get upper-cased.
    if not pdb_id.startswith("USR_"):
        pdb_id = pdb_id.upper()
    chain = chain.upper()
    # Don't uppercase variant fully — "del"/"ins" suffixes are case-significant.
    if variant.upper() == "WT":
        variant = "WT"

    if variant == "WT":
        path = PDB_CACHE / f"{pdb_id}_{chain}.clean.pdb"
        allowed_root = PDB_CACHE.resolve()
    else:
        path = RECEPTOR_CACHE / f"{pdb_id}_{chain}_{variant}.clean.pdb"
        allowed_root = RECEPTOR_CACHE.resolve()

    # Defence-in-depth: even with the regex check above, refuse to serve
    # anything outside the expected cache root.
    try:
        resolved = path.resolve()
        resolved.relative_to(allowed_root)
    except (ValueError, OSError):
        raise HTTPException(status_code=400, detail="invalid path")

    if not path.exists() or path.stat().st_size == 0:
        # Self-heal for WT: regenerate the cleaned PDB on demand. Mutant
        # variants need FoldX which is too slow to run inline (~30 s);
        # users see a 404 and can re-submit the job to rebuild them.
        if variant == "WT" and not pdb_id.startswith("USR_"):
            try:
                _regenerate_wt_clean(pdb_id, chain, path)
            except Exception as e:
                log.warning("Self-heal failed for %s/%s WT: %s", pdb_id, chain, e)
                raise HTTPException(
                    status_code=503,
                    detail=f"Receptor cache miss for {pdb_id}/{chain}/WT and on-demand regenerate failed: {e}",
                )
        else:
            raise HTTPException(status_code=404, detail=f"No cached structure for {pdb_id}/{chain}/{variant}")

    return path.read_text()


def _regenerate_wt_clean(pdb_id: str, chain: str, out_path: Path) -> None:
    """Re-run the WT prep pipeline so an old job whose receptor cache got
    wiped (e.g. by a deploy that landed before the cache was on a Fly
    volume) becomes viewable again. Cheap-ish: ~5 s RCSB download + ~10–20 s
    PDBFixer prep; the result is cached on disk afterwards so subsequent
    requests are instant. Only safe for standard 4-char RCSB IDs — user
    uploads have no remote source."""
    from deltadock_pipeline.fetch import fetch_pdb
    from deltadock_pipeline.prep import fix_pdb

    log.info("Self-heal: regenerating WT cleaned PDB for %s/%s", pdb_id, chain)
    raw = fetch_pdb(pdb_id, PDB_CACHE)
    fix_pdb(raw, out_path, chain=chain)
    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RuntimeError("fix_pdb returned but produced no file")
