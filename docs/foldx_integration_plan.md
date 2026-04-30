# FoldX integration plan

**Status:** Scoping. Not yet implemented in production. The blocker is
licensing, not engineering — the code path already exists.

The validation suite quantified the cost of running PDBFixer-only mutant
builds: **6 of 8 literature-anchored cases land below the Vina noise
floor** because PDBFixer substitutes the residue identity but does not
energy-minimise the structure. WT and mutant receptors differ only at
one side chain with no global pocket reshape, and rigid-receptor docking
returns essentially identical scores. That's the documented limitation
on `/validation`; this doc is the plan to close it.

---

## What the engineering looks like

Already in the codebase:

- `pipeline/deltadock_pipeline/foldx.py` — `build_mutant()` calls FoldX
  BuildModel, returns the mutant cleaned PDB plus FoldX's ΔΔG estimate.
- `backend/src/deltadock/services/runner.py` — already checks for FoldX
  availability via `_foldx_available()`, falls back to PDBFixer when
  absent (`build_mutant_pdbfixer`).
- `backend/vendor/foldx/README.md` — placeholder pointing at where the
  binary should land.

What's missing on the production image:

- The actual FoldX binary (`foldx` or `foldx5Linux64`) is not bundled in
  the Dockerfile and is not present on the Fly volume.
- No environment variable or config flag tells the runner where to find
  it.
- The matrix UI doesn't surface "this Δ used FoldX" vs "this Δ used
  PDBFixer" so a user can't tell which mutant-build path produced their
  result.

The engineering work to plug this gap is roughly half a day — bundle the
binary, point an env var at it, surface the build path in the matrix.
The reason it isn't already shipped is licensing, addressed below.

---

## The licensing reality

FoldX is distributed by the Centre for Genomic Regulation
(CRG, Barcelona) under a custom EULA, not an OSI-approved licence. The
relevant terms (paraphrased; consult the actual EULA at
https://foldxsuite.crg.eu/ for the current version):

1. **Free for academic users.** A researcher at a non-profit university
   or a publicly funded lab can download and use FoldX without
   payment, after registering with the CRG and accepting the EULA.
2. **Commercial use requires a paid licence.** Industry users (incl.
   biotech, pharma, contract research orgs) must purchase a
   commercial licence directly from CRG. The exact pricing isn't
   public; it's negotiated per-organisation.
3. **No redistribution of the binary.** Even academic licensees cannot
   bundle FoldX in another tool's distribution. We cannot put it in
   our public Docker image and ship it to anyone who pulls
   `liganx/api:latest`.
4. **Service offering ambiguity.** Running FoldX server-side on behalf
   of users — even academic users hitting our API for free — sits in
   a grey zone. CRG hasn't published a clear "service licence" tier.
   A direct conversation with CRG is required before we run FoldX in
   production for our entire user base, even if every individual user
   is academic.

This is why `_foldx_available()` returns `False` on the prod image and
the runner silently falls back to PDBFixer. The fallback is honest in
the sense that it's documented; the cost (6/8 below-noise validation
cases) is real and now public.

---

## Three paths forward, ranked by realism

### Path A — Status quo plus a footnote (recommended for the next 30 days)

Ship the validation page as-is, including its frank "PDBFixer-only
mutant builds put 6/8 cases below noise" admission. Use the
[BRAF V600E case study](../case_studies/braf_v600e_vemurafenib.md) as
the front-of-pitch example because it's the cleanest signal we get
from the rigid-receptor + PDBFixer combination.

This costs nothing, ships immediately, and is what we already did.
The downside is that an industrial reviewer testing our platform on,
say, ABL T315I + Imatinib will see a sub-noise Δ and conclude we
don't work. The validation page mitigates that by directing them to
where Liganx is the right tool (BRAF V600E and similar steric
pocket-residue mutations) and where it isn't (covalent inhibitors,
conformational mutations).

### Path B — Academic-tier opt-in (target: 60 days)

Build a per-job `mutant_build_engine` flag with two values:

- `pdbfixer` (default, available to everyone)
- `foldx` (gated by a verified-academic-affiliation check)

Implementation outline:

1. **Verify academic status.** The cleanest signal is the user's email
   domain. Maintain a curated list of known-academic TLDs (`.edu`,
   `.ac.uk`, `.edu.au`, `.uni-*.de`, etc.) plus a manual allowlist
   for institutions whose domains don't match the pattern (e.g.
   Harvard's many sub-domains, hospitals affiliated with universities).
   Already partially in place via the `affiliation` field on the
   user-profile table — extend with an `academic_verified` boolean
   that defaults to `false` and is set by a verification workflow.

2. **Bundle FoldX into a separate "academic" image.** Build
   `liganx/api:academic` with the FoldX binary baked in. This image
   is run on a separate Fly app (`liganx-api-academic`) that only
   accepts requests from users whose `academic_verified = true`.
   Routing: the main API checks the flag and proxies academic-
   tier jobs to the academic backend. CRG redistribution prohibition
   is satisfied because the image isn't public and access is gated
   on academic status.

3. **Surface the build path in the matrix UI.** Each mutant cell gets
   a small badge: "FoldX-built" (academic tier) or "PDBFixer-built"
   (default tier). The matrix tooltip explains the difference.

4. **Get CRG's blessing in writing.** Email
   foldx@crg.eu before deploying — the academic-only opt-in tier is
   exactly the kind of thing they'd say yes to in advance, and a
   yes-on-record pre-empts any future dispute.

Engineering: ~1 week of focused work (image build, infra plumbing,
domain-verification workflow, UI). Legal: 1-2 weeks of email back-
and-forth with CRG.

### Path C — Commercial licence (only if there's revenue)

If at any point Liganx generates commercial revenue — even a single
paid seat — Path B's academic-only carve-out stops being defensible
and we need a commercial licence from CRG. Ballpark for a small-team
commercial FoldX licence is mid four-figure USD per year, but it's
negotiated per-org and pricing isn't public.

This unlocks shipping FoldX to all paying users, regardless of
academic affiliation, and removes the proxy / gating work from
Path B. The value proposition flips: "Liganx is the only mutation-
aware docking platform with FoldX-relaxed mutant receptors at this
price point" becomes a real differentiator vs Schrödinger.

Path C is contingent on revenue, so it's a future decision, not a
near-term one.

---

## Alternatives that don't require FoldX

If FoldX never works out, two open-source alternatives exist for the
"relax the mutant" step:

- **OpenMM amber99sb-ildn minimisation.** Already a dependency
  (PDBFixer wraps it). Adding 200 steps of minimisation after
  applyMutations would relax the side-chain clashes that PDBFixer
  alone leaves behind. Wouldn't reproduce FoldX's ΔΔG estimate but
  would give a relaxed structure that Vina sees as different from
  WT. Engineering: ~1 day.

- **Rosetta Relax + InterfaceAnalyzer.** Open-source for academic and
  not-for-profit use. Heavyweight (slow, complex setup) but
  scientifically credible. Engineering: ~2 weeks of integration.

The OpenMM-minimisation path is honestly attractive as a near-term win:
it's already a dep, it's open-source-licensed, and it would close most
of the validation-suite gap. **Recommended exploration before committing
to FoldX paths B or C.** Half a day to prototype + re-run the validation
suite — if the NOISE→PASS transition rate is meaningful, that's our
answer and FoldX licensing becomes academic.

---

## Decision needed

Which path do we pursue? My recommendation:

1. **Today / this week:** Ship the validation page (done). Use BRAF
   V600E case study as the pitch. Stay on PDBFixer-only.
2. **Next 1–2 weeks:** Prototype the OpenMM-minimisation post-PDBFixer
   step. Re-run the validation suite. If 3+ cases flip from NOISE to
   PASS, we have our answer and FoldX is unnecessary.
3. **If OpenMM doesn't help enough:** Email CRG about Path B
   (academic-tier opt-in). Get terms in writing.
4. **If Liganx becomes commercial:** Negotiate Path C (commercial
   licence) before any paid feature ships.

The OpenMM prototype is the high-leverage next step — cheap to try,
big upside if it works, and removes the licensing question from the
critical path entirely.
