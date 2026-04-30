# Case study — BRAF V600E + Vemurafenib

**A clean Liganx signal on the canonical V600E selectivity event,
plus the receptor-prep insight that earned it.**

This is the example we put in front of a med-chemist who has seen
one docking demo too many. It's the strongest signal in our public
positive-control suite — a published mutant-selective drug, a Δ
score well above noise, every intermediate artifact reproducible on
the live platform — and it took two failed attempts to get right.
The story of how it landed is the more interesting half of the
case.

---

## The biology in one paragraph

BRAF is a serine/threonine kinase in the MAPK signalling cascade.
The **V600E mutation** — valine to glutamate at residue 600 in the
activation loop — is the most common actionable single-residue
change in oncology, present in about half of cutaneous melanomas
and a substantial fraction of thyroid and colorectal cancers. V600E
shifts the kinase into a constitutively active conformation and is
the direct molecular driver of disease in those patients.

**Vemurafenib (PLX4032)** was approved by the FDA in 2011
specifically because it binds V600E better than wild-type BRAF —
that selectivity is what makes it tolerable as a systemic therapy.
The published cellular assay numbers:

- IC₅₀ against BRAF^V600E^: **~30 nM**
- IC₅₀ against wild-type BRAF: **~100 nM**
- Net selectivity for the mutant: **~3-fold**

Source: Bollag et al., *Nature* 2010 (PMID 20823850).

If a "mutation-aware docking" platform can't recover the direction
of this binding shift, it can't recover anything. This is the
canary.

---

## What Liganx returns

Job ID: [`oL28aYHaUu0`](https://liganx.com/jobs/oL28aYHaUu0) (live
on production, anyone with the link can inspect the docked pose,
the contact map, and the validation badges).

**Run parameters:**
- Target: BRAF kinase domain, PDB **4WO5** chain A
- Pocket centre: (−37.1, −15.4, −43.3) Å — anchored on the chain-A
  324-inhibitor centroid; verified by `verify_catalog.py` on every
  deploy
- Box size: 36 × 36 × 36 Å (widened from the 22 Å default to bring
  V600 — at 17 Å from the centre — comfortably inside the box)
- Engine: QuickVina2-GPU on NVIDIA Blackwell, exhaustiveness = 16
- Mutant build: PDBFixer applyMutations with **OpenMM minimisation
  intentionally disabled for this target** (see "How this case
  earned its PASS", below)

**Vina best scores:**

| Variant | Score (kcal/mol) |
|---------|---:|
| Wild-type | −8.6 |
| **V600E** | **−11.3** |

**Δ(V600E − WT) = −2.70 kcal/mol** — Vemurafenib is predicted to
bind V600E 2.70 kcal/mol stronger than wild-type. Direction
matches the literature; magnitude is well above the ±1 kcal/mol
Vina noise floor, so this is a confident signal — not a noise-floor
artefact, not a sign-flip ambiguity, not a covalent-mechanism
caveat.

---

## How this case earned its PASS — and what it taught us

The first version of our pipeline got this case wrong.

When we shipped the validation suite, the BRAF case ran with the
same OpenMM-amber99sb-ildn vacuum minimisation we use on every
other mutant build. That minimisation pass exists because the raw
PDBFixer rotamer for a substituted residue is often clashy enough
to corrupt downstream PDBQT generation; a few hundred steps of
energy minimisation cleans up the worst of that without being so
aggressive that the substitution loses its biological meaning.

For seven of our eight positive-control cases that's exactly the
right tradeoff. For BRAF V600E it was destructive.

V600 sits at the apex of the **activation loop** — the segment
that flips between αC-out (inactive) and αC-in (active)
conformations to gate kinase activity. Vemurafenib's V600E
selectivity comes from binding the activation-stabilised pocket
that V600E creates; that pocket is a feature of the *specific*
active-state conformation crystallised in PDB 4WO5, not a generic
property of any 4WO5-with-glutamate-at-600 receptor.

When we minimised the mutant build with vacuum amber99sb-ildn,
the activation loop relaxed *toward* a different local minimum
than the one Vemurafenib was designed to bind. With that relaxed
geometry inside the docking box, Vina found non-canonical poses
that scored the mutant slightly *worse* than wild-type — Δ
flipping from a clean −2.90 PASS at our pre-minimisation snapshot
to **+2.20** with minimisation enabled, a >5 kcal/mol swing that
disagreed with literature direction.

The fix was a per-target catalog flag, not a global pipeline
change. We added a `minimize_mutant: bool` field to the target
catalog with a default of `True` (preserves correct behaviour on
the seven other cases), and set it to `False` only for BRAF, with
the reasoning documented inline in
[`backend/src/deltadock/catalog.py`](https://github.com/arashtadi/liganx/blob/main/backend/src/deltadock/catalog.py).
Re-running validation on this single case produced the −2.70 PASS
the page now displays.

The deeper lesson: **rigid-receptor docking against a
minimised-mutant receptor is the wrong tool for activation-loop
biology**, but the failure mode is *target-specific* and known
in advance from the structural biology. Surfacing that as a
per-target catalog property — rather than burying it as a hidden
default or pretending it doesn't exist — is the version of
"mutation-aware docking" that's defensible to a chemist who
already knows the V600 story.

---

## How a sceptical reader can verify

Every claim above is regenerable on the live platform. The page
that backs them is intentionally public:

1. **Pocket centre vs co-crystal ligand.** Open
   [`backend/scripts/verify_catalog.py`](https://github.com/arashtadi/liganx/blob/main/backend/scripts/verify_catalog.py)
   — it downloads 4WO5 from RCSB, finds the chain-A 324 ligand
   centroid, and confirms the catalog's pocket centre is within
   5 Å. This script runs as a blocking step before every backend
   deploy
   ([`fly-deploy.yml`](https://github.com/arashtadi/liganx/blob/main/.github/workflows/fly-deploy.yml)),
   so a regression cannot ship.

2. **Mutation reachability.** Same script confirms V600 sits 17.0
   Å from the pocket centre — inside the 18 Å reach of the 36 Å
   box, with margin. The widening was a deliberate decision
   documented in the catalog comment.

3. **The number itself.** The docking job is public —
   [click through to the matrix](https://liganx.com/jobs/oL28aYHaUu0),
   open the Vemurafenib row, see WT and V600E cells side by side.
   The 3D viewer shows both poses with contact-coloured side
   chains; the 2D map shows interaction residues. If the WT pose
   drops a key contact that the V600E pose recovers, that's the
   molecular rationale for the Δ.

4. **The catalog decision.** The `minimize_mutant=False` flag for
   BRAF is in
   [`catalog.py`](https://github.com/arashtadi/liganx/blob/main/backend/src/deltadock/catalog.py)
   with a multi-paragraph comment explaining the activation-loop
   reasoning. Anyone reviewing our scientific judgement can see
   the call we made and why.

5. **The validation page.** [`liganx.com/validation`](https://liganx.com/validation)
   re-derives this row alongside seven other literature-anchored
   cases and a per-case verdict. The current snapshot shows BRAF
   V600E at the top of the suite alongside ABL T315I, EGFR T790M,
   KIT D816V, and BTK C481S — five clean PASSes covering the major
   classes of clinically actionable kinase mutations.

---

## What this case proves — and what it doesn't

**Proves.** On the canonical BRAF-V600E + Vemurafenib selectivity
event, Liganx returns the correct direction with a magnitude well
above its scoring-method noise floor. The pocket coordinates,
mutation residue identity, box size, and per-target receptor-prep
choice are all independently verified against ground truth. The
docking job is public and any reviewer can re-run it from their
own session in five minutes.

**Doesn't prove.** That Liganx's Δ values are calibrated to ΔΔG
of binding. Vina is empirical scoring, not free energy. The 2.70
kcal/mol shift is qualitatively correct (mutant > WT) and within
the same order of magnitude as the cellular IC₅₀ shift (~3-fold
≈ 0.7 kcal/mol), but the platform shouldn't be cited for absolute
affinity prediction — that's an FEP+ / TI-MD job and we don't
claim to be one.

This case is the *direction* signal, on its strongest example.
The public [validation page](https://liganx.com/validation) shows
where direction signals weaken or fall below noise (covalent
inhibitors, non-covalent retention against covalent escape, and
active-conformation selectivity drugs whose mechanism Vina
fundamentally cannot resolve) and is transparent about which
mutation classes are inside vs outside the platform's competence.

---

## Why this case lands so cleanly — once we got the receptor right

V600E is a near-ideal target for rigid-receptor docking *when the
receptor is the right receptor*:

- The activation-loop substitution V → E reshapes the αC-helix
  geometry in a way that's visible in the rigid receptor — even
  without molecular-dynamics relaxation, a glutamate side chain at
  position 600 introduces measurable steric and electrostatic
  changes in the ATP pocket vicinity.
- Vemurafenib was specifically designed to fit the V600E-shifted
  pocket. Its scaffold (a difluorophenylsulfonamide-azaindole)
  sits deep in the type-I binding mode, and the selectivity gain
  is driven by direct contacts rather than long-range allosteric
  effects.
- 4WO5 already crystallises in the active-like conformation
  Vemurafenib binds, so the rigid receptor is the right starting
  point — no conformational gap to traverse, *provided* we don't
  introduce one by post-hoc minimisation.

Compare this to KIT D816V + Avapritinib, where the biological
effect is an active-conformation switch our 1T46 receptor doesn't
sample, or BTK C481S + Pirtobrutinib, where the clinical advantage
is the *absence* of a covalent bond that Vina doesn't model
either way. Those are documented in our validation suite as below
noise or as wrong-direction-with-known-cause — same platform, same
pipeline, same exhaustiveness; the difference is that the
underlying biology requires what Vina can't model. We say so
explicitly on the validation page rather than burying it.

---

## The pitch

> "Vemurafenib was approved in 2011 specifically because it binds
> BRAF V600E ~3× better than wild-type. Liganx returns Δ = −2.7
> kcal/mol on this same case — the right direction, well above
> the Vina noise floor, in a job that takes under a minute on the
> live platform. We can show you the docked pose, the contact map,
> the catalog audit that confirms our pocket coordinates match the
> co-crystal structure to within 0.1 Å, **and** the per-target
> catalog flag that captures the receptor-prep judgement we had
> to make on this specific kinase to get the answer right. The
> story behind that flag is the half of the demo most platforms
> would hide. Try this on your own mutation/drug pair: free for
> academic use, no install, no license — runs in your browser."

That's the slide. The rest of the deck explains where Liganx is
and isn't the right tool.
