/**
 * Post: DFG-out and Type II kinase inhibitors
 *
 * SEO target: "DFG-out conformation", "Type II kinase inhibitor",
 * "Type I vs Type II kinase inhibitor", "imatinib DFG-out".
 * Internal CTA into /studio to dock against ABL kinase in DFG-out.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "dfg-out-type-ii-kinase-inhibitors",
  title: "DFG-out and Type II kinase inhibitors: where selectivity comes from",
  description:
    "Imatinib, sorafenib, ponatinib, nilotinib — Type II inhibitors all bind a conformation the ATP-mimetic Type I drugs never see. Here is what DFG-out is and why it matters.",
  date: "2026-05-28",
  author: "Liganx team",
  tags: ["methodology", "kinase", "docking", "dfg-out", "drug-design"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Roughly two-thirds of marketed kinase inhibitors bind the active, ATP-ready
        conformation. The remaining third bind a conformation the kinase only
        adopts when it is switched off, and that conformational switch is where
        a lot of the selectivity story in this class lives. The distinction goes
        by an inelegant three-letter shorthand: DFG-in versus DFG-out. Once you
        know what the DFG motif does, the difference between a Type I and a
        Type II inhibitor stops being arbitrary and starts being a structural
        prediction you can act on.
      </p>

      <h2>The DFG motif and the activation loop</h2>
      <p>
        Every protein kinase has an activation loop, and at the N-terminal
        end of that loop sits a conserved Asp-Phe-Gly tripeptide. The
        aspartate coordinates a magnesium ion that positions the gamma
        phosphate of ATP for transfer. The phenylalanine is the structural
        switch. In the catalytically competent state, that phenylalanine
        packs into a hydrophobic pocket adjacent to the C-helix, the
        aspartate points into the ATP site, and the kinase is ready to
        phosphorylate substrate. This is the DFG-in conformation.
      </p>
      <p>
        In the inactive DFG-out conformation, the phenylalanine flips by
        roughly 180 degrees and rotates out of the back pocket. The
        aspartate rotates with it, and a previously occluded hydrophobic
        cavity behind the gatekeeper residue opens up. Drug designers
        call this newly exposed cavity the allosteric or back pocket, and
        it is the pocket that Type II inhibitors exploit.
      </p>

      <h2>Type I, Type II, and the cousins</h2>
      <ul>
        <li>
          <strong>Type I inhibitors</strong> bind DFG-in. They sit in the
          ATP cleft, make the standard hinge hydrogen bond, and compete
          with ATP. Most kinase inhibitors are Type I — gefitinib, erlotinib,
          dasatinib, crizotinib, sunitinib in one of its binding modes,
          and the entire FGFR and JAK families. Selectivity is harder
          because every kinase looks roughly similar in its ATP-bound
          state.
        </li>
        <li>
          <strong>Type II inhibitors</strong> bind DFG-out. They straddle
          the gatekeeper, reach into the back pocket, and pick up
          interactions that simply do not exist in the DFG-in state.
          Imatinib, nilotinib, ponatinib, sorafenib, regorafenib, and
          BIRB-796 are the canonical examples. The back pocket has
          significantly more sequence variation across kinases than the
          ATP site does, which is why Type II inhibitors can be more
          selective even though they hit a larger surface.
        </li>
        <li>
          <strong>Type III inhibitors</strong> are pure allosteric — they
          bind outside the ATP cleft entirely. Trametinib (MEK), asciminib
          (BCR-ABL myristate pocket), and the SHP2 allosteric inhibitors
          fit here. The reachable chemistry is small but the selectivity
          can be exquisite.
        </li>
        <li>
          <strong>Type IV and covalent inhibitors</strong> add the warhead
          dimension. Osimertinib, ibrutinib, and sotorasib are all
          covalent Type I-derivatives. Covalent Type II is rare but
          exists.
        </li>
      </ul>

      <h2>Why this matters for docking</h2>
      <p>
        If you take a DFG-in crystal structure and dock a Type II inhibitor
        against it, the dock will look terrible. The back pocket is closed,
        the phenylalanine occupies the volume the drug wants to fill, and
        the scoring function will reward poses that contort into the
        accessible ATP cleft rather than the pocket the drug actually
        binds. You will see scores 3 to 5 kcal/mol worse than they should
        be and conclude the molecule is inactive.
      </p>
      <p>
        The fix is to dock against the right conformation. For ABL kinase,
        the canonical DFG-out structure is 1IEP (imatinib bound). For BRAF,
        it is 1UWH (BAY-43-9006 bound). For p38-alpha, it is 1KV2 (BIRB-796
        bound). Several public databases (KLIFS, KinCoRe) annotate every
        deposited kinase structure with its DFG state, and an ensemble
        docking approach that samples both states will recover Type II
        binders that single-structure docking misses. The Liganx ensemble
        feature does exactly that.
      </p>
      <p>
        The harder case is when the protein has no deposited DFG-out
        structure for your target. AlphaFold predictions are biased
        toward the active state, so an AlphaFold model of a kinase is
        almost certainly DFG-in. You either need to switch to a
        homology model from a DFG-out cousin, run an explicit MD-driven
        conformational sampling step, or accept that your docking will
        only catch Type I binders for that target.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The canonical ABL DFG-out structure is{" "}
        <a
          href="https://www.rcsb.org/structure/1IEP"
          target="_blank"
          rel="noreferrer noopener"
        >
          1IEP
        </a>{" "}
        with imatinib bound, and the DFG-in counterpart for ABL is{" "}
        <a
          href="https://www.rcsb.org/structure/2GQG"
          target="_blank"
          rel="noreferrer noopener"
        >
          2GQG
        </a>{" "}
        with dasatinib bound.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick ABL from the target catalog to dock candidates against
        both states side-by-side. Liganx is molecular docking online,
        free in the browser, and the ensemble option runs both DFG
        conformations so you can see the score differential directly.
        For a Type II compound like imatinib or ponatinib the back-pocket
        structure will score 2-4 kcal/mol better than the ATP-only
        structure; for a Type I compound like dasatinib the ranking
        flips. Molecular docking with the right conformation is the
        difference between a usable score and a misleading one.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Schindler T, et al. <em>Structural mechanism for STI-571 inhibition
          of abelson tyrosine kinase.</em> Science 289, 1938-1942 (2000).{" "}
          <a
            href="https://doi.org/10.1126/science.289.5486.1938"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1126/science.289.5486.1938
          </a>
        </li>
        <li>
          Liu Y, Gray NS. <em>Rational design of inhibitors that bind to
          inactive kinase conformations.</em> Nat Chem Biol 2, 358-364 (2006).{" "}
          <a
            href="https://doi.org/10.1038/nchembio799"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nchembio799
          </a>
        </li>
        <li>
          Zuccotto F, et al. <em>Through the &ldquo;gatekeeper door&rdquo;:
          exploiting the active kinase conformation.</em> J Med Chem 53,
          2681-2694 (2010).{" "}
          <a
            href="https://doi.org/10.1021/jm901443h"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/jm901443h
          </a>
        </li>
        <li>
          Kanev GK, et al. <em>KLIFS: an overhaul after the first 5 years
          of supporting kinase research.</em> Nucleic Acids Res 49, D562-D569
          (2021).{" "}
          <a
            href="https://doi.org/10.1093/nar/gkaa895"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1093/nar/gkaa895
          </a>
        </li>
      </ul>
    </>
  );
}
