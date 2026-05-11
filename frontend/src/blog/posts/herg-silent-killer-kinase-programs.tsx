/**
 * Post: hERG — the silent killer of kinase programs
 *
 * SEO target: "hERG cardiotoxicity", "hERG screening", "QT prolongation
 * drug discovery". Internal CTA into /studio's ADMET panel which now
 * runs admet-ai (continuous probabilities, not just SMARTS hits).
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "herg-silent-killer-kinase-programs",
  title: "hERG: the silent killer of kinase programs",
  description:
    "Why a basic amine and a couple of aromatic rings are enough to wipe out a clinical candidate, and what the cardiac liability actually looks like in screening data.",
  date: "2026-05-06",
  author: "Liganx team",
  tags: ["admet", "herg", "cardiotoxicity", "drug-design"],
  readingMin: 5,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        More clinical candidates die from hERG than from any other off-target
        liability. The ones that survive into Phase III with a hERG signal
        carry a black-box label for the rest of the franchise. The cardiac
        risk gets undersold in early discovery because it&rsquo;s invisible to
        a simple potency assay — but the structural pattern that causes it
        is so common that medicinal chemists eventually learn to spot it
        from the SMILES alone.
      </p>

      <h2>What hERG actually is</h2>
      <p>
        hERG (the human Ether-à-go-go Related Gene, IKr channel) is a
        voltage-gated potassium channel that handles the rapid component
        of cardiac repolarization. When you block it, the action potential
        gets longer. On an ECG that shows up as <strong>QT prolongation</strong>.
        QT prolongation can trigger torsades de pointes — a polymorphic
        ventricular tachyarrhythmia that occasionally degenerates into
        ventricular fibrillation and sudden cardiac death.
      </p>
      <p>
        The history of the field is littered with hERG-driven withdrawals:
        terfenadine (Seldane, 1997), cisapride (Propulsid, 2000), grepafloxacin
        (Raxar, 1999). Each one taught the FDA to take cardiac liability more
        seriously. By the time vandetanib was approved in 2011, the agency
        was requiring thorough QT studies for every new molecular entity in
        oncology. That requirement hasn&rsquo;t loosened.
      </p>

      <h2>The pharmacophore that gets you in trouble</h2>
      <p>
        Aronov&rsquo;s 2005 review crystallized the structural pattern. A high
        hERG-block probability needs three ingredients:
      </p>
      <ul>
        <li>
          <strong>A basic nitrogen</strong>, usually in a piperidine,
          piperazine, or tertiary amine. Protonated under physiological
          pH, anchors the molecule into the central cavity by hydrogen-bonding
          to Tyr652 and stacking against Phe656.
        </li>
        <li>
          <strong>Two or more lipophilic aromatic rings</strong>, separated
          by a few rotatable bonds. The rings make π-stacking interactions
          deep in the channel pore.
        </li>
        <li>
          <strong>Overall logP &gt; 3.5</strong>. Lipophilic enough to find
          the hydrophobic pore in the first place.
        </li>
      </ul>
      <p>
        Look at terfenadine, cisapride, astemizole, sertindole. They all
        match. Look at most marketed kinase inhibitors. They mostly match
        too — kinase inhibitors love basic amines for solubility, love
        aromatic rings for the ATP-pocket hinge, and tend to settle around
        logP 3-5. That&rsquo;s why hERG screening is mandatory for every
        kinase program.
      </p>

      <h2>What the prediction methods actually do</h2>
      <p>
        Three layers of evidence, ordered by cost:
      </p>
      <ul>
        <li>
          <strong>Rule-based heuristics</strong> (SMARTS pattern matching for
          the Aronov pharmacophore). Free, instant, decent recall, terrible
          precision. Will flag almost every kinase inhibitor as &ldquo;hERG
          high&rdquo; — including ones that don&rsquo;t actually block hERG —
          because the pattern is so common.
        </li>
        <li>
          <strong>ML predictors</strong> (admet-ai, ADMETLab, Schrödinger&rsquo;s
          QSAR). Trained on patch-clamp data from Karim et al. and the
          Therapeutics Data Commons. Output is a continuous probability,
          0-1. Reasonable accuracy (~80% AUC), with the well-known caveat
          that compounds outside the training distribution can fail in
          either direction.
        </li>
        <li>
          <strong>Wet-lab patch clamp</strong> on hERG-expressing HEK293
          cells. The gold standard. ~$5K per compound at a CRO, two-week
          turnaround. Required for any compound advancing past lead-opt.
        </li>
      </ul>

      <h2>Try the prediction yourself</h2>
      <p>
        Liganx&rsquo;s ADMET panel runs the admet-ai Chemprop ensemble on every
        compound after a successful dock. It returns a continuous hERG
        probability that maps to low/medium/high tiers (0.5 cutoff is the
        literature standard). The evidence string shows the raw probability
        so you can see how close to the cutoff a borderline compound was.
      </p>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock any candidate. After the run completes, click the violet
        ⚕ ADMET pill on a result row to see the risk profile. Three colored
        dots summarize hERG, DILI, and CYP3A4 risk at a glance — emerald
        for low, amber for medium, rose for high. If your candidate is
        rose-rose-rose, it&rsquo;s not necessarily dead, but it&rsquo;s a strong
        signal to redesign before sinking the synthesis cost.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Aronov AM. <em>Predictive in silico modeling for hERG channel
          blockers.</em> Drug Discov Today 10, 149-155 (2005).{" "}
          <a
            href="https://doi.org/10.1016/S1359-6446(04)03278-7"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/S1359-6446(04)03278-7
          </a>
        </li>
        <li>
          Karim A, Lee M, Balle T, Sattar A. <em>CardioTox net: a robust
          predictor for hERG channel blockade based on deep learning meta
          feature ensembles.</em> J Cheminform 13, 60 (2021).{" "}
          <a
            href="https://doi.org/10.1186/s13321-021-00541-z"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1186/s13321-021-00541-z
          </a>
        </li>
        <li>
          Swain CG, Lewis ML. <em>Toxic effects of pharmaceuticals on the
          hERG channel: a regulatory perspective.</em> Br J Pharmacol 159,
          5-12 (2010).
        </li>
      </ul>
    </>
  );
}
