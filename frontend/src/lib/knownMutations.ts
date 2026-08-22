/**
 * Phase 2 auto-mutations — well-established clinical / drug-resistance
 * mutations for high-value oncology targets that are NOT in the curated
 * 13, keyed by canonical UniProt accession.
 *
 * Used by StudioPage's ad-hoc-target enrichment: when a user searches up
 * a structure of one of these genes, its mutation picker auto-populates
 * like the built-in catalog targets, instead of falling back to UniProt's
 * (usually empty) somatic-variant list.
 *
 * Numbering is canonical UniProt. A given PDB structure may renumber, so
 * a chip only docks if the residue exists at that position in the chosen
 * structure — the backend validates buildability on submit and surfaces a
 * clear message when it can't build one.
 *
 * Curated conservatively: only mutations with well-established clinical
 * or functional significance are listed, to avoid surfacing chips a
 * scientist would mistrust.
 */
export type KnownMut = { code: string; label: string; significance: string };

export const KNOWN_MUTATIONS_BY_UNIPROT: Record<string, KnownMut[]> = {
  // ESR1 — estrogen receptor alpha (breast cancer, endocrine resistance)
  P03372: [
    { code: "Y537S", label: "Y537S — ligand-independent activation", significance: "Aromatase-inhibitor resistance; most common ESR1 hotspot" },
    { code: "Y537N", label: "Y537N — ligand-independent activation", significance: "Endocrine resistance" },
    { code: "D538G", label: "D538G — helix-12 stabilization", significance: "Aromatase-inhibitor resistance; common" },
    { code: "E380Q", label: "E380Q — constitutive activity", significance: "Endocrine resistance" },
    { code: "L536R", label: "L536R — activating", significance: "Endocrine resistance" },
  ],
  // AR — androgen receptor (prostate cancer, antiandrogen resistance)
  P10275: [
    { code: "T878A", label: "T878A — broadened ligand specificity", significance: "Flutamide / enzalutamide resistance (a.k.a. T877A)" },
    { code: "F877L", label: "F877L — antagonist-to-agonist switch", significance: "Enzalutamide / apalutamide resistance" },
    { code: "L702H", label: "L702H — glucocorticoid activation", significance: "Abiraterone / prednisone resistance" },
    { code: "H875Y", label: "H875Y — promiscuous activation", significance: "Castration-resistant prostate cancer (a.k.a. H874Y)" },
    { code: "W742C", label: "W742C — antagonist resistance", significance: "Bicalutamide resistance" },
  ],
  // JAK2 — myeloproliferative neoplasms
  O60674: [
    { code: "V617F", label: "V617F — constitutive kinase activity", significance: "Polycythemia vera / MPN driver" },
  ],
  // RET — medullary thyroid / RET-fusion cancers, resistance
  P07949: [
    { code: "M918T", label: "M918T — activating", significance: "MEN2B / sporadic MTC" },
    { code: "V804M", label: "V804M — gatekeeper", significance: "Selpercatinib / pralsetinib resistance" },
    { code: "V804L", label: "V804L — gatekeeper", significance: "Multikinase-inhibitor resistance" },
    { code: "G810R", label: "G810R — solvent front", significance: "Selpercatinib resistance" },
  ],
  // FGFR2 — cholangiocarcinoma, resistance
  P21802: [
    { code: "N549K", label: "N549K — molecular brake", significance: "Activating; pemigatinib resistance" },
    { code: "K659E", label: "K659E — activation loop", significance: "Activating" },
    { code: "V564F", label: "V564F — gatekeeper", significance: "FGFR-inhibitor resistance" },
  ],
  // FGFR3 — bladder cancer / multiple myeloma
  P22607: [
    { code: "R248C", label: "R248C — extracellular activating", significance: "Bladder cancer" },
    { code: "S249C", label: "S249C — extracellular activating", significance: "Bladder cancer; most common FGFR3" },
    { code: "Y373C", label: "Y373C — transmembrane activating", significance: "Bladder cancer" },
    { code: "K650E", label: "K650E — kinase activating", significance: "Cancer / skeletal dysplasia" },
  ],
  // IDH2 — AML (neomorphic 2-HG production)
  P48735: [
    { code: "R140Q", label: "R140Q — neomorphic (2-HG)", significance: "AML; enasidenib target" },
    { code: "R172K", label: "R172K — neomorphic (2-HG)", significance: "AML" },
  ],
  // NRAS — melanoma / other
  P01111: [
    { code: "G12D", label: "G12D — GTPase-dead", significance: "Activating" },
    { code: "Q61K", label: "Q61K — GTPase-dead", significance: "Melanoma; most common NRAS" },
    { code: "Q61R", label: "Q61R — GTPase-dead", significance: "Melanoma" },
  ],
  // AKT1
  P31749: [
    { code: "E17K", label: "E17K — PH-domain membrane recruitment", significance: "Breast / other; AKT-inhibitor context" },
  ],
  // SMO — basal cell carcinoma (Hedgehog pathway), resistance
  Q99835: [
    { code: "W535L", label: "W535L — constitutive activation", significance: "Vismodegib resistance" },
    { code: "D473H", label: "D473H — drug-binding pocket", significance: "Vismodegib resistance" },
  ],
  // NTRK1 / TRKA — TRK-fusion cancers, resistance
  P04629: [
    { code: "G595R", label: "G595R — solvent front", significance: "Larotrectinib / entrectinib resistance" },
    { code: "G667C", label: "G667C — xDFG", significance: "TRK-inhibitor resistance" },
  ],
};
