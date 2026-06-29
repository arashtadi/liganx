/**
 * Post: Induced-fit docking — when the rigid receptor lies to you
 *
 * SEO target: "induced fit docking", "receptor flexibility docking",
 * "flexible receptor docking", "IFD Glide Prime", "side chain flexibility
 * docking". Internal CTA into /studio's ensemble docking workflow as the
 * practical alternative to full IFD.
 *
 * Theme: methodology / workflow.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "induced-fit-docking-receptor-flexibility",
  title: "Induced-fit docking: when the rigid receptor lies to you",
  description:
    "Most docking treats the protein as a frozen statue. Real pockets reshape around the ligand. Here is when receptor flexibility matters and how to handle it.",
  date: "2026-06-05",
  author: "Liganx team",
  tags: ["docking", "methodology", "receptor-flexibility", "induced-fit"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Almost every docking run you have ever done made a quiet assumption:
        the protein is a rigid statue, and the only thing that moves is the
        ligand. That assumption is wrong, and most of the time it is wrong in
        a way you can get away with. But for the cases where it bites — and
        they are the interesting cases — the receptor reshapes its own pocket
        around whatever you put inside it. That is induced fit, and ignoring
        it is one of the most common reasons a docked pose looks confident and
        is completely wrong.
      </p>

      <h2>The lock-and-key lie</h2>
      <p>
        The textbook picture of a protein pocket as a fixed lock waiting for
        the right key is a useful simplification and a literal falsehood.
        Side chains rotate. Loops flap open and closed. Backbone segments
        shift by an angstrom or two when a ligand binds. The conformation you
        crystallized — usually with one particular ligand, or with none —
        is a single snapshot of a flexible object. Dock a chemically different
        molecule into that frozen snapshot and you may be forcing it into a
        pocket shape that only ever existed for the original ligand.
      </p>
      <p>
        When Sherman and colleagues benchmarked this directly, rigid-receptor
        docking on 21 pharmaceutically relevant complexes gave an average
        ligand RMSD of about 5.5 Å — far enough off that the predicted binding
        mode is essentially useless. Letting the receptor flex brought the
        average down to roughly 1.4 Å, with 18 of the 21 cases under 1.8 Å.
        The difference between a wrong pose and a near-crystallographic one was
        almost entirely about whether the protein was allowed to move.
      </p>

      <h2>How induced-fit docking actually works</h2>
      <p>
        The classic Schrödinger IFD protocol is an iteration between two
        engines. Glide docks the ligand into the pocket with the receptor side
        chains temporarily trimmed back, so the molecule can get in even if it
        would clash with the rigid structure. Then Prime, a protein-structure
        prediction tool, repacks the side chains and minimizes the protein
        around each candidate pose, letting the pocket relax to accommodate the
        ligand. Finally Glide re-docks into each newly relaxed receptor and the
        poses are rescored. The loop converges on a set of ligand-plus-pocket
        conformations rather than a single rigid answer.
      </p>
      <p>
        The newer IFD-MD variant swaps in short molecular-dynamics sampling to
        generate receptor conformations, which improves reliability on harder
        targets at the cost of more compute. Either way the core idea is the
        same: stop pretending the protein is static, and let the binding-site
        geometry be a variable you solve for instead of a constant you assume.
      </p>

      <h2>When you actually need it</h2>
      <p>
        Receptor flexibility is not free — IFD can be one to two orders of
        magnitude slower than rigid docking, so you do not reach for it by
        default. The signals that you need it:
      </p>
      <ul>
        <li>
          <strong>Known conformational plasticity</strong> — kinases that
          toggle between DFG-in and DFG-out, nuclear receptors with mobile
          helix 12, anything with a documented open and closed state.
        </li>
        <li>
          <strong>Apo or cross-docked structures</strong> — when your receptor
          was solved without a ligand, or with a ligand very different from
          your series, the pocket is unlikely to be pre-shaped for your
          chemistry.
        </li>
        <li>
          <strong>Rigid docking that disagrees with SAR</strong> — if your
          poses rank potent compounds poorly or bury polar groups in
          hydrophobic walls, a frozen receptor is a prime suspect.
        </li>
        <li>
          <strong>Bulky or scaffold-hopping ligands</strong> — molecules that
          a rigid pocket simply cannot fit, but that bind well experimentally.
        </li>
      </ul>

      <h2>The pragmatic middle ground: ensemble docking</h2>
      <p>
        Full per-ligand induced fit is the heavyweight option. For
        high-throughput work there is a cheaper approximation that captures
        most of the benefit: dock against an ensemble of receptor
        conformations instead of a single one. Collect several structures of
        the target — different crystal forms, different bound ligands, MD
        snapshots, or AlphaFold-derived states — dock into each, and keep the
        best pose across the set. You are sampling receptor flexibility
        up front rather than solving for it per ligand, which is far faster
        while still escaping the single-snapshot trap.
      </p>

      <h2>Try it yourself</h2>
      <p>
        Liganx's ensemble docking workflow is the practical version of this
        idea: pick multiple conformations of your target and dock across all
        of them in one run, so a pocket that is closed in one structure and
        open in another both get a fair shot.
      </p>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and try molecular docking against more than one receptor conformation
        for the same compound — then compare the scores. When the best pose
        comes from a conformation other than your default crystal structure,
        that gap is induced fit showing up in your data. Running
        molecular docking online across an ensemble is the fastest way to see whether
        receptor flexibility is changing your answer before you commit to a
        slower full IFD calculation.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Sherman W, Day T, Jacobson MP, Friesner RA, Farid R. <em>Novel
          procedure for modeling ligand/receptor induced fit effects.</em> J
          Med Chem 49, 534-553 (2006).{" "}
          <a
            href="https://doi.org/10.1021/jm050540c"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/jm050540c
          </a>
        </li>
        <li>
          Sherman W, Beard HS, Farid R. <em>Use of an induced fit receptor
          structure in virtual screening.</em> Chem Biol Drug Des 67, 83-84
          (2006).{" "}
          <a
            href="https://doi.org/10.1111/j.1747-0285.2005.00327.x"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1111/j.1747-0285.2005.00327.x
          </a>
        </li>
        <li>
          Friesner RA, et al. <em>Extra precision Glide: docking and scoring
          incorporating a model of hydrophobic enclosure for protein-ligand
          complexes.</em> J Med Chem 49, 6177-6196 (2006).{" "}
          <a
            href="https://doi.org/10.1021/jm051256o"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/jm051256o
          </a>
        </li>
      </ul>
    </>
  );
}
