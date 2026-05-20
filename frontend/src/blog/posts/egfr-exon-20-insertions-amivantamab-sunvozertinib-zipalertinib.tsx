/**
 * Post: EGFR exon 20 insertions — the third resistance pocket
 *
 * SEO target: long-tail "EGFR exon 20 insertion treatment", "sunvozertinib
 * Zegfrovy", "zipalertinib NSCLC", "amivantamab Rybrevant first-line",
 * "PAPILLON trial". Internal CTA into /studio with EGFR + exon 20
 * insertion variant pre-loaded so the reader can see why first- and
 * second-generation EGFR TKIs miss this pocket.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "egfr-exon-20-insertions-amivantamab-sunvozertinib-zipalertinib",
  title: "EGFR exon 20 insertions — the third resistance pocket",
  description:
    "Why classical EGFR TKIs fail on exon 20 insertions, and how amivantamab, sunvozertinib, and zipalertinib are building out a real treatment ladder for this 10% of EGFR-mutant NSCLC.",
  date: "2026-05-18",
  author: "Liganx team",
  tags: ["egfr", "oncology", "nsclc", "resistance", "clinical-landscape"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        EGFR exon 20 insertions are the awkward middle child of
        EGFR-mutant lung cancer. They sit in the same kinase but
        deform the αC-helix into a configuration that classical
        TKIs cannot exploit, and for a decade they were the EGFR
        mutation no one had a drug for. That has finally changed.
        Amivantamab carries the frontline label, sunvozertinib
        cleared FDA in July 2025, and zipalertinib has an NDA on
        file with a February 2027 PDUFA. Here is the resistance
        landscape, the chemistry that finally cracked it, and
        where the field is going next.
      </p>

      <h2>Why exon 20 insertions are different</h2>
      <p>
        About 85% of EGFR-mutant NSCLC carries one of two
        &ldquo;classical&rdquo; activating mutations: L858R in
        exon 21, or exon 19 deletions. Both stabilize the active
        αC-in conformation of the kinase, expose the ATP pocket,
        and respond to gefitinib, erlotinib, afatinib, and
        osimertinib. Exon 20 insertions account for roughly 4–10%
        of EGFR-mutant cases — about 30,000–40,000 patients
        diagnosed globally each year — and behave nothing like
        the classical mutants.
      </p>
      <p>
        Structurally, an in-frame insertion of one to four
        residues into the loop following the C-terminus of the
        αC-helix (residues 763–774, with the most common variants
        being V769_D770insASV, D770_N771insSVD, H773_V774insNPH,
        and A767_S768insTLA) wedges the αC-helix into a
        constitutively active position. The kinase is locked
        &ldquo;on&rdquo; without needing the conformational
        rearrangement that classical mutations stabilize. The
        downstream signal is the same. The pocket is not.
      </p>
      <p>
        The drug-binding consequence is severe. The inserted
        residues crowd the ATP pocket entrance and reshape the
        P-loop, so the morpholino tail of gefitinib, the
        quinazoline scaffold of erlotinib, and the acrylamide
        warhead of osimertinib all find their preferred geometries
        either blocked or destabilized. Clinical ORRs of the
        approved EGFR TKIs against exon 20 insertions sit in
        single digits. In effect, this is a third resistance
        pocket the field had to design against from scratch.
      </p>

      <h2>What is approved today</h2>
      <ul>
        <li>
          <strong>Amivantamab (Rybrevant, Janssen)</strong> — an
          EGFR-MET bispecific IgG1, first approved in May 2021
          as monotherapy after platinum chemotherapy and
          subsequently moved to first line as
          amivantamab + carboplatin + pemetrexed on the basis
          of the PAPILLON phase 3 trial (Zhou et al., NEJM 2023).
          PAPILLON showed a median PFS of 11.4 months versus
          6.7 months for chemo alone (HR 0.40). The drug is
          delivered IV with a notorious infusion-reaction burden
          on cycle 1 day 1, but the activity is the deepest seen
          to date in this population. It is the current
          frontline standard.
        </li>
        <li>
          <strong>Sunvozertinib (Zegfrovy, Dizal)</strong> — an
          orally bioavailable irreversible EGFR TKI specifically
          designed against the deformed exon 20 pocket. FDA
          granted accelerated approval on July 2, 2025 for
          patients who have progressed on platinum-based
          chemotherapy, supported by the WU-KONG6 phase 2
          study: ORR 46%, median DOR 11.1 months, median PFS
          13.8 months at the 300 mg cohort dose (Wang et al.,
          JCO 2024). It had already been approved in China in
          August 2023. The companion diagnostic is the
          Oncomine Dx Express Test.
        </li>
        <li>
          <strong>Mobocertinib (Exkivity, Takeda)</strong> —
          worth a footnote. Granted accelerated approval in
          September 2021, voluntarily withdrawn from the US
          market in October 2023 after the EXCLAIM-2
          confirmatory trial failed to demonstrate PFS benefit
          versus chemotherapy in the first-line setting. A
          reminder that accelerated approvals are real
          approvals only if the confirmatory data lands.
        </li>
      </ul>

      <h2>What is filed and what is coming</h2>
      <p>
        <strong>Zipalertinib (CLN-081, Cullinan/Taiho)</strong> is
        an orally bioavailable, irreversible, EGFR-mutant-selective
        TKI with the most differentiated mechanism in the field:
        it preferentially binds the inactive conformation of
        exon 20-mutated EGFR while sparing wild-type EGFR enough
        to avoid the rash/diarrhea ceiling that limited
        mobocertinib. The FDA accepted the NDA in 2025 with a
        PDUFA action date of February 27, 2027. The pivotal data
        (Piotrowska et al., presented ASCO 2025) showed an ORR
        of 35.2% across previously treated patients, with a
        median DOR of 8.8 months. The most interesting subset
        was prior-amivantamab-only patients — those who had
        progressed on the frontline standard — where
        zipalertinib showed a 30% ORR with a 14.7-month median
        DOR. That positions zipalertinib as the most likely
        second-line option after amivantamab-based induction.
      </p>
      <p>
        Several other compounds are in earlier development. BAY
        2927088 (Bayer) is in phase 1/2 with early ORRs in the
        40s. Furmonertinib at higher doses (240 mg) has shown
        activity in some exon 20 subtypes. The next horizon is
        variant-specific chemistry — the response rate of an
        unselected exon 20 cohort masks substantial
        heterogeneity, with near-loop insertions (e.g. A763_Y764insFQEA)
        behaving more like classical mutants and far-loop
        insertions (anything past residue 770) being the harder
        ones.
      </p>

      <h2>What the docking shows</h2>
      <p>
        EGFR exon 20 insertions are an excellent case for
        mutation-aware molecular docking. Dock erlotinib or
        osimertinib against wild-type EGFR and you get a
        textbook Vina pose: quinazoline N1 hydrogen-bonded to
        the M793 hinge, anilino group reaching into the back
        pocket, an acceptable score around -9 to -10 kcal/mol.
        Re-dock the same compound against, for example, the
        D770_N771insSVD variant and the back-pocket geometry
        collapses — the inserted residues sterically clash with
        the anilino tail, and the score craters by 2–3 kcal/mol.
        That is the resistance signal, and ΔΔ between
        wild-type and the insertion variant is the readout
        that matters.
      </p>
      <p>
        Sunvozertinib and zipalertinib were engineered around
        this pocket. Their hinge interactions are similar but
        the back-pocket region is trimmed and reshaped to
        accommodate the inserted residues. Docking sunvozertinib
        against an exon 20 insertion structure (a useful starting
        point is PDB 9BU9 for the V769_D770insASV variant) shows
        the back-pocket substituent threading around the
        insertion rather than colliding with it. The ΔΔ
        between wild-type and insertion variant is near zero —
        the drug binds both, with appropriate margin against
        wild-type to avoid dose-limiting rash.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick EGFR from the target catalog. The mutation chips
        include the major exon 20 insertion variants — V769_D770insASV,
        D770_N771insSVD, H773_V774insNPH, A763_Y764insFQEA — alongside
        the classical L858R and T790M. Dock erlotinib, osimertinib,
        sunvozertinib, and zipalertinib across the panel and
        compare the ΔΔ pattern: classical TKIs lose
        2–3 kcal/mol against far-loop insertions and hold against
        the near-loop A763_Y764insFQEA, while the exon-20-specific
        binders look flat across the row. That side-by-side panel
        is the cleanest way to see why amivantamab-led regimens
        and exon-20-specific TKIs are not interchangeable with
        first-line EGFR TKIs.
      </p>
      <p>
        Liganx is a free way to run molecular docking online
        against any of the major EGFR variants without
        installing AutoDock or maintaining your own receptor
        library. If you want a molecular docking sanity check
        on a candidate exon-20 binder before committing to
        chemistry, this is the fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Zhou C, Tang KJ, Cho BC, et al.{" "}
          <em>Amivantamab plus chemotherapy in NSCLC with
          EGFR exon 20 insertions.</em> N Engl J Med 389,
          2039-2051 (2023).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2306441"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2306441
          </a>
        </li>
        <li>
          Wang M, Yang JC, Mitchell PL, et al.{" "}
          <em>Sunvozertinib for the treatment of NSCLC
          with EGFR exon 20 insertion mutations: the
          phase 2 WU-KONG6 study.</em> J Clin Oncol 42,
          3781-3791 (2024).{" "}
          <a
            href="https://doi.org/10.1200/JCO.24.00858"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1200/JCO.24.00858
          </a>
        </li>
        <li>
          U.S. Food and Drug Administration.{" "}
          <em>FDA grants accelerated approval to
          sunvozertinib for metastatic non-small cell
          lung cancer with EGFR exon 20 insertion
          mutations.</em> July 2, 2025.{" "}
          <a
            href="https://www.fda.gov/drugs/resources-information-approved-drugs/fda-grants-accelerated-approval-sunvozertinib-metastatic-non-small-cell-lung-cancer-egfr-exon-20"
            target="_blank"
            rel="noreferrer noopener"
          >
            FDA approval notice
          </a>
        </li>
        <li>
          Piotrowska Z, Tan DSW, Smit EF, et al.{" "}
          <em>Efficacy of zipalertinib in NSCLC patients
          with EGFR exon 20 insertion mutations who
          received prior platinum-based chemotherapy with
          or without amivantamab.</em> J Clin Oncol 43,
          16_suppl, 8503 (2025).{" "}
          <a
            href="https://doi.org/10.1200/JCO.2025.43.16_suppl.8503"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1200/JCO.2025.43.16_suppl.8503
          </a>
        </li>
        <li>
          Robichaux JP, Elamin YY, Tan Z, et al.{" "}
          <em>Mechanisms and clinical activity of an
          EGFR and HER2 exon 20-selective kinase
          inhibitor in non-small cell lung cancer.</em>{" "}
          Nat Med 24, 638-646 (2018).{" "}
          <a
            href="https://doi.org/10.1038/s41591-018-0007-9"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41591-018-0007-9
          </a>
        </li>
      </ul>
    </>
  );
}
