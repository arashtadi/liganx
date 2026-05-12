/**
 * Post: PoseBusters — why a top-1 RMSD ≤ 2 Å pose can still be wrong
 *
 * SEO target: "PoseBusters", "DiffDock failure", "pose validation",
 * "docking pose physical plausibility". Internal CTA into /studio where
 * the PoseBusters checks run automatically on every dock result.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "posebusters-pose-validation",
  title: "PoseBusters: why your top-ranked pose can still be nonsense",
  description:
    "RMSD under 2 angstroms is not the same as a pose you can hand to a chemist. PoseBusters showed how often deep-learning docking violates chemistry, and what to check.",
  date: "2026-05-12",
  author: "Liganx team",
  tags: ["docking-method", "posebusters", "validation", "deep-learning"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        For thirty years the de facto pass/fail for a docking pose has been
        &ldquo;RMSD to the crystal pose under 2 Å.&rdquo; That metric is
        fine when the underlying method respects bond lengths, angles,
        and ring planarity by construction — which is how every
        force-field-based docking program works. It stops being fine the
        moment a neural network starts emitting coordinates directly.
        PoseBusters is the paper that made the field admit this in 2024,
        and it changed how docking benchmarks should be reported.
      </p>

      <h2>What PoseBusters actually checks</h2>
      <p>
        Buttenschoen et al. (Chem Sci, 2024) introduced PoseBusters as
        an open-source RDKit-based suite of geometric and chemical
        sanity tests applied to every predicted pose. The checks fall
        into three buckets:
      </p>
      <ul>
        <li>
          <strong>Chemical validity of the ligand</strong> — correct
          stereochemistry preserved from the input SMILES, no atoms
          flipped between R/S, no double bonds isomerized E/Z, no
          aromatic rings that have lost planarity.
        </li>
        <li>
          <strong>Internal geometry</strong> — bond lengths within
          tolerance of reference distributions, bond angles within
          ranges, no impossibly short non-bonded contacts within the
          ligand, no atoms overlapping.
        </li>
        <li>
          <strong>Protein-ligand consistency</strong> — no steric
          clashes with the receptor (van der Waals overlap below 0.4 Å),
          ligand sits inside the binding pocket rather than buried in
          backbone or floating in solvent.
        </li>
      </ul>
      <p>
        A pose that fails any of those checks is called <em>PB-invalid</em>.
        A pose that passes them all is <em>PB-valid</em>. The new metric
        the field has adopted is &ldquo;RMSD &lt; 2 Å <em>and</em>
        PB-valid&rdquo; — both conditions or neither.
      </p>

      <h2>What the benchmark revealed</h2>
      <p>
        The PoseBusters Benchmark set is a curated 308-structure subset
        of PDB protein-ligand complexes released after 2021, deliberately
        chosen to be temporally out-of-distribution for any deep-learning
        method trained on PDBBind. The headline result: on this hold-out
        set, the best deep-learning docking method at the time
        (DiffDock) ranked highest on raw RMSD but produced PB-valid poses
        only a minority of the time. Classical methods — AutoDock Vina,
        Gold, Glide — produced PB-valid poses at much higher rates, and
        their combined &ldquo;RMSD &lt; 2 Å and PB-valid&rdquo; success
        rates beat the deep-learning methods outright.
      </p>
      <p>
        The reasons are mechanical. Force-field docking propagates atomic
        coordinates through a Lennard-Jones potential and a bonded-energy
        term that physically prohibits 0.5 Å bond lengths and 110°
        aromatic-ring distortions. A diffusion model learning coordinates
        in Cartesian space has no such prior — it can produce a pose
        that looks plausible at low resolution but contains a tetrahedral
        nitrogen flattened into a plane, or a phenyl ring with bond
        angles ranging from 95° to 130°. The pose passes RMSD because
        the atomic centroids land in roughly the right place; it fails
        PoseBusters because the molecule it represents could not
        physically exist.
      </p>

      <h2>The wider lesson for docking workflows</h2>
      <p>
        A pose has to pass three independent tests before a medicinal
        chemist should trust it:
      </p>
      <ul>
        <li>
          <strong>Geometric accuracy</strong> (low RMSD to a reference
          when a reference exists, or low pose-pose RMSD across replicate
          dockings when it doesn&rsquo;t).
        </li>
        <li>
          <strong>Physical plausibility</strong> (PoseBusters or
          equivalent — bond lengths, angles, no clashes, valid
          stereochemistry).
        </li>
        <li>
          <strong>Interaction recovery</strong> — does the pose make the
          interactions a known active should make (hinge hydrogen bonds
          for kinase inhibitors, the covalent bond for warhead
          chemistries, the canonical hydrophobic stack with a specific
          residue)? ProLIF interaction fingerprints are the standard
          way to score this.
        </li>
      </ul>
      <p>
        A top-1 pose that fails any of the three is suspect, regardless
        of how good the docking score is. This is especially true for
        any pose generated by a generative method — diffusion-based,
        flow-matching, or otherwise.
      </p>

      <h2>What this means for benchmarks you read</h2>
      <p>
        Any paper claiming state-of-the-art docking after Buttenschoen
        2024 should be reporting PB-valid success rates, not just RMSD
        success rates. If a methods paper says &ldquo;75% top-1 RMSD
        &lt; 2 Å&rdquo; without a PB-validity column, the right reaction
        is skepticism. Recent improvements — Boltz, AlphaFold3,
        Chai-1 — are starting to fold geometric constraints back into
        the model architecture (typed bond terms, equivariant losses on
        bond lengths) and their PB-valid rates have caught up
        substantially, but the lesson holds: <strong>RMSD alone is no
        longer sufficient evidence that a pose is correct</strong>.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        Liganx runs Vina and GNINA (when GPU-compatible) for scoring,
        and surfaces the PoseBusters checks alongside every result.
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          {" "}Open Studio
        </Link>{" "}
        and dock any candidate against any target. After the run, the
        pose viewer flags PB-invalid poses with a warning chip — if
        you see it, the score is not trustworthy on its own and a
        re-dock with tighter exhaustiveness or a different initial
        conformer is the right next move. The point isn&rsquo;t to
        memorize the checks; the point is that a docking score is one
        signal and pose validity is a separate, equally important one.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Buttenschoen M, Morris GM, Deane CM. <em>PoseBusters: AI-based
          docking methods fail to generate physically valid poses or
          generalise to novel sequences.</em> Chem Sci 15, 3130-3139
          (2024).{" "}
          <a
            href="https://doi.org/10.1039/D3SC04185A"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1039/D3SC04185A
          </a>
        </li>
        <li>
          Corso G, et al. <em>DiffDock: Diffusion Steps, Twists, and
          Turns for Molecular Docking.</em> ICLR 2023.{" "}
          <a
            href="https://arxiv.org/abs/2210.01776"
            target="_blank"
            rel="noreferrer noopener"
          >
            arXiv:2210.01776
          </a>
        </li>
        <li>
          Bouysset C, Fiorucci S. <em>ProLIF: a library to encode
          molecular interactions as fingerprints.</em> J Cheminform 13,
          72 (2021).{" "}
          <a
            href="https://doi.org/10.1186/s13321-021-00548-6"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1186/s13321-021-00548-6
          </a>
        </li>
      </ul>
    </>
  );
}
