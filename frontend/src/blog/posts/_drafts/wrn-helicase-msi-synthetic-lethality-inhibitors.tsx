/**
 * Post: WRN helicase — the second synthetic-lethal target after PARP
 *
 * SEO target: "WRN inhibitor", "WRN helicase MSI", "synthetic lethality
 * MSI-H colorectal cancer", "HRO761", "VVD-214". Internal CTA into
 * /studio for allosteric-pocket docking against a non-kinase target.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "wrn-helicase-msi-synthetic-lethality-inhibitors",
  title: "WRN helicase: the synthetic-lethal target after PARP",
  description:
    "Why microsatellite-unstable tumours cannot survive without WRN, how two clinical-stage inhibitors lock the helicase from allosteric pockets, and where resistance is already showing up.",
  date: "2026-08-02",
  author: "Liganx team",
  tags: ["wrn", "synthetic-lethality", "msi-h", "colorectal-cancer", "allosteric"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        PARP inhibitors proved that a DNA-repair defect in a tumour can be
        turned into a drug target. For a decade the field looked for a
        second example with the same clean genetic logic. WRN is the best
        candidate anyone has found: a RecQ helicase that microsatellite-unstable
        cells cannot live without, and that microsatellite-stable cells barely
        need at all. Two inhibitors are now in the clinic, both of them
        allosteric, and the first on-target resistance mutations have already
        been catalogued.
      </p>

      <h2>The genetic case, from three screens</h2>
      <p>
        Chan and colleagues queried large-scale CRISPR and RNAi dependency
        data across cancer cell lines and found that WRN was selectively
        essential in models with microsatellite instability (MSI) and
        dispensable in microsatellite-stable ones. Knocking WRN down produced
        double-strand breaks, cell-cycle arrest, and apoptosis only in the
        MSI lines. Critically, the dependency tracked the helicase activity,
        not the exonuclease activity of the protein: an exonuclease-dead WRN
        rescued the phenotype, a helicase-dead one did not. That single
        observation is what made WRN a small-molecule target rather than a
        degrader-only problem.
      </p>
      <p>
        MSI arises from defective mismatch repair, which is why the biomarker
        population is already well defined in oncology: roughly 15 percent of
        colorectal cancers, plus meaningful slices of endometrial, gastric,
        and small-bowel disease. These are the same tumours selected for
        pembrolizumab under the dMMR/MSI-H tumour-agnostic label, which means
        the commercial question is squarely about patients who progress on
        or never respond to checkpoint blockade.
      </p>

      <h2>What WRN is actually doing in an MSI cell</h2>
      <p>
        The mechanism took another year to resolve. van Wietmarschen and
        colleagues showed that TA-dinucleotide repeats become wildly unstable
        in mismatch-repair-deficient cells and undergo large-scale expansions,
        far bigger than the one- and two-base indels that MSI panels usually
        score. Those expanded TA tracts fold into non-B DNA secondary
        structures that stall replication forks and light up the ATR
        checkpoint. WRN is the enzyme that unwinds them.
      </p>
      <p>
        Remove WRN and the stalled structures become substrates for the MUS81
        nuclease, which cuts them, producing chromosome shattering on a scale
        that is straightforwardly lethal. The elegant part for drug developers
        is that the dependency is a mechanical consequence of repeat burden,
        which suggests TA-repeat expansion load, rather than MSI status per se,
        may end up being the sharper patient-selection biomarker.
      </p>

      <h2>Two clinical-stage inhibitors, two allosteric strategies</h2>
      <p>
        Helicases have historically been considered undruggable: the ATP site
        is shallow and highly conserved across the RecQ family, and the DNA
        interface is a large charged surface. Both clinical compounds got
        around this by not touching either.
      </p>
      <ul>
        <li>
          <strong>HRO761</strong> (Novartis) is a potent, selective,
          non-covalent allosteric inhibitor that binds at the interface
          between the D1 and D2 helicase domains, locking WRN in an inactive
          conformation. Pharmacological inhibition reproduced the genetic
          phenotype: DNA damage and growth inhibition selectively in MSI
          cells, and independent of p53 status. It also drives WRN degradation
          in MSI cells but not in microsatellite-stable ones. Oral dosing
          produced dose-dependent DNA damage and tumour growth inhibition in
          cell-line and patient-derived xenografts. The phase 1 trial
          (NCT05838768) in MSI colorectal cancer and other MSI solid tumours
          is ongoing.
        </li>
        <li>
          <strong>VVD-214 / RO7589831</strong> (Vividion, partnered with
          Roche) came out of a chemoproteomics screen rather than a
          structure-based campaign. It covalently engages Cys727 in a
          different allosteric pocket and blocks DNA unwinding. The
          optimisation story is a good case study in warhead tuning: the team
          balanced intrinsic reactivity of a vinyl sulfone against potency and
          metabolic stability, largely through C2 substitution on the
          pyrimidine core. VVD-214 induced tumour regression in MSI-H
          colorectal models and is in a Roche-sponsored first-in-human study.
        </li>
      </ul>
      <p>
        Two independent allosteric pockets on the same enzyme, found by two
        completely different discovery strategies, is a useful reminder that
        the pocket you can find depends on the assay you run. A conventional
        ATP-competitive campaign would likely have produced neither compound.
      </p>

      <h2>Resistance arrived early</h2>
      <p>
        A 2026 report in Molecular Cancer Therapeutics describes MSI cell
        lines acquiring on-target resistance both in vitro and in vivo, with
        sequencing showing clustered mutations inside the helicase domain.
        Some of them sit directly in the inhibitor-binding region; others
        appear to alter the protein conformation the inhibitor needs in order
        to engage at all. That second class is the more interesting problem,
        because it is exactly the failure mode allosteric drugs are supposed
        to be prone to: you are not competing with a substrate, you are
        stabilising a state, and a mutation that destabilises that state costs
        the tumour very little.
      </p>
      <p>
        The practical implication for anyone modelling this target is that
        docking a candidate into a single wild-type WRN conformation is not
        going to tell you much. The relevant question is how the pose and the
        score change across the resistance panel.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        WRN is a good test case for the parts of a modelling workflow that
        kinase work lets you skip. The binding site is a domain interface
        rather than a well-formed cleft, so pocket definition matters more
        than usual, and the conformational state you dock into is effectively
        an assumption you are making about the mechanism.
      </p>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and set up an ensemble run across multiple WRN conformations rather
        than a single receptor, then compare each candidate against the
        reported helicase-domain resistance variants and read the
        &Delta;&Delta; rather than the raw score. Our write-ups on{" "}
        <Link
          to="/blog/cryptic-allosteric-pockets-docking"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          cryptic and allosteric pockets
        </Link>
        ,{" "}
        <Link
          to="/blog/ensemble-docking-multiple-receptor-conformations"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          ensemble docking
        </Link>
        , and{" "}
        <Link
          to="/blog/covalent-docking-how-it-works"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          covalent docking
        </Link>{" "}
        cover the protocol details, and the covalent piece matters here
        because one of the two clinical compounds is a Cys727 binder.
      </p>
      <p>
        Liganx runs molecular docking online in the browser, so you can build
        a mutant-versus-wild-type molecular docking comparison for a
        non-kinase target like WRN without standing up a local toolchain
        first.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Chan EM, Shibue T, McFarland JM, et al. <em>WRN helicase is a
          synthetic lethal target in microsatellite unstable cancers.</em>{" "}
          Nature 568, 551-556 (2019).{" "}
          <a
            href="https://doi.org/10.1038/s41586-019-1102-x"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41586-019-1102-x
          </a>
        </li>
        <li>
          van Wietmarschen N, Sridharan S, Nathan WJ, et al. <em>Repeat
          expansions confer WRN dependence in microsatellite-unstable
          cancers.</em> Nature 586, 292-298 (2020).{" "}
          <a
            href="https://doi.org/10.1038/s41586-020-2769-8"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41586-020-2769-8
          </a>
        </li>
        <li>
          Ferretti S, Hamon J, de Kanter R, et al. <em>Discovery of WRN
          inhibitor HRO761 with synthetic lethality in MSI cancers.</em>{" "}
          Nature 629, 443-449 (2024).{" "}
          <a
            href="https://doi.org/10.1038/s41586-024-07350-y"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41586-024-07350-y
          </a>
        </li>
        <li>
          Kikuchi S, Green JC, Rogness DC, et al. <em>Identification of
          VVD-214/RO7589831, a clinical-stage, covalent allosteric inhibitor
          of WRN helicase for the treatment of MSI-high cancers.</em> J Med
          Chem 68, 25912-25938 (2025).{" "}
          <a
            href="https://doi.org/10.1021/acs.jmedchem.5c01805"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jmedchem.5c01805
          </a>
        </li>
        <li>
          <em>Microsatellite instable cancer cells acquire on-target
          resistance mutations to WRN helicase inhibitors.</em> Mol Cancer
          Ther (2026).{" "}
          <a
            href="https://doi.org/10.1158/1535-7163.MCT-25-0666"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/1535-7163.MCT-25-0666
          </a>
        </li>
        <li>
          ClinicalTrials.gov.{" "}
          <a
            href="https://clinicaltrials.gov/study/NCT05838768"
            target="_blank"
            rel="noreferrer noopener"
          >
            NCT05838768 (HRO761 phase 1, MSI colorectal and other MSI solid
            tumours)
          </a>
        </li>
      </ul>
    </>
  );
}
