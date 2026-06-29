/**
 * Post: EGFR exon 19 deletions - the other classic EGFR driver
 *
 * SEO target: "EGFR exon 19 deletion", "ex19del NSCLC", "ELREA deletion",
 * "E746_A750del osimertinib". Internal CTA into /studio to dock against
 * EGFR ex19del. Cross-links to the existing L858R and C797S posts.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "egfr-exon-19-deletions-nsclc",
  title: "EGFR exon 19 deletions: the deletion that drugs love",
  description:
    "Exon 19 deletions are the most common EGFR driver in lung cancer and the most TKI-sensitive. Here is how losing four residues locks the kinase on, and why ex19del responds better than L858R.",
  date: "2026-05-31",
  author: "Liganx team",
  tags: ["egfr", "exon-19-deletion", "nsclc", "kinase", "targeted-therapy"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        If you sequence a hundred EGFR-mutant lung tumors, the single most
        common thing you will find is not a point mutation at all. It is a
        short, in-frame deletion in exon 19 &mdash; usually the loss of the
        residues <strong>LREA</strong> at positions 747&ndash;750. Exon 19
        deletions account for roughly 45&ndash;50% of EGFR-driven non-small
        cell lung cancer, edging out the exon 21 point mutation{" "}
        <Link
          to="/blog/egfr-l858r-activating-mutation-nsclc"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          L858R
        </Link>
        . They are also, drug for drug, the most inhibitor-sensitive class of
        EGFR mutations we know how to treat.
      </p>

      <h2>What &ldquo;exon 19 deletion&rdquo; actually means</h2>
      <p>
        Exon 19 encodes part of the N-lobe of the EGFR kinase domain, including
        the short loop that connects the &beta;3 strand to the regulatory
        &alpha;C helix. The deletions cluster around residues 746&ndash;753 and
        remove three to seven amino acids while keeping the reading frame intact.
        The textbook variant is{" "}
        <strong>&Delta;E746_A750 (the ELREA deletion)</strong>, but ex19del is
        really a family: E746_A750del, L747_P753delinsS, E746_S752delinsV, and a
        dozen rarer cousins. They are reported together because they converge on
        the same structural trick.
      </p>

      <h2>Why losing residues turns the kinase on</h2>
      <p>
        Counterintuitively, deleting amino acids makes the kinase{" "}
        <em>more</em> active. The &beta;3&ndash;&alpha;C loop normally has slack
        in it, and that flexibility lets the &alpha;C helix swing outward into
        the inactive &ldquo;&alpha;C-out&rdquo; conformation where catalysis is
        switched off. Shortening the loop pulls the helix inward and rigidifies
        it in the active &ldquo;&alpha;C-in&rdquo; position. In that state the
        catalytic K745&ndash;E762 salt bridge is preformed, ATP binds more
        favorably than in wild-type, and the kinase signals without waiting for
        the receptor to dimerize at the cell surface. Molecular dynamics studies
        of the &Delta;ELREA mutant show exactly this: stabilization of the
        &alpha;C-in state and a more favorable computed ATP-binding free energy
        than wild-type EGFR.
      </p>
      <p>
        That same conformational bias is why inhibitors designed to recognize
        the active kinase tend to grip ex19del tightly. The mutation does not
        reshape the ATP pocket so much as it pre-pays the energetic cost of
        getting into the conformation those drugs prefer.
      </p>

      <h2>The drugs that hit it</h2>
      <ul>
        <li>
          <strong>Gefitinib</strong> and <strong>erlotinib</strong> &mdash;
          first-generation reversible inhibitors. Ex19del tumors were where
          these drugs first proved that EGFR-mutant lung cancer is its own
          disease, with response rates well above what chemotherapy delivered.
        </li>
        <li>
          <strong>Afatinib</strong> and <strong>dacomitinib</strong> &mdash;
          second-generation irreversible binders that form a covalent bond to
          Cys797. Afatinib carries a specific approval signal in the common
          ex19del/L858R population.
        </li>
        <li>
          <strong>Osimertinib</strong> (Tagrisso) &mdash; third-generation,
          mutant-selective, and now the first-line standard of care for both
          common activating mutations.
        </li>
      </ul>

      <h2>What the trial data actually show</h2>
      <p>
        The pivotal FLAURA trial randomized untreated patients with common EGFR
        mutations to osimertinib versus a first-generation TKI. Across the whole
        population osimertinib nearly doubled median progression-free survival
        (18.9 versus 10.2 months). The split by mutation type is the part worth
        remembering: the exon 19 deletion subgroup did consistently better than
        the L858R subgroup, with median overall survival in ex19del patients
        landing north of 40 months. The structural intuition lines up with the
        clinic &mdash; a driver that is locked into the active, drug-preferred
        conformation is a driver you can suppress for longer.
      </p>

      <h2>Where resistance goes next</h2>
      <p>
        Ex19del does not stay alone forever. On osimertinib the dominant
        on-target escape is{" "}
        <Link
          to="/blog/egfr-c797s-osimertinib-resistance-fourth-generation"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          C797S
        </Link>
        , which removes the cysteine the covalent warhead depends on, and the
        order in which C797S and{" "}
        <Link
          to="/blog/t790m-osimertinib-resistance"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          T790M
        </Link>{" "}
        appear (cis versus trans) decides whether any current EGFR inhibitor can
        still reach the target. Off-target bypass through MET amplification is
        the other common exit. Understanding the ex19del starting point is what
        makes that resistance ladder legible.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick EGFR with an exon 19 deletion to dock candidate inhibitors
        against the activated kinase. Because ex19del biases the conformational
        equilibrium toward the active &alpha;C-in state, it is a good case for
        comparing poses against wild-type and L858R structures side by side.
        Liganx brings molecular docking online into the browser, so you can run
        molecular docking against ex19del and read the binding-mode differences
        without installing anything.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          <em>Structural characterization of EGFR exon 19 deletion mutation
          using molecular dynamics simulation.</em> PLoS One 14, e0222814
          (2019).{" "}
          <a
            href="https://doi.org/10.1371/journal.pone.0222814"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1371/journal.pone.0222814
          </a>
        </li>
        <li>
          Soria JC, Ohe Y, Vansteenkiste J, et al. <em>Osimertinib in untreated
          EGFR-mutated advanced non-small-cell lung cancer.</em> N Engl J Med
          378, 113&ndash;125 (2018).{" "}
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
          NSCLC.</em> N Engl J Med 382, 41&ndash;50 (2020).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1913662"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1913662
          </a>
        </li>
      </ul>
    </>
  );
}
