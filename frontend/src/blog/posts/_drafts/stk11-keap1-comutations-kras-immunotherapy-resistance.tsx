/**
 * Post: STK11 and KEAP1 co-mutations in KRAS-mutant NSCLC
 *
 * SEO target: "STK11 KEAP1 KRAS co-mutation", "sotorasib STK11 resistance",
 * "KRAS immunotherapy resistance biomarker". Internal CTA into /studio
 * with KRAS G12C pre-loaded, framed around why co-mutation status matters
 * for interpreting a docking-based drug selection exercise.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "stk11-keap1-comutations-kras-immunotherapy-resistance",
  title: "STK11 and KEAP1: the co-mutations that break KRAS treatment plans",
  description:
    "STK11 and KEAP1 co-mutations show up in roughly a third of KRAS-mutant NSCLC and predict who won't respond to checkpoint inhibitors or G12C inhibitors alone.",
  date: "2026-08-12",
  author: "Liganx team",
  tags: ["kras", "stk11", "keap1", "nsclc", "resistance"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        A KRAS G12C mutation is not a monolithic diagnosis. Two patients
        with an identical driver mutation can have opposite prognoses and
        opposite responses to the exact same drug, and the reason is almost
        always sitting in the co-mutation panel: STK11 and KEAP1. Neither
        gene is druggable today, but both function as some of the most
        consistent negative predictive biomarkers in thoracic oncology.
      </p>

      <h2>What STK11 and KEAP1 actually do</h2>
      <p>
        STK11 (also called LKB1) is a tumor suppressor kinase that sits
        upstream of AMPK and regulates cellular energy sensing, metabolic
        adaptation, and cell polarity. Loss-of-function STK11 mutations
        show up in roughly 20% of KRAS-mutant lung adenocarcinoma and
        reprogram tumor metabolism in a way that also reshapes the immune
        microenvironment.
      </p>
      <p>
        KEAP1 is the negative regulator of NRF2, the master transcription
        factor for the oxidative stress response. KEAP1 loss constitutively
        activates NRF2 signaling, which protects tumor cells from oxidative
        and electrophilic stress &mdash; including, notably, some of the
        stress mechanisms that chemotherapy and targeted covalent drugs
        rely on. KEAP1 mutations appear in roughly a quarter to a third of
        KRAS-mutant NSCLC cohorts, and STK11 and KEAP1 co-occur often
        enough that they&rsquo;re frequently analyzed as a combined
        biomarker.
      </p>

      <h2>The immunotherapy signal</h2>
      <p>
        The foundational data here is Skoulidis et al. (Cancer Discovery,
        2018): in a cohort of KRAS-mutant lung adenocarcinoma, tumors with
        co-occurring STK11 mutations (the &ldquo;KL&rdquo; subgroup) had a
        7.4% objective response rate to PD-1 blockade, versus 28.6% for
        KRAS-mutant tumors without STK11 or TP53 co-mutations. In the
        CheckMate-057 validation cohort the gap was even starker: 0%
        response in KL tumors versus 57.1% in KRAS/TP53 co-mutant tumors.
        The mechanistic explanation is that STK11 loss produces a
        relatively &ldquo;cold&rdquo; tumor microenvironment &mdash; lower
        PD-L1 expression, reduced CD8+ T cell infiltration &mdash; which is
        exactly the phenotype checkpoint inhibitors depend on being absent.
      </p>
      <p>
        That finding has held up across a decade of follow-up work. It
        matters clinically because PD-1/PD-L1 inhibitors, alone or combined
        with chemotherapy, are first-line standard of care for metastatic
        NSCLC without a targetable driver. A patient with KRAS/STK11
        co-mutation is being set up to fail the standard first-line regimen
        before treatment even starts, which is part of why co-mutation
        testing is increasingly treated as a first-line decision point
        rather than a research curiosity.
      </p>

      <h2>Does it also blunt the G12C inhibitors?</h2>
      <p>
        Co-mutation status doesn&rsquo;t stay contained to immunotherapy.
        Retrospective analyses of the CodeBreaK 200 sotorasib population
        &mdash; where STK11 mutations were present in about 20% of
        patients and KEAP1 in about 26% &mdash; found that KEAP1
        mutations, alone or combined with STK11, tracked with reduced
        response to sotorasib, while STK11 mutation alone showed a small
        efficacy benefit over STK11 wild-type in that same dataset. The
        KEAP1 signal is the more consistent one across studies: NRF2
        pathway activation appears to blunt sensitivity to targeted
        therapy as well as immunotherapy, plausibly through the same
        oxidative-stress-resistance machinery in both cases.
      </p>
      <p>
        The practical read: STK11/KEAP1 status is not just an
        immunotherapy biomarker anymore. It&rsquo;s becoming relevant to
        sequencing decisions across the whole KRAS-mutant treatment
        pathway, which is one reason combination trials pairing G12C
        inhibitors with SHP2, MEK, or PI3K-mTOR inhibitors specifically
        stratify by co-mutation status rather than treating KRAS G12C as
        one uniform population.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        Co-mutation status is a genomics question, not a structural one
        &mdash; STK11 and KEAP1 loss don&rsquo;t change the KRAS G12C
        binding pocket itself. What it changes is how much weight to put
        on a docking result.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock sotorasib or adagrasib against KRAS G12C to see the
        binding pose the drug relies on. A strong docking score tells you
        the compound should engage the target; it says nothing about
        whether NRF2 activation downstream of a KEAP1 mutation will blunt
        the tumor&rsquo;s response anyway. That gap between target
        engagement and clinical response is exactly why co-mutation
        context belongs alongside any docking-based hypothesis for
        KRAS-mutant disease.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Skoulidis F, et al. <em>STK11/LKB1 Mutations and PD-1 Inhibitor
          Resistance in KRAS-Mutant Lung Adenocarcinoma.</em> Cancer Discov
          8, 822&ndash;835 (2018).{" "}
          <a
            href="https://doi.org/10.1158/2159-8290.CD-18-0099"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2159-8290.CD-18-0099
          </a>
        </li>
        <li>
          Skoulidis F, et al. <em>Co-occurring Genomic Alterations Define
          Major Subsets of KRAS-Mutant Lung Adenocarcinoma with Distinct
          Biology, Immune Profiles, and Therapeutic Vulnerabilities.</em>{" "}
          Cancer Discov 5, 860&ndash;877 (2015).{" "}
          <a
            href="https://doi.org/10.1158/2159-8290.CD-14-1236"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2159-8290.CD-14-1236
          </a>
        </li>
        <li>
          OncLive. <em>I/O Therapy in KRAS-Mutant NSCLC With Concomitant
          STK11 or KEAP1 Mutations</em> &mdash; CodeBreaK 200 co-mutation
          subgroup discussion.
        </li>
      </ul>
    </>
  );
}
