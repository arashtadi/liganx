/**
 * Post: HER2 — the drug landscape across breast, gastric, and lung
 *
 * SEO target: long-tail queries around "HER2 targeted therapy", "HER2-low
 * breast cancer", "HER2-mutant NSCLC", "trastuzumab resistance". Internal
 * CTA into /studio with HER2 + a kinase-domain mutation pre-loaded so the
 * reader can dock the small-molecule TKIs against WT and mutant.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "her2-positive-cancer-drug-landscape",
  title: "HER2: the drug landscape across breast, gastric, and lung",
  description:
    "A field guide to HER2-amplified, HER2-low, and HER2-mutant cancer, the drugs that hit each, and where molecular docking fits the small-molecule TKIs.",
  date: "2026-05-14",
  author: "Liganx team",
  tags: ["her2", "oncology", "clinical-landscape", "molecular-docking"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        HER2 is the target that proved the whole premise of precision
        oncology: find the molecular lesion, build the drug, treat the
        patients who carry it. Thirty years on, &ldquo;HER2-positive&rdquo;
        is no longer one thing. It splits into three distinct biomarker
        states, each with its own drugs, its own resistance story, and its
        own answer to the question of whether molecular docking even applies.
      </p>

      <h2>What HER2 is</h2>
      <p>
        HER2 (ERBB2) is a receptor tyrosine kinase in the EGFR/ErbB family.
        It is the odd one out: it has no known activating ligand of its
        own. Instead it sits in the membrane in a conformation that is
        always ready to dimerize, and it is the preferred partner for the
        other ErbB receptors. When HER2 is overexpressed, that constant
        readiness becomes constitutive signaling through the PI3K/AKT and
        RAS/MAPK pathways. Roughly 15-20% of breast cancers carry HER2
        gene amplification; it also drives a subset of gastric and
        gastroesophageal junction tumors, and a smaller slice of lung
        cancers carry HER2 point mutations instead.
      </p>

      <h2>The three biomarker states</h2>
      <ul>
        <li>
          <strong>HER2-amplified / overexpressed</strong> — IHC 3+ or
          ISH-positive. Many extra copies of the gene, lots of receptor on
          the cell surface. This is classic &ldquo;HER2-positive&rdquo;
          disease and the population every first-generation HER2 drug was
          built for.
        </li>
        <li>
          <strong>HER2-low</strong> — IHC 1+ or 2+/ISH-negative. Not enough
          receptor to call the tumor HER2-positive by the old binary, but
          enough for an antibody-drug conjugate to find and kill the cell.
          This category did not clinically exist until a drug created it.
        </li>
        <li>
          <strong>HER2-mutant</strong> — activating point mutations or small
          insertions in the gene, mostly independent of amplification. The
          recurring lesions are exon 20 insertions (the YVMA insertion is
          the canonical one), plus kinase-domain substitutions like L755S
          and V777L and the extracellular S310F. These show up in 2-4% of
          non-small-cell lung cancers and a smaller fraction of breast and
          other tumors. Crucially, a HER2-mutant tumor is usually not
          HER2-amplified, so the standard IHC test misses it entirely.
        </li>
      </ul>

      <h2>Four drug classes, and which state each one serves</h2>
      <p>
        <strong>Naked antibodies.</strong> Trastuzumab binds extracellular
        domain IV of HER2; pertuzumab binds domain II and physically blocks
        HER2 from dimerizing with HER3. Trastuzumab plus chemotherapy was
        the 1998 approval that started everything, and adding pertuzumab on
        top (the CLEOPATRA regimen) became the long-running first-line
        standard in metastatic HER2-positive breast cancer. Both need
        abundant surface receptor, so they are amplified-disease drugs.
      </p>
      <p>
        <strong>Antibody-drug conjugates.</strong> An ADC uses the antibody
        only as a delivery vehicle for a cytotoxic payload. T-DM1
        (trastuzumab emtansine) carries a maytansinoid microtubule poison on
        a non-cleavable linker. T-DXd (trastuzumab deruxtecan) carries a
        topoisomerase I inhibitor on a cleavable linker, and because the
        freed payload can cross into neighboring cells, it kills tumor even
        where HER2 expression is sparse. That bystander effect is exactly
        why T-DXd works in HER2-low disease where naked antibodies do
        nothing. Interstitial lung disease is the toxicity that defines
        T-DXd&rsquo;s safety monitoring.
      </p>
      <p>
        <strong>Small-molecule tyrosine kinase inhibitors.</strong> These
        bind the intracellular ATP pocket. Lapatinib is a reversible dual
        EGFR/HER2 inhibitor; neratinib is an irreversible pan-HER inhibitor
        whose dose-limiting toxicity is diarrhea; tucatinib is HER2-selective
        and crosses the blood-brain barrier well enough to matter for
        patients with brain metastases. This is the only drug class that is
        a docking problem.
      </p>
      <p>
        <strong>The HER2-mutant lane.</strong> HER2 mutations turned out to
        respond to ADCs rather than to the TKIs designed against amplified
        disease. T-DXd earned accelerated approval for HER2-mutant NSCLC in
        2022, the first targeted therapy for that population, on the
        strength of the DESTINY-Lung data. The TKIs have had a harder time
        here: neratinib and tucatinib show activity against some
        kinase-domain mutants in basket trials, but the exon 20 insertions
        in particular reshape the pocket in ways that blunt the
        ATP-competitive drugs.
      </p>

      <h2>How HER2-positive tumors escape</h2>
      <p>
        Resistance to trastuzumab clusters around the downstream pathway
        rather than the receptor itself. PIK3CA activating mutations and
        PTEN loss both reactivate PI3K/AKT signaling underneath a fully
        blocked receptor. A truncated form of the receptor called p95HER2,
        which lacks the extracellular domain trastuzumab binds, leaves the
        kinase active with nothing for the antibody to grab. Each of these
        is a reason a HER2 program eventually needs either an ADC (deliver a
        payload regardless of signaling) or a kinase inhibitor (hit the
        catalytic domain p95HER2 still has).
      </p>

      <h2>Try the molecular docking yourself</h2>
      <p>
        Only one of the four drug classes is a molecular docking
        problem. Antibodies and ADCs are engineered against the
        extracellular domain and, in the ADC case, do their real work
        through a payload, so there is no small-molecule pose to score.
        The TKIs are different: lapatinib, neratinib, and tucatinib all sit
        in the HER2 kinase ATP pocket, and kinase-domain mutations like
        L755S and V777L change that pocket directly.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        on Liganx, the free molecular docking online platform, and pick HER2
        from the target catalog, then choose a kinase-domain mutation from
        the mutation chips. Run molecular docking on the three TKIs against
        wild-type and mutant side by side and watch the ΔΔ: the number that
        tells you whether a mutation is likely to keep, weaken, or break a
        given inhibitor is the wild-type-to-mutant gap, not any single
        absolute score. The ADMET panel will also flag the diarrhea-adjacent
        and hepatic liabilities that have shaped this drug class&rsquo;s
        tolerability.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Slamon DJ, et al. <em>Use of chemotherapy plus a monoclonal
          antibody against HER2 for metastatic breast cancer that
          overexpresses HER2.</em> NEJM 344, 783-792 (2001).{" "}
          <a
            href="https://doi.org/10.1056/NEJM200103153441101"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJM200103153441101
          </a>
        </li>
        <li>
          Modi S, et al. <em>Trastuzumab deruxtecan in previously treated
          HER2-low advanced breast cancer.</em> NEJM 387, 9-20 (2022).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2203690"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2203690
          </a>
        </li>
        <li>
          Li BT, et al. <em>Trastuzumab deruxtecan in HER2-mutant
          non-small-cell lung cancer.</em> NEJM 386, 241-251 (2022).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2112431"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2112431
          </a>
        </li>
      </ul>
    </>
  );
}
