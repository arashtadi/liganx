/**
 * Post: ALK L1196M, the gatekeeper mutation that broke crizotinib.
 *
 * SEO target: long-tail "ALK L1196M mutation", "crizotinib resistance ALK",
 * "lorlatinib ALK gatekeeper". Internal CTA into /studio with ALK + L1196M
 * so the reader can dock crizotinib and lorlatinib against WT and the
 * gatekeeper mutant.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "alk-l1196m-gatekeeper-crizotinib-resistance",
  title: "ALK L1196M: the gatekeeper mutation and the lorlatinib answer",
  description:
    "L1196M was the first crizotinib-resistant ALK mutation found. Here is the gatekeeper mechanism, the drugs that overcome it, and why compound mutants are the real wall.",
  date: "2026-05-25",
  author: "Liganx team",
  tags: ["alk", "nsclc", "resistance", "mutation-deep-dive"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        ALK-rearranged lung cancer is one of oncology&rsquo;s cleanest
        targeted-therapy stories, and L1196M is where the story first hit
        trouble. It is the gatekeeper substitution, the ALK equivalent of
        EGFR T790M, and it is the textbook example of how a single bulky
        sidechain can blunt a drug without ever touching the catalytic
        machinery. Worth knowing in detail because every ALK inhibitor
        since has been judged partly on whether it still works once L1196M
        shows up.
      </p>

      <h2>What L1196M is and why the position matters</h2>
      <p>
        EML4-ALK fusions drive roughly 3-5% of non-small cell lung cancers,
        most often in younger never-smokers. Crizotinib was the first
        approved ALK inhibitor and produced dramatic early responses, but
        relapse was near-universal within a year or two. When Choi and
        colleagues sequenced a relapsed tumor (NEJM, 2010), they found a
        leucine-to-methionine substitution at residue 1196 in the ATP
        pocket.
      </p>
      <p>
        Position 1196 is the <strong>gatekeeper</strong> residue: it sits at
        the entrance to a hydrophobic back pocket and controls how deep an
        ATP-competitive inhibitor can reach. Swap the smaller leucine for a
        bulkier methionine and the back pocket shrinks. Crizotinib, which
        relies on filling that region, gets sterically crowded out. The
        kinase still binds ATP fine, so the cancer keeps signaling; the drug
        is simply the loser in the competition. This is the same
        steric-plus-affinity logic that governs EGFR T790M, which is why the
        two mutations are taught as a pair.
      </p>

      <h2>The inhibitors and how each fares against L1196M</h2>
      <ul>
        <li>
          <strong>Crizotinib</strong> (first generation, approved 2011) -
          potent against wild-type EML4-ALK, but L1196M is one of the
          mutations that drives acquired resistance. It also has poor CNS
          penetration, so brain progression was common.
        </li>
        <li>
          <strong>Ceritinib, alectinib, brigatinib</strong> (second
          generation) - designed to retain activity against many
          crizotinib-resistant mutants including L1196M, and with far better
          brain coverage. Alectinib became a standard first-line option on
          the strength of CNS activity and durable responses.
        </li>
        <li>
          <strong>Lorlatinib</strong> (third generation) - a compact,
          macrocyclic inhibitor engineered specifically to fit past the
          gatekeeper and to cross the blood-brain barrier. In preclinical
          work, lorlatinib suppressed single-mutant L1196M cells potently and
          no resistant clones emerged at 300-600 nM in the original
          characterization.
        </li>
      </ul>

      <h2>The real wall: compound mutations</h2>
      <p>
        Single L1196M is a solved problem for the later drugs. The harder
        clinical reality is <strong>compound mutations</strong> - two
        resistance changes on the same allele, selected by sequential
        therapy. Yoda, Lin, Shaw and colleagues showed (Cancer Discovery,
        2018) that the G1202R/L1196M double mutant confers high-level
        lorlatinib resistance, with an IC50 around 1,116 nM versus roughly
        37 nM for G1202R alone and 18 nM for L1196M alone. The combination is
        far worse than the sum of its parts, because G1202R sits at the
        solvent front and L1196M guards the back pocket, so the drug is
        squeezed from both ends at once.
      </p>
      <p>
        This is the structural reason ALK is now a sequencing problem as much
        as a potency problem. The order in which you give the inhibitors
        shapes which compound mutants emerge, and some compound mutants have
        no approved drug that covers them.
      </p>

      <h2>What this means for your docking workflow</h2>
      <p>
        L1196M is an excellent stress test for a docking pipeline precisely
        because the resistance signal is geometric rather than dramatic. The
        kinase fold barely moves; what changes is the volume of the back
        pocket. A useful run docks the same ligand against wild-type and
        L1196M and watches the <strong>ΔΔ</strong> rather than any single
        absolute number. Crizotinib should degrade against L1196M while
        lorlatinib holds, and the compound G1202R/L1196M case should degrade
        further still. If your scoring function cannot separate those, the
        pose ranking is the place to look - re-score with a CNN-based scorer
        and confirm the methionine sidechain is actually clashing in the
        crizotinib pose.
      </p>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick ALK from the target catalog. Use the mutation chips to add
        L1196M and dock crizotinib and lorlatinib side by side against
        wild-type and the gatekeeper mutant. You will see the gatekeeper
        story in a few cells: crizotinib loses ground on L1196M, lorlatinib
        holds.
      </p>
      <p>
        Liganx puts molecular docking online and free in the browser, so
        running molecular docking across ALK wild-type, L1196M, and compound
        mutants takes a couple of clicks rather than a cluster job.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Choi YL, et al. <em>EML4-ALK mutations in lung cancer that confer
          resistance to ALK inhibitors.</em> N Engl J Med 363, 1734-1739
          (2010).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1007478"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1007478
          </a>
        </li>
        <li>
          Yoda S, Lin JJ, Lawrence MS, et al. <em>Sequential ALK inhibitors
          can select for lorlatinib-resistant compound ALK mutations in
          ALK-positive lung cancer.</em> Cancer Discov 8, 714-729 (2018).{" "}
          <a
            href="https://doi.org/10.1158/2159-8290.CD-17-1256"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2159-8290.CD-17-1256
          </a>
        </li>
        <li>
          Shaw AT, et al. <em>ALK resistance mutations and efficacy of
          lorlatinib in advanced anaplastic lymphoma kinase-positive
          non-small-cell lung cancer.</em> J Clin Oncol 37, 1370-1379
          (2019).{" "}
          <a
            href="https://doi.org/10.1200/JCO.18.02236"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1200/JCO.18.02236
          </a>
        </li>
      </ul>
    </>
  );
}
