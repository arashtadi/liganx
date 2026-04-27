"""Autocomplete endpoints for the New Job form.

Two endpoints:

  * /suggest/pdb?q=...
      RCSB-backed PDB ID suggestions. Two paths:
      - Looks like a PDB ID (4 chars, alnum) → fetch the entry title to confirm
        + return one result.
      - Free text (e.g. "EGFR", "kras") → RCSB full-text search → top N entries
        with their titles.

  * /suggest/mutations?q=...&gene=EGFR
      Curated cancer-mutation list. Filtered by prefix match on the query.
      When `gene` is provided, mutations on that gene are boosted to the top
      so they show up first.

Both endpoints degrade gracefully — RCSB is best-effort, and the curated list
is local so it can't fail.
"""

import logging
from urllib.parse import quote

import httpx
from fastapi import APIRouter

router = APIRouter(prefix="/suggest", tags=["suggest"])
log = logging.getLogger(__name__)

# RCSB Search v2 — free-text and structure-attribute queries
RCSB_SEARCH = "https://search.rcsb.org/rcsbsearch/v2/query"
# RCSB Data API — fetch metadata (title, etc.) for a given PDB ID
RCSB_ENTRY = "https://data.rcsb.org/rest/v1/core/entry"


# ─── PDB suggest ──────────────────────────────────────────────────────────

@router.get("/pdb")
async def suggest_pdb(q: str, limit: int = 8) -> dict:
    """Return up to `limit` candidate PDB entries matching `q`.

    Each entry is `{pdb_id, title}`. Empty list on any failure — the form must
    keep working even when RCSB is down.
    """
    query = q.strip()
    if not query or len(query) < 2:
        return {"query": query, "suggestions": []}
    limit = max(1, min(20, limit))

    # Path 1: looks like a PDB ID (4 chars, alnum) → confirm + show title
    if len(query) == 4 and query.isalnum():
        info = await _fetch_entry_title(query.upper())
        if info:
            return {"query": query, "suggestions": [info]}
        # Fall through to text search if exact ID lookup misses

    # Path 2: free-text search, but biased toward what's actually useful for
    # docking: protein structures with at least one bound non-polymer ligand.
    # Without these filters, an "EGFR" search returns mostly antibody Fabs,
    # nanobodies, and even G-quadruplex DNA — none of which the user can dock.
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(
                RCSB_SEARCH,
                json={
                    "query": {
                        "type": "group",
                        "logical_operator": "and",
                        "nodes": [
                            # Free-text match (the original intent)
                            {
                                "type": "terminal",
                                "service": "full_text",
                                "parameters": {"value": query},
                            },
                            # Filter: must have protein polymer entities
                            {
                                "type": "terminal",
                                "service": "text",
                                "parameters": {
                                    "operator": "exact_match",
                                    "value": "Protein (only)",
                                    "attribute": "rcsb_entry_info.selected_polymer_entity_types",
                                },
                            },
                            # Filter: must have at least one bound non-polymer ligand
                            # (this excludes apo structures that aren't useful for docking)
                            {
                                "type": "terminal",
                                "service": "text",
                                "parameters": {
                                    "operator": "greater",
                                    "value": 0,
                                    "attribute": "rcsb_entry_info.deposited_nonpolymer_entity_instance_count",
                                },
                            },
                        ],
                    },
                    "return_type": "entry",
                    "request_options": {
                        "paginate": {"start": 0, "rows": limit},
                        "results_content_type": ["experimental"],
                        # Sort by resolution ascending — better-resolved structures first
                        "sort": [
                            {"sort_by": "rcsb_entry_info.resolution_combined", "direction": "asc"},
                        ],
                    },
                },
            )
        if r.status_code != 200:
            return {"query": query, "suggestions": []}
        data = r.json()
        ids = [hit["identifier"] for hit in data.get("result_set", [])][:limit]
    except (httpx.HTTPError, ValueError, KeyError) as e:
        log.warning("PDB suggest failed for %r: %s", query, e)
        return {"query": query, "suggestions": []}

    if not ids:
        return {"query": query, "suggestions": []}

    # Resolve titles in parallel — bounded by `limit` so it's cheap
    suggestions = await _fetch_titles_bulk(ids)
    return {"query": query, "suggestions": suggestions}


async def _fetch_entry_title(pdb_id: str) -> dict | None:
    """Single-entry lookup. Returns None if RCSB doesn't know this PDB ID."""
    url = f"{RCSB_ENTRY}/{quote(pdb_id)}"
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.get(url)
        if r.status_code != 200:
            return None
        data = r.json()
        title = (data.get("struct", {}) or {}).get("title", "")
        return {"pdb_id": pdb_id, "title": title or "(no title)"}
    except (httpx.HTTPError, ValueError) as e:
        log.warning("PDB entry fetch failed for %s: %s", pdb_id, e)
        return None


async def _fetch_titles_bulk(pdb_ids: list[str]) -> list[dict]:
    """Fetch titles for a batch of PDB IDs. Skips any that fail.
    Concurrent (not sequential) to keep the autocomplete snappy."""
    import asyncio

    async def one(client: httpx.AsyncClient, pid: str) -> dict:
        try:
            r = await client.get(f"{RCSB_ENTRY}/{quote(pid)}")
            if r.status_code != 200:
                return {"pdb_id": pid, "title": ""}
            title = (r.json().get("struct", {}) or {}).get("title", "")
            return {"pdb_id": pid, "title": title or "(no title)"}
        except (httpx.HTTPError, ValueError):
            return {"pdb_id": pid, "title": ""}

    async with httpx.AsyncClient(timeout=4.0) as client:
        return await asyncio.gather(*(one(client, pid) for pid in pdb_ids))


# ─── Mutation suggest ─────────────────────────────────────────────────────

# Curated clinical/cancer mutation library. Keep this list focused on
# *therapeutically actionable* mutations — the kind that show up in oncology
# clinical trials, FDA labels, and resistance papers.
#
# Format: (code, gene, note)
CURATED_MUTATIONS: list[tuple[str, str, str]] = [
    # EGFR — NSCLC
    ("T790M",  "EGFR", "gatekeeper, 1st-gen TKI resistance"),
    ("L858R",  "EGFR", "activating, sensitizing"),
    ("C797S",  "EGFR", "osimertinib resistance"),
    ("G719S",  "EGFR", "exon 18 activating"),
    ("L792H",  "EGFR", "solvent-front 3rd-gen resistance"),
    ("E746_A750del", "EGFR", "exon 19 deletion"),
    ("S768I",  "EGFR", "uncommon activating"),
    # KRAS — pan-cancer
    ("G12C",   "KRAS", "covalent target (sotorasib, adagrasib)"),
    ("G12D",   "KRAS", "PDAC, CRC most common"),
    ("G12V",   "KRAS", "PDAC, CRC"),
    ("G12R",   "KRAS", "PDAC"),
    ("G13D",   "KRAS", "CRC"),
    ("Q61H",   "KRAS", "GTPase-impaired"),
    ("Q61K",   "KRAS", "melanoma, thyroid"),
    ("Q61R",   "KRAS", "melanoma"),
    # BRAF — melanoma, CRC
    ("V600E",  "BRAF", "vemurafenib/dabrafenib target"),
    ("V600K",  "BRAF", "second-most-common BRAF activating"),
    ("V600D",  "BRAF", "rare activating"),
    ("L597R",  "BRAF", "non-V600 activating"),
    # ALK — NSCLC
    ("L1196M", "ALK",  "crizotinib gatekeeper resistance"),
    ("G1202R", "ALK",  "lorlatinib-resistance solvent-front"),
    ("F1174L", "ALK",  "neuroblastoma"),
    ("R1275Q", "ALK",  "neuroblastoma activating"),
    # ROS1 — NSCLC
    ("G2032R", "ROS1", "crizotinib solvent-front resistance"),
    ("D2033N", "ROS1", "lorlatinib resistance"),
    # MET — NSCLC
    ("D1228N", "MET",  "type-I TKI resistance"),
    ("Y1230C", "MET",  "type-I TKI resistance"),
    # ABL1 — CML
    ("T315I",  "ABL1", "imatinib gatekeeper, ponatinib target"),
    ("E255K",  "ABL1", "P-loop, imatinib resistance"),
    ("F317L",  "ABL1", "imatinib resistance"),
    # BTK — CLL
    ("C481S",  "BTK",  "ibrutinib covalent escape"),
    # FLT3 — AML
    ("D835Y",  "FLT3", "TKD activating"),
    ("F691L",  "FLT3", "gilteritinib gatekeeper resistance"),
    # IDH1 — AML, glioma
    ("R132H",  "IDH1", "neomorphic, ivosidenib target"),
    ("R132C",  "IDH1", "AML"),
    ("R132G",  "IDH1", "glioma"),
    # IDH2
    ("R140Q",  "IDH2", "AML, enasidenib target"),
    ("R172K",  "IDH2", "AML"),
    # PI3K — breast, gynae
    ("H1047R", "PIK3CA", "kinase domain activating"),
    ("E545K",  "PIK3CA", "helical domain activating"),
    ("E542K",  "PIK3CA", "helical domain activating"),
    # KIT — GIST
    ("D816V",  "KIT",   "imatinib resistance, mastocytosis"),
    ("V559D",  "KIT",   "GIST exon 11"),
    ("N822K",  "KIT",   "AML"),
    # HER2 / ERBB2
    ("V842I",  "HER2",  "kinase domain"),
    ("L755S",  "HER2",  "lapatinib resistance"),
    # TP53 — pan-cancer hotspots (informational; not a typical docking target)
    ("R175H",  "TP53",  "DNA contact, gain-of-function"),
    ("R248Q",  "TP53",  "DNA contact"),
    ("R273H",  "TP53",  "DNA contact"),
]


@router.get("/mutations")
def suggest_mutations(
    q: str = "", gene: str | None = None, limit: int = 10,
) -> dict:
    """Return clinical mutation suggestions matching `q` (prefix or substring).

    When `gene` is given (e.g. "EGFR"), mutations on that gene rank first.
    Empty `q` returns gene-only matches (or first N if no gene either) — useful
    for showing the picker on focus before the user has typed anything.
    """
    query = q.strip().upper()
    gene_norm = (gene or "").strip().upper() or None
    limit = max(1, min(30, limit))

    def matches(code: str) -> bool:
        if not query:
            return True
        # Prefer prefix match, but allow substring (e.g. "790" matches T790M)
        return code.upper().startswith(query) or query in code.upper()

    # Score: 0 = on requested gene + prefix match
    #        1 = on requested gene
    #        2 = prefix match on any gene
    #        3 = substring match on any gene
    scored: list[tuple[int, dict]] = []
    for code, mgene, note in CURATED_MUTATIONS:
        if not matches(code):
            continue
        is_gene = gene_norm is not None and mgene == gene_norm
        is_prefix = bool(query) and code.upper().startswith(query)
        if is_gene and is_prefix:
            score = 0
        elif is_gene:
            score = 1
        elif is_prefix:
            score = 2
        else:
            score = 3
        scored.append((score, {"code": code, "gene": mgene, "note": note}))

    scored.sort(key=lambda x: (x[0], x[1]["code"]))
    suggestions = [item for _, item in scored[:limit]]
    return {"query": q, "gene": gene, "suggestions": suggestions}
