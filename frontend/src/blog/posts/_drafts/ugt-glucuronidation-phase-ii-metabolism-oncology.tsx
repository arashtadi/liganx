/**
 * Post: UGT glucuronidation and phase II metabolism in oncology
 *
 * ADMET theme. SEO target: "glucuronidation", "UGT1A1", "phase II
 * metabolism", "metabolic stability assay". Internal CTA into /studio's
 * ADMET panel.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "ugt-glucuronidation-phase-ii-metabolism-oncology",
  title: "Glucuronidation: the clearance route your assay missed",
  description:
    "Phase II conjugation clears about one in ten top-selling drugs, yet a standard microsomal stability run is blind to it. What UGTs do and why oncology cares.",
  date: "2026-07-27",
  author: "Liganx team",
  tags: ["admet", "metabolism", "ugt", "pharmacokinetics"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        A compound comes back from metabolic stability screening with a long
        half-life in human liver microsomes. The team calls it stable and moves
        on. In vivo, clearance is high and exposure is a third of what was
        modelled. The usual explanation is not an exotic one: the molecule is
        being glucuronidated, and the standard assay was never set up to see it.
      </p>

      <h2>What glucuronidation actually is</h2>
      <p>
        UDP-glucuronosyltransferases (UGTs) are a superfamily of phase II
        conjugating enzymes that transfer glucuronic acid from the cofactor
        UDP-glucuronic acid onto a nucleophilic handle on the substrate:
        a hydroxyl, a carboxylic acid, an amine, or a thiol. The product is a
        much more polar, much more water-soluble glucuronide that the liver and
        kidney can excrete. Roughly one in ten of the top two hundred prescribed
        drugs is cleared primarily this way, alongside endogenous substrates
        including bilirubin and steroid hormones.
      </p>
      <p>
        Unlike the cytochromes P450, UGTs do not oxidise anything. They bolt a
        sugar onto a molecule that already has somewhere to bolt it. That single
        structural requirement is why glucuronidation risk tracks so tightly
        with functional groups: put a phenol, an aliphatic alcohol, or a
        carboxylic acid on your scaffold and you have opened a phase II
        clearance route regardless of how clean the P450 profile looks.
      </p>

      <h2>Why the assay misses it</h2>
      <p>
        A conventional liver microsomal stability incubation is fortified with
        NADPH, the cofactor P450s need. UGTs need UDP-glucuronic acid instead,
        and their active site faces the lumen of the endoplasmic reticulum, so
        the microsomal vesicle has to be permeabilised (typically with
        alamethicin) before the cofactor can reach the enzyme. Run the default
        NADPH-only protocol and a compound cleared entirely by UGT will look
        untouched.
      </p>
      <ul>
        <li>
          <strong>Symptom to watch for</strong> — high in vivo clearance that
          cannot be reconciled with in vitro microsomal data, sometimes called
          an IVIVE disconnect.
        </li>
        <li>
          <strong>Fix</strong> — run the incubation with UDPGA plus alamethicin,
          or use hepatocytes, which carry both phase I and phase II machinery
          intact.
        </li>
        <li>
          <strong>Structural tell</strong> — a free phenol or carboxylic acid on
          an otherwise metabolically clean scaffold.
        </li>
      </ul>

      <h2>UGT1A1, bilirubin, and the oncology angle</h2>
      <p>
        UGT1A1 is the isoform that matters most in oncology, because it is the
        enzyme that conjugates bilirubin. A common promoter polymorphism,
        UGT1A1*28, reduces UGT1A1 expression and is the molecular basis of
        Gilbert syndrome. It shows up in drug development in two distinct ways.
      </p>
      <p>
        The first is substrate risk. Irinotecan is converted to its active
        metabolite SN-38, which is detoxified by UGT1A1 to SN-38 glucuronide.
        Patients homozygous for UGT1A1*28 clear SN-38 more slowly and have
        significantly higher rates of severe neutropenia and diarrhoea,
        particularly at doses at or above 180 mg/m2. The FDA label recommends
        considering a starting dose reduction of at least one level in
        UGT1A1*28 homozygotes, which makes irinotecan one of the earliest and
        clearest pharmacogenomic dosing cases in oncology.
      </p>
      <p>
        The second is inhibitor risk, and it is the one that catches teams off
        guard. Several tyrosine kinase inhibitors, notably nilotinib and
        pazopanib, are not UGT1A1 substrates but are potent UGT1A1 inhibitors.
        Block UGT1A1 and unconjugated bilirubin rises. Patients develop
        hyperbilirubinemia that reads as a liver signal on a standard panel but
        is, mechanistically, benign competitive inhibition of bilirubin
        conjugation rather than hepatocellular injury. The effect is strongest
        in patients who already carry a reduced-function UGT1A1 allele. Knowing
        which mechanism you are looking at is the difference between stopping an
        effective drug and continuing it with monitoring.
      </p>

      <h2>Two complications worth knowing</h2>
      <p>
        <strong>Enterohepatic recirculation.</strong> A glucuronide excreted in
        bile reaches the gut, where bacterial beta-glucuronidase can hydrolyse
        it and regenerate the parent drug in the intestinal lumen. For
        irinotecan this is a direct driver of late-onset diarrhoea, and
        inhibiting the bacterial enzyme selectively has been shown to alleviate
        the toxicity in animal models without touching the human enzyme. Any
        compound with a biliary-excreted glucuronide has a plausible route to
        prolonged exposure and gut toxicity.
      </p>
      <p>
        <strong>Acyl glucuronides.</strong> Glucuronides of carboxylic acids are
        chemically reactive electrophiles that can transacylate and form
        covalent protein adducts. This is a recognised structural liability and
        one of the reasons a carboxylic acid, which looks like a harmless
        solubilising group on paper, deserves scrutiny in a candidate that will
        be dosed chronically.
      </p>

      <h2>What can be predicted computationally</h2>
      <p>
        Be honest about the limits. UGTs are membrane-anchored ER enzymes with a
        luminal active site, and there is no high-quality experimental structure
        of a full-length human UGT to dock into. Structure-based prediction of
        glucuronidation is therefore not comparable to what is possible for a
        kinase pocket. In practice, phase II liability is predicted from ligand
        properties: the presence and accessibility of a conjugatable group, its
        electronic environment, steric hindrance around it, and QSAR models
        trained on measured substrate and inhibitor data. Those models are good
        enough to triage a series and steer a substitution, which is what an
        early-stage program needs.
      </p>

      <h2>Try the prediction yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock a candidate, then open the ADMET panel on the result row to
        review its metabolic and hepatic liability profile next to the binding
        pose. Pairing molecular docking with an ADMET readout is how a
        pharmacokinetic problem gets caught while it is still a synthesis
        decision rather than a clinical one, and running molecular docking
        online against a target makes it cheap to check whether the substituent
        that fixes potency is the same one that opens a phase II clearance
        route.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Dean L. <em>Irinotecan Therapy and UGT1A1 Genotype.</em> Medical
          Genetics Summaries, NCBI Bookshelf (2015, updated).{" "}
          <a
            href="https://www.ncbi.nlm.nih.gov/books/NBK294473/"
            target="_blank"
            rel="noreferrer noopener"
          >
            ncbi.nlm.nih.gov/books/NBK294473
          </a>
        </li>
        <li>
          Xu CF, et al. <em>Pazopanib-induced hyperbilirubinemia is associated
          with Gilbert&rsquo;s syndrome UGT1A1 polymorphism.</em> Br J Cancer
          102, 1371-1377 (2010).{" "}
          <a
            href="https://doi.org/10.1038/sj.bjc.6605653"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/sj.bjc.6605653
          </a>
        </li>
        <li>
          Nelson RS, et al. <em>UGT1A1 guided cancer therapy: review of the
          evidence and considerations for clinical implementation.</em> Cancers
          13, 1566 (2021).{" "}
          <a
            href="https://doi.org/10.3390/cancers13071566"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.3390/cancers13071566
          </a>
        </li>
        <li>
          Wallace BD, et al. <em>Alleviating cancer drug toxicity by inhibiting
          a bacterial enzyme.</em> Science 330, 831-835 (2010).{" "}
          <a
            href="https://doi.org/10.1126/science.1191175"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1126/science.1191175
          </a>
        </li>
      </ul>
    </>
  );
}
