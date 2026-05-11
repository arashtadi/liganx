/**
 * Post: T790M and osimertinib — what the docking actually shows
 *
 * SEO target: long-tail "EGFR T790M resistance mutation", "osimertinib
 * resistance mechanism", "C797S resistance". Internal CTA into /studio
 * with EGFR + T790M pre-loaded so the reader can dock osimertinib
 * against both the WT and the resistance mutant in two clicks.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "t790m-osimertinib-resistance",
  title: "T790M, C797S, and the EGFR resistance staircase",
  description:
    "How EGFR resistance mutations evolved across three generations of inhibitors, what the docking actually shows, and why C797S is harder than T790M ever was.",
  date: "2026-05-07",
  author: "Liganx team",
  tags: ["egfr", "oncology", "resistance", "docking-method"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        EGFR resistance is the textbook study in iterative drug discovery.
        Each generation of inhibitor solved the resistance problem the last
        generation created, and the structural reason for the shift each
        time is something you can see in a docking pose. Worth walking
        through carefully because most cancer-target programs eventually
        face this same staircase.
      </p>

      <h2>Generation one: gefitinib, erlotinib, and the L858R era</h2>
      <p>
        Gefitinib (Iressa) and erlotinib (Tarceva) were the first targeted
        therapies for EGFR-mutant NSCLC. They&rsquo;re reversible ATP-competitive
        binders. Tumors with the L858R activating mutation — the most
        common sensitizing mutation in non-smoker NSCLC — respond
        spectacularly at first. Median PFS around 10-13 months. Then
        almost every patient progresses.
      </p>
      <p>
        The reason: <strong>T790M</strong>. A threonine-to-methionine
        substitution at position 790, in the gatekeeper position of the
        ATP-binding pocket. The bulky methionine sidechain doesn&rsquo;t kick the
        drug out — it sits in a way that <em>increases</em> ATP affinity,
        so the drug just gets outcompeted. This is the resistance signal
        you should expect to see in a docking benchmark: WT and L858R both
        show strong gefitinib binding (-9 to -10 kcal/mol typical), T790M
        shows a 1-2 kcal/mol degradation. Vina captures it; the score gap
        is small enough that it&rsquo;s worth re-scoring with GNINA&rsquo;s CNN to
        confirm the pose ranking didn&rsquo;t flip.
      </p>

      <h2>Generation two: afatinib, dacomitinib, and the irreversible bet</h2>
      <p>
        Afatinib was the first attempt at a covalent EGFR inhibitor.
        Theory: if you&rsquo;re covalently bound, you can&rsquo;t be outcompeted by
        ATP, so T790M shouldn&rsquo;t matter. In practice, afatinib&rsquo;s problem
        wasn&rsquo;t T790M — it was that the covalent warhead also hits
        wild-type EGFR (and HER2), causing the rash and diarrhea that
        capped the achievable dose. Patients couldn&rsquo;t tolerate enough
        drug to overcome T790M in the tumor.
      </p>

      <h2>Generation three: osimertinib (and the AZD9291 design story)</h2>
      <p>
        Osimertinib (Tagrisso, AZD9291) is the answer to both problems.
        It&rsquo;s a covalent inhibitor — irreversibly bonds to Cys797 in the
        ATP pocket — but it has ~200x higher affinity for T790M-mutant
        EGFR than for wild-type. The selectivity comes from a single
        methoxy substituent that reaches into a hydrophobic cavity
        opened by the T790M sidechain. WT EGFR doesn&rsquo;t have that cavity
        (T790 is small), so the drug doesn&rsquo;t fit as well.
      </p>
      <p>
        This is the kind of rational selectivity design a docking workflow
        ought to be able to recover. The pose against T790M shows the
        methoxy nestled into the M790 pocket; against WT EGFR the same
        group is solvent-exposed and the binding energy degrades by
        2-3 kcal/mol. <strong>This is the actual selectivity story</strong>
        — not a single number, but a structural rationale you can point
        at in the pose viewer.
      </p>

      <h2>Generation four: C797S and the wall we hit</h2>
      <p>
        Patients on osimertinib eventually progress too. The most common
        resistance mutation now is <strong>C797S</strong> — the cysteine
        the covalent warhead bonds to is gone. No cysteine, no covalent
        bond. This is harder than T790M ever was, because every covalent
        EGFR inhibitor in development bets on Cys797 the same way.
      </p>
      <p>
        The active research threads:
      </p>
      <ul>
        <li>
          <strong>Allosteric binders</strong> (EAI045, JBJ-04-125-02) bind
          outside the ATP pocket entirely. C797S doesn&rsquo;t affect the binding
          site. Affinity is lower than ATP-pocket binders, so combinations
          with cetuximab are needed.
        </li>
        <li>
          <strong>4th-gen ATP-competitive non-covalent</strong> (BLU-945,
          BBT-176) hit T790M + C797S without needing the covalent bond.
          The clinical readouts so far are early but encouraging.
        </li>
        <li>
          <strong>EGFR-degraders</strong> (PROTAC approach) — same
          rationale as KRAS PROTACs. You can&rsquo;t mutate around a target
          that&rsquo;s been degraded.
        </li>
      </ul>

      <h2>What this means for your docking workflow</h2>
      <p>
        The lesson from EGFR is that <em>ranking</em> matters more than
        absolute scores. Each generation of inhibitor was selected because
        the WT/mutant Δ pointed in the right direction, even when the
        absolute scores stayed in a narrow range. When you&rsquo;re using Liganx
        for a mutation-selectivity question, the number to watch is the
        ΔΔ between WT and mutant — small, consistent gaps mean more than
        any single -10 kcal/mol score.
      </p>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick EGFR from the target catalog. The mutation chips include
        L858R, T790M, and C797S. Dock osimertinib against all three at
        once and you&rsquo;ll see the staircase: strong binding on L858R
        (sensitizing), even stronger on T790M (the &ldquo;designed
        selectivity&rdquo; pocket), severely degraded on C797S (warhead
        misses). That&rsquo;s the EGFR resistance story in three docking
        cells.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Cross DA, et al. <em>AZD9291, an irreversible EGFR TKI, overcomes
          T790M-mediated resistance to EGFR inhibitors in lung cancer.</em>{" "}
          Cancer Discov 4, 1046–1061 (2014).{" "}
          <a
            href="https://doi.org/10.1158/2159-8290.CD-14-0337"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2159-8290.CD-14-0337
          </a>
        </li>
        <li>
          Thress KS, et al. <em>Acquired EGFR C797S mediates resistance to
          AZD9291 in advanced non-small cell lung cancer harboring EGFR
          T790M.</em> Nat Med 21, 560–562 (2015).{" "}
          <a
            href="https://doi.org/10.1038/nm.3854"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nm.3854
          </a>
        </li>
        <li>
          Jia Y, et al. <em>Overcoming EGFR(T790M) and EGFR(C797S)
          resistance with mutant-selective allosteric inhibitors.</em>{" "}
          Nature 534, 129–132 (2016).
        </li>
      </ul>
    </>
  );
}
