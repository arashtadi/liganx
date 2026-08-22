/**
 * Post: OATP1B1/1B3 transporter DDIs in oncology TKIs
 *
 * ADMET theme. SEO target: "OATP1B1 drug-drug interaction", "hepatic
 * uptake transporter", "statin DDI kinase inhibitor". Internal CTA into
 * /studio's ADMET panel.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "oatp1b1-transporter-ddi-kinase-inhibitors",
  title: "OATP1B1: the uptake transporter behind statin DDIs",
  description:
    "Why hepatic uptake transporters cause some of the most clinically important oncology drug interactions, and what OATP1B1 inhibition means for co-medications.",
  date: "2026-07-20",
  author: "Liganx team",
  tags: ["admet", "transporters", "ddi", "pharmacokinetics"],
  readingMin: 5,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Most drug-interaction thinking starts and stops with cytochrome P450
        metabolism. But a drug has to get into the hepatocyte before an enzyme
        can touch it, and for a large class of anionic drugs that entry step is
        an active transport process, not passive diffusion. The transporters
        that run it, chiefly OATP1B1 and OATP1B3, are a real and
        underappreciated source of clinical drug-drug interactions, and
        oncology tyrosine kinase inhibitors are among the worst offenders.
      </p>

      <h2>What OATP1B1 actually does</h2>
      <p>
        OATP1B1 (encoded by SLCO1B1) is a hepatic uptake transporter expressed
        on the sinusoidal membrane of hepatocytes, the surface facing the
        blood. Its job is to pull anionic and amphipathic molecules out of
        portal circulation and into the liver, where they can be metabolized or
        excreted into bile. Its close relative OATP1B3 (SLCO1B3) sits alongside
        it with overlapping substrate specificity. Together they gate hepatic
        clearance for a long list of drugs including the statins, several
        chemotherapeutics, and many endogenous compounds like bilirubin.
      </p>
      <p>
        The consequence is simple: if you block OATP1B1, substrate drugs
        can&rsquo;t get into the liver efficiently. Their plasma concentrations
        rise, their exposure (AUC) climbs, and any concentration-dependent
        toxicity gets amplified.
      </p>

      <h2>The statin example, and why it matters</h2>
      <p>
        The canonical OATP1B1 story is the statins. Statins are OATP1B1
        substrates that act in the liver, so uptake is both their route to the
        target and their route to clearance. The genetics make the point
        vividly. A common SLCO1B1 variant that reduces transporter function is
        strongly associated with simvastatin-induced myopathy, one of the first
        clear examples of a transporter polymorphism driving a clinical adverse
        event. If a genetic loss of OATP1B1 function raises statin exposure
        enough to cause muscle toxicity, a co-administered drug that inhibits
        the same transporter can do the same thing pharmacologically.
      </p>

      <h2>Why TKIs are repeat offenders</h2>
      <p>
        Oncology kinase inhibitors are oral, chronically dosed, and reach high
        systemic concentrations, and many of them are potent OATP1B1 and
        OATP1B3 inhibitors in vitro. That combination means a patient on a TKI
        plus a statin, or a TKI plus another OATP substrate, can accumulate the
        co-medication to toxic levels even though the TKI itself is behaving
        normally.
      </p>
      <ul>
        <li>
          <strong>The interaction is often at uptake, not metabolism.</strong>{" "}
          A clean CYP profile does not rule out a serious DDI if the drug
          inhibits hepatic uptake transporters.
        </li>
        <li>
          <strong>Pre-incubation can worsen inhibition.</strong> Some TKIs
          inhibit OATP1B1 more strongly after the transporter has been
          pre-exposed to them, a time-dependent effect now written into FDA
          draft guidance for in vitro OATP1B DDI studies.
        </li>
        <li>
          <strong>The victim drug carries the risk.</strong> The clinically
          dangerous outcome is usually elevated exposure of the co-medication
          (a statin, methotrexate, or similar), not of the TKI.
        </li>
      </ul>

      <h2>How this gets predicted</h2>
      <p>
        Regulators expect every new oral oncology drug to be screened in vitro
        against OATP1B1 and OATP1B3, typically by measuring inhibition of a
        probe substrate uptake in transfected cells and computing an IC50. If
        the drug inhibits at clinically relevant concentrations, a dedicated
        clinical DDI study with a sensitive substrate (often a statin) usually
        follows. In silico ADMET models flag transporter liability earlier,
        letting a team see a potential uptake-transporter problem before it
        shows up as unexplained co-medication toxicity in the clinic.
      </p>

      <h2>Try the prediction yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock any candidate, then open the ADMET panel on a result row to
        review its pharmacokinetic liability profile alongside the cardiac and
        hepatic readouts. Transporter and metabolism flags are easiest to reason
        about next to the binding pose, and pairing molecular docking online
        with the ADMET panel is how you catch a pharmacokinetic problem before
        it becomes a clinical one. Screening for uptake-transporter liability
        early is a cheap insurance policy against a late-stage DDI surprise.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Garrison DA, Talebi Z, Eisenmann ED, Sparreboom A, Baker SD.{" "}
          <em>Role of OATP1B1 and OATP1B3 in Drug-Drug Interactions Mediated by
          Tyrosine Kinase Inhibitors.</em> Pharmaceutics 12, 856 (2020).{" "}
          <a
            href="https://doi.org/10.3390/pharmaceutics12090856"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.3390/pharmaceutics12090856
          </a>
        </li>
        <li>
          SEARCH Collaborative Group. <em>SLCO1B1 variants and statin-induced
          myopathy - a genomewide study.</em> N Engl J Med 359, 789-799 (2008).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa0801936"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa0801936
          </a>
        </li>
        <li>
          Shitara Y. <em>Clinical importance of OATP1B1 and OATP1B3 in
          drug-drug interactions.</em> Drug Metab Pharmacokinet 26, 220-227
          (2011).{" "}
          <a
            href="https://doi.org/10.2133/dmpk.DMPK-10-RV-094"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.2133/dmpk.DMPK-10-RV-094
          </a>
        </li>
      </ul>
    </>
  );
}
