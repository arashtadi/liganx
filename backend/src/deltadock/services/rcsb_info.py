"""Look up basic PDB entry metadata from RCSB.

What we surface to the UI: a short, human-readable label (gene name + protein
name) the JobPage header can render next to "2WGJ chain A" so a scientist
sees `2WGJ · MET kinase · chain A` instead of just `2WGJ`. This is the
small-but-high-value follow-up to the catalog: catalog targets already have
names baked in, but anything off-catalog (custom uploads, ad-hoc RCSB IDs)
shows up bare unless we ask RCSB.

Approach: one GraphQL call to data.rcsb.org against the Data API. We pull
the entry title plus the first polymer entity's gene + organism, which is
what kinase / receptor structures consistently expose. The result is small
and stable, so we cache aggressively in-process (24h TTL).

For user-uploaded PDBs (USR_xxxxxxxx) we don't call RCSB — there's no entry
to look up. Caller should branch on the prefix and skip this module.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

log = logging.getLogger(__name__)

_GRAPHQL_URL = "https://data.rcsb.org/graphql"
_HTTP_TIMEOUT_S = 6
_USER_AGENT = "Liganx/0.1 (https://liganx.com; mutation-aware docking)"

_CACHE: dict[str, tuple[float, dict | None]] = {}
_CACHE_TTL_S = 24 * 3600


def get_pdb_info(pdb_id: str) -> dict | None:
    """Return {pdb_id, title, gene, protein, organism, uniprot_id} or None.

    `gene` and `protein` are pulled from the first polymer entity, which
    is the standard place to find the structure's primary protein name
    (kinase domain constructs, GPCRs, etc.). `uniprot_id` is the first
    UniProt accession the entity is annotated with.

    Returns None when the PDB ID isn't found or the call failed.
    """
    pid = (pdb_id or "").strip().upper()
    if not pid or len(pid) != 4:
        return None

    cached = _CACHE.get(pid)
    if cached and (time.time() - cached[0]) < _CACHE_TTL_S:
        return cached[1]

    try:
        info = _fetch(pid)
    except Exception as e:
        log.warning("RCSB info lookup failed for %s: %s", pid, e)
        info = None
    _CACHE[pid] = (time.time(), info)
    return info


def _fetch(pdb_id: str) -> dict | None:
    headers = {"User-Agent": _USER_AGENT, "Accept": "application/json"}
    query = """
    query EntryInfo($id: String!) {
      entry(entry_id: $id) {
        rcsb_id
        struct { title }
        polymer_entities {
          rcsb_polymer_entity { pdbx_description }
          rcsb_entity_source_organism {
            ncbi_scientific_name
            scientific_name
          }
          rcsb_entity_host_organism {
            ncbi_scientific_name
          }
          uniprots { rcsb_id }
          rcsb_polymer_entity_container_identifiers {
            reference_sequence_identifiers {
              database_accession
              database_name
            }
          }
          entity_poly { pdbx_strand_id }
        }
        rcsb_entry_info { resolution_combined }
      }
    }
    """
    payload: dict[str, Any] = {"query": query, "variables": {"id": pdb_id}}
    r = requests.post(
        _GRAPHQL_URL, json=payload, timeout=_HTTP_TIMEOUT_S, headers=headers
    )
    if r.status_code != 200:
        return None
    body = r.json()
    e = (body.get("data") or {}).get("entry")
    if not e:
        return None

    title = ((e.get("struct") or {}).get("title") or "").strip() or pdb_id
    pe_list = e.get("polymer_entities") or []
    protein: str | None = None
    organism: str | None = None
    uniprot_id: str | None = None

    for pe in pe_list:
        if pe is None:
            continue
        if protein is None:
            desc = (pe.get("rcsb_polymer_entity") or {}).get("pdbx_description")
            if desc:
                protein = desc.strip()
        if organism is None:
            srcs = pe.get("rcsb_entity_source_organism") or []
            for s in srcs:
                if not s:
                    continue
                name = s.get("ncbi_scientific_name") or s.get("scientific_name")
                if name:
                    organism = name.strip()
                    break
        if uniprot_id is None:
            # Prefer the first UniProt accession from the reference identifiers
            # list (matches what the entity is sequence-aligned to). Fall back
            # to `uniprots` which sometimes has the same data in a different
            # shape.
            ids = pe.get("rcsb_polymer_entity_container_identifiers") or {}
            for ref in ids.get("reference_sequence_identifiers") or []:
                if not ref:
                    continue
                if (ref.get("database_name") or "").upper() == "UNIPROT":
                    acc = ref.get("database_accession")
                    if acc:
                        uniprot_id = acc.strip()
                        break
            if uniprot_id is None:
                for u in pe.get("uniprots") or []:
                    if u and u.get("rcsb_id"):
                        uniprot_id = u["rcsb_id"].strip()
                        break
        if protein and organism and uniprot_id:
            break

    res_a: float | None = None
    res_list = (e.get("rcsb_entry_info") or {}).get("resolution_combined") or []
    for v in res_list:
        try:
            res_a = float(v)
            break
        except (TypeError, ValueError):
            continue

    return {
        "pdb_id": pdb_id,
        "title": title,
        "protein": protein,
        "organism": organism,
        "uniprot_id": uniprot_id,
        "resolution_A": res_a,
    }
