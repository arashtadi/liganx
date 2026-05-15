/**
 * Post: ALK G1202R - the solvent-front mutation that resets the ladder
 *
 * SEO target: "ALK G1202R", "lorlatinib resistance", "solvent front
 * mutation ALK", "ALK inhibitor resistance NSCLC". Internal CTA into
 * /studio with ALK + G1202R preselected so a reader can see the
 * solvent-front clash for themselves.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "alk-g1202r-solvent-front-resistance",
  title: "ALK G1202R: the solvent-front mutation that resets the ladder",
  description:
    "Why one ALK mutation knocks out crizotinib, ceritinib, alectinib and brigatinib at once, why lorlatinib still works, and what comes after it.",
  date: "2026-05-15",
  author: "Liganx team",
  tags: ["alk", "nsclc", "resistance", "mutation-deep-dive"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        ALK-rearranged NSCLC has the deepest targeted-therapy bench in lung
        cancer &mdash; five approved inhibitors across three generations. But
        progression is the rule, not the exception, and one mutation does more
        damage than any other. ALK G1202R sits in the solvent-front region of
        the kinase, and a single glycine&rarr;arginine swap is enough to knock
        out four of the five approved drugs at once. Here&rsquo;s why it
        happens, why lorlatinib is the exception, and what the resistance
        landscape looks like once lorlatinib fails too.
      </p>

      <h2>What G1202R actually does</h2>
      <p>
        Residue 1202 sits at the edge of the ATP pocket, in the
        solvent-exposed strip medicinal chemists call the &ldquo;solvent
        front.&rdquo; Glycine has no side chain at all. Arginine has a long,
        flexible, positively charged one. Drop that side chain into the solvent
        front and it sterically clashes with the part of an inhibitor that
        pokes out toward solvent &mdash; the part most ALK drugs were never
        designed to tuck away.
      </p>
      <p>
        Gainor et al. (2016) sequenced 103 repeat biopsies from ALK-positive
        patients progressing on ALK inhibitors. G1202R was rare after
        crizotinib but became the single most common on-target resistance
        mechanism after second-generation agents, accounting for roughly half
        of the on-target resistance seen with ceritinib, alectinib, and
        brigatinib. It is, quite specifically, the mutation those drugs select
        for.
      </p>

      <h2>The five-drug ladder</h2>
      <ul>
        <li>
          <strong>Crizotinib (Xalkori)</strong> &mdash; Pfizer, FDA approved
          2011. First-in-class, originally developed as a MET inhibitor. Modest
          CNS penetration, so the brain is a common first site of progression.
        </li>
        <li>
          <strong>Ceritinib (Zykadia)</strong> &mdash; Novartis, 2014.
          Second generation, more potent than crizotinib and active against
          several crizotinib-resistance mutations &mdash; but not G1202R.
        </li>
        <li>
          <strong>Alectinib (Alecensa)</strong> &mdash; Roche, 2015. Second
          generation with strong CNS penetration; became a first-line standard.
          Does not cover G1202R.
        </li>
        <li>
          <strong>Brigatinib (Alunbrig)</strong> &mdash; Takeda, 2017. Second
          generation with the broadest mutation coverage of the group, yet
          G1202R still escapes it.
        </li>
        <li>
          <strong>Lorlatinib (Lorbrena)</strong> &mdash; Pfizer, 2018. Third
          generation, macrocyclic, with a purpose-built compact scaffold and
          high CNS penetration. The one drug on this list that covers G1202R.
        </li>
      </ul>

      <h2>Why lorlatinib survives the solvent front</h2>
      <p>
        Lorlatinib was designed as a macrocycle: the molecule is cyclized,
        which makes it rigid and compact. A compact inhibitor presents less
        surface to the solvent front, so the bulky arginine side chain of
        G1202R has less to clash with. That structural bet paid off in the
        clinic. In the CROWN trial of first-line lorlatinib versus crizotinib,
        the 5-year update (Solomon et al., 2024) reported 5-year
        progression-free survival of 60% with lorlatinib versus 8% with
        crizotinib, with median PFS still not reached after five years of
        follow-up &mdash; the longest PFS reported for any single-agent
        targeted therapy in advanced NSCLC. Intracranial control was just as
        lopsided.
      </p>

      <h2>What comes after lorlatinib: compound mutations</h2>
      <p>
        Lorlatinib is broad, but it is not bottomless. When it fails, the
        resistance mechanism is usually a <strong>compound mutation</strong>:
        G1202R plus a second ALK mutation in cis, on the same allele. Yoda et
        al. (2018) showed that sequential use of ALK inhibitors actively
        selects for these lorlatinib-resistant compound mutations &mdash;
        G1202R/L1196M, C1156Y/L1198F, G1202R/S1206Y, and others &mdash; with
        roughly a third of patients treated through a full sequence of ALK
        inhibitors eventually developing them.
      </p>
      <p>
        That is the clinical lesson baked into CROWN. Leading with lorlatinib
        first-line, rather than climbing the ladder one rung at a time, may
        sidestep the sequential selection pressure that builds compound
        mutations in the first place. Fourth-generation ALK inhibitors aimed
        squarely at the compound-mutant kinase are in development, but for now
        the cleanest move against G1202R is to not give it the runway.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The solvent-front clash is something you can see directly.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick ALK from the target catalog with G1202R from the mutation
        chips. Liganx renders the wild-type and G1202R receptors side by side,
        so you can watch the arginine side chain crowd the solvent-front edge
        of the pocket. Dock a compact, macrocycle-like ligand and a bulkier
        extended one against both: the compact ligand should hold its score
        against the mutant while the extended one loses a kcal/mol or two. That
        &Delta;&Delta; between wild-type and mutant is the selectivity story,
        and it is the number that matters more than either absolute score.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Gainor JF, et al. <em>Molecular Mechanisms of Resistance to First-
          and Second-Generation ALK Inhibitors in ALK-Rearranged Lung Cancer.</em>{" "}
          Cancer Discov 6, 1118&ndash;1133 (2016).{" "}
          <a
            href="https://doi.org/10.1158/2159-8290.CD-16-0596"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2159-8290.CD-16-0596
          </a>
        </li>
        <li>
          Yoda S, et al. <em>Sequential ALK Inhibitors Can Select for
          Lorlatinib-Resistant Compound ALK Mutations in ALK-Positive Lung
          Cancer.</em> Cancer Discov 8, 714&ndash;729 (2018).{" "}
          <a
            href="https://pmc.ncbi.nlm.nih.gov/articles/PMC5984716/"
            target="_blank"
            rel="noreferrer noopener"
          >
            PMC5984716
          </a>
        </li>
        <li>
          Solomon BJ, et al. <em>Lorlatinib Versus Crizotinib in Patients With
          Advanced ALK-Positive Non-Small Cell Lung Cancer: 5-Year Outcomes
          From the Phase III CROWN Study.</em> J Clin Oncol 42, 3400&ndash;3409
          (2024).{" "}
          <a
            href="https://doi.org/10.1200/JCO.24.00581"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1200/JCO.24.00581
          </a>
        </li>
      </ul>
    </>
  );
}
