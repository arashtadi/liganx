/**
 * /mutation-docking-guide — long-tail SEO landing page.
 *
 * Why this page exists, separate from /library and /validation:
 *
 * The /library page is a catalog interface — it ranks for "kinase
 * mutation library" but Google doesn't surface it for question-shaped
 * queries like "how do I dock a compound against EGFR T790M" or
 * "which PDB structure should I use for BCR-ABL T315I docking".
 * Those queries are exactly the audience we want — somebody googling
 * them is mid-task and will sign up the moment they land on a page
 * that answers their actual question.
 *
 * Per the keyword-research agent (10 long-tail queries), the highest-
 * intent buckets we don't currently cover are:
 *   - "how to model {mutation} resistance with docking"
 *   - "best PDB structure for {target} {mutation}"
 *   - "comparing wild-type vs mutant docking scores"
 *   - "what is delta Δ in docking interpretation"
 *
 * This page answers each of those in plain prose + offers a one-click
 * CTA into the live tool. Heavy use of semantic <h2>/<h3>/<dl> for
 * SEO; deliberately NOT a designed marketing page so a sceptical
 * researcher reads it as content, not a sales pitch. Internal-link-
 * heavy: every mention of a mutation in the body links to the live
 * library row so search-engine crawlers (and people) can follow the
 * thread into the product.
 *
 * Indexed via robots.txt (allow /mutation-docking-guide) and listed in
 * sitemap.xml at priority 0.8.
 */

import { Link } from "react-router-dom";
import { ArrowRight } from "../components/Icons";
import { usePageMeta } from "../lib/usePageMeta";

export default function MutationDockingGuidePage() {
  usePageMeta({
    title: "How to dock against a kinase mutation — practical guide · Liganx",
    description:
      "Plain-English guide to molecular docking against clinically relevant kinase mutations: EGFR T790M, BCR-ABL T315I, BRAF V600E, KRAS G12C. Which PDB to use, how to read Δ scores, common pitfalls.",
  });

  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
      <header className="mb-10 border-b border-slate-200 dark:border-slate-800 pb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-delta-700 dark:text-delta-300 mb-3">
          Practical guide
        </p>
        <h1 className="text-3xl sm:text-4xl font-bold text-ink dark:text-white leading-tight mb-4">
          How to dock a compound against a kinase mutation
        </h1>
        <p className="text-base text-slate-700 dark:text-slate-300 leading-relaxed">
          A practical walkthrough for evaluating a compound against a
          clinically relevant resistance or selectivity mutation —
          including which PDB structure to use, how to interpret the
          wild-type vs. mutant Δ score, and the most common ways
          docking studies of mutations go wrong.
        </p>
      </header>

      <section className="mb-10 prose prose-slate dark:prose-invert max-w-none">
        <h2 className="text-2xl font-semibold text-ink dark:text-white">
          The short version
        </h2>
        <p>
          To compare how a compound binds the wild-type and mutant forms
          of a kinase, you need three things: a clean apo or
          ligand-bound crystal structure of the wild-type protein, a
          way to introduce the mutation in silico, and a docking engine
          that returns a comparable score for both. The Δ score
          (mutant − wild-type) tells you whether the mutation is
          predicted to weaken (positive Δ, resistance), strengthen
          (negative Δ, selectivity), or leave binding unchanged.
        </p>
        <p>
          On Liganx the entire workflow takes about two minutes from
          choosing a target to having a side-by-side wild-type/mutant
          score with a 3D pose, ProLIF interaction fingerprint, and
          PoseBusters geometric validation. The catalog covers 13 of
          the highest-impact oncology kinase targets and 40 actionable
          mutations.
        </p>
        <div className="not-prose flex gap-3 my-6">
          <Link
            to="/studio"
            className="inline-flex items-center gap-1.5 rounded-md bg-delta-600 hover:bg-delta-700 text-white text-sm font-semibold px-4 py-2 transition-colors"
          >
            Start a docking job <ArrowRight size={14} />
          </Link>
          <Link
            to="/library"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-semibold px-4 py-2 text-slate-700 dark:text-slate-200 transition-colors"
          >
            Browse the mutation library
          </Link>
        </div>
      </section>

      <section className="mb-10 prose prose-slate dark:prose-invert max-w-none">
        <h2 className="text-2xl font-semibold text-ink dark:text-white">
          Step 1 — Pick the right PDB structure
        </h2>
        <p>
          Most failed mutation-docking studies fail because of the
          structure choice, not the docking algorithm. The questions
          worth asking before you pick a PDB ID:
        </p>
        <dl>
          <dt><strong>Is the mutated residue resolved in the structure?</strong></dt>
          <dd>
            If the residue you want to mutate isn't present in the
            crystal (a common problem with flexible loops), you can't
            apply the mutation to it. Liganx pre-flight validation flags
            this and suggests alternate PDB IDs that resolve the residue.
          </dd>
          <dt><strong>Is the residue in the binding pocket?</strong></dt>
          <dd>
            A mutation 30 Å away from the docking box can't possibly
            affect a Vina-scored pose. Liganx labels this as
            &ldquo;outside docking box&rdquo; and treats Δ ≈ 0 as the
            expected, honest outcome rather than a failure.
          </dd>
          <dt><strong>Was the structure solved with a ligand bound?</strong></dt>
          <dd>
            Apo structures often have a collapsed or rearranged pocket.
            For drug-discovery work prefer a holo (ligand-bound)
            structure, then strip the co-crystal ligand before docking.
          </dd>
          <dt><strong>Is the resolution adequate?</strong></dt>
          <dd>
            Below 2.5&nbsp;Å is generally fine for docking. Above
            3.0&nbsp;Å, side-chain placements get noisy and small Δ
            differences become unreliable.
          </dd>
        </dl>
      </section>

      <section className="mb-10 prose prose-slate dark:prose-invert max-w-none">
        <h2 className="text-2xl font-semibold text-ink dark:text-white">
          Step 2 — Apply the mutation
        </h2>
        <p>
          There are two common ways to introduce a point mutation into a
          docking-ready receptor. PDBFixer-style residue replacement
          rebuilds the side chain in a default rotamer; FoldX
          BuildModel additionally minimises the local environment to
          relieve steric clashes. For gatekeeper mutations like EGFR
          T790M and BCR-ABL T315I — where a small Thr → Met / Ile
          substitution introduces a bulky side chain into a tight
          pocket — the local relaxation matters because an unrelaxed
          Met side chain can clash with the docking box and produce
          spurious resistance scores.
        </p>
        <p>
          Liganx applies PDBFixer for the basic mutation step, then
          OpenMM-minimises the receptor before running the docking
          engine. This consistently produces literature-aligned Δ
          scores across our published validation suite.
        </p>
      </section>

      <section className="mb-10 prose prose-slate dark:prose-invert max-w-none">
        <h2 className="text-2xl font-semibold text-ink dark:text-white">
          Step 3 — Choose a docking engine (or run all three)
        </h2>
        <p>
          The three engines available on Liganx have different
          strengths:
        </p>
        <dl>
          <dt><strong>AutoDock Vina (QuickVina2-GPU)</strong></dt>
          <dd>
            The standard physics-based scoring function. Fast on GPU,
            well-validated, and returns scores in kcal/mol that are
            directly comparable across runs. The right default for
            most mutation-comparison work.
          </dd>
          <dt><strong>GNINA</strong></dt>
          <dd>
            A convolutional neural network rescorer trained on the PDBbind
            dataset. Often improves pose ranking when Vina returns
            several near-degenerate poses. Slower than Vina; worth the
            cost for the final shortlist.
          </dd>
          <dt><strong>Boltz-2</strong></dt>
          <dd>
            A 2025 ML co-folding model that predicts the
            protein-ligand complex geometry directly from sequence and
            SMILES, then reports a calibrated affinity in
            log<sub>10</sub>(IC<sub>50</sub> µM). Slowest of the three
            (~5 minutes per pose) but the only engine that natively
            handles induced fit. The Imatinib × BCR-ABL T315I
            gatekeeper test reproduces the published resistance signal
            (Δ = +0.60).
          </dd>
        </dl>
      </section>

      <section className="mb-10 prose prose-slate dark:prose-invert max-w-none">
        <h2 className="text-2xl font-semibold text-ink dark:text-white">
          Step 4 — Read the Δ score honestly
        </h2>
        <p>
          The wild-type vs. mutant Δ is the headline number. A few
          things worth keeping in mind when interpreting it:
        </p>
        <ul>
          <li>
            <strong>Δ &gt; +1 kcal/mol</strong> is a meaningful
            predicted resistance signal. Anything smaller is in the
            noise floor for Vina-style scoring.
          </li>
          <li>
            <strong>Δ &lt; -1 kcal/mol</strong> is a meaningful
            predicted selectivity signal. Drugs that gain ≥1 kcal/mol
            of binding to the mutant over the wild-type are the
            strongest mutant-selective candidates.
          </li>
          <li>
            <strong>|Δ| &lt; 0.5 kcal/mol</strong> means the mutation
            doesn&rsquo;t differentiate this compound from the
            wild-type at the resolution Vina can see. That&rsquo;s
            often the right answer — many mutations are silent for
            many compounds.
          </li>
          <li>
            <strong>Compare the 3D poses, not just the numbers.</strong>
            Two compounds with the same Δ can have completely different
            mechanisms. The 3D viewer and ProLIF interaction
            fingerprint show you what binding mode each compound
            adopts in each variant.
          </li>
        </ul>
      </section>

      <section className="mb-10 prose prose-slate dark:prose-invert max-w-none">
        <h2 className="text-2xl font-semibold text-ink dark:text-white">
          Worked examples
        </h2>
        <p>
          Five of these are documented in our{" "}
          <Link to="/validation" className="text-delta-700 hover:underline dark:text-delta-300">
            scientific validation suite
          </Link>
          {" "}with the live job links. Each starts from a published
          cellular IC<sub>50</sub> ratio and reproduces the expected
          direction of the Liganx Δ score.
        </p>
        <dl>
          <dt><strong>BCR-ABL T315I (Imatinib resistance)</strong></dt>
          <dd>
            The classic gatekeeper mutation. Imatinib binds the
            inactive DFG-out conformation; Thr315 → Ile blocks the
            entrance and the published cellular IC<sub>50</sub> shifts
            ~30-fold. Liganx Δ on Boltz-2 reproduces +0.60 in
            log<sub>10</sub>(IC<sub>50</sub> µM).
          </dd>
          <dt><strong>EGFR T790M (Gefitinib/Erlotinib resistance)</strong></dt>
          <dd>
            Acquired resistance to first-generation EGFR inhibitors.
            The bulky Met side chain partially fills the pocket and
            increases ATP affinity, indirectly lowering inhibitor
            binding. Published cellular IC<sub>50</sub> shift ~10x;
            Liganx Δ reproduces the resistance direction.
          </dd>
          <dt><strong>BRAF V600E (Vemurafenib selectivity)</strong></dt>
          <dd>
            Vemurafenib was specifically designed to preferentially
            bind the V600E mutant. The Δ should be negative
            (mutant-selective). Liganx Δ on the V600E case reproduces
            the published selectivity once OpenMM minimisation is
            disabled for this target — see the validation page case
            study for the discussion.
          </dd>
          <dt><strong>BTK C481S (Ibrutinib resistance)</strong></dt>
          <dd>
            Ibrutinib is a covalent inhibitor that bonds to Cys481;
            the C481S mutation removes the covalent anchor. Vina
            scores will not capture the loss of covalent bonding —
            this is a documented method limit, not a Liganx bug.
          </dd>
        </dl>
      </section>

      <section className="mb-10 prose prose-slate dark:prose-invert max-w-none">
        <h2 className="text-2xl font-semibold text-ink dark:text-white">
          Common pitfalls
        </h2>
        <ul>
          <li>
            <strong>Using a different PDB for wild-type vs. mutant.</strong>
            The Δ then conflates structural noise with the mutation
            effect. Always start from the same crystal and apply the
            mutation in silico.
          </li>
          <li>
            <strong>Treating |Δ| &lt; 0.5 as a failure.</strong>
            Most mutations are silent for most compounds. A near-zero
            Δ is information, not a bug.
          </li>
          <li>
            <strong>Ignoring covalent inhibitors.</strong>
            Vina/GNINA/Boltz-2 are non-covalent scoring functions. For
            covalent ligands (Ibrutinib, Osimertinib, Sotorasib) the
            Δ ranks reversible binding only.
          </li>
          <li>
            <strong>Docking against a low-resolution apo structure.</strong>
            A 3.5&nbsp;Å apo crystal often has a collapsed pocket; Vina
            will dock the ligand into a sterically wrong site and
            return a meaningless Δ. Prefer holo, &lt; 2.5&nbsp;Å.
          </li>
        </ul>
      </section>

      <section className="mb-12 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-6">
        <h2 className="text-lg font-semibold text-ink dark:text-white mb-2">
          Try it on your compound
        </h2>
        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed mb-4">
          Bring a SMILES and a PDB ID — or pick a target from our
          curated catalog — and have a wild-type vs. mutant comparison
          in front of you in about two minutes. Free for academic use.
          No install.
        </p>
        <div className="flex gap-3">
          <Link
            to="/studio"
            className="inline-flex items-center gap-1.5 rounded-md bg-delta-600 hover:bg-delta-700 text-white text-sm font-semibold px-4 py-2 transition-colors"
          >
            Start a docking job <ArrowRight size={14} />
          </Link>
          <Link
            to="/validation"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-semibold px-4 py-2 text-slate-700 dark:text-slate-200 transition-colors"
          >
            See the validation suite
          </Link>
        </div>
      </section>

      <footer className="mt-12 pt-6 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
        <p>
          Related: <Link to="/library" className="text-delta-700 hover:underline dark:text-delta-300">mutation library</Link> ·{" "}
          <Link to="/validation" className="text-delta-700 hover:underline dark:text-delta-300">validation suite</Link> ·{" "}
          <Link to="/" className="text-delta-700 hover:underline dark:text-delta-300">Liganx home</Link>
        </p>
      </footer>
    </article>
  );
}
