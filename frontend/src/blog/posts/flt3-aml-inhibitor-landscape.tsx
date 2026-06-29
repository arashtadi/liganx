/**
 * Post: FLT3 in AML - the inhibitor landscape
 *
 * SEO target: "FLT3 inhibitors", "FLT3 AML treatment", "gilteritinib vs
 * quizartinib", "type I vs type II FLT3 inhibitor". Internal CTA into
 * /studio with FLT3 + D835Y so a reader can see the type I / type II
 * selectivity story for themselves.
 *
 * Theme: target / disease deep-dive. Distinct from the existing
 * mutation-specific post flt3-itd-d835y-aml-resistance.tsx, which covers
 * the resistance mechanics; this one is the drug-by-drug landscape.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "flt3-aml-inhibitor-landscape",
  title: "FLT3 in AML: the inhibitor landscape",
  description:
    "Midostaurin, gilteritinib, and quizartinib are all FLT3 inhibitors, but they bind different conformations and fail against different mutations. A field guide.",
  date: "2026-06-08",
  author: "Liganx team",
  tags: ["flt3", "aml", "oncology", "clinical-landscape"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        FLT3 is the most frequently mutated gene in acute myeloid leukemia,
        altered in roughly a third of patients, and for two decades it was a
        target everyone agreed mattered and nobody could drug well. Three
        inhibitors are now FDA approved, but treating them as interchangeable
        is a mistake. They bind different conformations of the kinase, hit
        different resistance mutations, and slot into different points in the
        treatment course. Here is the landscape as it actually stands.
      </p>

      <h2>Two kinds of FLT3 mutation</h2>
      <p>
        Before the drugs, the mutations. FLT3 lesions in AML come in two
        flavors, and the distinction drives everything downstream.
      </p>
      <ul>
        <li>
          <strong>Internal tandem duplications (FLT3-ITD)</strong> - in-frame
          duplications in the juxtamembrane domain, found in about 25% of AML.
          They relieve the autoinhibitory clamp and drive constitutive,
          ligand-independent signaling. ITD carries a high relapse rate and a
          high allelic ratio predicts worse outcomes.
        </li>
        <li>
          <strong>Tyrosine kinase domain point mutations (FLT3-TKD)</strong> -
          most commonly D835 substitutions in the activation loop, found in
          about 7-10%. These also activate the kinase, but they matter
          clinically because they confer resistance to a whole class of FLT3
          inhibitors, as we will see.
        </li>
      </ul>

      <h2>Type I versus type II: the conformation that decides everything</h2>
      <p>
        FLT3 inhibitors split into two structural classes by which kinase
        conformation they bind. This is the single most useful concept for
        making sense of the clinical data.
      </p>
      <p>
        <strong>Type II inhibitors</strong> bind the inactive, DFG-out
        conformation, reaching into the back hydrophobic pocket that opens
        when the activation loop swings away. The catch: the D835 activation-
        loop mutations stabilize the active, DFG-in state, so the DFG-out
        pocket the type II drug needs never forms. Type II inhibitors hit
        ITD beautifully and fail against D835.
      </p>
      <p>
        <strong>Type I inhibitors</strong> bind the active, DFG-in
        conformation in the ATP pocket itself. Because they do not depend on
        the activation loop being displaced, they retain activity against
        both ITD and the D835 TKD mutants. That breadth is why the type I
        agents became the relapsed/refractory workhorses.
      </p>

      <h2>The three approved drugs</h2>
      <ul>
        <li>
          <strong>Midostaurin (PKC412, Rydapt)</strong> - type I, but a
          broad multikinase inhibitor rather than a clean FLT3 agent. FDA
          approved April 2017 in combination with intensive induction and
          consolidation chemotherapy for newly diagnosed FLT3-mutated AML.
          The pivotal RATIFY trial (Stone et al., NEJM 2017) showed a
          significant overall and event-free survival benefit from adding
          midostaurin to 7+3 chemotherapy. It is a frontline add-on, not a
          single agent.
        </li>
        <li>
          <strong>Gilteritinib (ASP2215, Xospata)</strong> - type I, potent
          and selective for FLT3, active against both ITD and D835 TKD
          mutants. FDA approved November 2018 for relapsed or refractory
          FLT3-mutated AML on the strength of the ADMIRAL trial (Perl et al.,
          NEJM 2019), which beat salvage chemotherapy on overall survival
          (median 9.3 vs 5.6 months) as a single oral agent. This is the
          relapsed/refractory standard of care.
        </li>
        <li>
          <strong>Quizartinib (AC220, Vanflyta)</strong> - type II, highly
          ITD-selective. FDA approved July 2023 in combination with induction
          and consolidation chemotherapy, and as continuation monotherapy,
          for newly diagnosed FLT3-ITD-positive AML. The QuANTUM-First trial
          (Erba et al., Lancet 2023) reported a near-doubling of median
          overall survival (31.9 vs 15.1 months) versus chemotherapy alone.
          Note the label: ITD-positive only. Because it is type II, it does
          not reliably cover D835 TKD disease.
        </li>
      </ul>

      <h2>How resistance emerges</h2>
      <p>
        The resistance patterns track the conformation logic. Under type II
        pressure (quizartinib, or off-label sorafenib), tumors acquire
        activation-loop D835 mutations and the F691L gatekeeper mutation,
        both of which block the DFG-out pocket. Switching to a type I agent
        like gilteritinib can recover activity against D835, though F691L is
        harder for everyone because it sits at the gatekeeper position that
        controls access to the ATP pocket itself. Beyond on-target mutations,
        off-target escape through RAS/MAPK reactivation and FLT3-independent
        clones is common, which is why durable single-agent control is rare
        and combination strategies dominate the trial pipeline.
      </p>

      <h2>Where the field is going</h2>
      <p>
        Three threads are worth watching. Combinations with venetoclax and
        hypomethylating agents are extending FLT3 inhibition to older,
        unfit patients who cannot take intensive chemotherapy. Maintenance
        after allogeneic transplant, where FLT3 inhibitors suppress residual
        ITD clones, is increasingly standard. And next-generation agents and
        rational sequencing aim at the F691L gatekeeper and at the polyclonal
        resistance that limits every current drug.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The type I / type II distinction is exactly the kind of thing
        molecular docking makes tangible.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick FLT3 from the target catalog with the D835Y mutation chip,
        then dock a type II scaffold (quizartinib-like) and a type I scaffold
        (gilteritinib-like) against the same receptor. The type II compound
        should lose binding affinity against the activation-loop mutant while
        the type I compound holds, reproducing the clinical resistance story
        in silico. Liganx is molecular docking online: free, browser-based,
        and built for precisely this kind of mutation-aware comparison. If
        you want to try molecular docking on a FLT3 resistance mutation
        without a local install, that is the fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Stone RM, et al. <em>Midostaurin plus Chemotherapy for Acute
          Myeloid Leukemia with a FLT3 Mutation.</em> NEJM 377, 454-464
          (2017).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1614359"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1614359
          </a>
        </li>
        <li>
          Perl AE, et al. <em>Gilteritinib or Chemotherapy for Relapsed or
          Refractory FLT3-Mutated AML.</em> NEJM 381, 1728-1740 (2019).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1902688"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1902688
          </a>
        </li>
        <li>
          Erba HP, et al. <em>Quizartinib plus chemotherapy in newly
          diagnosed patients with FLT3-internal-tandem-duplication-positive
          acute myeloid leukaemia (QuANTUM-First): a randomised, double-blind,
          placebo-controlled, phase 3 trial.</em> Lancet 401, 1571-1583
          (2023).{" "}
          <a
            href="https://doi.org/10.1016/S0140-6736(23)00464-6"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/S0140-6736(23)00464-6
          </a>
        </li>
      </ul>
    </>
  );
}
