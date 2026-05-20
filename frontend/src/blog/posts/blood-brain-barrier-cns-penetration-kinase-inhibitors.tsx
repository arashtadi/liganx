/**
 * Post: Blood-brain barrier penetration for kinase inhibitors
 *
 * SEO target: long-tail "blood brain barrier kinase inhibitor",
 * "CNS MPO score medchem", "Kp,uu brain", "P-gp efflux oncology",
 * "osimertinib CNS penetration", "alectinib brain metastases".
 * Internal CTA into /studio framed around CNS-penetrant docking +
 * ADMET panel for BBB flags.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "blood-brain-barrier-cns-penetration-kinase-inhibitors",
  title: "Blood-brain barrier and kinase inhibitors — what actually predicts CNS exposure",
  description:
    "Why most oral kinase inhibitors miss the brain, what physicochemical properties and efflux transporters predict CNS exposure, and how osimertinib, alectinib, and lorlatinib got it right.",
  date: "2026-05-18",
  author: "Liganx team",
  tags: ["admet", "bbb", "cns", "oncology", "medicinal-chemistry"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Brain metastases occur in up to 40% of advanced lung
        cancer patients and 15-30% of HER2-positive breast cancer
        patients. For decades, those patients were treated with
        whole-brain radiation because the systemic therapies
        worked everywhere except the brain. The reason was
        almost never about target engagement. It was about the
        blood-brain barrier (BBB) keeping the drug out of the
        organ you needed it in. The modern oncology kinase
        inhibitor catalog is finally a counterexample, and the
        medicinal chemistry that got there is worth understanding
        before designing the next one.
      </p>

      <h2>What the BBB actually is</h2>
      <p>
        The BBB is a tight-junction-sealed monolayer of
        endothelial cells lining cerebral capillaries, backed by
        astrocyte end-feet and pericytes. It does two things to
        small molecules. First, the tight junctions block
        paracellular diffusion — a route most non-CNS tissues
        permit freely. Second, the luminal membrane is loaded
        with active efflux transporters, principally
        <strong> P-glycoprotein (P-gp / MDR1 / ABCB1)</strong>{" "}
        and <strong>breast cancer resistance protein
        (BCRP / ABCG2)</strong>, that recognize a remarkably
        broad swath of lipophilic small molecules and pump them
        back into the blood. The result is that most oral
        oncology drugs achieve unbound brain-to-plasma ratios
        (Kp,uu,brain) well below 0.1 — meaning less than 10% of
        the free plasma concentration reaches the cerebrospinal
        compartment.
      </p>

      <h2>The properties that predict CNS exposure</h2>
      <p>
        Pajouhesh and Lenz (2005) summarized the original
        empirical rules from successful CNS drugs:
        molecular weight under 450, calculated logP between 2
        and 4, topological polar surface area (TPSA) under 60–70
        Å², fewer than 3 hydrogen bond donors, and a positively
        charged nitrogen often helping uptake. Those rules came
        from observed CNS drugs, not first principles, but they
        capture three constraints simultaneously: passive
        permeability, P-gp affinity, and plasma protein
        binding.
      </p>
      <p>
        Wager et al. (2010) turned that into the
        <strong> CNS MPO score</strong>, a 0–6 weighted score
        across six properties (clogP, clogD at pH 7.4, MW, TPSA,
        HBD count, pKa of the most basic center). A score of
        ≥4 has become the de facto bar for prioritizing CNS hits
        — empirically, ~75% of marketed CNS drugs hit that
        threshold, while only ~50% of marketed non-CNS drugs do.
        For oncology specifically, CNS MPO is a useful filter
        but not sufficient. P-gp efflux is the dominant
        confounder and it does not track perfectly with the
        physicochemical properties; you have to measure it.
      </p>

      <h2>The metric that matters: Kp,uu,brain</h2>
      <p>
        Total brain-to-plasma ratio (Kp,brain) is the easy
        measurement and the wrong number. A drug that is 99.9%
        bound to brain tissue and 99% bound in plasma can show
        a Kp of 0.5 and still have essentially zero free drug
        available to engage its target. The metric the field
        has converged on is
        <strong> Kp,uu,brain </strong>— the unbound (free)
        brain-to-plasma ratio at steady state. Kp,uu &gt; 0.3
        is generally considered adequate for CNS efficacy
        in oncology; the truly brain-penetrant compounds (the
        ones designed against P-gp from the start) tend to
        sit between 0.4 and 1.0.
      </p>
      <p>
        The reference Kp,uu numbers for FDA-approved oncology
        kinase inhibitors illustrate the range. Erlotinib sits
        around 0.05 — a strong P-gp substrate that essentially
        does not reach the brain. Imatinib is similar.
        Sotorasib is in the 0.1 range. On the other end of the
        ladder are the molecules engineered for brain
        penetration: <strong>osimertinib</strong> ~0.4 (the
        FLAURA trial showed CNS PFS HR of 0.48 versus first-gen
        TKIs), <strong>alectinib</strong> ~0.6–0.9 (a
        non-P-gp substrate by design, and the ALEX trial
        showed CNS PFS HR 0.18 versus crizotinib),{" "}
        <strong>lorlatinib</strong> &gt;0.6 (a macrocyclic
        third-generation ALK/ROS1 inhibitor explicitly built
        to evade P-gp), and <strong>tucatinib</strong> with
        documented CNS activity in HER2-positive breast
        cancer brain mets (HER2CLIMB trial, NEJM 2020).
      </p>

      <h2>What was learned from osimertinib</h2>
      <p>
        Osimertinib is the canonical case study because its
        CNS exposure was an explicit design objective and the
        clinical readout is robust. The medicinal chemistry
        team at AstraZeneca prioritized compounds with
        balanced lipophilicity (logD around 2), low TPSA
        (around 87 Å² — slightly above the classical CNS rule
        but offset by other properties), and critically, a
        low P-gp efflux ratio measured in MDR1-MDCK assays.
        The lessons that have propagated through
        post-osimertinib oncology medchem:
      </p>
      <ul>
        <li>
          <strong>Measure P-gp efflux directly.</strong>{" "}
          MDCK-MDR1 B-A/A-B efflux ratio is the routine
          experimental endpoint. A ratio under 2.5 is
          acceptable. Above 5 is a red flag for CNS.
        </li>
        <li>
          <strong>Watch HBD count.</strong> Every additional
          hydrogen bond donor disproportionately increases
          P-gp recognition. Capping a free NH (acetylation,
          methylation, intramolecular H-bond) often rescues
          a candidate.
        </li>
        <li>
          <strong>Keep TPSA below 90 Å².</strong> Above that,
          passive permeability drops sharply.
        </li>
        <li>
          <strong>Plasma free fraction matters too.</strong>{" "}
          A highly protein-bound drug has less free fraction
          to drive Kp,uu, regardless of permeability.
        </li>
        <li>
          <strong>Run a brain microdialysis or PET study
          early.</strong> In silico and in vitro screens are
          necessary but not sufficient — the in vivo Kp,uu
          measurement is the only one that lands.
        </li>
      </ul>

      <h2>What in silico actually predicts</h2>
      <p>
        Most published BBB classifiers are trained on a
        binary label (BBB+ / BBB-) from a few hundred drugs
        and report accuracy in the 80% range. They are useful
        as a triage filter and useless as a decision oracle.
        The 2025 ML literature has converged on a few
        consistent features driving BBB+ predictions: low
        TPSA, intermediate logP (2–4), low HBD count, and
        favorable shape. None of these are surprising and
        none individually beat the CNS MPO score on
        prospective validation. Where ML adds value is in
        flagging the structural features that correlate with
        P-gp recognition specifically — basic nitrogens in
        certain configurations, particular aromatic
        substitution patterns — which the classical
        physicochemical filters miss.
      </p>
      <p>
        The pragmatic recipe in 2026 is layered: CNS MPO score
        ≥4 as a coarse filter, an ML BBB classifier and a
        P-gp substrate predictor as a refinement, and in
        vitro MDR1-MDCK + brain homogenate binding as the
        decision data. The in silico stack tells you where
        to look; the wet bench tells you whether to go.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock your candidate against the relevant target.
        The ADMET panel runs CNS MPO, predicted logBB, P-gp
        substrate likelihood, and BBB+ classifier output on
        every candidate alongside the docking pose, so you
        get the binding affinity and the CNS-penetration
        flags in the same view. For brain-metastasis-relevant
        targets — EGFR (L858R, T790M, C797S), ALK (L1196M,
        G1202R), HER2, ROS1, BTK, BRAF V600E — the docking
        result is only useful if the molecule reaches the
        target, and Liganx surfaces both numbers side by side.
      </p>
      <p>
        Liganx is molecular docking online with the ADMET
        layer built in. If you want a quick read on whether
        a candidate is worth taking into a brain-met-relevant
        program, this is the fastest molecular docking path
        that returns CNS flags by default.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Pajouhesh H, Lenz GR.{" "}
          <em>Medicinal chemical properties of successful
          central nervous system drugs.</em> NeuroRx 2,
          541-553 (2005).{" "}
          <a
            href="https://doi.org/10.1602/neurorx.2.4.541"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1602/neurorx.2.4.541
          </a>
        </li>
        <li>
          Wager TT, Hou X, Verhoest PR, Villalobos A.{" "}
          <em>Moving beyond rules: the development of a
          central nervous system multiparameter
          optimization (CNS MPO) approach to enable
          alignment of druglike properties.</em> ACS Chem
          Neurosci 1, 435-449 (2010).{" "}
          <a
            href="https://doi.org/10.1021/cn100008c"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/cn100008c
          </a>
        </li>
        <li>
          Reungwetwattana T, Nakagawa K, Cho BC, et al.{" "}
          <em>CNS response to osimertinib versus standard
          epidermal growth factor receptor tyrosine kinase
          inhibitors in patients with untreated
          EGFR-mutated advanced non-small-cell lung
          cancer.</em> J Clin Oncol 36, 3290-3297 (2018).{" "}
          <a
            href="https://doi.org/10.1200/JCO.2018.78.3118"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1200/JCO.2018.78.3118
          </a>
        </li>
        <li>
          Gadgeel SM, Shaw AT, Govindan R, et al.{" "}
          <em>Pooled analysis of CNS response to alectinib
          in two studies of pretreated patients with ALK-
          positive non-small-cell lung cancer.</em> J Clin
          Oncol 34, 4079-4085 (2016).{" "}
          <a
            href="https://doi.org/10.1200/JCO.2016.68.4639"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1200/JCO.2016.68.4639
          </a>
        </li>
        <li>
          Murthy RK, Loi S, Okines A, et al.{" "}
          <em>Tucatinib, trastuzumab, and capecitabine
          for HER2-positive metastatic breast cancer.</em>{" "}
          N Engl J Med 382, 597-609 (2020).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1914609"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1914609
          </a>
        </li>
      </ul>
    </>
  );
}
