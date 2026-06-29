/**
 * Post: Consensus scoring in docking — why combining functions beats trusting one.
 *
 * SEO target: long-tail "consensus scoring docking", "rank-by-rank vs
 * rank-by-number", "consensus docking virtual screening". Methodology
 * theme. Internal CTA into /studio framing GNINA + Vina rescoring as a
 * two-function consensus the reader can run themselves.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "consensus-scoring-docking-virtual-screening",
  title: "Consensus scoring: why combining docking functions beats one",
  description:
    "Every scoring function is wrong in its own way. Consensus scoring cancels the uncorrelated errors. Here is how rank-by-rank, rank-by-vote, and ECR actually work.",
  date: "2026-06-09",
  author: "Liganx team",
  tags: ["docking-method", "virtual-screening", "scoring", "consensus"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        No docking scoring function is trustworthy on its own. Each one
        encodes a different set of approximations about electrostatics,
        desolvation, and entropy, and each fails on a different slice of
        chemical space. Consensus scoring is the pragmatic response: run
        several functions, combine their verdicts, and let the
        uncorrelated errors cancel. It is one of the oldest tricks in
        structure-based virtual screening and still one of the most
        reliable.
      </p>

      <h2>Why a single score lies to you</h2>
      <p>
        A docking score is a model of binding free energy, and every model
        cuts corners. Empirical functions like AutoDock Vina fit a handful
        of physically motivated terms to known affinities. Knowledge-based
        functions derive potentials from the statistics of the PDB.
        Machine-learning functions like GNINA&rsquo;s CNN learn a scoring
        surface from thousands of co-crystal poses. They disagree because
        they are wrong in different places: Vina tends to over-reward
        buried hydrophobic surface, knowledge-based potentials inherit the
        biases of whatever crystal structures dominate the training set,
        and CNN scorers can be fooled by chemotypes unlike anything they
        saw in training.
      </p>
      <p>
        The key statistical insight, formalized by Wang and Wang in 2001,
        is that if the errors of different functions are at least partly
        <em>independent</em>, averaging them reduces the variance of the
        estimate. The true binding signal is shared across functions; the
        noise is not. Average enough semi-independent estimates and the
        noise shrinks while the signal survives. That is the entire
        theoretical justification for consensus scoring, and it is why it
        only helps when the functions you combine are genuinely different
        in construction.
      </p>

      <h2>The three classic combination schemes</h2>
      <p>
        Charifson and colleagues introduced consensus scoring in 1999 and
        showed it cut false-positive rates against three targets. The
        schemes they and their successors use fall into three families:
      </p>
      <ul>
        <li>
          <strong>Rank-by-number</strong> — normalize each function&rsquo;s
          raw scores onto a common scale and average the numbers. Simple,
          but sensitive to outliers and to the wildly different scales and
          offsets that scoring functions produce.
        </li>
        <li>
          <strong>Rank-by-rank</strong> — convert each function&rsquo;s output
          to a rank order, then average the ranks. This throws away the
          magnitude of the scores but is immune to scale and unit
          mismatches, which is exactly the failure mode that wrecks
          rank-by-number.
        </li>
        <li>
          <strong>Rank-by-vote</strong> — give a compound one vote from
          each function that places it in, say, the top 10 percent, then
          rank by vote count. Brutally simple, surprisingly robust, and
          the easiest to reason about when you have only two or three
          functions.
        </li>
      </ul>
      <p>
        A more modern refinement is <strong>Exponential Consensus Ranking
        (ECR)</strong>, which weights each function&rsquo;s contribution by an
        exponential of the compound&rsquo;s rank. ECR rewards molecules that
        land near the top of <em>any</em> function rather than demanding
        agreement everywhere, and Palacio-Rodriguez and colleagues showed
        in 2019 that it improves enrichment in both single-structure and
        receptor-ensemble docking. It is rank-based, so it inherits
        rank-by-rank&rsquo;s immunity to scale problems while being less
        punishing toward a real binder that one function happens to score
        poorly.
      </p>

      <h2>Pose consensus is a different thing</h2>
      <p>
        Consensus <em>scoring</em> combines affinity estimates. Consensus
        <em>docking</em> combines geometries: you dock with several engines
        and keep poses that multiple programs place in the same spot,
        usually defined as an inter-pose RMSD under 2 angstrom. The logic
        is the same variance-cancellation argument applied to coordinates
        instead of scores. A pose that three independent samplers
        converge on is far more likely to be the real binding mode than a
        pose only one engine likes. The strongest workflows do both:
        require geometric agreement first, then rank the survivors by a
        consensus score. RSC Advances published a clean demonstration in
        2021 that combining pose consensus with rank consensus beats
        either alone.
      </p>

      <h2>When consensus does not help</h2>
      <p>
        Consensus scoring is not free lunch. If your functions share a
        systematic bias, averaging them just averages the bias and gives
        you false confidence. Three knowledge-based functions all trained
        on the same skewed PDB slice will agree with each other and still
        be wrong together. The independence assumption is load-bearing:
        the more your functions resemble one another in construction, the
        less consensus buys you. Combine an empirical function, a
        knowledge-based one, and a learned one before you combine three
        flavors of the same idea.
      </p>
      <p>
        It also costs compute. Each added function multiplies the
        rescoring time, and past three or four functions the marginal
        enrichment gain usually flattens. For a focused
        mutation-selectivity question on a handful of ligands the cost is
        trivial; for a million-compound library it is a real budget line.
      </p>

      <h2>Try a two-function consensus yourself</h2>
      <p>
        You do not need a screening cluster to see the effect. The
        cheapest useful consensus is two functions of different lineage:
        an empirical search function and a learned rescorer.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock your ligand set with Vina, then rescore the top poses
        with GNINA&rsquo;s CNN. Where the two functions agree on the top
        ranks, trust the result; where they disagree, that is exactly the
        molecule worth inspecting by hand in the pose viewer. That
        disagreement signal is the practical payoff of consensus thinking,
        and it shows up most sharply on the close ΔΔ calls between a
        wild-type pocket and its mutant.
      </p>
      <p>
        Liganx puts molecular docking online and free in the browser, so
        running molecular docking through two scoring functions and
        comparing their rankings takes a couple of clicks rather than a
        pipeline.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Charifson PS, Corkery JJ, Murcko MA, Walters WP.{" "}
          <em>
            Consensus scoring: a method for obtaining improved hit rates
            from docking databases of three-dimensional structures into
            proteins.
          </em>{" "}
          J Med Chem 42, 5100-5109 (1999).{" "}
          <a
            href="https://doi.org/10.1021/jm990352k"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/jm990352k
          </a>
        </li>
        <li>
          Wang R, Wang S.{" "}
          <em>
            How does consensus scoring work for virtual library screening?
            An idealized computer experiment.
          </em>{" "}
          J Chem Inf Comput Sci 41, 1422-1426 (2001).{" "}
          <a
            href="https://doi.org/10.1021/ci010025x"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/ci010025x
          </a>
        </li>
        <li>
          Palacio-Rodriguez K, Lans I, Cavasotto CN, Cossio P.{" "}
          <em>
            Exponential consensus ranking improves the outcome in docking
            and receptor ensemble docking.
          </em>{" "}
          Sci Rep 9, 5142 (2019).{" "}
          <a
            href="https://doi.org/10.1038/s41598-019-41594-3"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41598-019-41594-3
          </a>
        </li>
      </ul>
    </>
  );
}
