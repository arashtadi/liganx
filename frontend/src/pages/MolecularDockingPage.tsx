/**
 * /molecular-docking — pillar / head-term SEO landing page.
 *
 * Targets the competitive head term "molecular docking" (and the winnable
 * long-tail around it: "free molecular docking online", "molecular docking
 * software online", "web-based docking", "AutoDock Vina online",
 * "protein-ligand docking online"). Deliberately comprehensive + semantic
 * (h1/h2/h3, <dl>, internal links) so Google reads it as the authoritative
 * resource on the topic and surfaces it for both definitional and
 * task-shaped queries. Registered in prerender/entry.tsx (per-route meta +
 * static HTML) and in the sitemap at priority 0.9.
 */

import { Link } from "react-router-dom";
import { ArrowRight } from "../components/Icons";
import { usePageMeta } from "../lib/usePageMeta";

export default function MolecularDockingPage() {
  usePageMeta({
    title: "Free Molecular Docking Online — AutoDock Vina + Boltz-2 · Liganx",
    description:
      "Run molecular docking online for free — no install. Dock small molecules against protein targets with GPU AutoDock Vina and Boltz-2 ML, compare wild-type vs. mutant binding, and validate every pose.",
  });

  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
      <header className="mb-10 border-b border-slate-200 dark:border-slate-800 pb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-delta-700 dark:text-delta-300 mb-3">
          Molecular docking
        </p>
        <h1 className="text-3xl sm:text-4xl font-bold text-ink dark:text-white leading-tight mb-4">
          Free molecular docking online
        </h1>
        <p className="text-base text-slate-700 dark:text-slate-300 leading-relaxed">
          Molecular docking predicts how a small molecule binds to a protein
          target and estimates the strength of that binding. Liganx runs
          docking entirely in your browser — free, with nothing to install —
          using GPU-accelerated AutoDock Vina and the Boltz-2 machine-learning
          model. It is also the only free tool that docks against wild-type
          and clinically relevant mutant protein pockets in the same run.
        </p>
        <div className="not-prose flex flex-wrap gap-3 my-6">
          <Link
            to="/studio"
            className="inline-flex items-center gap-1.5 rounded-md bg-delta-600 hover:bg-delta-700 text-white text-sm font-semibold px-4 py-2 transition-colors"
          >
            Start docking free <ArrowRight size={14} />
          </Link>
          <Link
            to="/library"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Browse the target library
          </Link>
        </div>
      </header>

      <section className="mb-10 prose prose-slate dark:prose-invert max-w-none">
        <h2 className="text-2xl font-semibold text-ink dark:text-white">
          What is molecular docking?
        </h2>
        <p>
          Molecular docking is a computational method in structure-based drug
          design that models how a candidate molecule (a ligand) fits into the
          binding pocket of a target protein. A docking run does two things:
          it <strong>searches</strong> the possible orientations and
          conformations (poses) of the ligand inside the pocket, and it{" "}
          <strong>scores</strong> each pose with a function that approximates
          binding free energy — usually reported in kcal/mol, where a more
          negative number means tighter predicted binding.
        </p>
        <p>
          Researchers use docking to prioritise which compounds to synthesise
          or test in the lab, to understand how a drug binds its target, and to
          study how a mutation in the target changes binding — for example, why
          a resistance mutation stops a kinase inhibitor from working.
        </p>

        <h2 className="text-2xl font-semibold text-ink dark:text-white">
          How molecular docking works
        </h2>
        <dl>
          <dt className="font-semibold text-ink dark:text-slate-100">
            1. Prepare the receptor
          </dt>
          <dd>
            The protein structure (from the RCSB PDB or an upload) is cleaned:
            waters and unwanted heteroatoms are stripped, missing atoms are
            fixed, and the binding pocket is defined. Liganx does this
            automatically with PDBFixer, including building any mutation you
            select.
          </dd>
          <dt className="font-semibold text-ink dark:text-slate-100 mt-4">
            2. Prepare the ligand
          </dt>
          <dd>
            The small molecule is converted from a 2D SMILES string or sketch
            into a 3D conformer with correct protonation and rotatable bonds.
          </dd>
          <dt className="font-semibold text-ink dark:text-slate-100 mt-4">
            3. Search &amp; score
          </dt>
          <dd>
            The docking engine samples poses inside the pocket and ranks them by
            a scoring function. Liganx uses AutoDock Vina (QuickVina2-GPU) and
            re-scores with Vinardo for sharper ranking of close analogues, and
            can co-fold with Boltz-2.
          </dd>
          <dt className="font-semibold text-ink dark:text-slate-100 mt-4">
            4. Validate the pose
          </dt>
          <dd>
            A score is only trustworthy if the geometry is physically sensible.
            Every Liganx pose is checked with PoseBusters, and small
            score differences within Vina&apos;s run-to-run noise floor are
            flagged so you don&apos;t over-interpret them. See our{" "}
            <Link to="/validation">validation results</Link>.
          </dd>
        </dl>

        <h2 className="text-2xl font-semibold text-ink dark:text-white">
          Molecular docking online, for free
        </h2>
        <p>
          Traditional docking means installing command-line software (AutoDock
          Vina, Smina), wrangling receptor and ligand file formats, and
          scripting the runs — or paying for an enterprise suite like
          Schrödinger. Liganx sits in the missing middle: a{" "}
          <strong>free, web-based molecular docking</strong> tool that needs no
          install and no file wrangling. You pick a target, add compounds as
          SMILES, a sketch, or a file, and results run on cloud GPUs in a
          couple of minutes with a 3D pose, interaction map, and ADMET profile.
        </p>
        <ul>
          <li>
            <strong>No install</strong> — everything runs in the browser.
          </li>
          <li>
            <strong>Free tier</strong> — real docking runs at no cost, no credit
            card.
          </li>
          <li>
            <strong>GPU AutoDock Vina + Boltz-2</strong> — established scoring
            plus a modern ML co-folding model.
          </li>
          <li>
            <strong>Pose validation built in</strong> — PoseBusters checks and a
            documented noise floor.
          </li>
        </ul>

        <h2 className="text-2xl font-semibold text-ink dark:text-white">
          Mutation-aware docking — what makes Liganx different
        </h2>
        <p>
          Most docking tools dock against a single static structure. Liganx is{" "}
          <strong>mutation-aware</strong>: in one run it docks your compounds
          against the wild-type pocket and against clinically relevant mutants —
          such as{" "}
          <Link to="/mutation-docking-guide">
            EGFR T790M, BCR-ABL T315I, BRAF V600E, or KRAS G12C
          </Link>{" "}
          — and shows the Δ score (mutant minus wild-type) so you can see at a
          glance which compounds lose potency to a resistance mutation and which
          keep or gain selectivity. Browse the{" "}
          <Link to="/library">curated mutation library</Link> or the{" "}
          <Link to="/atlas">target atlas</Link> to see what is covered.
        </p>

        <h2 className="text-2xl font-semibold text-ink dark:text-white">
          How to run a molecular docking on Liganx
        </h2>
        <ol>
          <li>
            <strong>Pick a target</strong> — choose from the curated catalog,
            search the RCSB PDB, or upload your own structure.
          </li>
          <li>
            <strong>Choose mutations (optional)</strong> — add clinical variants
            to compare against wild-type, or dock wild-type only.
          </li>
          <li>
            <strong>Add compounds</strong> — sketch a structure, paste a list of
            SMILES, or upload a CSV/SDF.
          </li>
          <li>
            <strong>Run dock</strong> — Liganx docks every compound against
            wild-type and each mutant in parallel on GPU.
          </li>
          <li>
            <strong>Inspect &amp; iterate</strong> — read the Δ-vs-WT matrix,
            rotate the 3D pose, check ADMET, and refine.
          </li>
        </ol>
        <div className="not-prose flex flex-wrap gap-3 my-6">
          <Link
            to="/studio"
            className="inline-flex items-center gap-1.5 rounded-md bg-delta-600 hover:bg-delta-700 text-white text-sm font-semibold px-4 py-2 transition-colors"
          >
            Try molecular docking now <ArrowRight size={14} />
          </Link>
        </div>

        <h2 className="text-2xl font-semibold text-ink dark:text-white">
          Frequently asked questions
        </h2>
        <h3 className="text-lg font-semibold text-ink dark:text-slate-100">
          Is molecular docking accurate?
        </h3>
        <p>
          Docking is a fast approximation, not a physics-exact free-energy
          calculation. It is well suited to ranking and triaging compounds and
          to studying binding-mode hypotheses, but scores should be read as
          relative, not absolute. Liganx surfaces pose-validation flags and a
          noise floor so you know how much weight a given result carries.
        </p>
        <h3 className="text-lg font-semibold text-ink dark:text-slate-100">
          What file formats do I need?
        </h3>
        <p>
          None to start — a PDB ID and a SMILES string are enough. Liganx also
          accepts uploaded PDB structures and CSV/SDF compound files and handles
          all receptor and ligand preparation for you.
        </p>
        <h3 className="text-lg font-semibold text-ink dark:text-slate-100">
          Which docking engine is best?
        </h3>
        <p>
          AutoDock Vina is the most widely used open-source engine and a strong
          default. Liganx runs a GPU build (QuickVina2), re-scores with Vinardo,
          and offers the Boltz-2 ML model — so you can compare a classical
          scoring function with a modern learned one on the same input.
        </p>

        <p className="mt-8">
          Want to go deeper? Read the{" "}
          <Link to="/mutation-docking-guide">
            practical guide to docking against a mutation
          </Link>{" "}
          or the <Link to="/blog">Liganx blog</Link> for structure-based
          drug-design write-ups.
        </p>
      </section>
    </article>
  );
}
