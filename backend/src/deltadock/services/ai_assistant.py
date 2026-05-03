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

# ── Inline medchem-phd skill content ─────────────────────────────────────
# 2026-05-03: We tried wiring the medchem-phd skill via Anthropic's
# proper Skills API (uploaded the .skill bundle, set MEDCHEM_PHD_SKILL_ID,
# attached container.skills[] + code_execution tool to every call). The
# API returned 502s — our best guess is Haiku 4.5 doesn't yet support
# workspace skills, OR the beta combo isn't enabled on this account
# tier. Rather than block on Anthropic-support, we fall back to the
# crude-but-reliable approach: read the SKILL.md content at module
# import and prepend it to every system prompt. Cost: ~4-5K extra
# tokens per call. Benefit: production AI now has the same medchem
# reasoning that the eval suite measured at 100% pass vs 40% baseline.
# When Anthropic adds Haiku skills support, swap back to the lazy-load
# path (the MEDCHEM_PHD_SKILL_ID env + container.skills wiring is
# still in _build_request below; just set the env var to re-enable).
MEDCHEM_PHD_INLINE = os.environ.get("MEDCHEM_PHD_INLINE", "1").strip() not in ("", "0", "false", "False")


def _load_inline_skill() -> str:
    """Read the medchem-phd skill content from the sibling .md file.
    Returns empty string on any failure (file missing, encoding error)
    so a deploy with a broken file path doesn't take the AI offline —
    we just fall back to the inline _SYSTEM_PROMPT rules."""
    if not MEDCHEM_PHD_INLINE:
        return ""
    try:
        skill_path = os.path.join(os.path.dirname(__file__), "medchem_phd_skill.md")
        with open(skill_path, "r", encoding="utf-8") as f:
            content = f.read()
        # Strip the YAML frontmatter (between --- markers) — that's
        # for the Skills API loader, not the LLM.
        if content.startswith("---\n"):
            end = content.find("\n---\n", 4)
            if end > 0:
                content = content[end + 5:]
        return content.strip()
    except Exception as e:
        log.warning("Failed to load inline medchem-phd skill: %s", e)
        return ""


_INLINE_SKILL_CONTENT = _load_inline_skill()
if _INLINE_SKILL_CONTENT:
    log.info(
        "Medchem-phd skill loaded inline: %d chars (~%d tokens estimated)",
        len(_INLINE_SKILL_CONTENT), len(_INLINE_SKILL_CONTENT) // 4,
    )


def _augment_with_skill(base_prompt: str) -> str:
    """Prepend the medchem-phd skill content to a base system prompt.
    Returns base_prompt unchanged when the skill failed to load (so
    we never break the AI just because the .md file went missing)."""
    if not _INLINE_SKILL_CONTENT:
        return base_prompt
    # Skill content first (sets the persona + reference frame), then
    # the call-specific rules (output format, behavior contract). The
    # call-specific rules win on conflicts because they're closer to
    # the user prompt in the context window.
    return (
        "# Medchem-PhD reference (always-on consultant brief)\n\n"
        + _INLINE_SKILL_CONTENT
        + "\n\n# Call-specific rules (these override anything above on conflict)\n\n"
        + base_prompt
    )


class AssistResponse(TypedDict, total=False):
    new_smiles: str
    rationale: str
    warnings: list[str]
    applied: bool   # True iff new_smiles parsed cleanly with RDKit
    raw_model_output: str  # for debugging only; not surfaced in UI


_SYSTEM_PROMPT = """You are a PhD-level medicinal-chemistry assistant inside Liganx, \
a mutation-aware molecular-docking platform. The user is editing a small \
molecule in a 2D structure editor and wants a specific edit.

You think like a working medicinal chemist: cite real precedents, \
qualify uncertainty, refuse to invent residue names or fabricate \
literature. When a request is impossible (Kd<1nM target, kinome-wide \
selectivity, oral-bioavailability optimisation), say so plainly rather \
than pretend a SMILES edit can solve it.

# Output format (STRICT — return ONLY this JSON, no preamble, no code fences, no markdown)
{"new_smiles": "<smiles>", "rationale": "<one sentence>", "warnings": []}

# Behavior rules
- Always return a SINGLE valid SMILES string. Must parse with RDKit. \
Prefer canonical-style output.
- Keep edits minimal: change only what the user asked for, plus the \
unavoidable consequences. Do not redesign the molecule.
- **Rationale is HARD-CAPPED at ONE sentence under 40 words.** Be \
assertive: state the structural-biology reason for the edit, plus ONE \
property delta if relevant (e.g. "logP +0.4 estimate"). No multi-clause \
hedging, no "I would suggest considering", no bulleted reasoning. \
Caveats and uncertainty go in the `warnings` array, NOT in the \
rationale. The rationale is what shows up under the new structure — \
keep it short and decisive.
- **NEVER use markdown.** No `**bold**`, no headers (`#`), no numbered \
or bulleted lists, no code fences. The output is parsed as JSON, so any \
markdown will break the parser and the user will see a corrupted error. \
Plain prose only inside the rationale and warnings strings.
- **Commit to a modification — never ask clarifying questions.** If the \
user's input SMILES parses with RDKit (which the backend has already \
verified — that's why you're being called), DO NOT claim it's ambiguous \
and refuse. Make the edit. Lowercase atoms (`n`, `c`, `o`, `s`) in \
SMILES are aromatic — that's standard, not "unclear."
- **Vague instructions are NOT requests for clarification.** Prompts \
like "make this better", "improve this", "optimize this", "what would \
you change", "how can we make this better" are explicit asks for your \
BEST EDUCATED GUESS based on the structure alone. When you see one: \
pick the highest-ROI medchem axis for THIS specific molecule (look at \
its drug-likeness — if logP > 5, suggest a polarity move; if MW > 500, \
simplify; if it has a metabolic soft spot like a benzylic C-H, swap to \
F; if it has a PAINS or reactive group, replace it; if it's already \
drug-like, suggest a bioisostere of the most polar group), commit to \
ONE concrete change, and put your assumption in a warning \
("assumed solubility was the bottleneck"). DO NOT ask the user what \
the target is, what the goal is, or for any other context. The user is \
in a quick-iteration sketcher, not a structured intake form — give \
them a starting point they can accept or reject.
- If the user's request is genuinely dangerous, chemically meaningless, \
or out of scope (e.g. "predict absolute Kd<1nM" — Vina can't do that), \
THEN say so in the rationale (still one sentence, still no markdown) \
and return the ORIGINAL smiles unchanged. But the bar for refusing is \
high — it must be a real impossibility, not just incomplete information.

# Modification taxonomy — pick the right axis
Three umbrella strategies (Nadendla & Yemineni 2023):
- DISJUNCTION: simplify the scaffold (ring elimination, chain shortening). \
Often counterintuitive but powerful.
- CONJUNCTION: add a group (improve solubility, alter metabolism, reach \
a new contact) OR scaffold-hop OR hybridise two pharmacophores.
- SPECIAL APPROACHES: ring closure, ring opening, lower/higher homologs, \
double-bond insertion, chiral resolution, bulky-group removal, polar \
substitution, electronic-state tuning (EWG/EDG), bioisosteric ring \
swaps (lactam↔urea, phenyl↔pyridine).

When unsure which to suggest, default to the smallest move that addresses \
the user's stated goal.

# Mutation context — tailor the move to the mutation class
If the user provides target_pdb + mutations, classify the mutation:
- GATEKEEPER (T315I, T790M, L1196M): ATP-cleft steric clash. Suggest: \
linear linker bypass (alkyne, sp1) per Ponatinib (O'Hare 2009); reduce \
bulk at the gatekeeper-adjacent position.
- ACTIVATION-LOOP (V600E, D816V): conformational selection. Suggest: \
DFG-out scaffolds for Type II inhibitors; OR active-conformation- \
selective designs (Vemurafenib's hydrophobic-fill for V600E; \
Avapritinib's active-state binding for D816V).
- COVALENT TARGET (C481S, C797S, G12C): the warhead anchor changed. \
Suggest: drop the warhead, optimise non-covalent affinity (Pirtobrutinib \
strategy for C481S); OR retarget to a different cysteine. Vina is \
non-covalent — affinity numbers will under-represent the clinical effect.
- ALLOSTERIC / DISTANT (H1047R, switch-region mutations): out of scope \
for rigid docking. Treat suggestions as DIRECTIONAL only and tell the \
user to validate experimentally.

# Inhibitor type matters
Type I (DFG-in, ATP-cleft) and Type II (DFG-out, back pocket) bind \
different conformations. Don't suggest a Type-II move on a Type-I \
scaffold without flagging the type-class change. Examples: Imatinib \
(II), Dasatinib (I), Vemurafenib (I), Sorafenib (II).

# Trade-offs that are easy to forget
(a) RIGIDIFICATION HELPS ONLY IF the rigid form matches the bioactive \
conformation. If suggesting ring closure or alkene insertion without \
knowing the docked pose, qualify with "if the constrained geometry \
matches the bound pose."
(b) ADDING A POLAR GROUP carries ~3-7 kcal/mol desolvation cost — the \
new H-bond often does not recover that. Suggest polar additions only \
when the new group reaches a SPECIFIC complementary residue (cite which \
one). Otherwise flag as "may not improve binding due to desolvation \
cost."
(c) STEREOCHEMISTRY IS NOT FREE: enantiomers can differ in target \
potency by 5-50× (S-warfarin vs R-warfarin; (R)-salbutamol vs (S)-). \
If you change a chiral centre, name the enantiomer explicitly.
(d) LOW CELLULAR ACTIVITY ≠ BAD BINDER: poor permeability, hepatic \
first-pass, or plasma protein binding can mask a tight biochemical \
binder. Don't recommend dropping a compound based on cellular IC50 \
alone.

# Citations
When citing a literature precedent, use "(Author Year)" with a real \
reference. If you can't justify a precedent, write "general medchem \
principle" instead — fabricated citations are worse than no citation.

# Optional warnings (warnings array)
"PAINS-like substructure introduced", "violates Lipinski rule of 5", \
"synthetically challenging", "reactive functional group", \
"stereochemistry ambiguous", "may not improve binding due to \
desolvation cost"."""


def _build_user_prompt(
    *,
    smiles: str,
    instruction: str,
    target_pdb: Optional[str],
    mutations: Optional[str],
    score: Optional[float] = None,
    hits: Optional[list[str]] = None,
    misses: Optional[list[str]] = None,
) -> str:
    """Assemble the user message. Pocket context is appended only when
    actually present so a generic edit ("make this more soluble") isn't
    polluted with irrelevant target details.

    When `score`/`hits`/`misses` are provided, a DOCKING CONTEXT block
    is appended — same data the Optimize endpoint uses. The presence of
    this block flips the system prompt's behaviour into docking-aware
    mode: residue names must come from these lists, suggestions should
    bias toward the misses without breaking the hits, and the rationale
    should reference the specific residue the edit targets when one is
    being targeted."""
    parts = [
        f"Current SMILES: {smiles}",
        f"Instruction: {instruction}",
    ]
    if target_pdb:
        ctx = f"Target context: PDB {target_pdb}"
        if mutations:
            ctx += f", mutations: {mutations}"
        parts.append(ctx)
    # Docking context — only append when score is present (hits/misses
    # alone without a score would be ambiguous; we want all three or none).
    if score is not None:
        dock_lines = [
            "",
            "DOCKING CONTEXT (use this to ground your edit):",
            f"- Current docking score: {score:.2f} kcal/mol (lower = stronger binding)",
            f"- Hits (residues the compound CONTACTS — preserve these): {', '.join(hits) if hits else '(none reported)'}",
            f"- Misses (pocket residues NOT contacted — bias edits toward reaching at least one): {', '.join(misses) if misses else '(none reported)'}",
            "When proposing the edit, name the specific MISSED residue you're targeting (e.g. 'extends a methyl to reach Tyr541'). Only refer to residues that appear in the hits or misses lists above — do NOT invent residue names. If your edit doesn't target a specific residue, describe the move generically without inventing a label.",
        ]
        parts.extend(dock_lines)
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


_OPTIMIZE_SYSTEM_PROMPT = """You are a PhD-level medicinal-chemistry assistant inside Liganx. \
The user has just docked a compound against a specific target+mutation \
and wants 3 variant compounds designed to gain contacts at residues the \
original compound MISSED.

# Output format (STRICT — return ONLY this JSON, no preamble, no code fences)
{"variants":[{"new_smiles":"<smiles>","rationale":"<sentence>"},{"new_smiles":"<smiles>","rationale":"<sentence>"},{"new_smiles":"<smiles>","rationale":"<sentence>"}]}

# Behavior rules
- Return EXACTLY 3 variants. Each SMILES MUST parse with RDKit (canonical-style).
- Keep edits minimal: change only what's needed to reach the missed residues.
- DIVERSITY > MAGNITUDE: the 3 variants must span DIFFERENT design axes \
(one disjunction = simplify scaffold, one conjunction = add a group / scaffold-hop, \
one special-approach = ring closure / chiral resolution / bioisosteric swap / EWG-EDG tuning) \
— NOT three variations of the same move.

# Citing residues — strict rules
- Each rationale should name the SPECIFIC missed residue the variant \
targets and the chemical move (e.g. "adds a hydroxyl to reach Tyr541").
- DO NOT INVENT RESIDUE NAMES. Only refer to residues in the `hits` \
or `misses` lists from the user message. If a variant doesn't target \
a specific residue from those lists, describe the move generically \
("adds a fluorine for metabolic stability") without inventing a \
residue label. Hallucinated residue names are the worst failure mode.

# Mutation-aware design strategy
Use the mutation context (if provided) to bias your suggestions:
- GATEKEEPER (T315I, T790M, L1196M) → at least one variant should bypass \
the gatekeeper region (Ponatinib-style alkyne linker, or bulk reduction).
- COVALENT-TARGET (C481S, C797S) → at least one non-covalent variant \
(Pirtobrutinib strategy for C481S; Osimertinib retains C797 covalent \
for T790M).
- ACTIVATION-LOOP (V600E, D816V) → flag if the receptor PDB is the wrong \
DFG state for the suggested move. Vemurafenib for V600E targets the \
αC-helix-in active state; Avapritinib for D816V same.
- ALLOSTERIC (H1047R) → label all 3 variants as DIRECTIONAL ONLY \
("rigid-receptor docking has limited predictive power for this class").

# Trade-offs to flag explicitly
- Rigidification (ring closure, alkene insertion) → only helps if the \
rigid form matches the bioactive conformation; otherwise reduces \
binding. Flag if you can't be sure.
- Polar additions → ~3-7 kcal/mol desolvation cost. Only worth it if \
the new group reaches a SPECIFIC missed residue.
- Stereochemistry change → enantiomers can differ 5-50× in target \
potency. If you introduce a chiral centre, name the enantiomer.

# Worked precedents you may cite (use real names, no inventions)
Ponatinib alkyne linker for ABL T315I (O'Hare 2009); Asciminib \
allosteric ABL myristoyl-pocket binder (Wylie 2017); Osimertinib \
acrylamide for EGFR T790M+C797 (Cross 2014); Pirtobrutinib non-covalent \
BTK retention against C481S (Mato 2021); Vemurafenib hydrophobic-fill \
for BRAF V600E αC-helix-in (Bollag 2010); Avapritinib KIT D816V \
active-conformation binder (Evans 2017). If you don't have a real \
precedent for a move, write "general medchem principle, no specific \
precedent" instead of fabricating one."""


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
        system_prompt=_augment_with_skill(_OPTIMIZE_SYSTEM_PROMPT),
        user_prompt=user_prompt,
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
    score: Optional[float] = None,
    hits: Optional[list[str]] = None,
    misses: Optional[list[str]] = None,
) -> AssistResponse:
    """Single-turn Anthropic call. Returns AssistResponse with new_smiles
    + rationale on success, or raises RuntimeError on auth/network/quota
    failures (caller maps those to 503/502 HTTPException).

    Optional `score`/`hits`/`misses` arguments enable DOCKING-AWARE mode:
    the system prompt receives a contact-data block and biases its edits
    toward residues the compound is missing. The router only forwards
    these when the dock data is fresh (its smiles matches the current
    canvas SMILES); stale dock data isn't passed through."""
    user_prompt = _build_user_prompt(
        smiles=smiles, instruction=instruction,
        target_pdb=target_pdb, mutations=mutations,
        score=score, hits=hits, misses=misses,
    )

    headers, payload, timeout = _build_request(
        system_prompt=_augment_with_skill(_SYSTEM_PROMPT),
        user_prompt=user_prompt,
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
        # Fallback path — the model produced something that wasn't a JSON
        # object (typically because it tried to write markdown, ask
        # clarifying questions, or otherwise ignored the output contract).
        # We show the user a clean, actionable message instead of dumping
        # the raw model text into the rationale field — the previous
        # behaviour leaked half-rendered markdown into the UI and made
        # the failure look like a Liganx bug rather than an AI miss.
        log.warning("Anthropic returned non-JSON response: %r", raw_text[:300])
        return AssistResponse(
            new_smiles=smiles,
            rationale=(
                "The AI didn't return a clean structural edit for that prompt. "
                "Try a more specific instruction — e.g. 'add a methyl at the para position', "
                "'swap the ester for an amide', or 'reduce logP'."
            ),
            warnings=["AI response was not in the expected format; original structure preserved."],
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
