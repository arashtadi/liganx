/**
 * Post: Plasma protein binding and the free drug hypothesis.
 *
 * SEO target: "plasma protein binding", "free drug hypothesis", "fraction
 * unbound", "fu drug discovery". ADMET explainer theme. Internal CTA into
 * /studio framing docking potency vs in vivo free concentration.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "plasma-protein-binding-free-drug-hypothesis",
  title: "Plasma protein binding and the free drug hypothesis",
  description:
    "Only unbound drug reaches the target, so why does optimizing protein binding so often waste a medicinal chemistry program? A practical look at fraction unbound.",
  date: "2026-05-22",
  author: "Liganx team",
  tags: ["admet", "plasma-protein-binding", "pharmacokinetics", "drug-design"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        A docking score tells you how tightly a molecule binds its target in
        an idealized pocket. What it cannot tell you is how much of that
        molecule will ever be free in the bloodstream to reach the target at
        all. Most of a circulating drug is stuck to plasma proteins, and
        only the unbound fraction does the work. Understanding that
        distinction, and the ways it is routinely misused, separates a
        useful potency number from a misleading one.
      </p>

      <h2>What plasma protein binding actually is</h2>
      <p>
        Once a drug enters the blood, it partitions between two pools: bound
        to plasma proteins, and free in solution. The dominant binders are{" "}
        <strong>albumin</strong> (which carries acidic and neutral drugs) and{" "}
        <strong>alpha-1-acid glycoprotein</strong> (which carries many basic
        drugs). Binding is reversible and fast, so the two pools stay in
        equilibrium. The parameter that captures it is the{" "}
        <strong>fraction unbound</strong>, written fu: the ratio of free
        drug concentration to total drug concentration. A drug that is 99%
        bound has an fu of 0.01.
      </p>

      <h2>The free drug hypothesis</h2>
      <p>
        The governing principle is simple: only unbound drug crosses
        membranes, distributes into tissue, and engages the target. Protein
        complexes are too large and too transient to act on the receptor.
        At steady state, the free concentration in plasma equilibrates with
        the free concentration at the site of action, so the unbound plasma
        level is the quantity that matters for efficacy.
      </p>
      <p>
        The practical consequence is that potency and exposure must be
        compared on the same footing. An in vitro IC50 is measured in a
        protein-poor buffer, so it is effectively a free-drug potency. To
        ask whether a dose will work, you compare that free IC50 against the
        free (not total) plasma concentration the dose produces. Comparing a
        free IC50 against a total plasma level, ignoring the 99% that is
        bound, is one of the most common ways a program fools itself into
        thinking a compound is more potent in vivo than it really is.
      </p>

      <h2>The trap: optimizing protein binding for its own sake</h2>
      <p>
        It is tempting to read &ldquo;99% bound&rdquo; as a problem to be
        engineered away, on the theory that lowering protein binding frees
        up more drug. This is usually a mistake, and it is worth being
        explicit about why.
      </p>
      <p>
        For an orally dosed drug at steady state, the average free
        concentration is set by the dose rate and the{" "}
        <strong>unbound intrinsic clearance</strong>, not by the fraction
        bound. If you reduce protein binding, you free up more drug, but you
        also expose more drug to clearance, and the two effects cancel. The
        free concentration, the thing that drives efficacy, stays put. So
        chemically chasing a lower protein binding number generally moves a
        lot of structure for no pharmacological gain, and risks degrading
        the properties that actually mattered.
      </p>
      <p>
        The better framing: protein binding is a <em>scaling factor you
        measure</em> so you can interpret total concentrations correctly,
        not a property you optimize. The levers worth pulling are unbound
        potency and metabolic stability.
      </p>

      <h2>Where fu genuinely matters</h2>
      <ul>
        <li>
          <strong>Interpreting PK/PD.</strong> You cannot build a sound
          exposure-response relationship without converting total drug
          levels to free levels using fu.
        </li>
        <li>
          <strong>Drug-drug interactions.</strong> Displacement from
          albumin is often overstated, but fu still feeds the calculations
          that estimate interaction risk and therapeutic index.
        </li>
        <li>
          <strong>Very highly bound compounds.</strong> When fu drops below
          a few percent, fu is hard to measure accurately, and small
          measurement errors translate into large errors in the predicted
          free concentration. For these molecules, predicting an efficacious
          human dose from in vitro potency and fu alone is unreliable and
          should be treated with caution.
        </li>
      </ul>

      <h2>How this connects to docking</h2>
      <p>
        Docking and the free drug hypothesis live at opposite ends of the
        same pipeline. Docking estimates binding affinity to the target,
        which corresponds to the unbound potency you would measure in a
        clean assay. Plasma protein binding then governs how much of your
        compound is available to realize that affinity in a living system.
        A molecule can dock beautifully and still fail in vivo if it is so
        highly and non-specifically bound that the free concentration never
        reaches its own IC50. Keeping the two ideas distinct (target
        affinity from docking, availability from fu) is what stops a strong
        docking result from being over-read.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock a candidate against your target to get the affinity side of
        the picture, then read the predicted score as an unbound potency,
        the number you would later compare against a free plasma
        concentration rather than a total one. Liganx puts molecular docking
        online and free in the browser, so you can run molecular docking on
        a series and rank by target affinity before the ADMET properties
        like protein binding decide which of them survives in vivo.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Smith DA, Di L, Kerns EH. <em>The effect of plasma protein binding
          on in vivo efficacy: misconceptions in drug discovery.</em> Nat Rev
          Drug Discov 9, 929&ndash;939 (2010).{" "}
          <a
            href="https://doi.org/10.1038/nrd3287"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nrd3287
          </a>
        </li>
        <li>
          Liu X, et al. <em>Unbound drug concentration in brain homogenate
          and cerebral spinal fluid at steady state.</em> J Pharm Sci 106,
          2475&ndash;2485 (2017).{" "}
          <a
            href="https://doi.org/10.1016/j.xphs.2017.04.018"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/j.xphs.2017.04.018
          </a>
        </li>
        <li>
          Di L. <em>Free drug concepts: a lingering problem in drug
          discovery.</em> J Med Chem (2025).{" "}
          <a
            href="https://doi.org/10.1021/acs.jmedchem.5c00725"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jmedchem.5c00725
          </a>
        </li>
      </ul>
    </>
  );
}
