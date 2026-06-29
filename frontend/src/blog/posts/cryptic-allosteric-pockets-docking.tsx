/**
 * Post: Cryptic and allosteric pockets in docking
 *
 * SEO target: "cryptic pocket docking", "allosteric inhibitor docking",
 * "cryptic binding site prediction", "docking against apo structure".
 * Theme: methodology / workflow. Internal CTA into /studio's ensemble
 * docking, which ties directly to the cryptic-pocket conformation problem.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "cryptic-allosteric-pockets-docking",
  title: "Cryptic and allosteric pockets in docking",
  description:
    "Some of the best drug targets have no visible pocket in their resting structure. Why rigid docking misses cryptic sites, and what to do about it.",
  date: "2026-06-08",
  author: "Liganx team",
  tags: ["docking", "methodology", "cryptic-pockets", "allosteric"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Open a docking program, load a crystal structure, define the binding
        site, and dock. The unspoken assumption is that the pocket you are
        docking into actually exists in the structure in front of you. For a
        large fraction of disease-relevant proteins, it does not. The pocket
        only appears when a ligand pushes the protein into a conformation no
        apo crystal ever captured. Miss that, and your rigid-receptor run
        confidently reports that nothing binds to a target that is, in fact,
        druggable.
      </p>

      <h2>Cryptic versus allosteric: two different ideas</h2>
      <p>
        The terms get used loosely, so it is worth separating them.
      </p>
      <ul>
        <li>
          <strong>An allosteric site</strong> is defined by location: it is a
          pocket distinct from the orthosteric (substrate or ATP) site, where
          a ligand can modulate activity from a distance. Allosteric sites can
          be perfectly visible in the resting structure.
        </li>
        <li>
          <strong>A cryptic site</strong> is defined by visibility: it is a
          pocket that is absent or too shallow to detect in the ground-state
          structure and only forms through a conformational change, often
          induced by the ligand itself. A cryptic site may be orthosteric or
          allosteric.
        </li>
      </ul>
      <p>
        The hard case for docking is the cryptic site, because the geometry
        you need simply is not in the input coordinates.
      </p>

      <h2>Why this matters: targets that hide their pockets</h2>
      <p>
        Cimermancic et al. (2016), building the CryptoSite predictor,
        estimated that accounting for cryptic sites raises the fraction of
        the disease-associated human proteome considered druggable from
        roughly 40% to nearly 80%. The PocketMiner work (Meller et al., 2023)
        went further, arguing from simulation that over half of proteins that
        look pocketless in available structures likely harbor cryptic pockets.
        These are not edge cases.
      </p>
      <p>
        Two clinically validated examples make the point. The KRAS switch-II
        pocket that every covalent G12C inhibitor exploits is essentially
        invisible in early KRAS structures; it opens only in specific states,
        which is part of why KRAS was called undruggable for thirty years. And
        asciminib, the BCR-ABL1 inhibitor, works by binding the myristoyl
        pocket, an allosteric site that the kinase normally uses for
        autoregulation rather than the ATP site every prior TKI targeted
        (Wylie et al., 2017). Dock asciminib into an ATP-site-only model and
        you learn nothing.
      </p>

      <h2>Why rigid docking fails here</h2>
      <p>
        Standard docking holds the receptor fixed and samples ligand poses
        against it. If the input is an apo or closed-state structure, the
        cryptic pocket is collapsed: there is no cavity to dock into, sidechains
        occlude the space, and the scoring function rewards poses that sit on
        the wrong surface. The result is not a useful negative; it is an
        artifact of using the wrong conformation. The protein never got the
        chance to open.
      </p>

      <h2>What to do instead</h2>
      <ul>
        <li>
          <strong>Dock against the right conformation.</strong> If a
          ligand-bound (holo) structure exists where the pocket is open, use
          it. The pocket geometry from a co-crystal with any ligand is usually
          a far better receptor than the apo form.
        </li>
        <li>
          <strong>Ensemble docking.</strong> Generate multiple receptor
          conformations and dock against all of them, keeping the best score
          per ligand. Conformations can come from multiple crystal structures,
          from molecular dynamics snapshots, or from enhanced-sampling
          simulations designed to open transient pockets.
        </li>
        <li>
          <strong>Induced-fit and flexible-receptor docking.</strong> Let
          binding-site sidechains, or in aggressive protocols the backbone,
          relax in response to the ligand. This recovers small pocket openings
          that rigid docking cannot.
        </li>
        <li>
          <strong>Predict where the pockets are first.</strong> Tools like
          CryptoSite and PocketMiner flag residues likely to participate in a
          cryptic pocket, telling you whether to invest in conformational
          sampling before you waste a rigid-docking campaign.
        </li>
        <li>
          <strong>Mind AlphaFold.</strong> A predicted structure typically
          gives you a single, usually ground-state, conformation. It is a
          starting point for sampling, not a guarantee that a cryptic or
          allosteric pocket will be present and open.
        </li>
      </ul>

      <h2>The practical takeaway</h2>
      <p>
        Before you trust a docking result, ask whether the pocket you docked
        into is the pocket the drug would actually use. For well-behaved
        orthosteric sites the answer is usually yes. For allosteric programs,
        for cryptic-pocket targets, and for anything historically called
        undruggable, a single rigid structure is the wrong tool, and the
        fix is conformational sampling rather than a better scoring function.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The cleanest way to feel the conformation problem is to dock the same
        ligand against more than one receptor state.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and use the ensemble docking option to run a ligand against multiple
        conformations of a target at once, then compare the per-conformation
        scores. A compound that scores poorly against a closed state and well
        against an open one is showing you exactly the cryptic-pocket effect
        this post is about. Liganx is molecular docking online: free,
        browser-based, and set up so you can test conformational dependence
        without standing up an MD pipeline. If you want to try molecular
        docking against multiple receptor states without a local install,
        that is the fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Cimermancic P, et al. <em>CryptoSite: Expanding the Druggable
          Proteome by Characterization and Prediction of Cryptic Binding
          Sites.</em> J Mol Biol 428, 709-719 (2016).{" "}
          <a
            href="https://doi.org/10.1016/j.jmb.2016.01.029"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/j.jmb.2016.01.029
          </a>
        </li>
        <li>
          Meller A, et al. <em>Predicting locations of cryptic pockets from
          single protein structures using the PocketMiner graph neural
          network.</em> Nat Commun 14, 1177 (2023).{" "}
          <a
            href="https://doi.org/10.1038/s41467-023-36699-3"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41467-023-36699-3
          </a>
        </li>
        <li>
          Wylie AA, et al. <em>The allosteric inhibitor ABL001 enables dual
          targeting of BCR-ABL1.</em> Nature 543, 733-737 (2017).{" "}
          <a
            href="https://doi.org/10.1038/nature21702"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nature21702
          </a>
        </li>
      </ul>
    </>
  );
}
