"""Compound name → SMILES lookup via PubChem REST.

PubChem's PUG REST API is free, unauthenticated, and has no rate limit on
modest use. We hit:

  /compound/name/{name}/property/CanonicalSMILES,IUPACName,MolecularFormula/JSON

If multiple matches exist, PubChem returns them all; we just take the first
(which is the highest-relevance compound).
"""

import logging
from urllib.parse import quote

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile

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


@router.post("/pdb/upload")
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
    pdb_root = _Path.home() / ".deltadock" / "pdb"
    pdb_root.mkdir(parents=True, exist_ok=True)
    out_path = pdb_root / f"{pdb_id}.pdb"
    out_path.write_text(text)
    log.info("Stored uploaded PDB %s (%d bytes, chains=%s)", pdb_id, len(raw), ",".join(chains))

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
