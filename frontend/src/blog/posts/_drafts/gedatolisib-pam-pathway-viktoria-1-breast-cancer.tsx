/**
 * Post: Gedatolisib and pan-PAM-pathway inhibition (VIKTORIA-1)
 *
 * Draft (auto-generated). Awaiting human review before publish.
 * Theme: news / clinical. Timely: gedatolisib NDA under FDA priority
 * review, PDUFA July 17 2026, VIKTORIA-1 positive in HR+/HER2- breast
 * cancer. Distinct from existing PIK3CA point-mutation posts because the
 * angle is whole-pathway (PI3K + mTORC1/2) blockade, not a single mutant.
 * SEO target: "gedatolisib", "PI3K AKT mTOR inhibitor breast cancer",
 * "VIKTORIA-1", "PAM pathway", "molecular docking PI3K alpha".
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "gedatolisib-pam-pathway-viktoria-1-breast-cancer",
  title: "Gedatolisib: hitting the whole PI3K/AKT/mTOR pathway at once",
  description:
    "A pan-PAM-pathway inhibitor is up for an FDA decision in July 2026 after positive VIKTORIA-1 data. Why blocking PI3K and mTOR together is a different bet from PIK3CA-selective drugs.",
  date: "2026-07-10",
  author: "Liganx team",
  tags: ["pi3k", "mtor", "breast-cancer", "clinical-news"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        The PI3K/AKT/mTOR axis, often shortened to the PAM pathway, is one of
        the most frequently activated signaling routes in HR-positive breast
        cancer, and it has been one of the most frustrating to drug. Selective
        PI3K-alpha inhibitors work, but tumors adapt fast by rerouting through
        AKT and mTOR. Gedatolisib takes the opposite approach: block several
        nodes of the pathway at once. With a positive phase 3 readout and an
        FDA decision expected on July 17, 2026, it is worth understanding what
        that bet actually is.
      </p>

      <h2>The adaptive-resistance problem</h2>
      <p>
        Drugs like alpelisib and inavolisib target PI3K-alpha specifically,
        which is elegant when the tumor carries an activating PIK3CA mutation
        such as E545K or H1047R. The catch is feedback: inhibit one node and
        the pathway compensates, reactivating downstream AKT and mTOR through
        loss of negative feedback and parallel receptor signaling. Single-node
        blockade buys time, but the pathway is a network, not a wire, and
        networks route around damage.
      </p>

      <h2>What gedatolisib does differently</h2>
      <p>
        Gedatolisib is a reversible, ATP-competitive inhibitor that hits all
        four class I PI3K isoforms (alpha, beta, gamma, delta) plus both mTOR
        complexes, mTORC1 and mTORC2. Blocking mTORC1/2 alongside PI3K is the
        key design choice: it closes the downstream escape valve that opens
        when you inhibit PI3K alone, and it does so regardless of PIK3CA
        mutation status. That last point matters clinically, because it puts
        PIK3CA wild-type tumors, the majority, back on the table.
      </p>

      <h2>The VIKTORIA-1 readout</h2>
      <p>
        VIKTORIA-1 is a phase 3 trial in HR-positive, HER2-negative advanced
        breast cancer that had progressed after a CDK4/6 inhibitor plus an
        aromatase inhibitor, the hardest post-CDK4/6 setting. It tested
        gedatolisib plus fulvestrant, with or without palbociclib, against
        fulvestrant alone.
      </p>
      <ul>
        <li>
          <strong>PIK3CA wild-type cohort</strong> - the gedatolisib triplet
          (plus fulvestrant and palbociclib) reduced the risk of progression
          or death by 76% versus fulvestrant alone (hazard ratio 0.24; 95% CI
          0.17-0.35; P &lt; 0.0001). A wild-type population responding this
          strongly is the headline result, since it is the group PIK3CA-
          selective drugs leave out.
        </li>
        <li>
          <strong>PIK3CA-mutant cohort</strong> - also met its primary
          endpoint with a clinically meaningful progression-free survival
          improvement, confirming the mechanism is not limited to wild-type
          disease.
        </li>
        <li>
          <strong>Tolerability</strong> - adverse events were described as
          manageable with no new safety signals, though broad
          pathway inhibition historically brings hyperglycemia, stomatitis,
          and rash, which is where the risk-benefit conversation will land.
        </li>
      </ul>

      <h2>The tradeoff, stated plainly</h2>
      <p>
        Broad pathway coverage is a double-edged sword. Hitting more nodes
        should slow adaptive resistance, but the same PI3K/mTOR biology that
        drives tumors also runs normal glucose metabolism, so on-target
        toxicity is the price. Whether gedatolisib's efficacy justifies its
        tolerability profile relative to cleaner PIK3CA-selective agents is the
        question the label and real-world use will answer. Full data are slated
        for a late-breaking presentation at ASCO 2026.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The structural story here lives in the PI3K-alpha ATP pocket.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick PI3K-alpha (PIK3CA) from the target catalog, then add the
        E545K or H1047R mutation to compare how a candidate binds the
        wild-type versus the activated kinase. Docking a multi-target,
        ATP-competitive scaffold against PI3K-alpha shows why selectivity is
        hard: the ATP pocket is conserved across the PI3K isoforms and mTOR, so
        a compound that fits one tends to fit several. Liganx is molecular
        docking online, free and browser-based, which makes it easy to line up
        wild-type and mutant PIK3CA side by side. If you want to try molecular
        docking on a PAM-pathway target without setting up a local pipeline,
        that is the fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Rugo HS, et al. <em>VIKTORIA-1: Gedatolisib Plus Fulvestrant With or
          Without Palbociclib in HR-Positive, HER2-Negative, PIK3CA Wild-Type
          Advanced Breast Cancer.</em> J Clin Oncol (2026).{" "}
          <a
            href="https://doi.org/10.1200/JCO-25-02643"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1200/JCO-25-02643
          </a>
        </li>
        <li>
          Celcuity Inc. <em>Phase 3 VIKTORIA-1 Trial Achieves Primary Endpoint
          in PIK3CA-Mutant Cohort.</em> Press release, May 1, 2026.{" "}
          <a
            href="https://ir.celcuity.com/news-releases/news-release-details/celcuitys-phase-3-viktoria-1-trial-achieves-primary-endpoint"
            target="_blank"
            rel="noreferrer noopener"
          >
            ir.celcuity.com
          </a>
        </li>
        <li>
          ClinicalTrials.gov. <em>Gedatolisib Plus Fulvestrant With or Without
          Palbociclib vs Standard-of-Care in HR+/HER2- Breast Cancer
          (VIKTORIA-1).</em>{" "}
          <a
            href="https://clinicaltrials.gov/study/NCT05501886"
            target="_blank"
            rel="noreferrer noopener"
          >
            NCT05501886
          </a>
        </li>
      </ul>
    </>
  );
}
