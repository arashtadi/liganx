/**
 * Draft post: short MD runs as a pose-stability filter after docking
 *
 * Distinct from the MM-GBSA rescoring post: that one is about improving
 * the score, this one is about whether the pose survives at all. Framed
 * as a triage step between docking and anything expensive (FEP, synthesis).
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "md-simulation-docking-pose-stability-filter",
  title: "Does your docked pose survive MD? A cheap triage step",
  description:
    "Docking gives you a pose in a frozen pocket. A short molecular dynamics run tells you whether that pose is a real binding mode or a scoring artifact.",
  date: "2026-08-05",
  author: "Liganx team",
  tags: ["methodology", "molecular-dynamics", "docking"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        A docking program will always hand you a pose. It has no way to tell
        you that the pose only exists because you froze the protein, because
        a rotamer happened to point the wrong way in the crystal you picked,
        or because the scoring function liked a contact that would fall apart
        in water at 300 K. A short molecular dynamics run answers exactly
        that question, and it costs a fraction of what the decisions
        downstream cost.
      </p>

      <h2>What docking cannot tell you</h2>
      <p>
        Docking scores are computed on a single static snapshot. The pose
        that wins is the one that fits the geometry and the scoring terms
        of that snapshot best. Nothing in the calculation asks whether the
        arrangement is a minimum the ligand would actually sit in, or a
        narrow spike the ligand would slide out of within a few nanoseconds.
        Two failure modes are common:
      </p>
      <ul>
        <li>
          <strong>The transient contact.</strong> A hydrogen bond to a
          surface-exposed side chain looks great in the frozen structure and
          simply does not persist once the side chain samples its real
          rotamer distribution.
        </li>
        <li>
          <strong>The near-miss flip.</strong> The correct scaffold placement
          with the wrong ring orientation. Scores differ by tenths of a
          kcal/mol; the flipped pose drifts on the picosecond timescale
          while the right one holds.
        </li>
      </ul>
      <p>
        Both are invisible to the score and obvious in a trajectory.
      </p>

      <h2>The evidence that it works</h2>
      <p>
        This is not a folk method. Liu, Watanabe and Kokubo ran independent
        short simulations of docked poses in a cross-docking study and found
        that native-like binding modes are markedly more stable under MD
        than incorrect ones, with replicate simulations giving the
        discrimination statistical footing. Guterres and Im pushed the same
        idea to high throughput on 56 targets from DUD-E, feeding AutoDock
        Vina output into automated MD and improving ROC AUC from 0.68 to
        0.83 &mdash; roughly a 22% gain in the ability to separate actives
        from decoys, with about 95% of correct poses retained and a
        meaningful fraction of decoys excluded.
      </p>
      <p>
        The headline numbers are dataset-specific and you should not expect
        to reproduce them on your own series. The robust part of the finding
        is directional: pose persistence carries signal that the docking
        score does not.
      </p>

      <h2>A practical protocol</h2>
      <p>
        The point is triage, not production free-energy work. Keep it cheap:
      </p>
      <ul>
        <li>
          <strong>Take the top few poses per ligand</strong>, not just rank 1.
          The interesting comparison is which of the plausible poses holds.
        </li>
        <li>
          <strong>Solvate, minimize, equilibrate, then run 5 to 20 ns</strong>{" "}
          of unrestrained production per pose. Longer runs are not the
          bottleneck for this question.
        </li>
        <li>
          <strong>Run 3 to 5 replicates</strong> with different initial
          velocities. A single trajectory is one draw from a stochastic
          process and will occasionally lie in both directions.
        </li>
        <li>
          <strong>Measure ligand RMSD to the starting pose</strong> after
          aligning on the binding-site backbone, not on the whole protein.
          Whole-protein alignment mixes global drift into a local
          measurement.
        </li>
        <li>
          <strong>Track the interactions, not just the RMSD.</strong> The
          question that matters is whether the specific contacts you built
          the SAR hypothesis on are occupied most of the time. Fingerprint
          occupancy across frames is more informative than a single
          distance.
        </li>
      </ul>
      <p>
        A rough reading: a ligand that settles within about 2 A of its
        starting pose and stays there, with key contacts occupied in most
        frames, is a pose worth believing. One that walks several angstroms
        and does not come back has told you something useful for the price
        of an afternoon.
      </p>

      <h2>Where the method misleads you</h2>
      <p>
        Stability is necessary, not sufficient. Three caveats worth holding
        onto:
      </p>
      <ul>
        <li>
          <strong>A wrong pose can be stable.</strong> Deep, greasy pockets
          hold ligands in place regardless of whether the orientation is
          right. Absence of drift is weak evidence in a buried site and
          strong evidence in an open one.
        </li>
        <li>
          <strong>Force-field error is real.</strong> General small-molecule
          parameters handle unusual chemotypes poorly, and metal
          coordination, halogen bonds and strongly polarized systems are
          where they break first.
        </li>
        <li>
          <strong>Stability is not affinity.</strong> A pose surviving MD
          says nothing quantitative about potency. If you want a number,
          that is what rescoring and free-energy methods are for; this step
          just decides what deserves them.
        </li>
      </ul>
      <p>
        Used correctly, this sits between docking and the expensive tier:
        dock broadly, filter by pose persistence, then spend MM-GBSA or FEP
        cycles only on the poses that earned it.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The step before any of this is a docking run you trust the setup of.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        to run molecular docking on your target, export the top poses, and
        take the ones you plan to act on into a short MD run. The
        interaction-fingerprint view is the natural reference point: note
        which contacts the docked pose claims, then check how many of them
        are still there at the end of the trajectory. Liganx is molecular
        docking online and free, so generating the pose ensemble to test
        costs nothing but the time to set the box.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Guterres H, Im W. <em>Improving Protein-Ligand Docking Results with
          High-Throughput Molecular Dynamics Simulations.</em> J Chem Inf
          Model 60, 2189&ndash;2198 (2020).{" "}
          <a
            href="https://doi.org/10.1021/acs.jcim.0c00057"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jcim.0c00057
          </a>
        </li>
        <li>
          Liu K, Kokubo H. <em>Exploring the Stability of Ligand Binding Modes
          to Proteins by Molecular Dynamics Simulations: A Cross-docking
          Study.</em> J Chem Inf Model 57, 2514&ndash;2522 (2017).{" "}
          <a
            href="https://doi.org/10.1021/acs.jcim.7b00412"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jcim.7b00412
          </a>
        </li>
        <li>
          Liu K, Watanabe E, Kokubo H. <em>Exploring the stability of ligand
          binding modes to proteins by molecular dynamics simulations.</em>{" "}
          J Comput Aided Mol Des 31, 201&ndash;211 (2017).{" "}
          <a
            href="https://doi.org/10.1007/s10822-016-0005-2"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1007/s10822-016-0005-2
          </a>
        </li>
      </ul>
    </>
  );
}
