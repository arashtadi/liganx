/**
 * Post: Drug-induced phospholipidosis — the cationic amphiphile trap
 *
 * SEO target: "phospholipidosis prediction", "cationic amphiphilic drug",
 * "CAD phospholipidosis", "Ploemen rule pKa clogP". ADMET explainer.
 * Internal CTA into /studio's ADMET / physicochemical panel; cross-links
 * to the hERG and logP posts since it is the same chemotype signature.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "drug-induced-phospholipidosis-cationic-amphiphilic-drugs",
  title: "Phospholipidosis: the cationic amphiphile trap",
  description:
    "Why a basic amine plus a greasy ring makes cells fill up with phospholipid whorls, and how pKa and logP predict the liability before you ever run a cell assay.",
  date: "2026-07-09",
  author: "Liganx team",
  tags: ["admet", "phospholipidosis", "drug-design", "physicochemical"],
  readingMin: 5,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Drug-induced phospholipidosis is one of those liabilities that hides
        in plain sight. The same structural features that make a molecule a
        good CNS drug or a potent kinase inhibitor, a basic amine and a
        lipophilic ring system, are exactly the features that cause cells to
        fill up with phospholipid whorls. It rarely kills a program by itself,
        but it triggers ugly histopathology findings, regulatory questions,
        and expensive mechanistic follow-up. Knowing the pattern lets you
        design around it early.
      </p>

      <h2>What phospholipidosis is</h2>
      <p>
        Phospholipidosis (PLD) is the excessive accumulation of phospholipids
        inside cells, most visibly in the lysosome. Under an electron
        microscope the affected cells are studded with lamellar inclusion
        bodies: concentric, onion-like whorls of membrane that give the
        cytoplasm a foamy appearance. It shows up most in lung, liver, kidney,
        and lymphoid tissue, and it is reversible once the drug is withdrawn,
        which is part of why its clinical significance is still debated.
      </p>
      <p>
        The mechanism is lysosomal trapping. A weakly basic drug diffuses
        across the lysosomal membrane in its neutral form, then gets
        protonated and trapped in the acidic lysosomal lumen (pH ~4.5). Once
        concentrated there, the cationic amphiphile binds to anionic
        phospholipids and inhibits the enzymes that break them down, in
        particular lysosomal phospholipase A2 (PLA2G15). Phospholipid turnover
        stalls, the undegraded lipid piles up, and you get the lamellar
        bodies.
      </p>

      <h2>The cationic amphiphilic drug signature</h2>
      <p>
        Nearly every PLD-inducing compound is a cationic amphiphilic drug
        (CAD), and the definition is almost a recipe:
      </p>
      <ul>
        <li>
          <strong>A basic nitrogen</strong> with a pKa high enough (roughly
          8 or above) to be protonated and positively charged at
          physiological and lysosomal pH. This is what drives the lysosomal
          trapping.
        </li>
        <li>
          <strong>A hydrophobic domain</strong>, usually one or more aromatic
          or aliphatic ring systems, that lets the molecule partition into
          and bind membrane phospholipids.
        </li>
        <li>
          <strong>Enough overall lipophilicity</strong> (elevated logP) to
          get into the membrane in the first place.
        </li>
      </ul>
      <p>
        The classic offenders are textbook CADs: amiodarone, chloroquine and
        hydroxychloroquine, azithromycin, fluoxetine, imipramine, and
        chlorpromazine. If that list looks familiar, it should, because the
        cationic-amphiphile signature overlaps heavily with the{" "}
        <Link
          to="/blog/herg-silent-killer-kinase-programs"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          hERG pharmacophore
        </Link>
        . A basic amine plus lipophilic rings buys you cardiac and
        phospholipidosis risk from the same features, which is why lead
        optimization so often ends up trimming basicity and logP together.
      </p>

      <h2>Predicting it from physicochemistry</h2>
      <p>
        Because the liability is so tightly tied to two properties, you can
        get a fast first read from calculation alone. The most cited heuristic
        is the Ploemen rule: a compound is flagged as a likely PLD inducer if
        its CLogP is at least 1 and the sum of CLogP squared plus pKa squared
        is at least 90. Compounds that clear both thresholds cluster with the
        known inducers; the piperazine series in the original study, which
        lacked the right pKa/logP combination, did not form lamellar bodies.
      </p>
      <p>
        The catch is precision. Prediction based on pKa and logP alone carries
        a high false positive rate, because plenty of basic lipophilic
        molecules never actually induce PLD. Adding structural information
        improves things modestly, and more recent work argues that a direct
        mechanistic readout, inhibition of lysosomal phospholipase A2
        (PLA2G15), predicts phospholipidosis more accurately than the
        physicochemical models. In practice the calculated rule is a cheap
        triage filter, not a verdict: use it to prioritize which compounds
        deserve a wet-lab assay, not to condemn a scaffold.
      </p>

      <h2>Try the prediction yourself</h2>
      <p>
        Phospholipidosis risk tracks the same two numbers Liganx already
        surfaces after a dock: basicity and{" "}
        <Link
          to="/blog/lipophilicity-logp-logd-admet"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          lipophilicity
        </Link>
        .{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>
        , dock any candidate, and open the ADMET panel on the result row. A
        compound sitting well above logP 3 with a strongly basic amine is
        carrying the cationic-amphiphile signature, which is your cue to check
        it against the Ploemen thresholds and, if it clears them, to plan a
        lamellar-body assay before you commit synthesis to the series. Liganx
        is molecular docking online with the physicochemical readout attached
        to every pose, so you can catch this chemotype risk in the same pass
        as the docking score.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Ploemen JP, Kelder J, Hafmans T, et al. <em>Use of physicochemical
          calculation of pKa and CLogP to predict phospholipidosis-inducing
          potential: a case study with structurally related piperazines.</em>{" "}
          Exp Toxicol Pathol 55, 347&ndash;355 (2004).{" "}
          <a
            href="https://doi.org/10.1078/0940-2993-00338"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1078/0940-2993-00338
          </a>
        </li>
        <li>
          Reasor MJ, Hastings KL, Ulrich RG. <em>Drug-induced phospholipidosis:
          issues and future directions.</em> Expert Opin Drug Saf 5,
          567&ndash;583 (2006).{" "}
          <a
            href="https://doi.org/10.1517/14740338.5.4.567"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1517/14740338.5.4.567
          </a>
        </li>
        <li>
          Abe A, Hiraoka M, Inatomi S, et al. <em>Inhibition of lysosomal
          phospholipase A2 predicts drug-induced phospholipidosis.</em> J Lipid
          Res 62, 100077 (2021).{" "}
          <a
            href="https://doi.org/10.1016/j.jlr.2021.100077"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/j.jlr.2021.100077
          </a>
        </li>
      </ul>
    </>
  );
}
