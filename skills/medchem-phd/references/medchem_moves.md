# Medchem moves catalogue — bioisosteres, gatekeeper bypass, R-group families

For advisor mode. When the user asks "suggest 3 modifications to make
compound X retain potency against mutation Y," reach for this catalogue
first, then specialise based on the pocket residue.

## Top-level taxonomy

Every modification falls into one of three umbrella strategies (drawn
from Nadendla & Yemineni 2023, BJSTR; consistent with Strømgaard
*et al.* 2017, Drug Design & Discovery, Ch. 3):

1. **Disjunction** — break or simplify the parent scaffold. Un-join
   bonds, replace aromatic rings with saturated equivalents, shrink the
   hydrocarbon skeleton. Counterintuitive but powerful: removing rings
   sometimes *increases* potency (the oestradiol → trans-diethyl-
   stilbestrol example, where successive ring elimination reached
   maximal estrogenic activity).
2. **Conjunction** — join molecules. Three flavours:
   - **Addition** — attach a new group (improve solubility, alter
     metabolism, add a missing contact). E.g., loperamide + lipophilic
     group → enhanced µ-opioid affinity.
   - **Replication / scaffold hopping** — preserve the pharmacophore
     with a different chemical skeleton. Useful when synthesis is hard
     or IP is constrained.
   - **Hybridization** — covalently fuse two pharmacophores (direct,
     merged, or linker-mediated). E.g., streptoniazid (streptomycin +
     isoniazid) for tuberculosis.
3. **Special approaches** (10 specific tactics, see "Special-approaches
   catalogue" section below).

Use this taxonomy as a starting menu when asked for "diverse"
modifications. A diverse 3-suggestion list ideally spans all three
umbrella strategies, not three variants of the same disjunction.

## Bioisosteric replacements

A bioisostere is a substructure swap that keeps biology roughly intact
while changing one specific property (logP, metabolic stability, pKa,
H-bond pattern). These are the cheapest med chem moves — usually 1-2
synthetic steps and no SAR redesign.

### Carboxylic acid bioisosteres

| Original | Replacement | What changes |
|----------|-------------|--------------|
| -COOH | tetrazole | logP slightly ↑, metabolic stability ↑, similar pKa, H-bond pattern preserved |
| -COOH | acyl sulfonamide | similar pKa, smaller polar surface |
| -COOH | hydroxamic acid | metal coordination ↑, can be a chelator (often unwanted) |
| -COOH | 1,2,4-oxadiazol-3(2H)-one | acid character preserved, lipophilicity ↑ |

### Carbonyl / amide bioisosteres

| Original | Replacement | What changes |
|----------|-------------|--------------|
| amide | 1,2,4-oxadiazole | Removes amide H-bond donor; metabolically stable |
| amide | 1,3,4-oxadiazole | Same; different geometry |
| ester | amide | Hydrolytic stability ↑↑ |
| ketone | reduced sulfide | Aromatic-bridge stiffening |

### Phenyl bioisosteres

| Original | Replacement | What changes |
|----------|-------------|--------------|
| phenyl | thiophene | logP slightly ↓, metabolic stability ↑ |
| phenyl | pyridine | logP ↓, basic centre, H-bond acceptor |
| phenyl | bicyclo[1.1.1]pentane | fully sp3 phenyl mimic; logP ↓, geometry preserved |
| phenyl | 2-pyrazole | adds H-bond donor; smaller |

### Hydrogen bioisosteres

| Original | Replacement | What changes |
|----------|-------------|--------------|
| -H | -F | metabolic block at that position, minimal steric |
| -H | -OH | adds H-bond donor + acceptor |
| -CH3 | -CF3 | lipophilic but more electron-withdrawing; metabolic block |

## Gatekeeper-bypass strategies

When the gatekeeper residue (T315, T790, L1196 etc) clashes with the
inhibitor, three families of solutions:

### Family A: Linear linker bypass

Replace a bulky middle linker with a linear (alkyne, sp1) spacer that
threads past the gatekeeper bulk. **Canonical example:** Ponatinib
replaced Imatinib's amide-piperazine linker with an ethynyl spacer to
survive ABL T315I.

**Trade-off:** synthesis is harder; selectivity profile changes (off-
target kinases get hit); ADMET changes.

### Family B: Type II / DFG-out switch

Move from a Type I (active-state, ATP-cleft) inhibitor to a Type II
(inactive-state, deeper back pocket) inhibitor. Type II inhibitors
extend past the gatekeeper into the αC-helix-out subpocket, where the
gatekeeper clash matters less.

**Examples:** Imatinib (Type II) survives some BCR-ABL mutations that
take out Type I drugs; Sorafenib's diaryl urea is the canonical Type II
warhead.

**Trade-off:** Type II only works on kinases that have a stable
inactive conformation; most don't.

### Family C: Type III (allosteric) inhibitors

Bind a pocket adjacent to the ATP cleft without crossing it. The
gatekeeper is irrelevant. **Examples:** Trametinib (MEK allosteric);
Asciminib (ABL allosteric — designed specifically to avoid the
gatekeeper region).

**Trade-off:** Allosteric pockets are hard to find and even harder to
prove; programs often spend years on this.

## Activation-loop selectivity strategies

For mutations that stabilise the active conformation (V600E, D816V,
some L858R contexts):

### Strategy A: Active-state-selective binders

Design directly for the active-state conformation. Vemurafenib is the
canonical example for BRAF V600E — it has a propylsulfonamide tail
that fits a hydrophobic pocket only present in the V600E active state.
Avapritinib does the same for KIT D816V.

### Strategy B: Hydrophobic gain-of-function exploitation

V→E or D→V substitutions create hydrophobic gain-of-function patches.
Methyl, ethyl, or fluoro at meta/para positions of the inhibitor's
adjacent aryl ring fills the new space. **General principle**, not a
specific drug.

## Covalent-target replacement

For C481S, C797S resistance:

### Strategy A: Drop the warhead, go non-covalent

If the non-covalent component of the original inhibitor is reasonably
strong (≤ 100 nM Kd), removing the acrylamide warhead and relying on
non-covalent binding can survive C→S resistance. **Example:**
Pirtobrutinib (BTK) is the non-covalent escape design for
post-Ibrutinib C481S CLL.

### Strategy B: Reversible covalent (cyanoacrylamide)

Use a warhead that forms a reversible covalent bond. Slower off-rate
than non-covalent but recoverable; doesn't fail the same way as a
permanent covalent on a S vs C mismatch. Active research area.

### Strategy C: Different cysteine target

Some kinases have multiple cysteines in the binding region. Re-target
to a different cysteine that the resistance mutation doesn't affect.
Highly target-specific.

## R-group exploration heuristics

When asked for "diverse" suggestions, prefer moves that change different
properties:

1. **One H-bond donor/acceptor swap** (e.g., add a pyridine N or remove
   an amide H)
2. **One lipophilicity adjustment** (e.g., methyl→trifluoromethyl, or
   the reverse)
3. **One geometric/conformational change** (ring extension, ring
   contraction, or saturation)

This gives the user three lines of attack along orthogonal axes,
rather than three variations of the same move. Diversity > magnitude
for early-discovery exploration.

## When NOT to suggest a modification

Some asks should be redirected, not answered:

- **"Make this hit Kd < 1 nM."** Vina can't predict absolute affinity;
  you can suggest moves likely to *increase* binding but can't promise
  a Kd value.
- **"Optimise this for oral bioavailability."** ADMET prediction is a
  different domain (Lipinski / Veber are filters, not predictors).
  Recommend a separate ADMET tool.
- **"Make this selective vs all kinases."** Kinome-wide selectivity
  needs panel screening, not docking. Suggest the user run a
  selectivity panel.

In these cases, the right output is "this is outside what rigid
docking can answer; here's what would" rather than a fabricated
medchem move.

## Special-approaches catalogue (Nadendla & Yemineni 2023)

Ten specific tactics under the "Special approaches" umbrella. Each
one is a small, well-scoped modification with predictable trade-offs.
Useful when the user has a tight chemical lead and wants a focused
SAR exploration plan.

| Tactic | Effect | Worked example | Caveat |
|--------|---------|-----------------|---------|
| **Ring closure** (intramolecular cyclization) | Constrains conformation, locks bioactive geometry, ↓ entropy penalty | Geranyl diphosphate → taxane scaffold (paclitaxel) | ↑ synth complexity; rigid form must match active conformation |
| **Ring opening** | Improves metabolic tractability, alters solubility, can generate reactive intermediates | Carbamazepine → 10,11-epoxide via CYP3A4 | Loss of conformational restraint; check for new metabolic liabilities |
| **Lower-homolog formation** (chain shortening) | ↓ MW, ↓ logP, ↑ solubility, often ↓ potency per mass | Naproxen → ibuprofen direction | May lose key contacts at the modified position |
| **Higher-homolog formation** (chain extension) | ↑ potency, ↑ logP, can pick up new pocket contacts | Statin series: pravastatin → atorvastatin → rosuvastatin | ↑ off-target binding risk; often hurts solubility |
| **Introduction of a double bond** | Rigidifies, alters electronics + metabolism, affects pharmacokinetics | Diosgenin → progesterone (selective oxidation) | Costs synthetic steps; rigid geometry may not match pocket |
| **Introduction of a chiral centre** (resolve to a single enantiomer) | Improves selectivity at target, drops enantiomer-specific toxicity | Racemic salbutamol → (R)-salbutamol — (S)- causes adverse effects | Manufacturing complexity ↑; not all "inactive" enantiomers are inert |
| **Removal of bulky groups** | ↓ steric hindrance, ↓ off-target binding, ↑ solubility | Smaller analogs of bulky kinase scaffolds | May drop affinity if the bulky group made favourable hydrophobic contact |
| **Replacement of bulky groups with polar equivalents** | ↑ water solubility, ↑ renal clearance, ↓ nonspecific binding | Aliphatic chain → ethylene-glycol chain | May reduce target affinity if hydrophobic contact was essential |
| **Bioisosteric ring equivalents** (lactam → cyclic urea, phenyl → pyridine) | Preserves pharmacophore, alters polarity / metabolic stability / pKa | Phenyl → pyridine in zolpidem; lactam → cyclic urea in montelukast | Geometry preserved but electronic properties shift; re-test binding |
| **Introduction of an alkylating moiety** | Enables covalent target engagement (cancer warheads) | Mustine, cyclophosphamide phosphoramide mustards | High systemic toxicity, off-target reactivity |
| **Electronic-state modification** (EWG / EDG) | Tunes pKa, polarity, redox potential, modulates binding & metabolism | Warfarin EWG aromatic system; morphine EDG hydroxyl | Can backfire — EDG can ↑ autoxidation, EWG can ↑ metabolic instability |

## Lead-optimisation principles (Strømgaard *et al.* 2017, Ch. 3-5)

These are the rules a working medicinal chemist applies when going
from hit → lead → candidate. Useful when the user has a series of
compounds and wants to know what to vary first.

1. **Remove low-occupancy groups first.** A substituent that contacts
   solvent rather than the pocket is a free improvement target —
   replacing it with H rarely hurts and often improves logP and ADME.
2. **Rigidification > flexibility, when the rigid form matches the
   bioactive conformation.** Conformationally restricted molecules pay
   a lower entropy penalty on binding. The amprenavir example
   (Strømgaard Ch. 3, p. 35) quantifies this at ~105 kJ/mol of
   entropy saving via rigidification.
3. **Hydrophobic pockets are hot targets.** Filling a hydrophobic
   pocket with a lipophilic group yields disproportionate affinity
   gain (van der Waals + desolvation entropy), but watch for off-
   target binding and ADMET liabilities (CYP induction, low
   solubility).
4. **Hydrogen bonds to backbone atoms are mutation-resistant.** H-bonds
   to side chains are sensitive to kinase mutations; backbone
   interactions (amide NH, carbonyl O) are conserved across most
   missense mutations. **Favour backbone contacts in multi-mutant
   designs.** This is the structural reason gatekeeper-bypass
   compounds like Ponatinib still bind well to multiple ABL mutants.
5. **Fluorine for metabolic blocks.** The C–F bond is very strong; F
   substitution at sites of expected CYP attack reliably extends
   half-life. Effects are subtle and position-dependent; test
   case-by-case rather than blanket-fluorinating.
6. **Test bioisosteric swaps as a diagnostic tool.** Swap a suspected
   H-bond donor for an isostere that cannot donate (e.g., amide →
   oxazole). If activity drops, the H-bond is real. If activity is
   unchanged, the donor wasn't load-bearing — you can drop it for
   free.
7. **Solubility & bioavailability are hidden costs.** A tight binder
   that doesn't get absorbed is worthless. Strømgaard Ch. 3, p. 47:
   "low activity may not mean bad binding" — check oral
   bioavailability before blaming the compound.
8. **Multi-parameter optimisation is mandatory.** You cannot maximise
   affinity, lipophilicity, solubility, and metabolic stability
   simultaneously. Compromise rationally based on the target class:
   kinase inhibitors tolerate higher lipophilicity (cLogP up to ~5)
   than GPCRs.

## Worked drug-evolution examples worth citing in audits

When the user asks "is this kind of move ever known to work?", reach
for one of these as a precedent:

- **Imatinib → Ponatinib (T315I bypass)** — Replaced amide-piperazine
  linker with ethynyl spacer to thread past the gatekeeper Ile.
  Reference: O'Hare et al., *Cancer Cell* 2009.
- **Imatinib → Asciminib (allosteric, T315I-insensitive)** — Designed
  to bind ABL's myristoyl pocket outside the ATP cleft, bypassing
  every gatekeeper mutation by definition. Reference: Wylie et al.,
  *Nature* 2017.
- **Gefitinib/Erlotinib → Osimertinib (T790M retention + C797
  covalent target)** — Acrylamide warhead anchors covalently to
  C797 while compact scaffold accommodates the T790M Met bulk.
  Reference: Cross et al., *Cancer Discov* 2014.
- **Vemurafenib (V600E selectivity)** — Propylsulfonamide tail fits a
  hydrophobic pocket only present in BRAF V600E's αC-helix-in active
  state. Reference: Bollag et al., *Nature* 2010.
- **Imatinib → Avapritinib (KIT D816V, active-state selective)** —
  Engineered for the D816V-stabilised active conformation Imatinib
  cannot bind. Reference: Evans et al., *Sci Transl Med* 2017.
- **Ibrutinib → Pirtobrutinib (BTK C481S non-covalent escape)** —
  Dropped the acrylamide warhead in favour of high-affinity
  non-covalent binding; survives C481S because no covalent anchor
  is lost. Reference: Mato et al., *NEJM* 2021.
- **Successive ring-elimination in oestradiol → trans-diethyl-
  stilbestrol** — Demonstrates that biological activity often does
  not require the full parent scaffold (Nadendla & Yemineni 2023,
  Section 3.1).
- **Penicillin → amoxicillin** — Side-chain modification improves
  oral absorption + spectrum (broader gram-negative coverage)
  without losing the β-lactam pharmacophore. Classical conjunction-
  by-addition example.

Cite the canonical drug → modification → outcome rather than
inventing precedents. If an analogue is being suggested without a
literature anchor, label it explicitly as "general medchem
principle, no specific precedent" — that's more credible than a
fabricated citation (the v1 baseline got bitten by inventing an
afatinib precedent for ABL T315I bypass; afatinib is an EGFR
covalent inhibitor and unrelated).
