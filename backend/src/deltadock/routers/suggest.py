"""Autocomplete endpoints for the New Job form.

Two endpoints:

  * /suggest/pdb?q=...
      RCSB-backed PDB ID suggestions. Two paths:
      - Looks like a PDB ID (4 chars, alnum) → fetch the entry title to confirm
        + return one result.
      - Free text (e.g. "EGFR", "kras") → RCSB full-text search → top N entries
        with their titles.

  * /suggest/mutations?q=...&gene=EGFR&uniprot_id=P00533
      Three-source mutation suggestions:
      1. Curated clinical/cancer hotspot list (local, ~80 entries) — instant.
      2. UniProt annotated natural variants (when uniprot_id given) — disease-
         associated SAVs from EBI Proteins API.
      3. cBioPortal cancer-cohort hotspots (when gene given) — top recurrent
         protein-level mutations across all studies.

      Sources are deduped by code, ranked curated > UniProt > cBioPortal, and
      cached in-memory for 24h to keep autocomplete snappy and avoid hammering
      external APIs.

All endpoints degrade gracefully — every external call is best-effort. If
UniProt or cBioPortal is down, the curated list still works.
"""

import asyncio
import logging
import time
from urllib.parse import quote

import httpx
from fastapi import APIRouter

router = APIRouter(prefix="/suggest", tags=["suggest"])
log = logging.getLogger(__name__)

# In-process cache for external mutation sources. 24h TTL is fine: UniProt
# annotations move on weekly cycles, cBioPortal hotspot frequencies change
# slowly. Cache key is (source, identifier). Eviction is lazy on read.
_EXT_CACHE: dict[tuple[str, str], tuple[float, list[dict]]] = {}
_EXT_CACHE_TTL_SEC = 24 * 60 * 60


def _cache_get(source: str, key: str) -> list[dict] | None:
    entry = _EXT_CACHE.get((source, key))
    if not entry:
        return None
    ts, val = entry
    if time.time() - ts > _EXT_CACHE_TTL_SEC:
        _EXT_CACHE.pop((source, key), None)
        return None
    return val


def _cache_put(source: str, key: str, val: list[dict]) -> None:
    _EXT_CACHE[(source, key)] = (time.time(), val)

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
    # JAK2 — myeloproliferative neoplasms
    ("V617F",  "JAK2",  "constitutive activation, MPN driver"),
    ("R683G",  "JAK2",  "B-ALL pseudokinase domain"),
    # FGFR3 — bladder cancer, achondroplasia
    ("K650E",  "FGFR3", "thanatophoric dysplasia, activating"),
    ("S249C",  "FGFR3", "bladder cancer hotspot"),
    ("Y373C",  "FGFR3", "bladder cancer activating"),
    # FGFR2 — endometrial, cholangiocarcinoma
    ("N549K",  "FGFR2", "endometrial activating"),
    ("K659E",  "FGFR2", "kinase domain"),
    # MEK / MAP2K1 — RASopathies, tumor
    ("Q56P",   "MAP2K1", "uveal melanoma activating"),
    ("K57N",   "MAP2K1", "histiocytosis"),
    # ───── Neurological / Parkinson's / Alzheimer's ─────
    ("G2019S", "LRRK2", "Parkinson's, kinase activating"),
    ("R1441C", "LRRK2", "Parkinson's, ROC domain"),
    ("R1441G", "LRRK2", "Parkinson's, ROC domain"),
    ("A53T",   "SNCA",  "alpha-synuclein, familial Parkinson's"),
    ("E46K",   "SNCA",  "alpha-synuclein, familial Parkinson's"),
    ("V717I",  "APP",   "Alzheimer's, London mutation"),
    # Huntington's — repeat expansion in HTT, no point mutations dock-relevant
    # ───── Cystic fibrosis ─────
    ("F508del", "CFTR", "most common CF allele, processing defect"),
    ("G551D",   "CFTR", "gating defect, ivacaftor target"),
    ("G542X",   "CFTR", "premature stop, class I"),
    ("R117H",   "CFTR", "residual function, mild CF"),
    # ───── Hemoglobinopathies ─────
    ("E6V",    "HBB",   "sickle cell anemia, HbS"),
    ("E6K",    "HBB",   "HbC, hemoglobin C disease"),
    # ───── Infectious disease — HIV protease / RT ─────
    ("D30N",   "HIV-PR", "nelfinavir resistance"),
    ("V82A",   "HIV-PR", "PI multi-resistance"),
    ("L90M",   "HIV-PR", "saquinavir/indinavir resistance"),
    ("I84V",   "HIV-PR", "broad PI resistance"),
    ("M184V",  "HIV-RT", "lamivudine/emtricitabine resistance"),
    ("K103N",  "HIV-RT", "NNRTI cross-resistance"),
    # ───── SARS-CoV-2 main protease ─────
    ("E166V",   "MPRO",  "nirmatrelvir resistance"),
    ("S144A",   "MPRO",  "nirmatrelvir-resistance pathway"),
    ("T21I",    "MPRO",  "compensatory in resistance lineages"),
    # ───── Cardiovascular / metabolic ─────
    ("D374Y",  "PCSK9", "gain-of-function, hypercholesterolemia"),
    ("R46L",   "PCSK9", "loss-of-function, low LDL"),
    # ───── Other actionable rare-disease / inflammation ─────
    ("V433A",  "DDR1",  "fibrosis-associated"),
    ("M918T",  "RET",   "MEN2B, medullary thyroid"),
    ("C634R",  "RET",   "MEN2A, familial medullary thyroid"),
    ("V804M",  "RET",   "vandetanib gatekeeper resistance"),
    ("V804L",  "RET",   "selpercatinib resistance"),
    # ───── NTRK1/2/3 — solvent-front resistance ─────
    ("G595R",  "NTRK1", "larotrectinib solvent-front resistance"),
    ("G623R",  "NTRK3", "entrectinib solvent-front resistance"),
]


# EBI Proteins API — annotated natural variants for a UniProt accession
EBI_VARIATION = "https://www.ebi.ac.uk/proteins/api/variation"

# cBioPortal public REST — pan-cancer mutation hotspots by gene
# (no auth, ~50 req/sec rate limit, ToS allows research use)
CBIOPORTAL_API = "https://www.cbioportal.org/api"

# 1-letter → 3-letter amino acid (for parsing UniProt variant entries)
_AA1 = {
    "A", "C", "D", "E", "F", "G", "H", "I", "K", "L",
    "M", "N", "P", "Q", "R", "S", "T", "V", "W", "Y",
}


async def _fetch_uniprot_variants(uniprot_id: str) -> list[dict]:
    """Pull annotated natural variants (single-AA substitutions) from EBI.

    Filters to disease-associated entries with a clean WT/MUT/position triple
    so we can synthesize a Vina-style mutation code. Returns [] on any error
    (network, parse, missing field) — the curated list still serves the user.
    """
    cached = _cache_get("uniprot", uniprot_id)
    if cached is not None:
        return cached
    url = f"{EBI_VARIATION}/{quote(uniprot_id)}"
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.get(url, headers={"Accept": "application/json"})
        if r.status_code != 200:
            _cache_put("uniprot", uniprot_id, [])
            return []
        data = r.json()
    except (httpx.HTTPError, ValueError) as e:
        log.warning("UniProt variation fetch failed for %s: %s", uniprot_id, e)
        return []

    out: list[dict] = []
    seen: set[str] = set()
    # EBI shape: top-level dict with `features: [{wildType, mutatedType,
    # begin, end, association: [{disease, ...}], clinicalSignificances: [...]}, ...]`.
    # The full feed is enormous (5k+ entries for EGFR, mostly raw ClinVar dumps
    # of "uncertain significance"). Filter aggressively to disease-associated
    # actionable variants.
    features = data.get("features") or []
    for f in features:
        wt = (f.get("wildType") or "").strip()
        mut = (f.get("mutatedType") or "").strip()
        begin = f.get("begin")
        end = f.get("end")
        # Single-residue substitutions only — skip indels/frameshifts (PDBFixer
        # only handles point mutations cleanly).
        if not wt or not mut or wt == mut:
            continue
        if wt not in _AA1 or mut not in _AA1:
            continue
        if begin != end or not begin:
            continue
        try:
            pos = int(begin)
        except (TypeError, ValueError):
            continue

        # Qualification gate: only admit variants with a *positive* actionable
        # clinical significance. EBI's full feed has 5000+ entries per gene
        # (mostly "Variant of uncertain significance" ClinVar dumps + benign
        # population variants); we want the few hundred that are actually
        # disease-relevant. Whitelist trumps blacklist here because EBI keeps
        # adding new "Uncertain" variants.
        ACTIONABLE = {
            "pathogenic", "likely pathogenic",
            "disease", "association", "drug response", "risk factor",
            "confers susceptibility",
        }
        diseases = [
            (a.get("name") or "").strip()
            for a in (f.get("association") or [])
            if a.get("name")
        ]
        sig_types = [
            (s.get("type") or "").strip().lower()
            for s in (f.get("clinicalSignificances") or [])
            if s.get("type")
        ]
        # Match an actionable label by substring so "Likely pathogenic /
        # uncertain" composites still count.
        actionable_hit = next(
            (t for t in sig_types if any(a in t for a in ACTIONABLE)),
            None,
        )
        if not actionable_hit:
            # No clinical significance — fall back to admitting variants that
            # come from a curated source AND have a named disease.
            source_type = (f.get("sourceType") or "").strip().lower()
            if source_type != "uniprot" or not diseases:
                continue

        code = f"{wt}{pos}{mut}"
        if code in seen:
            continue
        seen.add(code)

        # Build a compact note: disease name + actionable significance, e.g.
        # "Lung cancer — pathogenic"
        note_parts: list[str] = []
        if diseases:
            note_parts.append(diseases[0])
        if actionable_hit:
            note_parts.append(actionable_hit)
        note = " — ".join(note_parts) or "natural variant"
        out.append({"code": code, "gene": uniprot_id, "note": note,
                    "source": "uniprot"})

    _cache_put("uniprot", uniprot_id, out)
    return out


async def _fetch_cbioportal_hotspots(gene: str) -> list[dict]:
    """Pull recurrent protein-level mutations for a gene from cBioPortal.

    Strategy: use the `/api/mutations/fetch` endpoint scoped to the
    pan-cancer MSK-IMPACT cohort (~10k tumor samples, dense genomic
    coverage). We aggregate by proteinChange and rank by recurrence count.
    Returns [] on any error.
    """
    gene_u = (gene or "").strip().upper()
    if not gene_u:
        return []
    cached = _cache_get("cbioportal", gene_u)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            # 1) Resolve gene symbol → entrezGeneId
            gr = await client.get(f"{CBIOPORTAL_API}/genes/{quote(gene_u)}")
            if gr.status_code != 200:
                _cache_put("cbioportal", gene_u, [])
                return []
            entrez = gr.json().get("entrezGeneId")
            if not entrez:
                _cache_put("cbioportal", gene_u, [])
                return []

            # 2) Pull mutations from a broad pan-cancer profile.
            # `msk_impact_2017_mutations` is large, public, and dense.
            # Use DETAILED projection so the proteinChange field is populated
            # — `projection=ID` returns only IDs and we get nothing to rank by.
            mr = await client.post(
                f"{CBIOPORTAL_API}/mutations/fetch",
                params={"projection": "DETAILED"},
                json={
                    "entrezGeneIds": [entrez],
                    "molecularProfileIds": ["msk_impact_2017_mutations"],
                },
            )
        if mr.status_code != 200:
            _cache_put("cbioportal", gene_u, [])
            return []
        muts = mr.json() or []
    except (httpx.HTTPError, ValueError) as e:
        log.warning("cBioPortal fetch failed for %s: %s", gene_u, e)
        return []

    # Aggregate: count occurrences of each protein-level change.
    counts: dict[str, int] = {}
    for m in muts:
        pc = (m.get("proteinChange") or "").strip()
        if not pc:
            continue
        # Normalize: strip any "p." prefix; keep WT-pos-MUT shape
        if pc.startswith("p."):
            pc = pc[2:]
        # Heuristic: must look like a single-AA substitution (V600E etc.).
        # Skip splice/fusion/silent.
        if len(pc) < 3 or not pc[0].isalpha() or not pc[-1].isalpha():
            continue
        if not pc[1:-1].isdigit():
            continue
        if pc[0].upper() not in _AA1 or pc[-1].upper() not in _AA1:
            continue
        if pc[0].upper() == pc[-1].upper():
            continue  # silent
        counts[pc.upper()] = counts.get(pc.upper(), 0) + 1

    # Take top 30, sort by recurrence desc
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:30]
    out = [
        {"code": code, "gene": gene_u, "note": f"cBioPortal: {n}× recurrent",
         "source": "cbioportal"}
        for code, n in ranked
    ]
    _cache_put("cbioportal", gene_u, out)
    return out


@router.get("/mutations")
async def suggest_mutations(
    q: str = "",
    gene: str | None = None,
    uniprot_id: str | None = None,
    limit: int = 10,
) -> dict:
    """Return mutation suggestions from curated + UniProt + cBioPortal sources.

    Args:
      q: query string. Prefix or substring match on the mutation code.
      gene: gene symbol (e.g. "EGFR"). Boosts curated entries on this gene
        and triggers a cBioPortal hotspot lookup.
      uniprot_id: UniProt accession (e.g. "P00533"). Triggers an EBI variation
        lookup for annotated natural variants.
      limit: max results, 1–30.

    Empty `q` returns gene/uniprot-scoped matches first — useful for showing
    the picker on focus before the user has typed.
    """
    query = q.strip().upper()
    gene_norm = (gene or "").strip().upper() or None
    uniprot_norm = (uniprot_id or "").strip().upper() or None
    limit = max(1, min(30, limit))

    def matches(code: str) -> bool:
        if not query:
            return True
        # Prefer prefix match, but allow substring (e.g. "790" matches T790M)
        return code.upper().startswith(query) or query in code.upper()

    # ── Source 1: curated (local) ────────────────────────────────────────
    curated_items: list[dict] = []
    for code, mgene, note in CURATED_MUTATIONS:
        if not matches(code):
            continue
        curated_items.append({"code": code, "gene": mgene, "note": note,
                              "source": "curated"})

    # ── Sources 2 & 3 in parallel — fire only when we have an identifier ──
    tasks = []
    if uniprot_norm:
        tasks.append(_fetch_uniprot_variants(uniprot_norm))
    if gene_norm:
        tasks.append(_fetch_cbioportal_hotspots(gene_norm))
    external: list[list[dict]] = []
    if tasks:
        try:
            external = await asyncio.gather(*tasks, return_exceptions=False)
        except Exception as e:  # gather shouldn't raise w/ return_exceptions=False, but belt&braces
            log.warning("external mutation fetch failed: %s", e)
            external = []

    uniprot_items: list[dict] = external[0] if uniprot_norm and external else []
    cbio_offset = 1 if uniprot_norm else 0
    cbio_items: list[dict] = (
        external[cbio_offset] if gene_norm and len(external) > cbio_offset else []
    )

    # Apply query filter to external sources too
    uniprot_items = [m for m in uniprot_items if matches(m["code"])]
    cbio_items = [m for m in cbio_items if matches(m["code"])]

    # ── Score + dedupe ────────────────────────────────────────────────────
    # Score lower = better. Curated > UniProt > cBioPortal.
    # Within each tier, gene-match and prefix-match further boost.
    def score(item: dict) -> tuple[int, str]:
        src = item.get("source", "curated")
        is_gene = gene_norm is not None and (
            item["gene"] == gene_norm or item["gene"] == uniprot_norm
        )
        is_prefix = bool(query) and item["code"].upper().startswith(query)
        if src == "curated":
            base = 0
        elif src == "uniprot":
            base = 10
        else:  # cbioportal
            base = 20
        # Boost: gene match -2, prefix match -1
        boost = 0
        if is_gene:
            boost -= 2
        if is_prefix:
            boost -= 1
        return (base + boost, item["code"])

    seen_codes: set[str] = set()
    merged: list[tuple[tuple[int, str], dict]] = []
    for pool in (curated_items, uniprot_items, cbio_items):
        for item in pool:
            code_u = item["code"].upper()
            if code_u in seen_codes:
                continue
            seen_codes.add(code_u)
            merged.append((score(item), item))

    merged.sort(key=lambda x: x[0])
    suggestions = [item for _, item in merged[:limit]]
    return {
        "query": q,
        "gene": gene,
        "uniprot_id": uniprot_id,
        "suggestions": suggestions,
    }
