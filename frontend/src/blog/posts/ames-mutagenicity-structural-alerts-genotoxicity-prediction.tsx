/**
 * Post: The Ames test and structural alerts - predicting mutagenicity
 *
 * SEO target: "Ames test", "bacterial reverse mutation", "structural
 * alerts mutagenicity", "ICH M7 QSAR", "genotoxicity prediction".
 * Internal CTA into /studio's ADMET panel which flags genotoxicity-style
 * liabilities alongside hERG/DILI/CYP after a dock.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "ames-mutagenicity-structural-alerts-genotoxicity-prediction",
  title: "The Ames test, structural alerts, and predicting mutagenicity",
  description:
    "What the Ames test measures, why a handful of reactive substructures predict most positives, and how ICH M7 lets two QSAR models stand in for the wet assay.",
  date: "2026-06-10",
  author: "Liganx team",
  tags: ["admet", "genotoxicity", "mutagenicity", "drug-safety"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        A mutagenic candidate is usually a dead candidate. Unlike a hERG
        signal you might dose around, a positive genotoxicity finding carries
        a regulatory weight that is hard to argue past - so it is worth
        catching the liability from the structure long before anything reaches
        a plate. The good news is that mutagenicity is one of the most
        predictable ADMET endpoints, because most positives come from a small
        set of reactive substructures.
      </p>

      <h2>What the Ames test actually measures</h2>
      <p>
        The Ames test (the bacterial reverse mutation assay) is the workhorse
        genotoxicity screen. It uses strains of <em>Salmonella typhimurium</em>{" "}
        and <em>Escherichia coli</em> engineered so they cannot synthesize an
        essential amino acid (histidine or tryptophan). Expose them to a test
        compound; if it is mutagenic, some bacteria revert the defect and
        regain the ability to grow on amino-acid-free medium. Count the
        revertant colonies and you have a dose-dependent readout of how
        strongly the compound damages DNA.
      </p>
      <p>
        The detail that matters for prediction: the assay is run both with and
        without an <strong>S9 fraction</strong> - a rat liver homogenate that
        supplies the metabolic enzymes (largely CYPs) the bacteria lack. Many
        compounds are not mutagenic themselves but become reactive after
        metabolism. The S9 condition catches those. This is why a good in
        silico model has to reason about likely metabolites, not just the
        parent structure.
      </p>

      <h2>The substructures that get you flagged</h2>
      <p>
        Mutagenicity is driven by electrophilic chemistry: groups that react
        with the nucleophilic sites on DNA bases. Kazius and colleagues
        distilled a large Ames dataset into roughly two dozen{" "}
        <strong>toxicophores</strong> that explain most positives. The usual
        suspects:
      </p>
      <ul>
        <li>
          <strong>Aromatic nitro groups</strong> - reduced to reactive
          nitroso and hydroxylamine species that attack DNA.
        </li>
        <li>
          <strong>Aromatic amines and azo compounds</strong> - bioactivated to
          nitrenium ions, classic DNA adduct formers.
        </li>
        <li>
          <strong>Alkyl halides, epoxides, aziridines, and Michael
          acceptors</strong> - direct-acting electrophiles that alkylate DNA
          without needing metabolism.
        </li>
        <li>
          <strong>N-nitroso groups</strong> - the nitrosamine class that drove
          a wave of recent drug recalls; potent alkylators after metabolic
          activation.
        </li>
      </ul>
      <p>
        Benigni and Bossa formalized the mechanistic logic behind these alerts,
        and that rulebase (the Benigni/Bossa set in tools like Toxtree) is the
        expert-knowledge backbone of most commercial mutagenicity predictors.
      </p>

      <h2>Why ICH M7 lets two models replace the assay</h2>
      <p>
        For drug impurities, regulators went a step further than guidance and
        made in silico prediction a formal substitute. The{" "}
        <strong>ICH M7</strong> guideline says that for assessing the
        mutagenic potential of an impurity, two complementary{" "}
        <em>(Q)SAR</em> methodologies can stand in for an actual Ames test:
      </p>
      <ul>
        <li>
          <strong>An expert rule-based model</strong> - encodes structural
          alerts and mechanistic reasoning (the Benigni/Bossa lineage).
        </li>
        <li>
          <strong>A statistical model</strong> - a QSAR trained on Ames data
          that learns its own features from molecular descriptors.
        </li>
      </ul>
      <p>
        If both come back negative, the impurity can be treated as
        non-mutagenic without wet testing; a positive from either, or expert
        disagreement, triggers follow-up. It is one of the few places in drug
        safety where a computational prediction is accepted in a regulatory
        filing - a strong signal of how mature this endpoint is. The public
        Hansen benchmark of around 6,500 Ames-tested compounds is one of the
        reference datasets these models are trained and judged against.
      </p>

      <h2>Where prediction still struggles</h2>
      <p>
        Mutagenicity is predictable, not solved. Models do well on the
        well-characterized alerts and worse on novel chemotypes outside the
        training distribution. They also tend to over-flag: a nitro group on
        an otherwise benign scaffold will light up even when steric or
        electronic context blunts the reactivity. Treat a structural-alert hit
        as a prompt to look harder, not an automatic kill - the alert tells
        you which atoms to scrutinize and whether a wet Ames test is worth
        commissioning.
      </p>

      <h2>Try the prediction yourself</h2>
      <p>
        Genotoxicity sits in the same early-filter bucket as hERG and DILI: a
        cheap structural readout that tells you whether to keep spending on a
        chemotype. After you dock a candidate in Studio, the ADMET panel
        surfaces the off-target and safety liabilities alongside the binding
        pose, so a reactive substructure shows up next to the score rather
        than two months later in a tox report.
      </p>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock any candidate, then open the ADMET pill on the result row to
        read the safety profile before committing synthesis effort.
      </p>
      <p>
        Liganx brings molecular docking online into the browser and runs the
        ADMET readout on every pose. Pairing molecular docking with an
        early genotoxicity check is how you avoid pouring chemistry into a
        scaffold that was never going to clear safety.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Kazius J, McGuire R, Bursi R. <em>Derivation and Validation of
          Toxicophores for Mutagenicity Prediction.</em> J Med Chem 48,
          312-320 (2005).{" "}
          <a
            href="https://doi.org/10.1021/jm040835a"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/jm040835a
          </a>
        </li>
        <li>
          Benigni R, Bossa C. <em>Mechanisms of Chemical Carcinogenicity and
          Mutagenicity: A Review with Implications for Predictive
          Toxicology.</em> Chem Rev 111, 2507-2536 (2011).{" "}
          <a
            href="https://doi.org/10.1021/cr100222q"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/cr100222q
          </a>
        </li>
        <li>
          Hansen K, Mika S, Schroeter T, et al. <em>Benchmark Data Set for in
          Silico Prediction of Ames Mutagenicity.</em> J Chem Inf Model 49,
          2077-2081 (2009).{" "}
          <a
            href="https://doi.org/10.1021/ci900161g"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/ci900161g
          </a>
        </li>
        <li>
          ICH. <em>M7(R2): Assessment and Control of DNA Reactive (Mutagenic)
          Impurities in Pharmaceuticals to Limit Potential Carcinogenic
          Risk.</em> International Council for Harmonisation (2023).{" "}
          <a
            href="https://www.ich.org/page/multidisciplinary-guidelines"
            target="_blank"
            rel="noreferrer noopener"
          >
            ich.org
          </a>
        </li>
      </ul>
    </>
  );
}
