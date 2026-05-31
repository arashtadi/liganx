/**
 * Post: EGFR L858R — the activating mutation that started it all
 *
 * SEO target: "EGFR L858R", "L858R osimertinib", "exon 21 mutation NSCLC".
 * Internal CTA into /studio to dock against EGFR L858R. Cross-links to the
 * existing T790M and C797S resistance posts.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "egfr-l858r-activating-mutation-nsclc",
  title: "EGFR L858R: the activating mutation that built a drug class",
  description:
    "L858R is one of the two classic EGFR drivers in lung cancer. Here is how a single residue swap in the activation loop turns a kinase on, and which drugs shut it back off.",
  date: "2026-05-26",
  author: "Liganx team",
  tags: ["egfr", "l858r", "nsclc", "kinase", "targeted-therapy"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Two mutations account for the overwhelming majority of EGFR-driven
        non-small cell lung cancer: exon 19 deletions and the exon 21 point
        mutation L858R. Together they define the &ldquo;classic&rdquo; or
        &ldquo;common&rdquo; EGFR activating mutations, and together they are
        the reason a whole generation of targeted lung-cancer drugs exists.
        L858R is the simpler of the two to think about because it is a single
        residue swap, but the way it works is a small masterclass in kinase
        regulation.
      </p>

      <h2>One residue, in exactly the wrong place</h2>
      <p>
        Leucine 858 sits in the activation loop (A-loop) of the EGFR kinase
        domain. In the unliganded, resting kinase the A-loop folds back into
        an autoinhibited conformation that keeps the catalytic machinery
        switched off until the receptor dimerizes at the cell surface.
        Replacing that leucine with a bulky, charged arginine destabilizes
        the inactive fold. The kinase relaxes into its active conformation
        and starts signalling without waiting for the normal ligand-driven
        dimerization cue. The result is constitutive, ligand-independent
        activation of the downstream RAS-MAPK and PI3K-AKT pathways that
        drive proliferation and survival.
      </p>
      <p>
        A subtle structural point matters for drug design: L858R sits
        <em> away</em> from the ATP-binding cleft where small-molecule
        inhibitors bind. The mutation does not reshape the drug pocket
        directly. Instead it shifts the conformational equilibrium of the
        whole domain, and L858R activity remains more dimerization-dependent
        than exon 19 deletions. That difference helps explain why L858R
        tumors, as a group, tend to respond a little less robustly to EGFR
        inhibitors than exon 19 deletion tumors do.
      </p>

      <h2>The drugs that hit it</h2>
      <ul>
        <li>
          <strong>Gefitinib</strong> (Iressa) and <strong>erlotinib</strong>{" "}
          (Tarceva) &mdash; first-generation, reversible ATP-competitive
          inhibitors. They opened the field by showing that EGFR-mutant lung
          cancer is a distinct, druggable disease, but responses are limited
          by the eventual emergence of the T790M gatekeeper mutation.
        </li>
        <li>
          <strong>Afatinib</strong> and <strong>dacomitinib</strong> &mdash;
          second-generation, irreversible covalent binders that target Cys797.
          More durable target coverage than the first generation, at the cost
          of more wild-type EGFR-driven toxicity (rash, diarrhea).
        </li>
        <li>
          <strong>Osimertinib</strong> (Tagrisso) &mdash; third-generation,
          irreversible, and selective for the mutant kinase over wild-type
          EGFR. It is now the first-line standard of care for both common
          activating mutations.
        </li>
      </ul>

      <h2>What the trial data actually show</h2>
      <p>
        The pivotal FLAURA trial randomized previously untreated patients with
        common EGFR mutations to osimertinib versus a first-generation TKI
        (gefitinib or erlotinib). Osimertinib roughly doubled progression-free
        survival overall, and the final overall-survival analysis reported a
        median of 38.6 months for osimertinib versus 31.8 months for the
        comparator. Within the L858R subgroup the progression-free survival
        was about 14.4 months &mdash; meaningful, but consistently shorter than
        in the exon 19 deletion subgroup, echoing the structural intuition
        that L858R is a slightly tougher driver to fully suppress.
      </p>

      <h2>Where resistance goes next</h2>
      <p>
        L858R rarely travels alone for long. On first-generation therapy the
        classic escape route is the{" "}
        <Link
          to="/blog/t790m-osimertinib-resistance"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          T790M gatekeeper mutation
        </Link>
        , which restores ATP affinity and crowds out reversible binders. On
        osimertinib, the on-target escape is often{" "}
        <Link
          to="/blog/egfr-c797s-osimertinib-resistance-fourth-generation"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          C797S
        </Link>
        , which removes the cysteine that the covalent warhead depends on.
        Understanding L858R is the entry point to that whole resistance
        ladder.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick EGFR with the L858R mutation to dock candidate inhibitors
        against the activated kinase. Because L858R shifts the conformational
        equilibrium rather than reshaping the pocket, it is a good case for
        comparing poses against the wild-type structure side by side. Liganx
        brings molecular docking online into the browser, so you can run
        molecular docking against L858R and read the binding-mode differences
        without leaving the page.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Soria JC, Ohe Y, Vansteenkiste J, et al. <em>Osimertinib in untreated
          EGFR-mutated advanced non-small-cell lung cancer.</em> N Engl J Med
          378, 113-125 (2018).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1713137"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1713137
          </a>
        </li>
        <li>
          Ramalingam SS, Vansteenkiste J, Planchard D, et al. <em>Overall
          survival with osimertinib in untreated, EGFR-mutated advanced
          NSCLC.</em> N Engl J Med 382, 41-50 (2020).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1913662"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1913662
          </a>
        </li>
        <li>
          Yun CH, Boggon TJ, Li Y, et al. <em>Structures of lung cancer-derived
          EGFR mutants and inhibitor complexes: mechanism of activation and
          insights into differential inhibitor sensitivity.</em> Cancer Cell 11,
          217-227 (2007).{" "}
          <a
            href="https://doi.org/10.1016/j.ccr.2006.12.017"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/j.ccr.2006.12.017
          </a>
        </li>
      </ul>
    </>
  );
}
