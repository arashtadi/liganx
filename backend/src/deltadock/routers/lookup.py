"""Compound name → SMILES lookup via PubChem REST.

PubChem's PUG REST API is free, unauthenticated, and has no rate limit on
modest use. We hit:

  /compound/name/{name}/property/CanonicalSMILES,IUPACName,MolecularFormula/JSON

If multiple matches exist, PubChem returns them all; we just take the first
(which is the highest-relevance compound).
"""

import logging
from functools import lru_cache
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from ..services.rate_limit import UPLOADS_LIMIT

router = APIRouter(prefix="/lookup", tags=["lookup"])
log = logging.getLogger(__name__)

PUBCHEM_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound"
PUBCHEM_AUTOCOMPLETE = "https://pubchem.ncbi.nlm.nih.gov/rest/autocomplete/compound"


@router.get("/compound")
async def lookup_compound(q: str) -> dict:
    """Look up a compound by name, return its canonical SMILES + metadata."""
    name = q.strip()
    if not name:
        raise HTTPException(400, "Query must be non-empty")
    if len(name) > 200:
        raise HTTPException(400, "Query too long")

    # PubChem renamed CanonicalSMILES → SMILES/IsomericSMILES around mid-2024.
    # Request both old and new names so we work against any tier.
    url = (
        f"{PUBCHEM_BASE}/name/{quote(name)}/property/"
        f"IsomericSMILES,SMILES,CanonicalSMILES,IUPACName,MolecularFormula/JSON"
    )
    log.info("PubChem lookup: %s", name)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
    except httpx.TimeoutException:
        raise HTTPException(504, "PubChem timed out")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"PubChem unreachable: {e}")

    if resp.status_code == 404:
        raise HTTPException(404, f"PubChem doesn't know '{name}'")
    if resp.status_code != 200:
        raise HTTPException(502, f"PubChem returned HTTP {resp.status_code}")

    try:
        data = resp.json()
        props = data["PropertyTable"]["Properties"]
    except Exception:
        raise HTTPException(502, "PubChem returned an unexpected response")

    if not props:
        raise HTTPException(404, f"No SMILES for '{name}'")

    p = props[0]  # take the top match
    smiles = p.get("IsomericSMILES") or p.get("SMILES") or p.get("CanonicalSMILES")
    if not smiles:
        raise HTTPException(404, f"PubChem returned no SMILES for '{name}'")
    return {
        "name": name,
        "cid": p.get("CID"),
        "smiles": smiles,
        "iupac_name": p.get("IUPACName"),
        "molecular_formula": p.get("MolecularFormula"),
    }


@router.get("/pdb/{pdb_id}/info")
def get_pdb_info(pdb_id: str) -> dict:
    """Return basic PDB metadata (title, protein name, organism, UniProt).

    Used by the JobPage header to render a protein name next to the PDB ID
    so a scientist sees `2WGJ · Hepatocyte growth factor receptor · chain A`
    instead of the bare RCSB code. We hit RCSB's GraphQL Data API once
    per PDB ID and cache the result in-process for 24h.

    User uploads (USR_xxxxxxxx) skip the call — there's no RCSB entry to
    look up — and return only the prefixed pdb_id.

    Returns 404 only when the PDB ID is malformed; otherwise we always
    return a 200 with at least `{pdb_id}` populated, so the frontend can
    fall back to "PDB ID only" without error-handling complexity.
    """
    pid = (pdb_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="missing pdb_id")
    if pid.startswith("USR_"):
        # User-uploaded structure — no name to resolve, just echo the id.
        return {"pdb_id": pid}
    if len(pid) != 4 or not pid.isalnum():
        raise HTTPException(status_code=400, detail="invalid pdb_id format")

    try:
        from ..services.rcsb_info import get_pdb_info as _lookup
        info = _lookup(pid)
    except ImportError:
        info = None
    if info is None:
        # Network/RCSB hiccup — return the bare ID so the UI degrades
        # gracefully (no name shown, no error toast).
        return {"pdb_id": pid.upper()}
    return info


@router.post("/pdb/upload", dependencies=[Depends(UPLOADS_LIMIT)])
async def upload_pdb_file(file: UploadFile = File(...)) -> dict:
    """Accept a user-uploaded PDB file. Stores it as USR_<8 hex>.pdb in the
    same cache directory the runner reads from for RCSB downloads, so the
    rest of the pipeline (PDBFixer cleanup, pocket detection, receptor prep,
    docking, validation) works unchanged.

    Returns the synthetic pdb_id ("USR_xxxxxxxx") + the list of chain IDs
    we found in the file so the UI can populate a chain dropdown without
    making the user guess.
    """
    import secrets as _secrets
    from pathlib import Path as _Path

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")
    if len(raw) > 10_000_000:
        raise HTTPException(413, "PDB file too large (max 10 MB)")

    text = raw.decode("utf-8", errors="replace")
    # Quick sanity-check: a PDB has ATOM/HETATM lines. If neither is present,
    # the upload is almost certainly mislabelled (PDBQT, mmCIF, garbage).
    if "ATOM  " not in text and "HETATM" not in text:
        raise HTTPException(400, "File doesn't look like a PDB (no ATOM/HETATM records)")

    # Extract chain IDs from ATOM record column 22 (1-indexed) for the dropdown.
    chains: list[str] = []
    seen: set[str] = set()
    for line in text.splitlines():
        if line.startswith(("ATOM  ", "HETATM")):
            if len(line) >= 22:
                ch = line[21:22].strip()
                if ch and ch not in seen:
                    seen.add(ch)
                    chains.append(ch)
        if len(chains) >= 26:
            break  # PDBs cap at 26 chain IDs anyway
    if not chains:
        chains = ["A"]  # Default to A so the UI doesn't show an empty dropdown

    pdb_id = "USR_" + _secrets.token_hex(4)  # 8 hex chars
    # Write to the SAME directory the docking pipeline reads from
    # (services.runner.PDB_CACHE → /var/lib/liganx/poses/cache/pdb on
    # Fly, persistent volume mount). Earlier this wrote to
    # ~/.deltadock/pdb which gets wiped on every machine restart, so
    # uploads worked until the next deploy and then failed at the
    # docking step with "User-uploaded PDB not found at ...".
    # Imported lazily to avoid a circular import at module load.
    from ..services.runner import PDB_CACHE
    PDB_CACHE.mkdir(parents=True, exist_ok=True)
    out_path = PDB_CACHE / f"{pdb_id}.pdb"
    out_path.write_text(text)
    log.info("Stored uploaded PDB %s at %s (%d bytes, chains=%s)",
             pdb_id, out_path, len(raw), ",".join(chains))

    return {
        "pdb_id": pdb_id,
        "chains": chains,
        "size_bytes": len(raw),
    }


@router.post("/compounds/parse")
async def parse_compounds_file(file: UploadFile = File(...)) -> dict:
    """Parse an uploaded compound file (.sdf, .smi, .csv, .txt) and return
    a list of {name, smiles}. Does NOT submit a job — just extracts compounds
    so the frontend can pre-fill them.

    Caps at 200 compounds to keep the UI responsive. Larger files are truncated.
    """
    name = (file.filename or "").lower()
    raw = await file.read()
    if len(raw) > 5_000_000:
        raise HTTPException(413, "File too large (max 5 MB)")

    text = raw.decode("utf-8", errors="replace")
    compounds: list[dict] = []

    try:
        if name.endswith(".sdf") or "\nM  END\n" in text or "\n$$$$\n" in text:
            compounds = _parse_sdf(text)
        elif name.endswith(".csv") or "," in text.splitlines()[0]:
            compounds = _parse_csv(text)
        else:
            # SMI / TXT / fallback: one molecule per line, optional name after whitespace
            compounds = _parse_smi(text)
    except Exception as e:
        log.exception("Compound parse failed")
        raise HTTPException(400, f"Could not parse file: {e}")

    if not compounds:
        raise HTTPException(400, "No valid compounds found in file")

    if len(compounds) > 200:
        compounds = compounds[:200]
        return {"compounds": compounds, "truncated": True, "limit": 200}
    return {"compounds": compounds, "truncated": False}


def _parse_sdf(text: str) -> list[dict]:
    """SDF → list of {name, smiles} via RDKit."""
    from rdkit import Chem

    out: list[dict] = []
    # Use SDMolSupplier on an in-memory ForwardSDMolSupplier-like reader
    suppl = Chem.SDMolSupplier()
    suppl.SetData(text, sanitize=True, removeHs=True)
    for i, mol in enumerate(suppl):
        if mol is None:
            continue
        smi = Chem.MolToSmiles(mol)
        if not smi:
            continue
        nm = mol.GetProp("_Name") if mol.HasProp("_Name") else f"Compound {i+1}"
        out.append({"name": nm.strip() or f"Compound {i+1}", "smiles": smi})
    return out


def _parse_csv(text: str) -> list[dict]:
    """CSV with at least a SMILES column. Auto-detects which column is SMILES
    (longest column with valid SMILES on first non-header row) and which column
    is name (everything else, prefer 'name' header)."""
    import csv as _csv
    import io

    from rdkit import Chem

    reader = _csv.reader(io.StringIO(text))
    rows = [r for r in reader if r and any(c.strip() for c in r)]
    if not rows:
        return []
    header = [c.strip().lower() for c in rows[0]]
    data_rows = rows[1:] if any(any(k in h for k in ("smile", "smiles")) for h in header) else rows

    # Identify SMILES column
    smiles_col = next((i for i, h in enumerate(header) if "smile" in h), None)
    name_col = next((i for i, h in enumerate(header) if "name" in h or "id" in h), None)
    if smiles_col is None:
        # Heuristic: first column whose first data row parses as a molecule
        for i in range(len(rows[0])):
            sample = data_rows[0][i] if data_rows else ""
            if sample and Chem.MolFromSmiles(sample.strip()) is not None:
                smiles_col = i
                if name_col is None and len(rows[0]) > 1:
                    name_col = (i + 1) % len(rows[0])
                break
    if smiles_col is None:
        return []

    out: list[dict] = []
    for i, row in enumerate(data_rows):
        if smiles_col >= len(row):
            continue
        smi = row[smiles_col].strip()
        if not smi or Chem.MolFromSmiles(smi) is None:
            continue
        nm = (row[name_col].strip() if name_col is not None and name_col < len(row) else f"Compound {i+1}")
        out.append({"name": nm or f"Compound {i+1}", "smiles": smi})
    return out


def _parse_smi(text: str) -> list[dict]:
    """One SMILES per line, optionally followed by whitespace + name."""
    from rdkit import Chem

    out: list[dict] = []
    for i, raw_line in enumerate(text.splitlines()):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(None, 1)
        smi = parts[0]
        if Chem.MolFromSmiles(smi) is None:
            continue
        nm = parts[1].strip() if len(parts) > 1 else f"Compound {i+1}"
        out.append({"name": nm or f"Compound {i+1}", "smiles": smi})
    return out


@router.get("/compound/suggest")
async def suggest_compound(q: str, limit: int = 8) -> dict:
    """Auto-complete suggestions for compound names — useful for typos and partial input.

    Hits PubChem's free autocomplete API. Returns up to `limit` candidate names.
    """
    name = q.strip()
    if not name or len(name) < 2:
        return {"query": name, "suggestions": []}
    limit = max(1, min(20, limit))
    url = f"{PUBCHEM_AUTOCOMPLETE}/{quote(name)}/json?limit={limit}"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url)
        if r.status_code != 200:
            return {"query": name, "suggestions": []}
        data = r.json()
        return {"query": name, "suggestions": data.get("dictionary_terms", {}).get("compound", [])[:limit]}
    except Exception as e:
        log.warning("Autocomplete failed for %s: %s", name, e)
        return {"query": name, "suggestions": []}


# ── SMILES inspection (parse + 2D depiction + structural sanity) ───────
#
# Used by the New-job form's MoleculePreview to give immediate visual
# feedback on whether the SMILES the user typed is what they meant.
# Catches three classes of bug BEFORE the user wastes GPU time:
#   1. Parse failures (invalid valence, malformed brackets, etc.).
#   2. Disconnected fragments (e.g. salt forms like "CC(=O)O.[Na+]").
#   3. 3D-embeddable failures (parses fine, but RDKit can't get a 3D
#      conformer — the docking pipeline would fail at ligand-prep step).
#
# We expose the SVG depiction the same endpoint produces because the
# frontend wants to show the user "this is what your SMILES looks like"
# inline. Single endpoint, single round-trip.


class SmilesInspectIn(BaseModel):
    smiles: str
    # When true, also try EmbedMolecule. Slower (~200-500ms vs ~10ms parse-only)
    # so the frontend opts in only at submit time, not on every keystroke.
    embed_check: bool = False
    # SVG canvas size in pixels. Bumping this is cheap on the server but
    # large SVGs cost frontend rendering time, so cap at something sane.
    width: int = 220
    height: int = 130


class SmilesFragmentInfo(BaseModel):
    smiles: str
    atom_count: int


class SmilesInspectOut(BaseModel):
    valid: bool
    """True iff RDKit parsed AND sanitized successfully. Frontend uses this
    as the 'green checkmark' signal."""
    error: str | None = None
    """Human-friendly reason when valid=False (RDKit's actual error trimmed
    to one line)."""
    canonical_smiles: str | None = None
    """RDKit-canonicalized SMILES — frontend can offer this as a 'use the
    canonical form' fix when the user typed something parseable but messy."""
    svg: str | None = None
    """2D depiction. Empty SVG is preserved when parse failed so the
    frontend can show a placeholder."""
    fragment_count: int = 0
    """Number of dot-separated fragments. >1 means the user pasted a salt
    form or similar; the frontend offers a Keep-largest button."""
    largest_fragment: SmilesFragmentInfo | None = None
    """When fragment_count>1, the largest fragment's SMILES + atom count.
    The frontend's Keep-largest button writes this back to the row."""
    embed_ok: bool | None = None
    """Only present when embed_check=true. False means RDKit couldn't
    get a 3D conformer — the docking pipeline would fail downstream, so
    we surface it at submit time instead."""
    embed_error: str | None = None
    atom_count: int = 0
    """Heavy-atom count of the parsed molecule. Used by the Keep-largest
    suggestion to compare fragments."""


def _trim_error(msg: str, limit: int = 200) -> str:
    """RDKit dumps multi-line errors with full stack-traces; users only
    want the headline. Keep first non-empty line, length-bound."""
    if not msg:
        return ""
    first = next((ln for ln in msg.splitlines() if ln.strip()), msg)
    return (first[: limit - 1] + "…") if len(first) > limit else first


@lru_cache(maxsize=512)
def _inspect_cached(smiles: str, embed: bool, w: int, h: int) -> dict:
    """LRU-cached inspect — same SMILES on the same call type returns the
    same answer, so debounced keystrokes don't reparse on every call."""
    out: dict = {
        "valid": False, "error": None, "canonical_smiles": None,
        "svg": None, "fragment_count": 0, "largest_fragment": None,
        "embed_ok": None, "embed_error": None, "atom_count": 0,
    }
    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem, Draw
        from rdkit.Chem.Draw import rdMolDraw2D
    except ImportError:
        out["error"] = "RDKit not available in this deployment"
        return out

    try:
        mol = Chem.MolFromSmiles(smiles, sanitize=True)
    except Exception as e:
        out["error"] = _trim_error(str(e))
        return out
    if mol is None:
        out["error"] = "RDKit could not parse this SMILES"
        return out

    out["valid"] = True
    out["atom_count"] = mol.GetNumHeavyAtoms()
    try:
        out["canonical_smiles"] = Chem.MolToSmiles(mol, canonical=True)
    except Exception:
        pass

    # Fragment detection — frags is a list of disconnected molecules.
    try:
        frags = Chem.GetMolFrags(mol, asMols=True, sanitizeFrags=False)
        out["fragment_count"] = len(frags)
        if len(frags) > 1:
            largest = max(frags, key=lambda m: m.GetNumHeavyAtoms())
            try:
                largest_smi = Chem.MolToSmiles(largest, canonical=True)
                out["largest_fragment"] = {
                    "smiles": largest_smi,
                    "atom_count": largest.GetNumHeavyAtoms(),
                }
            except Exception:
                pass
    except Exception:
        pass

    # 2D depiction — small SVG inline. We keep stroke widths tight so
    # the molecule is legible at thumbnail size. PNG would be smaller
    # but SVG scales for retina + dark-mode-aware text styling later.
    try:
        drawer = rdMolDraw2D.MolDraw2DSVG(w, h)
        opts = drawer.drawOptions()
        opts.bondLineWidth = 1.4
        opts.padding = 0.05
        # Transparent background so the host card colors show through.
        drawer.DrawMolecule(mol)
        drawer.FinishDrawing()
        svg = drawer.GetDrawingText()
        # Strip xml prolog so the SVG can be inlined directly.
        if svg.startswith("<?xml"):
            svg = svg.split("?>", 1)[-1].lstrip()
        out["svg"] = svg
    except Exception as e:
        log.debug("SVG render failed for %s: %s", smiles[:40], e)

    if embed:
        # Cheap 3D embed sanity check. Same call the runner makes; if
        # this fails, the docking pipeline will too. Tight maxAttempts
        # because we're doing this synchronously at submit time and
        # users are waiting.
        try:
            mol_h = Chem.AddHs(mol)
            r = AllChem.EmbedMolecule(mol_h, maxAttempts=10, randomSeed=0xF00D)
            out["embed_ok"] = (r >= 0)
            if r < 0:
                out["embed_error"] = (
                    "RDKit couldn't embed this molecule in 3D — the docking "
                    "pipeline would fail at ligand prep. Most common causes: "
                    "very large rings, unusual valences, or disconnected fragments."
                )
        except Exception as e:
            out["embed_ok"] = False
            out["embed_error"] = _trim_error(str(e))

    # Suppress unused-import warning for lazy-loaded path; keeps Draw
    # in scope for future depiction tweaks (e.g. atom labels).
    _ = Draw
    return out


@router.post("/inspect-smiles", response_model=SmilesInspectOut)
def inspect_smiles(payload: SmilesInspectIn) -> SmilesInspectOut:
    """Parse, depict, and (optionally) 3D-embed-check a SMILES.

    Backs the New-job form's inline MoleculePreview. Single round-trip
    returns the parse verdict, a 2D SVG depiction, fragment metadata,
    and an optional 3D embedding sanity check. The frontend debounces
    typing-mode calls (embed_check=false) at ~400ms and switches to
    embed_check=true at submit time."""
    smi = (payload.smiles or "").strip()
    if not smi:
        return SmilesInspectOut(valid=False, error="empty SMILES")
    if len(smi) > 1000:
        return SmilesInspectOut(valid=False, error=f"SMILES too long ({len(smi)} chars; max 1000)")
    width = max(80, min(400, int(payload.width)))
    height = max(60, min(300, int(payload.height)))
    data = _inspect_cached(smi, bool(payload.embed_check), width, height)
    return SmilesInspectOut(**data)
