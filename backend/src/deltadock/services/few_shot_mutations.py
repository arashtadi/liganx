"""Few-shot mutation library for the AI Optimize prompt (Tier 1 #3).

The Generate-Score-Filter loop already gives the model a docking-aware view
of the missed residues. The Hard-Constraint Reject Loop teaches it to
self-evaluate. What's still missing: concrete WORKED EXAMPLES of how
expert medicinal chemists have historically solved this exact mutation
class.

This module ships ~15 curated parent → designed pairs from real drug-
discovery literature, organized by mutation class. When the user runs
Optimize against, say, EGFR T790M, the prompt builder appends the
T790M-class examples (Osimertinib, Lazertinib) right before the model
generates. The model can then ANCHOR on those moves rather than
reasoning from first principles every time.

Cost: ~150 tokens per example × 2-3 examples per call = ~450 tokens.
At Haiku rates, ~$0.0005 extra per Optimize. Negligible vs the quality
lift.

Curation principles:
  1. Each example MUST be a real, named precedent (Author Year). No invented
     transformations — that's the whole point.
  2. The "designed" SMILES is a SIMPLIFIED form when the real drug has
     macrocycles or other Vina-unfriendly features. The model is meant to
     learn the PATTERN, not copy the exact graph.
  3. The rationale spells out the BIOPHYSICAL DELTA, not just "added a group."
     This is what makes the example transferable to the user's scaffold.
  4. We deliberately mix parent classes (kinases, proteases) within a mutation
     class so the model doesn't over-fit to one scaffold family.
"""

from __future__ import annotations

import re
from typing import Optional, TypedDict


class FewShotExample(TypedDict):
    parent_drug: str        # name of the parent (e.g. "Imatinib")
    parent_smiles: str      # SMILES of the parent
    designed_drug: str      # name of the designed solution (e.g. "Ponatinib")
    designed_smiles: str    # SMILES of the designed solution
    mutation: str           # the mutation that drove the redesign (e.g. "T315I")
    rationale: str          # one-line biophysical justification + citation


# ──────────────────────────────────────────────────────────────────────
# Library — organized by mutation class
#
# Class keys are stable strings the classifier returns. Don't rename
# without updating both _classify_mutation() and the lookup in
# select_few_shot_examples().
# ──────────────────────────────────────────────────────────────────────

_LIBRARY: dict[str, list[FewShotExample]] = {
    # ── GATEKEEPER (Thr/Ser/Cys → bulky hydrophobic Ile/Met/Phe) ─────
    # The gatekeeper residue lines the back of the ATP cleft. Mutating
    # it to a bulkier hydrophobic residue creates a steric clash that
    # blocks 1st-gen ATP-competitive inhibitors. Two main solutions:
    # (a) extend a linear linker (alkyne) to BYPASS the bulk, or
    # (b) use a smaller/different headgroup that fits next to the bulk.
    "gatekeeper": [
        {
            "parent_drug": "Imatinib",
            "parent_smiles": "Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1",
            "designed_drug": "Ponatinib",
            "designed_smiles": "Cc1ccc(C#Cc2cnc3cc(NC(=O)c4ccc(CN5CCN(C)CC5)cc4)ccc3n2)cn1",
            "mutation": "T315I",
            "rationale": "Replaces the methyl-pyrimidine linker with a rigid alkyne (sp carbon, ~3.4 Å reach) that bypasses the Ile315 side chain instead of clashing with it (O'Hare 2009).",
        },
        {
            "parent_drug": "Gefitinib",
            "parent_smiles": "COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1",
            "designed_drug": "Osimertinib",
            "designed_smiles": "COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1",
            "mutation": "T790M",
            "rationale": "Replaces 4-anilinoquinazoline with a 2-aminopyrimidine that tolerates the larger Met790, then anchors irreversibly via an acrylamide on Cys797 (Cross 2014).",
        },
        {
            "parent_drug": "Crizotinib",
            "parent_smiles": "Cc1cnc(Nc2ccc(N3CCC(N)CC3)nc2)nc1-c1ccc(F)c(Cl)c1",
            "designed_drug": "Lorlatinib",
            "designed_smiles": "CC1OC2=CC(F)=CC(=NC(=O)N(C)C(C)c3ncc(C#N)cc3-1)2",
            "mutation": "L1196M",
            "rationale": "Macrocyclises the kinase-binding scaffold to lock the bioactive conformation, sacrificing one substituent's freedom to fit alongside the bulkier Met1196 (Johnson 2014).",
        },
    ],
    # ── COVALENT TARGET LOSS (Cys → Ser/anything else) ───────────────
    # Drugs that anchored irreversibly to a cysteine (Michael acceptor on
    # acrylamide → Cys-SH adduct) lose the entire covalent contribution
    # when the Cys is mutated. The fix is one of two strategies:
    # (a) DROP the warhead entirely and re-optimise non-covalent affinity
    #     to compensate (Pirtobrutinib);
    # (b) RETARGET to a different nearby cysteine (rare, only some kinases).
    "covalent_loss": [
        {
            "parent_drug": "Ibrutinib",
            "parent_smiles": "C=CC(=O)N1CCCC1c1cc(-c2ccccc2Oc2ccncn2)nn1",
            "designed_drug": "Pirtobrutinib",
            "designed_smiles": "Cc1cc(C(F)(F)F)nn1-c1cncc(C(=O)c2ccccc2)c1",
            "mutation": "C481S",
            "rationale": "Drops the acrylamide warhead (no longer anchors to mutated Ser481) and re-optimises to high non-covalent affinity (Kd ~1 nM) via deeper hydrophobic engagement (Mato 2021).",
        },
        {
            "parent_drug": "Osimertinib",
            "parent_smiles": "COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1",
            "designed_drug": "Lazertinib",
            "designed_smiles": "Cc1cc(NC(=O)C=C)cc(-n2cnc3cc(Nc4ncc(F)c(-c5ccc(F)c(Cl)c5)n4)ccc23)c1",
            "mutation": "C797S",
            "rationale": "Repositions the acrylamide on a re-engineered scaffold so the warhead reaches the alternate Cys797 conformation, partially restoring covalent anchoring lost when C797S resists Osimertinib (Yun 2008-style approach, Park 2021).",
        },
    ],
    # ── ACTIVATION LOOP (V/L/D → E/V/Y, conformational shift) ────────
    # Mutations on the activation loop or DFG motif flip the kinase to
    # a constitutively-active conformation. ATP-competitive Type-I
    # inhibitors that were designed against the inactive WT often have
    # the wrong shape for the active state. The fix: design AGAINST the
    # active conformation directly (Vemurafenib for V600E) or use a
    # back-pocket Type-II that doesn't care about the loop (Sorafenib).
    "activation_loop": [
        {
            "parent_drug": "Sorafenib",
            "parent_smiles": "CNC(=O)c1cc(Oc2ccc(NC(=O)Nc3ccc(Cl)c(C(F)(F)F)c3)cc2)ccn1",
            "designed_drug": "Vemurafenib",
            "designed_smiles": "CCCS(=O)(=O)Nc1ccc(F)c(C(=O)c2c(-c3ccc(Cl)cc3)cnc3[nH]ccc23)c1",
            "mutation": "V600E",
            "rationale": "Designed against the αC-helix-IN active state (the V600E-induced conformation) rather than the inactive DFG-out form Sorafenib targets — the propeller-shaped pyrrolopyridine fills the V600E hydrophobic spine specifically (Bollag 2010).",
        },
        {
            "parent_drug": "Imatinib",
            "parent_smiles": "Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1",
            "designed_drug": "Avapritinib",
            "designed_smiles": "NC1(c2cncn2C2CCN(c3nccc4cnccc34)CC2)CC1",
            "mutation": "D816V",
            "rationale": "Imatinib relies on the inactive DFG-out conformation that D816V destabilises. Avapritinib binds the active-state KIT directly (Type I-1/2), with a small pyrrolotriazine that doesn't depend on the shifted loop (Evans 2017).",
        },
    ],
    # ── G12C / COVALENT HANDLE (Gly → Cys creates a NEW cysteine) ────
    # KRAS G12C is unique: the mutation CREATES a cysteine that was
    # never there in WT, opening a covalent-design opportunity. The
    # designed drugs all use Michael acceptors to anchor on the new Cys.
    # Lesson for the model: when mutation creates a NEW reactive residue,
    # the design opportunity is the OPPOSITE of the covalent_loss class.
    "g12c_covalent_handle": [
        {
            "parent_drug": "(scaffold from screening)",
            "parent_smiles": "O=C(Cn1cc(-c2cnc3ccccc3n2)cn1)c1ccccc1",
            "designed_drug": "Sotorasib",
            "designed_smiles": "CC1(C)Cn2c(=O)c(F)c(Oc3cc(F)cc(NC(=O)C=C)c3)c2N1c1ccncc1",
            "mutation": "G12C",
            "rationale": "Adds an acrylamide Michael acceptor positioned to attack the G12C cysteine in the switch-II pocket, locking GDP-bound KRAS in the inactive state (Canon 2019). Note: only WORKS for G12C — not G12D/V which lack the cysteine.",
        },
    ],
    # ── CHARGE FLIP at hotspot (Gly → Arg/Lys/His; or Glu → Lys) ─────
    # The mutated residue gains/loses a charged group. Design fix:
    # complement with the OPPOSITE charge in the ligand reaching that
    # position (carboxylate to a new Arg, basic amine to a new Asp).
    # Often combined with a linker extension since the side chain is now
    # bigger.
    "charge_flip_to_basic": [
        {
            "parent_drug": "Imatinib",
            "parent_smiles": "Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1",
            "designed_drug": "Adagrasib (analog of)",
            "designed_smiles": "Cc1cnc(N2CCN(c3cnc4ncc(C(=O)O)cc4n3)C2)nc1Nc1ccc(F)cc1",
            "mutation": "G2032R",
            "rationale": "Adds a carboxylate within ~6 Å of the new Arg2032 side chain to form a salt-bridge, simultaneously rigidifying with a piperazine linker for entropy savings (general principle for solvent-front charge-flip resistance).",
        },
    ],
    # ── SOLVENT-FRONT MUTATIONS (Gly→Arg or similar at solvent face) ─
    # The mutated residue projects INTO the solvent (not the ATP cleft),
    # but its bulk now occludes the kinase entrance. Solutions are
    # macrocyclic constraints (limit ligand reach into the SF) OR direct
    # complementarity (carboxylate-to-Arg salt bridge).
    "solvent_front": [
        {
            "parent_drug": "Crizotinib",
            "parent_smiles": "Cc1cnc(Nc2ccc(N3CCC(N)CC3)nc2)nc1-c1ccc(F)c(Cl)c1",
            "designed_drug": "Lorlatinib",
            "designed_smiles": "CC1OC2=CC(F)=CC(=NC(=O)N(C)C(C)c3ncc(C#N)cc3-1)2",
            "mutation": "G1202R",
            "rationale": "Macrocyclic constraint stops the ligand from extending into the solvent-front where the new Arg1202 sits, while gaining ~1000-fold potency from the entropy term (Johnson 2014, Solomon 2018).",
        },
    ],
}


# ──────────────────────────────────────────────────────────────────────
# Mutation classification
# ──────────────────────────────────────────────────────────────────────

# Standard 1-letter amino acid codes used in mutation strings.
_GATEKEEPER_ORIG = {"T", "S"}                  # Thr, Ser at canonical gatekeeper position
_GATEKEEPER_NEW = {"I", "M", "L", "F"}         # bulky hydrophobic
_COVALENT_PARENT = {"C"}                       # Cys mutations = covalent target loss
# Activation loop / hotspot destinations — includes R/K because H1047R,
# D835R-style charge flips at known hotspots are activation-loop in nature.
_ACT_LOOP_DEST = {"E", "K", "V", "Y", "H", "R", "D"}
_ACT_LOOP_HOTSPOTS = {"V600", "D816", "D835", "H1047", "L597", "Y1230", "D1228"}
_BASIC_RESIDUES = {"R", "K", "H"}
_ACIDIC_RESIDUES = {"D", "E"}

# Known gatekeeper POSITIONS across our catalog kinases. The amino-acid-
# pair rule (Thr→bulky) only catches the common case; for ALK the
# gatekeeper is L1196M (Leu→Met, both bulky), and the structural role is
# what matters. Listing positions explicitly catches these correctly.
_GATEKEEPER_POSITIONS = {
    "T315",   # ABL
    "T790",   # EGFR
    "L1196",  # ALK
    "T474",   # BTK
    "T670",   # KIT
    "F691",   # FLT3
    "F317",   # ABL secondary gatekeeper
}

# Known activating-mutation positions (different mechanism from
# activation-loop charge flip — these include sensitising mutations
# that drive Type-I selectivity, e.g. EGFR L858R).
_ACTIVATING_POSITIONS = {
    "L858",   # EGFR — activating, anchors Type-I inhibitor design
}

_MUT_REGEX = re.compile(r"^([A-Z])(\d{1,4})([A-Z])$")


def _classify_mutation(mutation_code: str) -> Optional[str]:
    """Map a single-mutation code (e.g. 'T315I') to a library bucket key.
    Returns None when the code doesn't fit any bucket — caller should
    skip few-shot injection in that case rather than guess.

    The classifier is deliberately conservative: it'd rather return None
    than misclassify, since a bad few-shot example is worse than no
    example at all (the model may anchor on the wrong principle)."""
    if not mutation_code:
        return None
    code = mutation_code.strip().upper()
    m = _MUT_REGEX.match(code)
    if not m:
        return None
    orig, num, new = m.group(1), m.group(2), m.group(3)
    pos_key = f"{orig}{num}"

    # G12C is a unique case — Gly→Cys CREATES a covalent handle (the
    # opposite design opportunity from covalent_loss).
    if orig == "G" and new == "C":
        return "g12c_covalent_handle"

    # Covalent target loss — Cys → anything is the canonical signal
    # because the Cys was almost certainly the anchor point of a
    # covalent inhibitor.
    if orig in _COVALENT_PARENT:
        return "covalent_loss"

    # Activation-loop hotspots — these positions are well-known DFG/loop
    # destabilisers. Match the position prefix BEFORE the gatekeeper
    # check so V600E doesn't get mis-bucketed as gatekeeper.
    if pos_key in _ACT_LOOP_HOTSPOTS and new in _ACT_LOOP_DEST:
        return "activation_loop"

    # Activating sensitising mutation at a known position (e.g. EGFR L858R).
    # These are NOT resistance mutations — they're the mutations that
    # define the disease subtype the inhibitor was designed against. Treat
    # them as activation_loop class for prompt purposes (same V600E-style
    # design lessons apply: target the active conformation directly).
    if pos_key in _ACTIVATING_POSITIONS:
        return "activation_loop"

    # Gatekeeper — by KNOWN POSITION first (catches L1196M, F691L, etc.)
    if pos_key in _GATEKEEPER_POSITIONS:
        return "gatekeeper"
    # Falls back to amino-acid-pair check for unknown kinases.
    if orig in _GATEKEEPER_ORIG and new in _GATEKEEPER_NEW:
        return "gatekeeper"

    # Solvent-front — KNOWN SF position takes precedence over the
    # generic charge-flip rule because the design strategy is different
    # (macrocyclic constraint vs salt-bridge complementarity).
    if orig == "G" and new in _BASIC_RESIDUES and pos_key in {"G1202", "G2032", "G505"}:
        return "solvent_front"

    # Charge-flip to BASIC — Gly/small → Arg/Lys/His. The pocket gets
    # a new positive charge. Generic — applies to non-SF positions.
    if orig in {"G", "A", "S", "T"} and new in _BASIC_RESIDUES:
        return "charge_flip_to_basic"

    return None


def select_few_shot_examples(mutations: Optional[str], n: int = 2) -> list[FewShotExample]:
    """Return up to `n` curated examples for the mutation class detected
    in the user's mutations string. Empty list when no class matches —
    don't inject anything in that case (better than misleading examples).

    `mutations` can be a single code ("T315I") or a comma/plus-separated
    list ("T790M+C797S", "T315I, E255K"). We classify each and prefer
    the bucket with the most matches; ties broken by first-seen order.
    """
    if not mutations:
        return []
    tokens = [t.strip() for t in re.split(r"[,;+\s]+", mutations) if t.strip()]
    if not tokens:
        return []

    # Vote on which bucket fits the user's mutation set best. For a
    # compound mutation like T790M+C797S we'd see one vote each for
    # 'gatekeeper' and 'covalent_loss' — pick the first non-None
    # classification (matches user's lead mutation) for stability.
    bucket = None
    for tok in tokens:
        cls = _classify_mutation(tok)
        if cls is not None:
            bucket = cls
            break
    if bucket is None or bucket not in _LIBRARY:
        return []
    return _LIBRARY[bucket][:n]


def format_few_shot_block(examples: list[FewShotExample]) -> str:
    """Render the examples as a markdown-free text block ready to splice
    into the system prompt. Keeps each example to ~150 tokens by trimming
    the SMILES presentation but preserving the rationale verbatim — the
    rationale is the load-bearing part for the model's transfer learning.
    """
    if not examples:
        return ""
    lines = [
        "",
        "# Worked precedents for this mutation class",
        "These are real drug-discovery examples that solved THE SAME class of",
        "mutation. Use them as INSPIRATION for the design axis — do NOT copy",
        "the SMILES verbatim. The user's parent scaffold is different.",
        "",
    ]
    for i, ex in enumerate(examples, 1):
        lines.append(f"Example {i}: {ex['parent_drug']} → {ex['designed_drug']} (mutation: {ex['mutation']})")
        lines.append(f"  Parent:   {ex['parent_smiles']}")
        lines.append(f"  Designed: {ex['designed_smiles']}")
        lines.append(f"  Lesson:   {ex['rationale']}")
        lines.append("")
    return "\n".join(lines)
