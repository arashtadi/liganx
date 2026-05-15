"""Context-aware quick-question suggestions for the Liganx AI chat panel.

The original LiganxAI Beta showed three static questions on every job:
  • "Explain the outside-pocket badge on this matrix."
  • "Which compound here looks most promising and why?"
  • "Why is this Δ flagged as unreliable?"

That's fine onboarding for someone who's never used the chat, but it's
the same three questions on every page — even when the user is looking
at KRAS Q61H where the canonical opening question is "compare this to
Adagrasib", or EGFR T790M where "why is this the gatekeeper mutation?"
is the natural first ask.

This module returns suggestions tailored to the job's target + mutation.
Static lookup by design — fast, deterministic, predictable cost ($0 vs
one Claude call per page open), and easy to audit for accuracy. Generic
fallback covers any target the table doesn't yet know about.
"""
from __future__ import annotations

from dataclasses import dataclass

from ..catalog import get_target


# ───────────────── Target-specific suggestion banks ─────────────────
#
# Three suggestions per target. Designed to be the questions a chemist
# would actually ask first when handed a result on that target — they
# load the right context and produce useful answers in one round-trip.
# Targets not in the table fall through to GENERIC_SUGGESTIONS.

_BY_TARGET: dict[str, list[str]] = {
    "kras": [
        "Compare this binding mode to Adagrasib's known mechanism.",
        "Is this pose making contact with the Switch I or Switch II loops?",
        "What's the difference between G12C, G12D and Q61H biology here?",
    ],
    "egfr": [
        "Why is T790M called the gatekeeper mutation?",
        "Compare this to gefitinib or osimertinib's reported binding mode.",
        "Does this pose make the canonical hinge H-bond with MET793?",
    ],
    "braf": [
        "Why is V600E so much more druggable than wild-type BRAF?",
        "Is this binding the DFG-in or DFG-out conformation?",
        "Compare this to vemurafenib's known mode of action.",
    ],
    "abl": [
        "Why is T315I called the gatekeeper resistance mutation in ABL?",
        "Compare this to ponatinib's binding mode at this site.",
        "Is this a DFG-in (type I) or DFG-out (type II) binder?",
    ],
    "btk": [
        "Compare this to ibrutinib's covalent binding at C481.",
        "Is the C481S mutation expected to block this compound?",
        "Why is BTK such a common target in B-cell malignancies?",
    ],
    "kit": [
        "Compare this binding to imatinib's mode of action on KIT.",
        "What does the D816V mutation do to the activation loop?",
        "Is this pose consistent with a type I or type II kinase inhibitor?",
    ],
    "alk": [
        "Compare this to alectinib or lorlatinib's reported binding mode.",
        "What does the G1202R solvent-front mutation do to drug binding?",
        "Does this pose make the canonical hinge contact?",
    ],
    "pi3k": [
        "Compare this to known PI3Kα-selective inhibitors.",
        "Is this an ATP-site or allosteric binder?",
        "What does the H1047R hotspot mutation do to binding?",
    ],
}

# Fallback set — designed to be useful on any target. Same shape as the
# original static three, just rephrased to mention "this target" so the
# language is natural regardless of what the user is looking at.
GENERIC_SUGGESTIONS: list[str] = [
    "Which compound here looks most promising for this target, and why?",
    "Explain the outside-pocket / pose-fit flags shown on this matrix.",
    "Are any of these Δ values flagged as unreliable, and why?",
]


# Mutation-specific overrides — replace one of the target-bank questions
# when the job has a specific mutation we have a sharper opener for.
# Keyed by (target_id, mutation_code).
_BY_MUTATION: dict[tuple[str, str], str] = {
    ("egfr", "T790M"): "Why is T790M called the gatekeeper mutation, and how does it affect first-generation EGFR inhibitors?",
    ("egfr", "L858R"): "How does the L858R activating mutation differ from T790M resistance?",
    ("egfr", "C797S"): "Why does C797S block osimertinib but not earlier-generation EGFR drugs?",
    ("kras", "G12C"): "Compare this binding mode to Adagrasib and Sotorasib's covalent attack on C12.",
    ("kras", "G12D"): "What makes G12D harder to target than G12C, and why?",
    ("kras", "Q61H"): "Compare Q61H to G12C — is the same pocket accessible?",
    ("braf", "V600E"): "Why is V600E so much more druggable than wild-type BRAF, and what does this pose do with the activation loop?",
    ("abl", "T315I"): "Why is T315I the gatekeeper resistance mutation, and which drugs (ponatinib, asciminib) still work against it?",
    ("btk", "C481S"): "Why does C481S abolish ibrutinib activity, and what's the rationale for non-covalent BTK inhibitors here?",
    ("kit", "D816V"): "Explain D816V as a primary activating mutation versus a resistance mutation in mastocytosis / AML.",
}


@dataclass
class SuggestionSet:
    target_id: str           # what we looked up — for debugging
    target_name: str         # display, e.g. "KRAS"
    mutations: list[str]     # mutation codes used (for transparency in the UI)
    suggestions: list[str]   # the 3 questions to render


def suggestions_for_job(
    *,
    pdb_id: str,
    mutations: list[str],
) -> SuggestionSet:
    """Return three quick-question suggestions tailored to this job.

    Resolves the target via the catalog (PDB id → catalog Target),
    pulls the per-target bank, and optionally swaps in a mutation-
    specific opener for the first mutation listed. Falls back to a
    generic set for targets the table doesn't cover yet — better to
    show generic-but-useful questions than nothing.
    """
    target = get_target(pdb_id) if pdb_id else None
    if target is None:
        return SuggestionSet(
            target_id="(unknown)",
            target_name="this target",
            mutations=mutations,
            suggestions=list(GENERIC_SUGGESTIONS),
        )

    base = _BY_TARGET.get(target.id.lower(), GENERIC_SUGGESTIONS)
    out = list(base)

    # Swap in mutation-specific opener for the first known mutation.
    for mut in mutations:
        key = (target.id.lower(), mut)
        if key in _BY_MUTATION:
            out[0] = _BY_MUTATION[key]
            break

    return SuggestionSet(
        target_id=target.id,
        target_name=target.name,
        mutations=mutations,
        suggestions=out,
    )
