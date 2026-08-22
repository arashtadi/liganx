/**
 * Post: IDH2 R140Q / R172K — enasidenib and mutant-IDH2 AML
 *
 * SEO target: long-tail queries around "IDH2 mutation AML", "enasidenib
 * resistance", "IDH2 R140Q vs R172K", "2-hydroxyglutarate oncometabolite".
 * Internal link to /studio with IDH2 + R140Q so a reader can see the
 * allosteric dimer-interface pocket for themselves. That's the conversion moment.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "idh2-r140q-r172k-enasidenib-aml",
  title: "IDH2 R140Q and R172K — the enasidenib story in AML",
  description:
    "Why mutant IDH2 makes an oncometabolite instead of losing function, how enasidenib blocks it at the dimer interface, and why R172K responds better than R140Q.",
  date: "2026-07-01",
  author: "Liganx team",
  tags: ["idh2", "oncology", "mutation-spotlight", "aml"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Most cancer-driver mutations either switch a protein on or knock it
        out. IDH2 does something stranger: the mutant enzyme gains a brand-new
        catalytic activity it never had, and the product of that activity is
        what drives the leukemia. That neomorphic behavior is the entire reason
        enasidenib exists, and it is also why the two most common IDH2 alleles
        do not respond to the drug equally.
      </p>

      <h2>The neomorphic gain-of-function</h2>
      <p>
        Wild-type IDH2 sits in the mitochondrion and converts isocitrate to
        alpha-ketoglutarate (alpha-KG). The recurrent AML mutations at arginine
        140 and arginine 172 rewire the active site so the enzyme instead
        reduces alpha-KG to D-2-hydroxyglutarate (2-HG). 2-HG is an
        oncometabolite: it accumulates to millimolar levels and competitively
        inhibits the large family of alpha-KG-dependent dioxygenases, including
        the TET DNA demethylases and the Jumonji histone demethylases.
      </p>
      <p>
        The downstream consequence is a global hypermethylation state that locks
        myeloid precursors in an undifferentiated, proliferative condition. The
        cells cannot mature into functional blood cells, which is the defining
        pathology of acute myeloid leukemia. Critically, the block is
        epigenetic and reversible, not a fixed genetic lesion, which is why an
        inhibitor that shuts off 2-HG production can release the differentiation
        brake rather than simply killing cells.
      </p>

      <h2>Two alleles, two dimers</h2>
      <p>
        IDH2 mutations appear in roughly 15-20% of AML, and the two dominant
        alleles behave differently at the protein level:
      </p>
      <ul>
        <li>
          <strong>R140Q</strong> — about three-quarters of IDH2-mutant cases.
          It sits at the dimer interface rather than deep in the catalytic
          pocket, and it drives 2-HG production efficiently as a homodimer and
          as an R140Q/wild-type heterodimer.
        </li>
        <li>
          <strong>R172K</strong> — about a quarter of cases. This arginine is
          part of the isocitrate-binding triad; substituting it produces higher
          steady-state 2-HG and a cleaner dependence on the mutant enzyme,
          typically as an R172K/wild-type heterodimer.
        </li>
      </ul>

      <h2>How enasidenib binds</h2>
      <p>
        Enasidenib (AG-221, Idhifa) is not an active-site competitor. It is a
        slow, tight-binding allosteric inhibitor that lodges at the IDH2
        homodimer interface, wedging into the pocket between the two subunits
        and holding the enzyme in an open, catalytically incompetent
        conformation. Because it locks the conformational change the mutant
        needs to produce 2-HG, it inhibits the R140Q homodimer, the R140Q/WT
        heterodimer, and the R172K/WT heterodimer. The FDA approved it in
        August 2017 for relapsed or refractory IDH2-mutant AML on the strength
        of the phase 1/2 program, which reported an overall response rate near
        40% with about 19% complete remissions.
      </p>
      <p>
        The allele split shows up in the clinic: pooled data put the R172
        response rate above 50%, versus the mid-30s for R140. The plausible
        explanation is the tighter oncometabolite dependence of R172K disease.
      </p>

      <h2>Differentiation, not cytotoxicity — and its own syndrome</h2>
      <p>
        Because enasidenib works by lifting the maturation block, responding
        patients see their leukemic blasts differentiate into functional
        myeloid cells rather than undergo rapid apoptosis. That mechanism
        carries a characteristic hazard: IDH differentiation syndrome, a
        cytokine-driven picture of dyspnea, fever, pulmonary infiltrates and
        effusions. A pooled clinical-trial analysis found differentiation
        syndrome events of any grade in roughly 10% of treated patients, which
        is why it carries a boxed warning and is managed with prompt
        corticosteroids rather than drug discontinuation in most cases.
      </p>

      <h2>Resistance and what comes after</h2>
      <p>
        Relapse on enasidenib has been traced to several routes: second-site
        IDH2 mutations that reshape the allosteric pocket, and isoform
        switching in which the tumor begins producing 2-HG from mutant IDH1
        instead, restoring the oncometabolite from the other enzyme entirely.
        The latter is a clean argument for targeting the metabolic output
        rather than any single enzyme, and it motivates the dual IDH1/IDH2
        inhibitors and combination regimens now in trials.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        Enasidenib is a useful test case precisely because its pocket is not the
        catalytic site — it sits at the dimer interface, which is exactly the
        kind of allosteric geometry that trips up naive docking runs.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick IDH2 with the R140Q mutation to dock against the mutant dimer.
        Because Liganx renders the wild-type and mutant receptors together, you
        can check whether your candidate actually reads the interface change
        that distinguishes R140Q from wild-type. This is molecular docking
        online, free and browser-based, set up for exactly this mutation-aware
        question — the fastest way to try molecular docking on an IDH2 allele
        without a local install.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Stein EM, et al. <em>Enasidenib in mutant IDH2 relapsed or refractory
          acute myeloid leukemia.</em> Blood 130, 722-731 (2017).{" "}
          <a
            href="https://doi.org/10.1182/blood-2017-04-779405"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1182/blood-2017-04-779405
          </a>
        </li>
        <li>
          Yen K, et al. <em>AG-221, a first-in-class therapy targeting acute
          myeloid leukemia harboring oncogenic IDH2 mutations.</em> Cancer
          Discov 7, 478-493 (2017).{" "}
          <a
            href="https://doi.org/10.1158/2159-8290.CD-16-1034"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2159-8290.CD-16-1034
          </a>
        </li>
        <li>
          Fathi AT, et al. <em>Differentiation syndrome associated with
          enasidenib, a selective inhibitor of mutant IDH2.</em> JAMA Oncol 4,
          1106-1110 (2018).{" "}
          <a
            href="https://doi.org/10.1001/jamaoncol.2017.4695"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1001/jamaoncol.2017.4695
          </a>
        </li>
      </ul>
    </>
  );
}
