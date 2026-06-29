/**
 * Post: Caco-2 permeability — the in vitro gatekeeper for oral absorption.
 *
 * ADMET explainer. Internal CTA into /studio's ADMET panel, which reports a
 * Caco-2 permeability estimate alongside hERG/DILI/CYP.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "caco-2-permeability-intestinal-absorption-admet",
  title: "Caco-2 permeability: the gatekeeper for oral drugs",
  description:
    "How the Caco-2 monolayer assay predicts intestinal absorption, what Papp values mean, and why a potent compound that cannot cross the gut wall is a dead candidate.",
  date: "2026-06-24",
  author: "Liganx team",
  tags: ["admet", "permeability", "caco-2", "oral-bioavailability"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        A pill only works if the drug gets out of the gut and into the blood.
        Potency at the target is irrelevant if the molecule cannot cross the
        single layer of cells lining the intestine. The standard in vitro proxy
        for that crossing is the Caco-2 assay, and its readout — apparent
        permeability, or Papp — is one of the first numbers a project tracks
        once a series shows on-target activity.
      </p>

      <h2>What the Caco-2 assay measures</h2>
      <p>
        Caco-2 is a human colorectal adenocarcinoma cell line that, when grown
        on a porous membrane for about three weeks, differentiates into a
        polarized monolayer resembling the small-intestinal epithelium. It forms
        tight junctions, expresses brush-border enzymes, and displays the efflux
        transporters (P-glycoprotein, BCRP, MRP2) you find in the real gut wall.
        You add compound to the apical (gut-lumen) side and measure how much
        appears on the basolateral (blood) side over time.
      </p>
      <p>
        That rate is expressed as the apparent permeability coefficient, Papp,
        in units of cm/s. It captures everything that governs absorption:
        passive transcellular diffusion, paracellular leak between cells, active
        uptake, and active efflux pumping the drug back out.
      </p>

      <h2>Reading the numbers</h2>
      <p>
        Regulators and labs use rough Papp bins to map onto the fraction of an
        oral dose a human will absorb:
      </p>
      <ul>
        <li>
          <strong>High permeability:</strong> Papp greater than ~10 x 10⁻⁶ cm/s,
          corresponding to high human absorption (fraction absorbed ≥ 85%).
        </li>
        <li>
          <strong>Moderate:</strong> roughly 1 to 10 x 10⁻⁶ cm/s, mapping to
          partial absorption (fa ~50-84%).
        </li>
        <li>
          <strong>Low permeability:</strong> below ~1 x 10⁻⁶ cm/s, a warning
          that oral absorption will be poor (fa &lt; 50%).
        </li>
      </ul>
      <p>
        The exact cutoffs are lab-specific and depend on the reference
        compounds, which is why every assay is calibrated with known standards
        spanning the absorption range (for example mannitol or atenolol for
        low, propranolol or metoprolol for high). The Caco-2 model is formally
        recognized by the FDA, EMA, and WHO as a permeability surrogate for
        Biopharmaceutics Classification System (BCS) biowaivers.
      </p>

      <h2>The efflux ratio tells a second story</h2>
      <p>
        Because Caco-2 cells express transporters, you can run the assay in both
        directions and compute an <strong>efflux ratio</strong> (Papp
        basolateral-to-apical divided by Papp apical-to-basolateral). A ratio
        well above 2 usually means the compound is a substrate of an efflux
        pump, most often P-glycoprotein. That matters far beyond the gut: P-gp
        substrates struggle to cross the blood-brain barrier, so a high efflux
        ratio is an early flag for both oral-absorption trouble and poor CNS
        penetration. Co-dosing with a P-gp inhibitor in the assay confirms
        whether efflux is the culprit.
      </p>

      <h2>How it connects to docking</h2>
      <p>
        Permeability and potency pull a molecule in opposite directions. The
        same features that improve passive permeability — moderate lipophilicity,
        few hydrogen-bond donors, low polar surface area — often trade against
        the polar contacts that drive tight binding. A docking score tells you
        the molecule can grip the target; a permeability estimate tells you it
        can reach the target in the first place. You want both numbers in front
        of you before you commit to a synthesis.
      </p>

      <h2>Try the prediction yourself</h2>
      <p>
        Liganx&rsquo;s ADMET panel reports a Caco-2 permeability estimate
        alongside the cardiac, hepatic, and metabolic risk readouts, computed by
        the admet-ai ensemble on every docked pose.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>
        , dock a candidate, and open the ADMET pill on the result row to see the
        permeability estimate next to the binding pose. Running molecular docking
        online and the absorption readout together is how you catch a
        low-permeability liability while it is still just a docking pose, not a
        failed pharmacokinetic study.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Artursson P, Karlsson J. <em>Correlation between oral drug absorption
          in humans and apparent drug permeability coefficients in human
          intestinal epithelial (Caco-2) cells.</em> Biochem Biophys Res Commun
          175, 880-885 (1991).{" "}
          <a
            href="https://doi.org/10.1016/0006-291X(91)91647-U"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/0006-291X(91)91647-U
          </a>
        </li>
        <li>
          Hubatsch I, Ragnarsson EGE, Artursson P. <em>Determination of drug
          permeability and prediction of drug absorption in Caco-2 monolayers.</em>{" "}
          Nat Protoc 2, 2111-2119 (2007).{" "}
          <a
            href="https://doi.org/10.1038/nprot.2007.303"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nprot.2007.303
          </a>
        </li>
        <li>
          ICH M9 Guideline. <em>Biopharmaceutics Classification System-Based
          Biowaivers.</em> FDA / ICH (2019).{" "}
          <a
            href="https://www.fda.gov/media/148472/download"
            target="_blank"
            rel="noreferrer noopener"
          >
            fda.gov/media/148472
          </a>
        </li>
      </ul>
    </>
  );
}
