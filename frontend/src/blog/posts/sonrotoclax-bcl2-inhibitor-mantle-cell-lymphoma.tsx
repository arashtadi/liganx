/**
 * Post: Sonrotoclax - the first new BCL-2 inhibitor in a decade
 *
 * SEO target: "sonrotoclax", "Beqalzi", "BCL-2 inhibitor", "BH3 mimetic",
 * "mantle cell lymphoma BTK resistance", "venetoclax G101V". News/clinical
 * commentary on the May 13, 2026 FDA accelerated approval. Internal CTA
 * bridges into /studio via BTK + C481S, the resistance step that precedes
 * BCL-2 therapy in the MCL ladder (BCL-2 is not yet in the catalog).
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "sonrotoclax-bcl2-inhibitor-mantle-cell-lymphoma",
  title: "Sonrotoclax: the first new BCL-2 inhibitor in a decade",
  description:
    "The FDA just approved sonrotoclax for relapsed mantle cell lymphoma, the first new BH3-mimetic since venetoclax. What it hits, and why molecular docking cares.",
  date: "2026-05-24",
  author: "Liganx team",
  tags: ["bcl-2", "mantle-cell-lymphoma", "bh3-mimetic", "fda-approval"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        On May 13, 2026 the FDA granted accelerated approval to sonrotoclax
        (Beqalzi, BeOne Medicines) for adults with relapsed or refractory
        mantle cell lymphoma after at least two prior lines, including a
        Bruton&rsquo;s tyrosine kinase (BTK) inhibitor. It is the first new
        BCL-2 inhibitor the agency has approved in roughly a decade &mdash;
        venetoclax, the only other one, was approved in 2016. For a target
        class that spent thirty years being called undruggable, a second
        approved molecule is a genuine event.
      </p>

      <h2>What BCL-2 does, and why blocking it kills cancer cells</h2>
      <p>
        BCL-2 is an anti-apoptotic protein. It sits on the outer mitochondrial
        membrane and acts as a brake on the intrinsic (mitochondrial) apoptosis
        pathway. It does this by binding and sequestering pro-apoptotic
        partners &mdash; the BH3-only sensors like BIM and BID, and the
        pore-forming effectors BAX and BAK &mdash; through a hydrophobic
        surface groove that recognizes their BH3 alpha-helix. As long as BCL-2
        keeps those partners tied up, the cell cannot trigger the mitochondrial
        outer-membrane permeabilization step that commits it to death.
      </p>
      <p>
        Many B-cell malignancies survive precisely because they overexpress
        BCL-2 and lean on it to stay alive &mdash; they are, in the field&rsquo;s
        phrase, &ldquo;addicted&rdquo; to it. A drug that plugs the BH3-binding
        groove displaces the sequestered pro-apoptotic proteins, and the cell,
        already primed to die, finally does. Molecules that work this way are
        called <strong>BH3 mimetics</strong>: they imitate the BH3 helix that
        the groove evolved to bind.
      </p>

      <h2>From venetoclax to sonrotoclax</h2>
      <p>
        Venetoclax (ABT-199) was the proof of concept. Souers et al. (2013)
        described a reverse-engineered, BCL-2-selective BH3 mimetic that drove
        tumor regression while sparing platelets &mdash; platelets depend on
        the related protein BCL-xL, and the earlier dual BCL-2/BCL-xL compound
        navitoclax had caused dose-limiting thrombocytopenia by hitting it.
        Selectivity for BCL-2 over BCL-xL was the whole design problem, and
        venetoclax solved it well enough to reach the clinic.
      </p>
      <ul>
        <li>
          <strong>Venetoclax (Venclexta)</strong> &mdash; AbbVie/Genentech,
          FDA approved 2016. First-in-class oral BCL-2 inhibitor; backbone of
          CLL and AML regimens.
        </li>
        <li>
          <strong>Sonrotoclax (Beqalzi, BGB-11417)</strong> &mdash; BeOne
          Medicines, FDA accelerated approval May 13, 2026. A second-generation
          BCL-2 inhibitor designed for higher potency and a cleaner selectivity
          profile, now the first BCL-2 agent approved specifically in mantle
          cell lymphoma.
        </li>
      </ul>

      <h2>The trial behind the approval</h2>
      <p>
        Approval rested on BGB-11417-201 (NCT05471843), a single-arm,
        multicenter study of 103 adults with relapsed or refractory MCL who had
        already received anti-CD20-based therapy and a BTK inhibitor. The
        overall response rate was 52% (95% CI 42&ndash;62%), responses came
        fast at a median 1.9 months, and the median duration of response was
        15.8 months. As with most single-arm accelerated approvals, the readout
        is response rate rather than survival; continued approval is expected to
        hinge on confirmatory data. Like venetoclax, sonrotoclax carries a
        multi-week dose ramp-up to manage the risk of tumor lysis syndrome,
        because killing a large bulk of lymphoma cells quickly floods the blood
        with their contents.
      </p>

      <h2>Why this matters for the MCL treatment ladder</h2>
      <p>
        Mantle cell lymphoma is an aggressive B-cell non-Hodgkin lymphoma driven
        by the t(11;14) translocation that overexpresses cyclin D1. Covalent BTK
        inhibitors reshaped its treatment, but patients progress, and once a BTK
        inhibitor fails, options have been thin. Sonrotoclax slots in
        specifically <em>after</em> BTK-inhibitor failure, attacking survival
        through a completely different node &mdash; apoptosis rather than B-cell
        receptor signaling. That mechanistic orthogonality is the point: a tumor
        that has learned to live without functional BTK signaling has not
        necessarily lost its dependence on BCL-2.
      </p>

      <h2>The resistance question docking can probe</h2>
      <p>
        BH3-mimetic resistance has a structural face. In venetoclax-treated CLL,
        Blombery et al. (2019) identified the recurrent BCL2 Gly101Val (G101V)
        mutation in patients progressing on the drug: the valine sits in the
        BH3-binding groove and reduces venetoclax binding without abolishing the
        protein&rsquo;s normal job. It is the same story Liganx readers will know
        from kinases &mdash; a single residue swap in the binding pocket that
        costs the drug a fold or two of affinity while sparing the target&rsquo;s
        function. Whether a second-generation binder like sonrotoclax holds its
        grip against groove mutations is exactly the kind of wild-type-versus-
        mutant comparison that matters more than any single absolute score.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        BCL-2 is not yet in the Liganx target catalog, but the rung
        <em> directly before</em> sonrotoclax in the MCL ladder is.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick BTK with the C481S mutation to dock the covalent-inhibitor
        resistance that pushes MCL patients toward BCL-2 therapy in the first
        place. Dock a covalent BTK inhibitor against wild-type and C481S BTK and
        watch the score collapse when the catalytic cysteine that anchors the
        warhead is gone &mdash; the molecular reason those patients run out of
        BTK options and need a drug like sonrotoclax next.
      </p>
      <p>
        Liganx is molecular docking online: a free, browser-based platform with
        no install and no local GPU required. Using molecular docking to watch a
        resistance mutation rewrite a binding pocket is the fastest way to build
        intuition for why the treatment ladder is shaped the way it is.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          U.S. FDA. <em>FDA grants accelerated approval to sonrotoclax for
          relapsed or refractory mantle cell lymphoma.</em> (May 13, 2026).{" "}
          <a
            href="https://www.fda.gov/drugs/resources-information-approved-drugs/fda-grants-accelerated-approval-sonrotoclax-relapsed-or-refractory-mantle-cell-lymphoma"
            target="_blank"
            rel="noreferrer noopener"
          >
            fda.gov
          </a>
        </li>
        <li>
          Souers AJ, et al. <em>ABT-199, a potent and selective BCL-2 inhibitor,
          achieves antitumor activity while sparing platelets.</em> Nat Med 19,
          202&ndash;208 (2013).{" "}
          <a
            href="https://doi.org/10.1038/nm.3048"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nm.3048
          </a>
        </li>
        <li>
          Blombery P, et al. <em>Acquisition of the Recurrent Gly101Val Mutation
          in BCL2 Confers Resistance to Venetoclax in Patients with Progressive
          Chronic Lymphocytic Leukemia.</em> Cancer Discov 9, 342&ndash;353
          (2019).{" "}
          <a
            href="https://doi.org/10.1158/2159-8290.CD-18-1119"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2159-8290.CD-18-1119
          </a>
        </li>
      </ul>
    </>
  );
}
