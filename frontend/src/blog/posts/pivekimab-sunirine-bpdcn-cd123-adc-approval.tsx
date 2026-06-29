/**
 * Post: FDA approves pivekimab sunirine for BPDCN - the CD123 story and the
 * small-molecule frontier (BCL-2, FLT3).
 *
 * SEO target: "pivekimab sunirine", "Decnupaz", "BPDCN treatment", "CD123 ADC",
 * "venetoclax BPDCN", "blastic plasmacytoid dendritic cell neoplasm". News /
 * clinical theme post. Internal CTA into /studio pivoting to BCL-2 and FLT3
 * small-molecule targets. Cross-links to the BCL-2 post.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "pivekimab-sunirine-bpdcn-cd123-adc-approval",
  title: "Pivekimab sunirine approved for BPDCN: the CD123 story",
  description:
    "The FDA approved pivekimab sunirine, the first antibody-drug conjugate for blastic plasmacytoid dendritic cell neoplasm. Here is the CD123 rationale, the CADENZA data, and where small molecules like venetoclax still fit.",
  date: "2026-06-02",
  author: "Liganx team",
  tags: ["clinical-news", "bpdcn", "cd123", "adc", "fda-approval"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        On May 27, 2026 the FDA approved <strong>pivekimab sunirine-pvzy</strong>{" "}
        (Decnupaz, AbbVie), the first antibody-drug conjugate for{" "}
        <strong>blastic plasmacytoid dendritic cell neoplasm (BPDCN)</strong>, an
        ultra-rare and aggressive blood cancer. It is a milestone for a disease
        that, until recently, had essentially no standard of care. It is also a
        clean illustration of why some targets get drugged with biologics and
        others with small molecules &mdash; and where the two strategies meet.
      </p>

      <h2>Why CD123, and why an antibody-drug conjugate</h2>
      <p>
        BPDCN arises from precursors of plasmacytoid dendritic cells, and its
        defining surface feature is uniform, high expression of{" "}
        <strong>CD123</strong>, the alpha chain of the interleukin-3 receptor.
        CD123 is a receptor on the cell surface, not an enzyme with a deep
        druggable pocket, so the practical way to hit it is to aim a targeting
        antibody at it rather than design a small molecule to plug an active
        site. That logic produced the first BPDCN drug, tagraxofusp (a CD123-IL3
        fusion toxin), and now pivekimab sunirine, which takes the same address
        label and upgrades the warhead.
      </p>
      <ul>
        <li>
          <strong>Pivekimab sunirine</strong> &mdash; a high-affinity anti-CD123
          antibody joined through a cleavable linker to an indolinobenzodiazepine
          pseudodimer payload that crosslinks DNA. The antibody delivers; the
          payload kills once internalized.
        </li>
        <li>
          <strong>Tagraxofusp</strong> &mdash; the prior CD123-directed agent, a
          diphtheria-toxin fusion, established that CD123 is a tractable address
          in BPDCN but carried capillary leak syndrome as a signature toxicity.
        </li>
      </ul>

      <h2>The CADENZA data</h2>
      <p>
        Approval rested on the single-arm CADENZA trial (NCT03386513). In
        treatment-naive BPDCN, roughly 70% of patients reached a complete
        response or clinical complete response after a median follow-up of about
        21 months; in relapsed or refractory disease the complete-response rate
        was lower, near 16%, with a median duration of response around nine
        months. Notably, Decnupaz can be initiated in the outpatient setting,
        which for an ultra-rare disease with scattered, often older patients is a
        meaningful access advantage over therapies that require inpatient
        monitoring.
      </p>

      <h2>Where small molecules still fit: BCL-2 and FLT3</h2>
      <p>
        A surface receptor like CD123 is a job for an antibody, but BPDCN also
        has a soft spot that a small molecule hits hard. Primary BPDCN cells are{" "}
        <strong>dependent on the anti-apoptotic protein BCL-2</strong> and are
        uniformly sensitive to the BCL-2 inhibitor <strong>venetoclax</strong>,
        a result first shown by BH3 profiling and since borne out by responses to
        venetoclax-containing regimens in the clinic. A subset of cases also
        carry <strong>FLT3</strong> alterations, putting another well-characterized
        kinase pocket on the table. Those two &mdash; BCL-2 and FLT3 &mdash; are
        exactly the kind of deep, well-defined binding sites where structure-based
        design and docking are useful, in contrast to the flat surface of CD123.
      </p>

      <h2>Dock the small-molecule side yourself</h2>
      <p>
        Pivekimab is a biologic, but the small-molecule frontier in BPDCN runs
        through targets Liganx already carries. Liganx brings molecular docking online
        to the browser, so you can explore the druggable pockets that sit
        alongside the CD123 antibody strategy.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock a BH3-mimetic against <strong>BCL-2</strong>, or a kinase
        inhibitor against <strong>FLT3</strong>, to see how a small molecule
        engages a real pocket. If you want the BCL-2 background first, read our{" "}
        <Link
          to="/blog/sonrotoclax-bcl2-inhibitor-mantle-cell-lymphoma"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          BCL-2 inhibitor deep-dive
        </Link>
        . Running the molecular docking next to the clinical picture is a fast way
        to see why some BPDCN targets are antibody problems and others are pocket
        problems.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          U.S. Food and Drug Administration. <em>FDA approves pivekimab
          sunirine-pvzy for blastic plasmacytoid dendritic cell neoplasm, an
          ultra-rare hematologic malignancy.</em> (May 27, 2026).{" "}
          <a
            href="https://www.fda.gov/drugs/resources-information-approved-drugs/fda-approves-pivekimab-sunirine-pvzy-blastic-plasmacytoid-dendritic-cell-neoplasm-ultra-rare"
            target="_blank"
            rel="noreferrer noopener"
          >
            fda.gov
          </a>
        </li>
        <li>
          Montero J, Stephansky J, Cai T, et al. <em>Blastic plasmacytoid
          dendritic cell neoplasm is dependent on BCL2 and sensitive to
          venetoclax.</em> Cancer Discov 7, 156&ndash;164 (2017).{" "}
          <a
            href="https://doi.org/10.1158/2159-8290.CD-16-0999"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2159-8290.CD-16-0999
          </a>
        </li>
        <li>
          Pemmaraju N, Lane AA, Sweet KL, et al. <em>Tagraxofusp in blastic
          plasmacytoid dendritic-cell neoplasm.</em> N Engl J Med 380,
          1628&ndash;1637 (2019).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1815105"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1815105
          </a>
        </li>
      </ul>
    </>
  );
}
