/**
 * Post: MM-GBSA rescoring of docking poses - when a physics endpoint
 * earns its keep over the raw docking score.
 *
 * SEO target: long-tail "MM-GBSA rescoring", "MM/GBSA binding free energy",
 * "rescore docking poses". Internal CTA into /studio for ranking poses.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "mm-gbsa-rescoring-docking-poses",
  title: "MM-GBSA rescoring: when physics beats the docking score",
  description:
    "MM-GBSA re-ranks docking poses with a physics-based endpoint. Here is what it does well, where it fails, and when it is worth the extra compute over a raw score.",
  date: "2026-05-25",
  author: "Liganx team",
  tags: ["methodology", "mm-gbsa", "scoring-functions", "free-energy"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        A docking score is a fast, cheap guess. It has to be: a scoring
        function evaluates millions of poses per screen, so it trades
        physical realism for speed. MM-GBSA is the next rung up the ladder -
        a physics-based endpoint you apply to a handful of survivors to get a
        better-correlated ranking. It is one of the most useful tools in a
        structure-based workflow and one of the most over-trusted, so it is
        worth being precise about what it actually buys you.
      </p>

      <h2>What MM-GBSA computes</h2>
      <p>
        MM-GBSA stands for Molecular Mechanics with Generalized Born and
        Surface Area solvation. Conceptually it estimates a binding free
        energy as the energy of the complex minus the energy of the free
        protein and free ligand, where each term combines a molecular
        mechanics gas-phase energy with an implicit-solvent correction. The
        Generalized Born model approximates the electrostatic cost of
        desolvation, and the surface-area term approximates the nonpolar
        contribution.
      </p>
      <p>
        The key difference from a docking score is that MM-GBSA uses a real
        forcefield and an explicit solvation model rather than an empirical
        sum of pre-fit terms. That makes it slower by orders of magnitude,
        but it captures desolvation and electrostatics in a way most fast
        scoring functions only approximate. The sibling method MM-PBSA
        swaps the Generalized Born term for a Poisson-Boltzmann solvation
        calculation - more rigorous, slower, and in practice often no more
        accurate for pose ranking.
      </p>

      <h2>Where it genuinely helps</h2>
      <ul>
        <li>
          <strong>Pose discrimination.</strong> In a systematic benchmark of
          98 protein-ligand complexes, MM/GBSA identified the correct binding
          conformation about 69% of the time, beating MM/PBSA (around 46%)
          and several popular docking scoring functions (Hou et al., 2011).
          That is its core job: of the poses docking gave you, which is the
          real one.
        </li>
        <li>
          <strong>Congeneric series ranking.</strong> For a set of closely
          related analogs - the situation in lead optimization - MM-GBSA
          tends to give cleaner rank correlation with measured affinity than
          a raw docking score, because systematic errors partly cancel across
          similar molecules.
        </li>
        <li>
          <strong>Ensemble averaging.</strong> Rescoring over multiple
          snapshots rather than a single minimized structure can lift the
          correlation substantially - in one antithrombin study the R-squared
          went from 0.36 to 0.69 moving from single-structure to
          ensemble-averaged MM/GBSA.
        </li>
      </ul>

      <h2>Where it quietly fails</h2>
      <p>
        MM-GBSA is not a free-energy method in the rigorous sense. It ignores
        configurational entropy unless you bolt on a separate (noisy) normal-
        mode or quasi-harmonic estimate, and the absolute numbers it produces
        are not real binding free energies - they are a scale that happens to
        correlate, sometimes. Treat an MM-GBSA value of -45 kcal/mol as a
        ranking coordinate, not a ΔG you can convert to a Kd.
      </p>
      <p>
        Two failure modes matter most in practice. First, results are highly
        sensitive to the choice of internal dielectric and GB model, so a
        number is only meaningful relative to others computed the same way.
        Second, if you feed it a docked pose rather than a crystal structure,
        you inherit the docking error on top of the MM-GBSA error - garbage
        pose in, confident-looking garbage energy out. As Genheden and Ryde
        put it in their widely cited review, the methods are useful but their
        accuracy is system-dependent and easily overstated.
      </p>

      <h2>How it fits in a docking workflow</h2>
      <p>
        The sensible pattern is a funnel. Use fast docking to screen broadly
        and generate poses, keep the top survivors, then rescore that short
        list with MM-GBSA to re-rank. Reserve true alchemical free-energy
        methods (FEP) for the final few candidates where the extra compute is
        justified. MM-GBSA sits in the middle: cheaper than FEP, more
        physical than a docking score, and most valuable when you are
        comparing similar molecules against the same target rather than
        ranking diverse scaffolds.
      </p>
      <p>
        The recurring theme - the same one behind comparing Vina against
        GNINA, or watching ΔΔ instead of absolute scores - is that no single
        number is the answer. Each tier of method corrects a different bias,
        and MM-GBSA earns its place by fixing the pose-ranking step that fast
        scoring functions get wrong most often.
      </p>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        to dock a ligand against your target and inspect the top poses. When
        two poses score within a kcal/mol of each other, that is exactly the
        situation where a physics-based rescore changes the answer - so it is
        worth looking at the interaction pattern, not just the number.
      </p>
      <p>
        Liganx puts molecular docking online and free in the browser, which
        makes it easy to generate the candidate poses that a downstream
        MM-GBSA or FEP step then re-ranks. Run molecular docking first, then
        spend the expensive compute only on what survives.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Hou T, Wang J, Li Y, Wang W. <em>Assessing the performance of the
          MM/PBSA and MM/GBSA methods. II. The accuracy of ranking poses
          generated from docking.</em> J Comput Chem 32, 866-877 (2011).{" "}
          <a
            href="https://doi.org/10.1002/jcc.21666"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1002/jcc.21666
          </a>
        </li>
        <li>
          Genheden S, Ryde U. <em>The MM/PBSA and MM/GBSA methods to estimate
          ligand-binding affinities.</em> Expert Opin Drug Discov 10, 449-461
          (2015).{" "}
          <a
            href="https://doi.org/10.1517/17460441.2015.1032936"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1517/17460441.2015.1032936
          </a>
        </li>
        <li>
          Sun H, Li Y, Tian S, Xu L, Hou T. <em>Assessing the performance of
          MM/PBSA and MM/GBSA methods. 4. Accuracies of MM/PBSA and MM/GBSA
          methodologies evaluated by various simulation protocols.</em> Phys
          Chem Chem Phys 16, 16719-16729 (2014).{" "}
          <a
            href="https://doi.org/10.1039/C4CP01388C"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1039/C4CP01388C
          </a>
        </li>
      </ul>
    </>
  );
}
