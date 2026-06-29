/**
 * Post: Acalabrutinib + venetoclax — the first all-oral, fixed-duration
 * frontline CLL regimen (AMPLIFY).
 *
 * News/clinical commentary on the Feb 2026 FDA approval. Internal CTA into
 * /studio for docking BTK and BCL-2 ligands.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "acalabrutinib-venetoclax-fixed-duration-cll-amplify",
  title: "Acalabrutinib + venetoclax: all-oral, fixed-duration CLL",
  description:
    "The FDA cleared acalabrutinib plus venetoclax for frontline CLL on the AMPLIFY trial. Why pairing a BTK inhibitor with a BCL-2 inhibitor changes the treatment math.",
  date: "2026-06-24",
  author: "Liganx team",
  tags: ["btk", "bcl-2", "cll", "clinical", "venetoclax"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        On February 19, 2026 the FDA approved acalabrutinib plus venetoclax for
        adults with previously untreated chronic lymphocytic leukemia (CLL) or
        small lymphocytic lymphoma (SLL). It is the first all-oral,
        fixed-duration regimen in the frontline setting — no infusions, and a
        defined stop date rather than treatment until progression. The approval
        rests on the phase 3 AMPLIFY trial, and the logic behind it is a clean
        example of why hitting two non-overlapping nodes of the same survival
        circuit beats pushing harder on either one alone.
      </p>

      <h2>Two drugs, two mechanisms</h2>
      <p>
        CLL cells survive by leaning on two distinct molecular crutches, and
        each drug in the combination kicks out one of them.
      </p>
      <ul>
        <li>
          <strong>Acalabrutinib</strong> is a second-generation covalent BTK
          inhibitor. It forms a bond to Cys481 in the ATP pocket of Bruton
          tyrosine kinase, shutting down B-cell receptor signaling. Compared to
          first-generation ibrutinib it is far more selective, sparing EGFR,
          TEC, and ITK, which is why it carries less atrial fibrillation and
          bleeding. BTK blockade does not kill CLL cells outright; it pushes
          them out of the protective lymph-node niche and blocks the
          proliferation signal.
        </li>
        <li>
          <strong>Venetoclax</strong> is a BH3-mimetic that binds the BCL-2
          anti-apoptotic protein, displacing the pro-apoptotic effectors (BIM,
          BAX, BAK) that BCL-2 normally sequesters. CLL cells are addicted to
          BCL-2 overexpression to avoid apoptosis, so freeing those effectors
          triggers programmed cell death directly. Venetoclax is the component
          that drives deep, measurable-residual-disease-negative responses.
        </li>
      </ul>
      <p>
        The pairing is rational: acalabrutinib mobilizes the disease and
        suppresses proliferation while venetoclax delivers the apoptotic kill.
        Because BTK inhibition reduces tumor bulk first, it also blunts the
        tumor-lysis-syndrome risk that comes with venetoclax ramp-up.
      </p>

      <h2>What AMPLIFY actually showed</h2>
      <p>
        AMPLIFY (NCT03836261) randomized fit, treatment-naive CLL patients
        without del(17p) or TP53 mutation to fixed-duration acalabrutinib plus
        venetoclax (AV), AV plus obinutuzumab (AVO), or investigator&rsquo;s
        choice of chemoimmunotherapy (FCR or BR). The key readout:
      </p>
      <ul>
        <li>
          <strong>Progression-free survival.</strong> Both AV and AVO
          significantly prolonged PFS versus chemoimmunotherapy. Median PFS on
          standard chemoimmunotherapy was 47.6 months; on the
          acalabrutinib-venetoclax arms it was not reached at the interim
          analysis, with a clinically meaningful absolute gain in 3-year PFS.
        </li>
        <li>
          <strong>Fixed duration.</strong> Unlike continuous BTK-inhibitor
          monotherapy, the regimen stops after a defined course. Patients get a
          treatment-free interval, which matters for cost, adherence, and
          cumulative toxicity.
        </li>
        <li>
          <strong>Caveat on TP53.</strong> The trial excluded del(17p) and
          TP53-mutated patients, so the label does not extend the strongest
          evidence to that high-risk group. Adding obinutuzumab (AVO) improved
          depth of response but added infusion burden and infection risk, which
          is part of why the all-oral AV doublet is the headline regimen.
        </li>
      </ul>

      <h2>Why this matters for structure-based design</h2>
      <p>
        Both targets are well-characterized structurally, which makes the
        combination a useful teaching case for docking. BTK&rsquo;s Cys481 is
        the covalent anchor that acalabrutinib exploits — and the same residue,
        when mutated to serine (C481S), abolishes covalent binding and drives
        resistance, which is the entire rationale for reversible binders like
        pirtobrutinib. BCL-2, by contrast, is a protein-protein interaction
        surface: venetoclax has to occupy a long, shallow groove that small
        molecules historically struggled to drug, which is why BH3-mimetics
        took two decades to reach the clinic.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock acalabrutinib into BTK to see the covalent geometry at Cys481,
        then switch the receptor to the C481S mutant and watch the covalent
        anchor disappear. Docking the two drugs against their respective targets
        side by side is the fastest way to internalize why a covalent BTK
        binder and a BH3-mimetic are mechanistically independent — and why
        combining them is more than additive. Molecular docking online makes
        that comparison a two-minute exercise instead of a modeling project.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Brown JR, et al. <em>Fixed-Duration Acalabrutinib Combinations in
          Untreated Chronic Lymphocytic Leukemia.</em> N Engl J Med 392,
          748-762 (2025).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2409804"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2409804
          </a>
        </li>
        <li>
          U.S. Food and Drug Administration. <em>FDA approves acalabrutinib
          with venetoclax for chronic lymphocytic leukemia or small lymphocytic
          lymphoma.</em> February 19, 2026.{" "}
          <a
            href="https://www.fda.gov/drugs/resources-information-approved-drugs/fda-approves-acalabrutinib-venetoclax-chronic-lymphocytic-leukemia-or-small-lymphocytic-lymphoma"
            target="_blank"
            rel="noreferrer noopener"
          >
            fda.gov
          </a>
        </li>
        <li>
          Souers AJ, et al. <em>ABT-199, a potent and selective BCL-2 inhibitor,
          achieves antitumor activity while sparing platelets.</em> Nat Med 19,
          202-208 (2013).{" "}
          <a
            href="https://doi.org/10.1038/nm.3048"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nm.3048
          </a>
        </li>
      </ul>
    </>
  );
}
