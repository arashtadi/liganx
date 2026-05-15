"""Chemist reviewer agent — first-pass medicinal-chemist sanity check on a
docking result.

WHAT THIS IS, AND WHAT IT ISN'T

A real medicinal chemist with years of failed projects under their belt is
the gold standard for deciding "is this pose worth chasing." We don't have
one on staff. What an LLM CAN do is the *first five minutes* of that
chemist's review — the structured first-pass checks. Concretely:

  • Is the pose actually in the canonical binding pocket of this protein?
  • Do the contact residues match what's known about how this target
    binds drugs of this class?
  • Is the geometry physically reasonable (strain, clashes, BSA)?
  • Does the Vina score reflect specific interactions or just bulk?
  • Are there obvious medicinal-chemistry red flags (high strain, PAINS-y
    scaffold, off-pocket binding)?

The structured first-pass is 100% automatable and covers ~80% of "is this
pose nonsense?" reviews. What it does NOT replace: the human judgment to
spend $50k on synthesis — that needs a real chemist who's seen failed
SAR before.

DESIGN

This module synthesises — it doesn't recompute. Every metric we care
about (PoseBusters confidence, ProLIF contacts, MMFF94 strain, FoldX ΔΔG,
buried surface area, H-bond count, Vina-term decomposition) is already
computed by the existing post-dock pipeline and written into
DockingResult.extra as pipe-delimited key=value pairs. The agent:

  1. Parses the extras into structured form (reuses _summarize_extra
     from ask_ai.py — the canonical Python parser).
  2. Assembles a chemistry-aware prompt with the parsed metrics, the
     target context (PDB, UniProt, mutation, indication), and the
     compound SMILES + name.
  3. Calls Claude Haiku for a fast, cheap structured verdict.
  4. Returns a ChemistReview the frontend can render directly.

Cost / latency: one Anthropic Haiku call per review (~2-5s, ~$0.002).
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Literal, Optional

import httpx

from .ask_ai import _summarize_extra

log = logging.getLogger(__name__)

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
# Haiku — fast (~2s) and ~$0.002 per review. Sonnet is overkill here; the
# heavy lifting (the actual chemistry computations) is already done.
ANTHROPIC_MODEL = os.environ.get(
    "CHEMIST_REVIEW_MODEL", "claude-haiku-4-5-20251001"
)
DEFAULT_TIMEOUT_S = 30.0


Verdict = Literal[
    "confident-hit",   # geometry, contacts, score all check out
    "plausible",       # mostly good, minor caveats
    "borderline",      # real concerns — would want a human eye
    "suspect",         # multiple red flags — likely artefact
    "failed",          # docking itself failed (no pose to review)
]


@dataclass
class ChemistReview:
    """Output of one chemist review of one docking result."""

    verdict: Verdict
    headline: str                # one-sentence bottom-line for the matrix UI
    summary: str                 # 2-3 sentence plain-English assessment
    strengths: list[str] = field(default_factory=list)   # what's working
    concerns: list[str] = field(default_factory=list)    # specific issues to know
    suggestions: list[str] = field(default_factory=list) # concrete next-step ideas
    # Per-criterion verdict — drives a compact card UI. Keys are stable;
    # values are short strings the UI can colour-code.
    criteria: dict[str, str] = field(default_factory=dict)
    # The structured metrics the verdict was based on — included so the
    # frontend can show "the agent looked at: strain=1.76, pose_in_pocket=true, ..."
    inputs: dict[str, Any] = field(default_factory=dict)
    # Echo the model + version so a stale cached review can be identified.
    model: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ──────────────────────── prompt construction ────────────────────────

_SYSTEM_PROMPT = """\
You are a medicinal-chemistry reviewer doing a first-pass quality check on
a molecular-docking result. The geometric and biophysical analysis has
ALREADY been computed (pose-in-pocket, ProLIF contacts, MMFF94 strain,
PoseBusters verdict, FoldX ΔΔG, BSA, H-bond count, Vina-term split). Your
job is to synthesise these into a chemist's verdict.

Be skeptical but constructive. Specifically:
  • Don't approve poses with bad geometry or off-pocket binding just to
    be polite. Call out artefacts directly.
  • Don't penalise reasonable poses for missing data — "skipped" or
    "unknown" PoseBusters is not a failure, it's a missing reading.
  • For each concern, say WHY (e.g. "strain 9.1 kcal/mol — pose is
    forced into a high-energy conformer the molecule wouldn't actually
    occupy in solution"), not just THAT.
  • Suggestions should be concrete and actionable ("try editing the
    para-Cl to a smaller F to relieve the clash with M793"), not
    generic ("consider further optimization").
  • When known, draw on the literature for the target — what residues
    are expected to be in the binding pocket? Does this pose hit them?

Return STRICT JSON ONLY (no prose, no markdown fences, no explanation).
Schema:
{
  "verdict": "confident-hit" | "plausible" | "borderline" | "suspect" | "failed",
  "headline": "<one short sentence, the bottom line>",
  "summary": "<2-3 sentences, plain English, what a chemist would say>",
  "strengths": ["<specific positive finding>", ...],
  "concerns":  ["<specific issue with reasoning>", ...],
  "suggestions": ["<concrete next-step idea>", ...],
  "criteria": {
    "pose_fit": "<one short phrase about whether the pose is in the canonical pocket>",
    "geometry": "<one short phrase about clashes / strain>",
    "interactions": "<one short phrase about contacts + H-bonds + BSA>",
    "score": "<one short phrase about whether the Vina score reflects real interactions>",
    "drug_likeness": "<one short phrase about the compound itself>"
  }
}
"""


def _build_user_message(
    *,
    compound_smiles: str,
    compound_name: str,
    target_id: str,
    target_name: str,
    target_uniprot: str,
    pdb_id: str,
    chain: str,
    variant: str,
    indications: list[str],
    docked_score: float,
    extras: dict[str, Any],
) -> str:
    """Assemble the user-side message: ALL the structured data the LLM needs."""
    lines: list[str] = []
    lines.append("DOCKING RESULT TO REVIEW")
    lines.append("")
    lines.append("Target:")
    lines.append(f"  • Name:       {target_name} ({target_id})")
    lines.append(f"  • UniProt:    {target_uniprot}")
    lines.append(f"  • Structure:  PDB {pdb_id} chain {chain}")
    lines.append(f"  • Variant:    {variant}")
    if indications:
        lines.append(f"  • Indications: {', '.join(indications)}")
    lines.append("")
    lines.append("Compound:")
    lines.append(f"  • Name:   {compound_name or '(unnamed)'}")
    lines.append(f"  • SMILES: {compound_smiles}")
    lines.append("")
    lines.append(f"Docked score: {docked_score:.2f} kcal/mol (more negative = stronger)")
    lines.append("")
    lines.append("Pre-computed geometric / biophysical analysis:")
    # Surface the metrics that matter most for the chemist.
    pose_in_pocket = extras.get("pose_in_pocket")
    pose_offset = extras.get("pose_offset_a")
    if pose_in_pocket is not None:
        lines.append(
            f"  • Pose in pocket: {'yes' if pose_in_pocket else 'NO'} "
            f"(centroid offset from box center: {pose_offset} Å)"
        )
    confidence = extras.get("confidence")
    pb = extras.get("posebusters")
    if confidence:
        lines.append(f"  • PoseBusters verdict: {confidence} ({pb or 'no detail'})")
    strain = extras.get("strain")
    if strain:
        lines.append(
            f"  • Conformational strain: {strain} "
            "(MMFF94s ΔE between docked pose and lowest relaxed conformer; "
            "ok≤3 kcal/mol, mild=3-7, high>7)"
        )
    contacts = extras.get("contacts")
    if contacts:
        formatted_contacts = ", ".join(
            f"{c['residue']}({c['type']}{':' + str(c.get('distance')) + 'Å' if c.get('distance') is not None else ''})"
            for c in contacts[:20]
        )
        lines.append(f"  • ProLIF contacts: {formatted_contacts}")
    elif extras.get("prolifStatus"):
        lines.append(f"  • ProLIF: {extras['prolifStatus']}")
    bsa = extras.get("iface_bsa")
    hb = extras.get("iface_hb")
    if bsa is not None or hb is not None:
        lines.append(
            f"  • Interface: BSA={bsa}Å²" + (f", {hb} H-bond(s)" if hb is not None else "")
        )
    vt = extras.get("vina_terms")
    if vt:
        lines.append(f"  • Vina-term split (g1,g2,rep,hyd,hb,tor): {vt}")
    foldx = extras.get("foldxDDG")
    if foldx is not None:
        lines.append(
            f"  • FoldX ΔΔG vs WT: {foldx:+.2f} kcal/mol "
            "(negative = mutation stabilises binding)"
        )
    failure = extras.get("failure")
    if failure:
        lines.append(
            f"  • FAILURE: {failure.get('kind')} — {failure.get('reason')}"
        )
    lines.append("")
    lines.append(
        "Produce the JSON review described in the system prompt. Be specific, "
        "be skeptical when warranted, be honest when there's not enough signal "
        "to commit to a verdict. STRICT JSON, no markdown."
    )
    return "\n".join(lines)


# ──────────────────────── LLM call ────────────────────────


def _extract_json(text: str) -> dict[str, Any]:
    """Pull the JSON object out of Claude's response. Defensive: tries plain
    parse first, falls back to extracting the first {...} block in case the
    model wraps it in prose despite the prompt's instructions."""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Find the first balanced {...} — handles ```json ... ``` fences too.
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        raise ValueError(f"no JSON object found in LLM response: {text[:200]!r}")
    return json.loads(m.group(0))


async def review_pose(
    *,
    compound_smiles: str,
    compound_name: str,
    target_id: str,
    target_name: str,
    target_uniprot: str,
    pdb_id: str,
    chain: str,
    variant: str,
    indications: list[str],
    docked_score: float,
    extra: Optional[str],
    api_key: str,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> ChemistReview:
    """Produce a chemist review of one docking result.

    `extra` is the raw pipe-delimited string from DockingResult.extra; we
    parse it locally so callers don't have to. `api_key` is the Anthropic
    key (pass `settings.anthropic_api_key`). All other args are
    self-explanatory from the docking job context.
    """
    extras = _summarize_extra(extra)

    # Short-circuit: docking failed at the runner level — no pose to review.
    failure = extras.get("failure")
    if failure:
        return ChemistReview(
            verdict="failed",
            headline=f"Docking failed: {failure.get('kind')} ({failure.get('reason', '')[:80]})",
            summary=(
                f"This compound did not produce a usable pose for review. "
                f"The runner reported a {failure.get('kind')} failure: "
                f"{failure.get('reason', 'no reason given')}."
            ),
            concerns=[f"{failure.get('kind')}: {failure.get('reason', 'no reason given')}"],
            suggestions=_failure_suggestions(failure.get("kind", "")),
            criteria={
                "pose_fit": "n/a — no pose",
                "geometry": "n/a — no pose",
                "interactions": "n/a — no pose",
                "score": "n/a — no pose",
                "drug_likeness": "compound itself may be untestable",
            },
            inputs=extras,
            model=ANTHROPIC_MODEL,
        )

    user_msg = _build_user_message(
        compound_smiles=compound_smiles,
        compound_name=compound_name,
        target_id=target_id,
        target_name=target_name,
        target_uniprot=target_uniprot,
        pdb_id=pdb_id,
        chain=chain,
        variant=variant,
        indications=indications,
        docked_score=docked_score,
        extras=extras,
    )

    payload = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 1024,
        "system": _SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_msg}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            r = await client.post(ANTHROPIC_API_URL, headers=headers, json=payload)
    except (httpx.TimeoutException, httpx.RequestError) as e:
        log.warning("chemist_review: Anthropic network error: %s", e)
        raise RuntimeError(f"AI reviewer unreachable: {e}") from e

    if r.status_code == 401:
        raise RuntimeError("AI reviewer authentication failed (bad ANTHROPIC_API_KEY)")
    if r.status_code == 429:
        raise RuntimeError("AI reviewer rate-limited; try again shortly")
    if r.status_code >= 400:
        log.warning("chemist_review: Anthropic HTTP %d: %s", r.status_code, r.text[:300])
        raise RuntimeError(f"AI reviewer error (HTTP {r.status_code})")

    body = r.json()
    raw_text = ""
    for block in body.get("content", []):
        if block.get("type") == "text":
            raw_text += block.get("text", "")
    if not raw_text:
        raise RuntimeError("AI reviewer returned no text content")

    try:
        parsed = _extract_json(raw_text)
    except (ValueError, json.JSONDecodeError) as e:
        log.warning("chemist_review: JSON parse failure: %s | text=%s", e, raw_text[:300])
        raise RuntimeError(f"AI reviewer returned unparseable JSON: {e}") from e

    return _coerce_review(parsed, extras)


def _coerce_review(parsed: dict[str, Any], extras: dict[str, Any]) -> ChemistReview:
    """Defensive coercion of the LLM's JSON into a ChemistReview. The model
    is instructed to use a strict schema but we don't trust it absolutely —
    every field has a sensible fallback."""
    verdict_raw = str(parsed.get("verdict", "borderline")).strip().lower()
    if verdict_raw not in {"confident-hit", "plausible", "borderline", "suspect", "failed"}:
        verdict_raw = "borderline"

    def _str_list(v: Any) -> list[str]:
        if not isinstance(v, list):
            return []
        return [str(x).strip() for x in v if str(x).strip()]

    return ChemistReview(
        verdict=verdict_raw,                                      # type: ignore[arg-type]
        headline=str(parsed.get("headline", "")).strip()[:240]
                 or "Review complete.",
        summary=str(parsed.get("summary", "")).strip()[:800]
                or "No summary produced.",
        strengths=_str_list(parsed.get("strengths"))[:10],
        concerns=_str_list(parsed.get("concerns"))[:10],
        suggestions=_str_list(parsed.get("suggestions"))[:10],
        criteria={
            k: str(v).strip()[:200]
            for k, v in (parsed.get("criteria") or {}).items()
            if isinstance(v, (str, int, float))
        },
        inputs=extras,
        model=ANTHROPIC_MODEL,
    )


def _failure_suggestions(kind: str) -> list[str]:
    """Canned suggestions for docking failures — these don't need the LLM."""
    if kind == "ligand_prep":
        return [
            "Check the SMILES parses in a standard drawing tool — RDKit "
            "couldn't embed a 3D structure.",
            "Look for unusual valences, exotic atom types, or radicals "
            "in the input.",
            "If this is a macrocycle or very flexible molecule, the "
            "docking engine may not be the right tool — consider "
            "alternative methods (ensemble docking, MD).",
        ]
    if kind == "mutant_build":
        return [
            "Verify the mutation residue number exists in the selected "
            "PDB structure on that chain.",
            "Some structures have missing loops; the mutated residue "
            "may have no coordinates to swap.",
            "Try a different PDB ID for the same target.",
        ]
    if kind == "docking":
        return [
            "Re-submit — transient pod / GPU faults sometimes self-heal.",
            "If it keeps failing, the molecule may be too large or have "
            "unusual chemistry for the docking engine.",
        ]
    return ["Re-submit; if the failure repeats, file a bug with the pose ID."]
