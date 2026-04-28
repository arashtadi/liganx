"""Find alternative PDB structures that cover a residue the user wants to mutate.

Use case: a user submits Y1230H against 2WGJ chain A, but the activation loop
including residue 1230 is disordered and missing from 2WGJ's coordinates. We
catch this in pre-flight validation (prep.validate_mutations) and want to
suggest a one-click pivot — "try 4MXC, it has residue 1230 modeled".

Approach:

  1. Find every PDB entry annotated with the user's UniProt accession.
     RCSB exposes this via the data API — `core/uniprot/{acc}` returns
     a list of entries that map to that UniProt.
  2. For each entry's polymer entity, the PDBX_POLY_SEQ_SCHEME mapping (we
     don't fetch this directly — too many round trips) tells us which
     UniProt residues are modeled. Instead, we use a faster proxy: pull
     each candidate's ATOM-record range from a low-cost data API call,
     filter to those covering the desired residue, and rank by resolution.

  3. We exclude the user's current PDB from the suggestions (they already
     know it doesn't work), and cap the output at a small number so the
     UI doesn't drown them in choices.

Caching: the (uniprot, residue) → suggestions tuple is small and stable on a
weekly timescale. We cache in-memory with a 24h TTL — the lookup is in the
hot path of submit error rendering, but a stale cache doesn't break anything,
it just shows yesterday's "best" structures (still good ones).

When the lookup fails for any reason (RCSB is down, network blip, malformed
JSON, no UniProt match), we return an empty list — the caller falls back to
the bare validation error message without alternatives.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

log = logging.getLogger(__name__)

# RCSB endpoints
# - Search API: the only public endpoint that maps a UniProt accession to PDB
#   polymer entities. The data API's `core/uniprot/{rcsb_id}` takes RCSB's own
#   internal UniProt-row ID, NOT a UniProt accession, so it's the wrong tool.
# - Data API GraphQL: takes a list of entity / entry IDs and returns their
#   alignments, titles, and resolutions in one round trip.
_SEARCH_URL = "https://search.rcsb.org/rcsbsearch/v2/query"
_GRAPHQL_URL = "https://data.rcsb.org/graphql"

# How many alternatives to surface to the user. More than ~5 is noise.
_MAX_SUGGESTIONS = 5

# Cap the GraphQL batch size — RCSB's API caps individual queries around 100
# entries; we stay well under to keep latency low (~0.5-1s per batch).
_GRAPHQL_BATCH = 50

# Networking knobs — keep tight so a slow RCSB doesn't stall submit responses.
# When this lookup is slow, the user experience is "submit takes 5s and tells
# me what's wrong with no suggestions" — still better than waiting 30s for FoldX
# to fail with no suggestions.
_HTTP_TIMEOUT_S = 6
_USER_AGENT = "Liganx/0.1 (https://liganx.com; mutation-aware docking)"

# Simple in-process TTL cache. Per-instance, fine for our scale (Fly machine
# fits the whole working set in memory, and Celery workers can each warm
# their own cache). Not Redis-backed because the savings are small (~2s on
# repeat lookups for the same uniprot+residue).
_CACHE: dict[tuple[str, int, str], tuple[float, list[dict]]] = {}
_CACHE_TTL_S = 24 * 3600


def find_alternative_pdbs(
    uniprot_id: str,
    residue: int,
    exclude_pdb: str | None = None,
) -> list[dict]:
    """Suggest PDB structures that contain `residue` for the given UniProt.

    Args:
        uniprot_id: e.g. "P08581" (c-MET) or "P00533" (EGFR).
        residue: UniProt-numbered residue position the user is trying to mutate.
        exclude_pdb: PDB ID currently selected by the user — drop from results.

    Returns:
        List of up to 5 dicts shaped like:
            {"pdb_id": "4MXC", "chain": "A", "title": "...",
             "resolution_A": 1.8, "covers_residue": True}
        Sorted by resolution (sharpest first). Empty list when we can't
        determine alternatives — the caller should treat that as "no
        suggestion" rather than as an error.
    """
    if not uniprot_id:
        return []

    excl = (exclude_pdb or "").upper()
    cache_key = (uniprot_id.upper(), int(residue), excl)
    cached = _CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < _CACHE_TTL_S:
        return cached[1]

    try:
        suggestions = _fetch_alternatives(uniprot_id, residue, excl)
    except Exception as e:
        # Any failure here is non-fatal — we just don't get to suggest
        # alternatives. Log and return empty.
        log.warning(
            "Alternative-PDB lookup failed for UniProt=%s residue=%s: %s",
            uniprot_id, residue, e,
        )
        suggestions = []

    _CACHE[cache_key] = (time.time(), suggestions)
    return suggestions


def _fetch_alternatives(uniprot_id: str, residue: int, exclude: str) -> list[dict]:
    headers = {"User-Agent": _USER_AGENT, "Accept": "application/json"}

    # Step 1: ask the Search API for every polymer entity annotated with this
    # UniProt accession. We use sequence-aligned UniProt mapping rather than
    # text search because RCSB's text-search may include entries that mention
    # the protein in their title but don't actually contain that sequence.
    search_body = {
        "query": {
            "type": "terminal",
            "service": "text",
            "parameters": {
                "attribute": (
                    "rcsb_polymer_entity_container_identifiers"
                    ".reference_sequence_identifiers.database_accession"
                ),
                "operator": "exact_match",
                "value": uniprot_id.upper(),
            },
        },
        "return_type": "polymer_entity",
        "request_options": {
            "paginate": {"start": 0, "rows": 100},
        },
    }
    r = requests.post(
        _SEARCH_URL, json=search_body, timeout=_HTTP_TIMEOUT_S, headers=headers
    )
    if r.status_code == 204:
        return []  # no hits
    if r.status_code != 200:
        log.info("RCSB search HTTP %s for UniProt %s", r.status_code, uniprot_id)
        return []
    body = r.json()
    entity_ids = [
        item["identifier"] for item in (body.get("result_set") or [])
        if isinstance(item, dict) and item.get("identifier")
    ]
    if not entity_ids:
        return []

    # Drop entities from the user's current PDB upfront so we don't waste
    # a round-trip getting alignment data for it.
    entity_ids = [
        eid for eid in entity_ids
        if eid.split("_", 1)[0].upper() != exclude
    ]
    if not entity_ids:
        return []

    # Step 2: GraphQL — for each polymer entity, fetch UniProt alignment +
    # parent entry's title/resolution + a representative chain ID. One round
    # trip for everything.
    enriched = _graphql_polymer_entities(
        entity_ids[:_GRAPHQL_BATCH], headers, uniprot_id, residue
    )

    # Step 3: rank by resolution (sharpest first). Entries without resolution
    # (NMR / EM-only / theoretical) sink to the bottom but stay listed.
    enriched.sort(
        key=lambda e: (
            e.get("resolution_A") if e.get("resolution_A") is not None else 99.0
        )
    )
    # Dedupe by PDB ID — we want one entry per structure even if multiple
    # polymer entities matched (e.g. a homodimer with two protein chains).
    seen: set[str] = set()
    deduped: list[dict] = []
    for e in enriched:
        pid = e["pdb_id"].upper()
        if pid in seen:
            continue
        seen.add(pid)
        deduped.append(e)

    return deduped[:_MAX_SUGGESTIONS]


def _graphql_polymer_entities(
    entity_ids: list[str],
    headers: dict[str, str],
    uniprot_id: str,
    residue: int,
) -> list[dict]:
    """One GraphQL call enriches polymer entities with everything we need.

    For each polymer entity (e.g. "4MXC_1") we pull:
      - The parent entry's title + resolution
      - The UniProt sequence alignment (rcsb_polymer_entity_align) so we
        can confirm the chain actually covers the requested residue
      - A representative auth_asym_id (PDB-numbered chain ID) from the
        polymer entity's instances

    Entities whose alignment doesn't cover the residue are dropped here
    rather than at the API level — RCSB's search returns every entity
    annotated with the UniProt, but truncated constructs may not include
    the residue we care about.

    The UniProt residue index is mapped to the entity's auth-numbered
    range via `aligned_regions[*].entity_beg_seq_id` / `ref_beg_seq_id` /
    `length`. We compute "this entity covers the UniProt residue R" as:
        any region where ref_beg <= R <= ref_beg + length - 1
    """
    # Note: rcsb_polymer_entity_align is a list — one entry per database
    # mapping (UniProt, GenBank, etc). We filter to UniProt by name below.
    query = """
    query AlternativeEntities($ids: [String!]!) {
      polymer_entities(entity_ids: $ids) {
        rcsb_id
        rcsb_polymer_entity_container_identifiers {
          entry_id
        }
        rcsb_polymer_entity_align {
          reference_database_name
          reference_database_accession
          aligned_regions {
            entity_beg_seq_id
            ref_beg_seq_id
            length
          }
        }
        polymer_entity_instances {
          rcsb_polymer_entity_instance_container_identifiers {
            auth_asym_id
          }
        }
      }
    }
    """
    payload: dict[str, Any] = {"query": query, "variables": {"ids": entity_ids}}
    r = requests.post(
        _GRAPHQL_URL, json=payload, timeout=_HTTP_TIMEOUT_S, headers=headers
    )
    if r.status_code != 200:
        log.info("RCSB graphql polymer_entities HTTP %s", r.status_code)
        return []
    body = r.json()
    entities = (body.get("data") or {}).get("polymer_entities") or []

    # Collect distinct PDB entry IDs we need follow-up metadata for.
    candidates: list[dict] = []
    pdb_ids_to_lookup: set[str] = set()
    for ent in entities:
        if not ent:
            continue
        # Verify the entity covers the requested UniProt residue. Multiple
        # alignments can be annotated per entity; pick the UniProt one
        # matching our accession.
        aligns = ent.get("rcsb_polymer_entity_align") or []
        covers = False
        for a in aligns:
            if (a.get("reference_database_name") or "").upper() != "UNIPROT":
                continue
            if (a.get("reference_database_accession") or "").upper() != uniprot_id.upper():
                continue
            for rg in a.get("aligned_regions") or []:
                ref_beg = rg.get("ref_beg_seq_id") or 0
                length = rg.get("length") or 0
                if ref_beg <= residue <= ref_beg + length - 1:
                    covers = True
                    break
            if covers:
                break
        if not covers:
            continue

        ids = ent.get("rcsb_polymer_entity_container_identifiers") or {}
        pdb_id = (ids.get("entry_id") or "").upper()
        if not pdb_id:
            continue
        # First chain ID we see is fine — kinase structures typically have
        # one chain or two homologous chains; the user can swap if needed.
        chain_id: str | None = None
        for inst in ent.get("polymer_entity_instances") or []:
            xs = inst.get("rcsb_polymer_entity_instance_container_identifiers") or {}
            aid = xs.get("auth_asym_id")
            if aid:
                chain_id = aid
                break
        if not chain_id:
            continue
        candidates.append({"pdb_id": pdb_id, "chain": chain_id})
        pdb_ids_to_lookup.add(pdb_id)

    if not candidates:
        return []

    # One more GraphQL call to fetch title + resolution for the parent
    # entries. Could be merged into the polymer_entity query above with
    # a nested `entry { ... }` selector — RCSB supports that — but the
    # nested form occasionally returns nulls for the parent fields when
    # the entity GraphQL endpoint is under load. A second call is safer.
    meta = _graphql_entry_meta(sorted(pdb_ids_to_lookup), headers)
    out: list[dict] = []
    for c in candidates:
        m = meta.get(c["pdb_id"], {})
        out.append({
            "pdb_id": c["pdb_id"],
            "chain": c["chain"],
            "title": m.get("title") or c["pdb_id"],
            "resolution_A": m.get("resolution_A"),
        })
    return out


def _graphql_entry_meta(
    pdb_ids: list[str], headers: dict[str, str]
) -> dict[str, dict[str, Any]]:
    """Return {pdb_id: {title, resolution_A}} for a batch of PDB entries."""
    if not pdb_ids:
        return {}
    query = """
    query EntryMeta($ids: [String!]!) {
      entries(entry_ids: $ids) {
        rcsb_id
        struct { title }
        rcsb_entry_info { resolution_combined }
      }
    }
    """
    payload: dict[str, Any] = {"query": query, "variables": {"ids": pdb_ids}}
    r = requests.post(
        _GRAPHQL_URL, json=payload, timeout=_HTTP_TIMEOUT_S, headers=headers
    )
    if r.status_code != 200:
        return {}
    body = r.json()
    out: dict[str, dict[str, Any]] = {}
    for e in (body.get("data") or {}).get("entries") or []:
        if not e:
            continue
        pid = (e.get("rcsb_id") or "").upper()
        if not pid:
            continue
        title = ((e.get("struct") or {}).get("title") or "").strip() or pid
        res_list = (e.get("rcsb_entry_info") or {}).get("resolution_combined") or []
        res_a: float | None = None
        for v in res_list:
            try:
                res_a = float(v)
                break
            except (TypeError, ValueError):
                continue
        out[pid] = {"title": title, "resolution_A": res_a}
    return out
