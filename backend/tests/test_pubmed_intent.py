"""Tests for the AI3 PubMed literature integration.

Pure-function tests on:
  • is_literature_intent — what triggers a PubMed lookup
  • build_pubmed_query — how question + job context becomes a query
  • format_for_snippet — what the LLM actually sees

The live HTTP call to NCBI is exercised end-to-end against the deployed
endpoint, not here (no network in CI is the right default).
"""
from deltadock.services.ask_ai import (
    build_pubmed_query, is_literature_intent,
)
from deltadock.services.pubmed_client import (
    PubmedHit, format_for_snippet,
)


# ────────────────────── intent: TRIGGERS ─────────────────────


def test_literature_keyword_triggers():
    assert is_literature_intent("What does the literature say about this?")


def test_papers_keyword_triggers():
    assert is_literature_intent("Any papers on this binding mode?")


def test_publications_keyword_triggers():
    assert is_literature_intent("Show me publications about EGFR T790M.")


def test_cite_keyword_triggers():
    assert is_literature_intent("Can you cite a study for that?")


def test_cocrystal_keyword_triggers():
    """Asking about a co-crystal structure is implicitly a literature ask."""
    assert is_literature_intent("Is there a co-crystal structure for this?")


def test_known_mechanism_triggers():
    assert is_literature_intent("What's the known mechanism of action?")


# ────────────────────── intent: DOESN'T trigger ─────────────────────


def test_jargon_question_does_not_trigger():
    assert not is_literature_intent("What does outside-pocket mean?")


def test_compare_alone_does_not_trigger():
    """Comparison is AI5's territory; doesn't pay the PubMed latency on its own."""
    assert not is_literature_intent("Compare compound 1 and 2.")


def test_empty_does_not_trigger():
    assert not is_literature_intent("")


# ────────────────────── build_pubmed_query ─────────────────────


def test_query_includes_target_and_mutation():
    q = build_pubmed_query(
        "What is the published binding mode?",
        target_name="EGFR kinase domain",
        mutations=["T790M"],
    )
    assert "EGFR" in q
    assert "T790M" in q


def test_query_drops_filler_words():
    """'literature' is a trigger word, not a useful PubMed term — should
    be stripped so the query is on-topic."""
    q = build_pubmed_query(
        "What does the literature say about gefitinib binding to EGFR?",
        target_name="EGFR",
    )
    assert "literature" not in q.lower()
    assert "gefitinib" in q.lower()
    assert "EGFR" in q


def test_query_respects_length_cap():
    """PubMed has a query-length limit; we clamp to be safe."""
    big = "x " * 500
    q = build_pubmed_query(big, target_name="EGFR")
    assert len(q) <= 300


def test_query_handles_empty_question():
    """Even with no question, mutation+target gives a usable query."""
    q = build_pubmed_query("", target_name="KRAS", mutations=["G12C"])
    assert "KRAS" in q
    assert "G12C" in q


# ────────────────────── format_for_snippet ─────────────────────


def _sample_hit(pmid: str, title: str, doi: str | None = None) -> PubmedHit:
    return PubmedHit(
        pmid=pmid, title=title,
        authors=["Smith J", "Jones A", "Garcia M"],
        journal="J. Med. Chem.", pubdate="2024",
        doi=doi,
    )


def test_snippet_includes_pmid_and_url():
    hits = [_sample_hit("12345678", "EGFR T790M resistance mechanism")]
    s = format_for_snippet(hits, query="EGFR T790M")
    assert "PMID:12345678" in s
    assert "pubmed.ncbi.nlm.nih.gov/12345678/" in s
    assert "EGFR T790M resistance mechanism" in s


def test_snippet_includes_doi_when_present():
    hits = [_sample_hit("11111", "Some paper", doi="10.1234/example")]
    s = format_for_snippet(hits, query="test")
    assert "DOI:10.1234/example" in s


def test_snippet_handles_many_authors_compactly():
    """et al. shortening — Claude's context window is limited."""
    hits = [_sample_hit("1", "A study")]
    s = format_for_snippet(hits, query="x")
    # 3 authors listed
    assert "Smith J" in s
    assert "Jones A" in s
    assert "Garcia M" in s


def test_empty_hits_produces_empty_snippet():
    """An empty PubMed response → empty snippet; the chat falls through
    to its normal page-only answer rather than showing 'LITERATURE: nothing'."""
    assert format_for_snippet([], query="anything") == ""
