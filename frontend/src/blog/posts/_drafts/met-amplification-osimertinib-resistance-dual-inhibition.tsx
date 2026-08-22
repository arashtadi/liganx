/**
 * Post: MET amplification as the leading bypass route out of osimertinib
 *
 * SEO target: "MET amplification osimertinib resistance", "savolitinib
 * osimertinib", "tepotinib osimertinib INSIGHT 2", "EGFR MET dual
 * inhibition". Internal CTA into /studio for the on-target MET kinase
 * mutations (D1228, Y1230) that follow dual inhibition, since those are
 * the part of this story docking can actually address.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "met-amplification-osimertinib-resistance-dual-inhibition",
  title: "MET amplification: the bypass route out of osimertinib",
  description:
    "MET amplification is the most common bypass mechanism of osimertinib resistance in EGFR-mutant NSCLC. What INSIGHT 2 and the savolitinib trials showed, and what breaks next.",
  date: "2026-08-04",
  author: "Liganx team",
  tags: ["met", "egfr", "nsclc", "resistance"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Most resistance stories in this blog are about a single amino acid
        changing inside a drug&rsquo;s binding site. MET amplification is not that.
        Nothing about the EGFR pocket changes, and nothing about the MET
        pocket changes either. The tumor simply makes more MET protein until
        the downstream signal it feeds no longer depends on EGFR at all.
        It is the most common bypass mechanism of acquired resistance to
        first-line osimertinib, and it is the one that forced the field to
        start giving two kinase inhibitors at once.
      </p>

      <h2>Amplification is a dosage problem, not a shape problem</h2>
      <p>
        EGFR and MET converge on the same two pathways: RAS/MAPK and
        PI3K/AKT. When osimertinib silences EGFR, a clone carrying extra
        copies of the MET gene can keep both pathways lit through MET
        instead. The cell does not need a smarter receptor, only more of
        an existing one. Estimates put MET amplification at up to roughly
        30% of patients progressing on first-line osimertinib, which makes
        it the single largest identifiable bucket in the post-osimertinib
        resistance landscape.
      </p>
      <p>
        That framing matters for how the problem is diagnosed. There is no
        variant allele to call. Detection runs on copy number: tissue FISH
        with a MET gene copy number of at least 5 or a MET-to-CEP7 ratio of
        at least 2, or liquid-biopsy next-generation sequencing with a
        plasma MET gene copy number threshold. Different trials have used
        different cutoffs, and that inconsistency is one reason cross-trial
        response rates are hard to compare.
      </p>

      <h2>What dual EGFR plus MET inhibition actually delivered</h2>
      <ul>
        <li>
          <strong>INSIGHT 2</strong> (tepotinib 500 mg plus osimertinib
          80 mg, phase 2, 128 patients enrolled across 17 countries) reported
          a confirmed objective response rate of 50.0% (95% CI 39.7-60.3)
          in the 98-patient primary activity population with MET
          amplification confirmed by central FISH after progression on
          first-line osimertinib. Grade 3 or worse treatment-related events
          were peripheral oedema (5%), decreased appetite (4%), QT
          prolongation (4%) and pneumonitis (3%). Four deaths were assessed
          as potentially treatment-related.
        </li>
        <li>
          <strong>Savolitinib plus osimertinib</strong> was tested against
          savolitinib plus placebo in a small randomized phase 2 (30 patients).
          ORR was 57% versus 13% and median progression-free survival 7.4
          versus 1.6 months. In the subset meeting higher MET cutoffs,
          ORR was 63% versus 29%. The study stopped early, and the question
          of how much osimertinib contributes moved into SAVANNAH.
        </li>
        <li>
          <strong>Real-world dual inhibition</strong> at MD Anderson pooled
          crizotinib, capmatinib, savolitinib and tepotinib partnered with
          osimertinib across 23 treatment courses. Overall response was
          34.8%, tumor shrinkage of some degree occurred in 82.4% of
          evaluable patients, and median time on treatment was 27 months.
          Pneumonitis drove several discontinuations.
        </li>
      </ul>
      <p>
        The pattern across all three: roughly half of properly selected
        patients respond, the combination is tolerable but not benign, and
        pneumonitis is the toxicity that ends treatment.
      </p>

      <h2>Selection is the weak link</h2>
      <p>
        Copy-number thresholds are a proxy for what actually matters, which
        is whether the MET pathway is signaling. Work in osimertinib-resistant
        patient-derived xenografts found substantial spatial and temporal
        heterogeneity in MET pathway activation, and phospho-MET rather than
        total c-MET expression tracked with response to the osimertinib plus
        savolitinib combination. Tumors scored as MET polysomy by FISH
        sometimes carried subclonal MET amplification detectable only by
        phospho-MET staining. A biopsy from one site at one time can easily
        miss the clone that is driving progression.
      </p>

      <h2>What breaks after dual inhibition</h2>
      <p>
        Resistance to the combination is polyclonal and arrives from both
        directions. Reported mechanisms include acquired on-target MET kinase
        mutations such as D1246H, acquired EGFR C797S (sometimes with a
        concurrent fusion or a G796S), and, in a meaningful fraction of
        patients, simple loss of the MET amplification that justified the
        combination in the first place. Selective type Ib MET inhibitors are
        also vulnerable to the D1228 and Y1230 solvent-front and activation-loop
        substitutions, which is why type II MET chemotypes remain in
        development.
      </p>
      <p>
        Antibody-based approaches sidestep the kinase pocket entirely.
        Telisotuzumab vedotin, an antibody-drug conjugate targeting c-Met,
        received accelerated approval in 2025 for c-Met-overexpressing tumors,
        and biparatopic METxMET conjugates have shown preclinical activity in
        models that had already progressed on osimertinib plus savolitinib.
        Cell-surface MET expression, not gene copy number, predicted response
        in those preclinical studies.
      </p>

      <h2>Where structure-based modeling helps and where it does not</h2>
      <p>
        It is worth being blunt: molecular docking has nothing useful to say
        about gene amplification. Copy number is not a pocket. What docking
        does address is the second act of this story, the on-target MET kinase
        mutations that emerge once a MET inhibitor is added. D1228 sits at the
        activation loop and Y1230 in the solvent-front region, and both change
        the local geometry that type Ib inhibitors like capmatinib and
        tepotinib depend on. Comparing a compound docked into wild-type MET
        against the same compound docked into the D1228 or Y1230 mutant is a
        legitimate question for a scoring function, especially when you read
        the difference between the two rather than either absolute number.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick MET, then apply D1228N or Y1230C to see how a type Ib
        inhibitor pose shifts against the mutant receptor. Dock the same
        ligand against wild-type MET in the same session and compare the two
        scores rather than reading either one on its own. Liganx brings
        molecular docking online in the browser, so the mutant and wild-type
        runs sit side by side in the same results table.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Wu YL, Guarneri V, Voon PJ, et al. <em>Tepotinib plus osimertinib
          in patients with EGFR-mutated non-small-cell lung cancer with MET
          amplification following progression on first-line osimertinib
          (INSIGHT 2): a multicentre, open-label, phase 2 trial.</em> Lancet
          Oncol 25, 989-1002 (2024).{" "}
          <a
            href="https://doi.org/10.1016/S1470-2045(24)00270-5"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/S1470-2045(24)00270-5
          </a>
        </li>
        <li>
          Yang JCH, Chen YM, Batra U, et al. <em>Savolitinib plus osimertinib
          in EGFR-mutated, MET-amplified advanced non-small cell lung cancer:
          a randomized phase II trial.</em> Clin Lung Cancer 27, 38-46 (2026).{" "}
          <a
            href="https://doi.org/10.1016/j.cllc.2025.10.018"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/j.cllc.2025.10.018
          </a>
        </li>
        <li>
          Wang K, Du R, Roy-Chowdhuri S, et al. <em>Clinical response,
          toxicity, and resistance mechanisms to osimertinib plus MET
          inhibitors in patients with EGFR-mutant MET-amplified NSCLC.</em>{" "}
          JTO Clin Res Rep 4, 100533 (2023).{" "}
          <a
            href="https://doi.org/10.1016/j.jtocrr.2023.100533"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/j.jtocrr.2023.100533
          </a>
        </li>
        <li>
          Roper N, El Meskini R, Maity T, et al. <em>Functional heterogeneity
          in MET pathway activation in PDX models of osimertinib-resistant
          EGFR-driven lung cancer.</em> Cancer Res Commun 4, 337-348 (2024).{" "}
          <a
            href="https://doi.org/10.1158/2767-9764.CRC-23-0321"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2767-9764.CRC-23-0321
          </a>
        </li>
        <li>
          Khan A, Imeh M, Barad P, Rosas D. <em>Targeting MET in 2025: from
          exon 14 skipping to MET-amplified acquired resistance in non-small
          cell lung cancer.</em> Int J Mol Sci 27, 5883 (2026).{" "}
          <a
            href="https://doi.org/10.3390/ijms27135883"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.3390/ijms27135883
          </a>
        </li>
      </ul>
    </>
  );
}
