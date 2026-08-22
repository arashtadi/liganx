/**
 * Post: DiffDock and diffusion docking — what a good RMSD hides
 *
 * SEO target: "DiffDock", "diffusion docking", "deep learning docking",
 * "AI docking physical validity", "PoseBusters". Methodology theme.
 * Internal link into /studio framed around rescoring / validating AI
 * poses with a physics-based method.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "diffdock-diffusion-docking-physical-validity",
  title: "DiffDock and diffusion docking: what RMSD hides",
  description:
    "Diffusion models like DiffDock beat classical docking on RMSD benchmarks, but a good RMSD can hide a physically impossible pose. Here is the catch.",
  date: "2026-07-26",
  author: "Liganx team",
  tags: ["methodology", "deep-learning", "docking", "scoring"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Classical docking treats pose prediction as a search problem: sample
        ligand conformations, score each against the pocket, keep the best.
        DiffDock reframed it as a generative one — learn the distribution of
        plausible poses and sample directly from it. The benchmark numbers
        were striking, but they came with a catch that matters if you plan to
        trust the output. Here is what the diffusion approach does well and
        where it quietly fails.
      </p>

      <h2>What DiffDock actually does</h2>
      <p>
        DiffDock (Corso et al., 2023) is a diffusion generative model built
        for molecular docking. Instead of scoring poses one at a time, it
        learns to reverse a noising process defined over the degrees of
        freedom that actually matter in docking: the ligand's translation
        (where it sits), its rotation (how it is oriented), and its torsion
        angles (how the rotatable bonds twist). Starting from a randomly
        placed, randomly twisted ligand, the model denoises step by step
        toward a pose it considers likely. It is a <em>blind</em> docking
        method — it does not need a predefined binding box, because anywhere
        on or inside the protein surface is a candidate site. A separate
        confidence model then ranks the samples, which gives you a usable
        signal for which poses to trust.
      </p>

      <h2>The benchmark result that got attention</h2>
      <p>
        On the PDBBind benchmark, DiffDock reported a top-1 success rate of
        about 38% at the standard RMSD-below-2-angstrom threshold, versus
        roughly 23% for traditional search-and-score docking and about 20%
        for earlier deep-learning regressors. It also held much more of its
        accuracy when run on computationally folded structures rather than
        crystal structures — relevant in a world where you often only have an
        AlphaFold or ESMFold model of your target. Two properties made it
        genuinely useful: fast inference, and confidence estimates that are
        selective enough to tell good predictions from bad ones.
      </p>

      <h2>The catch: RMSD is not physical validity</h2>
      <p>
        A low RMSD says the ligand atoms landed near the crystallographic
        answer. It says nothing about whether the pose is physically
        possible. This is where the PoseBusters study (Buttenschoen, Morris,
        and Deane, 2024) landed hard. PoseBusters runs a battery of geometry
        and chemistry checks on a predicted pose: bond lengths and angles,
        aromatic-ring planarity, stereochemistry, internal strain, and — the
        big one — steric clashes between ligand and protein atoms.
      </p>
      <ul>
        <li>
          <strong>Deep-learning poses often fail basic geometry.</strong>{" "}
          Across five AI methods, several (EquiBind, Uni-Mol, TankBind)
          produced almost no poses that passed every physical check, even
          when their RMSD looked competitive.
        </li>
        <li>
          <strong>DiffDock was the best of the AI methods — and still
          leaked.</strong> Of 162 DiffDock predictions that came in under 2
          angstrom RMSD, about 90 had protein-ligand distances too short to
          be real, i.e. steric clashes. A "correct" pose that clashes with
          the protein is not a pose you can dock into a hit-to-lead campaign.
        </li>
        <li>
          <strong>Generalization is fragile.</strong> Accuracy dropped on
          protein sequences unlike anything in the training set, the exact
          regime where you most want a prediction you can trust.
        </li>
      </ul>
      <p>
        The takeaway is not that DiffDock is bad — it is a real advance, and
        it is still the most physically reliable of the learned methods
        tested. The takeaway is that RMSD alone is an incomplete score. A
        method can win a benchmark and still hand you a molecule occupying the
        same space as the protein backbone.
      </p>

      <h2>How to use diffusion docking without getting burned</h2>
      <p>
        Treat a diffusion model as a fast, unbiased pose generator, not as the
        final word. Use it to find candidate sites and starting geometries,
        then filter and rescore with a physics-aware method that will actually
        penalize a clash or a strained ring. Run explicit pose validation
        (PoseBusters-style checks) before you believe a number. And weight the
        confidence score — a low-confidence DiffDock pose is exactly the one
        most likely to be geometrically broken.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The practical workflow is hybrid: generate broadly, then validate with
        physics. In{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Studio
        </Link>{" "}
        you can dock a ligand against your target with a physics-based scoring
        function and inspect the actual protein-ligand contacts — the clash
        distances and interaction geometry that an RMSD number hides. It is a
        good way to sanity-check a pose that a diffusion model proposed before
        you commit synthesis effort to it. Liganx is molecular docking online:
        free and browser-based, so you can validate poses without a local
        install.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Corso G, Stark H, Jing B, Barzilay R, Jaakkola T. <em>DiffDock:
          Diffusion Steps, Twists, and Turns for Molecular Docking.</em> ICLR
          2023, arXiv:2210.01776.{" "}
          <a
            href="https://arxiv.org/abs/2210.01776"
            target="_blank"
            rel="noreferrer noopener"
          >
            arxiv.org/abs/2210.01776
          </a>
        </li>
        <li>
          Buttenschoen M, Morris GM, Deane CM. <em>PoseBusters: AI-based
          docking methods fail to generate physically valid poses or
          generalise to novel sequences.</em> Chem. Sci. 15, 3130-3139
          (2024).{" "}
          <a
            href="https://doi.org/10.1039/D3SC04185A"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1039/D3SC04185A
          </a>
        </li>
      </ul>
    </>
  );
}
