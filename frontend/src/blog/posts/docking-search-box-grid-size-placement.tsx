/**
 * Post: defining the docking search box (grid box) size and placement
 *
 * Methodology theme. SEO target: "docking grid box size", "AutoDock Vina
 * search space", "how big should my docking box be", "center docking box on
 * binding site". Internal CTA into /studio where the box is handled for you.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "docking-search-box-grid-size-placement",
  title: "Sizing the docking search box: the parameter people get wrong",
  description:
    "How the grid box (search space) size and placement quietly determine docking accuracy, why too big and too small both fail, and a defensible rule of thumb.",
  date: "2026-06-19",
  author: "Liganx team",
  tags: ["methodology", "docking", "autodock-vina", "virtual-screening"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Almost every docking failure people blame on the scoring
        function actually starts one step earlier, with the search
        box. The grid box defines the region of space the docking
        engine is allowed to explore, and it is one of the few
        parameters a user sets by hand. Get it wrong and you can turn
        a perfectly good scoring function into a random number
        generator, or quietly bias every result toward the same wrong
        pose. It is worth understanding what the box actually controls.
      </p>

      <h2>What the box is</h2>
      <p>
        In AutoDock Vina and most descendants, the search space is a
        rectangular box defined by a center (x, y, z) and three side
        lengths. The docking engine samples ligand poses only inside
        that box. Anything outside it is invisible to the search. The
        box is not a constraint on where atoms can clash; it is a
        constraint on where the conformational search is allowed to
        look. That distinction is the source of most of the trouble.
      </p>

      <h2>Why too big hurts</h2>
      <p>
        The intuitive instinct is to make the box large so you "do not
        miss anything." This backfires for two reasons. First, the
        search problem grows with the volume: Vina has a fixed
        sampling budget (the exhaustiveness setting), so a larger box
        means fewer effective samples per unit volume and a higher
        chance the search never finds the true pose even when it is
        physically reachable. Second, a large box invites the engine
        to place the ligand in irrelevant surface pockets that score
        deceptively well, polluting your ranking. In virtual screening
        this is especially damaging, because the false positives are
        not random; they are systematically the compounds that happen
        to fit some off-target groove.
      </p>

      <h2>Why too small hurts</h2>
      <p>
        Make the box too tight and you clip the accessible pose space.
        A box drawn snugly around the co-crystallized ligand
        pre-supposes the answer: any candidate that needs to sit
        slightly differently, extend into an adjacent subpocket, or
        adopt an induced-fit geometry gets truncated at the wall. You
        will still get poses and scores, but they are conditioned on a
        binding mode you assumed rather than discovered. For scaffold
        hopping or fragment growing, an over-tight box is a quiet way
        to miss the very chemistry you were screening for.
      </p>

      <h2>A defensible rule of thumb</h2>
      <p>
        Feinstein and Brylinski studied this systematically across
        thousands of protein-ligand complexes and proposed scaling the
        box to the ligand rather than picking a fixed size. Their
        result: pose-prediction accuracy peaks when the box side length
        is roughly 2.9 times the radius of gyration of the docking
        compound. The practical takeaway is that the right box size
        depends on the size of the molecule you are docking, not just
        the pocket, and that a box comfortably larger than the ligand
        but tightly centered on the known site beats both extremes.
      </p>
      <ul>
        <li>
          <strong>Center</strong> on the binding site you care about,
          using the co-crystallized ligand centroid or the pocket
          residues, not the protein center of mass.
        </li>
        <li>
          <strong>Size</strong> to comfortably contain the largest
          ligand in your set plus room to reorient, scaling with ligand
          size rather than reusing one box for every compound.
        </li>
        <li>
          <strong>Hold it constant</strong> across a screen so scores
          are comparable; changing the box between compounds makes the
          ranking meaningless.
        </li>
      </ul>

      <h2>When you do not know the pocket</h2>
      <p>
        If there is no known site, blind docking over the whole protein
        is tempting but weak, for exactly the too-big reasons above.
        The better move is a cavity-detection step first (geometry or
        energy based) to nominate candidate pockets, then a properly
        sized box on each. That converts an unfocused search into
        several focused ones, which is both more accurate and more
        interpretable. Treat blind docking as a hypothesis generator
        for where to look, not as a final answer.

      </p>

      <h2>Try the docking yourself</h2>
      <p>
        On Liganx the search box is handled for you: each catalog
        target ships with a curated, validated box centered on the
        relevant binding site, so you do not have to guess coordinates
        or rediscover the pocket.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick a target such as EGFR or KRAS, then dock your ligand
        and inspect the pose; the box is already tuned to the
        orthosteric site so your scores are comparable across runs and
        across the mutant and wild-type receptors.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and
        set up so the parameters that quietly sink most docking runs
        are taken care of. If you want to try molecular docking without
        hand-tuning a grid box, that is the fastest path to a sensible
        first result.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Trott O, Olson AJ.{" "}
          <em>
            AutoDock Vina: improving the speed and accuracy of docking
            with a new scoring function, efficient optimization, and
            multithreading.
          </em>{" "}
          J Comput Chem 31, 455&ndash;461 (2010).{" "}
          <a
            href="https://doi.org/10.1002/jcc.21334"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1002/jcc.21334
          </a>
        </li>
        <li>
          Feinstein WP, Brylinski M.{" "}
          <em>
            Calculating an optimal box size for ligand docking and
            virtual screening against experimental and predicted binding
            pockets.
          </em>{" "}
          J Cheminform 7, 18 (2015).{" "}
          <a
            href="https://doi.org/10.1186/s13321-015-0067-5"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1186/s13321-015-0067-5
          </a>
        </li>
        <li>
          Eberhardt J, Santos-Martins D, Tillack AF, Forli S.{" "}
          <em>
            AutoDock Vina 1.2.0: New Docking Methods, Expanded Force
            Field, and Python Bindings.
          </em>{" "}
          J Chem Inf Model 61, 3891&ndash;3898 (2021).{" "}
          <a
            href="https://doi.org/10.1021/acs.jcim.1c00203"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jcim.1c00203
          </a>
        </li>
      </ul>
    </>
  );
}
