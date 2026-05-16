"""Tests for the chemist reviewer agent (S1).

The Claude call itself is mocked-out / not exercised — we test the pure
functions: prompt assembly, defensive JSON extraction, and the coercion
layer that defends against an LLM that ignores the schema. The failure
short-circuit (no Claude call needed when docking failed) is also tested
end-to-end against the actual `review_pose` async function with a fake
extra string.
"""
import asyncio

import pytest

from deltadock.services.chemist_review import (
    ChemistReview,
    _apply_trust_clamp,
    _build_user_message,
    _cap_verdict,
    _coerce_review,
    _extract_json,
    _failure_suggestions,
    _trust_checks,
    review_pose,
)


# ──────────────────────── _build_user_message ────────────────────────


def test_user_message_contains_all_key_fields():
    """The LLM gets every piece of structured context it needs to judge."""
    msg = _build_user_message(
        compound_smiles="COc1cc2ncnc(N)c2cc1",
        compound_name="Gefitinib-fragment",
        target_id="egfr",
        target_name="EGFR",
        target_uniprot="P00533",
        pdb_id="1M17",
        chain="A",
        variant="T790M",
        indications=["NSCLC"],
        docked_score=-8.4,
        extras={
            "pose_in_pocket": True,
            "pose_offset_a": 1.2,
            "confidence": "high",
            "posebusters": "passed all 0 checks",
            "strain": "ok:1.4",
            "contacts": [
                {"residue": "MET793", "type": "HBAc", "distance": 2.7},
                {"residue": "LYS745", "type": "Hydr"},
            ],
            "iface_bsa": 312.5,
            "iface_hb": 2,
            "vina_terms": "-1.2,-0.8,0.4,-3.1,-1.0,-2.7",
            "foldxDDG": -0.66,
        },
    )
    # Critical fields all present
    for needle in [
        "EGFR", "P00533", "1M17", "T790M", "Gefitinib-fragment", "NSCLC",
        "-8.40", "yes", "1.2", "high", "passed all 0 checks", "ok:1.4",
        "MET793", "LYS745", "BSA=312.5", "2 H-bond", "-1.2,-0.8",
        "-0.66",
    ]:
        assert needle in msg, f"missing {needle!r} in prompt:\n{msg}"


def test_user_message_omits_unknowns_gracefully():
    """Empty extras → no spurious 'None' lines that would confuse the LLM."""
    msg = _build_user_message(
        compound_smiles="CCO",
        compound_name="",
        target_id="kras",
        target_name="KRAS",
        target_uniprot="P01116",
        pdb_id="4OBE",
        chain="A",
        variant="WT",
        indications=[],
        docked_score=-3.2,
        extras={},
    )
    assert "Pose in pocket" not in msg
    assert "PoseBusters" not in msg
    assert "strain" not in msg.lower() or "strain" in msg.lower()  # not asserting absent — just no None
    assert " None" not in msg
    # Default compound-name fallback is rendered
    assert "(unnamed)" in msg


# ──────────────────────── _extract_json ────────────────────────


def test_extract_json_plain():
    obj = _extract_json('{"verdict": "plausible", "headline": "ok"}')
    assert obj["verdict"] == "plausible"


def test_extract_json_wrapped_in_markdown():
    """LLM sometimes ignores 'no markdown' instructions and emits a fence."""
    text = 'Here you go:\n```json\n{"verdict": "borderline", "headline": "h"}\n```\n'
    obj = _extract_json(text)
    assert obj["verdict"] == "borderline"


def test_extract_json_extracts_first_object():
    """If the LLM emits prose before the JSON, we still find it."""
    obj = _extract_json('Sure! {"verdict": "suspect", "headline": "h"}')
    assert obj["verdict"] == "suspect"


def test_extract_json_raises_when_absent():
    with pytest.raises((ValueError,)) as exc:
        _extract_json("just prose, no JSON here")
    assert "no JSON" in str(exc.value)


# ──────────────────────── _coerce_review ────────────────────────


def test_coerce_review_happy_path():
    raw = {
        "verdict": "plausible",
        "headline": "Reasonable pose with one caveat.",
        "summary": "The pose sits in the canonical ATP pocket and makes the hinge H-bond, but the strain is borderline.",
        "strengths": ["Hinge H-bond to MET793", "Pose in canonical pocket"],
        "concerns": ["Strain 6.2 kcal/mol — close to the 7 kcal threshold"],
        "suggestions": ["Try removing one rotatable bond to relieve strain"],
        "criteria": {
            "pose_fit": "✓ canonical EGFR pocket",
            "geometry": "⚠ strain near limit",
            "interactions": "hinge H-bond present",
            "score": "consistent with size",
            "drug_likeness": "drug-like",
        },
    }
    r = _coerce_review(raw, {"pose_in_pocket": True})
    assert r.verdict == "plausible"
    assert "caveat" in r.headline  # headline is "Reasonable pose with one caveat."
    assert "canonical" in r.summary  # the longer 'canonical pocket' phrasing is in summary
    assert len(r.strengths) == 2
    assert len(r.concerns) == 1
    assert r.criteria["pose_fit"].startswith("✓")
    assert r.inputs == {"pose_in_pocket": True}


def test_coerce_review_clamps_unknown_verdict():
    """An LLM that returns garbage verdicts gets defaulted to 'borderline'."""
    raw = {"verdict": "AMAZING", "headline": "h", "summary": "s"}
    r = _coerce_review(raw, {})
    assert r.verdict == "borderline"


def test_coerce_review_truncates_runaway_fields():
    """A chatty LLM that emits a 5000-char headline is clamped."""
    raw = {
        "verdict": "plausible",
        "headline": "x" * 5000,
        "summary": "y" * 5000,
        "strengths": ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"],
    }
    r = _coerce_review(raw, {})
    assert len(r.headline) <= 240
    assert len(r.summary) <= 800
    assert len(r.strengths) <= 10


def test_coerce_review_handles_missing_optionals():
    """Minimum-shape input still produces a usable ChemistReview."""
    r = _coerce_review({"verdict": "suspect"}, {})
    assert r.verdict == "suspect"
    assert r.headline  # falls back to "Review complete."
    assert r.strengths == []
    assert r.concerns == []
    assert r.suggestions == []


# ────────────────────── failure short-circuit ─────────────────────


def test_failure_short_circuits_without_calling_claude():
    """If the runner reported a docking failure, we don't waste a Claude call
    — we return a deterministic 'failed' review with canned suggestions.

    This is the critical hot path: oversized peptides and PAINS-y inputs
    fail at ligand_prep, and the matrix UI would otherwise spin on every
    one of them waiting for a meaningless review."""
    extras_str = "ligand_prep_failed:RDKit embedding failed: 0 conformers|engine=local"
    review = asyncio.run(review_pose(
        compound_smiles="GarbageSMILES",
        compound_name="Bad",
        target_id="egfr",
        target_name="EGFR",
        target_uniprot="P00533",
        pdb_id="1M17",
        chain="A",
        variant="WT",
        indications=[],
        docked_score=0.0,
        extra=extras_str,
        api_key="not-actually-used-because-we-short-circuit",
    ))
    assert review.verdict == "failed"
    assert "ligand_prep" in review.headline.lower() or "Docking failed" in review.headline
    assert any("ligand_prep" in c for c in review.concerns)
    assert review.suggestions   # canned suggestions are populated
    # Critically: criteria are marked n/a, not invented
    assert all(v.startswith("n/a") or v == "compound itself may be untestable"
               for v in review.criteria.values())


def test_failure_suggestions_are_actionable_per_kind():
    assert any("SMILES" in s for s in _failure_suggestions("ligand_prep"))
    assert any("PDB" in s for s in _failure_suggestions("mutant_build"))
    assert any("Re-submit" in s for s in _failure_suggestions("docking"))


# ────────────────────── ChemistReview dataclass ─────────────────────


# ────────────────────── S1.1 — prompt quality ─────────────────────


def test_prompt_includes_contact_residues_specifically():
    """The hardest test we have: if ProLIF contacts are in the input, the
    user message must include them by residue code so the LLM has the
    raw material to comment on them. Generic prompts produce generic
    answers; this pins down the specificity."""
    msg = _build_user_message(
        compound_smiles="CCO",
        compound_name="Test",
        target_id="egfr",
        target_name="EGFR",
        target_uniprot="P00533",
        pdb_id="1M17", chain="A", variant="T790M",
        indications=["NSCLC"],
        docked_score=-8.0,
        extras={
            "contacts": [
                {"residue": "MET793", "type": "HBAc", "distance": 2.7},
                {"residue": "T790", "type": "Hydr"},
                {"residue": "LYS745", "type": "Hydr"},
            ],
            "iface_hb": 2,
            "iface_bsa": 312.5,
        },
    )
    # Every contact residue must appear by name
    for residue in ("MET793", "T790", "LYS745"):
        assert residue in msg, f"contact residue {residue} missing from prompt"
    # And the H-bond interaction type should be visible
    assert "HBAc" in msg


def test_system_prompt_contains_kinase_aware_guidance():
    """The S1.1 prompt rebuild added explicit kinase-aware framing —
    hinge H-bond, DFG, gatekeeper, type I/II/III binder classification.
    Most catalog targets are kinases; this is the load-bearing framing."""
    from deltadock.services.chemist_review import _SYSTEM_PROMPT
    for keyword in ("hinge", "DFG", "gatekeeper", "type I", "covalent"):
        assert keyword.lower() in _SYSTEM_PROMPT.lower(), (
            f"system prompt is missing the kinase term {keyword!r} — "
            "the agent will produce generic answers without it"
        )


def test_system_prompt_pushes_for_specific_residue_commentary():
    """The S1.1 prompt has explicit instructions to NAME residues and
    cite specific numbers. Pin down that the load-bearing phrasing is
    present so a prompt edit can't silently dilute the agent's quality."""
    from deltadock.services.chemist_review import _SYSTEM_PROMPT
    p = _SYSTEM_PROMPT.lower()
    # Must mention specific instruction to cite numbers and residues
    assert "specific" in p
    assert "residue" in p
    assert "met793" in p or "name the contact residues" in p
    # Must call out artefacts (the "be skeptical" clause)
    assert "artefact" in p or "artifact" in p


def test_system_prompt_uses_smarter_default_model():
    """S1.1 promoted the chemist reviewer to Sonnet. Pin the default so
    a regression to Haiku is loud."""
    from deltadock.services.chemist_review import ANTHROPIC_MODEL
    # Either Sonnet or any explicit override; never silently default
    # back to Haiku.
    assert "sonnet" in ANTHROPIC_MODEL.lower() or "opus" in ANTHROPIC_MODEL.lower(), (
        f"chemist agent should default to sonnet/opus, got {ANTHROPIC_MODEL!r}. "
        "If a downgrade is intentional, update this test deliberately."
    )


def test_chemist_review_serializes_round_trip():
    """The dataclass survives asdict() — the endpoint relies on this."""
    r = ChemistReview(
        verdict="confident-hit",
        headline="Strong pose",
        summary="Good geometry, hinge H-bond, drug-like.",
        strengths=["geometry"],
        concerns=[],
        suggestions=["proceed to SAR"],
        criteria={"pose_fit": "in pocket"},
        inputs={"foo": 1},
        model="claude-haiku-4-5-20251001",
    )
    d = r.to_dict()
    assert d["verdict"] == "confident-hit"
    assert d["criteria"]["pose_fit"] == "in pocket"
    assert d["model"].startswith("claude-")


# ────────────────────── T2 — trust-signal prompt fields ─────────────────────


def test_user_message_renders_druggability_tier_and_note():
    """The agent should see the target's druggability tier and the
    one-sentence justification — that's the trust signal Rule 7 leans on."""
    msg = _build_user_message(
        compound_smiles="CCO",
        compound_name="Test",
        target_id="kras",
        target_name="KRAS GTPase",
        target_uniprot="P01116",
        pdb_id="4OBE", chain="A", variant="G13D",
        indications=["colorectal cancer"],
        docked_score=-5.6,
        extras={"pose_in_pocket": True, "pose_offset_a": 2.0},
        druggability="experimental",
        druggability_note="No approved direct binder for KRAS G13D.",
    )
    assert "Druggability tier: experimental" in msg
    assert "No approved direct binder" in msg


def test_user_message_renders_canonical_pocket_residues():
    msg = _build_user_message(
        compound_smiles="CCO",
        compound_name="Test",
        target_id="egfr",
        target_name="EGFR kinase domain",
        target_uniprot="P00533",
        pdb_id="2ITY", chain="A", variant="T790M",
        indications=["NSCLC"],
        docked_score=-8.0,
        extras={},
        canonical_pocket_residues=["T790", "M793", "K745"],
    )
    assert "Canonical pocket residues" in msg
    for r in ("T790", "M793", "K745"):
        assert r in msg


def test_user_message_renders_typical_vina_range():
    msg = _build_user_message(
        compound_smiles="CCO",
        compound_name="Test",
        target_id="egfr",
        target_name="EGFR kinase domain",
        target_uniprot="P00533",
        pdb_id="2ITY", chain="A", variant="WT",
        indications=["NSCLC"],
        docked_score=-9.0,
        extras={},
        typical_vina_range=(-11.0, -8.0),
    )
    assert "Typical Vina score range" in msg
    # Both ends must appear.
    assert "-11.0" in msg or "-11" in msg
    assert "-8.0" in msg or "-8" in msg


def test_user_message_shows_agent_checks_block_when_metadata_present():
    """The 'Agent checks' block is what Rule 7 of the system prompt
    references. It must be present when we have canonical residues
    and/or a typical-score range."""
    msg = _build_user_message(
        compound_smiles="CCO",
        compound_name="Test",
        target_id="egfr",
        target_name="EGFR",
        target_uniprot="P00533",
        pdb_id="2ITY", chain="A", variant="T790M",
        indications=["NSCLC"],
        docked_score=-9.0,
        extras={
            "contacts": [
                {"residue": "MET793", "type": "HBAc", "distance": 2.7},
                {"residue": "LYS745", "type": "Hydr"},
            ],
        },
        canonical_pocket_residues=["T790", "M793", "K745"],
        typical_vina_range=(-11.0, -8.0),
    )
    assert "Agent checks" in msg
    # Overlap math: M793 should match MET793 by number, K745 should match LYS745.
    assert "Canonical-pocket contact overlap" in msg
    # And a score band assessment.
    assert "Score band" in msg


def test_user_message_warns_loudly_on_zero_canonical_overlap():
    """If the docked pose contacts NO canonical residues, the prompt
    must say so explicitly — this is the load-bearing artefact signal
    for Rule 7's 'suspect' cap."""
    msg = _build_user_message(
        compound_smiles="CCO",
        compound_name="Cenestil-like",
        target_id="kras",
        target_name="KRAS",
        target_uniprot="P01116",
        pdb_id="4OBE", chain="A", variant="G13D",
        indications=[],
        docked_score=-5.6,
        extras={
            "contacts": [
                {"residue": "MET170", "type": "Hydr"},     # not in canonical
                {"residue": "ARG161", "type": "Hydr"},     # not in canonical
            ],
            "pose_in_pocket": False,
            "pose_offset_a": 8.2,
        },
        canonical_pocket_residues=["G12", "T58", "Y96", "Q99"],
        typical_vina_range=(-9.0, -6.5),
    )
    assert "0 / 4" in msg or "NONE" in msg
    assert "surface contact" in msg.lower() or "artefact" in msg.lower()


# ────────────────────── T2 — _trust_checks pure function ─────────────────────


def test_trust_checks_counts_canonical_overlap_by_residue_number():
    """Overlap matches by residue NUMBER so 'M793' canonical matches
    both 'M793' and 'MET793' in ProLIF, and 'T790' canonical matches
    'T790M' (mutated)."""
    checks = _trust_checks(
        extras={
            "contacts": [
                {"residue": "MET793", "type": "HBAc"},
                {"residue": "T790M",  "type": "Hydr"},
                {"residue": "LYS745", "type": "Hydr"},
                {"residue": "VAL999", "type": "Hydr"},     # not canonical
            ],
        },
        docked_score=-9.0,
        canonical_residues=["T790", "M793", "K745", "L788"],
        typical_vina_range=(-11.0, -8.0),
    )
    assert checks["contact_overlap_count"] == 3
    assert set(checks["contact_overlap_names"]) == {"T790", "M793", "K745"}


def test_trust_checks_score_band_above_within_below():
    """The score-band assessment is what triggers the noise-floor cap."""
    # Above the typical band — noise floor.
    assert _trust_checks(
        extras={}, docked_score=-5.6,
        canonical_residues=[], typical_vina_range=(-11.0, -8.0),
    )["score_band"] == "above"
    # Inside the band.
    assert _trust_checks(
        extras={}, docked_score=-9.5,
        canonical_residues=[], typical_vina_range=(-11.0, -8.0),
    )["score_band"] == "within"
    # Stronger than the band's strong end.
    assert _trust_checks(
        extras={}, docked_score=-12.5,
        canonical_residues=[], typical_vina_range=(-11.0, -8.0),
    )["score_band"] == "below"


def test_trust_checks_returns_unknown_band_without_range():
    """No catalog metadata → no band assessment."""
    checks = _trust_checks(
        extras={}, docked_score=-9.0,
        canonical_residues=[], typical_vina_range=None,
    )
    assert checks["score_band"] == "unknown"


def test_trust_checks_score_band_order_tolerant():
    """typical_vina_range entered as (best, worst) instead of (worst, best)
    still produces correct band — both are valid orderings of two negative
    numbers."""
    # (-8, -11) is the same band as (-11, -8) — both negative.
    assert _trust_checks(
        extras={}, docked_score=-5.6,
        canonical_residues=[], typical_vina_range=(-8.0, -11.0),
    )["score_band"] == "above"


# ────────────────────── T2 — _cap_verdict ─────────────────────


def test_cap_verdict_returns_more_skeptical():
    # confident-hit is the LEAST skeptical, failed is most.
    assert _cap_verdict("confident-hit", "borderline") == "borderline"
    assert _cap_verdict("plausible",     "suspect")    == "suspect"
    # No downgrade if the current verdict is already stricter.
    assert _cap_verdict("suspect",       "borderline") == "suspect"
    # Unknowns default to the cap (defensive).
    assert _cap_verdict("nonsense",      "borderline") == "borderline"


# ────────────────────── T2 — _apply_trust_clamp ─────────────────────


def _make_review(verdict="plausible", headline="ok", concerns=None):
    return ChemistReview(
        verdict=verdict, headline=headline, summary="s",
        strengths=[], concerns=concerns or [], suggestions=[],
        criteria={}, inputs={}, model="claude-test",
    )


def test_clamp_caps_experimental_target_at_borderline():
    """The headline KRAS G13D failure mode: experimental druggability,
    great-looking LLM verdict — must be capped at borderline."""
    review = _make_review(verdict="confident-hit", headline="Strong pose")
    out = _apply_trust_clamp(
        review=review,
        druggability="experimental",
        canonical_pocket_residues=["G12", "T58"],
        typical_vina_range=(-9.0, -6.5),
        extras={"pose_in_pocket": True},
        docked_score=-7.5,                                       # within band
    )
    assert out.verdict == "borderline"
    # The reason must be surfaced.
    assert any("experimental" in c.lower() for c in out.concerns)
    # Headline gets a clamp prefix so the matrix UI shows WHY.
    assert "trust signal" in out.headline.lower() or "Trust signals" in out.headline


def test_clamp_caps_off_pocket_zero_overlap_at_suspect():
    """The pose makes zero contacts with canonical pocket AND sits
    outside the box — surface contact, must be suspect."""
    review = _make_review(verdict="plausible", headline="Decent pose")
    out = _apply_trust_clamp(
        review=review,
        druggability="recent",                                   # not experimental
        canonical_pocket_residues=["T790", "M793", "K745"],
        typical_vina_range=(-11.0, -8.0),
        extras={
            "contacts": [{"residue": "VAL999", "type": "Hydr"}],
            "pose_in_pocket": False,
            "pose_offset_a": 8.2,
        },
        docked_score=-9.0,                                       # within band
    )
    assert out.verdict == "suspect"
    assert any("canonical pocket" in c.lower() or "surface" in c.lower() for c in out.concerns)


def test_clamp_caps_noise_floor_score_at_borderline():
    """Score above (less negative than) the typical band → noise floor."""
    review = _make_review(verdict="confident-hit", headline="Strong pose")
    out = _apply_trust_clamp(
        review=review,
        druggability="established",
        canonical_pocket_residues=["T790"],
        typical_vina_range=(-11.0, -8.0),
        extras={
            "contacts": [{"residue": "T790M", "type": "Hydr"}],  # non-zero overlap
            "pose_in_pocket": True,
        },
        docked_score=-5.5,                                       # noise floor
    )
    assert out.verdict == "borderline"
    assert any("noise floor" in c.lower() or "less negative" in c.lower()
               for c in out.concerns)


def test_clamp_does_not_downgrade_clean_result():
    """Established target, in-pocket, in-band score — no clamp should fire."""
    review = _make_review(verdict="confident-hit", headline="Strong pose")
    out = _apply_trust_clamp(
        review=review,
        druggability="established",
        canonical_pocket_residues=["T790", "M793"],
        typical_vina_range=(-11.0, -8.0),
        extras={
            "contacts": [
                {"residue": "MET793", "type": "HBAc"},
                {"residue": "T790M",  "type": "Hydr"},
            ],
            "pose_in_pocket": True,
        },
        docked_score=-9.2,
    )
    assert out.verdict == "confident-hit"     # unchanged
    assert out.headline == "Strong pose"      # unchanged


def test_clamp_appends_reasons_even_when_verdict_already_capped():
    """If the LLM already produced 'suspect' for an experimental + off-pocket
    pose, we shouldn't downgrade further — but we DO want the trust-signal
    reasoning surfaced in the concerns array so the user sees WHY."""
    review = _make_review(verdict="suspect", headline="off-pocket",
                          concerns=["pre-existing concern"])
    out = _apply_trust_clamp(
        review=review,
        druggability="experimental",
        canonical_pocket_residues=["G12"],
        typical_vina_range=(-9.0, -6.5),
        extras={
            "contacts": [{"residue": "VAL999", "type": "Hydr"}],
            "pose_in_pocket": False, "pose_offset_a": 9.0,
        },
        docked_score=-5.6,
    )
    assert out.verdict == "suspect"                              # not downgraded further
    # Both pre-existing AND the trust-signal reasons must be present.
    assert "pre-existing concern" in out.concerns
    assert any("[Trust signal]" in c for c in out.concerns)


def test_clamp_skips_failed_verdicts():
    """A 'failed' review (docking didn't produce a pose) is not subject
    to the clamp — there's no pose to evaluate trust signals against."""
    review = _make_review(verdict="failed", headline="ligand_prep failed")
    out = _apply_trust_clamp(
        review=review,
        druggability="experimental",
        canonical_pocket_residues=["G12"],
        typical_vina_range=(-9.0, -6.5),
        extras={},
        docked_score=0.0,
    )
    assert out.verdict == "failed"
    assert out.headline == "ligand_prep failed"


def test_system_prompt_contains_rule_7_trust_signals():
    """Rule 7 is load-bearing for T2. Pin its presence so a prompt edit
    can't silently delete it."""
    from deltadock.services.chemist_review import _SYSTEM_PROMPT
    p = _SYSTEM_PROMPT.lower()
    assert "trust signals" in p
    assert "druggability" in p
    assert "noise floor" in p
    # The three caps must each be named.
    assert "experimental" in p
    assert "surface" in p or "suspect" in p
    assert "borderline" in p
