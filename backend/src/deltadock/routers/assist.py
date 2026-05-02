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
from ..config import get_settings
from ..services.ai_assistant import call_anthropic, call_anthropic_optimize
from ..services.properties import check_dockability, compute_properties
from ..services.quick_dock import quick_dock
from ..services.rate_limit import RateLimit, rate_limit

log = logging.getLogger(__name__)

router = APIRouter(prefix="/assist", tags=["assist"])

# Conservative — 30 AI calls per hour per IP. Each call is ~$0.001 with
# Haiku, so 30/hr is $0.03/hr/user worst case. Properties endpoint is
# free and gets a much higher cap.
_AI_LIMIT = rate_limit("assist_ai", RateLimit(max_requests=30, window_seconds=3600))
_PROP_LIMIT = rate_limit("assist_props", RateLimit(max_requests=300, window_seconds=3600))
# Quick dock burns real GPU time per click (~5-15s on the pod). Cap
# tight: 20/hr per IP. Combined with the QUICK_DOCK_ENABLED feature
# flag (default off, flipped per paying customer like Boltz-2), this
# keeps the cost footprint predictable.
_QUICK_DOCK_LIMIT = rate_limit("assist_quick_dock", RateLimit(max_requests=20, window_seconds=3600))


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


@router.post("/dockability", dependencies=[Depends(_PROP_LIMIT)])
def dockability_endpoint(
    payload: PropertiesRequest,
    user: Annotated[CurrentUser, Depends(current_user)],
) -> dict:
    """Pre-flight dockability check. Returns {dockable: true,
    canonical_smiles: ...} when the molecule will survive Vina/GNINA
    ligand prep, or {dockable: false, reason: ..., suggestion: ...}
    with a human-readable explanation + actionable next step.

    Used by the Ketcher save flow to fail-fast at the editor instead
    of letting bad inputs (arsenic, salts, oversized macrocycles)
    propagate into the job-submit step where they'd waste GPU time
    and confuse the user. Same rate-limit bucket as /properties since
    the cost profile is similar (RDKit-only, instant)."""
    return dict(check_dockability(payload.smiles))


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


# ──────────────────────────────────────────────────────────────────────
# Quick dock + Optimize loop — the moat feature.
#
# Pattern mirrors Boltz-2: feature-flagged off by default. Frontend
# shows "By request" badge; flipped to true per paying customer via
# `flyctl secrets set QUICK_DOCK_ENABLED=true --app liganx-api`.
# ──────────────────────────────────────────────────────────────────────


class QuickDockRequest(BaseModel):
    """Run a fast Vina dock against a target+mutation. Used by the
    AI sidebar's 🎯 Quick dock button."""
    smiles: str = Field(..., min_length=1, max_length=2000)
    target_pdb: str = Field(..., min_length=1, max_length=20)
    chain: str = Field(default="A", max_length=4)
    mutation: Optional[str] = Field(default=None, max_length=64)


class OptimizeRequest(BaseModel):
    """Ask the AI for 3 variant compounds designed to gain contacts at
    the missed residues from a prior quick_dock result. Caller is
    expected to provide the SMILES + score + hits + misses returned by
    /assist/quick_dock so the model has the exact context."""
    smiles: str = Field(..., min_length=1, max_length=2000)
    score: float = Field(...)
    hits: list[str] = Field(default_factory=list)
    misses: list[str] = Field(default_factory=list)
    target_pdb: Optional[str] = Field(default=None, max_length=20)
    mutations: Optional[str] = Field(default=None, max_length=200)


def _check_quick_dock_enabled() -> None:
    """Gate quick-dock + optimize endpoints behind QUICK_DOCK_ENABLED.
    Raises 403 with a friendly message when off, mirroring the Boltz-2
    pattern. Frontend uses the 403 + detail prefix to render a Contact
    Us call-to-action ('available on request')."""
    settings = get_settings()
    if not settings.quick_dock_enabled:
        raise HTTPException(
            status_code=403,
            detail=(
                "Quick dock is available on request. Contact us via /contact "
                "and we'll enable it on your account."
            ),
        )


@router.post("/quick_dock", dependencies=[Depends(_QUICK_DOCK_LIMIT)])
def quick_dock_endpoint(
    payload: QuickDockRequest,
    user: Annotated[CurrentUser, Depends(current_user)],
) -> dict:
    """Run a fast (exhaustiveness=4) Vina dock and extract residue
    contacts. Returns {ok, score, hits[], misses[], pose_pdbqt_b64}.

    HTTP errors:
      403 — QUICK_DOCK_ENABLED=false (frontend renders a Contact us CTA)
      429 — per-IP rate limit (20/hr)

    On in-pipeline failure (bad SMILES, pod down, mutation unbuildable)
    returns 200 with ok=False + a friendly error message — these are
    user-input cases, not server errors, so the frontend can render the
    message inline rather than treating it as an exception.
    """
    _check_quick_dock_enabled()
    result = quick_dock(
        smiles=payload.smiles,
        target_pdb=payload.target_pdb,
        chain=payload.chain,
        mutation=payload.mutation,
    )
    return dict(result)


@router.post("/optimize", dependencies=[Depends(_AI_LIMIT)])
async def optimize_endpoint(
    payload: OptimizeRequest,
    user: Annotated[CurrentUser, Depends(current_user)],
) -> dict:
    """Generate 3 variant SMILES designed to gain contacts at the
    `misses` residues from a prior quick_dock. Returns {variants:
    [{new_smiles, rationale}, ...]}. Always returns up to 3 variants
    that pass RDKit validation; may return fewer (or empty list) if
    the model produces invalid SMILES.

    Same auth + AI rate limit (30/hr) as /assist/compound. Same gate
    as /assist/quick_dock — feature-flagged off by default."""
    _check_quick_dock_enabled()
    try:
        variants = await call_anthropic_optimize(
            smiles=payload.smiles.strip(),
            score=payload.score,
            hits=payload.hits or [],
            misses=payload.misses or [],
            target_pdb=payload.target_pdb,
            mutations=payload.mutations,
        )
    except RuntimeError as e:
        msg = str(e)
        if "API key" in msg or "authentication" in msg:
            raise HTTPException(status_code=503, detail=msg)
        if "rate-limited" in msg:
            raise HTTPException(status_code=429, detail=msg)
        raise HTTPException(status_code=502, detail=msg)
    return {"variants": [dict(v) for v in variants]}
