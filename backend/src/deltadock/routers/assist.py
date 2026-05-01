"""AI compound editor endpoints.

Two routes:

  POST /assist/properties — RDKit-only property panel for a SMILES.
                            Instant, no LLM. Used by the inline panel
                            to show MW/logP/TPSA/QED/Lipinski/PAINS as
                            the user sketches.

  POST /assist/compound   — natural-language edit. Takes current SMILES
                            + an instruction (and optionally target PDB
                            + mutations for pocket-aware suggestions),
                            returns a new SMILES + rationale via Claude
                            Haiku.

Both routes are auth-required (current_user) so we don't pay for AI calls
on behalf of strangers, and rate-limited so a runaway client can't blow
through the Anthropic budget. We deliberately don't gate on
profile_complete here — the editor is a pre-job tool and a brand-new
user might want to play with it before committing to fill the profile.

(The /jobs gate still requires profile completion, so users can sketch
all they want but actually submitting a docking job needs the profile.)
"""
from __future__ import annotations

import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import CurrentUser, current_user
from ..services.ai_assistant import call_anthropic
from ..services.properties import compute_properties
from ..services.rate_limit import RateLimit, rate_limit

log = logging.getLogger(__name__)

router = APIRouter(prefix="/assist", tags=["assist"])

# Conservative — 30 AI calls per hour per IP. Each call is ~$0.001 with
# Haiku, so 30/hr is $0.03/hr/user worst case. Properties endpoint is
# free and gets a much higher cap.
_AI_LIMIT = rate_limit("assist_ai", RateLimit(max_requests=30, window_seconds=3600))
_PROP_LIMIT = rate_limit("assist_props", RateLimit(max_requests=300, window_seconds=3600))


class PropertiesRequest(BaseModel):
    """Single SMILES → property panel."""
    smiles: str = Field(..., min_length=1, max_length=2000)


class AssistRequest(BaseModel):
    """Natural-language compound edit request.

    `target_pdb` and `mutations` are optional context to make the AI
    pocket-aware. Both are loose strings since users may type
    free-form ('BRAF V600E') or paste exact codes ('5VAM' + 'V600E')."""
    smiles: str = Field(..., min_length=1, max_length=2000)
    instruction: str = Field(..., min_length=1, max_length=500)
    target_pdb: Optional[str] = Field(default=None, max_length=20)
    mutations: Optional[str] = Field(default=None, max_length=200)


@router.post("/properties", dependencies=[Depends(_PROP_LIMIT)])
def properties_endpoint(
    payload: PropertiesRequest,
    user: Annotated[CurrentUser, Depends(current_user)],
) -> dict:
    """RDKit property panel. Returns the full panel for a valid SMILES,
    or {valid: False, error: ...} for an invalid one (HTTP 200 either
    way — invalid input is a normal user-flow case, not a server error)."""
    return dict(compute_properties(payload.smiles))


@router.post("/compound", dependencies=[Depends(_AI_LIMIT)])
async def compound_endpoint(
    payload: AssistRequest,
    user: Annotated[CurrentUser, Depends(current_user)],
) -> dict:
    """Natural-language compound edit via Claude Haiku.

    Returns:
      new_smiles: the canonicalised SMILES of the proposed edit
                  (== input smiles if AI declined or returned invalid)
      rationale: one-sentence explanation
      warnings:  optional caveats (PAINS, Lipinski violations, etc.)
      applied:   True iff the new SMILES validated with RDKit and
                 is different from the input

    HTTP errors:
      503 — ANTHROPIC_API_KEY not set or auth failed
      502 — upstream Anthropic API returned an error
      429 — per-IP rate limit hit (30/hr)
    """
    try:
        result = await call_anthropic(
            smiles=payload.smiles.strip(),
            instruction=payload.instruction.strip(),
            target_pdb=payload.target_pdb.strip() if payload.target_pdb else None,
            mutations=payload.mutations.strip() if payload.mutations else None,
        )
    except RuntimeError as e:
        msg = str(e)
        # Map known runtime errors to appropriate HTTP statuses so the
        # frontend can render a useful message.
        if "API key" in msg or "authentication" in msg:
            raise HTTPException(status_code=503, detail=msg)
        if "rate-limited" in msg:
            raise HTTPException(status_code=429, detail=msg)
        raise HTTPException(status_code=502, detail=msg)

    # Don't surface raw_model_output to the client; it's only useful for
    # backend debugging and could leak prompt-engineering hints.
    return {
        "new_smiles": result.get("new_smiles", payload.smiles),
        "rationale": result.get("rationale", ""),
        "warnings": result.get("warnings", []),
        "applied": result.get("applied", False),
    }
