"""Tests for the AI5 auto-routing of hard questions to Sonnet.

We don't test the actual Anthropic call — just the classifier that
decides which model to send the question to. Getting this wrong costs
real money (every question to Sonnet instead of Haiku is ~3x the bill),
so we pin down what 'hard' means with concrete examples.
"""
from deltadock.services.ask_ai import (
    ASK_MODEL, ASK_MODEL_HARD, _looks_hard, pick_ask_model,
)


# ────────────────────── simple questions → Haiku ─────────────────────


def test_short_factual_question_stays_on_haiku():
    """The bread-and-butter chat question — short, single fact."""
    assert not _looks_hard("What does Vinardo mean?")
    assert pick_ask_model("What does Vinardo mean?") == ASK_MODEL


def test_outside_pocket_explainer_stays_on_haiku():
    """A canonical onboarding question."""
    assert not _looks_hard("Explain the outside-pocket badge.")


def test_score_definition_stays_on_haiku():
    assert not _looks_hard("Is lower or higher score better?")


def test_empty_question_doesnt_escalate():
    """Defensive — empty input should default to the cheap model
    rather than going through Sonnet (then failing at Anthropic)."""
    assert not _looks_hard("")
    assert pick_ask_model("") == ASK_MODEL


# ────────────────────── hard questions → Sonnet ─────────────────────


def test_compare_question_routes_to_sonnet():
    """Comparison = multi-step reasoning. Sonnet's home turf."""
    assert _looks_hard("Compare compound 1 and compound 3 — which would you pick?")
    assert pick_ask_model("Compare these two compounds.") == ASK_MODEL_HARD


def test_versus_question_routes_to_sonnet():
    assert _looks_hard("Adagrasib vs Sotorasib — which is better here?")


def test_why_question_routes_to_sonnet():
    """Explaining causation usually needs a chain of logic."""
    assert _looks_hard("Why is T790M called the gatekeeper mutation?")


def test_long_question_routes_to_sonnet():
    """Long setups almost always come with nuanced asks."""
    long_q = (
        "I'm trying to understand whether this docking pose makes sense "
        "given the published binding modes for first-generation EGFR "
        "inhibitors, and whether the strain on the indole nitrogen is "
        "consistent with the T790M-resistant conformations we'd expect. "
        "Can you walk me through your reasoning?"
    )
    assert len(long_q) >= 200
    assert _looks_hard(long_q)


def test_multi_part_question_routes_to_sonnet():
    """Two question marks → almost always multi-step. Pin this down."""
    assert _looks_hard("Is this pose good? And which residues does it hit?")


def test_literature_keyword_routes_to_sonnet():
    """Anything that references outside-the-page knowledge."""
    assert _looks_hard("What does the literature say about this scaffold?")


def test_mechanism_keyword_routes_to_sonnet():
    assert _looks_hard("What's the mechanism behind this Δ?")


def test_recommend_keyword_routes_to_sonnet():
    """Recommendations are open-ended judgment calls — Sonnet handles
    these more reliably."""
    assert _looks_hard("Recommend a follow-up compound to dock.")


# ────────────────────── pick_ask_model is the entry point ─────────────────────


def test_pick_ask_model_returns_one_of_the_two_models():
    """The router should ONLY ever return one of these two strings —
    a typo'd model id would fail at Anthropic and return 400."""
    for q in ("hi", "compare", "what is X?", "x" * 250):
        m = pick_ask_model(q)
        assert m in (ASK_MODEL, ASK_MODEL_HARD), f"unexpected model {m!r}"


def test_models_are_distinct():
    """If the two model env-var defaults ever collide, the routing is
    a no-op and we're paying nothing extra for nothing more. Catch."""
    assert ASK_MODEL != ASK_MODEL_HARD
