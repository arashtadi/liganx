/**
 * Post: HER2 exon 20 insertions in NSCLC - zongertinib and the YVMA problem
 *
 * SEO target: "HER2 exon 20 insertion", "HER2 mutant NSCLC", "zongertinib",
 * "YVMA insertion". Internal CTA into /studio with HER2 (ERBB2) kinase
 * domain selected. DRAFT - awaiting human review.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "her2-exon-20-insertions-zongertinib-nsclc",
  title: "HER2 exon 20 insertions in NSCLC: zongertinib and the YVMA problem",
  description:
    "Why HER2 exon 20 insertions resisted pan-HER inhibitors for a decade, and how a HER2-selective covalent TKI finally cleared the EGFR-toxicity barrier.",
  date: "2026-06-03",
  author: "Liganx team",
  tags: ["her2", "nsclc", "exon-20", "zongertinib", "kinase-inhibitor"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        HER2 (ERBB2) mutations show up in roughly 2-4% of non-small-cell
        lung cancers, and unlike HER2 amplification in breast cancer, the
        lung-cancer version is driven by small in-frame insertions in the
        kinase domain. The single most common one, an insertion of four
        residues called YVMA, spent more than a decade defeating every
        tyrosine kinase inhibitor thrown at it. The drugs that hit the
        target hit wild-type EGFR just as hard, and the resulting rash and
        diarrhea capped the dose below what the tumor needed. Zongertinib,
        approved by the FDA in August 2025, is the first oral agent that
        cleanly separates the two.
      </p>

      <h2>What the YVMA insertion does to the kinase</h2>
      <p>
        The dominant HER2 exon 20 alteration is A775_G776insYVMA &mdash; an
        insertion of tyrosine-valine-methionine-alanine between residues
        775 and 776, right at the end of the &alpha;C-helix in the kinase
        domain. It accounts for the majority of HER2 exon 20 insertions in
        lung cancer. Mechanistically it behaves like its EGFR exon 20
        cousin: the extra residues wedge the &alpha;C-helix into the active
        &ldquo;in&rdquo; position, locking the kinase into a constitutively
        active conformation that no longer needs a dimerization partner to
        fire.
      </p>
      <p>
        That same structural change narrows and reshapes the ATP-binding
        pocket. Bulky, reversible inhibitors designed against wild-type HER2
        or EGFR simply do not fit well, which is why classical anti-HER2
        antibodies and many first-generation TKIs underperformed against
        the insertion. The pocket is drug-accessible &mdash; it just demands
        a smaller, covalent warhead and exquisite shape complementarity.
      </p>

      <h2>The decade of near-misses</h2>
      <p>
        Before 2024 the HER2-mutant NSCLC toolbox was a list of
        compromises:
      </p>
      <ul>
        <li>
          <strong>Afatinib and dacomitinib</strong> (pan-HER covalent TKIs)
          &mdash; modest response rates, dose-limited by EGFR-driven
          diarrhea and rash because they hit wild-type EGFR with similar
          potency to HER2.
        </li>
        <li>
          <strong>Poziotinib</strong> &mdash; a small, rigid inhibitor
          designed for the constrained exon 20 pocket. It showed activity
          but a narrow therapeutic window and significant toxicity; it did
          not win a HER2-mutant NSCLC approval.
        </li>
        <li>
          <strong>Neratinib and pyrotinib</strong> &mdash; covalent pan-HER
          agents with real but limited single-agent activity and the same
          EGFR liability.
        </li>
        <li>
          <strong>Trastuzumab deruxtecan (T-DXd)</strong> &mdash; the
          antibody-drug conjugate that became the first HER2-directed
          therapy approved for HER2-mutant NSCLC (accelerated approval,
          2024). It is given intravenously and carries an interstitial
          lung disease warning, leaving room for a well-tolerated oral
          option.
        </li>
      </ul>

      <h2>Why zongertinib is different</h2>
      <p>
        Zongertinib (development code BI 1810631, brand name Hernexeos) is
        an irreversible, covalent TKI engineered for HER2 selectivity. In
        biochemical assays it inhibits HER2 with an IC50 around 13 nM while
        sparing wild-type EGFR (IC50 around 579 nM), roughly a 40-fold
        window. That selectivity is the whole point: by leaving EGFR
        signaling in normal skin and gut largely intact, it dodges the
        on-target toxicity that capped the older pan-HER drugs, so the dose
        can actually reach the tumor.
      </p>
      <p>
        The clinical readout matched the design. In the previously treated
        cohort of the phase 1b Beamion LUNG-1 trial, zongertinib produced a
        confirmed objective response rate in the low-to-mid 70s, the basis
        for the FDA&rsquo;s August 2025 accelerated approval in non-squamous
        NSCLC with HER2 TKD activating mutations after prior therapy. In the
        treatment-naive cohort reported later, the confirmed response rate
        was 76% with a median duration of response of 15.2 months and
        median progression-free survival of 14.4 months. Notably, responses
        held up whether or not the tumor carried the YVMA insertion, and an
        intracranial response was seen in roughly half of patients with
        active brain metastases. Adverse events were predominantly low
        grade, and no interstitial lung disease signal of the kind seen
        with the ADC was reported.
      </p>

      <h2>What this means for design work</h2>
      <p>
        The HER2 exon 20 story is a clean lesson in selectivity over raw
        potency. The constrained pocket created by the YVMA insertion is
        druggable; the hard part was building a molecule potent enough on
        mutant HER2 while staying off wild-type EGFR. That is a difference
        of a few angstroms in two very similar ATP pockets, exactly the
        kind of question structure-based methods are meant to answer before
        you commit to synthesis.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and select HER2 (ERBB2) with an exon 20 insertion to dock a
        candidate against the mutant kinase domain, then re-dock the same
        molecule against wild-type EGFR to read out the selectivity gap. Doing
        molecular docking against both pockets side by side is how you spot an
        EGFR liability before it shows up as a dose-limiting rash. Liganx puts
        molecular docking online in the browser, so you can compare poses and
        interaction fingerprints across the HER2/EGFR pair without standing up
        a local pipeline.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Heymach JV, et al. <em>Zongertinib in Previously Treated
          HER2-Mutant Non-Small-Cell Lung Cancer.</em> N Engl J Med (2025).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2503704"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2503704
          </a>
        </li>
        <li>
          Wittlinger F, et al. <em>Zongertinib (BI 1810631), an Irreversible
          HER2 TKI, Spares EGFR Signaling and Improves Therapeutic Response in
          Preclinical Models and Patients with HER2-Driven Cancers.</em> Cancer
          Discov (2025).{" "}
          <a
            href="https://pmc.ncbi.nlm.nih.gov/articles/PMC11726021/"
            target="_blank"
            rel="noreferrer noopener"
          >
            PMC11726021
          </a>
        </li>
        <li>
          U.S. Food and Drug Administration. <em>FDA grants accelerated
          approval to zongertinib for non-squamous NSCLC with HER2 (ERBB2)
          TKD activating mutations</em> (August 8, 2025).{" "}
          <a
            href="https://www.fda.gov/drugs/resources-information-approved-drugs/fda-grants-accelerated-approval-zongertinib-non-squamous-nsclc-her2-tkd-activating-mutations"
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
