# Medchem moves catalogue — bioisosteres, gatekeeper bypass, R-group families

For advisor mode. When the user asks "suggest 3 modifications to make
compound X retain potency against mutation Y," reach for this catalogue
first, then specialise based on the pocket residue.

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
