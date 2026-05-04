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


# ──────────────────────────────────────────────────────────────────────
# Diagnose mode — the user's SMILES doesn't parse. Don't try to edit it
# (the JSON contract requires a new_smiles, but RDKit-validation will
# reject anything we generate from a broken parent). Instead route to a
# pure-text diagnostic prompt that explains what's wrong in plain
# language, then suggests how to fix it. Returns the original (broken)
# SMILES + a richer rationale + applied=False so the editor doesn't
# overwrite the canvas.
# ──────────────────────────────────────────────────────────────────────
_DIAGNOSE_SYSTEM_PROMPT = """You are a PhD-level medicinal chemist embedded in \
the Liganx structure editor. The user has drawn a molecule whose SMILES does \
NOT parse with RDKit. Your job is to explain what is wrong in plain language \
that a working chemist (not necessarily a SMILES expert) can act on.

# Output format (STRICT — return ONLY this JSON, no preamble, no markdown)
{"new_smiles": "<original_smiles_unchanged>", "rationale": "<diagnosis + fix>", "warnings": []}

# Rules
1. ECHO THE ORIGINAL SMILES BACK in the new_smiles field unchanged. Do NOT \
attempt to repair the structure — the user is in an interactive editor and \
needs to fix it themselves so they understand the lesson.
2. The `rationale` field must be 2–4 short sentences:
   • What is structurally wrong (over-bonded atom, disconnected fragments, \
     impossible valence, weird charges, broken ring closure, etc.)
   • WHERE in the structure the problem is, in chemist terms (e.g. \
     "the central carbon attached to two carbonyls and a methyl now has 5 \
     bonds — carbon can only support 4").
   • WHAT the user should do in the editor (e.g. "delete one of the C=O \
     double bonds, or replace the central C with a phosphorus or sulfur \
     if you intended a phosphate/sulfonate"; or "use the Eraser tool to \
     remove the disconnected fragment in the lower right").
3. If you can identify multiple problems, mention the WORST one first; the \
user fixes things one at a time.
4. If the SMILES has multiple disconnected fragments (contains a `.`), \
that's almost always the problem — name it and tell them to keep only \
the largest fragment or use the Keep Largest tool.
5. Speak in friendly, professional tone. Not condescending. The user is a \
chemist and just made a drawing slip.

# Common errors and the fix-language to use
- Over-bonded carbon (5+ bonds): "Carbon can only have 4 bonds. The atom at \
{position} currently has {n} — remove a double bond or a substituent."
- Over-bonded nitrogen with no charge: "This nitrogen has 4 bonds but no + \
charge. Either add a + charge (ammonium) or remove a bond."
- Disconnected fragments (`.` in the SMILES): "Your structure has two or \
more disconnected pieces. Use the Eraser to delete the smaller one, or \
'Keep largest fragment' from the menu."
- Unclosed ring (mismatched ring-closure digit): "A ring-closure number \
appears once but should appear twice. The ring around {position} isn't \
closed — connect the two open ends."
- Aromatic ring valence issue: "An aromatic atom in your ring doesn't have \
the right number of bonds for aromaticity — try drawing the ring as \
single/double bonds instead, or check that all ring atoms are sp2."
- Empty SMILES / nothing on canvas: "The canvas appears empty — sketch a \
structure first."
"""


def _build_diagnose_user_prompt(*, smiles: str, rdkit_error: str, instruction: str) -> str:
    """Compose the diagnose-mode user message. The RDKit error is the
    most important signal — it usually names the offending atom or
    valence — so it gets surfaced verbatim. The user instruction (if any)
    is included so a chemist who already knows what's wrong can ask a
    targeted follow-up like 'why doesn't the eraser remove the salt?'"""
    parts = [
        f"SMILES (does not parse): {smiles!r}",
        f"RDKit error message: {rdkit_error or '(no error text — likely empty or wholly invalid)'}",
    ]
    instr = (instruction or "").strip()
    if instr:
        parts.append(f"User question: {instr}")
    else:
        parts.append("User has not asked a specific question — give the most useful diagnosis + fix.")
    return "\n".join(parts)


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


# ──────────────────────────────────────────────────────────────────────
# Generate-Score-Filter loop config
#
# 2026-05-03: switched from "ask AI for 3, ship 3" to "ask AI for ~12,
# filter by SA + pod pre-flight, batch-dock survivors, ship the best 3
# by composite fitness". The AI is doing what it's good at (proposing
# diverse chemistry); the docker is doing what IT'S good at (scoring).
# Net effect: the 3 variants the user sees are now empirically the best
# of a wider design space, not the AI's first guess. See routers/assist.py
# /optimize endpoint and services/optimize_loop.py for the orchestration.
# ──────────────────────────────────────────────────────────────────────
N_OPTIMIZE_CANDIDATES = 12
# Lower bound — if we ask for 12 and only 4 survive RDKit + SA + pod
# pre-flight, that's still enough to dock and pick the best 3 from.
# Below 3 survivors we just return what we have.
MIN_OPTIMIZE_CANDIDATES = 3


def _build_optimize_system_prompt(n_variants: int) -> str:
    """The optimize system prompt parameterised by how many variants to
    request. The Generate-Score-Filter loop asks for ~12 candidates;
    callers that want the legacy 3-variant behaviour pass n_variants=3.

    Behaviour rules + output schema interpolate {n_variants} so the
    model isn't surprised by the count mismatch. Other rules (mutation
    targeting, residue-name guard, vina-gpu sanity) are unchanged."""
    return _OPTIMIZE_SYSTEM_PROMPT_TEMPLATE.format(n_variants=n_variants)


_OPTIMIZE_SYSTEM_PROMPT_TEMPLATE = """You are a PhD-level medicinal-chemistry assistant inside Liganx. \
The user has just docked a compound against a specific target+mutation \
and wants {n_variants} CANDIDATE variant compounds. The Liganx server will \
re-dock all {n_variants} candidates against the same target+mutation, score \
them with the same engine, then surface the best 3 to the user. So your job \
is to generate a DIVERSE pool of plausible candidates — not just 3 hand-picked \
"best guesses".

# Goal — read it carefully
Your candidates will be re-docked with the SAME engine (Vina/QuickVina2-GPU) \
and SAME pocket box as the parent. The server then picks the best 3 by:
  delta_score (improvement over parent) × 1.0
  + (4 − SA_score) × 0.3   (rewards easy-to-make designs)
  + mutation_contact × 0.5 (rewards reaching the mutated residue)

So a successful candidate must:
  1. Score MORE NEGATIVE than the parent (better binding affinity) — \
     Vina noise floor is ±0.5 kcal/mol so target ≥ 0.7 kcal/mol \
     improvement to be reproducible.
  2. Add at least one specific contact in the missed-residue list \
     (ideally the mutated residue itself).
  3. NOT introduce features that crash vina-gpu (see "Synthesis sanity" below).
  4. Stay synthetically tractable (SA Score ≤ 6 ideally — anything above \
     gets penalised in the fitness function and is unlikely to make the \
     final 3).

# Output format (STRICT — return ONLY this JSON, no preamble, no code fences)
{{"variants":[{{"new_smiles":"<smiles>","rationale":"<sentence>"}}, ... {n_variants} entries]}}

# Behavior rules
- Return EXACTLY {n_variants} variants. Each SMILES MUST parse with RDKit (canonical-style).
- Keep edits minimal: change only what's needed to reach the missed residues. \
Tiny edits (single-atom swaps, methyl→ethyl, F→Cl) often improve scores by \
0.3-0.8 kcal/mol with low risk; prefer those over scaffold rewrites unless \
the parent is fundamentally wrong-shape.
- DIVERSITY > MAGNITUDE: spread the {n_variants} variants across DIFFERENT \
design axes — disjunction (simplify/strip a group), conjunction (add a group / \
scaffold-hop / hybridise), special-approach (ring closure, ring opening, \
bioisosteric swap, EWG/EDG tuning, chiral resolution, alkyne linker, fluorine \
walk). Aim for at least 4 distinct axes across the pool. Do NOT submit \
{n_variants} micro-variations of the same move; the docker will rank them \
near-identically and you'll have wasted the budget.

# Mutation residue is the PRIMARY target
At LEAST half of the {n_variants} variants MUST be designed to engage the \
actual MUTATED residue (the one whose identity changed in the user's mutation \
string), not just generic missed residues. State the mutated residue \
name explicitly in those variants' rationales.

For SUBSTITUTIONS (the common case — like G2032R, T315I, T790M, V600E):
- Identify the BIOPHYSICAL DELTA between original and new residue:
  • Gly → Arg/Lys/His (small→big basic): new positive charge in pocket. \
    Add an ANIONIC group (carboxylate, tetrazole, sulfonate, acyl-sulfonamide) \
    OR a neutral H-bond acceptor (sulfonyl, carbonyl, pyridine N) within \
    reach of the new side chain. ANIONIC > neutral acceptor for affinity.
  • Gly → Asp/Glu (small→acidic): new negative charge. Add a basic group \
    (amine, guanidine, imidazole) or H-bond donor (NH, OH).
  • Thr/Ser/Cys → bulky hydrophobic (T315I, T790M, T550M, C481S, etc.): \
    "gatekeeper-style" steric clash. Either (a) BYPASS with an extended \
    linker (Ponatinib alkyne for T315I), (b) SHRINK the offending substituent \
    (smaller cyclopropyl/methyl), or (c) flip to a NON-COVALENT scaffold if \
    the mutation killed a covalent cysteine.
  • Hydrophobic → Hydrophobic of similar size (L→I, V→L): rarely changes \
    binding much; design should usually target NEARBY residues instead.
  • Anything → Pro: backbone rigidification — flag as "may shift loop \
    conformation; rigid-receptor docking under-predicts effect."
  • Activation-loop residues (V600E, D816V, etc.): mutation flips the \
    DFG/aC-helix conformation. Vina against the WT receptor is the WRONG \
    state. Flag this in the rationale and suggest the user consider \
    a mutation-specific PDB.

# Synthesis sanity (very important — vina-gpu crashes if violated)
The Pod crashes (rc=255) on molecules that pass RDKit but blow past \
practical limits. Avoid generating variants that:
- Have > 25 rotatable bonds (Vina's torsion limit)
- Have > 80 heavy atoms (Vina's atom limit)
- Have molecular weight > 900 Da
- Contain Boron (B), Silicon (Si), or transition metals — Vina has no \
  parameters for these
- Contain unusual valences that survived RDKit but won't survive Meeko \
  ligand prep (5-coordinate carbon, etc.)
If your design naturally drifts there (e.g. macrocyclic natural products), \
STRIP back to a drug-like core before emitting the SMILES. A working \
variant beats a clever one that the engine can't dock.

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
    n_variants: int = 3,
    apply_pod_pre_flight: bool = True,
) -> list[OptimizeVariant]:
    """Ask Claude for `n_variants` candidate SMILES designed to gain contacts
    at the `misses` residues. Returns RDKit-validated, canonical-form
    variants in the order the model produced them.

    Two distinct callers:

    1. **Legacy path** (n_variants=3, apply_pod_pre_flight=True): the
       behaviour shipped with the original /assist/optimize — ask for 3,
       drop anything that doesn't survive the pod pre-flight, ship up to 3.
       No re-dock; the frontend dispatches per-variant quick docks itself.

    2. **Generate-Score-Filter loop** (n_variants=12, apply_pod_pre_flight=True):
       called by services/optimize_loop.py. Wider candidate pool; the
       orchestrator batch-docks survivors and ranks by composite fitness
       before returning the top 3 to the user.

    `apply_pod_pre_flight` is exposed so callers that have their own
    filtering pipeline can short-circuit it (currently always True; future
    ToolUse-style flow may set it False to keep the model's own choices)."""
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
        system_prompt=_augment_with_skill(_build_optimize_system_prompt(n_variants)),
        user_prompt=user_prompt,
    )
    # The base max_tokens budget is sized for a single edit (~1024); 12
    # variants with per-variant rationales push toward 2-3K. Bump the
    # budget when asking for >3 variants so the JSON doesn't get
    # truncated mid-array (which then fails _extract_json and we silently
    # ship 0 variants — a high-cost-zero-output failure mode).
    if n_variants > 3:
        # 200 tokens per variant gives generous headroom for the 1-sentence
        # rationale + SMILES; 12 × 200 = 2400, plus 600 for JSON scaffolding.
        payload["max_tokens"] = max(int(payload.get("max_tokens", 1024)), 200 * n_variants + 600)

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
    # Cap at n_variants × 1.5 so a model that overshoots the request (Haiku
    # sometimes returns 14 when asked for 12) doesn't waste downstream
    # GPU time on extras the orchestrator would just discard. Floor at 3
    # so the legacy n=3 path keeps its old behaviour.
    cap = max(3, int(n_variants * 1.5))
    seen_canonical: set[str] = set()
    for raw in raw_variants[:cap]:
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
        # De-dupe — Haiku occasionally repeats the same SMILES across
        # rationale variants when the parent has limited modification
        # surface (e.g. tiny molecules). Save the docker round-trip.
        if canonical in seen_canonical:
            continue
        seen_canonical.add(canonical)
        if apply_pod_pre_flight:
            # Pre-flight Vina/QuickVina-GPU sanity gate. The Pod crashes
            # rc=255 on too-big/too-flexible/wrong-element molecules even
            # when RDKit accepts them. Mirrors the gate in services/quick_dock.py
            # — keeping the cutoffs in sync prevents the AI from emitting
            # variants the user will only see fail in the UI.
            skip_reason = _vina_pod_pre_flight(canonical)
            if skip_reason:
                log.info("optimize variant skipped (pod pre-flight): %s for %r", skip_reason, canonical)
                continue
        out.append(OptimizeVariant(new_smiles=canonical, rationale=rationale))
    return out


def _vina_pod_pre_flight(smiles: str) -> Optional[str]:
    """Check whether a SMILES will survive QuickVina2-GPU. Returns None
    if the molecule is OK, or a short string explaining why it would
    crash. Same cutoffs as services/quick_dock.py — keep them in sync.

    These are the rc=255 triggers we've actually seen in production:
    too many torsions (Vina's hard limit), too many heavy atoms,
    out-of-Vina-allowlist elements (B, Si, transition metals)."""
    try:
        from rdkit import Chem
        from rdkit.Chem import Lipinski, Descriptors
    except ImportError:
        return None  # if RDKit isn't available we can't check; let it through
    try:
        mol = Chem.MolFromSmiles(smiles)
    except Exception:
        return None
    if mol is None:
        return None
    n_heavy = mol.GetNumHeavyAtoms()
    if n_heavy > 80:
        return f"too large for vina-gpu ({n_heavy} heavy atoms; limit 80)"
    try:
        n_rot = Lipinski.NumRotatableBonds(mol)
    except Exception:
        n_rot = 0
    if n_rot > 25:
        return f"too flexible for vina-gpu ({n_rot} rotatable bonds; limit 25)"
    try:
        mw = Descriptors.MolWt(mol)
    except Exception:
        mw = 0
    if mw > 900:
        return f"MW {mw:.0f} > 900 Da (Vina limit)"
    # Vina element allow-list: H/C/N/O/F/P/S/Cl/Br/I (matches Meeko defaults).
    bad_elements = set()
    for atom in mol.GetAtoms():
        sym = atom.GetSymbol()
        if sym not in ("H", "C", "N", "O", "F", "P", "S", "Cl", "Br", "I"):
            bad_elements.add(sym)
    if bad_elements:
        return f"unsupported element(s): {','.join(sorted(bad_elements))}"
    return None


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
    canvas SMILES); stale dock data isn't passed through.

    DIAGNOSE MODE — if the input SMILES doesn't parse with RDKit, we
    switch to a diagnostic prompt that explains what's wrong and how
    to fix it (instead of trying to edit a structure we can't even
    parse). Returns the original SMILES + a chemist-friendly rationale
    + applied=False so the editor doesn't overwrite the canvas. This
    is what makes the chat box useful even when the validity pill is
    red — chemists can ask "what's broken?" and get a real answer."""
    # Pre-flight RDKit validation. If the input is broken, route to the
    # diagnose prompt instead of the edit prompt.
    from .properties import validate_smiles
    parent_valid, _, parent_err = validate_smiles(smiles)
    diagnose_mode = not parent_valid

    if diagnose_mode:
        user_prompt = _build_diagnose_user_prompt(
            smiles=smiles, rdkit_error=parent_err or "", instruction=instruction,
        )
        # Diagnose prompt is short (no skill content) — the medchem
        # skill is for design/edit reasoning, not SMILES syntax debugging.
        # Skipping it also makes diagnose responses faster and cheaper.
        system_prompt = _DIAGNOSE_SYSTEM_PROMPT
    else:
        user_prompt = _build_user_prompt(
            smiles=smiles, instruction=instruction,
            target_pdb=target_pdb, mutations=mutations,
            score=score, hits=hits, misses=misses,
        )
        system_prompt = _augment_with_skill(_SYSTEM_PROMPT)

    headers, payload, timeout = _build_request(
        system_prompt=system_prompt,
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
    #
    # In DIAGNOSE MODE the rationale IS the deliverable and the SMILES
    # is supposed to come back unchanged-and-broken. Don't add the
    # "AI's suggested structure didn't parse" warning — it would
    # misleadingly blame the AI for the user's drawing slip.
    from .properties import validate_smiles
    valid, canonical, err = validate_smiles(new_smi_raw)
    if not valid:
        if not diagnose_mode:
            log.info("AI-suggested SMILES failed RDKit validation: %s (raw=%r)", err, new_smi_raw)
        return AssistResponse(
            new_smiles=smiles,
            rationale=rationale or "AI returned an invalid SMILES.",
            warnings=warnings if diagnose_mode else [
                *warnings,
                f"AI's suggested structure didn't parse: {err}. Keeping the original.",
            ],
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
