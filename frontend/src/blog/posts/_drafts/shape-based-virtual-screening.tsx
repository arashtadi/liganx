/**
 * Post: Shape-based virtual screening — ROCS, USR, and when shape beats docking
 *
 * SEO target: "shape-based virtual screening", "ROCS TanimotoCombo", "ultrafast
 * shape recognition", "ligand-based virtual screening". Internal CTA into
 * /studio to dock the shape-matched hits and confirm poses.
 *
 * Theme: methodology / workflow.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "shape-based-virtual-screening",
  title: "Shape-based virtual screening: when 3D shape beats docking",
  description:
    "ROCS and ultrafast shape recognition screen millions of molecules by 3D shape and chemistry instead of fitting them into a pocket. What they do well, where they fail, and how to pair them with docking.",
  date: "2026-07-03",
  author: "Liganx team",
  tags: ["virtual-screening", "ligand-based", "methodology", "scaffold-hopping"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Docking asks a structural question: does this molecule fit into this
        pocket? Shape-based screening asks a different one entirely: does this
        molecule look like a molecule I already know works? It never touches the
        protein. Instead it compares the 3D shape and chemical feature layout of
        a candidate against a known active, on the premise that molecules with
        similar shape and similar chemistry tend to bind the same pocket the
        same way. That premise is loose enough to be dangerous and useful enough
        that shape screening remains a workhorse for lead discovery, especially
        when you have a good ligand but a poor or missing structure.
      </p>

      <h2>The core idea: similarity, not fitting</h2>
      <p>
        A binding event requires some degree of shape complementarity between
        the ligand and its target. Flip that around: if a new molecule occupies
        roughly the same volume and presents the same hydrogen-bond donors,
        acceptors, and hydrophobic groups in the same places as a validated
        binder, it is a reasonable bet to test. Shape-based methods formalize
        that bet. Crucially, they do not need the target structure at all, which
        is exactly why they are reached for when only a ligand is in hand.
      </p>

      <h2>ROCS and the TanimotoCombo score</h2>
      <p>
        ROCS (Rapid Overlay of Chemical Structures) is the canonical
        superposition method. It represents each molecule as a smooth Gaussian
        volume, then rotates and translates the query molecule to maximize
        overlap with a reference. Two things get scored:
      </p>
      <ul>
        <li>
          <strong>Shape Tanimoto</strong> — how well the two volumes overlap
          geometrically, scored 0 to 1.
        </li>
        <li>
          <strong>Color Tanimoto</strong> — how well the chemical features, or
          "color" (donors, acceptors, hydrophobes, rings, charges), line up once
          the shapes are overlaid.
        </li>
      </ul>
      <p>
        The combined <strong>TanimotoCombo</strong> score sums the two (so it
        runs 0 to 2) and is the number most teams rank on. Screening runs at
        hundreds of molecules per second on a single CPU, so a library of
        millions is a tractable overnight job. The output is not just a rank; it
        is an explicit 3D alignment you can inspect, which makes it easy to see
        which pharmacophore features matched and which did not.
      </p>

      <h2>Ultrafast shape recognition when you need raw speed</h2>
      <p>
        ROCS is fast, but superposition still costs something per pair.
        Ultrafast shape recognition (USR) skips alignment altogether. It
        describes each molecule's shape as a small set of statistical moments,
        the distribution of atomic distances from a few reference points, and
        compares those descriptor vectors directly. That makes it roughly three
        orders of magnitude faster than superposition-based methods, fast enough
        to screen ultra-large libraries and to power web servers that scan tens
        of millions of compounds on demand. The tradeoff is resolution: a
        moment-based fingerprint is a coarser description than an explicit
        overlay, so USR is best as a fast first-pass filter that a sharper method
        refines.
      </p>

      <h2>What shape screening is genuinely good at</h2>
      <p>
        The headline use case is <strong>scaffold hopping</strong>: finding
        chemically distinct cores that occupy the same 3D space as a known
        binder. Because the comparison is on shape and feature layout rather than
        2D connectivity, shape methods routinely surface molecules that a
        substructure or fingerprint search would never connect. That is exactly
        what you want when the goal is to escape a patented scaffold, fix a
        liability baked into one chemotype, or diversify a series. It is also the
        right tool when the target has no reliable structure but a potent ligand
        exists, since the whole method is ligand-based.
      </p>

      <h2>Where it fails, and why you still dock</h2>
      <p>
        Shape screening has no idea what the pocket looks like. It will happily
        rank a molecule that is the perfect shape for a cavity it cannot
        physically enter, or one whose matched donor points at a hydrophobic
        wall instead of a real acceptor. It is only as good as the reference
        ligand, and it says nothing about whether a plausible pose actually
        satisfies the specific interactions the target requires. The standard
        cure is to treat shape as a funnel, not a verdict: use ROCS or USR to
        cut millions down to thousands of shape-plausible candidates, then dock
        that shortlist against the real structure to check that the geometry
        survives contact with the pocket. Ligand-based recall, structure-based
        precision.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        Shape screening gets you a shortlist; docking tells you whether the shape
        match is a real binder. The two are complementary, and the handoff is
        where a shape hit becomes a testable pose.
      </p>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock a shape-matched analog against your target to see whether the
        pose that shape screening implied actually holds up inside the pocket.
        Running that confirmation with molecular docking online, right after a
        shape filter, is the practical way to turn a fast ligand-based ranking
        into structure-backed hits. When you do this kind of molecular docking on
        the top TanimotoCombo candidates, the ones with both a good shape score
        and a clean docked pose are the ones worth ordering.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Ballester PJ, Richards WG. <em>Ultrafast shape recognition to search
          compound databases for similar molecular shapes.</em> J Comput Chem
          28, 1711-1723 (2007).{" "}
          <a
            href="https://doi.org/10.1002/jcc.20681"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1002/jcc.20681
          </a>
        </li>
        <li>
          Hawkins PCD, Skillman AG, Nicholls A. <em>Comparison of shape-matching
          and docking as virtual screening tools.</em> J Med Chem 50, 74-82
          (2007).{" "}
          <a
            href="https://doi.org/10.1021/jm0603365"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/jm0603365
          </a>
        </li>
        <li>
          Li H, et al. <em>USR-VS: a web server for large-scale prospective
          virtual screening using ultrafast shape recognition techniques.</em>{" "}
          Nucleic Acids Res 44, W436-W441 (2016).{" "}
          <a
            href="https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4987897/"
            target="_blank"
            rel="noreferrer noopener"
          >
            PMC4987897
          </a>
        </li>
      </ul>
    </>
  );
}
