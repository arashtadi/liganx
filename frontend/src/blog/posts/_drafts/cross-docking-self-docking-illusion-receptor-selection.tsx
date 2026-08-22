/**
 * Post: Cross-docking and the self-docking illusion.
 *
 * SEO target: "cross-docking", "self-docking", "redocking benchmark",
 * "receptor conformation selection docking". Internal CTA into /studio's
 * ensemble docking mode.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "cross-docking-self-docking-illusion-receptor-selection",
  title: "Cross-docking and the self-docking illusion",
  description:
    "Docking your own co-crystal ligand back into its own structure flatters your protocol. Real prospective docking is cross-docking, and the numbers are humbling.",
  date: "2026-07-24",
  author: "Liganx team",
  tags: ["docking", "methodology", "benchmarking", "ensemble"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Almost every docking protocol looks great on paper, because the test
        people run is the easiest possible one: take a crystal structure, pull
        out its bound ligand, and dock the same ligand back into the same
        structure. That is self-docking, and modern engines pass it most of the
        time. But it is not the task you actually face in a project, where you
        have one structure and a hundred compounds that were never crystallized
        in it. That task is cross-docking, and the success rate is far lower.
        The gap between the two is where a lot of virtual-screening
        disappointment is born.
      </p>

      <h2>Why self-docking is too easy</h2>
      <p>
        A protein is not rigid. Its binding-site side chains, loops, and
        backbone shift to accommodate whatever ligand is bound — the classic
        induced-fit effect. When you self-dock, the receptor is already frozen
        in the exact conformation that fits your ligand perfectly, because that
        ligand is what it crystallized with. The pocket shape and the answer are
        baked into the input. So a high self-docking success rate mostly tells
        you the scoring function can recognize a pose it was handed the mold for.
      </p>
      <p>
        The benchmark numbers make the point bluntly. In a kinase cross-docking
        study, the Posit method reproduced the correct pose in about 92 percent
        of self-docking cases but only about 33 percent when a receptor
        structure was chosen at random for a different ligand. A physics-based
        engine dropped from roughly 84 percent to 24 percent across the same
        split. Same software, same ligands — the only thing that changed was
        whether the receptor had already seen the ligand.
      </p>

      <h2>What cross-docking actually measures</h2>
      <p>
        Cross-docking asks the honest question: given a receptor conformation
        that was determined with some other ligand, can you still place a novel
        compound within about 2 Angstrom RMSD of its true binding mode? This is
        the prospective situation, and it exposes two separate failure modes.
        One is that the frozen pocket simply cannot fit the new ligand because a
        side chain is in the way — a sampling and flexibility problem. The other
        is that several plausible poses fit and the scoring function ranks the
        wrong one first — a scoring problem. Self-docking hides both.
      </p>

      <h2>Receptor choice is the biggest lever</h2>
      <p>
        The single most important decision in a cross-docking campaign is which
        receptor structure to dock into, and the spread is large. When
        researchers compared selection strategies on a benchmark, the results
        ranged widely by method:
      </p>
      <ul>
        <li>
          <strong>Random single structure</strong> — around 41 percent success.
          The coin-flip baseline, and the trap most people fall into by grabbing
          the first PDB hit.
        </li>
        <li>
          <strong>Largest-pocket-volume structure</strong> — around 50 percent.
          A roomier pocket tolerates more chemotypes, so picking the most open
          conformation helps.
        </li>
        <li>
          <strong>Best single structure (retrospective)</strong> — up to about
          69 percent. This is the ceiling if you somehow knew the ideal receptor
          in advance, which of course you never do.
        </li>
      </ul>
      <p>
        The lesson is that no single crystal structure is representative. The
        one you happened to download can quietly cost you thirty points of
        success rate.
      </p>

      <h2>Ensembles close part of the gap</h2>
      <p>
        Because you cannot know the best receptor ahead of time, the practical
        answer is to not commit to one. Ensemble docking runs each compound
        against several receptor conformations — multiple crystal structures,
        or snapshots from molecular dynamics, or normal-mode-perturbed models —
        and keeps the best result per compound. In the cross-docking literature,
        ensembles consistently recover poses that any individual structure
        misses: near-native solutions that appear in the top few ranked poses
        far more often than a single rigid receptor delivers. You are trading
        compute for coverage, letting the ligand pick the pocket that fits it
        instead of forcing it into the one you chose.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The way to feel this is to run the same compound against one structure
        and then against a panel. <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">Open Studio</Link>{" "}
        and dock a ligand into a single receptor, then switch on ensemble mode to
        score it across multiple conformations of the same target and compare the
        best pose and score. When the ensemble result beats the single-structure
        one, you have just watched the self-docking illusion evaporate in real
        time. Running molecular docking online against an ensemble rather than a
        lone crystal is the closest you get, in a browser, to the prospective
        task your project actually is.
      </p>
      <p>
        Liganx brings molecular docking online with an ensemble option built in,
        so treating receptor flexibility as a first-class variable does not mean
        standing up your own MD pipeline. Using molecular docking across several
        receptor conformations is the cheapest honesty upgrade you can give a
        virtual screen.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Wierbowski SD, Wingert BM, Zheng J, Camacho CJ. <em>Cross-docking
          benchmark for automated pose and ranking prediction of ligand
          binding.</em> Protein Sci 29, 298-305 (2020).{" "}
          <a
            href="https://doi.org/10.1002/pro.3784"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1002/pro.3784
          </a>
        </li>
        <li>
          Schaller D, Christ CD, Chodera JD, Volkamer A. <em>Benchmarking
          Cross-Docking Strategies for Structure-Informed Machine Learning in
          Kinase Drug Discovery.</em> bioRxiv 2023.09.11.557138 (2023).{" "}
          <a
            href="https://doi.org/10.1101/2023.09.11.557138"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1101/2023.09.11.557138
          </a>
        </li>
        <li>
          Rueda M, Bottegoni G, Abagyan R. <em>Recipes for the selection of
          experimental protein conformations for virtual screening.</em> J Chem
          Inf Model 50, 186-193 (2010).{" "}
          <a
            href="https://doi.org/10.1021/ci9003943"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/ci9003943
          </a>
        </li>
      </ul>
    </>
  );
}
