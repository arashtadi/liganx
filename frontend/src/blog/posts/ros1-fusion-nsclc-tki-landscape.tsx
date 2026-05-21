/**
 * Post: ROS1 fusion-positive NSCLC — the TKI landscape (2026)
 *
 * SEO target: "ROS1 inhibitors", "ROS1 G2032R resistance", "repotrectinib
 * taletrectinib ROS1", "ROS1 fusion lung cancer treatment". Internal CTA
 * into /studio pre-loading the ROS1 kinase domain + G2032R so a reader
 * can see the solvent-front pocket for themselves.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "ros1-fusion-nsclc-tki-landscape",
  title: "ROS1 fusion NSCLC: the TKI landscape in 2026",
  description:
    "A field guide to the four approved ROS1 inhibitors, why G2032R breaks most of them, and how the newest drugs were built to survive the solvent-front mutation.",
  date: "2026-05-20",
  author: "Liganx team",
  tags: ["ros1", "oncology", "nsclc", "resistance"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        ROS1 fusions drive about 1-2% of non-small-cell lung cancers — a
        small slice in percentage terms, but a large absolute population
        and one of the most cleanly druggable oncogenes in thoracic
        oncology. The field now has four approved tyrosine kinase
        inhibitors, a dominant resistance mutation that defines the whole
        sequencing strategy, and a newest generation engineered
        specifically to keep working after the others fail. Here is where
        ROS1 actually stands in 2026.
      </p>

      <h2>Why ROS1 is so druggable</h2>
      <p>
        ROS1 is a receptor tyrosine kinase that is normally silent in adult
        tissue. In a subset of NSCLC, a chromosomal rearrangement fuses the
        ROS1 kinase domain to a partner gene (CD74, SLC34A2, EZR, and
        others), producing a constitutively active fusion protein that the
        tumor depends on. Because the ATP pocket of ROS1 is structurally
        close to that of ALK, the first drugs to hit it were repurposed ALK
        inhibitors. The dependency is strong and the off-target burden in
        normal tissue is low, which is why response rates here are among the
        highest in targeted oncology.
      </p>

      <h2>The four approved inhibitors</h2>
      <ul>
        <li>
          <strong>Crizotinib (Xalkori)</strong> — Pfizer, FDA approved for
          ROS1 NSCLC in March 2016. The original ROS1 drug, borrowed from
          its ALK and MET activity. Objective responses around 70% in the
          PROFILE 1001 cohort, but weak CNS penetration, so brain
          progression is common and the drug has no activity against the
          key solvent-front resistance mutation.
        </li>
        <li>
          <strong>Entrectinib (Rozlytrek)</strong> — Genentech/Roche, FDA
          approved August 2019. Designed to cross the blood-brain barrier,
          so it controls CNS disease far better than crizotinib. Response
          rates up to roughly 80% in treatment-naive patients, but like
          crizotinib it is defeated by G2032R.
        </li>
        <li>
          <strong>Repotrectinib (Augtyro)</strong> — Bristol Myers Squibb,
          FDA approved November 2023. A compact macrocycle built to fit
          past the solvent-front residue. In the TRIDENT-1 trial it produced
          the longest median progression-free survival of the class in
          TKI-naive patients (about 35.7 months) and, critically, drove
          responses in roughly 59% of patients carrying the G2032R mutation.
        </li>
        <li>
          <strong>Taletrectinib (Ibtrozi)</strong> — Nuvation Bio, FDA
          approved June 2025. A next-generation selective ROS1 inhibitor
          with strong CNS activity and preclinical and clinical activity
          against both wild-type ROS1 and the G2032R mutant, positioning it
          alongside repotrectinib as a drug that survives solvent-front
          resistance.
        </li>
      </ul>

      <h2>G2032R: the mutation that defines the strategy</h2>
      <p>
        When tumors progress on crizotinib or entrectinib, secondary ROS1
        kinase-domain mutations show up in roughly 30-60% of cases. The
        single most common is <strong>G2032R</strong>, a solvent-front
        substitution that swaps a small glycine for a bulky, charged
        arginine right at the edge of the ATP pocket. That arginine sticks
        out into the space where crizotinib and entrectinib need room to
        sit, creating a steric and electrostatic clash that collapses their
        binding affinity. It is the direct ROS1 analogue of ALK G1202R and
        TRK G595R — same solvent-front position, same failure mode.
      </p>
      <p>
        Other resistance mutations recur but are rarer: D2033N (also
        solvent-front), L2026M (the gatekeeper), L2086F, and S1986F. The
        clinical logic of the whole field follows from this: the
        first-generation drugs control disease until G2032R emerges, and
        the newer drugs (repotrectinib, taletrectinib) exist precisely
        because they were shaped to keep binding when that arginine is in
        the way. A third wave, including zidesamtinib, is in registration
        aiming at even broader resistance coverage.
      </p>

      <h2>What this means for sequencing</h2>
      <p>
        The practical question for 2026 is no longer &ldquo;which TKI
        works&rdquo; but &ldquo;which TKI first.&rdquo; A front-line drug with
        deep CNS penetration and built-in G2032R coverage compresses the
        whole treatment ladder into a single agent for longer. Repotrectinib
        and taletrectinib are reshaping that decision, and resistance
        profiling at progression — to distinguish an on-target solvent-front
        mutation from a bypass-track pivot — is becoming standard of care.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The clash is something you can see directly. The ROS1 kinase domain
        bound to crizotinib is deposited as{" "}
        <a
          href="https://www.rcsb.org/structure/3ZBF"
          target="_blank"
          rel="noreferrer noopener"
        >
          3ZBF
        </a>
        . Dock a first-generation inhibitor against wild-type ROS1, then
        introduce the G2032R substitution and re-dock: the bulky arginine
        side chain occupies the solvent-front edge of the pocket and the
        predicted binding score degrades, while a macrocyclic next-generation
        compound holds up far better.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick ROS1 from the target catalog with G2032R from the mutation
        chips to dock against this structure. Liganx renders the wild-type
        and mutant receptors side by side, so the selectivity story shows up
        as a score gap rather than a hand-wave.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and set up
        for exactly this kind of resistance question. If you want to try
        molecular docking on a ROS1 solvent-front mutant without a local
        install, that is the fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Awad MM, et al. <em>Acquired resistance to crizotinib from a
          mutation in CD74-ROS1.</em> N Engl J Med 368, 2395-2401 (2013).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1215530"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1215530
          </a>
        </li>
        <li>
          Drilon A, et al. <em>Repotrectinib in ROS1 fusion-positive
          non-small-cell lung cancer.</em> N Engl J Med 390, 118-131 (2024).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2302299"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2302299
          </a>
        </li>
        <li>
          U.S. Food and Drug Administration. <em>FDA approves taletrectinib
          for ROS1-positive non-small cell lung cancer.</em> (June 11, 2025).{" "}
          <a
            href="https://www.fda.gov/drugs/resources-information-approved-drugs/fda-approves-taletrectinib-ros1-positive-non-small-cell-lung-cancer"
            target="_blank"
            rel="noreferrer noopener"
          >
            fda.gov
          </a>
        </li>
      </ul>
    </>
  );
}
