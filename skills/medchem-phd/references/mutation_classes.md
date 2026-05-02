# Mutation classes — what rigid docking can and can't model

Every clinically-actionable resistance / selectivity mutation falls into
one of four classes. The class determines whether rigid-receptor Vina /
GNINA can give a meaningful Δ. Knowing the class up front prevents
wasting time on a case the method fundamentally can't resolve.

## Class 1 — Gatekeeper-residue substitution

**Mechanism:** A bulky residue at the gatekeeper position blocks the
ligand's path into the back pocket of the ATP-binding cleft. The
classical case for rigid docking — single-residue steric clash that
Vina was designed to capture.

**Examples:**
- **ABL T315I** (Imatinib resistance, CML) — Thr→Ile loses an H-bond
  donor AND introduces a γ-carbon clash with Imatinib's
  methyl-piperazine. Reference: O'Hare et al., *Nat Rev Cancer* 2007.
- **EGFR T790M** (Gefitinib/Erlotinib resistance, NSCLC) — Thr→Met
  bulk fills space near the ATP cleft. Reference: Pao et al., *PLoS
  Med* 2005.
- **ALK L1196M** (Crizotinib resistance) — Leu→Met fills the back
  pocket. Reference: Choi et al., *NEJM* 2010.

**What rigid docking captures:** The steric clash itself. WT-vs-mutant
Δ should be positive (resistance direction) and above the noise floor.
PASS verdicts here are reliable.

**What rigid docking misses:** Subtle conformational selection
(does T315I shift the αC helix? Mostly no, but sometimes yes for
certain inhibitor classes). For Type II inhibitors that bind the
DFG-out state, gatekeeper effects can be modulated by the conformational
ensemble that rigid docking ignores.

**Design strategy that survives:** Linear linkers that bypass the
gatekeeper region. Ponatinib's ethynyl spacer is the canonical
example (Ponatinib survives T315I because the triple bond avoids
the Ile clash).

## Class 2 — Activation-loop substitution

**Mechanism:** Substitution at a residue that controls the activation
state of the kinase (DFG-in / DFG-out, αC-helix-in / αC-helix-out).
The mutation usually shifts the equilibrium toward the active
conformation, which changes which inhibitor classes bind.

**Examples:**
- **BRAF V600E** (melanoma) — Val→Glu stabilises the active αC-helix-in
  state, creating a hydrophobic gain-of-function pocket. Reference:
  Davies et al., *Nature* 2002. Vemurafenib was designed around this:
  Bollag et al., *Nature* 2010.
- **KIT D816V** (mastocytosis) — Asp→Val stabilises the active
  conformation; Imatinib (DFG-out binder) loses, Avapritinib (active
  state binder) was designed for it. Reference: Heinrich et al.,
  *J Clin Oncol* 2003 (Imatinib loss); Evans et al., *Sci Transl Med*
  2017 (Avapritinib).
- **EGFR L858R** (NSCLC) — Leu→Arg adds positive charge at the
  activation loop; gain-of-function activator. Reference: Pao et al.,
  2005.

**What rigid docking captures:** Effect on inhibitors when the
receptor PDB is already in the relevant conformation. If the catalog
PDB is an active-state crystal, docking against a V600E or D816V
substitution gives meaningful Δ.

**What rigid docking misses:** Induced-fit transitions. If your
receptor is in DFG-out and the mutation shifts the equilibrium to
DFG-in, rigid docking sees only the static pre-shift conformation.
Active-state-selective drugs (Avapritinib for KIT D816V, Vemurafenib
for BRAF V600E in some PDBs) are sensitive to this.

**Worked complication:** BRAF V600E + Vemurafenib has been observed
to give a noisy Δ in the Liganx validation suite (PASS at −2.7 in v4,
NOISE 0.0 after a cache-flush rebuild in v6). The literature direction
(~3-fold cellular IC50 shift) is well-established, but our specific
4WO5 receptor + Vina + non-induced-fit prep sits at the noise boundary.
This is a documented method limit, not a pipeline regression.

## Class 3 — Covalent target substitution

**Mechanism:** A covalent inhibitor anchors via a specific cysteine
(typically through an acrylamide warhead). When the cysteine becomes
serine (C→S), the warhead can't form the bond and the inhibitor loses
clinically.

**Examples:**
- **BTK C481S** (Ibrutinib resistance, CLL) — Cys→Ser ablates the
  covalent target. Reference: Woyach et al., *NEJM* 2014.
- **EGFR C797S** (Osimertinib resistance, NSCLC) — Cys→Ser ablates
  Osimertinib's acrylamide target. Reference: Thress et al., *Nat Med*
  2015.
- **KRAS G12C** (NSCLC, colorectal) — the covalent *target* (not a
  resistance mutation). Glu→Cys creates a unique cysteine that
  Sotorasib and Adagrasib target. Reference: Canon et al., *Nature*
  2019.

**What rigid docking captures:** The geometric C→S effect — Ser is
slightly smaller than Cys, so the pocket reshapes minimally. The
*non-covalent* component of inhibitor binding is computable. For
Ibrutinib + C481S, the residual non-covalent ΔΔG is small (~+1.5
kcal/mol) and matches the geometric shrink.

**What rigid docking misses:** The covalent bond itself. Vina is
non-covalent. The clinical IC50 shift for Ibrutinib + C481S is
>100×, but the non-covalent ΔΔG is only ~1.5 kcal/mol — most of
the clinical effect comes from losing the covalent anchor, which
Vina can't model.

**Pirtobrutinib** (non-covalent BTK inhibitor) is the contrast case:
no acrylamide warhead, so C481S doesn't disrupt its binding mode.
Δ between WT and C481S for Pirtobrutinib should be small (within
±1.0 kcal/mol noise floor) — PASS in the retention sense.

## Class 4 — Allosteric / distant / switch-region

**Mechanism:** A mutation that affects ligand binding through long-range
conformational coupling, switch-region dynamics, or allosteric pocket
changes. The mutation isn't *in* the docking box.

**Examples:**
- **PI3Kα H1047R** — hotspot at the C-terminal helical domain;
  effects propagate through allosteric coupling to the kinase domain.
  Reference: Samuels et al., *Science* 2004.
- **Various** — most "switch-region" mutations in small GTPases
  (e.g., KRAS G12D, where the residue is in switch I).

**What rigid docking captures:** Almost nothing — the mutation isn't
in the pocket and the conformational coupling isn't modeled by a
rigid receptor.

**What to do:** Mark these as "out-of-scope" for rigid docking
*before* running them. The Liganx catalog has ~8 mutations flagged
this way; they're documented as method limits, not pipeline failures.

## Multi-mutation clusters

Some clinical resistance arises from coupled multi-mutation patterns
that don't appear in isolation:

- **MET D1228V + Y1230H/C** — appears as a cluster in MET inhibitor
  resistance; isolated D1228V is rare. When the user sees a single
  member of the cluster, mention the cluster context.
- **EGFR T790M + C797S** — second-line resistance after Osimertinib
  (which targets T790M); the C797S then takes out Osimertinib too.

When a user asks about a single mutation in a cluster, mention the
cluster context — design strategies often need to handle the whole
cluster, not the individual mutation.

## How to use this in reviewer mode

When asked to audit a mutation hint, classify the mutation first:

1. Which class (gatekeeper / activation-loop / covalent / allosteric)?
2. Does the hint correctly describe the dominant biophysical effect?
   (Tyr→His is a charge change, not aromatic stacking. Cys→Ser is a
   covalent-anchor loss, not a pocket-volume change.)
3. Does the design suggestion match the class? (Bypass the gatekeeper
   for class 1; use active-state ligand for class 2; go non-covalent
   for class 3; out-of-scope for class 4.)

A hint that gets the class right but the mechanism wrong is worse
than no hint at all — it steers AI compound suggestions in the wrong
direction.
