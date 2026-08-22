# Liganx landing page — tightened hero + pruned comparison

Draft proposal. Goal: sell ONE idea (mutation-aware selectivity), let the honesty
reinforce the headline instead of qualifying it, and make the comparison table
believable by conceding what Schrödinger genuinely owns.

---

## 1. Hero (tightened)

**Eyebrow:** MUTATION-AWARE DOCKING

**Headline:** Find the compounds that prefer the mutant.

**Subhead:**
Pick a clinically relevant mutation, pick your compounds. Liganx docks them
against wild-type and the mutant in parallel and shows you exactly which ones
gain selectivity — no PyMOL, no FoldX setup, no AutoDock wrangling.

**Primary CTA:** Start a docking run
**Secondary CTA:** See it work in 1 second → Browse pre-computed FDA-drug screenings
**Tertiary link:** First time? Open a worked example: BRAF V600E + Vemurafenib →

Keep the sample EGFR selectivity matrix exactly as-is — it's the strongest single
element on the page (concrete numbers + one-line interpretation). Keep the honest
noise line directly under it:

> Vina scoring noise is ~±1 kcal/mol at default exhaustiveness — Δs above ~1
> kcal/mol are interpretable; smaller deltas live near the noise floor.

Keep the trust bar ("Built on tools the community already trusts": Vina, RDKit,
FoldX, Mol*, ProLIF, RunPod).

---

## 2. Replace the 25-item feature wall with 5 pillars

The current "What you get" section reads as a changelog — almost every item wears a
NEW / JUST SHIPPED badge, which dilutes the signal and buries the wedge. Collapse it
into five pillars, each linking to a deeper page. Retire the per-item NEW badges
(keep at most ONE "recently shipped" strip if you want to show momentum).

1. **The selectivity matrix** — N compounds × M mutants, colored by Δ-score. The core.
2. **Pre-computed FDA-drug screenings** — zero-wait proof it works; public, no login.
3. **Resistance Atlas + calibrate-your-own** — docking Δ + ESM-2 fitness, validated.
4. **Three engines + pose validation** — Vina / GNINA / Boltz-2, PoseBusters, strain.
5. **FEP+ (beta)** — real alchemical free energy for the pairs that matter most.

Note: pillar 5 (FEP+) is currently almost invisible on the homepage. It's the more
defensible, higher-value layer — give it real estate as it matures.

---

## 3. Pruned comparison table (7 rows, honest)

The current table is ~26 rows that Liganx wins essentially 26–0, which — right after
the trust-building honesty section — reads as marketing and invites distrust. Cut to
the rows that genuinely differentiate, and concede the one Schrödinger owns. Losing a
row makes the whole table more believable.

| | Free servers | Liganx | Schrödinger Maestro |
|---|:---:|:---:|:---:|
| Mutation-aware WT-vs-mutant matrix | — | ✓ | partial |
| Public resistance-mutation atlas | — | ✓ | — |
| Pre-computed FDA-drug screenings | — | ✓ | — |
| Runs in the browser, no install | ✓ | ✓ | — |
| Three scoring engines side-by-side | — | ✓ | partial |
| Published, reproducible validation report | — | ✓ | — |
| Alchemical FEP+ free energy (gold standard) | — | **beta** | **✓ mature** |

> Reflects publicly known capabilities as of May 2026. Conceding FEP+ maturity is
> deliberate — it's true, and it makes every row above it more credible.

---

## Why these changes

- **One idea, louder.** The wedge ("prefer the mutant") is excellent but currently
  competes with 24 other features for attention. Discipline converts better than
  completeness here.
- **Honesty as a moat — used consistently.** The limitations section is your best
  trust signal; a table you win on every row works against it. Make the table honest
  too and the whole page reads as credible rather than promotional.
- **Lead with where it demonstrably works.** Push the pre-computed library as the
  zero-risk entry point so a skeptic sees a real result before they hit the caveats.
