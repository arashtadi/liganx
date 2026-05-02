"""AI-assisted compound editing.

Wraps the Anthropic Messages API with a chemistry-focused system prompt
so the rest of the app can ask "given this SMILES, do X" in plain
language and get back a modified SMILES + a one-line rationale. We
deliberately use plain httpx (not the official anthropic SDK) so the
backend's dependency footprint stays small — one HTTP call to one
endpoint isn't worth a transitive dependency tree.

Model: claude-haiku-4-5-20251001 (fast + cheap, ~$1/1M input tokens).
For chemistry-grade reasoning we may upgrade to Sonnet later, but
Haiku handles "swap COOH for tetrazole" / "add a methyl at para"
style edits well in our internal tests.

Output contract: the model is asked to return strict JSON. We parse
defensively (regex fallback for the common case where the model wraps
the JSON in a code fence) and validate the new SMILES with RDKit
before shipping it back. If validation fails we return the LLM's
rationale but flag the edit as `applied=False` so the frontend knows
not to push the broken SMILES into Ketcher.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Optional, TypedDict

import httpx

log = logging.getLogger(__name__)

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
# Conservative timeout — Haiku usually responds in 1-3s. 20s gives
# headroom for a slow upstream without leaving the user staring at a
# spinner forever.
ANTHROPIC_TIMEOUT_S = 20.0
ANTHROPIC_MAX_TOKENS = 1024


class AssistResponse(TypedDict, total=False):
    new_smiles: str
    rationale: str
    warnings: list[str]
    applied: bool   # True iff new_smiles parsed cleanly with RDKit
    raw_model_output: str  # for debugging only; not surfaced in UI


_SYSTEM_PROMPT = """You are a medicinal-chemistry assistant inside Liganx, \
a mutation-aware molecular-docking platform. The user is editing a small \
molecule in a 2D structure editor and wants help making a specific edit \
or improvement to it.

Behavior rules:
- Always return a SINGLE valid SMILES string for the proposed compound.
- The SMILES must parse with RDKit. Prefer canonical-style output.
- Keep edits minimal: change only what the user asked for, plus the \
unavoidable consequences of that change. Do not redesign the molecule.
- One short sentence of rationale: WHY this edit is reasonable, and ONE \
property delta (e.g. "logP +0.4, QED unchanged") if relevant.
- If the user gave a target context (PDB + mutation), prefer edits that \
are plausible for that pocket and mutation. Cite the residue or pocket \
feature briefly in the rationale.
- If the user's request is impossible, dangerous, or chemically meaningless \
(e.g. "swap H for Pb in every position"), say so in the rationale and \
return the ORIGINAL smiles unchanged.

Output format (STRICT — return ONLY this JSON, no preamble, no code fences):
{"new_smiles": "<smiles>", "rationale": "<one sentence>", "warnings": []}

Optional warnings array entries: "PAINS-like substructure introduced", \
"violates Lipinski rule of 5", "synthetically challenging", \
"reactive functional group" — any caveat the user should see."""


def _build_user_prompt(
    *,
    smiles: str,
    instruction: str,
    target_pdb: Optional[str],
    mutations: Optional[str],
) -> str:
    """Assemble the user message. Pocket context is appended only when
    actually present so a generic edit ("make this more soluble") isn't
    polluted with irrelevant target details."""
    parts = [
        f"Current SMILES: {smiles}",
        f"Instruction: {instruction}",
    ]
    if target_pdb:
        ctx = f"Target context: PDB {target_pdb}"
        if mutations:
            ctx += f", mutations: {mutations}"
        parts.append(ctx)
    return "\n".join(parts)


# Match a JSON object even when the model wraps it in ```json … ``` or
# adds preamble text. Greedy + DOTALL because the rationale field can
# contain newlines.
_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _extract_json(raw: str) -> Optional[dict]:
    """Pull the first JSON object out of a model response. Returns None
    if no JSON-shaped block is present or it doesn't parse."""
    if not raw:
        return None
    m = _JSON_BLOCK_RE.search(raw)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass
    return None


_OPTIMIZE_SYSTEM_PROMPT = """You are a medicinal-chemistry assistant inside Liganx. \
The user has just docked a compound against a specific target+mutation \
and wants 3 variant compounds designed to gain contacts at residues the \
original compound MISSED.

Behavior rules:
- Return EXACTLY 3 variants. Each is a SMILES + a one-sentence rationale.
- Each variant must parse with RDKit (canonical-style SMILES).
- Keep edits minimal: change only what's needed to reach the missed \
residues. Do not redesign the molecule.
- Each rationale should name the SPECIFIC missed residue the variant \
targets and the chemical move (e.g. "adds a hydroxyl to reach Tyr541").
- Prefer cheap, well-known medchem moves: bioisostere swap, ring \
extension, hydroxyl/methyl/F addition at a specific position.

Output format (STRICT — return ONLY this JSON, no preamble, no code fences):
{"variants":[{"new_smiles":"<smiles>","rationale":"<sentence>"},{"new_smiles":"<smiles>","rationale":"<sentence>"},{"new_smiles":"<smiles>","rationale":"<sentence>"}]}"""


class OptimizeVariant(TypedDict, total=False):
    new_smiles: str
    rationale: str


async def call_anthropic_optimize(
    *,
    smiles: str,
    score: float,
    hits: list[str],
    misses: list[str],
    target_pdb: Optional[str] = None,
    mutations: Optional[str] = None,
) -> list[OptimizeVariant]:
    """Ask Claude for 3 variant SMILES designed to gain contacts at the
    `misses` residues. Returns a list of {new_smiles, rationale} dicts;
    each new_smiles is RDKit-validated before being included. Empty
    list on parse failure (caller decides how to surface)."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not configured on this server. "
            "Set it via `flyctl secrets set ANTHROPIC_API_KEY=...`."
        )

    parts = [
        f"Current SMILES: {smiles}",
        f"Docked score: {score:.2f} kcal/mol",
        f"Contacts (hits): {', '.join(hits) if hits else '(none reported)'}",
        f"Nearby residues NOT contacted (misses): {', '.join(misses) if misses else '(none reported)'}",
    ]
    if target_pdb:
        ctx = f"Target context: PDB {target_pdb}"
        if mutations:
            ctx += f", mutations: {mutations}"
        parts.append(ctx)
    user_prompt = "\n".join(parts)

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    payload = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": ANTHROPIC_MAX_TOKENS,
        "system": _OPTIMIZE_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_prompt}],
    }

    try:
        async with httpx.AsyncClient(timeout=ANTHROPIC_TIMEOUT_S) as client:
            r = await client.post(ANTHROPIC_API_URL, headers=headers, json=payload)
    except (httpx.TimeoutException, httpx.RequestError) as e:
        log.error("Anthropic optimize network error: %s", e)
        raise RuntimeError(f"AI service unreachable: {e}") from e

    if r.status_code == 401:
        raise RuntimeError("AI service authentication failed (bad API key)")
    if r.status_code == 429:
        raise RuntimeError("AI service rate-limited; please try again in a few seconds")
    if r.status_code >= 400:
        log.error("Anthropic optimize HTTP %d: %s", r.status_code, r.text[:300])
        raise RuntimeError(f"AI service error (HTTP {r.status_code})")

    body = r.json()
    raw_text = ""
    try:
        for block in body.get("content", []):
            if block.get("type") == "text":
                raw_text += block.get("text", "")
    except (AttributeError, TypeError):
        pass

    parsed = _extract_json(raw_text)
    if not parsed:
        log.warning("Anthropic optimize returned non-JSON: %r", raw_text[:300])
        return []

    raw_variants = parsed.get("variants") or []
    if not isinstance(raw_variants, list):
        return []

    from .properties import validate_smiles
    out: list[OptimizeVariant] = []
    for raw in raw_variants[:3]:  # never more than 3 even if model overshoots
        if not isinstance(raw, dict):
            continue
        smi_raw = str(raw.get("new_smiles") or "").strip()
        rationale = str(raw.get("rationale") or "").strip()
        if not smi_raw:
            continue
        valid, canonical, _ = validate_smiles(smi_raw)
        if not valid or not canonical:
            log.info("optimize variant rejected (RDKit): %r", smi_raw)
            continue
        out.append(OptimizeVariant(new_smiles=canonical, rationale=rationale))
    return out


async def call_anthropic(
    *,
    smiles: str,
    instruction: str,
    target_pdb: Optional[str] = None,
    mutations: Optional[str] = None,
) -> AssistResponse:
    """Single-turn Anthropic call. Returns AssistResponse with new_smiles
    + rationale on success, or raises RuntimeError on auth/network/quota
    failures (caller maps those to 503/502 HTTPException)."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not configured on this server. "
            "Set it via `flyctl secrets set ANTHROPIC_API_KEY=...`."
        )

    user_prompt = _build_user_prompt(
        smiles=smiles, instruction=instruction,
        target_pdb=target_pdb, mutations=mutations,
    )

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    payload = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": ANTHROPIC_MAX_TOKENS,
        "system": _SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_prompt}],
    }

    try:
        async with httpx.AsyncClient(timeout=ANTHROPIC_TIMEOUT_S) as client:
            r = await client.post(ANTHROPIC_API_URL, headers=headers, json=payload)
    except (httpx.TimeoutException, httpx.RequestError) as e:
        log.error("Anthropic API network error: %s", e)
        raise RuntimeError(f"AI service unreachable: {e}") from e

    if r.status_code == 401:
        log.error("Anthropic API rejected our key (401)")
        raise RuntimeError("AI service authentication failed (bad API key)")
    if r.status_code == 429:
        log.warning("Anthropic API rate limited us (429)")
        raise RuntimeError("AI service rate-limited; please try again in a few seconds")
    if r.status_code >= 400:
        log.error("Anthropic API HTTP %d: %s", r.status_code, r.text[:300])
        raise RuntimeError(f"AI service error (HTTP {r.status_code})")

    body = r.json()
    # Messages API response shape: {"content": [{"type":"text","text":"..."}]}
    raw_text = ""
    try:
        for block in body.get("content", []):
            if block.get("type") == "text":
                raw_text += block.get("text", "")
    except (AttributeError, TypeError):
        pass

    parsed = _extract_json(raw_text)
    if not parsed:
        log.warning("Anthropic returned non-JSON response: %r", raw_text[:300])
        return AssistResponse(
            new_smiles=smiles,
            rationale=(raw_text[:240] if raw_text else "AI returned an unparseable response."),
            warnings=["AI response was not valid JSON; original structure preserved."],
            applied=False,
            raw_model_output=raw_text,
        )

    # Pull required fields with safe fallbacks. Empty string is treated
    # as "no change" so the client just gets the original SMILES back.
    new_smi_raw = str(parsed.get("new_smiles") or "").strip()
    rationale = str(parsed.get("rationale") or "").strip()
    warnings_raw = parsed.get("warnings") or []
    warnings = [str(w) for w in warnings_raw if isinstance(w, (str, int, float))][:5]

    # Validate the new SMILES with RDKit BEFORE returning. If the model
    # produced an unparseable string we keep its rationale (might still
    # be informative) but flag applied=False so the frontend doesn't
    # push the broken SMILES into Ketcher.
    from .properties import validate_smiles
    valid, canonical, err = validate_smiles(new_smi_raw)
    if not valid:
        log.info("AI-suggested SMILES failed RDKit validation: %s (raw=%r)", err, new_smi_raw)
        return AssistResponse(
            new_smiles=smiles,
            rationale=rationale or "AI returned an invalid SMILES.",
            warnings=[*warnings, f"AI's suggested structure didn't parse: {err}. Keeping the original."],
            applied=False,
            raw_model_output=raw_text,
        )

    return AssistResponse(
        new_smiles=canonical,
        rationale=rationale,
        warnings=warnings,
        applied=True,
        raw_model_output=raw_text,
    )
