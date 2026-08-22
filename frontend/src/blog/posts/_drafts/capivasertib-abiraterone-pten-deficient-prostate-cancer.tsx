import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "capivasertib-abiraterone-pten-deficient-prostate-cancer",
  title: "Capivasertib + abiraterone: drugging PTEN-loss in prostate cancer",
  description:
    "The FDA's June 2026 approval of capivasertib plus abiraterone makes PTEN loss a targetable event in hormone-sensitive prostate cancer. Here is the biology and the CAPItello-281 data.",
  date: "2026-07-02",
  author: "Liganx team",
  tags: ["akt", "pten", "prostate-cancer", "clinical", "pi3k-pathway"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        On June 12, 2026 the FDA approved capivasertib (Truqap) with abiraterone
        and prednisone for PTEN-deficient metastatic hormone-sensitive prostate
        cancer. It is the first targeted regimen for this population, and it
        turns a tumor-suppressor deletion, PTEN loss, into an actionable
        biomarker. The logic is a clean example of synthetic pathway addiction:
        lose the brake on the PI3K/AKT axis, and the tumor becomes dependent on
        AKT signaling you can now inhibit.
      </p>

      <h2>Why PTEN loss activates AKT</h2>
      <p>
        PTEN is a lipid phosphatase. Its day job is to dephosphorylate PIP3 back
        to PIP2, directly opposing the PI3K reaction that generates PIP3 at the
        membrane. PIP3 is the second messenger that recruits AKT to the membrane
        and licenses its activation. When PTEN is deleted or silenced, PIP3
        accumulates unopposed, AKT is chronically active, and downstream
        survival and proliferation signaling through mTORC1, FOXO, and GSK3
        runs without a governor.
      </p>
      <p>
        PTEN loss is one of the most common events in prostate cancer, seen in
        roughly 40 to 50 percent of metastatic disease, and it tracks with worse
        outcomes. It also creates crosstalk with the androgen receptor:
        AR blockade can relieve feedback inhibition on PI3K/AKT, and AKT activity
        can in turn sustain AR-independent survival. That reciprocal escape is
        the rationale for hitting both axes at once rather than sequentially.
      </p>

      <h2>What capivasertib is</h2>
      <p>
        Capivasertib is an ATP-competitive, pan-AKT inhibitor that blocks all
        three isoforms (AKT1, AKT2, AKT3). Because it competes at the ATP
        pocket of an active kinase, its selectivity story is about discriminating
        AKT from the hundreds of other kinases that also bind ATP, which is where
        careful structural work on the hinge and the specificity pockets earns
        its keep. It had already been approved in 2023 for hormone
        receptor-positive breast cancer with PIK3CA, AKT1, or PTEN alterations
        on the strength of CAPItello-291, so the prostate approval extends a
        pathway-directed franchise into a second tumor type driven by the same
        axis.
      </p>

      <h2>The CAPItello-281 data</h2>
      <p>
        CAPItello-281 was a phase III trial in 1,012 patients with newly
        diagnosed, PTEN-deficient metastatic hormone-sensitive prostate cancer,
        randomized to capivasertib or placebo on top of abiraterone and
        prednisone.
      </p>
      <ul>
        <li>
          <strong>Radiographic PFS</strong> improved from a median of 25.7
          months on the control arm to 33.2 months with capivasertib added
          (HR 0.81; 95% CI 0.66 to 0.98; two-sided p = 0.034).
        </li>
        <li>
          <strong>Companion diagnostic:</strong> the FDA co-approved the VENTANA
          PTEN (SP218) RxDx immunohistochemistry assay to select patients, so
          eligibility hinges on documented PTEN protein loss rather than a
          sequencing call.
        </li>
        <li>
          <strong>Safety:</strong> the AKT-inhibitor class carries on-mechanism
          hyperglycemia, diarrhea, and rash, reflecting AKT's role in insulin
          signaling and epithelial homeostasis. These are managed but not
          trivial, and they shape the risk-benefit conversation for a
          biomarker-selected population.
        </li>
      </ul>

      <h2>What it means for the pipeline</h2>
      <p>
        This is another data point in the slow march to make the PI3K/AKT/PTEN
        axis druggable in solid tumors, alongside PI3K-alpha inhibitors and
        degraders in breast cancer. It also reinforces a pattern: tumor
        suppressor loss is hard to drug directly, but you can often drug the
        pathway node that becomes essential once the suppressor is gone. The
        open questions are the usual ones, durability, resistance via feedback
        reactivation or AR-pathway bypass, and whether isoform-selective AKT
        inhibitors can widen the therapeutic index.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick AKT1 to dock capivasertib into the ATP pocket. Because
        capivasertib is ATP-competitive, molecular docking against the active
        kinase conformation lets you inspect the hinge contacts that drive
        potency and compare poses across the AKT isoforms. Running molecular
        docking online this way is a fast way to see why a pan-AKT binder holds
        up across AKT1, AKT2, and AKT3.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          FDA. <em>FDA approves capivasertib with abiraterone and prednisone for
          PTEN-deficient androgen pathway modulation-naive or -sensitive prostate
          cancer.</em> June 12, 2026.{" "}
          <a
            href="https://www.fda.gov/drugs/resources-information-approved-drugs/fda-approves-capivasertib-abiraterone-and-prednisone-pten-deficient-androgen-pathway-modulation"
            target="_blank"
            rel="noreferrer noopener"
          >
            fda.gov
          </a>
        </li>
        <li>
          CAPItello-281 investigators. <em>Capivasertib plus abiraterone in
          PTEN-deficient metastatic hormone-sensitive prostate cancer:
          CAPItello-281 phase III study.</em> Ann Oncol (2025).{" "}
          <a
            href="https://www.annalsofoncology.org/article/S0923-7534(25)04936-1/fulltext"
            target="_blank"
            rel="noreferrer noopener"
          >
            annalsofoncology.org
          </a>
        </li>
        <li>
          Turner NC, et al. <em>Capivasertib in hormone receptor-positive
          advanced breast cancer (CAPItello-291).</em> N Engl J Med 388,
          2058-2070 (2023).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2214131"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2214131
          </a>
        </li>
      </ul>
    </>
  );
}
