/**
 * Post: CDK2 inhibitors and CCNE1 amplification
 *
 * SEO target: "CDK2 inhibitor", "CCNE1 amplification ovarian cancer",
 * "CDK2 vs CDK1 selectivity", "cyclin E1 CDK4/6 resistance". Internal
 * link to /studio with CDK2 as the docking target.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "cdk2-inhibitors-ccne1-amplification-selectivity",
  title: "CDK2 inhibitors: CCNE1 amplification and the CDK1 problem",
  description:
    "Why CCNE1-amplified ovarian cancer is the lead indication for selective CDK2 inhibitors, and why separating CDK2 from CDK1 is the hardest part of the chemistry.",
  date: "2026-08-08",
  author: "Liganx team",
  tags: ["cdk2", "ccne1", "oncology", "kinase-selectivity"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        CDK4/6 inhibitors turned into a multi-billion-dollar class. CDK2 sat
        next door the whole time, genetically validated and chemically
        stubborn, because the ATP pocket you need to hit looks almost
        exactly like the ATP pocket of CDK1 — and inhibiting CDK1 is how you
        stop mitosis in every dividing cell in the body. Five selective CDK2
        inhibitors are now in the clinic. Here is the biology that got them
        there and the medicinal chemistry that had to be solved first.
      </p>

      <h2>Why CCNE1 is the lead indication</h2>
      <p>
        Cyclin E1, the product of <em>CCNE1</em>, is the activating partner
        that switches CDK2 on at the G1/S boundary. The CDK2/cyclin E1
        complex phosphorylates RB, releases E2F, and commits the cell to
        replication. Amplify the cyclin and you get a cell that no longer
        waits for a growth signal to cross that boundary.
      </p>
      <p>
        In high-grade serous ovarian carcinoma, <em>CCNE1</em> amplification
        occurs in roughly 15 to 20% of tumors. It behaves like an early
        truncal event, it is largely mutually exclusive with BRCA1/2
        alteration, and it tracks with platinum resistance and shorter
        progression-free survival. That combination is what makes it a good
        drug-development target: a defined biomarker population, a genuine
        unmet need (these are the HR-proficient patients PARP inhibitors
        serve poorly), and a clean mechanistic hypothesis for dependency.
      </p>
      <p>
        The second indication is resistance rather than amplification.
        Cyclin E1 overexpression is one of the recurring escape routes out
        of CDK4/6 inhibition in HR-positive breast cancer: the tumor stops
        routing RB phosphorylation through CDK4/6 and routes it through
        CDK2 instead. That makes CDK2 inhibition a rational partner for
        ribociclib or palbociclib rather than a replacement.
      </p>

      <h2>The CDK1 problem</h2>
      <p>
        CDK1 is the mitotic kinase and the only CDK that is strictly
        essential in mammalian cells. A CDK2 inhibitor with meaningful CDK1
        cross-reactivity is, functionally, an antimitotic — you inherit
        neutropenia and a narrow therapeutic index, and you lose the
        selectivity argument that justified the program.
      </p>
      <p>
        The difficulty is that CDK1 and CDK2 have nearly superimposable
        ATP sites. The hinge, the gatekeeper, and most of the back pocket
        are conserved. The handle the field has converged on is a single
        hinge-adjacent substitution, lysine 89 in CDK2 against aspartate 86
        in CDK1, which flips the local electrostatics of the solvent-exposed
        edge of the pocket. Compounds that place a carboxylate or another
        anionic or strongly polar group toward that position pick up
        favorable interaction in CDK2 and pay a desolvation and repulsion
        penalty in CDK1. It is a small difference to build a whole series
        on, which is why these programs lean heavily on structure-based
        design and free-energy methods rather than on scaffold hopping.
      </p>
      <p>
        There is a second selectivity axis that is easy to underrate: CDK9.
        CDK9 inhibition drives MCL1 loss and acute toxicity, and it is a
        common off-target for ATP-competitive CDK chemotypes. A credible
        CDK2 candidate has to report selectivity over CDK1, CDK4, CDK6,
        CDK9, and usually GSK3B before anyone takes the profile seriously.
      </p>

      <h2>What is actually in the clinic</h2>
      <ul>
        <li>
          <strong>Tagtociclib (PF-07104091)</strong> — Pfizer. Reported Ki of
          1.16 nM against CDK2/cyclin E1, with roughly 100-fold selectivity
          over CDK1, 200 to 400-fold over CDK4 and CDK6, and about 170-fold
          over CDK9. Developed through structure-based design out of an
          earlier CDK2/4/6 series.
        </li>
        <li>
          <strong>BLU-222</strong> — Blueprint Medicines, in the VELA study
          (NCT05252416) as monotherapy and in combination with ribociclib
          plus fulvestrant in HR-positive breast cancer. The 2025 Cancer
          Research profiling paper is the most useful preclinical readout in
          the class: response in CCNE1-aberrant models tracked with
          coordinate expression of cyclin E, p16INK4A, and RB, and
          combination with carboplatin or paclitaxel resensitized
          chemotherapy-resistant models.
        </li>
        <li>
          <strong>INX-315</strong> — Incyclix Bio. Granted FDA Fast Track
          designation in CCNE1-amplified, platinum-resistant ovarian cancer.
          Interim dose-escalation data from the phase 1/2 study
          (NCT05735080) in CCNE1-amplified high-grade serous ovarian cancer
          reported one partial response and eight cases of stable disease
          among ten evaluable patients, with no discontinuations for adverse
          events. Small numbers, early, but the disease-control signal is
          what earned the designation.
        </li>
        <li>
          <strong>INCB123667</strong> — Incyte, in phase 1a/b (NCT05238922)
          in CCNE1-high advanced malignancies.
        </li>
        <li>
          <strong>ARTS-021</strong> — Allorion Therapeutics, early clinical
          development.
        </li>
      </ul>

      <h2>The RB caveat</h2>
      <p>
        CDK2 inhibition works by restoring the RB brake. If RB1 is deleted
        or mutated, there is no brake to restore, and the mechanism is dead
        regardless of how much cyclin E1 the tumor makes. The same logic
        that made RB status a stratification variable for CDK4/6 inhibitors
        applies here, and the BLU-222 profiling data support it directly:
        intact RB was part of the expression signature that predicted
        response. Any biomarker strategy that reads <em>CCNE1</em> copy
        number without also reading RB1 status is going to enroll patients
        who cannot benefit.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        A useful structural starting point is{" "}
        <a
          href="https://www.rcsb.org/structure/7KJS"
          target="_blank"
          rel="noreferrer noopener"
        >
          7KJS
        </a>
        , the CDK2/cyclin E complex with PF-06873600 bound — the ATP site
        with the hinge region and the Lys89 edge clearly resolved.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock your candidate against CDK2, then repeat the run against
        CDK1 and compare. Selectivity in this series is a difference of
        differences, not an absolute number, so the comparison across the
        two receptors tells you far more than either score alone. If your
        compound scores equally well against both, you have an antimitotic,
        not a CDK2 inhibitor.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and built
        for exactly this kind of paired-target selectivity question. If you
        want to run molecular docking against CDK2 without a local install,
        that is the fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Blueprint Medicines research team.{" "}
          <em>
            Profiling the Activity of the Potent and Highly Selective CDK2
            Inhibitor BLU-222 Reveals Determinants of Response in
            CCNE1-Aberrant Ovarian and Endometrial Tumors.
          </em>{" "}
          Cancer Research 85, 1297 (2025).{" "}
          <a
            href="https://doi.org/10.1158/0008-5472.CAN-24-2360"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/0008-5472.CAN-24-2360
          </a>
        </li>
        <li>
          <em>
            INX-315, a Selective CDK2 Inhibitor, Induces Cell Cycle Arrest
            and Senescence in Solid Tumors.
          </em>{" "}
          Cancer Research Communications (2024).{" "}
          <a
            href="https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10905675/"
            target="_blank"
            rel="noreferrer noopener"
          >
            PMC10905675
          </a>
        </li>
        <li>
          VELA: Study of BLU-222 in Advanced Solid Tumors.{" "}
          <a
            href="https://clinicaltrials.gov/study/NCT05252416"
            target="_blank"
            rel="noreferrer noopener"
          >
            NCT05252416
          </a>{" "}
          and INX-315-01,{" "}
          <a
            href="https://clinicaltrials.gov/study/NCT05735080"
            target="_blank"
            rel="noreferrer noopener"
          >
            NCT05735080
          </a>
          .
        </li>
        <li>
          RCSB PDB entry{" "}
          <a
            href="https://www.rcsb.org/structure/7KJS"
            target="_blank"
            rel="noreferrer noopener"
          >
            7KJS
          </a>{" "}
          — crystal structure of CDK2/cyclin E in complex with PF-06873600.
        </li>
      </ul>
    </>
  );
}
