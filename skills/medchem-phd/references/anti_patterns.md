# Anti-patterns — mistakes that look reasonable but produce wrong results

The whole reason this skill exists is to avoid these. Read this file
before recommending a pipeline change. Ask yourself: am I about to
fall into one of these traps?

## Anti-pattern 1: "Symmetry is always cleaner than asymmetry"

**The reasoning that sounds clean:** WT and mutant receptors should
go through the same prep pipeline. Treating them differently is a
"bug" — let's apply the same OpenMM minimisation to both for
consistency.

**Why it's wrong:** WT and mutant are *not* in the same physical
state. WT comes from a crystal structure — by definition a low-energy
minimum (otherwise the crystal wouldn't have formed). Mutant comes
from a synthetic side-chain swap (PDBFixer.applyMutations or FoldX),
which leaves the new residue's atoms at the WT position with the new
residue's atom names. For non-isosteric substitutions (V→E, C→S,
G→V) that means bond-length errors of 0.1-0.3 Å and atomic clashes
of 0.5-1.0 Å. The mutant *needs* relaxation to fix the clashes; the
WT does not need relaxation because there are no clashes to fix.

Symmetric prep applied to asymmetric inputs produces asymmetric harm:
the WT's pocket geometry collapses slightly under vacuum minimisation
(losing the discriminating geometry that gave Vina its selectivity
signal), while the mutant's collapse is the relaxation it actually
needed.

**Worked case (Liganx 2026-05-01, the v5 incident):**

A PhD-level audit recommended symmetric WT/mutant minimisation. The
team implemented it, re-ran the validation suite, and watched 5/8
PASS collapse to 2/8 PASS + 1 FAIL within hours. Per-case Δ table:

| Case | v4 (asymmetric) | v5 (symmetric) | What happened |
|------|------------------|------------------|---------------|
| ABL T315I + Imatinib | PASS +3.6 | PASS +1.2 | Margin shrunk ~2 kcal/mol |
| EGFR T790M + Gefitinib | PASS +1.3 | NOISE 0.0 | WT loosened, killed margin |
| BRAF V600E + Vemurafenib | PASS −2.7 | NOISE 0.0 | WT became as tight as MUT |
| KIT D816V + Imatinib | PASS +2.6 | FAIL −1.8 | Direction flipped |
| BTK C481S + Ibrutinib | PASS +1.5 | NOISE +0.5 | WT loosened, killed margin |

The fix was to revert and document: WT skips minimisation, mutant
does it (gated per-target by `Target.minimize_mutant`). A CI gate
(`verify_prep_symmetry.py`) now blocks the symmetric-prep pattern
from being reintroduced.

**The lesson:** When two things are treated differently, ask *why*
before recommending they be treated the same. The asymmetry might
be the correct response to a real difference in the inputs.

## Anti-pattern 2: "Recommending changes without reading the validation suite"

**The reasoning that sounds clean:** The code looks suspicious; let's
fix it.

**Why it's wrong:** The code may have been written specifically to pass
empirical validation that you haven't seen. If the team has a
positive-control validation suite (literature-anchored mutation/drug
pairs), reading it before recommending changes is non-optional. The
suite encodes lessons about edge cases, target-specific quirks, and
known method limits that aren't visible in the code or comments.

**The right move:** Before recommending any change to a pipeline
component, ask "what does the validation suite say about this?" or
"can you point me to the test that would fail if I'm wrong?"

In the v5 incident, the audit didn't read the validation suite first.
A 30-second look at `validation_results.json` would have shown that
the v4 prep was passing 5/8 cases — strong evidence that the
asymmetry was *working*, not failing.

## Anti-pattern 3: "Inventing residue names in AI-generated rationales"

**The reasoning that sounds clean:** The AI compound editor should
explain *why* a particular medchem move helps — naming the specific
residue makes the rationale concrete.

**Why it's wrong:** Language models will hallucinate plausible-sounding
residue names if not constrained. The model has seen enough kinase
literature to confabulate "this swap reaches Tyr541" when there's no
Tyr541 in the actual pocket data. The rationale sounds expert but is
fabricated, and it teaches the user to trust pocket-aware claims that
aren't grounded.

**The right move:** Constrain the prompt to refer only to residues
that appear in the input data (e.g., the `hits` and `misses` lists
from a contact analysis). If a move doesn't target a specific
residue from those lists, describe the chemical move generically
("adds a fluorine for metabolic stability") without inventing a
residue label.

The Liganx `_OPTIMIZE_SYSTEM_PROMPT` has an explicit "DO NOT INVENT
RESIDUE NAMES" guard for this reason.

## Anti-pattern 4: "Reading absolute affinity from Vina"

**The reasoning that sounds clean:** Vina returns a kcal/mol
number — that's a free energy, so it must predict the absolute Kd.

**Why it's wrong:** Vina is empirical scoring, not free-energy
perturbation. The scoring function was fit to known affinities at
1-2 nM, but the relationship between score and IC50 is loose — the
empirical correlation typically has R² ~ 0.4-0.6 across a diverse
test set. Reading a −10 kcal/mol score as "Kd ≈ 50 nM" is
overinterpretation.

**The right move:** Use Vina for ranking and direction. Read Δ values
as "direction at above-noise magnitude," not as ΔΔG. For absolute
affinity prediction use FEP+ or TI-MD; that's not what Vina does.

## Anti-pattern 5: "Cache hits as evidence of identical scores"

**The reasoning that sounds clean:** Two cells in the matrix returned
the same score — they're either both correct or there's a bug.

**Why it's wrong:** Identical scores between WT and mutant cells can
arise from:
- A real no-difference result (mutation outside pocket)
- A cache hit (Pod-side dock_server caches by receptor+ligand md5;
  if the receptor PDBQT is byte-identical between WT and mutant, the
  second call returns the cached result)
- Identical receptor file (the mutant build silently failed and fell
  back to WT)
- A bug in cache invalidation (rare but happens)

You cannot tell which of these from the number alone. The
falsification step is to check the receptor PDBQT md5sums and the
.prep_version stamps on disk.

## Anti-pattern 6: "Making the report sound expert by using more jargon"

**The reasoning that sounds clean:** A more technical-sounding output
will be more credible.

**Why it's wrong:** Jargon hides reasoning. If you can't explain a
finding in plain language ("the WT pocket got loosened, which killed
the selectivity signal"), you might not actually understand it. The
team you're embedded in will trust an answer that lays out the
structural-biology reasoning more than one that name-drops "implicit
solvent OBC" without explaining why it matters.

**The right move:** Use jargon when it's the most precise word for
the thing you're describing. Otherwise prefer plain language. "The
mutant's side chain is bulkier and clashes with the inhibitor's
methyl group" is better than "non-bonded interaction term penalty
exceeds the configurational entropy gain."

## Anti-pattern 7: "Confident-sounding wrong > 'I don't know'"

**The reasoning that sounds clean:** If the user asked a question,
they want an answer.

**Why it's wrong:** Confident wrong answers are the most expensive
output mode. The user will act on them. They'll change code, ship
deploys, update marketing copy. If you don't know the answer with
sufficient confidence, the right output is "I don't have enough
information to be sure — here's what would resolve it."

**The right move:** Calibrate confidence explicitly. If you're 90%
sure, say so. If you're 50/50, say so. Propose the falsification
step that would get you to higher confidence. The user can then
choose to act on uncertain advice or to spend the time on the
falsification.

## Quick checklist before recommending any change

Before sending a recommendation:

1. ☐ Did I read the validation suite (or at least look for one)?
2. ☐ Did I check whether the asymmetry / oddity I'm flagging might be
   intentional?
3. ☐ Can I explain *why* my recommended change is better in
   structural-biology terms (not just "looks cleaner")?
4. ☐ Did I propose a falsification step (test, re-run, comparison)?
5. ☐ Did I quantify my confidence?
6. ☐ Did I distinguish "looks suspicious" from "is wrong"?

If any box is unchecked, the recommendation is premature.
