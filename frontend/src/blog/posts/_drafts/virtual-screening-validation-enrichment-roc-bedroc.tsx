/**
 * Post: Validating a virtual screen — enrichment factor, ROC-AUC,
 * BEDROC, and why your decoy set is doing half the work.
 *
 * SEO target: "enrichment factor virtual screening", "ROC AUC docking",
 * "BEDROC early recognition", "DUD-E decoys", "LIT-PCBA benchmark",
 * "virtual screening validation". Methodology post; internal CTA into
 * /studio around retrospective validation before a prospective screen.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "virtual-screening-validation-enrichment-roc-bedroc",
  title: "Validating a virtual screen: enrichment, ROC-AUC, and BEDROC",
  description:
    "Before you trust a docking screen, you validate it on knowns. Here is what enrichment factor, ROC-AUC, and BEDROC each measure, and why your decoy set quietly sets the score.",
  date: "2026-07-19",
  author: "Liganx team",
  tags: ["virtual-screening", "docking-method", "benchmarking", "enrichment"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        A virtual screen produces a ranked list of millions of compounds.
        The only honest way to know whether that ranking is worth acting on
        is to first run the exact same protocol on a set where you already
        know the answer &mdash; a pool of confirmed actives spiked into a
        much larger pool of presumed inactives &mdash; and measure how well
        the actives float to the top. That is retrospective validation, and
        the three metrics you will see quoted for it (enrichment factor,
        ROC-AUC, and BEDROC) answer subtly different questions. Confusing
        them is one of the most common ways docking papers oversell a
        method.
      </p>

      <h2>Enrichment factor: how much better than random, up top</h2>
      <p>
        The enrichment factor (EF) is the most intuitive metric. Take the
        top <em>x%</em> of your ranked list and count how many actives fell
        into it. Divide the fraction of all actives you captured by{" "}
        <em>x%</em>. An EF of 1 is random. An EF of 20 at the top 1% (written
        EF<sub>1%</sub> = 20) means the top 1% of your list is 20 times
        richer in actives than chance would give you.
      </p>
      <p>
        EF maps directly onto what a screener actually does &mdash; buy or
        synthesize the top slice &mdash; which is why it survives despite
        real weaknesses. The two big ones: EF is bounded by the ratio of
        actives to the size of the slice (if you have more actives than fit
        in the top 1%, EF<sub>1%</sub> literally cannot reach its nominal
        ceiling), and it is a single point on a curve, blind to everything
        below the cutoff. Two methods with identical EF<sub>1%</sub> can
        look completely different at 5%.
      </p>

      <h2>ROC-AUC: overall ranking, and why it can flatter you</h2>
      <p>
        The receiver operating characteristic curve plots true-positive rate
        against false-positive rate as you walk down the ranked list; the
        area under it (AUC) summarizes the whole thing in one number. AUC of
        0.5 is random, 1.0 is perfect, and it has a clean interpretation:
        the probability that a randomly chosen active is ranked above a
        randomly chosen inactive.
      </p>
      <p>
        The catch is that ROC-AUC weights the entire list equally. A method
        that scatters actives usefully near the top but also has a few
        stragglers at the bottom can score the same AUC as a method with a
        flat, mediocre gradient. In screening you only ever look at the top,
        so &ldquo;good overall ranking&rdquo; is not the same as &ldquo;good
        early recognition.&rdquo; A protocol can post a respectable AUC of
        0.80 and still be useless for the top-1% decision you care about.
        This is the well-known &ldquo;early recognition problem.&rdquo;
      </p>

      <h2>BEDROC: putting the weight where the money is</h2>
      <p>
        BEDROC (Boltzmann-Enhanced Discrimination of ROC), introduced by
        Truchon and Bayly in 2007, was built to fix exactly that. It applies
        an exponential weighting that gives early-ranked actives far more
        credit than late ones, controlled by a parameter &alpha;. The
        common setting &alpha; = 20 concentrates roughly 80% of the maximum
        score in the top 8% of the list &mdash; a deliberate match to how a
        real campaign triages. BEDROC ranges 0 to 1 and, unlike a bare EF,
        integrates over the early region rather than reporting one point.
      </p>
      <p>
        BEDROC has its own quirks &mdash; it is sensitive to the ratio of
        actives to inactives, so BEDROC values are only comparable across
        benchmarks with the same composition &mdash; but as an early-
        recognition summary it is far more honest than AUC alone. The
        pragmatic habit worth adopting: report EF at one or two cutoffs{" "}
        <em>and</em> BEDROC, never a lone AUC.
      </p>

      <h2>The part nobody controls for: your decoys</h2>
      <p>
        Here is the uncomfortable truth about all three metrics: they are
        only as meaningful as the inactive set you validate against. If your
        &ldquo;decoys&rdquo; are trivially different from your actives
        &mdash; wrong molecular weight, wrong charge, wrong logP &mdash;
        then any scoring function that has learned crude physical
        properties will separate them, and your enrichment will look
        spectacular for reasons that have nothing to do with binding. This
        is called analog bias, and it has flattered countless published
        screens.
      </p>
      <ul>
        <li>
          <strong>DUD-E</strong> (Mysinger et al., 2012) addressed this by
          generating property-matched decoys: for each active, decoys are
          picked to match physicochemical properties (molecular weight,
          logP, rotatable bonds, hydrogen-bond counts, net charge) while
          being topologically dissimilar, at roughly 50 decoys per active.
          It became the default docking benchmark &mdash; and then a
          cautionary tale, because deep-learning models learned to exploit
          its residual property signatures rather than learning binding.
        </li>
        <li>
          <strong>LIT-PCBA</strong> (Tran-Nguyen et al., 2020) went the
          other direction: instead of computational decoys, it uses{" "}
          <em>experimentally confirmed</em> inactives from PubChem
          bioassays, with active/inactive ratios that reflect real
          screening hit rates. It is a harder, more realistic benchmark, and
          methods that shine on DUD-E often deflate on it &mdash; which is
          the point.
        </li>
      </ul>
      <p>
        The practical rule: a headline enrichment number without a described
        decoy set is uninterpretable. When you read (or run) a validation,
        the decoy construction is not a footnote &mdash; it is half the
        experiment.
      </p>

      <h2>How to use this before a real screen</h2>
      <p>
        The workflow that keeps you honest: assemble known actives and
        property-matched (or, better, experimentally confirmed) inactives for
        your target, run your intended docking protocol unchanged, and
        compute EF<sub>1%</sub>, ROC-AUC, and BEDROC together. If early
        recognition is weak, fix the protocol &mdash; grid placement,
        receptor conformation, scoring choice &mdash; before you spend
        compute on millions of unknowns. Retrospective validation is cheap
        insurance against a prospective screen that ranks noise.
      </p>

      <h2>Try a validation run yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and set up a small retrospective test on any catalog target: dock a
        handful of known binders alongside property-matched decoys, then look
        at where the knowns land in the ranking before you trust the same
        protocol on a large library. Our companion pieces on{" "}
        <Link
          to="/blog/ultra-large-library-virtual-screening"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          ultra-large library screening
        </Link>{" "}
        and{" "}
        <Link
          to="/blog/vina-gnina-glide-scoring-function-comparison"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          scoring function choice
        </Link>{" "}
        cover the protocol knobs that most change these enrichment numbers.
      </p>
      <p>
        Because Liganx offers molecular docking online and free, you can run
        a retrospective enrichment check in the browser before committing a
        large molecular docking screen to compute.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Truchon JF, Bayly CI. <em>Evaluating Virtual Screening Methods:
          Good and Bad Metrics for the &ldquo;Early Recognition&rdquo;
          Problem.</em> J Chem Inf Model 47, 488&ndash;508 (2007).{" "}
          <a
            href="https://doi.org/10.1021/ci600426e"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/ci600426e
          </a>
        </li>
        <li>
          Mysinger MM, Carchia M, Irwin JJ, Shoichet BK. <em>Directory of
          Useful Decoys, Enhanced (DUD-E): Better Ligands and Decoys for
          Better Benchmarking.</em> J Med Chem 55, 6582&ndash;6594 (2012).{" "}
          <a
            href="https://doi.org/10.1021/jm300687e"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/jm300687e
          </a>
        </li>
        <li>
          Tran-Nguyen VK, Jacquemard C, Rognan D. <em>LIT-PCBA: An Unbiased
          Data Set for Machine Learning and Virtual Screening.</em> J Chem
          Inf Model 60, 4263&ndash;4273 (2020).{" "}
          <a
            href="https://doi.org/10.1021/acs.jcim.0c00155"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jcim.0c00155
          </a>
        </li>
      </ul>
    </>
  );
}
