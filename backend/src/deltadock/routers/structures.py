"""Serve cached PDB structures (WT-clean and FoldX-mutated) to the frontend.

Why we don't just point the viewer at RCSB: for mutants, the only place the
FoldX-built structure exists is on the local disk. Plus, having a single endpoint
shape lets us swap to R2-backed storage in Phase B without changing the frontend.
"""

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from ..services.runner import RECEPTOR_CACHE

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

    pdb_root = Path.home() / ".deltadock" / "pdb"
    if variant == "WT":
        path = pdb_root / f"{pdb_id}_{chain}.clean.pdb"
        allowed_root = pdb_root.resolve()
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
        raise HTTPException(status_code=404, detail=f"No cached structure for {pdb_id}/{chain}/{variant}")

    return path.read_text()
