/**
 * Post: Ensemble docking - when one rigid receptor isn't enough
 *
 * SEO target: long-tail queries around "ensemble docking", "flexible
 * receptor docking", "relaxed complex scheme", "multiple receptor
 * conformations docking". Methodology theme. Internal link to /studio
 * with the ensemble docking feature as the conversion moment.
 *
 * DRAFT - awaiting human review. Move to ../posts/ to publish.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "ensemble-docking-multiple-receptor-conformations",
  title: "Ensemble docking: when one rigid receptor isn't enough",
  description:
    "Why docking against a single crystal structure misses real binders, and how docking across multiple receptor conformations recovers the ones a rigid pocket throws away.",
  date: "2026-05-27",
  author: "Liganx team",
  tags: ["methodology", "ensemble-docking", "flexible-receptor", "docking"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Most docking is done against a single crystal structure, frozen in
        whatever conformation the crystallographer happened to trap. But a
        protein in solution is not one shape; it is a population of
        conformations, and the one that binds your ligand may not be the one
        in the PDB. Ensemble docking is the fix: dock against several receptor
        conformations instead of one, then take the best score across the set.
        Here is why it matters and when it is worth the extra compute.
      </p>

      <h2>The rigid-receptor problem</h2>
      <p>
        Standard docking treats the ligand as flexible and the receptor as a
        rigid wall. That is a deliberate approximation - sampling full receptor
        flexibility for every pose is prohibitively expensive - but it has a
        sharp failure mode. If your ligand needs the pocket to open a side
        channel, rotate a gatekeeper sidechain, or flatten a loop, and your
        single structure has that pocket closed, the docking engine will score
        the true binder as a clash and discard it. The compound looks inactive
        on screen and active in the assay. That is a false negative, and rigid
        docking generates them quietly.
      </p>
      <p>
        Kinases are the textbook offenders. The DFG-in versus DFG-out flip, the
        alphaC-helix in versus out, the activation loop ordering - these are
        large rearrangements that gate whether a type-II or allosteric inhibitor
        can bind at all. Pick the wrong apo structure and you have pre-decided
        the answer.
      </p>

      <h2>What ensemble docking actually does</h2>
      <p>
        The recipe is simple in outline. Assemble a set of receptor
        conformations, dock the ligand against each independently, and report
        the most favorable score (or rank by a consensus across the set). The
        ligand effectively gets to choose the receptor shape that fits it best,
        which approximates conformational selection - the idea that a ligand
        binds and stabilizes a pre-existing receptor state rather than molding
        a rigid one.
      </p>
      <p>Where the conformations come from is the real design choice:</p>
      <ul>
        <li>
          <strong>Multiple experimental structures</strong> - different PDB
          entries of the same target, ideally with different ligands bound or
          in different functional states. Cheapest and often the most
          physically trustworthy, when enough structures exist.
        </li>
        <li>
          <strong>Molecular dynamics snapshots</strong> - run an MD trajectory,
          cluster the frames, and pull a representative from each cluster. This
          is the relaxed complex scheme (RCS) of McCammon and coworkers, and it
          can surface transient pockets that no single crystal structure shows.
        </li>
        <li>
          <strong>Predicted or modeled conformers</strong> - normal-mode
          perturbations, AlphaFold sampling, or template-based models when
          experimental coverage is thin.
        </li>
      </ul>

      <h2>The cryptic-pocket payoff</h2>
      <p>
        The famous proof of concept is HIV integrase. RCS docking against MD
        snapshots revealed a binding trench adjacent to the active site that
        was not present in the static crystal structures. That trench became
        the basis for the development path that led to raltegravir, an FDA
        approved antiretroviral. The lesson generalizes: if the druggable
        pocket only exists in a minority conformation, the only way docking
        finds it is to dock against that conformation.
      </p>

      <h2>The cost, and when to pay it</h2>
      <p>
        Ensemble docking multiplies your runtime by roughly the number of
        conformations, so it is not free. The efficiency depends on how
        different the conformations are: minor sidechain wiggles add cost
        roughly additively and rarely change the answer, while genuinely
        distinct binding-site states are exactly the ones worth including. The
        practical guidance:
      </p>
      <ul>
        <li>
          <strong>Use it when the target is known to be flexible</strong> -
          kinases with DFG/alphaC dynamics, proteins with induced-fit pockets,
          targets where one crystal structure has repeatedly underperformed in
          screening.
        </li>
        <li>
          <strong>Curate, don't dump</strong> - cluster your conformations
          (by RMSD over the binding site) and keep one representative per
          cluster. Ten near-identical frames cost ten times as much and tell
          you nothing new.
        </li>
        <li>
          <strong>Skip it for rigid, well-characterized pockets</strong> - if
          the site does not move and a single high-resolution structure exists,
          ensemble docking mostly adds noise and runtime.
        </li>
      </ul>
      <p>
        One caution on scoring: taking the single best score across an ensemble
        biases toward whichever conformation happens to give the most generous
        number, which can inflate false positives in the other direction.
        Consensus or Boltzmann-weighted scoring across the set is more honest
        than naive best-of, though heavier to compute.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        Liganx supports ensemble docking directly - pick a target, select more
        than one receptor conformation, and the engine docks your ligand
        against each and reports the spread so you can see how
        conformation-sensitive your candidate really is. A binder that scores
        well against only one of five conformations is telling you something a
        single-structure run would have hidden.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and load a flexible target like a kinase to watch the per-conformation
        scores diverge.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and built so
        that running molecular docking across a receptor ensemble takes a few
        clicks instead of a weekend of scripting.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Lin JH, Perryman AL, Schames JR, McCammon JA.{" "}
          <em>
            Computational drug design accommodating receptor flexibility: the
            relaxed complex scheme.
          </em>{" "}
          J Am Chem Soc 124, 5632-5633 (2002).{" "}
          <a
            href="https://doi.org/10.1021/ja0260162"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/ja0260162
          </a>
        </li>
        <li>
          Amaro RE, Baron R, McCammon JA.{" "}
          <em>
            An improved relaxed complex scheme for receptor flexibility in
            computer-aided drug design.
          </em>{" "}
          J Comput Aided Mol Des 22, 693-705 (2008).{" "}
          <a
            href="https://doi.org/10.1007/s10822-007-9159-2"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1007/s10822-007-9159-2
          </a>
        </li>
        <li>
          Amaro RE, et al. <em>Ensemble Docking in Drug Discovery.</em>{" "}
          Biophys J 114, 2271-2278 (2018).{" "}
          <a
            href="https://doi.org/10.1016/j.bpj.2018.02.038"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/j.bpj.2018.02.038
          </a>
        </li>
      </ul>
    </>
  );
}
