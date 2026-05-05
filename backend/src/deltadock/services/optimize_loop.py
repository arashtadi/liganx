"""Generate-Score-Filter loop for the AI Optimize feature.

The AI is good at proposing diverse chemistry; the docking engine is good
at ranking it. The pre-2026-05-03 implementation conflated the two — we
asked Claude for 3 variants and shipped exactly those 3, trusting the
model's own ranking. Result: variants that *sounded* better than the
parent in prose but didn't actually improve the docking score.

This module implements the better pattern:

    1. Ask Claude for ~12 candidate variants (wider design space).
    2. Filter quickly on cheap signals:
        - RDKit validity (already done in ai_assistant)
        - SA Score ≤ 6 (drop synthetically-implausible designs early)
        - Vina-pod pre-flight (drop molecules vina-gpu would crash on)
    3. Batch-dock the survivors against the SAME receptor in ONE GPU call
       (dock_batch_pod is the existing primitive).
    4. Compute composite fitness:
        Δscore × 1.0 + (4 − SA) × 0.3 + mutation_contact × 0.5
       — Δscore = parent − variant in kcal/mol (positive = better binding).
       — SA term rewards easy-to-make designs (Ertl/Schuffenhauer-style).
       — mutation_contact = 1 if a hit residue matches the mutation residue
         number, else 0; a small kicker so a mutation-engaging design beats
         a marginally-better generic improvement.
    5. Sort by fitness, return top 3 with score/sa/fitness fields populated
       so the frontend can render them without any further round-trips.

Cost per Optimize call (vs legacy 3-variant path):
    - LLM tokens: ~3-4× (asking for 12 candidates with longer rationales)
      → ~$0.005 marginal at Haiku 4.5 pricing.
    - GPU dock: 1 batch call with up to ~10 ligands → ~30s on the Pod
      (vs ~10s for the legacy 3-variant fan-out).

The 3 variants the user sees should now be measurably better — Vina is
ranking them, not the LLM's prose intuition.
"""

from __future__ import annotations

import asyncio
import logging
import math
import re
import tempfile
from pathlib import Path
from typing import Optional, TypedDict

log = logging.getLogger(__name__)


# Composite-fitness weights — see module docstring for rationale.
_FITNESS_W_DELTA = 1.0
_FITNESS_W_SA = 0.3
_FITNESS_W_MUTATION = 0.5
# Off-pocket penalty (subtracted from fitness when the docked pose
# drifted outside the search box). Calibrated to feel like ~half a
# kcal/mol score loss — large enough to push a drift-affected -9.0
# variant below a clean -8.7, but small enough that a clearly better
# -10.0 with drift still ranks above a mediocre clean -8.5. Set to 0
# to disable the penalty (preserves pre-2026-05-05 behaviour).
# 2026-05-05 user request: "the AI designs a variant that is in the
# pocket" — penalty makes off-pocket variants visibly less competitive.
_FITNESS_W_POCKET_DRIFT = 0.6

# SA Score gate — drop anything above 6 ("hard" or "very hard" per
# services/sa_score.sa_label). Calibrated against ChEMBL drug-like space:
# 6.0 cleanly separates "you'd actually try to make this" from "this
# needs a 12-step total synthesis with chiral resolution".
_MAX_SA_SCORE = 6.0

# How many candidates to ship to the user. The 3 the AI is shown is
# unchanged — what's different is HOW they were chosen (best-of-N rather
# than first-N).
_TOP_N = 3


class ScoredVariant(TypedDict, total=False):
    """One scored, ranked, ready-to-ship variant."""
    new_smiles: str
    rationale: str
    score: float            # Vina kcal/mol (lower = stronger binding)
    delta: float            # parent_score - score; positive = improvement
    sa_score: float         # 1=easy, 10=impossible (server-computed)
    fitness: float          # composite ranking value
    mutation_contact: bool  # True iff variant touches the mutated residue
    hits: list[str]         # docked-pose contacts (for UI context)
    misses: list[str]       # nearby-pocket residues NOT contacted
    # Pose-pocket honesty (added 2026-05-05). Drives a small "drifted
    # off-pocket" warning chip on the variant card AND is fed into
    # _composite_fitness so that off-pocket variants rank lower even
    # when their nominal Vina score looks good. Without this, a -9.2
    # variant with the pose 8 Å outside the box would beat a -8.7 with
    # a clean centered pose — clearly the wrong call.
    pose_offset_a: float
    pose_in_pocket: bool
    # Self-predictions from the AI (Hard-Constraint Reject Loop, Tier 1 #2).
    # Carried through so the UI can render a calibration badge — useful
    # signal of whether the AI knew it had a winner (predicted high Δ +
    # actual high Δ) vs got lucky (predicted low Δ + actual high Δ).
    predicted_improvement_kcal: float
    predicted_sa_score: float
    mutation_target: Optional[str]


class OptimizeLoopResult(TypedDict, total=False):
    """Top-level response from generate_score_filter_optimize."""
    variants: list[ScoredVariant]
    candidates_generated: int   # how many Claude returned (post-RDKit)
    candidates_filtered: int    # survivors after SA + pod pre-flight
    candidates_docked: int      # how many actually got a Vina score
    candidates_self_rejected: int  # how many failed the self-prediction gate
    candidates_top_up: int      # how many came from the top-up re-call
    note: str                   # human-readable diagnostic for the UI
    # Mutation-aware-scoring transparency (added 2026-05-04 with the
    # services/receptor_prep.py wiring). receptor_variant tells the UI
    # whether scores reflect the mutant or just WT (some mutations fail
    # to build cleanly via PDBFixer and we fall back to WT).
    receptor_variant: str       # "mutant" | "wt"
    mutation_caveat: str        # populated only when fallback to WT happened despite a mutation request


def _parse_mutation_residue(mutations: Optional[str]) -> Optional[int]:
    """Extract the residue NUMBER from a mutation code like 'T790M' → 790
    or 'G2032R' → 2032. Returns None if the string doesn't match the
    expected pattern.

    Used by the fitness function to decide whether a docked variant
    actually contacts the mutated residue. Hits look like 'A:LYS790' or
    'A:MET790' — we match by the trailing integer."""
    if not mutations:
        return None
    s = mutations.strip()
    # First token before any comma — handles compound mutations like
    # "T790M+C797S" or "T790M, C797S" by grabbing the FIRST mutation.
    # Could be smarter (target whichever the variant picked), but the
    # AI is explicitly asked to focus on at least one mutated residue.
    first = re.split(r"[,;+\s]+", s, maxsplit=1)[0]
    m = re.match(r"[A-Za-z](\d{1,4})[A-Za-z]", first)
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:
        return None


# 1-letter → 3-letter amino-acid code. Used by _build_mutation_target_label
# to produce IUPAC-flavoured residue labels like THR315→ILE for the AI
# prompt — much more precise than passing the bare "T315I" string, which
# the model has to mentally expand.
_AA_3LETTER: dict[str, str] = {
    "A": "ALA", "R": "ARG", "N": "ASN", "D": "ASP", "C": "CYS",
    "Q": "GLN", "E": "GLU", "G": "GLY", "H": "HIS", "I": "ILE",
    "L": "LEU", "K": "LYS", "M": "MET", "F": "PHE", "P": "PRO",
    "S": "SER", "T": "THR", "W": "TRP", "Y": "TYR", "V": "VAL",
}


def _build_mutation_target_label(mutations: Optional[str], chain: str = "A") -> Optional[str]:
    """Build an explicit AI-prompt label for the mutated residue.

    "T315I" → "A:THR315→ILE (residue 315)"
    "T790M, C797S" → label for the FIRST mutation only (matches
                     _parse_mutation_residue's first-token convention).

    The bare mutation code "T315I" appears in the prompt as a "Target
    context" suffix, but the AI has to mentally expand the 1-letter codes
    AND match them against the hits list which uses 3-letter (LYS790,
    THR315). Spelling it out reduces ambiguity, especially for novel
    mutations not in the few-shot library.

    Returns None when the mutation string doesn't match the canonical
    1-letter-residue-1-letter pattern (e.g. user typed "AurA-T490I" or
    something atypical) — in that case we don't append a misleading
    label and the prompt falls back to the existing free-form context."""
    if not mutations:
        return None
    first = re.split(r"[,;+\s]+", mutations.strip(), maxsplit=1)[0]
    m = re.match(r"([A-Za-z])(\d{1,4})([A-Za-z])$", first)
    if not m:
        return None
    from_aa, num, to_aa = m.group(1).upper(), m.group(2), m.group(3).upper()
    from_three = _AA_3LETTER.get(from_aa, from_aa)
    to_three = _AA_3LETTER.get(to_aa, to_aa)
    return f"{chain}:{from_three}{num}→{to_three} (residue {num})"


def _hit_touches_mutation(hits: list[str], residue_number: Optional[int]) -> bool:
    """True iff any hit residue label has the same residue number as the
    mutation. Hit format from quick_dock._extract_contacts: 'A:LYS790'."""
    if residue_number is None or not hits:
        return False
    for h in hits:
        # Pull the trailing integer from each hit. The string slice would
        # also work but regex is robust to format drift (e.g. ' A:LYS 790 ').
        nums = re.findall(r"\d+", h)
        if not nums:
            continue
        try:
            if int(nums[-1]) == residue_number:
                return True
        except ValueError:
            continue
    return False


def _composite_fitness(
    *,
    delta: float,
    sa_score: float,
    mutation_contact: bool,
    pose_in_pocket: bool = True,
) -> float:
    """Weighted sum used to rank variants. See module docstring for the
    rationale on the 1.0 / 0.3 / 0.5 weights and module-level
    _FITNESS_W_POCKET_DRIFT for the off-pocket penalty.

    The pose_in_pocket=True default preserves backward compatibility for
    callers that don't track pose location yet; set False to apply the
    off-pocket penalty. 2026-05-05."""
    sa_term = max(0.0, (4.0 - sa_score)) * _FITNESS_W_SA  # only reward EASY designs
    mut_term = (1.0 if mutation_contact else 0.0) * _FITNESS_W_MUTATION
    drift_penalty = 0.0 if pose_in_pocket else _FITNESS_W_POCKET_DRIFT
    return delta * _FITNESS_W_DELTA + sa_term + mut_term - drift_penalty


async def generate_score_filter_optimize(
    *,
    smiles: str,
    parent_score: float,
    hits: list[str],
    misses: list[str],
    target_pdb: str,
    mutations: Optional[str] = None,
    chain: str = "A",
    parent_pose_pdbqt_b64: Optional[str] = None,
) -> OptimizeLoopResult:
    """Run the full Generate-Score-Filter pipeline.

    Returns up to _TOP_N variants, each with score/delta/sa_score/fitness
    populated. On any failure that prevents docking (e.g. pod down, no
    receptor cached for `target_pdb`), falls back to returning the AI's
    original 3 variants un-docked — the frontend then dispatches its
    own quick-dock fan-out as a fallback. This keeps the user-visible
    behaviour identical when the pipeline isn't available, while being
    the *clearly better* default when it IS available.
    """
    from . import ai_assistant as ai
    from .sa_score import compute_sa_score

    log.info(
        "optimize_loop: starting for parent_smi=%r score=%.2f mutations=%r",
        smiles[:60], parent_score, mutations,
    )

    # ── 1. Generate ──────────────────────────────────────────────────
    # apply_pod_pre_flight=True: cheap, deterministic, keeps molecules
    # vina-gpu would crash on out of the docker queue.
    # apply_self_prediction_gate=True: enforce the Hard-Constraint Reject
    # Loop — drop variants whose own author predicts < 0.5 kcal/mol Δ,
    # > 6.0 SA, or hallucinates a residue label.
    # use_tools: read from Settings — when ON the AI can self-validate
    # candidates mid-generation via validate_smiles / compute_properties
    # tool calls. Tier 1 #4 (2026-05-04).
    try:
        from ..config import get_settings
        use_tools = bool(get_settings().optimize_use_tools)
    except Exception:
        use_tools = False

    # 2026-05-04 — Parallel-AI sampling. Fire TWO Anthropic calls in
    # parallel (asyncio.gather), each asking for N_OPTIMIZE_CANDIDATES
    # variants. The model is non-deterministic at temperature>0, so two
    # calls give wider chemical-space coverage than one call asking for
    # double. Net candidate count = 2 × 18 = 36 before SA filter and
    # batch dock. Wall time identical to single-call (calls run in
    # parallel); cost ~$0.04/round vs $0.02 baseline. After dedupe by
    # canonical SMILES, this typically yields 25–32 unique survivors.
    # Pocket geometry — pulled from the catalog target so the AI can size
    # its variants to the actual binding cavity instead of producing
    # 800 Da molecules that drift outside a 250 Å³ kinase ATP pocket.
    # 2026-05-05 user request: "the AI designs a variant that is in the
    # pocket". Lookup is best-effort — falls back to None if the target
    # isn't in the catalog OR has no pocket box (legacy entries).
    pocket_size_a: Optional[tuple[float, float, float]] = None
    try:
        from ..catalog import get_target as _get_target
        _t = _get_target(target_pdb) if target_pdb else None
        if _t and _t.pocket and _t.pocket.size:
            pocket_size_a = tuple(_t.pocket.size)
    except Exception:
        # Catalog miss / import error → continue without geometry hint.
        # Better to lose the hint than fail the whole optimize call.
        pocket_size_a = None

    # Explicit mutation-residue label (e.g. "A:THR315→ILE (residue 315)").
    # The bare mutation string ("T315I") is already in the prompt as
    # "Target context: ..., mutations: ..." but the model has to mentally
    # expand the 1-letter codes AND match them against the 3-letter
    # residues in the hits list. Spelling it out reduces ambiguity for
    # novel mutations not in the few-shot library.
    mutation_target_label = _build_mutation_target_label(mutations, chain=chain)

    # Pocket geometry guidance — directional medchem hint computed from
    # the parent ligand pose + receptor 3D structure. Tells the AI WHICH
    # contacted residue is closest to the mutation residue and HOW FAR
    # it has to extend the variant to engage. Only computed when:
    #   - the user gave us a parent pose (post Quick Dock),
    #   - we can parse a mutation residue number from `mutations`,
    #   - the catalog target resolves to a receptor PDB on disk.
    # Best-effort — None on any failure, prompt falls back to the
    # residue-name-only flavour. 2026-05-05 user question.
    pocket_geometry_hint: Optional[str] = None
    if parent_pose_pdbqt_b64 and target_pdb:
        try:
            mut_num = _parse_mutation_residue(mutations)
            if mut_num is not None:
                # Resolve receptor PDB path the same way _batch_quick_dock
                # does, so the geometry compute uses the SAME mutant
                # build the variants will be docked against. Best-effort:
                # if the receptor isn't cached yet (first call for this
                # target+mutation), skip — we'll get it on the next call.
                from ..catalog import get_target as _get_target_for_geo
                from ..config import get_settings as _get_settings_for_geo
                from .receptor_prep import prepare_receptor_for_target as _prep_for_geo
                _t = _get_target_for_geo(target_pdb)
                if _t and _t.pocket:
                    _settings = _get_settings_for_geo()
                    _cache_root = Path(_settings.cache_root or "/var/lib/liganx/poses/cache")
                    _rec = _prep_for_geo(
                        pdb_id=_t.pdb_id,
                        chain=_t.chain or chain,
                        mutation=mutations,
                        pdb_cache=_cache_root / "pdb",
                        receptor_cache=_cache_root / "receptors",
                        minimize_mutant=getattr(_t, "minimize_mutant", True),
                    )
                    import base64 as _b64
                    pose_text = _b64.b64decode(parent_pose_pdbqt_b64).decode("utf-8", errors="replace")
                    pocket_geometry_hint = _compute_pocket_geometry_hint(
                        pose_pdbqt_text=pose_text,
                        receptor_pdb=_rec.receptor_pdb,
                        hits=hits,
                        mutation_residue=mut_num,
                    )
                    if pocket_geometry_hint:
                        log.info(
                            "optimize_loop: geometry hint computed: %s",
                            pocket_geometry_hint[:200],
                        )
        except Exception as e:
            # Logged but non-fatal — the AI still gets the residue-name
            # context, just without the directional hint.
            log.warning("optimize_loop: pocket-geometry hint compute failed (non-fatal): %s", e)

    import asyncio
    call_kwargs = dict(
        smiles=smiles,
        score=parent_score,
        hits=hits,
        misses=misses,
        target_pdb=target_pdb,
        mutations=mutations,
        pocket_size_a=pocket_size_a,
        mutation_target_label=mutation_target_label,
        pocket_geometry_hint=pocket_geometry_hint,
        n_variants=ai.N_OPTIMIZE_CANDIDATES,
        apply_pod_pre_flight=True,
        apply_self_prediction_gate=True,
        use_tools=use_tools,
    )
    parallel_results = await asyncio.gather(
        ai.call_anthropic_optimize(**call_kwargs),
        ai.call_anthropic_optimize(**call_kwargs),
        return_exceptions=True,
    )
    raw_variants: list[dict] = []
    for r in parallel_results:
        if isinstance(r, Exception):
            log.warning("optimize_loop: one of the parallel AI calls failed (non-fatal): %s", r)
            continue
        raw_variants.extend(r)
    # Dedupe by canonical SMILES — the two calls will often propose the
    # same low-hanging fluorine substitution. Keep first occurrence to
    # preserve the model's order within each call.
    seen: set[str] = set()
    deduped: list[dict] = []
    for v in raw_variants:
        smi = (v.get("new_smiles") or "").strip()
        if not smi or smi in seen:
            continue
        seen.add(smi)
        deduped.append(v)
    log.info(
        "optimize_loop: parallel AI sampling produced %d raw variants, %d unique after dedupe",
        len(raw_variants), len(deduped),
    )
    raw_variants = deduped
    # Self-rejected accounting: each call could have lost up to
    # N_OPTIMIZE_CANDIDATES candidates to the self-prediction gate.
    self_rejected = max(0, 2 * ai.N_OPTIMIZE_CANDIDATES - len(raw_variants))

    # ── 1b. Top-up retry ─────────────────────────────────────────────
    # If the Hard-Constraint gate trimmed too many, ask the AI for more
    # — but ONLY if we have at least 1 valid variant (otherwise the model
    # is clearly off-target and another call won't help). Bounded to one
    # retry to keep cost predictable.
    top_up_count = 0
    if 0 < len(raw_variants) < ai.MIN_OPTIMIZE_CANDIDATES * 2:
        n_needed = ai.N_OPTIMIZE_CANDIDATES - len(raw_variants)
        log.info(
            "optimize_loop: top-up triggered — got %d valid (after self-rejects), need %d more",
            len(raw_variants), n_needed,
        )
        try:
            extras = await ai.call_anthropic_optimize_topup(
                smiles=smiles,
                score=parent_score,
                hits=hits,
                misses=misses,
                target_pdb=target_pdb,
                mutations=mutations,
                pocket_size_a=pocket_size_a,
                mutation_target_label=mutation_target_label,
                pocket_geometry_hint=pocket_geometry_hint,
                n_needed=n_needed,
                already_have=[v["new_smiles"] for v in raw_variants],
            )
            top_up_count = len(extras)
            log.info("optimize_loop: top-up returned %d additional variants", top_up_count)
            raw_variants = raw_variants + extras
        except Exception as e:
            log.warning("optimize_loop: top-up failed (non-fatal): %s", e)

    if not raw_variants:
        log.info("optimize_loop: AI returned 0 valid variants")
        return OptimizeLoopResult(
            variants=[],
            candidates_generated=0,
            candidates_filtered=0,
            candidates_docked=0,
            candidates_self_rejected=self_rejected,
            candidates_top_up=top_up_count,
            note="AI didn't propose any valid variants. Try again, or refine the structure manually.",
        )

    log.info(
        "optimize_loop: AI returned %d valid variants (post-RDKit + pod pre-flight + self-prediction gate, +%d top-up)",
        len(raw_variants), top_up_count,
    )

    # ── 2. Filter on SA Score ────────────────────────────────────────
    # Compute SA for every survivor; drop the unsynthesisable ones.
    # The AI's self-predicted SA already gated > 6 in the prompt contract,
    # but we re-compute server-side because the model can be optimistic
    # (see calibration logs). Carry both through so the UI can warn when
    # they disagree by a lot.
    survivors: list[dict] = []
    for v in raw_variants:
        sa = compute_sa_score(v["new_smiles"])
        if sa is None:
            log.info("optimize_loop: SA Score returned None for %r — keeping defensively", v["new_smiles"])
            sa = 5.0  # neutral assumption rather than dropping
        if sa > _MAX_SA_SCORE:
            log.info(
                "optimize_loop: variant filtered (SA=%.1f > %.1f): %r",
                sa, _MAX_SA_SCORE, v["new_smiles"],
            )
            continue
        # Calibration log — useful to spot when the AI consistently
        # underestimates SA on certain scaffold classes.
        pred_sa = v.get("predicted_sa_score")
        if pred_sa is not None and abs(float(pred_sa) - sa) > 2.0:
            log.info(
                "optimize_loop: AI SA prediction off by %.1f (predicted=%.1f, actual=%.1f) for %r",
                abs(float(pred_sa) - sa), pred_sa, sa, v["new_smiles"],
            )
        survivors.append({
            "new_smiles": v["new_smiles"],
            "rationale": v["rationale"],
            "sa_score": float(sa),
            "predicted_improvement_kcal": v.get("predicted_improvement_kcal"),
            "predicted_sa_score": pred_sa,
            "mutation_target": v.get("mutation_target"),
        })

    if not survivors:
        log.info("optimize_loop: 0 survivors after SA filter — returning AI variants un-docked")
        return _fallback_undocked(raw_variants, "All AI candidates were too hard to synthesise (SA Score > 6). Try the Improve button for a more conservative edit.")

    log.info("optimize_loop: %d survivors after SA filter", len(survivors))

    # ── 2b. Pocket-geometry pre-flight ───────────────────────────────
    # Reject candidates whose estimated molecular volume exceeds 60% of
    # the pocket box volume — these will dock with significant clash
    # penalty or drift outside the box, wasting GPU time. The AI gets
    # the pocket size hint in its prompt (#1 above) but still proposes
    # oversized molecules occasionally — this is the safety net.
    # 2026-05-05 user request.
    #
    # Estimate uses MW × 1.3 Å³/Da (water-adjusted organic density),
    # which is a fast proxy for the slow RDKit ComputeMolVolume that
    # needs a 3D conformer per molecule. Calibrated against PDB
    # ligand stats: Imatinib (MW 493) ≈ 640 Å³, in good agreement
    # with the experimental ATP-pocket occupancy.
    if pocket_size_a:
        sx, sy, sz = pocket_size_a
        pocket_volume = sx * sy * sz
        max_mol_volume = pocket_volume * 0.6
        try:
            from rdkit import Chem
            from rdkit.Chem import Descriptors as _Desc
            kept: list[dict] = []
            rejected_count = 0
            for s in survivors:
                try:
                    mol = Chem.MolFromSmiles(s["new_smiles"])
                    if mol is None:
                        # Couldn't parse — let the dock pipeline reject it
                        # with a clearer error than ours.
                        kept.append(s)
                        continue
                    mol_volume = float(_Desc.MolWt(mol)) * 1.3
                    if mol_volume > max_mol_volume:
                        log.info(
                            "optimize_loop: rejecting oversized variant: vol=%.0f Å³ > 60%% of pocket %.0f Å³ (MW=%.0f) %r",
                            mol_volume, pocket_volume, mol_volume / 1.3, s["new_smiles"][:40],
                        )
                        rejected_count += 1
                        continue
                    kept.append(s)
                except Exception as e:
                    # Any RDKit failure → benefit-of-the-doubt, keep it.
                    log.debug("optimize_loop: geometry filter skipped %r: %s", s["new_smiles"][:40], e)
                    kept.append(s)
            if rejected_count > 0:
                log.info(
                    "optimize_loop: pocket-geometry filter rejected %d/%d oversized candidates (pocket vol=%.0f Å³, max ligand vol=%.0f Å³)",
                    rejected_count, len(survivors), pocket_volume, max_mol_volume,
                )
            survivors = kept
        except ImportError:
            # RDKit unavailable in this environment — skip the filter,
            # batch dock will still run on all survivors.
            log.warning("optimize_loop: RDKit not available, skipping pocket-geometry filter")

    if not survivors:
        log.info("optimize_loop: 0 survivors after pocket-geometry filter — falling back")
        return _fallback_undocked(
            raw_variants,
            "All AI candidates were too large for this pocket. Try the Improve button for a more conservative edit, or pick a target with a larger binding site.",
        )

    # ── 3. Batch-dock survivors ──────────────────────────────────────
    docked_results, dock_meta = await _batch_quick_dock(
        smiles_list=[s["new_smiles"] for s in survivors],
        target_pdb=target_pdb,
        chain=chain,
        mutations=mutations,
    )

    # docked_results is a list of QuickDockResult-shaped dicts in the same
    # order as survivors. Each is either {ok:True, score, hits, misses} or
    # {ok:False, error}. If the WHOLE batch came back as an error (e.g.
    # pod down, no receptor on file), fall back to undocked variants.
    if all((not r.get("ok")) for r in docked_results):
        # All failed — likely receptor/pod problem, not per-ligand failure.
        first_err = next((r.get("error") for r in docked_results if r.get("error")), "Docking pod unavailable")
        log.warning("optimize_loop: all variants failed dock; falling back. err=%s", first_err)
        return _fallback_undocked(
            raw_variants,
            f"AI proposed {len(raw_variants)} variants but the docking pod isn't available right now. Showing un-docked candidates — click Apply to try them in the canvas.",
        )

    # ── 4. Compute composite fitness ─────────────────────────────────
    mutation_residue = _parse_mutation_residue(mutations)
    if mutation_residue is None and mutations:
        log.info("optimize_loop: couldn't parse mutation residue from %r — mutation_contact will be False for all", mutations)

    scored: list[ScoredVariant] = []
    for cand, dock in zip(survivors, docked_results):
        if not dock.get("ok"):
            log.info("optimize_loop: skipping un-dockable variant: %r err=%s", cand["new_smiles"], dock.get("error"))
            continue
        score = float(dock["score"])
        delta = parent_score - score
        mut_contact = _hit_touches_mutation(dock.get("hits") or [], mutation_residue)
        # Pose-pocket fields: default to "in pocket" (True, 0.0) when the
        # batch dock didn't compute them — preserves prior behaviour for
        # unexpected codepaths and means the drift penalty doesn't fire
        # spuriously. _batch_quick_dock populates both on the happy path.
        pose_in_pocket = bool(dock.get("pose_in_pocket", True))
        pose_offset_a = float(dock.get("pose_offset_a", 0.0))
        fitness = _composite_fitness(
            delta=delta,
            sa_score=cand["sa_score"],
            mutation_contact=mut_contact,
            pose_in_pocket=pose_in_pocket,
        )
        sv = ScoredVariant(
            new_smiles=cand["new_smiles"],
            rationale=cand["rationale"],
            score=round(score, 2),
            delta=round(delta, 2),
            sa_score=round(cand["sa_score"], 1),
            fitness=round(fitness, 2),
            mutation_contact=bool(mut_contact),
            hits=list(dock.get("hits") or []),
            misses=list(dock.get("misses") or []),
            pose_in_pocket=pose_in_pocket,
            pose_offset_a=round(pose_offset_a, 1),
        )
        # Carry the AI's self-predictions through so the UI can show a
        # calibration badge (predicted Δ vs actual Δ).
        if cand.get("predicted_improvement_kcal") is not None:
            sv["predicted_improvement_kcal"] = float(cand["predicted_improvement_kcal"])
        if cand.get("predicted_sa_score") is not None:
            sv["predicted_sa_score"] = float(cand["predicted_sa_score"])
        if cand.get("mutation_target") is not None:
            sv["mutation_target"] = cand["mutation_target"]
        scored.append(sv)

    if not scored:
        log.info("optimize_loop: no successfully-docked variants — falling back")
        return _fallback_undocked(
            raw_variants,
            "All AI candidates failed to dock. Try the Improve button for a more conservative edit.",
        )

    # ── 4b. Pocket-correction redesign ───────────────────────────────
    # When ≥75% of scored variants drifted off the pocket box, fire ONE
    # corrective AI redesign call asking for smaller / better-anchored
    # alternatives. Bounded retry — even bad redesigns cost real GPU
    # time on the re-dock + we want to stay under Cloudflare's 100s
    # edge timeout. Skip when target_pdb is empty (can't dock the
    # corrections anyway).
    # 2026-05-05 user request: "the AI designs a variant that is in
    # the pocket".
    # Trigger threshold for the off-pocket rescue redesign call.
    # 2026-05-05: bumped 0.75 → 0.90 for latency. The first AI batch
    # already runs the geometric MUST directive; firing the redesign call
    # at moderate drift (75%) added ~20s while only slightly improving
    # coverage. At 90% we only spend that extra round-trip when the
    # initial design space is genuinely catastrophic.
    DRIFT_REDESIGN_THRESHOLD = 0.90
    drifted_in_scored = [s for s in scored if not s.get("pose_in_pocket", True)]
    if (
        target_pdb
        and len(scored) >= 2
        and len(drifted_in_scored) / len(scored) >= DRIFT_REDESIGN_THRESHOLD
    ):
        log.info(
            "optimize_loop: %d/%d variants drifted off-pocket (≥%.0f%% threshold), firing pocket-redesign call",
            len(drifted_in_scored), len(scored), DRIFT_REDESIGN_THRESHOLD * 100,
        )
        try:
            redesign_extras = await ai.call_anthropic_optimize_pocket_redesign(
                smiles=smiles,
                score=parent_score,
                hits=hits,
                misses=misses,
                target_pdb=target_pdb,
                mutations=mutations,
                pocket_size_a=pocket_size_a,
                mutation_target_label=mutation_target_label,
                pocket_geometry_hint=pocket_geometry_hint,
                drifted_smiles=[s["new_smiles"] for s in drifted_in_scored],
                n_needed=5,
            )
        except Exception as e:
            log.warning("optimize_loop: pocket-redesign call failed (non-fatal): %s", e)
            redesign_extras = []

        if redesign_extras:
            # Run the same SA + geometry filter pipeline as the main
            # batch — keeps the contracts identical so a redesign variant
            # doesn't sneak in on a looser gate than the original survivors.
            redesign_survivors: list[dict] = []
            for v in redesign_extras:
                try:
                    sa = compute_sa_score(v["new_smiles"])
                except Exception:
                    continue
                # Bug-fix 2026-05-05: was `_SA_GATE` — undefined name caused
                # the redesign survivor filter to NameError out, so the rescue
                # path crashed silently whenever pocket-drift triggered it.
                # The intended gate is the same SA threshold the main batch uses.
                if sa is None or sa > _MAX_SA_SCORE:
                    continue
                redesign_survivors.append({
                    "new_smiles": v["new_smiles"],
                    "rationale": v["rationale"],
                    "sa_score": float(sa),
                    "predicted_improvement_kcal": v.get("predicted_improvement_kcal"),
                    "predicted_sa_score": v.get("predicted_sa_score"),
                    "mutation_target": v.get("mutation_target"),
                })
            # Pocket-geometry filter — same 60% threshold as the main batch.
            if pocket_size_a and redesign_survivors:
                sx, sy, sz = pocket_size_a
                max_mol_volume = sx * sy * sz * 0.6
                try:
                    from rdkit import Chem
                    from rdkit.Chem import Descriptors as _Desc
                    kept = []
                    for s in redesign_survivors:
                        try:
                            mol = Chem.MolFromSmiles(s["new_smiles"])
                            if mol is None:
                                kept.append(s)
                                continue
                            if float(_Desc.MolWt(mol)) * 1.3 > max_mol_volume:
                                continue
                            kept.append(s)
                        except Exception:
                            kept.append(s)
                    redesign_survivors = kept
                except ImportError:
                    pass

            if redesign_survivors:
                redesign_dock_results, _ = await _batch_quick_dock(
                    smiles_list=[s["new_smiles"] for s in redesign_survivors],
                    target_pdb=target_pdb,
                    chain=chain,
                    mutations=mutations,
                )
                added = 0
                for cand, dock in zip(redesign_survivors, redesign_dock_results):
                    if not dock.get("ok"):
                        continue
                    score_v = float(dock["score"])
                    delta = parent_score - score_v
                    mut_contact = _hit_touches_mutation(dock.get("hits") or [], mutation_residue)
                    pose_in_pocket = bool(dock.get("pose_in_pocket", True))
                    pose_offset_a = float(dock.get("pose_offset_a", 0.0))
                    fitness = _composite_fitness(
                        delta=delta,
                        sa_score=cand["sa_score"],
                        mutation_contact=mut_contact,
                        pose_in_pocket=pose_in_pocket,
                    )
                    sv = ScoredVariant(
                        new_smiles=cand["new_smiles"],
                        rationale=cand["rationale"],
                        score=round(score_v, 2),
                        delta=round(delta, 2),
                        sa_score=round(cand["sa_score"], 1),
                        fitness=round(fitness, 2),
                        mutation_contact=bool(mut_contact),
                        hits=list(dock.get("hits") or []),
                        misses=list(dock.get("misses") or []),
                        pose_in_pocket=pose_in_pocket,
                        pose_offset_a=round(pose_offset_a, 1),
                    )
                    if cand.get("predicted_improvement_kcal") is not None:
                        sv["predicted_improvement_kcal"] = float(cand["predicted_improvement_kcal"])
                    if cand.get("predicted_sa_score") is not None:
                        sv["predicted_sa_score"] = float(cand["predicted_sa_score"])
                    if cand.get("mutation_target") is not None:
                        sv["mutation_target"] = cand["mutation_target"]
                    scored.append(sv)
                    added += 1
                log.info("optimize_loop: pocket-redesign added %d new scored variants", added)

    # ── 5. Sort + truncate to top _TOP_N ─────────────────────────────
    scored.sort(key=lambda v: v["fitness"], reverse=True)
    top = scored[:_TOP_N]

    log.info(
        "optimize_loop: ranked %d → top %d. fitness_range=[%.2f, %.2f]",
        len(scored), len(top),
        top[-1]["fitness"], top[0]["fitness"],
    )

    result = OptimizeLoopResult(
        variants=top,
        candidates_generated=len(raw_variants),
        candidates_filtered=len(survivors),
        candidates_docked=len(scored),
        candidates_self_rejected=self_rejected,
        candidates_top_up=top_up_count,
        receptor_variant=dock_meta.get("receptor_variant", "wt"),
    )
    if dock_meta.get("fallback_reason"):
        # Surface the WT-fallback caveat so the UI can show "Mutant build
        # failed; scores are wild-type only" — the user deserves to know
        # whether the Δ they're seeing is mutation-aware or not.
        result["mutation_caveat"] = dock_meta["fallback_reason"]
    return result


def _fallback_undocked(raw_variants: list, note: str) -> OptimizeLoopResult:
    """When docking is unavailable, return the AI's variants without
    scores so the frontend can still surface them. The frontend's per-
    variant fan-out (existing code path) will fill in scores later.

    Carries the self-prediction fields when present so the UI can still
    render the AI's confidence even when the docker is down."""
    out_variants: list[ScoredVariant] = []
    for v in raw_variants[:_TOP_N]:
        sv = ScoredVariant(new_smiles=v["new_smiles"], rationale=v["rationale"])
        if v.get("predicted_improvement_kcal") is not None:
            sv["predicted_improvement_kcal"] = float(v["predicted_improvement_kcal"])
        if v.get("predicted_sa_score") is not None:
            sv["predicted_sa_score"] = float(v["predicted_sa_score"])
        if v.get("mutation_target") is not None:
            sv["mutation_target"] = v["mutation_target"]
        out_variants.append(sv)
    return OptimizeLoopResult(
        variants=out_variants,
        candidates_generated=len(raw_variants),
        candidates_filtered=len(raw_variants),
        candidates_docked=0,
        note=note,
    )


# ──────────────────────────────────────────────────────────────────────
# Batch quick-dock — same receptor, N ligands, ONE GPU call.
#
# Lifts the receptor-resolution + cache-prep logic from quick_dock.py
# (deliberately not refactoring the original — those flows are already
# stable). The differentiator vs N parallel quick_docks is using
# pod_dock.dock_batch_pod, which loads the receptor on the Pod ONCE and
# runs all N dockings in the same QuickVina2-GPU process.
# ──────────────────────────────────────────────────────────────────────


class _BatchDockOut(TypedDict, total=False):
    ok: bool
    score: float
    hits: list[str]
    misses: list[str]
    # Pose-pocket telemetry. pose_offset_a is the centroid-to-box-center
    # distance in Å for the chosen pose; pose_in_pocket flips False when
    # offset > _POSE_DRIFT_THRESHOLD_A from quick_dock.py. Used by the
    # composite fitness function to penalize variants that score well
    # but whose poses drifted outside the pocket box. 2026-05-05.
    pose_offset_a: float
    pose_in_pocket: bool
    error: str


async def _batch_quick_dock(
    *,
    smiles_list: list[str],
    target_pdb: str,
    chain: str = "A",
    mutations: Optional[str] = None,
) -> tuple[list[_BatchDockOut], dict]:
    """Dock N SMILES against the same target+mutation in a single batch.

    Returns one dict per input SMILES (same order). Per-ligand failures
    are surfaced as {ok:False, error:...}; whole-batch failures (no
    receptor, no pod) are returned as N copies of the same error so the
    caller can reason about either case uniformly.

    Async signature for ergonomic call from the optimize_loop, but the
    underlying pod client is sync (urllib). We run it in a thread to
    avoid blocking the event loop while a 30s GPU dispatch is in flight.
    """
    if not smiles_list:
        return [], {"receptor_variant": "wt", "fallback_reason": None}

    # Same imports as quick_dock — local to avoid heavy cold-start in the
    # common (non-optimize) path of the API process.
    try:
        from deltadock_pipeline.fetch import fetch_pdb
        from deltadock_pipeline.prep import (
            fix_pdb, prepare_receptor, prepare_ligand,
        )
        from deltadock_pipeline.dock import PocketBox
        from deltadock_pipeline.pod_dock import (
            dock_batch_pod, BatchLigand, PodDockConfig, PodDockError,
        )
        from ..catalog import get_target
        from ..config import get_settings
    except Exception as e:
        log.exception("optimize_loop: batch pipeline import failed")
        return [_BatchDockOut(ok=False, error=f"Quick dock pipeline unavailable: {e}") for _ in smiles_list], {"receptor_variant": "wt", "fallback_reason": str(e)}

    settings = get_settings()
    pod_url = settings.pod_dock_url
    if not pod_url:
        return [_BatchDockOut(ok=False, error="Quick dock pod isn't configured (POD_DOCK_URL missing).") for _ in smiles_list], {"receptor_variant": "wt", "fallback_reason": "POD_DOCK_URL missing"}

    # Receptor + box from the catalog. Same lookup as quick_dock —
    # accepts catalog ids ('kras') OR RCSB pdb ids ('4OBE').
    target = None
    try:
        target = get_target(target_pdb)
    except Exception:
        pass
    if target is None or target.pocket is None:
        msg = f"No pocket box on file for {target_pdb}. Run a normal job once to cache it."
        return [_BatchDockOut(ok=False, error=msg) for _ in smiles_list], {"receptor_variant": "wt", "fallback_reason": msg}

    pdb_id = target.pdb_id
    chain = target.chain or chain
    box = PocketBox(
        center_x=target.pocket.center[0],
        center_y=target.pocket.center[1],
        center_z=target.pocket.center[2],
        size_x=target.pocket.size[0],
        size_y=target.pocket.size[1],
        size_z=target.pocket.size[2],
    )

    cache_root = Path(settings.cache_root or "/var/lib/liganx/poses/cache")
    pdb_cache = cache_root / "pdb"
    receptor_cache = cache_root / "receptors"
    pdb_cache.mkdir(parents=True, exist_ok=True)
    receptor_cache.mkdir(parents=True, exist_ok=True)

    # Receptor — uses the shared services/receptor_prep.py helper for
    # mutant-aware build + cache + verify (matches the production runner).
    # 2026-05-04: previously this hardcoded WT regardless of the requested
    # mutation, which meant Optimize variants were scored against the
    # WT pocket even when the user picked T315I / V600E / etc. Now the
    # batch dock uses the same mutant receptor a full New Job would.
    # First mutation pays ~30-60s PDBFixer build; cached after.
    from .receptor_prep import prepare_receptor_for_target
    rec = prepare_receptor_for_target(
        pdb_id=pdb_id,
        chain=chain,
        mutation=mutations,
        pdb_cache=pdb_cache,
        receptor_cache=receptor_cache,
        minimize_mutant=getattr(target, "minimize_mutant", True),
    )
    receptor_pdbqt = rec.receptor_pdbqt
    receptor_pdb = rec.receptor_pdb
    if not receptor_pdbqt.exists() or receptor_pdbqt.stat().st_size == 0:
        msg = rec.fallback_reason or f"Receptor missing for {pdb_id}_{chain}"
        return [_BatchDockOut(ok=False, error=msg) for _ in smiles_list], {"receptor_variant": "wt", "fallback_reason": msg}
    if rec.fallback_reason and not rec.is_mutant and mutations:
        log.warning(
            "optimize_loop: requested %s but fell back to WT (%s)",
            mutations, rec.fallback_reason,
        )

    # Ligand prep — temp dir per call, one PDBQT per SMILES. Failures
    # (Meeko-rejected molecules) become per-ligand errors, not whole-
    # batch failures — that's the whole point of the pod_dock batch
    # contract.
    out: list[_BatchDockOut] = [_BatchDockOut(ok=False, error="not yet processed") for _ in smiles_list]

    with tempfile.TemporaryDirectory(prefix="opt_batch_") as tmpdir:
        tmp = Path(tmpdir)
        batch_in: list[BatchLigand] = []
        # Map ligand id (synthesised from index) → out-list index so we
        # can write results back in the original order.
        id_to_index: dict[str, int] = {}
        for i, smi in enumerate(smiles_list):
            lig_id = f"v{i:02d}"
            id_to_index[lig_id] = i
            ligand_pdbqt = tmp / f"{lig_id}.pdbqt"
            try:
                prepare_ligand(smi, ligand_pdbqt)
            except Exception as e:
                log.info("optimize_loop: ligand prep failed for %r: %s", smi, e)
                out[i] = _BatchDockOut(
                    ok=False,
                    error=f"Ligand prep failed: {e}",
                )
                continue
            batch_in.append(BatchLigand(id=lig_id, pdbqt_path=ligand_pdbqt))

        # Build the meta dict ONCE up here so all return paths can reuse
        # it. The function signature is `tuple[list, dict]`, so every
        # exit must return both — three early-return paths in this
        # block previously returned just `out` (no meta), which would
        # have raised "too many values to unpack" at the caller's
        # destructuring (assist.py:340 `docked_results, dock_meta = ...`).
        # Latent bug — never hit in production because the prep-failure
        # and pod-failure paths are rare. 2026-05-05.
        meta = {
            "receptor_variant": "mutant" if rec.is_mutant else "wt",
            "fallback_reason": rec.fallback_reason if (rec.fallback_reason and not rec.is_mutant and mutations) else None,
        }

        if not batch_in:
            return out, meta

        cfg = PodDockConfig(
            base_url=pod_url,
            timeout_s=min(settings.pod_dock_timeout_s, 60),
        )

        # Run the (sync, urllib-based) batch call off the event loop.
        # Wrapped in asyncio.wait_for with a hard wall-clock budget that
        # SUPERSEDES the underlying urllib timeout. Reason: PodDockConfig
        # timeout_s is per-request; if the pod accepts the connection
        # but the GPU dispatch hangs (we've seen this when a previous
        # pod job leaked GPU memory), urllib's read-timeout doesn't
        # always fire promptly. The async-level timeout guarantees we
        # surface an error to the frontend within the budget regardless
        # of socket weirdness — beats Cloudflare's 100s edge timeout
        # eating the request and the user seeing a generic 524.
        import asyncio
        # Budget = 1.5x the per-request timeout to allow for one retry
        # inside the pod client, capped at 90s to stay under Cloudflare.
        wall_clock_budget_s = min(int(cfg.timeout_s * 1.5), 90)
        try:
            results = await asyncio.wait_for(
                asyncio.to_thread(
                    dock_batch_pod,
                    receptor_pdbqt,
                    batch_in,
                    box,
                    tmp,
                    cfg,
                    # 2026-05-05: dropped 8 → 4 for Optimize-mode latency.
                    # Optimize is meant to be a fast EXPLORATION pass — users
                    # who want a tighter score on a specific variant can hit
                    # Quick Dock or Promote-to-Full-Job (both still run at
                    # exhaustiveness=8). Saves ~30s on the batch dock per
                    # /optimize call. Trade-off: noise envelope widens from
                    # ~±0.3 to ~±0.7 kcal/mol (Vina noise scales 1/sqrt(exh)),
                    # so the scores in the Optimize panel are now best read
                    # as relative rankings, not as final affinities. The
                    # rationale text and the "re-dock to confirm" muscle
                    # memory in Quick Dock cover this trade-off.
                    exhaustiveness=4,
                    num_modes=3,
                ),
                timeout=wall_clock_budget_s,
            )
        except asyncio.TimeoutError:
            log.warning(
                "optimize_loop: batch dock wall-clock timeout (%ds) — pod likely wedged",
                wall_clock_budget_s,
            )
            for lig in batch_in:
                idx = id_to_index[lig.id]
                out[idx] = _BatchDockOut(
                    ok=False,
                    error=f"Docking pod didn't respond in {wall_clock_budget_s}s — try Optimize again in a moment.",
                )
            return out, meta
        except PodDockError as e:
            log.info("optimize_loop: batch dock pod failure: %s", e)
            for lig in batch_in:
                idx = id_to_index[lig.id]
                out[idx] = _BatchDockOut(ok=False, error=f"Pod call failed: {e}")
            return out, meta
        except Exception as e:
            log.exception("optimize_loop: unexpected batch dock failure")
            for lig in batch_in:
                idx = id_to_index[lig.id]
                out[idx] = _BatchDockOut(ok=False, error=f"Unexpected docking failure: {e}")
            return out, meta

        # Map results back. Each result has either .result (DockingResult)
        # or .error. Successful results go through contact extraction.
        for r in results:
            idx = id_to_index.get(r.id)
            if idx is None:
                continue
            if r.error or r.result is None:
                out[idx] = _BatchDockOut(ok=False, error=r.error or "no result")
                continue
            try:
                best_score = float(r.result.modes[0].affinity_kcal_mol)
            except (IndexError, AttributeError, ValueError):
                out[idx] = _BatchDockOut(ok=False, error="malformed dock modes")
                continue
            try:
                hits, misses = _extract_contacts_for_pose(
                    pose_pdbqt=r.result.pose_pdbqt,
                    receptor_pdb=receptor_pdb,
                    box=box,
                )
            except Exception as e:
                # Contact extraction is best-effort — keep the score even
                # if hit/miss extraction failed.
                log.warning("optimize_loop: contact extraction failed (non-fatal): %s", e)
                hits, misses = [], []
            # Pose-pocket honesty (2026-05-05). Re-uses the same helper
            # quick_dock + pocket_filter use, so the threshold + offset
            # math match the per-variant Quick Dock badge in the editor.
            # Best-effort — failures here just leave pose_in_pocket
            # defaulting to True (no penalty), preserving prior behaviour
            # when the pose file is unreadable.
            try:
                from .quick_dock import compute_pose_offset_a, _POSE_DRIFT_THRESHOLD_A
                pose_offset = compute_pose_offset_a(
                    pose_pdbqt=r.result.pose_pdbqt,
                    box_center=(box.center_x, box.center_y, box.center_z),
                )
                # pose_in_pocket also requires len(hits) > 0 (a pose with
                # zero contacts isn't really IN the pocket even if its
                # centroid is close to the box center).
                in_pocket = pose_offset <= _POSE_DRIFT_THRESHOLD_A and len(hits) > 0
            except Exception as e:
                log.warning("optimize_loop: pose-offset compute failed (non-fatal): %s", e)
                pose_offset = 0.0
                in_pocket = True  # benefit-of-the-doubt — no penalty
            out[idx] = _BatchDockOut(
                ok=True,
                score=round(best_score, 2),
                hits=hits[:12],
                misses=misses[:8],
                pose_offset_a=round(pose_offset, 1),
                pose_in_pocket=bool(in_pocket),
            )

    # `meta` was built once above (just after the receptor-prep success
    # gate) so all return paths use the same value. Don't recompute.
    return out, meta


def _compute_pocket_geometry_hint(
    *,
    pose_pdbqt_text: str,
    receptor_pdb: Path,
    hits: list[str],
    mutation_residue: int,
) -> Optional[str]:
    """Build a directional medchem hint for the AI optimize prompt by
    measuring the geometric relationship between the parent ligand pose
    and the mutation residue.

    Without this hint the AI is told 'engage residue 315' but doesn't
    know in which direction residue 315 sits relative to the current
    scaffold. With it, the prompt becomes "extend from your contact
    with GLY60 toward residue 315 (4.2 Å away in the −X direction)" —
    a concrete medchem instruction the model can act on.

    2026-05-05 user question: "can the AI be smarter and after Quick
    Dock calculate where the mutation is and modify the structure to
    bring it close and not outside?"

    Returns None when:
      - no mutation residue (mutation string didn't parse),
      - receptor PDB or pose can't be parsed,
      - mutation residue isn't found in the receptor structure.
    Best-effort throughout — failures fall back to the existing
    residue-name-only prompt.
    """
    if mutation_residue is None or not pose_pdbqt_text or not receptor_pdb.exists():
        return None

    # Parse pose PDBQT for ligand atom coords. Same parsing as
    # _extract_contacts_for_pose but accepts a string (the optimize
    # endpoint receives base64-decoded pose text from the frontend
    # rather than a temp file path).
    pose_atoms: list[tuple[float, float, float]] = []
    for line in pose_pdbqt_text.splitlines():
        if not (line.startswith("ATOM") or line.startswith("HETATM")):
            continue
        try:
            x = float(line[30:38]); y = float(line[38:46]); z = float(line[46:54])
            elem = line[76:78].strip().upper() if len(line) >= 78 else ""
            if elem == "H":
                continue
            pose_atoms.append((x, y, z))
        except ValueError:
            continue
    if not pose_atoms:
        return None

    # Pose centroid for the "ligand is X Å from mutation" headline.
    cx = sum(a[0] for a in pose_atoms) / len(pose_atoms)
    cy = sum(a[1] for a in pose_atoms) / len(pose_atoms)
    cz = sum(a[2] for a in pose_atoms) / len(pose_atoms)

    # Receptor — find the mutation residue's Cα + collect Cα for every
    # hit residue so we can pick which contact is closest to the mutation.
    try:
        from Bio.PDB import PDBParser
    except ImportError:
        return None
    try:
        structure = PDBParser(QUIET=True).get_structure("rec", str(receptor_pdb))
    except Exception:
        return None

    # Build a dict: residue number → (resname, Cα coords) for all standard
    # residues in chain A (we only deal with single-chain receptors).
    res_ca: dict[int, tuple[str, tuple[float, float, float]]] = {}
    for model in structure:
        for chain in model:
            for residue in chain:
                if residue.get_id()[0].strip():  # skip HETATM/water
                    continue
                resnum = residue.get_id()[1]
                try:
                    ca = residue["CA"]
                    res_ca[resnum] = (residue.get_resname(), tuple(ca.coord))
                except KeyError:
                    continue
            break  # chain A only — first chain in first model
        break

    if mutation_residue not in res_ca:
        return None
    mut_resname, (mx, my, mz) = res_ca[mutation_residue]

    # Closest-ligand-atom distance to mutation Cα — gives the AI the
    # "how far do we need to extend?" number.
    min_atom_dist = math.inf
    for px, py, pz in pose_atoms:
        d = math.sqrt((px - mx) ** 2 + (py - my) ** 2 + (pz - mz) ** 2)
        if d < min_atom_dist:
            min_atom_dist = d

    # Of the ligand's contacted residues (the `hits` list, format
    # "A:GLY60"), find the one whose Cα is closest to the mutation
    # residue's Cα. That's the natural "extend from here" anchor.
    closest_hit_label: Optional[str] = None
    closest_hit_dist = math.inf
    import re as _re
    for hit in hits:
        m = _re.search(r"(\d+)$", hit)
        if not m:
            continue
        try:
            hit_resnum = int(m.group(1))
        except ValueError:
            continue
        if hit_resnum not in res_ca:
            continue
        _, (hx, hy, hz) = res_ca[hit_resnum]
        d = math.sqrt((hx - mx) ** 2 + (hy - my) ** 2 + (hz - mz) ** 2)
        if d < closest_hit_dist:
            closest_hit_dist = d
            closest_hit_label = hit  # full label "A:GLY60"

    # Direction vector from ligand centroid to mutation Cα. Normalised
    # to unit length and rounded to two decimals for prompt brevity.
    dx, dy, dz = mx - cx, my - cy, mz - cz
    mag = math.sqrt(dx * dx + dy * dy + dz * dz)
    if mag < 1e-6:
        # Ligand IS the mutation residue — degenerate. Skip direction.
        direction_str = "(at the residue)"
    else:
        ux, uy, uz = dx / mag, dy / mag, dz / mag
        # Convert to a simple +X/-X/+Y/-Y/+Z/-Z descriptor for the
        # dominant axis. Receptor coordinate frame is arbitrary so this
        # is more of an identifier than a real direction; what matters
        # is that the AI can compare directions across variants.
        axes = [("+X", ux), ("-X", -ux), ("+Y", uy), ("-Y", -uy), ("+Z", uz), ("-Z", -uz)]
        axes.sort(key=lambda p: p[1], reverse=True)
        dominant_axis = axes[0][0]
        direction_str = f"primarily {dominant_axis} (vector {ux:+.2f}, {uy:+.2f}, {uz:+.2f})"

    # Format the final guidance as a HARD DIRECTIVE. The previous
    # descriptive flavour ("To engage residue X, extend...") got the
    # geometry into the prompt but the AI consistently downweighted it
    # against its other instructions — observed 2026-05-05 prod test:
    # KRAS Q61H ran with HIS61 11.5 Å away, hint sent, all 3 variants
    # came back with generic medchem rationales (fluorine walk, ring-
    # closure, stereogenic center) and zero reference to the
    # mutation residue or the closest-hit anchor. Switching to an
    # explicit MUST/REQUIRED clause + a rationale-citation rule
    # forces the AI to acknowledge the geometry in at least one
    # variant's reasoning.
    if closest_hit_label is not None and closest_hit_dist < math.inf:
        return (
            f"Pocket geometry — REQUIRED ACTION FOR AT LEAST ONE VARIANT: "
            f"the mutation residue {mut_resname}{mutation_residue} sits "
            f"{min_atom_dist:.1f} Å from your nearest ligand atom. Of your "
            f"contacted residues, {closest_hit_label} is closest to the "
            f"mutation (Cα–Cα distance {closest_hit_dist:.1f} Å). AT LEAST "
            f"ONE variant in your batch MUST extend the scaffold from its "
            f"contact with {closest_hit_label} toward residue "
            f"{mutation_residue}, in the {direction_str} direction. State "
            f"'extends from {closest_hit_label} toward "
            f"{mut_resname}{mutation_residue}' (or equivalent residue-named "
            f"language) explicitly in that variant's rationale — generic "
            f"medchem moves like 'fluorine walk' or 'ring-closure' that "
            f"don't name the anchor residue or the mutation residue do "
            f"NOT satisfy this requirement."
        )
    # No suitable anchor hit — fall back to a softer geometry note.
    return (
        f"Pocket geometry: the mutation residue {mut_resname}{mutation_residue} "
        f"sits {min_atom_dist:.1f} Å from your nearest ligand atom, "
        f"{direction_str}. Variants extending the scaffold in this "
        f"direction will be ranked higher; cite {mut_resname}{mutation_residue} "
        f"by name in any variant rationale that targets it."
    )


def _extract_contacts_for_pose(*, pose_pdbqt: Path, receptor_pdb: Path, box) -> tuple[list[str], list[str]]:
    """Inline copy of quick_dock._extract_contacts to avoid coupling to a
    private function in another module (the underscore-prefixed name was
    a deliberate signal that it's private). Same algorithm: 4 Å for
    contact, 8 Å of pocket centroid for "near"."""
    pose_atoms: list[tuple[float, float, float]] = []
    for line in pose_pdbqt.read_text().splitlines():
        if not (line.startswith("ATOM") or line.startswith("HETATM")):
            continue
        try:
            x = float(line[30:38]); y = float(line[38:46]); z = float(line[46:54])
            elem = line[76:78].strip().upper() if len(line) >= 78 else ""
            if elem == "H":
                continue
            pose_atoms.append((x, y, z))
        except ValueError:
            continue

    if not pose_atoms:
        return [], []

    from Bio.PDB import PDBParser
    parser = PDBParser(QUIET=True)
    try:
        structure = parser.get_structure("rec", str(receptor_pdb))
    except Exception:
        return [], []

    box_centroid = (box.center_x, box.center_y, box.center_z)
    HIT_R = 4.0
    NEAR_R = 8.0

    hits_set: set[str] = set()
    nearby_set: set[str] = set()
    for model in structure:
        for chain in model:
            for residue in chain:
                hetflag = residue.get_id()[0]
                if hetflag.strip() and hetflag != " ":
                    continue
                resname = residue.get_resname()
                resnum = residue.get_id()[1]
                key = f"{chain.id}:{resname}{resnum}"
                min_to_pose = math.inf
                min_to_centroid = math.inf
                for atom in residue:
                    if atom.element == "H":
                        continue
                    ax, ay, az = atom.coord
                    d = math.sqrt(
                        (ax - box_centroid[0]) ** 2
                        + (ay - box_centroid[1]) ** 2
                        + (az - box_centroid[2]) ** 2
                    )
                    if d < min_to_centroid:
                        min_to_centroid = d
                    for px, py, pz in pose_atoms:
                        pd = math.sqrt(
                            (ax - px) ** 2 + (ay - py) ** 2 + (az - pz) ** 2
                        )
                        if pd < min_to_pose:
                            min_to_pose = pd
                            if min_to_pose < HIT_R:
                                break
                    if min_to_pose < HIT_R:
                        break
                if min_to_pose < HIT_R:
                    hits_set.add(key)
                elif min_to_centroid < NEAR_R:
                    nearby_set.add(key)
    return sorted(hits_set), sorted(nearby_set - hits_set)
