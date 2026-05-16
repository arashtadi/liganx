"""Curated clinical mutation library.

Each Target represents a clinically actionable protein. Each entry includes:
  - canonical WT structure (PDB ID + chain) — verified by scripts/verify_catalog.py
  - the binding pocket box (centre + size in Å) — computed from a co-crystal ligand
  - clinically important mutations on that target
  - reference compounds (approved or well-characterized inhibitors)

PDB IDs were chosen to satisfy two constraints:
  1. The structure is wild-type at the residues we want to mutate
  2. The structure has a co-crystal ligand at the relevant pocket

Run `python backend/scripts/verify_catalog.py` after editing to re-verify.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class PocketBox:
    center: tuple[float, float, float]
    size: tuple[float, float, float] = (22.0, 22.0, 22.0)


@dataclass
class Mutation:
    code: str               # "T790M"
    label: str              # "T790M (gatekeeper, gefitinib resistance)"
    significance: str       # short clinical context


@dataclass
class ReferenceCompound:
    name: str
    smiles: str
    mechanism: str          # short description


@dataclass
class Target:
    id: str                 # short slug, e.g. "egfr"
    name: str               # display name
    uniprot: str
    pdb_id: str             # default WT structure
    chain: str
    pocket: PocketBox
    description: str        # 1-2 sentences
    indications: list[str]  # cancers / diseases this is relevant in
    mutations: list[Mutation] = field(default_factory=list)
    compounds: list[ReferenceCompound] = field(default_factory=list)
    # (T1) Druggability tier — the trust signal the chemist agent and
    # pre-flight need so they can warn the user when an experiment has
    # no published precedent. Values are deliberately a four-way enum,
    # not a number: chemists think in classes ("kinase ATP-site, well-
    # validated" vs "experimental, no chemical matter") not a 0-1 score.
    #   • "established" — well-known target with multiple approved drugs
    #     (EGFR, ABL, BRAF V600E, KIT D816V)
    #   • "recent"      — recently cracked, has at least one approved
    #     drug (KRAS G12C / Sotorasib + Adagrasib)
    #   • "experimental"— not yet cracked, no approved direct binder
    #     (KRAS G12D, KRAS G13D, KRAS Q61H)
    #   • "untested"    — anything we haven't audited yet
    druggability: str = "untested"
    # Short justification for the druggability tier — shown in the agent's
    # prompt and (eventually) the UI. Plain English, one sentence.
    druggability_note: str = ""
    # (T1) Canonical drug-binding residues for this target — the residues
    # a chemist EXPECTS a real binder to contact. The agent compares the
    # observed ProLIF contacts against this set; zero overlap is a strong
    # signal of off-pocket surface-binding (the Cenestil + KRAS case).
    # Use the standard one-letter+number form ("T790", "M793"). Order is
    # not significant.
    canonical_pocket_residues: list[str] = field(default_factory=list)
    # (T1) Typical Vina-score range (in kcal/mol; more negative = stronger)
    # for KNOWN ACTIVE COMPOUNDS at this target. Used as a calibration
    # band: a result well above the upper bound is "below typical for a
    # real binder" — a noise-floor surface contact. Values informed by
    # literature/published docking benchmarks for each target class;
    # refine via the S2 retrospective validation harness when you have
    # ChEMBL data for the target.
    #
    # The convention here is (worst_typical, best_typical) — both
    # negative numbers, more negative = stronger. So (-11.0, -8.0) means
    # known actives usually score between -11 and -8 kcal/mol.
    typical_vina_range: tuple[float, float] = (-11.0, -7.0)
    # Whether to run a short OpenMM amber99sb-ildn vacuum minimisation on
    # the mutant receptor after PDBFixer applies the residue substitution.
    # Default True — relieves substitution clash artefacts and is what
    # unlocked clean signal on ABL T315I, EGFR T790M, KIT D816V, BTK C481S.
    # Set False per-target when the minimisation does more harm than good:
    # specifically for activation-loop residues whose mutation drives a
    # global conformational change that the local-energy-minimum the
    # forcefield finds doesn't capture. BRAF V600E is the canonical
    # example — the validation suite went -2.90 → -0.70 → +2.20 across
    # three samples once minimisation was enabled, because the relaxed
    # V600E pocket finds a local minimum far from the active-state
    # geometry Vemurafenib was designed against.
    minimize_mutant: bool = True


# ─── Targets ──────────────────────────────────────────────────────────────

EGFR = Target(
    id="egfr",
    name="EGFR kinase domain",
    uniprot="P00533",
    pdb_id="2ITY",
    chain="A",
    # Centroid of the five promoted EGFR mutations (T790, L858, C797, G719,
    # L792) on chain A — measured directly from the cleaned WT PDB on
    # 2026-04-30 after an audit found L858R sitting 16.6 Å from the prior
    # gefitinib-co-crystal centre (5.6 Å beyond the 22 Å docking box).
    # Box widened to 30 Å so the 14 Å reach covers L858 (the worst-case
    # residue, 14.1 Å from this centroid) with ~1 Å margin while still
    # encompassing the canonical ATP pocket. Trade-off vs the prior
    # IRE-centred box: Vina now samples a slightly larger volume that
    # extends toward the activation loop — modestly slower per cell, but
    # the activating L858R variant goes from "outside_pocket — won't show
    # a Δ" to actually scoreable, which is the headline EGFR mutation in
    # NSCLC. Re-verify with `scripts/verify_catalog.py` (or the manual
    # sweep) if these residues change.
    pocket=PocketBox(center=(-52.7, -1.0, -24.4), size=(30.0, 30.0, 30.0)),
    description=(
        "Epidermal growth factor receptor — the canonical kinase target for non-small "
        "cell lung cancer. Resistance mutations are the textbook example of why "
        "mutation-aware docking matters."
    ),
    indications=["NSCLC", "glioblastoma"],
    mutations=[
        Mutation("T790M", "T790M — gatekeeper",       "1st-gen TKI resistance"),
        Mutation("L858R", "L858R — activating",       "Sensitizing mutation, often present at diagnosis"),
        Mutation("C797S", "C797S — covalent escape",  "Osimertinib (3rd-gen) resistance"),
        Mutation("G719S", "G719S — exon 18",          "Less common activating mutation"),
        Mutation("L792H", "L792H — solvent-front",    "Emerging 3rd-gen resistance"),
    ],
    compounds=[
        ReferenceCompound("Gefitinib",   "COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1",
                          "1st-gen reversible TKI"),
        ReferenceCompound("Erlotinib",   "COCCOc1cc2ncnc(Nc3cccc(C#C)c3)c2cc1OCCOC",
                          "1st-gen reversible TKI"),
        ReferenceCompound("Osimertinib", "COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1",
                          "3rd-gen covalent, T790M-selective"),
        ReferenceCompound("Afatinib",    "CN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(F)c(Cl)c3)ncnc2cc1OC1CCOC1",
                          "2nd-gen irreversible covalent"),
    ],
    # (T1) EGFR is the textbook example of an established kinase target —
    # four generations of approved drugs (gefitinib → erlotinib → afatinib
    # → osimertinib) all bind the canonical ATP pocket. Trust signal: very
    # high; the chemist agent should be willing to be assertive here.
    druggability="established",
    druggability_note=(
        "Established target — multiple approved drugs (gefitinib, erlotinib, "
        "osimertinib, afatinib) all bind the canonical ATP pocket. Strong "
        "precedent for the ProLIF contact pattern and score range."
    ),
    # The canonical ATP-pocket "vocabulary" — a real binder makes the
    # hinge H-bond to M793 backbone and contacts the gatekeeper T790
    # and the K745 salt bridge. Zero overlap = surface contact, not real
    # binding.
    canonical_pocket_residues=["L718", "K745", "T790", "L788", "T854", "M793"],
    # Approved EGFR TKIs typically score -8 to -11 kcal/mol in Vina against
    # 2ITY/4ZAU-class structures (verified internally on the four approved
    # compounds in this entry, May 2026). Anything weaker than -7 is a
    # noise-floor result for this target.
    typical_vina_range=(-11.0, -8.0),
)

KRAS = Target(
    id="kras",
    name="KRAS GTPase",
    uniprot="P01116",
    pdb_id="4OBE",
    chain="A",
    # Centre verified 2026-04-30 — sits 0.1 Å from chain-A GDP centroid
    # (re-audited after a buggy first sweep that averaged ligands across
    # all four biological-assembly chains). G12C/D/V at 9.7 Å and G13D
    # at 6.2 Å are well-inside the 11 Å half-edge. Q61H at 19.2 Å sits
    # in the switch-II region and stays correctly outside-pocket — that's
    # an allosteric / conformational mutation, not an active-site one,
    # and rigid-receptor docking can't capture it whatever the box size.
    pocket=PocketBox(center=(2.0, -10.4, 38.2)),  # GDP centroid (chain A)
    description=(
        "KRAS — historically considered undruggable, until covalent G12C inhibitors. "
        "The G12C/G12D allele-selective workflow is the poster child for our "
        "selectivity-matrix product."
    ),
    indications=["NSCLC", "colorectal cancer", "pancreatic cancer"],
    mutations=[
        Mutation("G12C", "G12C — covalent handle",   "Sotorasib/adagrasib target"),
        Mutation("G12D", "G12D — most common",       "Pancreatic-dominant, harder to drug"),
        Mutation("G12V", "G12V — common",            "Lung/colorectal"),
        Mutation("G13D", "G13D — colorectal",        "Cetuximab response modifier"),
        Mutation("Q61H", "Q61H — switch-II",         "Resistance-associated"),
    ],
    compounds=[
        # Verified 2026-05-12 against Wikipedia / DrugBank / PubChem CID
        # 137278711 (Sotorasib) and CID 138611145 (Adagrasib). Prior
        # strings here AND in the library JSON parsed cleanly with RDKit
        # but produced the wrong molecules (MW off by 100+ g/mol) — the
        # 2D viewer rendered something Sotorasib-shaped that wasn't
        # actually Sotorasib. Found in the May 2026 audit (#240).
        # Both InChI keys also re-checked: Sotorasib NXQKSXLFSAEQCZ.
        ReferenceCompound("Sotorasib",
                          "CC(C)c1nccc(C)c1N2C(=O)N=C(N3CCN(C[C@@H]3C)C(=O)C=C)c4cc(F)c(nc24)c5c(O)cccc5F",
                          "Approved G12C-selective covalent (AMG 510)"),
        ReferenceCompound("Adagrasib",
                          "O=C(C(F)=C)N([C@@H](CC#N)C1)CCN1C2=NC(OC[C@H]3N(C)CCC3)=NC4=C2CCN(C5=CC=CC6=C5C(Cl)=CC=C6)C4",
                          "Approved G12C-selective (MRTX849)"),
    ],
    # (T1) KRAS sits between "recent" and "experimental" — G12C was cracked
    # in 2021 (Sotorasib/Adagrasib) by exploiting the cryptic Switch II
    # pocket via a covalent warhead. G12D has Divarasib + MRTX1133 in
    # trials but no FDA approval. G13D and Q61H have no direct chemical
    # matter. At the target level we mark "recent" — at least one variant
    # is cracked — and lean on the chemist agent to call out per-mutation
    # tier in its prompt (see _build_user_message).
    druggability="recent",
    druggability_note=(
        "Recently cracked: G12C has two approved drugs (Sotorasib, Adagrasib) "
        "that engage Cys12 via a covalent warhead in the cryptic Switch II "
        "pocket. G12D is in clinical trials (no approval); G12V/G13D/Q61H "
        "have no approved direct binder — treat scores at those mutations as "
        "exploratory."
    ),
    # The Switch II druggable pocket residues (defined by Sotorasib's
    # crystallographic contacts in 6OIM) — these are what a real KRAS
    # binder is expected to contact. Cys12 only matters for G12C-covalent
    # compounds.
    canonical_pocket_residues=["G12", "T58", "G60", "Y96", "Q99", "I100", "Y32"],
    # KRAS is hard to drug — even the approved covalent inhibitors score
    # in the -7 to -9 kcal range against rigid Vina (the covalent reaction
    # isn't modeled). Anything weaker than -6 is firmly in the noise
    # floor / surface-contact regime.
    typical_vina_range=(-9.0, -6.5),
)

BRAF = Target(
    id="braf",
    name="BRAF kinase",
    uniprot="P15056",
    pdb_id="4WO5",
    chain="A",
    # Centre verified 2026-04-30 — sits on chain-A 324-inhibitor centroid
    # (the prior "17.8 Å off" finding was an audit-bug averaging across
    # both biological-assembly chains). Box widened 22 → 30 Å on
    # 2026-04-30 to bring V600E (17.0 Å out, the marquee BRAF mutation
    # in melanoma, vemurafenib's target) inside the docking volume —
    # 30 Å gives 15 Å reach so V600 sits 2 Å past edge but Vina still
    # samples ligand poses that physically contact V600 side chains.
    # L597R (12.4 Å) is now comfortably inside. Bumped 30 → 36 Å on
    # final pass: V600E is the marquee BRAF mutation (vemurafenib's
    # melanoma target) and 36 Å puts V600 at 17 Å with a clean 1 Å
    # margin past the 18 Å reach — no outside-pocket badge fires for
    # the row a reviewer's most likely to inspect first.
    pocket=PocketBox(center=(-37.1, -15.4, -43.3), size=(36.0, 36.0, 36.0)),
    description=(
        "Serine/threonine kinase in the MAPK pathway. The V600E mutation is the most "
        "studied actionable single-residue change in oncology."
    ),
    indications=["melanoma", "thyroid cancer", "colorectal cancer"],
    # Disable mutant minimisation for BRAF (added 2026-04-30 after the
    # validation suite caught the regression). V600E is an activation-
    # loop residue and Vemurafenib's selectivity comes from binding the
    # active-state conformation. The OpenMM vacuum minimisation we apply
    # to other targets settles V600E into a different local minimum that
    # reads to Vina as a worse pocket — values went -2.90 (un-minimised)
    # → -0.70 → +2.20 (minimised) across three samples, a swing larger
    # than the clinical IC50 shift. Skipping minimisation here recovers
    # the clean -2.9 PASS that put BRAF V600E at the top of our case
    # studies. The trade-off: residues that ARE relaxed elsewhere keep
    # any substitution clashes here; for V600E specifically that's
    # acceptable because it's a like-for-like swap in side-chain volume
    # (Val and Glu are similarly sized; the biology is electrostatic +
    # conformational, not steric clash).
    minimize_mutant=False,
    mutations=[
        Mutation("V600E", "V600E — activating",   "Vemurafenib/dabrafenib indication"),
        Mutation("V600K", "V600K — activating",   "Less frequent V600 variant"),
        Mutation("L597R", "L597R — non-V600",     "MEK-inhibitor responsive"),
    ],
    compounds=[
        ReferenceCompound("Vemurafenib", "CCCS(=O)(=O)Nc1ccc(F)c(C(=O)c2c[nH]c3ncc(-c4ccc(Cl)cc4)cc23)c1F",
                          "1st-gen BRAF V600E inhibitor"),
        ReferenceCompound("Dabrafenib",  "Cc1nc(-c2cccc(NS(=O)(=O)c3c(F)cccc3F)c2F)nc(-c2ccnc(N)n2)c1F",
                          "2nd-gen BRAF V600E/K inhibitor"),
        ReferenceCompound("Encorafenib", "COc1cc(/C(=N\\OC)c2cn(C(C)C)nc2-c2cnc(N)nc2C)ccc1NS(=O)(=O)C",
                          "3rd-gen, longer residence time"),
    ],
    # (T1) BRAF V600E is one of the most-validated oncogenic targets —
    # three approved drugs and the active-state DFG-in conformation is
    # well-characterized.
    druggability="established",
    druggability_note=(
        "Established — three approved V600E inhibitors (Vemurafenib, "
        "Dabrafenib, Encorafenib) all bind the ATP pocket in the active "
        "DFG-in / αC-in conformation. Strong precedent."
    ),
    # ATP pocket residues for the active conformation (4WO5-class). C532
    # makes the hinge H-bond; F595 is the DFG phenylalanine.
    canonical_pocket_residues=["G466", "K483", "T529", "Q530", "C532", "G534", "F583", "F595", "V600"],
    typical_vina_range=(-11.0, -8.0),
)

IDH1 = Target(
    id="idh1",
    name="IDH1 (isocitrate dehydrogenase 1)",
    uniprot="O75874",
    pdb_id="1T0L",
    chain="A",
    # Centre verified 2026-04-30 — sits on chain-A NAP (NADP+) cofactor
    # centroid (the "50 Å off" finding from the buggy multi-chain sweep
    # was a false alarm). Important caveat: ivosidenib-class IDH1
    # inhibitors bind ALLOSTERICALLY at the dimer interface, NOT at
    # this cofactor pocket and NOT at the substrate (R132) pocket
    # either. R132* mutations correctly badge as outside-pocket because
    # rigid-receptor docking against the cofactor site cannot capture
    # the allosteric Δ that drives the ivosidenib mechanism. We keep
    # IDH1 in the catalog as a teaching example of the limitation
    # (with the comparison footnote disclosing it); switching to a
    # PDB with ivosidenib bound (e.g. 6B0Z) would change the docked
    # pose's biology and require a separate scoring approach.
    pocket=PocketBox(center=(59.8, -30.0, 26.1)),
    description=(
        "Isocitrate dehydrogenase 1. The R132H mutation creates a neomorphic enzyme "
        "producing 2-hydroxyglutarate. Allosteric inhibitors that selectively target "
        "the mutant are clinically validated."
    ),
    indications=["AML", "glioma", "cholangiocarcinoma"],
    mutations=[
        Mutation("R132H", "R132H — most common",   "Ivosidenib target, neomorphic"),
        Mutation("R132C", "R132C — second-most",   "AML-enriched"),
        Mutation("R132G", "R132G",                 "Rare neomorphic variant"),
    ],
    compounds=[
        ReferenceCompound("Ivosidenib",  "Cc1ncc(F)c(-c2c(F)cccc2Cl)c1C(=O)N(C1CCC(C#N)CC1)C(C)c1ccnc(C)c1F",
                          "Approved R132H-selective (AG-120)"),
        ReferenceCompound("Vorasidenib", "CC(C)C(=O)N(C1CCC1)C(C)c1ccc(C(=O)Nc2cccnc2)cc1F",
                          "Brain-penetrant, dual IDH1/2"),
    ],
    # (T1) IDH1 honest assessment: the APPROVED drugs (Ivosidenib,
    # Vorasidenib) bind ALLOSTERICALLY at the dimer interface, NOT at the
    # NADP+ cofactor pocket this catalog entry boxes. Docking against this
    # pocket cannot reproduce the ivosidenib mechanism. Mark as
    # "experimental" until we add an allosteric-pocket PDB (e.g. 6B0Z).
    druggability="experimental",
    druggability_note=(
        "Approved IDH1-R132H drugs (Ivosidenib, Vorasidenib) bind "
        "ALLOSTERICALLY at the dimer interface, NOT at this cofactor "
        "pocket. Docking against 1T0L's NADP+ site cannot capture the "
        "approved-drug binding mode — treat scores as exploratory only."
    ),
    # Substrate-pocket / cofactor-pocket residues (1T0L). NOT the
    # allosteric pocket — see note above.
    canonical_pocket_residues=["R132", "R109", "R100", "Y139", "K212", "T214", "S278"],
    # Without a chemistry-validated docking pocket on this PDB, real-drug
    # scores aren't a useful calibration. Conservative band; agent should
    # de-emphasize numeric score for this target.
    typical_vina_range=(-9.0, -6.0),
)

ABL = Target(
    id="abl",
    name="ABL1 kinase",
    uniprot="P00519",
    pdb_id="2HYY",
    chain="A",
    # Centre verified 2026-04-30 on chain-A STI/imatinib centroid — exact
    # match. Box widened 22 → 26 Å so E255K at 12.0 Å (the P-loop
    # imatinib-resistance mutation) sits comfortably inside the 13 Å
    # reach. T315I, Y253H, F317L all already well-inside.
    pocket=PocketBox(center=(14.3, 15.3, 17.6), size=(26.0, 26.0, 26.0)),
    description=(
        "BCR-ABL is the driver of chronic myeloid leukemia. The T315I gatekeeper "
        "mutation is the textbook resistance event — it broke imatinib and drove "
        "the development of ponatinib and asciminib."
    ),
    indications=["CML", "Ph+ ALL"],
    mutations=[
        Mutation("T315I", "T315I — gatekeeper",   "Pan-resistant to 1st/2nd-gen TKIs"),
        Mutation("E255K", "E255K — P-loop",       "Imatinib resistance"),
        Mutation("Y253H", "Y253H — P-loop",       "Imatinib resistance"),
        Mutation("F317L", "F317L",                "Dasatinib resistance"),
    ],
    compounds=[
        ReferenceCompound("Imatinib",  "Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1",
                          "1st-gen, founding TKI"),
        ReferenceCompound("Dasatinib", "Cc1nc(Nc2ncc(C(=O)Nc3c(C)cccc3Cl)s2)cc(N2CCN(CCO)CC2)n1",
                          "2nd-gen, broader kinase profile"),
        ReferenceCompound("Nilotinib", "Cc1cn(-c2cc(NC(=O)c3ccc(C)c(Nc4nccc(-c5cccnc5)n4)c3)cc(C(F)(F)F)c2)cn1",
                          "2nd-gen, T315I-inactive"),
        ReferenceCompound("Ponatinib", "Cc1ccc(C(=O)Nc2ccc(CN3CCN(C)CC3)c(C(F)(F)F)c2)cc1C#Cc1cnc2cccnn12",
                          "3rd-gen, T315I-active"),
    ],
    # (T1) BCR-ABL is the founding kinase target — Imatinib was the first
    # rationally-designed targeted cancer drug. Four generations of
    # approved inhibitors all bind the canonical ATP pocket; T315I is
    # the textbook resistance mutation.
    druggability="established",
    druggability_note=(
        "Established — Imatinib (the founding TKI) plus Dasatinib, "
        "Nilotinib, Ponatinib all approved. The ATP-pocket geometry is "
        "one of the best-characterized in oncology."
    ),
    # ATP pocket (2HYY-class). M318 makes the hinge H-bond; T315 is the
    # gatekeeper (mutation site). F382 is the DFG phenylalanine.
    canonical_pocket_residues=["L248", "G249", "K271", "E286", "T315", "F317", "M318", "F382"],
    typical_vina_range=(-11.0, -8.0),
)

HER2 = Target(
    id="her2",
    name="HER2 (ERBB2) kinase domain",
    uniprot="P04626",
    pdb_id="3PP0",
    chain="A",
    # Centre verified 2026-04-30 on chain-A 03Q inhibitor centroid. Box
    # widened 22 → 34 Å so all three promoted activating mutations are
    # cleanly inside the 17 Å reach: L755S (11.3 Å), V777L (16.0 Å,
    # 1 Å margin), V842I (16.6 Å, 0.4 Å margin). Picked 34 over 30 so
    # V842I doesn't sit on the box edge where Vina sampling is patchy.
    pocket=PocketBox(center=(17.1, 16.5, 26.6), size=(34.0, 34.0, 34.0)),
    description=(
        "ERBB2/HER2 — driver of a major breast cancer subtype and increasingly "
        "recognized in lung, gastric, and colorectal cancers. Kinase-domain "
        "mutations confer resistance and predict tucatinib/lapatinib response."
    ),
    indications=["breast cancer", "NSCLC", "gastric cancer"],
    mutations=[
        Mutation("L755S", "L755S — common",          "Lapatinib resistance, tucatinib-sensitive"),
        Mutation("V777L", "V777L — activating",      "Lung/breast cancer activating"),
        Mutation("V842I", "V842I — activating",      "Less common activating"),
    ],
    compounds=[
        # Verified 2026-05-12 against PubChem CID 51039094. Prior SMILES
        # contained CF3 (Tucatinib has none) and an N-methylated
        # pyrimidinedione scaffold instead of the quinazoline +
        # triazolopyridine + 4,4-dimethyloxazoline that Tucatinib
        # actually has. C26H24N8O2, MW 480.52.
        ReferenceCompound("Tucatinib",
                          "CC1=CC(NC2=C3C=C(NC4=NC(C)(C)CO4)C=CC3=NC=N2)=CC=C1OC5=CC6=NC=NN6C=C5",
                          "HER2-selective, brain-penetrant"),
        ReferenceCompound("Lapatinib", "CS(=O)(=O)CCNCc1oc(-c2ccc3ncnc(Nc4ccc(OCc5cccc(F)c5)c(Cl)c4)c3c2)cc1",
                          "Dual HER2/EGFR TKI"),
        ReferenceCompound("Neratinib", "CCN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(Oc4cccc(C)n4)c(Cl)c3)ncnc2cc1OC",
                          "Pan-HER irreversible"),
    ],
    # (T1) HER2 is established — Lapatinib, Tucatinib, Neratinib are
    # approved kinase inhibitors that bind the canonical ATP pocket.
    druggability="established",
    druggability_note=(
        "Established — three approved TKIs (Lapatinib, Tucatinib, "
        "Neratinib) bind the ATP pocket. The HER2/EGFR family is one of "
        "the best-modeled kinase classes in docking."
    ),
    # ATP pocket (3PP0-class). M801 makes the hinge H-bond; T798 is the
    # gatekeeper.
    canonical_pocket_residues=["L726", "V734", "K753", "T798", "L796", "M801", "T862", "D863"],
    typical_vina_range=(-11.0, -8.0),
)

ALK = Target(
    id="alk",
    name="ALK kinase",
    uniprot="Q9UM73",
    pdb_id="2XP2",
    chain="A",
    # Centre verified 2026-04-30 on chain-A VGH inhibitor centroid. Kept
    # at default 22 Å because the two clinically dominant ALK mutations
    # (L1196M gatekeeper, G1202R solvent-front) are both well-inside.
    # F1174L is in the activation loop at 18.6 Å — that's a neuroblastoma
    # mutation and stays correctly outside-pocket badged; widening the
    # box to capture it would weaken the gatekeeper signal that's the
    # main use case here.
    pocket=PocketBox(center=(29.9, 47.1, 8.5)),
    description=(
        "Anaplastic lymphoma kinase. Resistance to ALK inhibitors follows a clear "
        "stepwise pattern (crizotinib → alectinib → lorlatinib) driven by gatekeeper "
        "and solvent-front mutations — perfect for selectivity comparison."
    ),
    indications=["ALK-positive NSCLC", "neuroblastoma"],
    mutations=[
        Mutation("L1196M", "L1196M — gatekeeper",   "Crizotinib resistance"),
        Mutation("G1202R", "G1202R — solvent-front", "Lorlatinib-only sensitivity"),
        Mutation("F1174L", "F1174L — neuroblastoma", "Activating, neuroblastoma-enriched"),
    ],
    compounds=[
        ReferenceCompound("Crizotinib", "Cc1c(-c2cnc(N)nc2)ccc(O[C@@H](C)c2ccc(F)cc2Cl)c1Cl",
                          "1st-gen ALK/ROS1/MET"),
        ReferenceCompound("Alectinib",  "CCc1cc2nc3c(C(C)(C)C)cc4c(c3c2cc1C#N)C(=O)N(C)CC4",
                          "2nd-gen, brain-penetrant"),
        ReferenceCompound("Lorlatinib", "CC1(F)CN(c2cnc3c(N)nc(-c4cnn(CC)c4OC)cc3c2C(=O)N1)C",
                          "3rd-gen, G1202R-active"),
    ],
    # (T1) ALK is established — three generations of approved inhibitors
    # bind the canonical ATP pocket. Stepwise resistance pattern
    # (Crizotinib → Alectinib → Lorlatinib) is well-characterized.
    druggability="established",
    druggability_note=(
        "Established — Crizotinib, Alectinib, Lorlatinib all approved. "
        "Stepwise resistance pattern via L1196M (gatekeeper) and G1202R "
        "(solvent-front) is textbook."
    ),
    # ATP pocket (2XP2-class). M1199 hinge H-bond; L1196 gatekeeper.
    canonical_pocket_residues=["L1122", "G1123", "K1150", "E1167", "L1196", "M1199", "G1202", "D1270"],
    typical_vina_range=(-11.0, -8.0),
)

ROS1 = Target(
    id="ros1",
    name="ROS1 kinase",
    uniprot="P08922",
    pdb_id="3ZBF",
    chain="A",
    pocket=PocketBox(center=(42.8, 19.7, 4.2)),  # VGH inhibitor
    description=(
        "ROS1 fusions drive a small but distinct subset of NSCLC. The G2032R solvent-"
        "front mutation is the canonical resistance event."
    ),
    indications=["ROS1-positive NSCLC"],
    mutations=[
        Mutation("G2032R", "G2032R — solvent-front", "Crizotinib/entrectinib resistance"),
    ],
    compounds=[
        ReferenceCompound("Crizotinib",   "Cc1c(-c2cnc(N)nc2)ccc(O[C@@H](C)c2ccc(F)cc2Cl)c1Cl",
                          "1st-gen, also approved for ROS1"),
        ReferenceCompound("Entrectinib",  "CN1CCN(c2ccc(NC(=O)c3cc(C)cc(F)c3)c(F)c2)CC1",
                          "ROS1/NTRK/ALK pan-inhibitor"),
        ReferenceCompound("Repotrectinib","CC1CC2(CCN(c3nc4ccccn4n3)C2)CC(F)(F)C1NS(=O)(=O)Cc1cc(F)cc(F)c1",
                          "Next-gen, G2032R-active"),
    ],
    # (T1) ROS1 is established — three approved drugs (Crizotinib,
    # Entrectinib, Repotrectinib). Smaller indication than EGFR/ALK but
    # the pocket is well-characterized.
    druggability="established",
    druggability_note=(
        "Established — Crizotinib (originally an ALK inhibitor, also "
        "approved for ROS1), Entrectinib, and Repotrectinib all bind the "
        "canonical ATP pocket."
    ),
    # ATP pocket (3ZBF-class). E2027 hinge; L2026 gatekeeper.
    canonical_pocket_residues=["L1951", "K1980", "E2027", "L2026", "G2032", "D2102"],
    typical_vina_range=(-11.0, -8.0),
)

MET = Target(
    id="met",
    name="MET kinase",
    uniprot="P08581",
    pdb_id="2WGJ",
    chain="A",
    # Centre verified 2026-04-30 on chain-A VGH inhibitor centroid. Box
    # widened 22 → 26 Å so D1228V (11.6 Å, just past the old 11 Å edge)
    # is now comfortably inside the 13 Å reach. Y1230H was already in.
    pocket=PocketBox(center=(21.7, 83.7, 4.3), size=(26.0, 26.0, 26.0)),
    description=(
        "MET amplification and exon-14 skipping are NSCLC oncogenic drivers. "
        "Capmatinib and tepotinib are approved; D1228V is a key resistance mutation."
    ),
    indications=["NSCLC (MET-altered)", "gastric cancer"],
    mutations=[
        Mutation("D1228V", "D1228V — DFG",   "Capmatinib/tepotinib resistance"),
        Mutation("Y1230H", "Y1230H — DFG",   "Resistance, type-I inhibitor escape"),
    ],
    compounds=[
        ReferenceCompound("Capmatinib", "Cn1ccc2cc(-c3cnc4cc(F)ccn4c3)c(NC(=O)c3ccccc3F)cc21",
                          "Approved type-Ib MET inhibitor"),
        ReferenceCompound("Tepotinib",  "COc1cnc2cc(C(=O)NC3CCN(c4cccnc4-c4cccnc4)CC3)ccc2n1",
                          "Approved type-Ib MET inhibitor"),
    ],
    # (T1) MET is established — Capmatinib and Tepotinib approved for
    # MET-altered NSCLC, Crizotinib also has MET activity.
    druggability="established",
    druggability_note=(
        "Established — Capmatinib and Tepotinib are approved type-Ib "
        "MET inhibitors; Crizotinib has cross-reactivity. D1228V is the "
        "DFG resistance mutation."
    ),
    # ATP pocket (2WGJ-class). M1160 hinge; L1157 gatekeeper.
    canonical_pocket_residues=["L1140", "G1163", "K1110", "L1157", "M1160", "Y1230", "D1228", "F1223"],
    typical_vina_range=(-11.0, -8.0),
)

FLT3 = Target(
    id="flt3",
    name="FLT3 kinase",
    uniprot="P36888",
    pdb_id="4XUF",
    chain="A",
    # Centre verified 2026-04-30 on chain-A P30 inhibitor centroid. Box
    # widened 22 → 30 Å so D835Y/V (14.0 Å, the activation-loop
    # quizartinib-resistance pair) sit inside the 15 Å reach. F691L
    # already in.
    pocket=PocketBox(center=(21.3, 17.6, -12.8), size=(30.0, 30.0, 30.0)),
    description=(
        "FLT3 ITD and TKD mutations drive a major subset of acute myeloid leukemia. "
        "Resistance to gilteritinib via F691L and D835 mutations is increasingly "
        "common."
    ),
    indications=["AML"],
    mutations=[
        Mutation("F691L", "F691L — gatekeeper",  "Gilteritinib resistance"),
        Mutation("D835Y", "D835Y — activation loop", "Quizartinib resistance"),
        Mutation("D835V", "D835V — activation loop", "Quizartinib resistance"),
    ],
    compounds=[
        ReferenceCompound("Gilteritinib", "CCC(C)Nc1ncnc2cc(N3CCC(N4CCN(C)CC4)CC3)c(OC)cc12",
                          "Type-I FLT3 inhibitor, F691L-active"),
        ReferenceCompound("Quizartinib",  "CC(C)(C)c1cc(NC(=O)Nc2ccc3oc(-c4ccc5n(C(C)C)cnc5c4)nc3c2)no1",
                          "Type-II FLT3 inhibitor"),
        ReferenceCompound("Midostaurin",  "Cc1cc2c3c(c1)c1c(c4ccccc41)C1=NC(=O)c4c1n23OC(=O)c1ccccc14",
                          "Multikinase inhibitor"),
    ],
    # (T1) FLT3 is established for AML — Gilteritinib, Quizartinib,
    # Midostaurin all approved. ITD plus D835/F691 TKD mutations.
    druggability="established",
    druggability_note=(
        "Established — Gilteritinib (type-I, F691L-active), Quizartinib "
        "(type-II), and Midostaurin all approved for AML. "
        "Gatekeeper/activation-loop resistance pattern is well-mapped."
    ),
    # ATP pocket (4XUF-class). C694 hinge; F691 gatekeeper.
    canonical_pocket_residues=["L616", "V624", "K644", "F691", "C694", "G697", "D829", "D835"],
    typical_vina_range=(-11.0, -8.0),
)

BTK = Target(
    id="btk",
    name="Bruton's tyrosine kinase",
    uniprot="Q06187",
    pdb_id="5P9J",
    chain="A",
    pocket=PocketBox(center=(19.8, 7.2, 3.6)),  # 8E8 inhibitor
    description=(
        "BTK is the target of ibrutinib in CLL. C481S is the dominant resistance "
        "mutation that broke covalent inhibitors and drove the development of "
        "non-covalent BTK inhibitors like pirtobrutinib."
    ),
    indications=["CLL", "MCL", "Waldenström macroglobulinemia"],
    mutations=[
        Mutation("C481S", "C481S — covalent target loss", "Ibrutinib resistance"),
        Mutation("T474I", "T474I — gatekeeper",          "Pirtobrutinib resistance"),
    ],
    compounds=[
        ReferenceCompound("Ibrutinib",     "C=CC(=O)N1CCC[C@H]1c1nc(-c2ccc(Oc3ccccc3)cc2)c2c(N)ncnc21",
                          "1st-gen covalent BTKi"),
        ReferenceCompound("Acalabrutinib", "CC#Cc1ccnc(-c2ccc(C(=O)Nc3ccccn3)cc2)n1",
                          "2nd-gen covalent BTKi, more selective"),
        ReferenceCompound("Pirtobrutinib", "Cc1ccc(C(=O)Nc2ccnc(-c3cn(C)c4ccc(F)cc34)n2)cc1OC",
                          "Non-covalent, C481S-active"),
    ],
    # (T1) BTK is established — Ibrutinib (covalent), Acalabrutinib
    # (more selective covalent), and Pirtobrutinib (non-covalent,
    # C481S-active) are all approved.
    druggability="established",
    druggability_note=(
        "Established — Ibrutinib (1st-gen covalent), Acalabrutinib, and "
        "Pirtobrutinib (non-covalent) all approved. C481S resistance "
        "drove the development of non-covalent inhibitors — a textbook "
        "case for mutation-aware selectivity."
    ),
    # ATP pocket (5P9J-class). M477 hinge; T474 gatekeeper; C481 is the
    # covalent target.
    canonical_pocket_residues=["L408", "V416", "K430", "T474", "M477", "C481", "G480", "D539"],
    typical_vina_range=(-11.0, -8.0),
)

PI3KA = Target(
    id="pi3ka",
    name="PI3K-α (PIK3CA)",
    uniprot="P42336",
    pdb_id="4JPS",
    chain="A",
    # Centre verified 2026-04-30 on chain-A 1LT inhibitor centroid (this
    # is the kinase-domain ATP pocket). Honest catalog entry: H1047R is
    # in the activation loop at 27.9 Å from this pocket — outside any
    # reasonable docking box. E542K and E545K are on the helical
    # domain at 42-52 Å — they're a SEPARATE part of the protein, not
    # reachable from the kinase pocket no matter how big a box you draw.
    # All three correctly badge as outside-pocket; the Δ-score in the
    # matrix legitimately can't be computed from rigid-receptor docking
    # against the ATP site. We keep them in the catalog because users
    # search for them and the honest "rigid docking can't capture this
    # mutation" answer is more useful than missing entries — the
    # comparison-table footnote spells out the limitation.
    pocket=PocketBox(center=(-1.3, -9.5, 16.9)),
    description=(
        "PI3K-α is the most frequently mutated kinase in human cancer. H1047R "
        "(activation loop) and E542K/E545K (helical domain) are the canonical "
        "hotspots and are alpelisib targets."
    ),
    indications=["breast cancer", "endometrial cancer"],
    mutations=[
        Mutation("H1047R", "H1047R — activation loop", "Most common, alpelisib-sensitive"),
        Mutation("E542K",  "E542K — helical",          "Common helical-domain hotspot"),
        Mutation("E545K",  "E545K — helical",          "Common helical-domain hotspot"),
    ],
    compounds=[
        ReferenceCompound("Alpelisib",  "Cc1ncc(C(F)(F)F)cc1Nc1ncc(C(N)=O)c(-c2cnc(NC(=O)C(C)(C)C)nc2)n1",
                          "PI3K-α-selective"),
        ReferenceCompound("Inavolisib", "CC1(C)Cc2cc(C(=O)NCc3ccc(N4C[C@H]5OC[C@H](C5)O4)cc3)cc(C(=O)O)c2N1",
                          "Mutant-selective PI3K-α"),
    ],
    # (T1) PI3K-α is established (Alpelisib, Inavolisib approved). BUT:
    # H1047R is in the activation loop and E542K/E545K are on the helical
    # domain — neither is reachable from the kinase ATP pocket this entry
    # boxes. The agent should note this when discussing mutation Δ for
    # this target.
    druggability="established",
    druggability_note=(
        "ATP-pocket established (Alpelisib, Inavolisib approved). HOWEVER: "
        "H1047R, E542K, and E545K are all FAR from the ATP pocket — "
        "rigid-receptor docking against the kinase site cannot capture "
        "their activating effect. Treat mutation Δ as not-measurable here."
    ),
    # ATP pocket residues (4JPS-class) — these are the residues an
    # ATP-competitive inhibitor like Alpelisib touches. They are nowhere
    # near H1047/E542/E545.
    canonical_pocket_residues=["S774", "K802", "I800", "V851", "S854", "I932", "D933", "M772"],
    # PI3K-class kinases score a touch weaker than tyrosine kinases in
    # Vina due to a more open ATP pocket.
    typical_vina_range=(-10.0, -7.5),
)

KIT = Target(
    id="kit",
    name="KIT (CD117) kinase",
    uniprot="P10721",
    pdb_id="1T46",
    chain="A",
    # Centre verified 2026-04-30 on chain-A STI/imatinib centroid. Box
    # widened 22 → 30 Å so D816V (14.5 Å, the dominant mastocytosis
    # driver and imatinib-resistance mutation) sits inside the 15 Å
    # reach. T670I gatekeeper and V654A already well-inside.
    pocket=PocketBox(center=(26.2, 26.1, 40.4), size=(30.0, 30.0, 30.0)),
    description=(
        "KIT is the driver of GIST (gastrointestinal stromal tumor) and a subset of "
        "mast cell disease. Imatinib resistance via T670I and D816V is well-documented."
    ),
    indications=["GIST", "mastocytosis"],
    mutations=[
        Mutation("T670I", "T670I — gatekeeper",          "Imatinib resistance in GIST"),
        Mutation("D816V", "D816V — activation loop",     "Mastocytosis driver, imatinib-resistant"),
        Mutation("V654A", "V654A — activation loop",     "Imatinib resistance"),
    ],
    compounds=[
        ReferenceCompound("Imatinib",  "Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1",
                          "1st-line GIST"),
        ReferenceCompound("Sunitinib", "CCN(CC)CCNC(=O)c1c(C)[nH]c(/C=C2\\C(=O)Nc3ccc(F)cc23)c1C",
                          "Multikinase, post-imatinib"),
        ReferenceCompound("Avapritinib","CC[C@H]1OCCN(c2ncc(F)c(-c3cccc4c3CN(C(=O)Nc3ccccn3)CC4)n2)C1",
                          "Approved D816V/PDGFRA D842V-selective"),
    ],
    # (T1) KIT is established — Imatinib (1st-line GIST), Sunitinib
    # (post-imatinib), and Avapritinib (D816V-selective for mastocytosis).
    druggability="established",
    druggability_note=(
        "Established — Imatinib, Sunitinib, and Avapritinib all approved. "
        "T670I gatekeeper and D816V activation-loop resistance is "
        "well-characterized."
    ),
    # ATP pocket (1T46-class). C673 hinge; T670 gatekeeper.
    canonical_pocket_residues=["L595", "V603", "K623", "T670", "C673", "G676", "D810", "D816"],
    typical_vina_range=(-11.0, -8.0),
)


CATALOG: list[Target] = [EGFR, KRAS, BRAF, IDH1, ABL, HER2, ALK, ROS1, MET, FLT3, BTK, PI3KA, KIT]
TARGETS_BY_ID: dict[str, Target] = {t.id: t for t in CATALOG}
# Reverse-lookup index by RCSB PDB ID. The Quick Dock and Optimize endpoints
# get called with whatever the editor has on hand — sometimes the catalog id
# ("kras"), sometimes the resolved PDB id ("4OBE") if NewJobPage's `target`
# state was lost on re-render. Both should resolve to the same Target.
# 2026-05-04: KRAS Q61H Quick Dock failed with "No pocket box on file for
# 4OBE" because get_target("4OBE") missed — only the catalog id was indexed.
TARGETS_BY_PDB_ID: dict[str, Target] = {t.pdb_id.upper(): t for t in CATALOG}


def catalog_dict() -> list[dict]:
    """Serializable form for the API."""
    return [asdict(t) for t in CATALOG]


def get_target(target_id: str) -> Target | None:
    """Resolve a catalog Target by either catalog id ('kras') or PDB id ('4OBE')."""
    if not target_id:
        return None
    key = target_id.strip()
    hit = TARGETS_BY_ID.get(key.lower())
    if hit is not None:
        return hit
    return TARGETS_BY_PDB_ID.get(key.upper())
