"""2D-structure PNG generation for the AI2 vision path.

Claude supports image input alongside text. AI2 attaches a rendered 2D
structure of the compound under discussion so the model can literally
'look at' the molecule when commenting on its scaffold, stereochemistry,
or where a modification would land.

Why 2D and not 3D: 2D is one RDKit call (already a backend dep, no new
binaries). A 3D pose render would need PyMOL or a headless 3Dmol.js
which is its own ops chunk — left as a follow-up. 2D still buys real
value: the AI can describe the scaffold, comment on chirality, and
suggest a modification by name (e.g. "shrink the piperidine to a
pyrrolidine").
"""
from __future__ import annotations

import base64
import logging
from io import BytesIO
from typing import Optional

log = logging.getLogger(__name__)


def smiles_to_png_b64(smiles: str, *, size: int = 320) -> Optional[str]:
    """Render a SMILES as a 2D PNG and return its base64 string (no
    `data:` prefix — that's Anthropic's job).

    Returns None if RDKit can't parse the SMILES, or if RDKit/PIL aren't
    available (defensive — the chat falls back to text-only when the
    image generation fails). 320 px is sized for Anthropic's image
    pricing (Claude bills by resolution; 320×320 ≈ 100 input tokens —
    negligible) while still being readable.
    """
    if not smiles:
        return None
    try:
        from rdkit import Chem
        from rdkit.Chem import Draw
    except ImportError as e:
        log.info("structure_image: RDKit not available (%s); skipping image", e)
        return None

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        log.info("structure_image: couldn't parse SMILES %s", smiles[:80])
        return None

    try:
        img = Draw.MolToImage(mol, size=(size, size))
    except Exception as e:                                          # noqa: BLE001
        log.info("structure_image: RDKit Draw failed: %s", e)
        return None

    try:
        buf = BytesIO()
        img.save(buf, format="PNG")
        raw = buf.getvalue()
    except Exception as e:                                          # noqa: BLE001
        log.info("structure_image: PIL save failed: %s", e)
        return None

    return base64.b64encode(raw).decode("ascii")


def image_block(b64_png: str) -> dict:
    """Build the Anthropic API image content block. Exposes the exact
    schema so callers don't have to repeat it. Companion to a {'type':
    'text', 'text': ...} block."""
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": "image/png",
            "data": b64_png,
        },
    }
