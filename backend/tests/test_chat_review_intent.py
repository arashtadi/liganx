"""Tests for the AI1 chemist-review integration into the chat.

We test the pure intent detector (which decides whether the chat
should pay the cost of running the chemist reviewer for this question)
and the prompt builder's snippet-insertion behaviour. The actual
two-LLM-call orchestration in the router is exercised end-to-end
against the deployed endpoint, not here.
"""
from deltadock.services.ask_ai import (
    _build_ask_user_prompt, is_chemist_review_intent,
)


# ────────────────────── intent detector: TRIGGERS ─────────────────────


def test_review_this_pose_triggers():
    assert is_chemist_review_intent("Can you review this pose?")


def test_is_this_pose_good_triggers():
    assert is_chemist_review_intent("Is this pose good?")


def test_second_opinion_phrase_triggers():
    assert is_chemist_review_intent("Give me a second opinion on this pose.")


def test_trust_the_pose_triggers():
    assert is_chemist_review_intent("Should I trust this pose?")


def test_geometry_question_triggers():
    assert is_chemist_review_intent("Does the geometry of this pose look right?")


def test_chemist_review_phrase_triggers():
    assert is_chemist_review_intent("Run a chemist review.")
    assert is_chemist_review_intent("Give me the chemist's review.")


def test_case_insensitive():
    """A user yelling REVIEW THIS POSE should still trigger."""
    assert is_chemist_review_intent("REVIEW THIS POSE!")


# ────────────────────── intent detector: DOESN'T trigger ─────────────────────


def test_jargon_question_does_not_trigger():
    """Day-to-day chat questions stay on the cheap single-call path."""
    assert not is_chemist_review_intent("What does outside-pocket mean?")


def test_score_question_does_not_trigger():
    assert not is_chemist_review_intent("Which compound has the best score?")


def test_compare_question_alone_does_not_trigger():
    """'Compare' is for AI5's hard-question routing; doesn't trigger the
    chemist review on its own — the user might just want a side-by-side."""
    assert not is_chemist_review_intent("Compare compound 1 and 2.")


def test_empty_question_does_not_trigger():
    assert not is_chemist_review_intent("")
    assert not is_chemist_review_intent("   ")


def test_off_topic_question_does_not_trigger():
    """Make sure plain mentions of 'pose' don't trigger if not actually
    asking for a review."""
    assert not is_chemist_review_intent("How many poses does Vina return?")


# ────────────────────── prompt builder: snippet inclusion ─────────────────────


def test_prompt_includes_chemist_review_when_attached():
    """When a review snippet is provided, the user message must include
    it under the CHEMIST REVIEW heading so Claude can ground its answer."""
    snippet = (
        "Verdict: plausible\nHeadline: Reasonable pose\nConcerns:\n  - strain near limit"
    )
    out = _build_ask_user_prompt(
        context={"target": "EGFR"},
        question="Is this pose good?",
        chemist_review_snippet=snippet,
    )
    assert "CHEMIST REVIEW" in out
    assert "Verdict: plausible" in out
    assert "strain near limit" in out
    # And the question is still there, after the review.
    assert "Is this pose good?" in out
    # Ordering: context → review → question. Critical for Claude's anchor.
    ctx_pos = out.find("PAGE CONTEXT")
    rev_pos = out.find("CHEMIST REVIEW")
    q_pos = out.find("QUESTION:")
    assert ctx_pos < rev_pos < q_pos, f"sections out of order: {ctx_pos} {rev_pos} {q_pos}"


def test_prompt_omits_chemist_review_when_no_snippet():
    """In the common case (no snippet), the prompt looks like before —
    just context + question. No empty CHEMIST REVIEW section."""
    out = _build_ask_user_prompt(
        context={"target": "EGFR"},
        question="What does Vinardo mean?",
        chemist_review_snippet=None,
    )
    assert "CHEMIST REVIEW" not in out
    assert "PAGE CONTEXT" in out
    assert "What does Vinardo mean?" in out


def test_prompt_omits_chemist_review_when_empty_string():
    """Defensive: empty-string snippet ≡ no snippet, not an empty section."""
    out = _build_ask_user_prompt(
        context={},
        question="hi",
        chemist_review_snippet="",
    )
    assert "CHEMIST REVIEW" not in out
