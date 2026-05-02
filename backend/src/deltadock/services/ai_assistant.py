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
# spinner forever. Bumped to 40s when the medchem-phd skill is in
# use, since lazy-loading a reference (boltz2.md, mutation_classes.md)
# adds a roundtrip and the code-execution tool can take a few extra
# seconds to spin up.
ANTHROPIC_TIMEOUT_S = 20.0
ANTHROPIC_TIMEOUT_WITH_SKILL_S = 60.0
# Without the skill: 1024 is plenty for a single JSON answer.
# With the skill: the model reads SKILL.md (~3500 tokens) plus typically
# one reference (~1500 tokens) via the code_execution tool, then produces
# the final JSON. Each tool roundtrip adds intermediate text blocks. 4096
# leaves headroom; observed 2500-3500 typical.
ANTHROPIC_MAX_TOKENS = 1024
ANTHROPIC_MAX_TOKENS_WITH_SKILL = 4096

# Workspace-level Skill ID for the medchem-phd skill (uploaded at
# https://platform.claude.com/workspaces/default/skills). When set,
# every /assist/compound and /assist/optimize call attaches the skill
# to the request via the `container.skills[]` field, so Claude has
# the full medicinal-chemistry reference library (Boltz-2 conventions,
# mutation classes, anti-patterns, modification taxonomy) available
# on demand. Lazy-loaded — references only consume tokens when the
# model decides it needs them. Set via:
#   flyctl secrets set MEDCHEM_PHD_SKILL_ID=skill_01... --app liganx-api
# When unset (e.g. local dev without API access to the workspace),
# the calls fall back to the inline _SYSTEM_PROMPT chemistry rules.
MEDCHEM_PHD_SKILL_ID = os.environ.get("MEDCHEM_PHD_SKILL_ID", "").strip()

# Beta features required to use workspace skills via the Messages API.
# Per Anthropic docs:
#   skills-2025-10-02       — opt-in to the skills feature itself
#   code-execution-2025-08-25 — required runtime tool that skills
#                                use to read their bundled markdown
#                                references. Without this, custom
#                                skills can attach but can't be loaded.
#   files-api-2025-04-14    — referenced files / attachments
ANTHROPIC_SKILLS_BETA = (
    "skills-2025-10-02,code-execution-2025-08-25,files-api-2025-04-14"
)


class AssistResponse(TypedDict, total=False):
    new_smiles: str
    rationale: str
    warnings: list[str]
    applied: bool   # True iff new_smiles parsed cleanly with RDKit
    raw_model_output: str  # for debugging only; not surfaced in UI


_SYSTEM_PROMPT = """You are a medicinal-chemistry assistant inside Liganx, \
a mutation-aware molecular-docking platform. The user is editing a small \
molecule in a 2D structure editor and wants a specific edit.

CONSULT the medchem-phd skill for the chemistry knowledge you need: \
mutation classes (gatekeeper / activation-loop / covalent / allosteric), \
Type I vs Type II inhibitor selection, scoring conventions, \
bioisosteric replacements, lead-optimisation principles, and the \
anti-patterns to avoid (rigidification trade-off, desolvation cost, \
inventing residue names, treating low cellular activity as bad binding). \
The skill's references contain the full literature-anchored guidance.

Output contract (STRICT — return ONLY this JSON, no preamble, no code fences):
{"new_smiles": "<smiles>", "rationale": "<one sentence>", "warnings": []}

Hard rules:
- The SMILES MUST parse with RDKit. Prefer canonical-style output.
- Keep edits minimal: only what the user asked for, no full redesign.
- Rationale is ONE sentence; if it cites a literature precedent, the \
precedent must be real (Ponatinib, Vemurafenib, etc. — never invent).
- If the user's request is impossible, dangerous, or out of scope \
(e.g. predict absolute Kd, kinome-wide selectivity), say so in the \
rationale and return the ORIGINAL smiles unchanged.
- Optional warnings entries: "PAINS-like substructure introduced", \
"violates Lipinski rule of 5", "synthetically challenging", \
"reactive functional group", "may not improve binding due to \
desolvation cost", "stereochemistry ambiguous"."""


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


def _build_request(*, system_prompt: str, user_prompt: str) -> tuple[dict, dict, float]:
    """Build the (headers, payload, timeout) tuple for an Anthropic Messages
    API call, automatically attaching the medchem-phd workspace skill
    when MEDCHEM_PHD_SKILL_ID is configured.

    Returns the timeout to use for the call — bumped when the skill is
    attached, since lazy-loading a reference adds a roundtrip.
    """
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
        "model": ANTHROPIC_MODEL,
        "max_tokens": ANTHROPIC_MAX_TOKENS,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_prompt}],
    }
    timeout = ANTHROPIC_TIMEOUT_S

    if MEDCHEM_PHD_SKILL_ID:
        # Skill-loading roundtrips need a bigger token budget — see the
        # ANTHROPIC_MAX_TOKENS_WITH_SKILL comment for sizing rationale.
        payload["max_tokens"] = ANTHROPIC_MAX_TOKENS_WITH_SKILL
        # Attach the workspace skill so Claude has the full medchem-phd
        # reference library available on demand. The code-execution tool
        # is required by Anthropic's skills runtime to load reference
        # files; without it the skill is rejected at the API layer even
        # if the skill_id is valid.
        headers["anthropic-beta"] = ANTHROPIC_SKILLS_BETA
        payload["container"] = {
            "skills": [
                {
                    "type": "custom",
                    "skill_id": MEDCHEM_PHD_SKILL_ID,
                    "version": "latest",
                }
            ]
        }
        payload["tools"] = [
            {"type": "code_execution_20250825", "name": "code_execution"}
        ]
        timeout = ANTHROPIC_TIMEOUT_WITH_SKILL_S

    return headers, payload, timeout


# Match a JSON object even when the model wraps it in ```json … ``` or
# adds preamble text. Greedy + DOTALL because the rationale field can
# contain newlines.
_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _extract_json(raw: str) -> Optional[dict]:
    """Pull the JSON object out of a model response. Returns None if no
    JSON-shaped block is present or it doesn't parse.

    When the model uses tools (skills via code_execution), the response
    contains intermediate "thinking" text plus a final JSON answer. The
    intermediate text often includes braces from code snippets the model
    showed while reasoning. We try the LAST balanced-brace block first
    (the model's final answer), and only fall back to the greedy regex
    if that fails — this matches the Anthropic streaming convention
    where the model's final answer is always at the end."""
    if not raw:
        return None

    # Try last-occurrence parse first: scan from the right for the last
    # `}`, then find its matching `{` by walking left.
    last_close = raw.rfind("}")
    if last_close != -1:
        depth = 0
        for i in range(last_close, -1, -1):
            ch = raw[i]
            if ch == "}":
                depth += 1
            elif ch == "{":
                depth -= 1
                if depth == 0:
                    candidate = raw[i : last_close + 1]
                    try:
                        obj = json.loads(candidate)
                        if isinstance(obj, dict):
                            return obj
                    except json.JSONDecodeError:
                        break  # try the greedy fallback
                    break

    # Greedy fallback for malformed nested braces (rare).
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

CONSULT the medchem-phd skill for: mutation classes and which design \
moves apply, the disjunction/conjunction/special-approaches modification \
taxonomy (use it to FORCE diversity across the 3 variants), worked drug \
precedents (Ponatinib alkyne for T315I, Asciminib allosteric, Pirtobrutinib \
non-covalent for C481S, Vemurafenib hydrophobic-fill for V600E, Avapritinib \
active-state for D816V), and the trade-offs to flag (rigidification matching \
bioactive conformation, desolvation cost of polar additions, stereochemistry \
non-equivalence).

Output contract (STRICT — return ONLY this JSON, no preamble, no code fences):
{"variants":[{"new_smiles":"<smiles>","rationale":"<sentence>"},{"new_smiles":"<smiles>","rationale":"<sentence>"},{"new_smiles":"<smiles>","rationale":"<sentence>"}]}

Hard rules:
- Return EXACTLY 3 variants. Each SMILES MUST parse with RDKit \
(canonical-style).
- DIVERSITY > MAGNITUDE. The 3 variants must span DIFFERENT design axes \
(use the modification taxonomy from the skill — one disjunction-style, \
one conjunction-style, one special-approach — NOT three variations of \
the same move).
- DO NOT INVENT RESIDUE NAMES. Only refer to residues that appear \
verbatim in the `hits` or `misses` lists in the user message. If a \
variant doesn't target a specific residue from those lists, describe \
the move generically ("adds a fluorine for metabolic stability") \
without inventing a residue label."""


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

    headers, payload, timeout = _build_request(
        system_prompt=_OPTIMIZE_SYSTEM_PROMPT, user_prompt=user_prompt
    )

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
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
    user_prompt = _build_user_prompt(
        smiles=smiles, instruction=instruction,
        target_pdb=target_pdb, mutations=mutations,
    )

    headers, payload, timeout = _build_request(
        system_prompt=_SYSTEM_PROMPT, user_prompt=user_prompt
    )

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
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
