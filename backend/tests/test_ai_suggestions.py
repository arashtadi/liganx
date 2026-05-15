"""Tests for the AI quick-question suggestions (AI4)."""
from deltadock.services.ai_suggestions import (
    GENERIC_SUGGESTIONS, SuggestionSet, suggestions_for_job,
)


def test_known_target_returns_target_specific_set():
    """KRAS gets KRAS-specific openers, not the generic three."""
    s = suggestions_for_job(pdb_id="4OBE", mutations=[])
    assert s.target_id == "kras"
    assert s.target_name.upper().startswith("K") or "KRAS" in s.target_name.upper()
    # The 3 questions are KRAS-themed, not the GENERIC ones.
    joined = " ".join(s.suggestions).lower()
    assert "kras" in joined or "switch" in joined or "adagrasib" in joined
    assert len(s.suggestions) == 3


def test_mutation_specific_opener_overrides_first():
    """An EGFR T790M job gets the gatekeeper-mutation question as its #1
    suggestion — even though the generic EGFR bank has a different opener.
    Uses the catalog's actual default EGFR pdb_id (2ITY)."""
    s = suggestions_for_job(pdb_id="2ITY", mutations=["T790M"])
    assert s.target_id == "egfr"
    assert "gatekeeper" in s.suggestions[0].lower()
    assert len(s.suggestions) == 3


def test_unknown_target_falls_back_to_generic():
    """A target that isn't in the catalog at all should return the
    GENERIC set, NOT an empty list — better to show useful generic
    openers than no suggestions."""
    s = suggestions_for_job(pdb_id="ZZZZ", mutations=[])
    assert s.target_id == "(unknown)"
    assert s.suggestions == GENERIC_SUGGESTIONS
    assert len(s.suggestions) == 3


def test_empty_pdb_id_falls_back_to_generic():
    s = suggestions_for_job(pdb_id="", mutations=[])
    assert s.target_id == "(unknown)"
    assert s.suggestions == GENERIC_SUGGESTIONS


def test_mutations_list_passed_through_for_ui_transparency():
    """The UI shows which mutation the suggestions are tailored for —
    so the SuggestionSet must echo the input mutations list."""
    s = suggestions_for_job(pdb_id="1M17", mutations=["T790M", "L858R"])
    assert s.mutations == ["T790M", "L858R"]


def test_unknown_mutation_keeps_target_default_opener():
    """If we have target-specific questions but the mutation isn't in
    the override table, fall back to the target's default first
    question (not the generic set)."""
    s = suggestions_for_job(pdb_id="2ITY", mutations=["MADE_UP"])
    # Still the EGFR-themed set, not GENERIC_SUGGESTIONS
    assert s.target_id == "egfr"
    assert s.suggestions != GENERIC_SUGGESTIONS
    assert len(s.suggestions) == 3


def test_suggestion_set_dataclass_shape():
    """Defensive: the dataclass shape is part of the public API contract
    (the endpoint serializes asdict). Pin it down."""
    s = suggestions_for_job(pdb_id="4OBE", mutations=["G12C"])
    assert isinstance(s, SuggestionSet)
    assert isinstance(s.target_id, str)
    assert isinstance(s.target_name, str)
    assert isinstance(s.mutations, list)
    assert isinstance(s.suggestions, list)
    assert all(isinstance(q, str) for q in s.suggestions)
