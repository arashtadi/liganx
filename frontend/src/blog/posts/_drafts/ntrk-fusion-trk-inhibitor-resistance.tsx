/**
 * Post: NTRK fusions and the TRK inhibitor resistance ladder
 *
 * SEO target: "NTRK fusion cancer", "TRK inhibitor resistance", "NTRK G595R
 * solvent front mutation", "larotrectinib entrectinib repotrectinib". Internal
 * CTA into /studio to dock against a TRK kinase with the G595R mutation.
 *
 * Theme: mutation-specific deep-dive.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "ntrk-fusion-trk-inhibitor-resistance",
  title: "NTRK fusions and the TRK inhibitor resistance ladder",
  description:
    "TRK fusions are tumor-agnostic drivers, and larotrectinib and entrectinib shrink most of them. Then G595R shows up at the solvent front. How repotrectinib was built to survive it.",
  date: "2026-07-03",
  author: "Liganx team",
  tags: ["ntrk", "resistance-mutation", "tumor-agnostic", "kinase-inhibitors"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        NTRK gene fusions are one of oncology's cleanest stories: a chromosomal
        rearrangement fuses the kinase domain of NTRK1, NTRK2, or NTRK3 to an
        unrelated 5' partner, the resulting TRK protein is constitutively
        active, and it drives the tumor almost single-handedly. They are rare
        but show up across dozens of histologies, from infantile fibrosarcoma
        to lung, thyroid, and salivary cancers. That tissue-agnostic biology is
        why the first two TRK inhibitors were approved as basket drugs. And,
        like every kinase target before it, TRK teaches the same lesson at
        relapse: knock out the pathway and the pocket mutates.
      </p>

      <h2>The first generation: high response rates across tissues</h2>
      <p>
        Two selective TRK inhibitors carry the frontline load, and both were
        approved on tumor-agnostic labels rather than by organ site.
      </p>
      <ul>
        <li>
          <strong>Larotrectinib</strong> (Vitrakvi) — a highly selective pan-TRK
          inhibitor, granted accelerated approval on November 26, 2018, the
          first drug ever approved purely for a genomic fusion regardless of
          cancer type. Overall response rates in TRK fusion-positive tumors ran
          around 75%, with responses in both adults and children.
        </li>
        <li>
          <strong>Entrectinib</strong> (Rozlytrek) — approved August 15, 2019,
          a multikinase inhibitor covering TRK, ROS1, and ALK. It was designed
          to cross the blood-brain barrier, giving it an edge in patients with
          CNS metastases, which are common in fusion-driven disease.
        </li>
      </ul>
      <p>
        Both are type-I inhibitors that bind the active, DFG-in conformation of
        the kinase. They are potent and well tolerated, but they share a
        structural vulnerability: parts of the molecule reach toward the rim of
        the ATP pocket, and that rim is exactly where resistance lands.
      </p>

      <h2>Where resistance hits: three positions, one pocket</h2>
      <p>
        On-target resistance to first-generation TRK inhibitors clusters at
        three recurrent hotspots in the kinase domain. Because NTRK1, NTRK2,
        and NTRK3 are paralogues, the same structural position carries a
        different residue number in each gene, but the mechanism is identical.
      </p>
      <ul>
        <li>
          <strong>Solvent-front mutations</strong> — NTRK1 G595R and its NTRK3
          paralogue G623R. A small glycine on the solvent-exposed edge of the
          nucleotide-binding loop becomes a bulky, charged arginine. It
          sterically collides with the part of larotrectinib or entrectinib
          that points into solvent, and binding collapses. This is the direct
          analogue of ROS1 G2032R and ALK G1202R, the same solvent-front
          failure mode seen across kinase targets.
        </li>
        <li>
          <strong>Gatekeeper mutations</strong> — NTRK1 F589L. The gatekeeper
          residue controls access to a hydrophobic pocket behind the ATP site;
          mutating it reshapes the back of the pocket and weakens inhibitor
          contacts.
        </li>
        <li>
          <strong>xDFG mutations</strong> — NTRK1 G667C (and G667A/S). Just
          before the DFG motif, this position shifts the activation loop and
          blunts type-I binding.
        </li>
      </ul>
      <p>
        In the clinical series that first mapped these, solvent-front
        substitutions were the single most common escape route detected at
        progression. As with every binding-site resistance problem, the
        catalytic engine is untouched, so the fusion keeps signaling while the
        drug is locked out. The fix has to be chemical.
      </p>

      <h2>The second generation: macrocycles that duck under the arginine</h2>
      <p>
        The design answer was to shrink the molecule and wrap it into a
        macrocycle compact enough to sit inside the pocket without protruding
        toward the solvent front, so an oversized arginine at 595 has nothing
        to clash with.
      </p>
      <ul>
        <li>
          <strong>Repotrectinib</strong> (Augtyro) — a compact macrocyclic
          TRK/ROS1/ALK inhibitor, granted accelerated approval for NTRK
          fusion-positive solid tumors on June 13, 2024, on the strength of the
          TRIDENT-1 trial. It retains activity against solvent-front, gatekeeper,
          and some compound mutations, and penetrates the CNS. In TKI-naive
          NTRK-fusion patients roughly 59% had a confirmed response, and among
          patients who had already progressed on a prior TRK TKI a meaningful
          fraction still responded, which is the whole point of a
          next-generation agent.
        </li>
        <li>
          <strong>Selitrectinib</strong> (LOXO-195) — an investigational
          selective macrocyclic TRK inhibitor built specifically to re-cover
          G595R and related mutations after larotrectinib failure. It validated
          the macrocycle strategy clinically even where it did not reach broad
          approval.
        </li>
      </ul>

      <h2>The mutation past the mutation</h2>
      <p>
        As with ROS1, solving the solvent front does not end the arms race.
        Compound mutations, where a second kinase-domain substitution stacks on
        top of the first, can defeat even the second-generation macrocycles,
        and next-generation candidates are already being profiled against them.
        The recurring theme across NTRK, ROS1, ALK, and BCR-ABL is that
        "next-generation" is always defined relative to a specific residue,
        never absolute, and the useful design question is always which mutation
        you are trying to fit around.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The solvent-front collision is geometric, and it is far more obvious in
        a pose than in a sequence alignment. Seeing the arginine side chain
        crowd the inhibitor is what makes the resistance mechanism click.
      </p>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick a TRK kinase with the G595R mutation applied, then dock
        larotrectinib and repotrectinib side by side. With molecular docking you
        can watch the bulky arginine crowd the larotrectinib solvent-front arm
        while the more compact repotrectinib macrocycle stays clear. Running
        this kind of molecular docking online, wild-type versus mutant and first
        drug versus next, is the fastest way to build intuition for why one TRK
        inhibitor keeps working and the other stops.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Drilon A, et al. <em>Efficacy of larotrectinib in TRK fusion-positive
          cancers in adults and children.</em> N Engl J Med 378, 731-739 (2018).{" "}
          <a
            href="https://www.nejm.org/doi/full/10.1056/NEJMoa1714448"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1714448
          </a>
        </li>
        <li>
          Drilon A, et al. <em>Repotrectinib in NTRK fusion-positive advanced
          solid tumors: a phase 1/2 trial.</em> Nat Med (2025).{" "}
          <a
            href="https://www.nature.com/articles/s41591-025-04079-7"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41591-025-04079-7
          </a>
        </li>
        <li>
          U.S. Food &amp; Drug Administration. <em>FDA grants accelerated
          approval to repotrectinib for adult and pediatric patients with NTRK
          gene fusion-positive solid tumors</em> (June 13, 2024).{" "}
          <a
            href="https://www.fda.gov/drugs/resources-information-approved-drugs/fda-grants-accelerated-approval-repotrectinib-adult-and-pediatric-patients-ntrk-gene-fusion-positive"
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
