# Email draft — FoldX licensing terms enquiry to CRG

**To:** foldx@crg.eu (or whoever the current FoldX licensing contact is —
verify on https://foldxsuite.crg.eu/ before sending)
**From:** Arash Tadi <arashtadi@gmail.com>
**Subject:** FoldX service-licence terms for an academic-tier-only docking platform

---

Dear FoldX team,

I'm reaching out about licensing terms for using FoldX BuildModel as a
server-side step inside a public web platform.

**About the platform.** I'm building Liganx (https://liganx.com), a
free, browser-based mutation-aware molecular docking service for
academic researchers. The platform takes a target protein, a clinically
relevant mutation, and a set of compounds, then returns a side-by-side
matrix of wild-type vs mutant Vina docking scores plus interaction
analysis — the kind of WT/mutant Δ workflow that today usually requires
a Schrödinger licence or a hand-rolled FEP+ pipeline.

**Why we need FoldX.** Our current production pipeline uses PDBFixer
(OpenMM) to apply the residue substitution and a short amber99sb-ildn
vacuum minimisation to relax the immediate environment. This works for
direct steric pocket-residue mutations like BRAF V600E, but on
conformational mutations (KRAS Q61H, KIT D816V) the rigid-receptor Δ
sits below the Vina noise floor. FoldX BuildModel's full repacking +
ΔΔG estimate would close that gap and let us return meaningful Δ
values across a much wider set of mutation classes.

We've published our current validation honestly at
https://liganx.com/validation — eight literature-anchored
(target, mutation, drug) positive controls, with a frank "below noise
floor" admission on six of them and the PDBFixer-vs-FoldX trade-off
spelled out.

**What we're asking.** Three specific questions:

1. **What are the current licensing terms for using FoldX as a
   server-side component of an academic free-tier web platform?** The
   public EULA we read covers personal academic download but doesn't
   speak directly to a SaaS-style use. The platform itself is
   non-commercial today; we'd gate FoldX usage behind verified
   academic affiliation (e.g. institutional email domain check,
   ORCID-with-academic-affiliation, or similar).

2. **Is redistribution-by-installation acceptable** if the FoldX binary
   lives only on our private compute infrastructure (a Fly.io machine
   we control, not bundled in any user-facing artifact) and is invoked
   per-job for verified academic users?

3. **What would commercial-tier terms look like** if Liganx adds a
   paid plan in the future? We'd want to negotiate this in advance so
   there's no licensing ambiguity if revenue starts.

**What we'd offer in return.** Beyond the licence fee for the
commercial path:
- Prominent attribution on /validation, the comparison table, and any
  paper or talk where FoldX-derived numbers appear.
- A sample of anonymised summary statistics (number of FoldX runs per
  month, distribution of mutation types, common targets) — useful for
  CRG's own reporting on FoldX adoption.
- Pre-publication reach-out for any benchmark paper we write that uses
  FoldX as the mutant builder.

Happy to schedule a 30-minute call if it'd be more efficient than
email. Available between [INSERT 2-3 time slots] in [TIMEZONE].

Thanks for your time and for FoldX — the EGFR + BRAF + ABL
literature simply wouldn't be where it is without it.

Best,
Arash Tadi
Founder, Liganx
arashtadi@gmail.com
https://liganx.com/validation (for the current scientific snapshot)
https://liganx.com/ (for the platform itself)

---

## Notes for the sender

- **Verify the email address.** The CRG site has changed contacts before;
  search https://foldxsuite.crg.eu/contact-us before sending. The current
  technical lead is Javier Delgado Blanco — his lab page is the canonical
  source.
- **Lead with the one-line value prop, not the licence question.** First
  paragraph above is "what's Liganx", not "we want to use your tool" —
  that's deliberate. Licensing teams say yes more often when the project
  is interesting on its own terms.
- **Be specific about the gate.** Lines like "verified academic
  affiliation via institutional email domain" reassure them we won't
  silently service an industry user. They've been asked this before and
  have a position on it.
- **Don't promise a paper without scoping it.** The "benchmark paper" line
  is intent, not commitment. If FoldX gets gated, the validation page
  itself plus a blog post is enough recognition.
- **Have a fallback ready.** If they decline or their terms are
  prohibitive, the OpenMM amber99sb-ildn minimisation we just shipped
  closes most of the gap (validation suite re-run pending). The email
  is to open a door, not to gamble the platform on it.
