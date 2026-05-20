/**
 * Post: ProLIF interaction fingerprints — what your poses are actually doing
 *
 * SEO target: long-tail "protein ligand interaction fingerprint",
 * "ProLIF tutorial", "docking pose analysis", "interaction fingerprint
 * virtual screening". Internal CTA into /studio's pose viewer which
 * highlights the same interaction set ProLIF tracks.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "prolif-interaction-fingerprints-pose-analysis",
  title: "ProLIF interaction fingerprints — what your poses are actually doing",
  description:
    "Why an interaction fingerprint tells you more than a docking score, how ProLIF encodes the eight interaction types that matter, and where this fits in a screening workflow.",
  date: "2026-05-17",
  author: "Liganx team",
  tags: ["docking-method", "interaction-fingerprint", "pose-analysis", "virtual-screening"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        A docking score is a single number trying to summarize a
        three-dimensional binding event. It throws away almost
        everything that medicinal chemists actually care about:
        which residue made the key hydrogen bond, whether the
        critical π-stack is there, whether the basic amine is
        sitting where the conserved aspartate is. Interaction
        fingerprints fix that. They keep the per-residue contact
        information as a sparse bitvector, which you can compare,
        cluster, and feed into downstream models. ProLIF is the
        open-source tool that turned this into a few lines of
        Python, and it has become the standard way to do
        pose-level analysis on top of any docking program.
      </p>

      <h2>What an interaction fingerprint actually is</h2>
      <p>
        An interaction fingerprint (IFP) is a binary vector where
        each bit answers a yes/no question about a specific
        interaction. The simplest scheme assigns one bit per
        (residue, interaction-type) pair, where the interaction
        types are the canonical set medicinal chemists already
        think in: hydrogen-bond donor and acceptor, hydrophobic
        contact, π-stacking, π-cation, halogen bond, salt bridge,
        and metal coordination. A pose with 30 contacts to 12
        active-site residues collapses to a fingerprint a few
        thousand bits long, where most bits are zero.
      </p>
      <p>
        That representation is useful for three reasons.{" "}
        <strong>First</strong>, two poses that score similarly but
        engage different residues are easy to tell apart — their
        Tanimoto similarity in fingerprint space will be low even
        when the energies are equal. <strong>Second</strong>, a
        reference fingerprint (from a crystal structure or a
        validated pose) becomes a hard target you can rank
        screening hits against. <strong>Third</strong>, the
        fingerprint is a clean featurization for any downstream
        ML model — pose-quality classifier, affinity predictor,
        selectivity model.
      </p>

      <h2>Where ProLIF fits</h2>
      <p>
        ProLIF, published by Bouysset and Fiorucci in 2021, is a
        Python library that consumes a docked pose or an MD
        trajectory and emits the fingerprint. The implementation
        works on top of RDKit and MDAnalysis, which means it can
        read essentially every file format the field uses:
        PDB, SDF, MOL2, DCD, XTC, parquet pose stacks. The
        default interaction set is the standard eight types
        (hydrophobic, π-stacking, π-cation, cation-π, anionic,
        cationic, H-bond donor, H-bond acceptor). Geometric
        criteria are parameterized — angle and distance cutoffs
        per type — and can be reparameterized for an unusual
        case like a halogen-rich screening set or a metal
        cofactor.
      </p>
      <p>
        For a docking output, the typical workflow is three
        function calls: load the protein and the pose set,
        instantiate a <code>Fingerprint</code> object, call
        <code>run()</code>. The result is a pandas DataFrame
        indexed by pose ID with a multi-index column per
        (residue, interaction-type) pair. From there it is the
        usual data-science routine: similarity to a reference
        pose with <code>jaccard</code> distance, agglomerative
        clustering with <code>scipy</code>, or feature feed
        into <code>sklearn</code> for a structure-activity
        model. ProLIF also ships a network-style HTML viewer
        for human inspection, which is useful when you are
        trying to communicate &ldquo;these 200 hits all engage
        the same hinge residue&rdquo; to a med chem audience.
      </p>

      <h2>The four jobs an IFP is good at</h2>
      <p>
        <strong>1. Cherry-picking the right pose.</strong> A
        Vina-class scoring function will frequently rank a pose
        in the top three that misses the key catalytic contact.
        If you know the key contact from the co-crystal — say,
        the H-bond to the hinge methionine in a kinase — you
        can filter your top-N to only poses where that bit is
        set. This is the difference between &ldquo;the top score&rdquo;
        and &ldquo;the top pose that is doing what we know it
        has to do.&rdquo; In a published benchmark by Bietz et al.
        on the PDBbind test set, IFP-based pose selection
        recovered the near-native pose more often than energy
        ranking alone.
      </p>
      <p>
        <strong>2. Diversity assessment in virtual screening.</strong>{" "}
        Two hits that share a high IFP-Tanimoto are probably
        binding the same way and exploring the same SAR. Two
        hits with a low IFP-Tanimoto but similar scores are
        engaging different parts of the pocket and represent
        genuinely independent chemical series. A library
        triage that picks the top-100 by score will tend to
        cluster — IFP-clustering across the top 1000 and
        picking centroids gives a more chemically diverse
        shortlist.
      </p>
      <p>
        <strong>3. Selectivity rationalization.</strong> When a
        compound shows differential potency between WT and a
        mutant, the IFP tells you why. The bits that flip
        between WT and mutant poses point at the residues that
        are doing different work. This is how you turn a
        retrospective ΔΔ into a forward design hypothesis.
      </p>
      <p>
        <strong>4. ML featurization.</strong> An IFP is a
        compact, interpretable feature set. Models trained on
        IFPs are smaller and more transparent than the
        equivalent voxel-grid or graph-neural-network model,
        and the feature importances point directly at
        residue-level chemistry. Several recent papers use
        ProLIF outputs as the input layer for pose-quality
        classifiers and for selectivity models in the kinase
        space.
      </p>

      <h2>The limits</h2>
      <p>
        An IFP is only as good as the geometry it is reading.
        If your pose is wrong, your fingerprint is wrong. So
        IFP-based workflows should sit downstream of a pose
        validator — PoseBusters for geometric sanity,
        re-scoring with GNINA or a CNN for the energy side —
        not replace one. Second, IFPs do not capture
        energetics: a strong hydrogen bond and a weak one
        flip the same bit. If your downstream question is
        affinity, you want the bit pattern plus a force-field
        readout, not the bit pattern alone. Third, the default
        interaction geometry cutoffs were tuned on small-molecule
        protein complexes; for nucleic-acid targets or
        macrocycles you probably want to re-parameterize.
      </p>

      <h2>Where this lands in the Liganx workflow</h2>
      <p>
        The pose viewer in Liganx already highlights the
        interaction set ProLIF tracks — same eight types, same
        geometric criteria. The result is that when you scroll
        through the top poses on a docking run, the colored
        contact arcs are functionally the same information
        ProLIF would emit as a fingerprint row. That is the
        right granularity for the question medicinal chemists
        actually ask about a docking result: not &ldquo;what is
        the score?&rdquo; but &ldquo;is the molecule engaging the
        residues we know matter?&rdquo;
      </p>
      <p>
        For a pure scoring workflow with no interaction
        analysis, you are over-fitting to a single number. For
        a workflow where the score is supplemented by the IFP
        — either from ProLIF in a downstream notebook or from
        the Liganx pose viewer at decision time — the failure
        mode of &ldquo;great score, wrong pose&rdquo; is the one
        that gets caught.
      </p>

      <h2>Try the interaction view yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock any candidate against a target. After the run
        completes, click any pose in the results table to open
        the 3D viewer. The interaction sidebar lists each
        contact by residue and type, color-coded the same way
        ProLIF colors its plots. Compare two poses by
        switching between them — the bits that change tell you
        what the molecule is doing differently, exactly the
        way an IFP Tanimoto would.
      </p>
      <p>
        Liganx puts molecular docking online and free in the
        browser, with the interaction view built in. Using
        molecular docking with the contact set surfaced at
        decision time is the cheapest way to avoid the
        &ldquo;great score, wrong pose&rdquo; failure mode.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Bouysset C, Fiorucci S.{" "}
          <em>ProLIF: a library to encode molecular
          interactions as fingerprints.</em> J Cheminform 13,
          72 (2021).{" "}
          <a
            href="https://doi.org/10.1186/s13321-021-00548-6"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1186/s13321-021-00548-6
          </a>
        </li>
        <li>
          Deng Z, Chuaqui C, Singh J.{" "}
          <em>Structural interaction fingerprint (SIFt): a
          novel method for analyzing three-dimensional
          protein-ligand binding interactions.</em> J Med
          Chem 47, 337-344 (2004).{" "}
          <a
            href="https://doi.org/10.1021/jm030331x"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/jm030331x
          </a>
        </li>
        <li>
          Da C, Kireev D.{" "}
          <em>Structural protein-ligand interaction
          fingerprints (SPLIF) for structure-based virtual
          screening: method and benchmark study.</em> J Chem
          Inf Model 54, 2555-2561 (2014).{" "}
          <a
            href="https://doi.org/10.1021/ci500319f"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/ci500319f
          </a>
        </li>
        <li>
          ProLIF GitHub repository, chemosim-lab/ProLIF.{" "}
          <a
            href="https://github.com/chemosim-lab/ProLIF"
            target="_blank"
            rel="noreferrer noopener"
          >
            github.com/chemosim-lab/ProLIF
          </a>
        </li>
      </ul>
    </>
  );
}
