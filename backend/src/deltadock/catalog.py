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


# ─── Targets ──────────────────────────────────────────────────────────────

EGFR = Target(
    id="egfr",
    name="EGFR kinase domain",
    uniprot="P00533",
    pdb_id="2ITY",
    chain="A",
    pocket=PocketBox(center=(-50.5, -0.7, -21.6)),  # gefitinib (IRE) co-crystal
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
)

KRAS = Target(
    id="kras",
    name="KRAS GTPase",
    uniprot="P01116",
    pdb_id="4OBE",
    chain="A",
    pocket=PocketBox(center=(2.0, -10.4, 38.2)),  # GDP centroid — corrected 2026-04-28 (was 14.3 Å off, partial pocket overlap only)
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
        ReferenceCompound("Sotorasib",   "Cc1ncc(F)c(-c2c(Cl)cccc2O)c1C(=O)N1CCN(C(=O)C=C)CC1c2nc(C(C)C)cn2C",
                          "Approved G12C-selective covalent (AMG 510)"),
        ReferenceCompound("Adagrasib",   "Cc1cnc2c(c1Cl)c(O)c(C)c(C)c2C(=O)N1CCN(C(=O)C=C)CC1Cn1cc(F)cn1",
                          "Approved G12C-selective (MRTX849)"),
    ],
)

BRAF = Target(
    id="braf",
    name="BRAF kinase",
    uniprot="P15056",
    pdb_id="4WO5",
    chain="A",
    pocket=PocketBox(center=(-37.1, -15.4, -43.3)),  # 324 inhibitor co-crystal — corrected 2026-04-28 (was 17.8 Å off)
    description=(
        "Serine/threonine kinase in the MAPK pathway. The V600E mutation is the most "
        "studied actionable single-residue change in oncology."
    ),
    indications=["melanoma", "thyroid cancer", "colorectal cancer"],
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
)

IDH1 = Target(
    id="idh1",
    name="IDH1 (isocitrate dehydrogenase 1)",
    uniprot="O75874",
    pdb_id="1T0L",
    chain="A",
    pocket=PocketBox(center=(59.8, -30.0, 26.1)),  # NAP (NADP+) cofactor centroid — corrected 2026-04-28 (was 50.2 Å off — completely wrong, docking into empty space)
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
)

ABL = Target(
    id="abl",
    name="ABL1 kinase",
    uniprot="P00519",
    pdb_id="2HYY",
    chain="A",
    pocket=PocketBox(center=(14.3, 15.3, 17.6)),  # imatinib (STI) co-crystal centroid — corrected 2026-04-28 (was 34.1 Å off — Imatinib was docking into empty space, blew our positive control)
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
)

HER2 = Target(
    id="her2",
    name="HER2 (ERBB2) kinase domain",
    uniprot="P04626",
    pdb_id="3PP0",
    chain="A",
    pocket=PocketBox(center=(17.1, 16.5, 26.6)),  # 03Q inhibitor centroid — corrected 2026-04-28 (was 25.2 Å off)
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
        ReferenceCompound("Tucatinib", "Cn1c(=O)c2[nH]nc(-c3ccc4c(c3)oc(=O)n4-c3ccc(NCc4cccc(C(F)(F)F)c4)cc3)c2n(C)c1=O",
                          "HER2-selective, brain-penetrant"),
        ReferenceCompound("Lapatinib", "CS(=O)(=O)CCNCc1oc(-c2ccc3ncnc(Nc4ccc(OCc5cccc(F)c5)c(Cl)c4)c3c2)cc1",
                          "Dual HER2/EGFR TKI"),
        ReferenceCompound("Neratinib", "CCN(C)C/C=C/C(=O)Nc1cc2c(Nc3ccc(Oc4cccc(C)n4)c(Cl)c3)ncnc2cc1OC",
                          "Pan-HER irreversible"),
    ],
)

ALK = Target(
    id="alk",
    name="ALK kinase",
    uniprot="Q9UM73",
    pdb_id="2XP2",
    chain="A",
    pocket=PocketBox(center=(29.9, 47.1, 8.5)),  # VGH inhibitor
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
)

MET = Target(
    id="met",
    name="MET kinase",
    uniprot="P08581",
    pdb_id="2WGJ",
    chain="A",
    pocket=PocketBox(center=(21.7, 83.7, 4.3)),  # VGH inhibitor
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
)

FLT3 = Target(
    id="flt3",
    name="FLT3 kinase",
    uniprot="P36888",
    pdb_id="4XUF",
    chain="A",
    pocket=PocketBox(center=(21.3, 17.6, -12.8)),  # P30 inhibitor centroid — corrected 2026-04-28 (was 34.2 Å off — D835V activation loop also lives in this region now)
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
)

PI3KA = Target(
    id="pi3ka",
    name="PI3K-α (PIK3CA)",
    uniprot="P42336",
    pdb_id="4JPS",
    chain="A",
    pocket=PocketBox(center=(-1.3, -9.5, 16.9)),  # 1LT inhibitor
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
)

KIT = Target(
    id="kit",
    name="KIT (CD117) kinase",
    uniprot="P10721",
    pdb_id="1T46",
    chain="A",
    pocket=PocketBox(center=(26.2, 26.1, 40.4)),  # imatinib (STI) co-crystal
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
)


CATALOG: list[Target] = [EGFR, KRAS, BRAF, IDH1, ABL, HER2, ALK, ROS1, MET, FLT3, BTK, PI3KA, KIT]
TARGETS_BY_ID: dict[str, Target] = {t.id: t for t in CATALOG}


def catalog_dict() -> list[dict]:
    """Serializable form for the API."""
    return [asdict(t) for t in CATALOG]


def get_target(target_id: str) -> Target | None:
    return TARGETS_BY_ID.get(target_id.lower())
