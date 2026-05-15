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
# (AI5) Hard-question model. Sonnet is ~3x the cost of Haiku per token
# but materially better at multi-step reasoning, drug-class comparisons,
# and "explain why" questions that need a chain of logic. Most chat
# questions are simple jargon-explanations where Haiku is perfect; this
# is only used when _looks_hard() flags a question that genuinely benefits.
ASK_MODEL_HARD = os.environ.get("ASK_AI_MODEL_HARD", "claude-sonnet-4-6")


# (AI5) Keywords that suggest the question genuinely benefits from
# Sonnet-level reasoning. Conservative on purpose — getting Haiku to
# answer a simple question correctly is much cheaper than getting
# Sonnet to answer it. We only escalate when the question shape
# suggests multi-step reasoning, comparison, or open-ended judgment.
_HARD_KEYWORDS = (
    "compare", "vs ", " versus ", "which is better", "trade-off", "tradeoff",
    "explain why", "why does", "why is", "how come",
    "predict", "would happen", "what happens if",
    "literature", "publications", "papers", "studies",
    "mechanism", "rationale", "design",
    "recommend", "suggest", "next compound", "follow-up",
)
# Above ~200 chars (≈2 sentences) the user is usually setting up a
# nuanced ask. Below that, it's almost always a single-fact question.
_HARD_LENGTH_THRESHOLD = 200


def _looks_hard(question: str) -> bool:
    """Decide whether this question benefits from the smarter, slower,
    more expensive model. False on the typical "what does X mean" — those
    are Haiku's home turf. True when the shape suggests multi-step
    reasoning, comparison, or open-ended judgment."""
    if not question:
        return False
    q = question.lower()
    if len(question) >= _HARD_LENGTH_THRESHOLD:
        return True
    if q.count("?") >= 2:
        # Multiple questions in one ask → almost always multi-step.
        return True
    return any(kw in q for kw in _HARD_KEYWORDS)


def pick_ask_model(question: str) -> str:
    """Public entry point for tests + the router. Returns the model id
    to use for this question. Defaults to Haiku; promotes to Sonnet when
    _looks_hard() agrees."""
    return ASK_MODEL_HARD if _looks_hard(question) else ASK_MODEL
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
- (AI1) When a CHEMIST REVIEW block is attached to the user message, \
the user has asked for a pose review. USE THAT BLOCK as the spine of \
your answer — quote its verdict, its specific concerns, and its \
concrete suggestions. Don't paraphrase the structured fields into \
mush; preserve the specificity (e.g. "strain 9.1 kcal/mol — pose is \
forced into a high-energy conformer"). The review was produced by the \
same chemist-agent service that runs at GET /jobs/{key}/review and is \
designed to be authoritative for first-pass sanity checks.
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

# Ensemble docking
- Some jobs run with "ensemble docking" (job.ensemble = true in the \
payload). Instead of docking against one rigid crystal snapshot, each \
ligand is docked against several short-MD-relaxed receptor conformers \
and the BEST score+pose is kept. The matrix shows a "⧉ best of N ± \
spread" chip on these cells.
- When a result row has an `ensemble` object, read it as: `total` = how \
many receptor conformers were tried; `docked` = how many produced a \
usable pose; `spread` = the kcal/mol gap between the best and worst \
conformer scores; `best` = which conformer won — "input" means the \
un-relaxed crystal snapshot won (relaxation didn't help that ligand), \
"confN" means an MD-relaxed conformer won (the pocket had to flex to \
fit it).
- Interpreting `spread`: it measures how much receptor flexibility moved \
the score. A spread near 0 means the pocket was effectively rigid for \
that ligand, so a single-snapshot dock would have given essentially the \
same answer. A large spread means the conformer choice mattered a lot — \
the single-snapshot score could have landed anywhere in that range.
- A `total` of 1 means ensemble docking was requested but the receptor \
relaxation produced no extra conformers (fail-soft fallback), so that \
cell is effectively a standard single-conformation dock.
- The `score` shown for an ensemble row IS already the best across the \
ensemble — do not describe it as one conformer's score.

# Other result-row fields
- `vinardo_score`: a second-pass smina/Vinardo rescore of the same pose \
(kcal/mol, lower = stronger). Often separates close analogs better than \
raw Vina.
- `foldx_ddg`: FoldX ΔΔG of the mutation in kcal/mol — the energy cost of \
the substitution to the protein's fold. Larger positive = the mutation \
is more destabilising. Only present on mutant cells from FoldX-built \
receptors.
- `pose_summary`: a human-readable sentence the pose validator wrote \
about this cell — quote it directly when the user asks "what's the \
summary" or "describe this pose".
- `interface_bsa_angstroms2`: buried surface area of the protein-ligand \
interface (Å²). >600 Å² is a healthy druggable contact patch; <300 Å² is \
usually a glancing pose.
- `interface_hbonds`: count of H-bonds across the interface (ProLIF). \
≥3 usually generalises better across analogs than hydrophobic-only \
contacts.
- `vina_score_terms`: the Vina score decomposition (g1/g2/rep/hyd/hb are \
raw PRE-weighting contributions; `total` is the final weighted kcal/mol). \
The g*/rep/hyd/hb rows do NOT sum to `total`.
- `water_displacement` ({displaced, pocket_count}): crystallographic \
waters in the pocket sphere this pose displaces. This is Phase-0 \
geometric overlap, NOT WaterMap — don't over-claim from it.
- `contacts_count` / `contacts_sample`: how many receptor residues the \
pose contacts, and a sample of the first few residue codes.
- `prolif_status` (in flags): "empty" or "err:..." means ProLIF produced \
no interaction fingerprint — explains an empty contacts list.
- Boltz-2 rows: `boltz2_affinity_log10_ic50_um` (lower = stronger), \
`boltz2_binder_probability` (0-1, binder vs decoy), \
`boltz2_pocket_residue_count`, `boltz2_mut_vs_wt_rmsd_angstroms`.

# pdb_quality (cross-docking sanity check)
- Top-level `pdb_quality`: the platform re-docked the target's own \
co-crystal ligand and measured heavy-atom RMSD vs the crystal pose. \
`rmsd_angstroms` < 2 = pocket geometry is trustworthy; 2-4 = uncertain; \
> 4 = the docking box is likely mis-defined and EVERY score in the matrix \
should be treated with suspicion. If `pdb_quality` is null the check \
hasn't run yet — say so rather than guessing.

# Compound ADMET
- Each compound carries an `admet` block: RDKit descriptors (mw, logp, \
tpsa, qed, hba/hbd, rotatable bonds), Lipinski/Veber pass flags, and \
PAINS hits. When `admet.extended` is present it has rule-based hERG / \
BBB / CYP3A4 / CYP2D6 / DILI risk labels. Answer drug-likeness and \
liability questions from this block; don't pull ADMET numbers from \
general knowledge.

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
        elif key == "ensemble":
            # Ensemble docking. Format: "<docked>/<total>" — conformers
            # that produced a pose / conformers docked against. Mirrors
            # the frontend parseExtra.ts. Merge-update so segment order in
            # the extra string doesn't matter (ens_spread/ens_best may
            # arrive before or after this key).
            m = re.match(r"^(\d+)/(\d+)$", val)
            if m:
                ens = out.setdefault("ensemble", {})
                ens["docked"] = int(m.group(1))
                ens["total"] = int(m.group(2))
        elif key == "ens_spread":
            # kcal/mol gap between the best and worst conformer scores.
            try:
                out.setdefault("ensemble", {})["spread"] = float(val)
            except ValueError:
                pass
        elif key == "ens_best":
            # Winning conformer label: "input" (un-relaxed crystal) or
            # "confN" (an MD-relaxed conformer).
            out.setdefault("ensemble", {})["best"] = val
        elif key == "foldx_ddg":
            # FoldX ΔΔG of the mutation, kcal/mol. Shown on mutant cells.
            try:
                out["foldxDDG"] = float(val)
            except ValueError:
                pass
        elif key == "summary":
            # Human-readable pose summary the validator wrote — this is
            # the prose the PoseDetail panel shows verbatim.
            out["summary"] = val
        elif key == "prolif":
            # ProLIF interaction-fingerprint status (e.g. "empty",
            # "err:...") — the UI uses it to explain an empty contacts list.
            out["prolifStatus"] = val
        elif key == "iface_bsa":
            # Buried surface area of the protein-ligand interface, Å².
            try:
                out["interfaceBsa"] = float(val)
            except ValueError:
                pass
        elif key == "iface_hb":
            # H-bond count across the interface (from ProLIF).
            try:
                out["interfaceHbonds"] = int(val)
            except ValueError:
                pass
        elif key == "pocket_residues":
            # Boltz-2: number of pocket residues passed as the constraint.
            try:
                out["pocketResidues"] = int(val)
            except ValueError:
                pass
        elif key == "boltz2_aligned_to_wt":
            # Boltz-2: mutant→WT Cα-alignment RMSD, Å. Format "1.2A".
            m = re.match(r"^([\d.]+)A?$", val)
            if m:
                try:
                    out["boltz2AlignedRmsd"] = float(m.group(1))
                except ValueError:
                    pass
        elif key == "vina_terms":
            # Vina score decomposition from smina --score_only. Format:
            # "g1:-42.04,g2:-1115.74,rep:4.46,hyd:-19.39,hb:-2.07,total:-8.42"
            terms: dict[str, float] = {}
            for tok in val.split(","):
                kv = tok.split(":")
                if len(kv) != 2:
                    continue
                k2 = kv[0].strip()
                if k2 not in ("g1", "g2", "rep", "hyd", "hb", "total"):
                    continue
                try:
                    terms[k2] = float(kv[1])
                except ValueError:
                    pass
            if terms:
                out["vinaTerms"] = terms

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


def _admet_for_ask(smiles: str) -> Optional[dict[str, Any]]:
    """Compute the headline ADMET / drug-likeness block for a SMILES so the
    AI sees the same chips the JobPage shows (MW, LogP, QED, Lipinski/Veber,
    PAINS, plus the rule-based hERG/BBB/CYP/DILI `extended` block when
    available). Mirrors routers/jobs.py::_admet_for. LRU-cached downstream,
    so repeated calls for the same compound are ~free. Returns None on any
    failure (RDKit missing in a stripped env) — the AI just won't see ADMET
    for that compound, same as the UI rendering an em-dash."""
    try:
        from deltadock_pipeline.admet import compute_admet
        return compute_admet(smiles)
    except Exception:
        return None


def _pdb_quality_for_ask(pdb_id: str, chain: str) -> Optional[dict[str, Any]]:
    """Load the cached cross-docking sanity-check result for (pdb_id, chain)
    — the same `pdb_quality` badge the JobPage header shows (re-docks the
    co-crystal ligand, reports heavy-atom RMSD vs the crystal pose). Returns
    None when the background check hasn't run/cached yet. Mirrors
    routers/jobs.py::_pdb_quality_for."""
    try:
        from deltadock_pipeline.crossdock import load_cached
        pid = pdb_id if pdb_id.startswith("USR_") else pdb_id.upper()
        return load_cached(pid, (chain or "A").upper())
    except Exception:
        return None


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

    # Compounds — name + smiles + the headline ADMET / drug-likeness block
    # (the same descriptors the JobPage's AdmetChips render: MW, LogP, QED,
    # Lipinski/Veber, PAINS, and the rule-based hERG/BBB/CYP/DILI `extended`
    # block when available). We compute it here via compute_admet — the
    # `askJob` request only carries the question, so if we don't compute it
    # the model is blind to every ADMET chip on the page. compute_admet is
    # LRU-cached, so this is ~free on repeat calls. We deliberately do NOT
    # ship the full 41-endpoint admet_ml dump (~6kb each) — just the
    # headline block that the chips show by default.
    compounds_block: list[dict[str, Any]] = []
    for c in job.compounds:
        entry: dict[str, Any] = {
            "id": c.id,
            "name": c.name or f"compound_{c.id}",
            "smiles": c.smiles,
        }
        admet = _admet_for_ask(c.smiles)
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
        if "ensemble" in ext and isinstance(ext["ensemble"], dict):
            # Ensemble docking telemetry for this cell — the `score`
            # above is already the BEST across the conformer ensemble.
            # `total` conformers tried, `docked` produced a pose,
            # `spread` = best↔worst score gap (kcal/mol), `best` = the
            # winning conformer ("input" = un-relaxed crystal snapshot).
            row["ensemble"] = ext["ensemble"]
        # Remaining per-cell signals the JobPage surfaces (PoseDetail
        # drawer, interface chips, FoldX ΔΔG, the human-readable pose
        # summary, Boltz-2 affinity heads). Without these the AI is
        # blind to whole panels of the results page.
        if "foldxDDG" in ext:
            row["foldx_ddg"] = ext["foldxDDG"]
        if "summary" in ext:
            row["pose_summary"] = ext["summary"]
        if "prolifStatus" in ext:
            flags["prolif_status"] = ext["prolifStatus"]
        if "interfaceBsa" in ext:
            row["interface_bsa_angstroms2"] = ext["interfaceBsa"]
        if "interfaceHbonds" in ext:
            row["interface_hbonds"] = ext["interfaceHbonds"]
        if "vinaTerms" in ext and isinstance(ext["vinaTerms"], dict):
            row["vina_score_terms"] = ext["vinaTerms"]
        if "water" in ext and isinstance(ext["water"], dict):
            row["water_displacement"] = ext["water"]
        if "affValue" in ext:
            row["boltz2_affinity_log10_ic50_um"] = ext["affValue"]
        if "affProb" in ext:
            row["boltz2_binder_probability"] = ext["affProb"]
        if "pocketResidues" in ext:
            row["boltz2_pocket_residue_count"] = ext["pocketResidues"]
        if "boltz2AlignedRmsd" in ext:
            row["boltz2_mut_vs_wt_rmsd_angstroms"] = ext["boltz2AlignedRmsd"]
        if "contacts_count" in ext:
            row["contacts_count"] = ext["contacts_count"]
            if "contacts_sample" in ext:
                row["contacts_sample"] = ext["contacts_sample"]
        if flags:
            row["flags"] = flags
        results_block.append(row)

    # Cross-docking sanity check — the `pdb_quality` badge in the JobPage
    # header. Re-docks the co-crystal ligand and reports heavy-atom RMSD vs
    # the crystal pose: <2 Å = trustworthy pocket geometry, >4 Å = the box
    # is probably mis-defined and every score in the matrix is suspect. The
    # AI should be able to answer "can I trust these scores?" from this.
    pdb_quality = _pdb_quality_for_ask(job.pdb_id, job.chain)

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
            # Whether this job ran with ensemble docking — each ligand
            # docked against several MD-relaxed receptor conformers, best
            # kept. When true, result rows carry an `ensemble` object.
            "ensemble": bool(getattr(job, "ensemble", False)),
            "status": str(job.status.value if hasattr(job.status, "value") else job.status),
            "title": job.title,
        },
        "score_direction": score_direction,
        "pdb_quality": pdb_quality,
        "compounds": compounds_block,
        "results": results_block,
    }


# (AI1) Phrases that suggest the user wants a chemist-style review of the
# pose rather than a quick Q&A about the page. When any of these match,
# the router will run the chemist_review service (S1) and inject its
# structured verdict into the chat context — Claude then synthesises a
# plain-English answer that's grounded in the deep review.
_REVIEW_INTENT_KEYWORDS = (
    "review this", "review the pose", "review the result", "review pose",
    "chemist review", "chemist's review", "expert review", "second opinion",
    "is this pose good", "is this pose ok", "is this pose reasonable",
    "is the pose good", "what's wrong with this pose",
    "should i trust this pose", "trust this pose", "trust the pose",
    "is this trustworthy", "is this reliable",
    "evaluate this pose", "rate this pose", "judge this pose",
    "geometry of this pose", "geometry look right",
    "audit this pose", "critique this pose", "deep review",
)


def is_chemist_review_intent(question: str) -> bool:
    """Detect a 'review this pose' question. Keyword-based on purpose —
    these phrasings cover the bulk of the natural-language openers, and
    a misfire is cheap (the user just gets a thorough answer where they
    asked a casual one)."""
    if not question:
        return False
    return any(kw in question.lower() for kw in _REVIEW_INTENT_KEYWORDS)


def _build_ask_user_prompt(
    *,
    context: dict[str, Any],
    question: str,
    chemist_review_snippet: Optional[str] = None,
) -> str:
    """Compose the user message: the structured payload first (so the
    model anchors on it before reading the question), then the user's
    actual prompt. Keeping the payload first matches the Anthropic
    cookbook recommendation for grounded-Q&A.

    (AI1) When `chemist_review_snippet` is provided, it's inserted between
    the page context and the question — Claude is instructed via the
    system prompt to ground 'review this' answers in the snippet."""
    out = (
        "PAGE CONTEXT (JSON snapshot of what the user is looking at — "
        "answer only from this, no extrapolation):\n"
        + json.dumps(context, separators=(",", ":"))
    )
    if chemist_review_snippet:
        out += (
            "\n\nCHEMIST REVIEW (pre-computed structured first-pass review "
            "of the best pose — use as the spine of your answer when the "
            "user is asking for a pose review):\n"
            + chemist_review_snippet.strip()
        )
    out += "\n\nQUESTION:\n" + question.strip()
    return out


class AskResult(BaseModel):
    """Returned to the router."""
    answer: str
    model: str


async def ask_claude_about_job(
    *,
    context: dict[str, Any],
    question: str,
    chemist_review_snippet: Optional[str] = None,
) -> AskResult:
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
    # (AI5) Auto-route to Sonnet when the question shape suggests multi-
    # step reasoning. Most chat questions are simple jargon explanations
    # that Haiku handles perfectly at ~1/3 the cost.
    model_id = pick_ask_model(question)
    payload = {
        "model": model_id,
        "max_tokens": ASK_MAX_TOKENS,
        "system": _ASK_SYSTEM_PROMPT,
        "messages": [
            {"role": "user", "content": _build_ask_user_prompt(
                context=context,
                question=question,
                chemist_review_snippet=chemist_review_snippet,
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

    return AskResult(answer=answer, model=model_id)
