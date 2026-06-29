import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "ret-fusion-mutant-cancer-selpercatinib-pralsetinib-landscape",
  title: "RET-driven cancer: the selective inhibitor landscape",
  description:
    "How RET fusions and activating mutations drive lung and thyroid cancer, the two approved selective inhibitors, and why G810 resistance is the next wall.",
  date: "2026-06-18",
  author: "Liganx team",
  tags: ["ret", "oncology", "clinical-landscape", "resistance"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        RET spent two decades as a target that the field knew mattered but
        could only hit with dirty multikinase inhibitors. Cabozantinib and
        vandetanib worked partly through RET, but their off-target activity on
        VEGFR2 and other kinases capped the dose long before RET was fully
        shut down. The arrival of two purpose-built selective inhibitors in
        2020 changed the picture entirely, and the resistance that followed is
        now teaching the field where the next chemistry has to go.
      </p>

      <h2>What RET actually is, and how it goes wrong</h2>
      <p>
        RET is a receptor tyrosine kinase. In cancer it is activated two
        different ways, and the distinction matters clinically because the same
        drugs treat both. In lung cancer, RET is almost always a{" "}
        <strong>fusion</strong>: a chromosomal rearrangement joins the RET
        kinase domain to a partner gene (KIF5B and CCDC6 are the common ones)
        whose promoter and dimerization domains drive constitutive,
        ligand-independent kinase activity. RET fusions occur in roughly 1 to 2
        percent of non-small-cell lung cancer (NSCLC).
      </p>
      <p>
        In medullary thyroid cancer (MTC) the lesion is usually a{" "}
        <strong>point mutation</strong> rather than a fusion. Germline RET
        mutations cause the inherited MEN2 syndromes, and somatic mutations at
        codon M918 (M918T) drive a large fraction of sporadic MTC. Papillary
        thyroid cancers carry RET fusions more like the lung pattern. The
        practical upshot: a single biomarker, RET activation, defines a tumor
        class that crosses tissue boundaries, which is exactly the setting where
        a tumor-agnostic approval makes sense.
      </p>

      <h2>The two selective inhibitors</h2>
      <p>
        Both compounds are ATP-competitive type I inhibitors designed for RET
        selectivity over the VEGFR2 activity that made the old multikinase drugs
        hard to tolerate. That selectivity is the whole point: it lets you push
        the dose to fully inhibit RET without the hypertension and other
        VEGFR2-driven toxicity that limited the predecessors.
      </p>
      <ul>
        <li>
          <strong>Selpercatinib (LOXO-292, Retevmo)</strong> — Loxo/Lilly. FDA
          accelerated approval May 2020 for RET fusion-positive NSCLC and
          RET-altered thyroid cancers, registered on the LIBRETTO-001 phase 1/2
          basket trial. Response rates were high and durable across both
          treatment-naive and heavily pretreated patients. In September 2024 the
          agency converted the MTC indication to traditional approval and broadened
          a tumor-agnostic indication for RET fusion-positive solid tumors.
        </li>
        <li>
          <strong>Pralsetinib (BLU-667, Gavreto)</strong> — Blueprint/Roche. FDA
          approval September 2020 for RET fusion-positive NSCLC, on the ARROW
          phase 1/2 study, with thyroid indications following. Mechanistically
          close to selpercatinib; the two are generally considered
          interchangeable in efficacy, with differences mostly in toxicity
          handling and access.
        </li>
      </ul>
      <p>
        Both penetrate the CNS reasonably well, which matters because RET
        fusion-positive NSCLC has a high rate of brain metastases, and
        intracranial responses were a notable feature of both trials.
      </p>

      <h2>The G810 wall</h2>
      <p>
        Selectivity bought efficacy but also funneled resistance into a narrow
        channel. Unlike KRAS G12C, where resistance is scattered across many
        bypass tracks, the dominant on-target escape from selective RET
        inhibition converges on a single residue: <strong>G810</strong>, the
        solvent-front position. Acquired G810C, G810S, and G810R mutations sit
        at the edge of the ATP pocket where the inhibitor projects toward
        solvent, and the larger side chains sterically clash with the drug.
      </p>
      <p>
        What is striking is the convergent evolution. Post-progression biopsies
        and circulating-tumor-DNA studies have found different G810 substitutions
        arising in separate subclones within the same patient, all hitting the
        same residue independently. That is the cleanest possible evidence that
        the drug binds where the structural biology says it does, and that G810
        is the load-bearing contact. The gatekeeper position (V804) was the
        feared resistance site by analogy to other kinases, but selpercatinib
        and pralsetinib were designed around it, so the pressure moved to the
        solvent front instead.
      </p>

      <h2>What comes after the solvent front</h2>
      <p>
        The next-generation RET inhibitors were built specifically to retain
        activity against G810. The road has been bumpy. TPX-0046 (enbezotinib)
        showed preclinical activity against G810 but its clinical program was
        terminated in 2023 over an unfavorable risk-benefit profile, and Lilly
        discontinued LOXO-260. Vepafestinib (TAS0953/HM06) has reported
        best-in-class RET selectivity with activity against L730, V804, and G810
        variants and remains in clinical development. The lesson echoes the ALK
        and ROS1 stories: solvent-front resistance is chemically tractable, but
        building a next-generation inhibitor that covers it without picking up
        new toxicity is the hard part.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The G810 solvent-front story is a textbook steric-clash resistance
        mechanism, and molecular docking shows it directly.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick RET from the target catalog with G810R or G810C from the
        mutation chips, then dock selpercatinib against both the wild-type and
        the mutant receptor side by side. The selective inhibitor that scores
        well against wild-type RET should lose ground against the solvent-front
        mutant as the bulkier residue intrudes on the binding pose. That delta,
        not the absolute score, is the resistance signal worth reading.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and built for
        exactly this mutation-versus-wild-type comparison. If you want to try
        molecular docking on RET G810 resistance without a local install, that
        is the fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Drilon A, et al. <em>Efficacy of Selpercatinib in RET Fusion-Positive
          Non-Small-Cell Lung Cancer.</em> NEJM 383, 813-824 (2020).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2005653"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2005653
          </a>
        </li>
        <li>
          Gainor JF, et al. <em>Pralsetinib for RET fusion-positive
          non-small-cell lung cancer (ARROW): a multi-cohort, open-label, phase
          1/2 study.</em> Lancet Oncol 22, 959-969 (2021).{" "}
          <a
            href="https://doi.org/10.1016/S1470-2045(21)00247-3"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/S1470-2045(21)00247-3
          </a>
        </li>
        <li>
          Solomon BJ, et al. <em>RET Solvent Front Mutations Mediate Acquired
          Resistance to Selective RET Inhibition in RET-Driven Malignancies.</em>{" "}
          J Thorac Oncol 15, 541-549 (2020).{" "}
          <a
            href="https://doi.org/10.1016/j.jtho.2020.01.006"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/j.jtho.2020.01.006
          </a>
        </li>
        <li>
          U.S. FDA. <em>FDA approves selpercatinib for locally advanced or
          metastatic RET fusion-positive solid tumors</em> (2024).{" "}
          <a
            href="https://www.fda.gov/drugs/resources-information-approved-drugs/fda-approves-selpercatinib-locally-advanced-or-metastatic-ret-fusion-positive-solid-tumors"
            target="_blank"
            rel="noreferrer noopener"
          >
            fda.gov
          </a>
        </li>
      </ul>
    </>
  );
}
