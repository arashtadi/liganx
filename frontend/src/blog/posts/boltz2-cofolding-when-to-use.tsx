/**
 * Post: Boltz-2 and co-folding — when to reach for it instead of docking
 *
 * SEO target: "Boltz-2", "co-folding", "AlphaFold3 binding affinity",
 * "when to use co-folding vs docking". Methodology theme. Internal CTA
 * into /studio framing co-folding as complementary to the docking run.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "boltz2-cofolding-when-to-use",
  title: "Boltz-2 and co-folding: when to use it instead of docking",
  description:
    "Co-folding models predict the protein-ligand complex from sequence and SMILES. Here is where Boltz-2 helps, where classical docking still wins, and how to combine them.",
  date: "2026-05-21",
  author: "Liganx team",
  tags: ["methodology", "boltz-2", "co-folding", "docking"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Classical docking starts from a receptor structure you already have and
        searches for where a ligand fits. Co-folding flips the premise: give it
        a protein sequence and a ligand SMILES, and a single neural network
        predicts the bound complex directly. Boltz-2 is the model that pushed
        this from a curiosity to something you should actually consider in a
        workflow. The question is when it earns its place and when you are
        better off docking.
      </p>

      <h2>What co-folding actually does</h2>
      <p>
        Co-folding descends from AlphaFold3, which extended structure prediction
        beyond single proteins to complexes that include small molecules,
        nucleic acids, and ions. Instead of treating the receptor as a fixed
        rigid body and sampling ligand poses against it, the model folds the
        protein and places the ligand in one joint prediction. That means the
        binding-site side chains and even backbone can rearrange around the
        ligand, which a rigid-receptor dock cannot do.
      </p>
      <p>
        Boltz-1, released in late 2024, was the first openly licensed
        reproduction of the AlphaFold3 approach. Boltz-2, released in mid-2025,
        added the piece medicinal chemists actually care about: a binding
        affinity head. It predicts not just the pose but an estimate of how
        tightly the ligand binds, from sequence and SMILES alone.
      </p>

      <h2>Why people are excited</h2>
      <ul>
        <li>
          <strong>No receptor structure required.</strong> If your target has
          no crystal structure and homology models are poor, co-folding
          generates a complex from sequence. Docking has nothing to dock into
          without a structure.
        </li>
        <li>
          <strong>Affinity that approaches FEP, far faster.</strong> The Boltz-2
          authors report affinity correlations approaching free-energy
          perturbation on several benchmarks while running roughly three orders
          of magnitude faster, on the order of seconds per complex on a single
          GPU. FEP can take hours to days per edge.
        </li>
        <li>
          <strong>Induced fit for free.</strong> Because the protein is folded
          jointly with the ligand, side-chain and loop rearrangements that a
          rigid dock would miss can appear in the predicted pose.
        </li>
      </ul>

      <h2>Where classical docking still wins</h2>
      <p>
        Co-folding is not a universal replacement, and treating it as one is the
        most common way people get burned.
      </p>
      <ul>
        <li>
          <strong>Tiny, well-defined changes.</strong> If you have a good
          crystal structure and you are ranking a congeneric series differing by
          a methyl here and a halogen there, docking (or FEP) against that
          structure is usually more reliable than re-folding the whole complex
          for each analog.
        </li>
        <li>
          <strong>Explicit, inspectable scoring.</strong> A docking score
          decomposes into interpretable terms — hydrogen bonds, hydrophobic
          contacts, clashes. A co-folding affinity is a single learned number
          with less mechanistic transparency, so it is harder to debug a
          surprising result.
        </li>
        <li>
          <strong>Confidence that can mislead.</strong> Co-folding models can
          return a clean-looking pose with high internal confidence that is
          nonetheless wrong, especially for ligands or targets unlike the
          training data. The pose looks plausible, which makes the error
          dangerous. Pose validation (PoseBusters-style checks) is not optional.
        </li>
        <li>
          <strong>Mutation deltas.</strong> When the whole point is the
          difference a single point mutation makes, a learned model may smooth
          over exactly the effect you are trying to measure. Docking the
          mutant and wild-type structures separately keeps that signal explicit.
        </li>
      </ul>

      <h2>How to combine them</h2>
      <p>
        The pragmatic workflow uses co-folding to get a structure and an
        affinity prior when you have nothing else, then hands the predicted
        complex to docking and explicit scoring for the work that needs an
        auditable, decomposable answer. Use co-folding to triage a large or
        structurally novel set; use docking to reason carefully about the
        survivors. And whatever generates the pose, run it through pose
        validation before you trust it.
      </p>

      <h2>Try it yourself</h2>
      <p>
        The fastest way to build intuition is to run the same ligand both ways
        and compare.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock a candidate against a target with a known crystal structure,
        then look at how a co-folding prediction places the same ligand. Where
        they agree, you can be more confident; where they diverge, you have
        learned where to look harder. Molecular docking and co-folding answer
        slightly different questions, and seeing both side by side is the
        clearest way to understand which to trust for a given problem.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and set up so
        you can move between a docking run and a structure-prediction view
        without leaving the page. If you want to try molecular docking and
        compare it against a co-folded pose without a local install, that is the
        fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Passaro S, Corso G, Wohlwend J, et al. <em>Boltz-2: Towards Accurate
          and Efficient Binding Affinity Prediction.</em> bioRxiv (2025).{" "}
          <a
            href="https://doi.org/10.1101/2025.06.14.659707"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1101/2025.06.14.659707
          </a>
        </li>
        <li>
          Wohlwend J, Corso G, et al. <em>Boltz-1: Democratizing Biomolecular
          Interaction Modeling.</em> bioRxiv (2024).{" "}
          <a
            href="https://doi.org/10.1101/2024.11.19.624167"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1101/2024.11.19.624167
          </a>
        </li>
        <li>
          Abramson J, et al. <em>Accurate structure prediction of biomolecular
          interactions with AlphaFold3.</em> Nature 630, 493-500 (2024).{" "}
          <a
            href="https://doi.org/10.1038/s41586-024-07487-w"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41586-024-07487-w
          </a>
        </li>
      </ul>
    </>
  );
}
