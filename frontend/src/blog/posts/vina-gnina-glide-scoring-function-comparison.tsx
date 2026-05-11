/**
 * Post: Scoring function comparison — when to trust Vina, GNINA, Glide,
 * and when none of them are enough.
 *
 * SEO target: "Vina vs GNINA", "GNINA CNN scoring", "Glide scoring
 * function", "docking scoring function benchmark", "rescoring docking
 * poses". Methodology post; internal CTA into /studio which ships
 * both AutoDock Vina and GNINA (CNN rescoring) for the same job.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "vina-gnina-glide-scoring-function-comparison",
  title: "Vina, GNINA, and Glide: what each scoring function buys you",
  description:
    "An honest comparison of the three workhorse docking scoring functions in 2026 — what they actually optimize for, where they fail, and how to combine them.",
  date: "2026-05-10",
  author: "Liganx team",
  tags: ["docking-method", "scoring-function", "gnina", "vina"],
  readingMin: 8,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Docking has three workhorse scoring functions in 2026: AutoDock
        Vina (empirical, open source), GNINA (Vina poses rescored by a
        convolutional neural network, open source), and Schr&ouml;dinger
        Glide (physics-based with proprietary terms, commercial). They
        get used interchangeably in the literature, which is a mistake.
        They optimize different things, fail in different ways, and the
        right move is usually to run more than one and look at where
        they agree.
      </p>

      <h2>What each one is actually doing</h2>
      <p>
        <strong>AutoDock Vina</strong> (Trott &amp; Olson 2010, Eberhardt
        et al. 2021) is an empirical scoring function: a weighted sum of
        gauss, repulsion, hydrophobic, hydrogen-bond, and torsional terms,
        with the weights fit to reproduce known binding affinities on a
        training set of protein-ligand complexes. The search is iterated
        local optimization with a Monte Carlo metaheuristic. Vina is fast,
        widely benchmarked, and the de-facto default for academic docking.
        On standard pose-reproduction benchmarks (PDBbind, CASF) it
        recovers a sub-2&nbsp;&Aring; pose for the top-scored result ~60&ndash;70%
        of the time on cross-docked complexes.
      </p>
      <p>
        <strong>GNINA</strong> (McNutt et al. 2021, Francoeur et al. 2020)
        keeps Vina&apos;s sampling engine but replaces the scoring step
        with a 3D convolutional neural network trained on ~25M poses with
        crystallographic ground truth labels. The network sees a 3D
        density grid of the pocket plus ligand and outputs a CNNscore
        (probability the pose is correct) plus a CNNaffinity (predicted
        pK). On the CASF-2016 docking power benchmark, GNINA improves
        top-1 pose accuracy over Vina by roughly 10&ndash;15 percentage
        points on most target classes. Where it shines: highly flexible
        pockets and ligand series where pharmacophore complementarity
        matters more than coarse fit.
      </p>
      <p>
        <strong>Glide</strong> (Friesner et al. 2004, 2006) uses a custom
        empirical scoring function (GlideScore) with terms for lipophilic
        contacts, hydrogen bonds, metal binding, rotatable bond penalty,
        and a Coulomb/vdW component. Its big differentiator is the
        sampling strategy: an exhaustive funnel from rigid initial
        placement through stepped refinement, with constraints from
        pharmacophore features that the user can specify. Glide SP and
        Glide XP are the two tiers &mdash; XP adds explicit water terms
        and more aggressive scoring penalties. Glide XP is the closest
        the industry gets to a &ldquo;trusted&rdquo; scoring function in
        prospective programs, at the cost of being closed source and
        license-gated.
      </p>

      <h2>Three things scoring functions are bad at</h2>
      <p>
        Before comparing them, it helps to be honest about what none of
        them do well.
      </p>
      <ul>
        <li>
          <strong>Absolute affinity prediction</strong>. Every workhorse
          scoring function correlates with experimental pK at around
          r&nbsp;=&nbsp;0.5&ndash;0.7 on broad benchmarks (Su et al.
          2019). That is useful for ranking within a congeneric series,
          and not at all useful for predicting whether a novel scaffold
          will hit at 10&nbsp;nM. If you see a docking paper claiming
          predicted IC50, treat it the way you would treat a weather
          forecast from a Magic 8-Ball.
        </li>
        <li>
          <strong>Entropy</strong>. None of them model conformational
          entropy of the bound ligand with any rigor. The torsional
          term in Vina is a counting heuristic; Glide&apos;s rotatable-bond
          penalty is similar. Ligands with many rotatable bonds tend to
          be over-scored relative to rigidified analogs that perform
          better in cells.
        </li>
        <li>
          <strong>Explicit waters</strong>. Bridging waters in the binding
          site matter enormously and none of the standard scoring
          functions handle them well. Glide XP has a partial answer
          (WaterMap-derived terms); GNINA sees waters if you include
          them in the grid but most users don&apos;t; Vina ignores them
          entirely. If your target has a known crystallographic bridging
          water (kinase hinge waters, HIV protease flap waters), include
          it as part of the receptor or your scores are not telling you
          what you think.
        </li>
      </ul>

      <h2>What the rescoring strategy buys you</h2>
      <p>
        The cleanest pattern in the literature is the &ldquo;dock with
        Vina, rescore with GNINA&rdquo; workflow. Vina&apos;s sampling
        engine is well-tuned and fast; GNINA&apos;s CNN scoring catches
        cases where Vina&apos;s linear-combination scoring overweights
        coarse contact area at the expense of specific interactions.
        Francoeur et al. (2020) showed that for cross-docking benchmarks
        the rescoring strategy outperforms either Vina-alone or
        GNINA-alone, with the biggest gains on protein families with
        sub-pocket plasticity (kinases, GPCRs, nuclear receptors).
      </p>
      <p>
        Two practical caveats worth flagging. First, the CNN model has
        seen its training set; novel chemotypes that are structurally
        far from anything in PDBbind can get penalized by the network
        for reasons that aren&apos;t physically meaningful. Always inspect
        the top pose visually before trusting a confident-looking score.
        Second, the GNINA TVM CUDA kernels are sensitive to GPU
        architecture &mdash; the prebuilt binaries run cleanly on most
        consumer and datacenter cards, but the bleeding-edge
        Blackwell-generation (sm_100/sm_120) chips need a fallback path
        with CNN scoring disabled. If you are running on a B200 or RTX
        5090 today, expect to either rebuild from source or use
        Vina-only mode for the CNN rescoring step until upstream
        patches land.
      </p>

      <h2>How we use them in practice</h2>
      <p>
        The pragmatic rule we have settled on:
      </p>
      <ul>
        <li>
          <strong>Discovery-phase, broad virtual screen of millions of
          compounds</strong>: Vina, top 1&ndash;5% triaged by CNN
          rescoring with GNINA. The throughput math doesn&apos;t work
          otherwise.
        </li>
        <li>
          <strong>Lead optimization within a series</strong>: Glide XP if
          you have a license, otherwise GNINA CNN with the caveat that
          ranking small ligand modifications is at the edge of what
          either tool reliably does. Wet-lab SAR is still the source of
          truth.
        </li>
        <li>
          <strong>Mutation-selectivity questions</strong>: rank by
          &Delta;&Delta;G between wild-type and mutant receptor, not by
          absolute score. All three scoring functions are noisier on
          absolute numbers than on relative differences when the receptor
          chemistry is held mostly constant. The mutation deep-dives we
          have written on{" "}
          <Link
            to="/blog/t790m-osimertinib-resistance"
            className="text-cyan-600 dark:text-cyan-400 underline"
          >
            EGFR T790M
          </Link>{" "}
          and{" "}
          <Link
            to="/blog/kras-g12c-clinical-landscape"
            className="text-cyan-600 dark:text-cyan-400 underline"
          >
            KRAS G12C
          </Link>{" "}
          both lean on this &Delta;&Delta; pattern.
        </li>
        <li>
          <strong>Pose validation before reporting</strong>: PoseBusters
          (Buttenschoen et al. 2024) on the top pose before publishing
          or moving to synthesis. It catches the chemistry-violation
          failure modes (impossible bond lengths, intermolecular clashes,
          steric impossibilities) that scoring functions sometimes wave
          through.
        </li>
      </ul>

      <h2>Try the comparison yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick any target from the catalog. Dock your candidate with
        Vina (default), then enable GNINA CNN rescoring on the same job.
        The result row shows both scores side-by-side, and the pose
        viewer overlays the top Vina pose and the top CNN-reranked pose
        so you can see whether the rescoring changed which pose won.
        On well-behaved kinase targets they agree most of the time; on
        flexible pockets with bridging waters they often disagree, and
        that disagreement is itself a useful signal. When the two
        functions point at the same pose with similar confidence,
        that&apos;s the case you can trust without additional follow-up.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Trott O, Olson AJ. <em>AutoDock Vina: improving the speed and
          accuracy of docking with a new scoring function, efficient
          optimization, and multithreading.</em> J Comput Chem 31,
          455&ndash;461 (2010).{" "}
          <a
            href="https://doi.org/10.1002/jcc.21334"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1002/jcc.21334
          </a>
        </li>
        <li>
          McNutt AT, et al. <em>GNINA 1.0: molecular docking with deep
          learning.</em> J Cheminform 13, 43 (2021).{" "}
          <a
            href="https://doi.org/10.1186/s13321-021-00522-2"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1186/s13321-021-00522-2
          </a>
        </li>
        <li>
          Friesner RA, et al. <em>Extra Precision Glide: Docking and
          Scoring Incorporating a Model of Hydrophobic Enclosure for
          Protein-Ligand Complexes.</em> J Med Chem 49, 6177&ndash;6196
          (2006).{" "}
          <a
            href="https://doi.org/10.1021/jm051256o"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/jm051256o
          </a>
        </li>
        <li>
          Buttenschoen M, Morris GM, Deane CM. <em>PoseBusters: AI-based
          docking methods fail to generate physically valid poses or
          generalise to novel sequences.</em> Chem Sci 15, 3130&ndash;3139
          (2024).{" "}
          <a
            href="https://doi.org/10.1039/D3SC04185A"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1039/D3SC04185A
          </a>
        </li>
      </ul>
    </>
  );
}
