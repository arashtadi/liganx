/**
 * Post: INQOVI + venetoclax — first all-oral regimen for unfit AML
 *
 * News/clinical theme. FDA approved oral decitabine/cedazuridine (INQOVI)
 * with venetoclax on 13 May 2026 for newly diagnosed AML in patients
 * ineligible for intensive induction. Internal CTA into /studio with the
 * BCL2 target (venetoclax binds the BH3 groove).
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "oral-decitabine-cedazuridine-venetoclax-aml",
  title: "The first all-oral AML regimen: oral decitabine plus venetoclax",
  description:
    "The FDA cleared oral decitabine/cedazuridine with venetoclax for unfit AML in May 2026. Here is the pharmacology behind the first clinic-free frontline option.",
  date: "2026-06-07",
  author: "Liganx team",
  tags: ["aml", "venetoclax", "bcl2", "clinical-landscape"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        For older adults with newly diagnosed acute myeloid leukemia, the
        standard of care since 2020 has been a hypomethylating agent plus
        venetoclax. It works, but the hypomethylating agent has always been
        an injection, which means recurring clinic visits for a population
        that is frail by definition. On 13 May 2026 the FDA approved oral
        decitabine/cedazuridine (INQOVI) in combination with venetoclax,
        making the entire frontline regimen a pill. It is a small-molecule
        story worth understanding, because both halves are textbook examples
        of how chemistry solves a clinical problem.
      </p>

      <h2>Why the regimen needed an oral hypomethylating agent</h2>
      <p>
        Decitabine is a cytidine analog that incorporates into DNA and
        covalently traps DNA methyltransferase, stripping the aberrant
        methylation that silences tumor-suppressor genes in AML. The problem
        has never been the mechanism. It is the pharmacokinetics: decitabine
        is destroyed almost instantly by cytidine deaminase (CDA), an enzyme
        highly expressed in the gut and liver. Swallow it on its own and
        first-pass metabolism leaves essentially nothing for the marrow.
        That is why decitabine spent two decades as an intravenous or
        subcutaneous drug.
      </p>

      <h2>Cedazuridine: a deaminase inhibitor as a pharmacokinetic enabler</h2>
      <p>
        Cedazuridine is the clever part. It is a tetrahydrouridine-derived
        cytidine deaminase inhibitor (IC50 around 0.28 uM) with far better
        chemical stability than tetrahydrouridine itself. Taken with oral
        decitabine, it blocks CDA in the gut and liver long enough for the
        decitabine to survive first pass and reach therapeutic AUC exposures
        that match the IV dose milligram-for-milligram. There is also
        evidence that cedazuridine engages the concentrative nucleoside
        transporter CNT1 in the kidney and slows renal clearance of
        decitabine, adding to the exposure benefit. The fixed-dose oral
        combination (35 mg decitabine / 100 mg cedazuridine) was first
        approved in MDS in 2020; the 2026 decision extends it into AML in
        combination with venetoclax.
      </p>

      <h2>Venetoclax: a BH3-mimetic that restores apoptosis</h2>
      <p>
        Venetoclax is the small molecule that made BCL2 druggable. AML blasts,
        especially in older patients, lean heavily on the anti-apoptotic
        protein BCL2 to evade programmed cell death. BCL2 works by sequestering
        pro-apoptotic effectors through its hydrophobic BH3-binding groove.
        Venetoclax is a BH3 mimetic: it occupies that groove, displaces the
        sequestered pro-death proteins, and lets the cell execute apoptosis.
        It is a hard target for structure-based design because the groove is
        a shallow, extended protein-protein interaction surface rather than a
        deep enzyme pocket, which is exactly why venetoclax is such a large,
        elaborated molecule.
      </p>

      <h2>What the data showed</h2>
      <ul>
        <li>
          <strong>VIALE-A (2020)</strong> established the combination logic:
          azacitidine plus venetoclax delivered median overall survival of
          14.7 months versus 9.6 months for azacitidine alone, with a
          composite complete-remission rate of 66.4% versus 28.3%. This is the
          benchmark the oral regimen is built to reproduce without the
          injections.
        </li>
        <li>
          <strong>ASCERTAIN-V (the registrational study for the 2026
          approval)</strong> tested oral decitabine/cedazuridine plus
          venetoclax in newly diagnosed AML patients ineligible for intensive
          induction. Among efficacy-evaluable patients, 41.6% achieved a
          complete remission, median time to CR was about 2 months, and 75.3%
          of responders were still in remission at 12 months.
        </li>
      </ul>
      <p>
        The clinical significance is logistical as much as pharmacological:
        for a 75-plus patient who may live far from a treatment center, the
        difference between an injectable and an all-oral regimen can decide
        whether they get treated at all.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        BCL2 is the structurally interesting target here. The canonical
        venetoclax co-crystal is{" "}
        <a
          href="https://www.rcsb.org/structure/6O0K"
          target="_blank"
          rel="noreferrer noopener"
        >
          6O0K
        </a>
        , with venetoclax bound in the BH3 groove.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick BCL2 to run molecular docking against the same groove and see
        why a shallow protein-protein interface forces such a large ligand.
        Liganx is molecular docking online, free and browser-based, so you can
        explore the BH3-mimetic pose without a local install.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          DiNardo CD, et al. <em>Azacitidine and Venetoclax in Previously
          Untreated Acute Myeloid Leukemia.</em> N Engl J Med 383, 617-629
          (2020).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2012971"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2012971
          </a>
        </li>
        <li>
          Dhillon S. <em>Decitabine/Cedazuridine: First Approval.</em> Drugs
          80, 1373-1378 (2020).{" "}
          <a
            href="https://pmc.ncbi.nlm.nih.gov/articles/PMC7708383/"
            target="_blank"
            rel="noreferrer noopener"
          >
            PMC7708383
          </a>
        </li>
        <li>
          Taiho Oncology. <em>U.S. FDA Approves INQOVI in Combination with
          Venetoclax, the First All-Oral Combination Treatment for AML
          Patients Ineligible for Intensive Induction Chemotherapy.</em> Press
          release, 13 May 2026.{" "}
          <a
            href="https://www.businesswire.com/news/home/20260513018065/en/"
            target="_blank"
            rel="noreferrer noopener"
          >
            businesswire.com
          </a>
        </li>
      </ul>
    </>
  );
}
