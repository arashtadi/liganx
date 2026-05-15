/**
 * Post: DILI — drug-induced liver injury, the ADMET liability you can't
 * structure away as cleanly as hERG.
 *
 * SEO target: "drug-induced liver injury", "DILI prediction", "hepatotoxicity
 * kinase inhibitors", "rule of two DILI". Internal CTA into /studio's ADMET
 * panel, which runs admet-ai and surfaces a continuous DILI probability.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "dili-drug-induced-liver-injury-oncology",
  title: "DILI: the hepatotoxicity liability you can't fully design away",
  description:
    "Drug-induced liver injury is the leading cause of drug withdrawals. What causes it, why kinase inhibitors are prone, and how to flag it during molecular docking.",
  date: "2026-05-14",
  author: "Liganx team",
  tags: ["admet", "dili", "hepatotoxicity", "molecular-docking"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Drug-induced liver injury is the single most common reason a drug
        gets a black-box warning or is pulled from the market. Unlike hERG,
        where one well-understood pharmacophore explains most of the risk,
        DILI is genuinely hard: part of it is predictable chemistry, and
        part of it depends on the patient. Knowing which part is which is
        the difference between catching a liability early and discovering
        it in Phase III.
      </p>

      <h2>Two kinds of liver injury</h2>
      <p>
        <strong>Intrinsic DILI</strong> is dose-dependent, reproducible, and
        predictable. Give enough of the drug and essentially everyone gets
        injured. Acetaminophen is the archetype: above a threshold dose, the
        reactive metabolite NAPQI overwhelms hepatic glutathione and the
        damage is mechanistic and consistent. Intrinsic toxicity is the
        easier problem because it shows up in standard preclinical tox.
      </p>
      <p>
        <strong>Idiosyncratic DILI</strong> is the one that ends programs.
        It is rare, often delayed by weeks to months, and depends heavily on
        the individual patient. It frequently does not appear in animal
        studies or in the first few hundred patients, then surfaces once a
        drug reaches a wide population. Because it is host-dependent, you
        cannot fully design it out of a molecule the way you can dial down a
        hERG signal.
      </p>

      <h2>What actually causes idiosyncratic DILI</h2>
      <p>
        The mechanisms stack rather than compete. Most idiosyncratic DILI is
        thought to start with a <strong>reactive metabolite</strong>: the
        parent drug is bioactivated, usually by cytochrome P450 enzymes, into
        a species that covalently binds cellular proteins and forms
        drug-protein adducts. Those adducts plus other cell stress feed into
        a handful of downstream insults:
      </p>
      <ul>
        <li>
          <strong>Mitochondrial dysfunction</strong> — impaired ATP
          production, oxidative stress, and a hepatocyte that can no longer
          keep up with its energy demands.
        </li>
        <li>
          <strong>BSEP inhibition</strong> — blocking the bile salt export
          pump lets bile acids accumulate inside the hepatocyte, which is
          itself a stressor. Drugs that hit both BSEP and mitochondria tend
          to carry the more serious DILI risk.
        </li>
        <li>
          <strong>Adaptive immune activation</strong> — the drug-protein
          adduct is presented as a neoantigen, and in susceptible patients
          cytotoxic T cells do the actual tissue damage. This is why
          specific HLA haplotypes are associated with DILI from specific
          drugs, and why two patients on the same drug can have completely
          different outcomes.
        </li>
      </ul>
      <p>
        That last point is the crux: the immune and host-genetic component
        is why no purely structural model will ever fully predict
        idiosyncratic DILI. The chemistry is necessary but not sufficient.
      </p>

      <h2>The rule of two, and why kinase inhibitors are exposed</h2>
      <p>
        The most useful first-pass heuristic comes from Chen, Borlak, and
        Tong&rsquo;s 2013 analysis: a drug given at <strong>100 mg/day or
        more</strong> AND with <strong>logP of 3 or higher</strong> carries
        a roughly 14-fold higher odds of hepatotoxicity. They called it the
        &ldquo;rule of two.&rdquo; The logic is intuitive once you see it:
        a high daily dose means more parent drug for the liver to
        bioactivate, and high lipophilicity means more of it partitions into
        hepatocytes and gets metabolized in the first place.
      </p>
      <p>
        Oncology kinase inhibitors sit almost exactly in the danger zone.
        They are routinely dosed at hundreds of milligrams a day, and their
        chemistry pushes logP into the 3-5 range — basic amines for
        solubility, aromatic rings for the ATP-pocket hinge, the same
        features that make them rule-of-two positive. The hepatotoxicity
        warnings on lapatinib, pazopanib, regorafenib, ponatinib, and
        idelalisib are not bad luck; they are the predictable cost of that
        physicochemical profile. Sotorasib, the KRAS G12C inhibitor, ships
        with mandatory AST/ALT monitoring for the same reason.
      </p>

      <h2>What the prediction tools can and can't do</h2>
      <p>
        The reference dataset is the FDA&rsquo;s <strong>DILIrank</strong>:
        roughly a thousand drugs sorted into Most-, Less-, No-, and
        Ambiguous-DILI-concern categories based on weighed clinical evidence.
        Nearly every machine-learning DILI predictor is trained on it or on
        datasets derived from it. Layered on top are structural alerts for
        reactive-metabolite-forming groups, and the rule-of-two
        physicochemistry, which you can read off any SMILES string for free.
      </p>
      <p>
        ML predictors output a continuous DILI probability and do a
        respectable job recovering the chemistry-driven signal. What they
        cannot do is see the patient: the HLA association, the prior
        inflammatory state, the co-medication that induces the wrong P450.
        Treat a model&rsquo;s DILI score as a flag for &ldquo;this molecule
        has hepatotoxic chemistry,&rdquo; not as a verdict, and pair it with
        the rule-of-two read on dose and logP. In a molecular docking
        workflow, that means running the ADMET screen on every pose you keep
        as a candidate, not just on the final pick.
      </p>

      <h2>Try the prediction yourself</h2>
      <p>
        Liganx&rsquo;s ADMET panel runs the admet-ai ensemble on every
        compound after a successful molecular docking run, and DILI is one
        of the three risk dots in the violet ⚕ ADMET pill — emerald for low,
        amber for medium, rose for high — alongside hERG and CYP3A4.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        on Liganx, the free molecular docking online platform, and run
        molecular docking on any candidate, then open the ADMET panel on a
        result row.
        Read the DILI probability together with the molecule&rsquo;s logP: a
        high DILI score on a lipophilic compound you also intend to dose at
        hundreds of milligrams a day is the rule of two and the model
        agreeing with each other, and that is a redesign signal worth taking
        seriously before you commit synthesis budget.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Chen M, Borlak J, Tong W. <em>High lipophilicity and high daily
          dose of oral medications are associated with significant risk for
          drug-induced liver injury.</em> Hepatology 58, 388-396 (2013).{" "}
          <a
            href="https://doi.org/10.1002/hep.26208"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1002/hep.26208
          </a>
        </li>
        <li>
          Chen M, et al. <em>DILIrank: the largest reference drug list ranked
          by the risk for developing drug-induced liver injury in humans.</em>{" "}
          Drug Discov Today 21, 648-653 (2016).{" "}
          <a
            href="https://doi.org/10.1016/j.drudis.2016.02.015"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/j.drudis.2016.02.015
          </a>
        </li>
        <li>
          Kullak-Ublick GA, et al. <em>Drug-induced liver injury: recent
          advances in diagnosis and risk assessment.</em> Gut 66, 1154-1164
          (2017).{" "}
          <a
            href="https://doi.org/10.1136/gutjnl-2016-313369"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1136/gutjnl-2016-313369
          </a>
        </li>
      </ul>
    </>
  );
}
