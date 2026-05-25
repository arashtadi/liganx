import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "vepdegestrant-first-protac-fda-approval-esr1",
  title: "The first PROTAC is approved: vepdegestrant in ESR1+ breast cancer",
  description:
    "The FDA approved vepdegestrant on May 1, 2026, the first PROTAC degrader ever cleared. What the VERITAC-2 data showed and why catalytic degradation matters.",
  date: "2026-05-23",
  author: "Liganx team",
  tags: ["protac", "breast-cancer", "esr1", "clinical-news"],
  readingMin: 5,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        On May 1, 2026 the FDA approved vepdegestrant (VEPPANU, ARV-471), an oral
        estrogen-receptor degrader from Arvinas and Pfizer, for ESR1-mutated,
        ER-positive, HER2-negative advanced or metastatic breast cancer. It is the
        first PROTAC ever approved by a major regulator, which makes it a
        milestone for a whole modality, not just one more endocrine agent.
      </p>

      <h2>What makes a PROTAC different from a SERD</h2>
      <p>
        Conventional selective estrogen receptor degraders such as fulvestrant
        bind the receptor and destabilize it, nudging it toward degradation
        through induced conformational instability. The relationship is
        one-to-one: one drug molecule occupies one receptor.
      </p>
      <p>
        A PROTAC is a bifunctional molecule. One end binds the estrogen receptor,
        a flexible linker bridges the middle, and the other end recruits an E3
        ubiquitin ligase, in vepdegestrant's case cereblon. By forcing the
        receptor and the ligase into proximity, the PROTAC tags the receptor with
        ubiquitin and hands it to the proteasome. The drug molecule then releases
        and does it again. That catalytic, event-driven mechanism is the
        conceptual prize: deeper target depletion at lower drug exposure than an
        occupancy-driven binder can achieve, and a mechanism that does not depend
        on continuously saturating every receptor copy.
      </p>

      <h2>The VERITAC-2 data</h2>
      <p>
        Approval rested on VERITAC-2 (NCT05654623), a global randomized phase 3
        trial comparing vepdegestrant monotherapy against fulvestrant in ER+/HER2-
        advanced breast cancer that had progressed on a CDK4/6 inhibitor plus
        endocrine therapy.
      </p>
      <ul>
        <li>
          <strong>ESR1-mutant population</strong> — vepdegestrant improved
          progression-free survival versus fulvestrant with a hazard ratio of
          0.57 (P=.0001), alongside a higher objective response rate.
        </li>
        <li>
          <strong>Intent-to-treat population</strong> — the PFS benefit did not
          reach significance across all-comers, which is why the label is
          restricted to the ESR1-mutated subgroup rather than every ER+ patient.
        </li>
        <li>
          <strong>Overall survival</strong> — still immature at the time of
          approval.
        </li>
      </ul>
      <p>
        The ESR1-mutant restriction is the clinically important detail. ESR1
        mutations are a dominant driver of acquired resistance to aromatase
        inhibitors, and they are exactly the setting where deeper receptor
        degradation should pay off. The FDA cleared the drug roughly five weeks
        ahead of its June 5, 2026 PDUFA date.
      </p>

      <h2>Why this matters beyond breast cancer</h2>
      <p>
        Degraders solve a problem that occupancy inhibitors structurally cannot:
        you cannot second-site-mutate a binding pocket to escape a drug if the
        protein no longer exists. The resistance-via-pocket-mutation pattern that
        ends so many kinase-inhibitor programs (think EGFR C797S or BCR-ABL T315I)
        is far harder to pull off against a degrader. Vepdegestrant's approval is
        the proof point the field needed that the modality can clear the
        regulatory bar, and it de-risks the dozens of PROTAC programs now aimed at
        targets from BTK to KRAS to androgen receptor.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        A PROTAC still has to bind its target with a real small-molecule warhead,
        and that binding end is an ordinary molecular docking problem: dock the
        target-engaging fragment into the ligand-binding domain, then let the
        linker and E3 ligand do the recruiting. If your interest is the
        breast-cancer kinase axis, <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">Open Studio</Link>{" "}
        and pick HER2 or PI3K-alpha from the target catalog to dock candidate
        ligands against the structures that sit downstream of ER signaling.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and mutation
        aware, so you can compare wild-type and mutant pockets in the same run. If
        you want to try molecular docking on an oncology target without a local
        install, that is the fastest path. For more on why PROTACs break the
        usual drug-likeness rules, see our earlier post on PROTAC oral
        bioavailability.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          U.S. Food and Drug Administration. <em>FDA approves vepdegestrant for
          ER-positive, HER2-negative, ESR1-mutated advanced or metastatic breast
          cancer</em> (May 2026).{" "}
          <a
            href="https://www.fda.gov/drugs/resources-information-approved-drugs/fda-approves-vepdegestrant-er-positive-her2-negative-esr1-mutated-advanced-or-metastatic-breast"
            target="_blank"
            rel="noreferrer noopener"
          >
            fda.gov
          </a>
        </li>
        <li>
          Arvinas, Inc. <em>Arvinas Announces FDA Approval of VEPPANU
          (vepdegestrant) for the Treatment of ESR1m, ER+/HER2- Advanced Breast
          Cancer</em> (press release, May 2026).{" "}
          <a
            href="https://ir.arvinas.com/news-releases/news-release-details/arvinas-announces-fda-approval-veppanu-vepdegestrant-treatment"
            target="_blank"
            rel="noreferrer noopener"
          >
            ir.arvinas.com
          </a>
        </li>
        <li>
          VERITAC-2: A Phase 3 Study of ARV-471 (PF-07850327) vs Fulvestrant in
          ER+/HER2- Advanced Breast Cancer.{" "}
          <a
            href="https://clinicaltrials.gov/study/NCT05654623"
            target="_blank"
            rel="noreferrer noopener"
          >
            ClinicalTrials.gov NCT05654623
          </a>
        </li>
      </ul>
    </>
  );
}
