"""NCBI PubMed E-utilities client — for the AI3 literature lookup path.

The chat's default policy is "answer only from the page" (no extrapolation,
no hallucinated trial data). That's safe but limiting: a chemist asking
"compare this binding mode to gefitinib's published mechanism" deserves
a real, citable answer. AI3 adds PubMed grounding ONLY when the question
explicitly asks for literature — Claude gets real titles + DOIs to cite,
the user clicks through for the full paper.

API: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/
Auth: none required (NCBI allows ~3 req/sec unauthenticated). For higher
volume, set NCBI_API_KEY in env to lift to 10 req/sec.

Two-step flow:
  1. esearch  → list of PMIDs matching a free-text query
  2. esummary → title, authors, journal, pubdate, DOI for each PMID

We avoid efetch (abstracts) for v1 — titles + journals are enough to
ground citations, abstracts would blow up Claude's context.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Optional

log = logging.getLogger(__name__)

EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
USER_AGENT = "liganx/0.1 (https://liganx.com)"
DEFAULT_TIMEOUT_S = 12.0


@dataclass
class PubmedHit:
    pmid: str
    title: str
    authors: list[str]
    journal: str
    pubdate: str            # ChEMBL-style "YYYY MMM DD" or "YYYY" — display as-is
    doi: Optional[str]

    @property
    def url(self) -> str:
        """Canonical PubMed link for citation purposes."""
        return f"https://pubmed.ncbi.nlm.nih.gov/{self.pmid}/"

    @property
    def doi_url(self) -> Optional[str]:
        return f"https://doi.org/{self.doi}" if self.doi else None


def _http_get_json(url: str, timeout_s: float = DEFAULT_TIMEOUT_S) -> dict:
    """Minimal stdlib JSON GET. We avoid httpx here so this module is
    importable in offline/CI tests without an event loop."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout_s) as r:
        return json.loads(r.read().decode("utf-8"))


def _api_key_param() -> str:
    """Return '&api_key=...' if NCBI_API_KEY is set, else empty string."""
    k = os.environ.get("NCBI_API_KEY", "").strip()
    return f"&api_key={urllib.parse.quote(k)}" if k else ""


def esearch(query: str, *, max_results: int = 3,
            timeout_s: float = DEFAULT_TIMEOUT_S) -> list[str]:
    """Return a list of PMIDs that match the free-text query.

    Ranked by NCBI's relevance — default 'relevance' sort gives the
    most-on-topic recent reviews/primary sources, which is what we want
    for a citation snippet."""
    if not query.strip():
        return []
    params = urllib.parse.urlencode({
        "db": "pubmed",
        "term": query,
        "retmax": min(max_results, 10),
        "retmode": "json",
        "sort": "relevance",
    })
    url = f"{EUTILS_BASE}/esearch.fcgi?{params}{_api_key_param()}"
    try:
        data = _http_get_json(url, timeout_s=timeout_s)
    except (urllib.error.URLError, json.JSONDecodeError) as e:
        log.info("pubmed esearch failed: %s", e)
        return []
    return list((data.get("esearchresult") or {}).get("idlist") or [])


def esummary(pmids: list[str], *,
             timeout_s: float = DEFAULT_TIMEOUT_S) -> list[PubmedHit]:
    """Return PubmedHit records for each PMID. Order is preserved."""
    if not pmids:
        return []
    params = urllib.parse.urlencode({
        "db": "pubmed",
        "id": ",".join(pmids),
        "retmode": "json",
    })
    url = f"{EUTILS_BASE}/esummary.fcgi?{params}{_api_key_param()}"
    try:
        data = _http_get_json(url, timeout_s=timeout_s)
    except (urllib.error.URLError, json.JSONDecodeError) as e:
        log.info("pubmed esummary failed: %s", e)
        return []
    result = data.get("result") or {}
    out: list[PubmedHit] = []
    for pmid in pmids:
        rec = result.get(pmid)
        if not isinstance(rec, dict):
            continue
        out.append(_to_hit(pmid, rec))
    return out


def _to_hit(pmid: str, rec: dict) -> PubmedHit:
    """Convert one ESummary record dict into a PubmedHit. Defensive on
    every field — NCBI sometimes returns ints where strings are expected,
    or omits 'articleids' entirely for very old records."""
    authors = []
    for a in rec.get("authors") or []:
        nm = (a or {}).get("name")
        if nm:
            authors.append(nm)
    # DOI lives inside articleids as {"idtype":"doi","value":"10.../..."}
    doi: Optional[str] = None
    for aid in rec.get("articleids") or []:
        if (aid or {}).get("idtype") == "doi":
            doi = aid.get("value")
            break
    return PubmedHit(
        pmid=str(pmid),
        title=str(rec.get("title") or "").strip(),
        authors=authors,
        journal=str(rec.get("fulljournalname") or rec.get("source") or "").strip(),
        pubdate=str(rec.get("pubdate") or "").strip(),
        doi=doi,
    )


def search_and_summarize(query: str, *,
                        max_results: int = 3,
                        timeout_s: float = DEFAULT_TIMEOUT_S) -> list[PubmedHit]:
    """Convenience: esearch then esummary in one call. Returns up to
    max_results PubmedHit records. Empty list on any error."""
    pmids = esearch(query, max_results=max_results, timeout_s=timeout_s)
    if not pmids:
        return []
    return esummary(pmids, timeout_s=timeout_s)


def format_for_snippet(hits: list[PubmedHit], *, query: str = "") -> str:
    """Render a list of PubmedHit into the text block we paste into
    the chat's user prompt. Compact format chosen to fit several papers
    in Claude's context without dominating the page snapshot."""
    if not hits:
        return ""
    header = (
        f"LITERATURE ({len(hits)} relevant PubMed result"
        f"{'s' if len(hits) != 1 else ''} for query \"{query}\"):"
        if query else f"LITERATURE ({len(hits)} relevant PubMed results):"
    )
    lines = [header]
    for i, h in enumerate(hits, start=1):
        first_authors = ", ".join(h.authors[:3])
        if len(h.authors) > 3:
            first_authors += " et al."
        lines.append(
            f"  [{i}] {h.title}\n"
            f"      {first_authors}. {h.journal}, {h.pubdate}. "
            f"PMID:{h.pmid}"
            + (f"  DOI:{h.doi}" if h.doi else "")
            + f"\n      {h.url}"
        )
    return "\n".join(lines)
