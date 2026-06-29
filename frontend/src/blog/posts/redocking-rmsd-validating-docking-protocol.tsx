/**
 * Post: Redocking and RMSD — validating a docking protocol before you trust it
 *
 * SEO target: "redocking RMSD", "docking validation", "2 angstrom RMSD criterion",
 * "Astex diverse set", "self-docking cross-docking", "PoseBusters pose validity".
 * Internal CTA into /studio to redock a co-crystallized ligand and check the pose.
 *
 * NOTE: draft awaiting human review. Lives in _drafts/ so the registry glob does
 * not pick it up. Import path is ../../types (one level deeper).
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "redocking-rmsd-validating-docking-protocol",
  title: "Redocking and RMSD: validating a docking protocol before you trust it",
  description:
    "Before a docking score means anything, the protocol has to reproduce a known pose. How redocking, the 2 angstrom RMSD rule, and pose validity actually work.",
  date: "2026-06-17",
  author: "Liganx team",
  tags: ["docking-method", "validation", "rmsd", "methodology"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Every docking number you produce rests on an unstated assumption:
        that your protocol can put a ligand where it actually goes. The
        only honest way to test that assumption is redocking. You take a
        protein-ligand complex whose structure was solved
        experimentally, throw the ligand pose away, dock it back in from
        scratch, and measure how close the predicted pose lands to the
        crystallographic truth. If the protocol cannot reproduce a pose
        you already know the answer to, no score it produces on an unknown
        ligand is worth quoting.
      </p>

      <h2>What redocking actually measures</h2>
      <p>
        Redocking, also called self-docking, isolates pose prediction
        from everything else. The receptor, the binding site, and the
        ligand's chemical identity are all fixed and correct; the only
        thing the docking engine has to recover is the geometry. The
        metric is root-mean-square deviation (RMSD) between the heavy
        atoms of the docked pose and the heavy atoms of the experimental
        pose, after aligning the receptors. A small RMSD means the engine
        found the real binding mode. A large one means it found something
        plausible-looking that is in the wrong place, the wrong
        orientation, or the wrong conformation.
      </p>
      <p>
        The long-standing convention is that a pose with RMSD at or below
        2 angstrom counts as a success. That threshold is a community
        habit, not a law of physics: it roughly corresponds to a pose
        that is correct enough that the right interactions are being
        made, while tolerating the coordinate uncertainty in the
        experimental structure itself. Anything from 2 to 3 angstrom is a
        gray zone, and above 3 angstrom the pose is usually wrong in a way
        that matters.
      </p>

      <h2>The benchmark sets</h2>
      <p>
        You do not have to invent your own validation set. The field has
        curated standard ones. The most widely used is the Astex Diverse
        Set, 85 high-quality, drug-relevant protein-ligand complexes
        assembled by Hartshorn and colleagues specifically so that
        docking methods could be compared on the same footing. Modern
        docking engines typically reproduce the crystal pose within 2
        angstrom on a clear majority of those 85 cases, and that hit rate
        is the headline number people cite when they claim a protocol
        works. When you read that a method "achieves X percent success on
        the Astex set," X is the fraction of cases redocked under 2
        angstrom.
      </p>

      <h2>Self-docking is the easy case</h2>
      <p>
        Here is the catch that separates a validated protocol from a
        falsely reassuring one. Redocking into the same structure the
        ligand came from is the friendliest possible test, because the
        receptor is already shaped to fit that exact molecule. Real
        prospective docking is almost never like that. You usually dock a
        new compound into a structure that was solved with a different
        ligand, or no ligand, or a predicted model. That is
        cross-docking, and success rates drop, sometimes sharply, because
        the pocket has to accommodate a molecule it was not crystallized
        around. A protocol that aces self-docking can still fail
        cross-docking if the receptor is rigid and the binding site moves.
        If your real use case is virtual screening, validate with
        cross-docking, not just self-docking.
      </p>

      <h2>RMSD is necessary but not sufficient</h2>
      <p>
        A low RMSD tells you the heavy atoms landed in the right place. It
        does not tell you the pose is physically sensible. A docked
        geometry can sit under 2 angstrom and still contain a strained
        ring, a clashing side chain, stereochemistry that does not match
        the input, or a hydrogen placed somewhere impossible. This is the
        gap the PoseBusters work made concrete: Buttenschoen and
        colleagues showed that several deep-learning docking methods
        produced poses that looked competitive on RMSD but failed basic
        physical-validity checks, things like bond lengths, planarity,
        and the absence of steric clashes. Their conclusion was blunt:
        once you require poses to be physically valid, classical docking
        methods were not actually being beaten. The practical takeaway is
        to pair the RMSD check with a pose-sanity check rather than
        trusting the distance metric alone.
      </p>

      <h2>A validation checklist</h2>
      <p>
        Before you trust scores on novel ligands, a reasonable protocol
        check looks like this:
      </p>
      <ul>
        <li>
          <strong>Redock the native ligand.</strong> Pull a co-crystal
          structure, strip the ligand, dock it back, confirm RMSD is at or
          below 2 angstrom.
        </li>
        <li>
          <strong>Cross-dock if you can.</strong> Dock the same ligand
          into a structure solved with a different ligand to see how much
          receptor mismatch costs you.
        </li>
        <li>
          <strong>Inspect the pose, do not just read the number.</strong>{" "}
          Check that the key interactions match the known ones and that
          the geometry is not strained or clashing.
        </li>
        <li>
          <strong>Confirm the search box and settings transfer.</strong>{" "}
          The grid box, exhaustiveness, and protonation states that
          reproduced the native pose are the ones you should keep for the
          unknown ligands.
        </li>
      </ul>

      <h2>Try the docking yourself</h2>
      <p>
        The fastest way to internalize this is to redock something you
        already know.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick a target whose approved drug you can find a co-crystal
        for, dock that ligand back into the pocket, and compare the
        predicted pose to the published binding mode. When the redocked
        pose lands on the crystallographic one, you have earned the right
        to trust the protocol on a new analog. When it does not, you have
        just saved yourself from quoting a meaningless score.
      </p>
      <p>
        Liganx is molecular docking online: free and browser-based, which
        makes it a quick way to run molecular docking for a redocking
        sanity check before you commit a protocol to a screening campaign.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Hartshorn MJ, Verdonk ML, Chessari G, et al.{" "}
          <em>Diverse, high-quality test set for the validation of
          protein-ligand docking performance.</em> J Med Chem 50, 726-741
          (2007).{" "}
          <a
            href="https://doi.org/10.1021/jm061277y"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/jm061277y
          </a>
        </li>
        <li>
          Buttenschoen M, Morris GM, Deane CM.{" "}
          <em>PoseBusters: AI-based docking methods fail to generate
          physically valid poses or generalise to novel sequences.</em>{" "}
          Chem Sci 15, 3130-3139 (2024).{" "}
          <a
            href="https://doi.org/10.1039/D3SC04185A"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1039/D3SC04185A
          </a>
        </li>
        <li>
          Trott O, Olson AJ.{" "}
          <em>AutoDock Vina: improving the speed and accuracy of docking
          with a new scoring function, efficient optimization, and
          multithreading.</em> J Comput Chem 31, 455-461 (2010).{" "}
          <a
            href="https://doi.org/10.1002/jcc.21334"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1002/jcc.21334
          </a>
        </li>
      </ul>
    </>
  );
}
