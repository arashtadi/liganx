"""Liganx AI Beta — Q&A over the data visible on a JobPage.

This service is intentionally NARROWER than the assist/optimize flows:
the user asks a free-form question, the model answers in plain text
(no JSON contract, no SMILES editing). The grounding is a structured
JSON snapshot of what the page is showing — selectivity matrix scores,
pose-validation flags, ADMET probabilities, target/mutation metadata.

Why this is its own module rather than an addition to ai_assistant.py:
the assist flow is locked to a strict JSON output contract (so it can
overwrite the editor canvas safely). The ask flow ships natural-text
back to a chat panel — different output shape, different prompt, and
we want to be able to evolve them independently.

System-prompt design rules (these are load-bearing — read before
editing):

  1. Scope is HARD-LIMITED to the payload. The model is told NOT to
     extrapolate to PubMed, literature, or general medicinal-chemistry
     knowledge beyond what's needed to define a term that appears on
     the page. This matters because the alternative — letting the
     model recall arbitrary trial data, clinical outcomes, or PK
     numbers — turns a docking-page chat into a hallucination engine
     that looks authoritative.

  2. Score direction is stated EXPLICITLY in the payload, not just in
     the system prompt. Vina/GNINA: lower is stronger (kcal/mol).
     Boltz-2: lower log10 IC50 is stronger (μM). Δ direction is the
     #1 thing chemists invert in conversation, so we pin it down.

  3. The model is allowed to say "I don't know" or "this isn't shown
     on the page" — encouraged, actually. Better than fabricating.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Optional

import httpx
from pydantic import BaseModel

log = logging.getLogger(__name__)

# Endpoint + model constants are duplicated from ai_assistant.py (rather
# than imported) so the two flows can be tuned independently — the ask
# endpoint may want a different model (Sonnet for nuance) or a longer
# token budget than the SMILES-edit endpoint.
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
# Haiku 4.5 is fast (~1-2s for a 200-token answer) and cheap enough that
# we can keep the free tier generous. Sonnet would give better nuance on
# "which compound looks best?" multi-step reasoning but at ~10× the cost
# and ~3× the latency. Keep Haiku unless quality complaints surface.
ASK_MODEL = os.environ.get("ASK_AI_MODEL", "claude-haiku-4-5-20251001")
ASK_MAX_TOKENS = int(os.environ.get("ASK_AI_MAX_TOKENS", "800"))
ASK_TIMEOUT_S = float(os.environ.get("ASK_AI_TIMEOUT_S", "25"))


# ──────────────────────────────────────────────────────────────────────
# System prompt — see file docstring for the design rules. Edit with
# care; the scope-limiting language is what keeps this from drifting
# into a general chatbot.
# ──────────────────────────────────────────────────────────────────────
_ASK_SYSTEM_PROMPT = """You are Liganx AI Beta — a co-pilot embedded in \
the Liganx docking results page. The user is looking at a specific job's \
results and may ask you to explain numbers, badges, terms, or to compare \
compounds. You have access to a structured snapshot of what's on the page \
(provided in the user message as JSON under the heading PAGE CONTEXT).

# What you should do
- Answer based on the PAGE CONTEXT. Quote specific numbers, residue \
codes, mutation codes, and badge labels from it when relevant.
- Define terms that appear on the page (Δ, Vinardo, PoseBusters, \
outside-pocket, hERG, BBB, CYP, AMES, etc.) in 1-3 sentences when asked.
- Compare compounds, rank them, or summarize a row's strengths and \
weaknesses using only the data shown.
- Flag UNRELIABLE data when the page already flags it: outside-pocket \
cells, |Δ| < 1 kcal/mol within noise, PoseBusters Suspect verdicts, \
failed dockings. Don't ignore these flags when summarizing.

# What you must NOT do
- Do NOT extrapolate to clinical, in vivo, or general drug-discovery \
claims that aren't in the payload. Examples of what to refuse: "what \
is the IC50 of this drug in cells", "has this compound been tried in \
humans", "what is sotorasib's known mechanism of action". Respond with \
"That isn't on this page — I'm scoped to the data shown here."
- Do NOT invent residue names, protein domain names, mutation effects, \
trial outcomes, or PK numbers. If it isn't in the PAGE CONTEXT, you \
don't know it.
- Do NOT recommend medical decisions or claim a compound is safe / \
effective / approvable.

# Score-direction glossary (memorize this)
- vina, gnina: best_score in kcal/mol. LOWER is stronger binding. \
Typical range -10 (excellent) to -5 (weak). 0 means failed docking.
- boltz2: best_score is log10(IC50 in μM). LOWER is stronger.
- Δ vs WT (mutant_score - wt_score): NEGATIVE Δ = mutant binds tighter \
than WT (selectivity gain or resistance fix). POSITIVE Δ = mutant binds \
weaker (resistance escape). |Δ| < 1 kcal/mol is within typical Vina \
run-to-run noise.

# Badges glossary
- "outside pocket" (amber): the mutation residue sits outside Vina's \
search box. The Δ for that cell is method noise, not a real signal.
- PoseBusters "Passed" / "Caution" / "Suspect" / "Skipped": pose-physics \
validation tiers. Suspect = 3+ checks failed (likely a junk pose).
- ADMET tiers (low/medium/high): probability tiers from admet-ai's TDC \
suite. "low" risk is good for toxicity endpoints (hERG, AMES, DILI); \
"high" probability is good for absorption endpoints (HIA, oral \
bioavailability). The page's higher_is_better flag handles direction.

# Tone and length
- Be a working chemist's co-pilot, not a textbook. 1-4 short paragraphs \
unless they asked for an exhaustive answer.
- Use the user's terminology back. If they say "this drug" not "this \
compound", mirror that.
- It is FINE to say "I don't see that on the page" or "the data on the \
page doesn't tell us that, but [related thing it does show]".
- No markdown headers. Light use of bold for compound or residue names \
is fine. No bullet lists unless the question is itemized (e.g. \
"give me three reasons compound 1 looks bad").
"""


def _summarize_extra(extra: Optional[str]) -> dict[str, Any]:
    """Best-effort parse of the per-cell `extra` field from DockingResult.

    The runner writes pipe-delimited key=value strings (NOT JSON), e.g.:

        pocket=catalog|engine=pod_gpu_batch|vinardo=-4.62|water=6/9|
        confidence=unknown|strain=mild:1.76|posebusters=passed all 0 checks|
        contacts=SER17:VdWC:2.6,ASP30:VdWC:2.7|mutation_outside_pocket=19.2A

    Failure rows use a bare prefix (no `=`):

        ligand_prep_failed: <reason>
        mutant_build_failed:MutateError:Residue ... not found ...|engine=...

    We mirror the frontend's `parseExtra` (lib/parseExtra.ts) so the AI
    payload sees the same flags the UI surfaces. The first version of
    this function tried to JSON-parse the field and silently dropped
    every flag including outside-pocket — caused the Liganx AI Beta
    panel to confidently say "no outside-pocket flag here" on jobs
    where the matrix UI was loudly showing it.
    """
    if not extra:
        return {}
    out: dict[str, Any] = {}

    # Failure prefix detection — the runner writes these as bare strings
    # before any `|key=value` block, exactly like the TS parser handles.
    failure_match = re.match(
        r"^(ligand_prep_failed|docking_failed|mutant_build_failed):([^|]*)",
        extra,
    )
    if failure_match:
        tag = failure_match.group(1)
        kind = (
            "ligand_prep" if tag == "ligand_prep_failed"
            else "docking" if tag == "docking_failed"
            else "mutant_build"
        )
        out["failure"] = {"kind": kind, "reason": failure_match.group(2).strip()}
        # For ligand_prep / docking the remainder is meaningless; bail.
        # For mutant_build the runner may attach engine/vinardo from the
        # WT-fallback dock, so keep parsing.
        if kind != "mutant_build":
            return out

    for part in extra.split("|"):
        eq = part.find("=")
        if eq == -1:
            continue
        key = part[:eq].strip()
        val = part[eq + 1:].strip()
        if not val:
            continue
        if key == "engine":
            out["engine"] = val
        elif key == "confidence" and val in ("high", "medium", "low", "unknown"):
            out["confidence"] = val
        elif key == "posebusters":
            out["poseBusters"] = val
        elif key == "vinardo":
            try:
                out["vinardo"] = float(val)
            except ValueError:
                pass
        elif key == "strain":
            # Format: verdict:kcal — e.g. "mild:1.94"
            parts = val.split(":", 1)
            if len(parts) == 2 and parts[0] in ("ok", "mild", "high"):
                try:
                    out["strain"] = {"verdict": parts[0], "kcal": float(parts[1])}
                except ValueError:
                    pass
        elif key == "mutation_outside_pocket":
            # Format: "19.2A" — CA-to-pocket-center distance in Å.
            m = re.match(r"^([\d.]+)A?$", val)
            if m:
                try:
                    out["outsidePocketA"] = float(m.group(1))
                except ValueError:
                    pass
        elif key == "aff_value":
            try:
                out["affValue"] = float(val)
            except ValueError:
                pass
        elif key == "aff_prob":
            try:
                out["affProb"] = float(val)
            except ValueError:
                pass
        elif key == "water":
            m = re.match(r"^(\d+)/(\d+)$", val)
            if m:
                out["water"] = {
                    "displaced": int(m.group(1)),
                    "pocket_count": int(m.group(2)),
                }
        elif key == "contacts":
            # Comma-separated RES:Type or RES:Type:Å. We don't ship the
            # full list (could be 20+ residues per cell) — just count
            # and keep the first few for the model.
            items = [s.strip() for s in val.split(",") if s.strip()]
            if items:
                out["contacts_count"] = len(items)
                out["contacts_sample"] = [s.split(":")[0] for s in items[:6]]

    # Promote PoseBusters "skipped" exactly like the TS parser does, so
    # the AI sees the same UX category the matrix shows.
    pb = out.get("poseBusters")
    conf = out.get("confidence", "unknown")
    if (
        (conf == "unknown" or "confidence" not in out)
        and pb
        and (re.search(r"check_skipped", pb, re.I) or re.search(r"passed all 0 checks", pb, re.I))
    ):
        out["confidence"] = "skipped"

    return out


def build_job_context(job: Any) -> dict[str, Any]:
    """Pack a Job ORM object into the structured JSON the system prompt
    expects. Caller passes a freshly-loaded `Job` with `.compounds` and
    `.results` populated (selectinload, or just a regular relationship
    access — SQLAlchemy will lazy-load).

    Output shape (kept stable — model is trained on it):
      {
        "job": {target, mutations, engine, status, ...},
        "score_direction": {"unit": "kcal/mol", "interpretation": "lower_is_stronger"},
        "compounds": [{id, name, smiles, admet: {...subset...}}, ...],
        "results": [{compound, variant, score, delta_vs_wt, flags: {...}}, ...]
      }
    """
    # Build a score lookup so we can compute Δ-vs-WT per cell. The
    # frontend does the same trick in `enriched` in SelectivityMatrix.
    score_by_pair: dict[tuple[int, str], float] = {}
    for r in job.results:
        # Skip failure rows — best_score=0 is a placeholder, not a real
        # score, and feeding 0s would confuse the model.
        ext = _summarize_extra(r.extra)
        if "failure" in ext:
            continue
        score_by_pair[(r.compound_id, r.variant)] = r.best_score

    # Engine detection mirrors the TS detectedEngine memo: take the
    # first non-failure row's engine tag.
    engine_tag: Optional[str] = None
    for r in job.results:
        ext = _summarize_extra(r.extra)
        if ext.get("engine"):
            engine_tag = ext["engine"]
            break
    is_boltz2 = bool(engine_tag and engine_tag.startswith("boltz2"))
    score_direction = {
        "engine": engine_tag or job.engine,
        "unit": "log10(IC50 μM)" if is_boltz2 else "kcal/mol",
        "interpretation": "lower_is_stronger",
        "delta_meaning": (
            "delta = mutant_score - wt_score. NEGATIVE = mutant binds "
            "tighter than WT. |delta| < 1.0 kcal/mol is within typical "
            "single-seed Vina noise."
        ),
    }

    # Compounds — name + smiles + a TRIMMED admet view. We deliberately
    # don't ship the full 41-endpoint dump on every call (~6kb each);
    # instead we ship the headline 5-channel block (hERG, BBB, CYP3A4,
    # AMES, oral bioavailability) which is what the chips show by
    # default. The expanded view is loaded lazily by the frontend; if
    # the user opens it and then asks a follow-up, the panel re-sends
    # the now-visible payload.
    compounds_block: list[dict[str, Any]] = []
    for c in job.compounds:
        admet = getattr(c, "_cached_admet", None)
        # The Job ORM model doesn't attach admet to Compound directly —
        # the JobOut serializer does. For the ask payload we either
        # leave admet out or pass it through if the caller pre-loaded
        # it. Frontend always re-sends ADMET separately, so don't
        # block on it here.
        entry: dict[str, Any] = {
            "id": c.id,
            "name": c.name or f"compound_{c.id}",
            "smiles": c.smiles,
        }
        if admet:
            entry["admet"] = admet
        compounds_block.append(entry)

    # Results — one row per (compound, variant), with Δ-vs-WT inlined
    # and flags surfaced so the model doesn't have to know how to
    # parse the `extra` blob itself.
    results_block: list[dict[str, Any]] = []
    for r in job.results:
        ext = _summarize_extra(r.extra)
        wt_score = score_by_pair.get((r.compound_id, "WT"))
        delta_vs_wt: Optional[float] = None
        if r.variant != "WT" and wt_score is not None and "failure" not in ext:
            delta_vs_wt = round(r.best_score - wt_score, 3)
        row: dict[str, Any] = {
            "compound_id": r.compound_id,
            "variant": r.variant,
            "score": round(r.best_score, 3) if "failure" not in ext else None,
        }
        if delta_vs_wt is not None:
            row["delta_vs_wt"] = delta_vs_wt
        flags: dict[str, Any] = {}
        if "failure" in ext:
            flags["failed"] = ext["failure"]
        if "outsidePocketA" in ext:
            flags["outside_pocket_angstroms"] = ext["outsidePocketA"]
            flags["outside_pocket"] = True
        if "vinardo" in ext:
            row["vinardo_score"] = ext["vinardo"]
        if "strain" in ext and isinstance(ext["strain"], dict):
            flags["pose_strain"] = ext["strain"].get("verdict")
        if "confidence" in ext:
            flags["pose_busters_verdict"] = ext["confidence"]
        if flags:
            row["flags"] = flags
        results_block.append(row)

    return {
        "job": {
            "id": job.id,
            "share_id": job.share_id,
            "target_pdb": job.pdb_id,
            "chain": job.chain,
            "uniprot_id": job.uniprot_id,
            "mutations": [m for m in (job.mutations or "").split(",") if m],
            "engine": job.engine,
            "exhaustiveness": job.exhaustiveness,
            "include_wt": job.include_wt,
            "status": str(job.status.value if hasattr(job.status, "value") else job.status),
            "title": job.title,
        },
        "score_direction": score_direction,
        "compounds": compounds_block,
        "results": results_block,
    }


def _build_ask_user_prompt(*, context: dict[str, Any], question: str) -> str:
    """Compose the user message: the structured payload first (so the
    model anchors on it before reading the question), then the user's
    actual prompt. Keeping the payload first matches the Anthropic
    cookbook recommendation for grounded-Q&A."""
    return (
        "PAGE CONTEXT (JSON snapshot of what the user is looking at — "
        "answer only from this, no extrapolation):\n"
        + json.dumps(context, separators=(",", ":"))
        + "\n\nQUESTION:\n"
        + question.strip()
    )


class AskResult(BaseModel):
    """Returned to the router."""
    answer: str
    model: str


async def ask_claude_about_job(*, context: dict[str, Any], question: str) -> AskResult:
    """Single-shot Q&A call. Returns AskResult with the model's plain-text
    answer, or raises RuntimeError for auth/network/quota failures (router
    maps those to 503/502)."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not configured on this server. "
            "Set it via `flyctl secrets set ANTHROPIC_API_KEY=...`."
        )

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    payload = {
        "model": ASK_MODEL,
        "max_tokens": ASK_MAX_TOKENS,
        "system": _ASK_SYSTEM_PROMPT,
        "messages": [
            {"role": "user", "content": _build_ask_user_prompt(
                context=context, question=question,
            )},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=ASK_TIMEOUT_S) as client:
            r = await client.post(ANTHROPIC_API_URL, headers=headers, json=payload)
    except (httpx.TimeoutException, httpx.RequestError) as e:
        log.error("Liganx AI: Anthropic network error: %s", e)
        raise RuntimeError(f"AI service unreachable: {e}") from e

    if r.status_code == 401:
        log.error("Liganx AI: Anthropic rejected our key (401)")
        raise RuntimeError("AI service authentication failed")
    if r.status_code == 429:
        log.warning("Liganx AI: Anthropic rate limited us (429)")
        raise RuntimeError("AI service is busy — please try again in a moment")
    if r.status_code >= 400:
        log.error("Liganx AI: Anthropic HTTP %d: %s", r.status_code, r.text[:300])
        raise RuntimeError(f"AI service error (HTTP {r.status_code})")

    body = r.json()
    text_chunks: list[str] = []
    try:
        for block in body.get("content", []):
            if block.get("type") == "text":
                text_chunks.append(block.get("text", ""))
    except (AttributeError, TypeError):
        pass
    answer = "".join(text_chunks).strip()
    if not answer:
        # Edge case — model returned an empty content array (rare; happens
        # when the input is filtered or hits a token-budget edge). Give the
        # user a friendly fallback rather than an empty bubble.
        answer = (
            "I couldn't generate an answer for that one. Try rephrasing — "
            "for example: 'explain the outside-pocket badge', 'which "
            "compound looks best?', or 'what does Vinardo mean?'"
        )

    return AskResult(answer=answer, model=ASK_MODEL)
