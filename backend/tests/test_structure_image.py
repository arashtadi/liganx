"""Tests for the AI2 vision integration.

Two layers: the pure-function helpers (intent detector, image generator,
message-content builder) and a round-trip check that real SMILES produces
real PNG bytes. The live Anthropic vision call is exercised end-to-end
against the deployed endpoint, not here.
"""
import base64

import pytest

from deltadock.services.ask_ai import (
    _build_message_content, is_structure_intent,
)
from deltadock.services.structure_image import image_block, smiles_to_png_b64


# ────────────────────── intent: TRIGGERS ─────────────────────


def test_show_structure_triggers():
    assert is_structure_intent("Show me the structure.")


def test_what_does_it_look_like_triggers():
    assert is_structure_intent("What does it look like?")


def test_describe_molecule_triggers():
    assert is_structure_intent("Describe the molecule.")


def test_chirality_triggers():
    assert is_structure_intent("Is there a chiral center?")


def test_scaffold_triggers():
    assert is_structure_intent("What's the scaffold?")


def test_ring_system_triggers():
    assert is_structure_intent("Comment on the ring system.")


# ────────────────────── intent: DOESN'T trigger ─────────────────────


def test_score_question_does_not_trigger():
    assert not is_structure_intent("What's the best score?")


def test_empty_does_not_trigger():
    assert not is_structure_intent("")


# ────────────────────── image generator ─────────────────────


def test_image_generator_returns_valid_png_for_real_smiles():
    """Round-trip: a real SMILES → base64 → PNG header bytes.

    Critical because the Anthropic vision API rejects malformed PNGs with
    a 400. We don't want to discover that in prod."""
    b64 = smiles_to_png_b64("CCO", size=200)         # ethanol
    assert b64 is not None
    raw = base64.b64decode(b64)
    # PNG magic bytes
    assert raw[:8] == b"\x89PNG\r\n\x1a\n", "result is not a valid PNG"


def test_image_generator_handles_larger_realistic_molecule():
    """A drug-like molecule (Adagrasib fragment) renders cleanly."""
    smi = "COc1cc2ncnc(N)c2cc1"  # gefitinib-like fragment
    b64 = smiles_to_png_b64(smi)
    assert b64 is not None
    assert len(base64.b64decode(b64)) > 100   # not just an empty image


def test_image_generator_returns_none_for_invalid_smiles():
    """Garbage SMILES → None, no crash. The chat falls back to text-only."""
    assert smiles_to_png_b64("not a valid SMILES at all") is None


def test_image_generator_returns_none_for_empty_string():
    assert smiles_to_png_b64("") is None
    assert smiles_to_png_b64(None) is None  # type: ignore[arg-type]


# ────────────────────── content builder shape ─────────────────────


def test_message_content_is_string_when_no_image():
    """Common case: text-only chat. Anthropic accepts both string and
    list `content`; we keep string when there's no image to save bytes."""
    content = _build_message_content(
        context={"target": "EGFR"},
        question="What is Vinardo?",
    )
    assert isinstance(content, str)
    assert "EGFR" in content
    assert "Vinardo" in content


def test_message_content_becomes_list_when_image_attached():
    """With an image, content is the multimodal list — text block + image block."""
    fake_b64 = "iVBORw0KGgo="     # the canonical 8-byte PNG header
    content = _build_message_content(
        context={"target": "EGFR"},
        question="Describe the molecule.",
        structure_image_b64=fake_b64,
    )
    assert isinstance(content, list)
    assert len(content) == 2
    text_blocks = [b for b in content if b.get("type") == "text"]
    image_blocks = [b for b in content if b.get("type") == "image"]
    assert len(text_blocks) == 1
    assert len(image_blocks) == 1
    # The image block uses the Anthropic schema exactly
    assert image_blocks[0]["source"]["type"] == "base64"
    assert image_blocks[0]["source"]["media_type"] == "image/png"
    assert image_blocks[0]["source"]["data"] == fake_b64


def test_image_block_schema():
    """Pinpoint the exact Anthropic API schema. A change here means a
    different version of the API; the test makes that explicit."""
    blk = image_block("XXXXX")
    assert blk == {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": "image/png",
            "data": "XXXXX",
        },
    }
