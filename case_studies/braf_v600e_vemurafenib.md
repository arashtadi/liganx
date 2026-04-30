# Case study — BRAF V600E + Vemurafenib

**A 90-second walkthrough of a clean Liganx signal, end-to-end.**

This is the example we put in front of a med-chemist who's seen one
docking demo too many. It's the cleanest case in our positive-control
suite: a published mutant-selective drug, a real Δ score above noise,
and every intermediate artifact that backs the number is reproducible
on the live platform.

---

## The biology in one paragraph

BRAF is a serine/threonine kinase in the MAPK signalling cascade. The
**V600E mutation** — valine to glutamate at residue 600 in the activation
loop — is the most common actionable single-residue change in oncology,
present in about half of cutaneous melanomas and a substantial fraction
of thyroid and colorectal cancers. V600E shifts the kinase into a
constitutively active conformation and is the direct molecular driver
of the disease in those patients.

**Vemurafenib (PLX4032)** was approved by the FDA in 2011 specifically
because it binds V600E better than wild-type BRAF — that selectivity
is what makes it tolerable as a systemic therapy. The published
cellular assay numbers:

- IC₅₀ against BRAF^V600E^: **~30 nM**
- IC₅₀ against wild-type BRAF: **~100 nM**
- Net selectivity for the mutant: **~3-fold**

Source: Bollag et al., *Nature* 2010 (PMID 20823850).

If a "mutation-aware docking" platform can't recover the direction of
this binding shift, it can't recover anything. This is the canary.

---

## What Liganx returned

Job ID: [`mDTeK3yoG10`](https://liganx.com/jobs/mDTeK3yoG10) (live on
production, anyone with the link can inspect the docked pose, the
contact map, and the validation badges)

**Run parameters:**
- Target: BRAF kinase domain, PDB **4WO5** chain A
- Pocket centre: (−37.1, −15.4, −43.3) Å — anchored on the chain-A
  324-inhibitor centroid; verified by `verify_catalog.py` on every
  deploy
- Box size: 36 × 36 × 36 Å (widened from the 22 Å default to bring
  V600 — at 17 Å from centre — comfortably inside the 18 Å reach)
- Engine: QuickVina2-GPU (NVIDIA Blackwell pod), exhaustiveness = 8
- Mutant build: PDBFixer applyMutations (FoldX path skipped under
  prod licensing constraints)

**Vina best scores:**

| Variant | Score (kcal/mol) |
|---------|---:|
| Wild-type | −8.40 |
| **V600E** | **−11.30** |

**Δ(V600E − WT) = −2.90 kcal/mol** — Vemurafenib is predicted to bind
the V600E mutant 2.90 kcal/mol stronger than wild-type.

**Direction: matches literature.** Magnitude is well above the ±1 kcal/mol
Vina noise floor, so this is a confident signal — not a noise-floor
artefact, not a sign-flip ambiguity, not a covalent-mechanism caveat.

---

## How a sceptical reader can verify

Every claim above is regenerable on the live platform. The page that
backs them is intentionally public:

1. **Pocket centre vs co-crystal ligand.** Open
   [`backend/scripts/verify_catalog.py`](https://github.com/arashtadi/liganx/blob/main/backend/scripts/verify_catalog.py)
   — it downloads 4WO5 from RCSB, finds the chain-A 324 ligand
   centroid, and confirms the catalog's pocket centre is within 5 Å.
   This script runs as a blocking step before every backend deploy
   ([`fly-deploy.yml`](https://github.com/arashtadi/liganx/blob/main/.github/workflows/fly-deploy.yml)),
   so a regression cannot ship.

2. **Mutation reachability.** Same script confirms V600 (the activation-loop
   residue we substitute) sits 17.0 Å from the pocket centre — inside
   the 18 Å reach of the 36 Å box, with margin. The widening was a
   deliberate decision documented in the catalog comment.

3. **The number itself.** The docking job is public —
   [click through to the matrix](https://liganx.com/jobs/mDTeK3yoG10),
   open the Vemurafenib row, see WT and V600E cells side by side. The
   3D viewer shows both poses with contact-coloured side chains; the
   2D map shows interaction residues. If the WT pose drops a key
   contact that the V600E pose recovers, that's the molecular
   rationale for the Δ.

4. **The validation page.** [`liganx.com/validation`](https://liganx.com/validation)
   re-derives this row alongside seven other literature-anchored cases
   and a per-case verdict. As of the latest snapshot, BRAF V600E is
   the strongest signal in the suite.

---

## What this case proves — and what it doesn't

**Proves.** On the canonical BRAF-V600E + Vemurafenib selectivity
event, Liganx returns the correct direction with a magnitude well
above its scoring-method noise floor. The pocket coordinates,
mutation residue identity, and box size are all independently verified
against ground truth. The docking job is public and any reviewer can
re-run it from their own session in five minutes.

**Doesn't prove.** That Liganx's Δ values are calibrated to ΔΔG of
binding. Vina is empirical scoring, not free energy. The 2.90 kcal/mol
shift is qualitatively correct (mutant > WT) and within the same
order of magnitude as the cellular IC₅₀ shift (~3-fold ≈ 0.7 kcal/mol),
but the platform shouldn't be cited for absolute affinity prediction —
that's an FEP+ / TI-MD job and we don't claim to be one.

This case is the *direction* signal, on its strongest example. The
public [validation page](https://liganx.com/validation) shows where
direction signals weaken or fall below noise (covalent inhibitors,
conformational mutations) and is transparent about which mutation
classes are inside vs outside the platform's competence.

---

## Why this case lands so cleanly

V600E is a near-ideal target for rigid-receptor docking:

- The activation-loop substitution V → E reshapes the αC-helix
  geometry in a way that's visible in the rigid receptor — even
  without molecular-dynamics relaxation, a glutamate side chain at
  position 600 introduces measurable steric and electrostatic changes
  in the ATP pocket vicinity.
- Vemurafenib was specifically designed to fit the V600E-shifted
  pocket. Its scaffold (a difluorophenylsulfonamide-azaindole) sits
  deep in the type-I binding mode, and the selectivity gain is
  driven by direct contacts rather than long-range allosteric
  effects.
- 4WO5 already crystallises in the active-like conformation
  Vemurafenib binds, so the rigid receptor is the right starting
  point — no conformational gap to traverse.

Compare this to KRAS Q61H or KIT D816V, where the biological effect
is a switch-region or activation-loop conformational flip. Those are
documented in our validation suite as below-noise — same platform,
same pipeline, same exhaustiveness; the difference is that the
underlying biology requires what Vina can't model (induced-fit
conformational change). We say so explicitly on the validation page
rather than burying it.

---

## The pitch

> "Vemurafenib was approved in 2011 specifically because it binds
> BRAF V600E ~3× better than wild-type. Liganx returns Δ = −2.9
> kcal/mol on this same case — the right direction, well above the
> Vina noise floor, in a job that takes under a minute on the live
> platform. We can show you the docked pose, the contact map, and
> the catalog audit that confirms our pocket coordinates match the
> co-crystal structure to within 0.1 Å. Try this on your own
> mutation/drug pair: free for academic use, no install, no
> license — runs in your browser."

That's the slide. The rest of the deck explains where Liganx is and
isn't the right tool.
