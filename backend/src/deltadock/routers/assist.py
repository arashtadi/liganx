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

import asyncio
import logging
import time
import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session

from ..auth import CurrentUser, current_user
from ..config import get_settings
from ..db import engine as db_engine
from ..models import OptimizeAttempt
from ..services.ai_assistant import call_anthropic
from ..services.optimize_loop import generate_score_filter_optimize
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
    free-form ('BRAF V600E') or paste exact codes ('5VAM' + 'V600E').

    `score`, `hits`, `misses` are optional DOCKING context — when present,
    the AI gets the most recent Quick-dock result for THIS exact compound
    and can ground its suggestions in real contact data instead of
    guessing from structure alone. The frontend only sends these when
    dockResult.smiles == current canvas SMILES (i.e. the dock data is
    fresh; sending stale data after the user edited would actively
    mislead the AI). All three are optional so the no-target / no-dock
    paths still work — the prompt just falls back to structure-only mode."""
    smiles: str = Field(..., min_length=1, max_length=2000)
    instruction: str = Field(..., min_length=1, max_length=500)
    target_pdb: Optional[str] = Field(default=None, max_length=20)
    mutations: Optional[str] = Field(default=None, max_length=200)
    # Docking context (optional — only sent when fresh dock data exists).
    score: Optional[float] = Field(default=None, description="Vina score in kcal/mol; lower = stronger binding")
    hits: Optional[list[str]] = Field(default=None, max_length=50, description="Residue labels the compound contacts")
    misses: Optional[list[str]] = Field(default=None, max_length=50, description="Pocket residues the compound does NOT contact")


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
            score=payload.score,
            hits=payload.hits,
            misses=payload.misses,
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
    # Optional pocket-box scaling factor applied to the catalog default.
    # 1.0 = no change (default behaviour). 0.7 ≈ 16Å cube from the
    # standard 22Å, forcing the ligand to stay near the canonical
    # pocket center — used by the "Re-dock with tight box" salvage
    # path on off-pocket cells. Clamped server-side to [0.4, 1.0].
    # 2026-05-05 user request.
    box_scale: Optional[float] = Field(default=None, ge=0.4, le=1.0)


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
    # Parent ligand pose, base64-encoded PDBQT text. Optional but strongly
    # recommended: when present, the orchestrator computes geometric
    # guidance for the AI (where the mutation residue sits relative to
    # the current pose, which contacted residue is closest to it,
    # which direction to extend) — turns "engage residue 315" from a
    # vague residue-name instruction into a concrete medchem direction.
    # 2026-05-05 user request: "can the AI calculate where the mutation
    # is and modify the structure to bring it close and not outside?"
    # Frontend caches this from the most recent /assist/quick_dock
    # response and re-sends on the Optimize click. Capped at 200 KB
    # to bound payload size — typical pose PDBQT is 1–8 KB.
    parent_pose_pdbqt_b64: Optional[str] = Field(default=None, max_length=200_000)


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
    # Belt-and-braces: if the caller passed a comma-separated multi-mutation
    # string (e.g. "G12R, G12V" — frontend's editor opens with the whole
    # job's mutation context, sometimes more than one), pick the first
    # token. PDBFixer expects ONE residue swap per build_mutant call and
    # crashes the worker on a comma. Frontend was patched to send only
    # the first mutation 2026-05-04, but defending here too costs nothing
    # and protects against any future caller that sends the raw string.
    safe_mutation: Optional[str] = payload.mutation
    if safe_mutation and ("," in safe_mutation or ";" in safe_mutation):
        tokens = [t.strip() for t in safe_mutation.replace(";", ",").split(",")]
        tokens = [t for t in tokens if t]
        safe_mutation = tokens[0] if tokens else None
        log.info(
            "quick_dock: split multi-mutation %r → %r",
            payload.mutation, safe_mutation,
        )
    result = quick_dock(
        smiles=payload.smiles,
        target_pdb=payload.target_pdb,
        chain=payload.chain,
        mutation=safe_mutation,
        box_scale=payload.box_scale,
    )
    return dict(result)


@router.post("/optimize", dependencies=[Depends(_AI_LIMIT)])
async def optimize_endpoint(
    payload: OptimizeRequest,
    user: Annotated[CurrentUser, Depends(current_user)],
) -> dict:
    """Generate-Score-Filter loop. Returns the top 3 variants (by composite
    fitness) from a wider AI-proposed pool of ~12 candidates that have all
    been re-docked against the same target+mutation as the parent.

    Response shape (backwards-compatible — frontend's existing per-variant
    fan-out path still works when score is missing):
        {
          "variants": [
             {
               "new_smiles": "...",
               "rationale": "...",
               "score": -8.4,            # Vina kcal/mol (lower=better)
               "delta": 0.7,             # parent_score - score; positive=improvement
               "sa_score": 3.2,          # 1=easy, 10=impossible
               "fitness": 1.85,          # composite ranking value
               "mutation_contact": true, # variant touches the mutated residue
               "hits": [...],            # context for UI badges
               "misses": [...]
             },
             ... up to 3
          ],
          "candidates_generated": 12,    # diagnostic
          "candidates_filtered": 7,      # post SA + pod pre-flight
          "candidates_docked": 6,
          "note": "..."                  # human-readable, present on fallbacks
        }

    On any docking-pipeline failure (pod down, no receptor cached, all
    candidates unsynthesisable), falls back to returning the AI's variants
    WITHOUT scores — the frontend's existing per-variant fan-out then
    fills them in or surfaces per-variant errors. Net effect: the user
    always sees variants; in the happy path they're already ranked by
    the docker; in the degraded path they're ranked by the LLM.

    Same auth + AI rate limit (30/hr) as /assist/compound. Same gate as
    /assist/quick_dock — feature-flagged off by default.

    Durable logging (added 2026-05-04 alongside this docstring): every
    call writes a row to optimize_attempt with the request shape, the
    outcome, and the elapsed time, so "why did Optimize fail earlier
    today" reports survive Fly's 15-minute log-buffer rollover. See
    _record_optimize_attempt() below."""
    _check_quick_dock_enabled()
    request_id = uuid.uuid4()
    started_at = time.monotonic()

    # Defend against multi-mutation strings like "G12R, G12V". The Quick
    # Dock front-end already extracts firstMutation, but the editor's
    # Optimize button sends the full job context — so a job opened from
    # KRAS G12R+G12V multi-mutation arrives here as "G12R, G12V" and
    # crashes PDBFixer downstream (it segfaults on `applyMutations(
    # ['GLY-12-ARG', 'GLY-12-VAL'])` — you can't mutate the same residue
    # to two things at once). Symptom: worker exits with code 139, Fly
    # returns "hyper error: connection closed before message completed",
    # UI shows "Optimize failed". Fix: split and use the first mutation,
    # matching what Quick Dock does — keeps Optimize aligned with the
    # parent dock context the user already saw.
    safe_mutations: Optional[str] = payload.mutations
    if safe_mutations and ("," in safe_mutations or ";" in safe_mutations):
        tokens = [t.strip() for t in safe_mutations.replace(";", ",").split(",")]
        tokens = [t for t in tokens if t]
        safe_mutations = tokens[0] if tokens else None
        log.info(
            "optimize_attempt: split multi-mutation %r → %r (Optimize uses single mutation)",
            payload.mutations, safe_mutations,
        )

    log.info(
        "optimize_attempt: starting request_id=%s user=%s target=%s mutations=%s",
        request_id, user.email, payload.target_pdb, safe_mutations,
    )

    result: Optional[dict] = None
    status = "ok"
    error_message: Optional[str] = None
    http_exc: Optional[HTTPException] = None

    try:
        result = await generate_score_filter_optimize(
            smiles=payload.smiles.strip(),
            parent_score=payload.score,
            hits=payload.hits or [],
            misses=payload.misses or [],
            target_pdb=payload.target_pdb or "",
            mutations=safe_mutations,
            parent_pose_pdbqt_b64=payload.parent_pose_pdbqt_b64,
        )
        # 200 OK with no variants is its own outcome — the loop fell back
        # to an undocked response or every candidate was filtered out.
        # Logged distinctly from "ok" so we can spot zero-variant
        # patterns in aggregate without false-positive 5xx alerts.
        if not result or not result.get("variants"):
            status = "no_variants"
            error_message = (result or {}).get("note") or ""
    except asyncio.TimeoutError as e:
        status = "timeout"
        error_message = f"asyncio TimeoutError: {e}"
        http_exc = HTTPException(status_code=504, detail="Optimize timed out — try again.")
    except RuntimeError as e:
        msg = str(e)
        # Same RuntimeError → HTTP-status mapping as before, but now
        # with attempt-table classification too. Anthropic-side issues
        # surface as 503/429; pod-side and unknown as 502.
        if "API key" in msg or "authentication" in msg:
            status = "anthropic_error"
            http_exc = HTTPException(status_code=503, detail=msg)
        elif "rate-limited" in msg:
            status = "anthropic_error"
            http_exc = HTTPException(status_code=429, detail=msg)
        else:
            # The optimize pipeline raises RuntimeError for both
            # Anthropic 5xx and pod 5xx — best-effort classify by the
            # message text. A pod failure usually mentions vina, gpu,
            # or pod; an Anthropic failure usually mentions anthropic
            # or claude.
            lower = msg.lower()
            if "anthropic" in lower or "claude" in lower:
                status = "anthropic_error"
            elif "vina" in lower or "pod" in lower or "gpu" in lower or "dock" in lower:
                status = "pod_error"
            else:
                status = "unknown_error"
            http_exc = HTTPException(status_code=502, detail=msg)
        error_message = msg
    except Exception as e:  # noqa: BLE001 — broad on purpose; we want every failure logged
        status = "unknown_error"
        error_message = f"{type(e).__name__}: {e}"
        http_exc = HTTPException(status_code=500, detail="Optimize failed — please try again.")

    elapsed_ms = int((time.monotonic() - started_at) * 1000)
    _record_optimize_attempt(
        request_id=str(request_id),
        user=user,
        payload=payload,
        result=result,
        status=status,
        elapsed_ms=elapsed_ms,
        error_message=error_message,
    )

    if http_exc is not None:
        raise http_exc

    # `result` is non-None on the happy path AND on no_variants (the
    # optimize_loop fallback returns a result dict with empty variants).
    assert result is not None
    return {
        "variants": [dict(v) for v in result.get("variants", [])],
        "candidates_generated": result.get("candidates_generated", 0),
        "candidates_filtered": result.get("candidates_filtered", 0),
        "candidates_docked": result.get("candidates_docked", 0),
        "candidates_self_rejected": result.get("candidates_self_rejected", 0),
        "candidates_top_up": result.get("candidates_top_up", 0),
        "note": result.get("note", ""),
        # Mutation-aware-scoring transparency (added 2026-05-04). UI uses
        # these to render "Mutant T315I" or "WT only — mutant build failed".
        "receptor_variant": result.get("receptor_variant", "wt"),
        "mutation_caveat": result.get("mutation_caveat", ""),
    }


def _record_optimize_attempt(
    *,
    request_id: str,
    user: CurrentUser,
    payload: "OptimizeRequest",
    result: Optional[dict],
    status: str,
    elapsed_ms: int,
    error_message: Optional[str],
) -> None:
    """Write one row to optimize_attempt. Best-effort — never raises.

    The /assist/optimize handler must not fail because logging failed,
    so we swallow exceptions here (and emit a warning so they're at
    least visible in Fly logs while they're fresh)."""
    # Truncate error_message to 2000 chars to bound row size when an
    # upstream traceback or large JSON blob comes through.
    if error_message and len(error_message) > 2000:
        error_message = error_message[:1997] + "..."

    counts = result or {}
    try:
        with Session(db_engine) as session:
            attempt = OptimizeAttempt(
                user_id=user.id,
                user_email=user.email,
                target_pdb=payload.target_pdb,
                mutations=payload.mutations,
                parent_smiles=(payload.smiles or "").strip()[:2000],
                parent_score=payload.score,
                status=status,
                elapsed_ms=elapsed_ms,
                # candidates_generated is the post-dedupe count from
                # the parallel-AI sampling path; n_raw_variants here
                # mirrors that. The other count fields come straight
                # from optimize_loop's diagnostics dict.
                n_raw_variants=counts.get("candidates_generated"),
                n_unique_variants=counts.get("candidates_generated"),
                n_survivors_sa=counts.get("candidates_filtered"),
                n_docked=counts.get("candidates_docked"),
                n_returned=len(counts.get("variants", [])) if counts else 0,
                error_message=error_message,
                request_id=request_id,
            )
            session.add(attempt)
            session.commit()
    except Exception as e:  # noqa: BLE001
        log.warning(
            "optimize_attempt: failed to persist row (request_id=%s status=%s): %s",
            request_id, status, e,
        )
