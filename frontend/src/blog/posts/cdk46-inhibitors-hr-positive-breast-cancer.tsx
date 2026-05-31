/**
 * Post: CDK4/6 inhibitors in HR+/HER2- breast cancer
 *
 * SEO target: "CDK4/6 inhibitors", "palbociclib ribociclib abemaciclib",
 * "HR positive breast cancer treatment". Internal CTA links to /studio
 * for docking against CDK6 with the relevant ATP-pocket structure.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "cdk46-inhibitors-hr-positive-breast-cancer",
  title: "CDK4/6 inhibitors in HR+ breast cancer: three approvals, one class",
  description:
    "Palbociclib, ribociclib, and abemaciclib all hit the same kinase pair but differ on selectivity, dosing, and toxicity. Here is how the class actually splits.",
  date: "2026-05-28",
  author: "Liganx team",
  tags: ["cdk4", "cdk6", "breast-cancer", "kinase", "oncology"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Three CDK4/6 inhibitors carry FDA approval for hormone-receptor-positive,
        HER2-negative metastatic breast cancer, and a fourth has joined the
        adjuvant setting. They all target the same kinase pair, all combine
        with endocrine therapy, all gate the G1-to-S transition at the
        retinoblastoma checkpoint. But the three drugs are not interchangeable
        once you look past the mechanism, and the differences that matter
        clinically come down to selectivity, dosing schedule, and the off-target
        profile each chemotype carries with it.
      </p>

      <h2>Why CDK4/6 was the pharmacology bet</h2>
      <p>
        In HR-positive breast cancer, estrogen receptor signaling drives cyclin
        D1 transcription. Cyclin D1 partners with CDK4 and CDK6, the complex
        phosphorylates the retinoblastoma protein (Rb), Rb releases E2F, and
        the cell commits to S phase. Hit CDK4/6 and you stall that commitment
        step. The cell does not die, it senesces or arrests. Combine with
        endocrine therapy that drops the upstream estrogen signal and you
        get durable cytostasis rather than a quick rebound.
      </p>
      <p>
        Earlier pan-CDK inhibitors (flavopiridol, dinaciclib) failed in solid
        tumors because they also took out CDK1, CDK2, and CDK9. Killing CDK1
        means killing every dividing cell in the body, which is why those
        molecules behaved like cytotoxic chemotherapy with kinase-inhibitor
        pharmacokinetics. The CDK4/6-selective generation, starting with
        palbociclib, finally captured the cytostatic effect without the bone
        marrow wipeout.
      </p>

      <h2>The three approved compounds</h2>
      <ul>
        <li>
          <strong>Palbociclib (PD-0332991, Ibrance)</strong> — Pfizer, FDA
          approved February 2015. PALOMA-2 reported a median progression-free
          survival of 24.8 months with letrozole versus 14.5 months on letrozole
          alone in first-line metastatic disease. 125 mg once daily, three weeks
          on and one week off. The dose-limiting toxicity is neutropenia, which
          is on-mechanism CDK6 inhibition in the myeloid lineage rather than a
          cytotoxic effect.
        </li>
        <li>
          <strong>Ribociclib (LEE011, Kisqali)</strong> — Novartis, FDA approved
          March 2017. MONALEESA-2 showed similar PFS benefit in first-line,
          and MONALEESA-7 extended the readout into premenopausal patients with
          ovarian suppression. The signal that changed prescribing was overall
          survival: MONALEESA-3 and -7 both crossed statistical significance
          for OS, while palbociclib trials largely did not. Ribociclib also
          carries a QT prolongation warning that the others do not, traceable
          to its hERG affinity, so baseline and on-treatment ECGs are required.
        </li>
        <li>
          <strong>Abemaciclib (LY2835219, Verzenio)</strong> — Eli Lilly, FDA
          approved September 2017. Different scheduling: continuous twice-daily
          dosing rather than the three-on-one-off cycle. The chemistry is more
          CDK4-leaning relative to CDK6, which shifts the toxicity profile
          away from neutropenia and toward diarrhea, the dose-limiting
          adverse event in MONARCH-2 and MONARCH-3. monarchE made abemaciclib
          the first CDK4/6 inhibitor approved in the adjuvant setting in 2021
          for high-risk early breast cancer, where it produced a durable
          invasive disease-free survival benefit.
        </li>
      </ul>
      <p>
        Dalpiciclib (Hengrui, approved in China 2021) and the ribociclib
        adjuvant indication out of NATALEE (2024) round out the current
        clinical landscape. NATALEE in particular extended CDK4/6 benefit to
        a broader stage-II and stage-III population than monarchE captured,
        with three years of ribociclib on top of endocrine therapy.
      </p>

      <h2>Resistance: not one mutation, several mechanisms</h2>
      <p>
        Unlike EGFR or ALK, CDK4/6 inhibitor resistance does not converge on
        a single gatekeeper mutation. The recurring drivers in clinical
        samples include Rb loss-of-function (the most disabling, since the
        whole point of CDK4/6 inhibition is to keep Rb hypophosphorylated),
        cyclin E1 amplification (which bypasses CDK4/6 by activating CDK2
        instead), FAT1 loss (de-represses cyclin D1), and reactivation of
        upstream growth signaling through ESR1, AKT1, or PIK3CA mutations.
        The clinical implication is that the post-progression combinations
        usually pivot to a different node — selective ER degraders for ESR1,
        PI3K-alpha inhibitors for PIK3CA, mTOR inhibitors for general
        upstream rescue — rather than escalating to a more potent CDK4/6
        inhibitor.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The canonical CDK6 ATP-pocket structure with palbociclib is{" "}
        <a
          href="https://www.rcsb.org/structure/2EUF"
          target="_blank"
          rel="noreferrer noopener"
        >
          2EUF
        </a>
        , and the abemaciclib-bound CDK6 structure is{" "}
        <a
          href="https://www.rcsb.org/structure/5L2S"
          target="_blank"
          rel="noreferrer noopener"
        >
          5L2S
        </a>
        .{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick CDK6 from the target catalog to dock candidates against
        the same ATP pocket the three approved drugs occupy. The hinge
        contact is to Val101, the gatekeeper is Phe98. Liganx is a
        free molecular docking online tool, and the ADMET panel will
        flag hERG liability — useful if you want to see why ribociclib
        carries the QT label and palbociclib does not. Molecular docking
        against CDK6 with the ADMET readout is exactly the workflow this
        class motivates.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Finn RS, et al. <em>Palbociclib and Letrozole in Advanced Breast
          Cancer.</em> NEJM 375, 1925-1936 (2016).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1607303"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1607303
          </a>
        </li>
        <li>
          Hortobagyi GN, et al. <em>Ribociclib as First-Line Therapy for
          HR-Positive, Advanced Breast Cancer.</em> NEJM 375, 1738-1748 (2016).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1609709"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1609709
          </a>
        </li>
        <li>
          Goetz MP, et al. <em>MONARCH 3: Abemaciclib As Initial Therapy for
          Advanced Breast Cancer.</em> J Clin Oncol 35, 3638-3646 (2017).{" "}
          <a
            href="https://doi.org/10.1200/JCO.2017.75.6155"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1200/JCO.2017.75.6155
          </a>
        </li>
        <li>
          Slamon DJ, et al. <em>Ribociclib plus Endocrine Therapy in Early
          Breast Cancer.</em> NEJM 390, 1080-1091 (2024).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2305488"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2305488
          </a>
        </li>
      </ul>
    </>
  );
}
