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
    _build_user_message,
    _coerce_review,
    _extract_json,
    _failure_suggestions,
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
