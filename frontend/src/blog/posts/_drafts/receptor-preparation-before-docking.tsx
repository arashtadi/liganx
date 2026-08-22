/**
 * Post: Receptor preparation before docking - what the PDB file does not
 * tell you. Missing loops, missing sidechains, Asn/Gln/His flips, and the
 * question of which structure to pick in the first place.
 *
 * SEO target: "protein preparation docking", "receptor preparation
 * molecular docking", "PDB file preparation for docking". Methodology
 * theme. Internal CTA into /studio.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "receptor-preparation-before-docking",
  title: "Your PDB file is not ready to dock into",
  description:
    "Missing loops, unmodelled sidechains, and flipped Asn/Gln/His residues are in most crystal structures. What receptor preparation fixes and why it changes results.",
  date: "2026-08-08",
  author: "Liganx team",
  tags: ["docking-method", "structural-biology", "virtual-screening"],
  readingMin: 8,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        A lot of attention in molecular docking goes to the ligand side:
        tautomers, protonation, conformer generation, stereochemistry. The
        receptor tends to get treated as a solved problem, because it
        arrived as a PDB file from a real experiment and therefore feels
        like ground truth. It is not ground truth. It is a model fitted to
        electron density, and the parts of it that matter most for docking
        are exactly the parts the density constrains least.
      </p>

      <h2>What crystallography cannot see</h2>
      <p>
        X-rays scatter off electrons. Hydrogen has one, which is why
        hydrogens are essentially invisible below about 1.0 angstrom
        resolution and are simply absent from most deposited coordinates.
        Every hydrogen in your docking receptor was placed by software, not
        observed. That is fine, but it means the hydrogen-bond network in
        your binding site is a prediction, and predictions can be wrong.
      </p>
      <p>
        The same limitation produces a subtler problem. Nitrogen, carbon,
        and oxygen have 7, 6, and 8 electrons respectively, close enough
        that at typical resolutions you cannot reliably distinguish them
        from density alone. For the terminal amide groups of asparagine and
        glutamine, and for the histidine imidazole ring, this means the
        180-degree flipped orientation fits the density just as well as the
        correct one. The crystallographer had to guess, and roughly a fifth
        of the time the guess went the wrong way.
      </p>
      <p>
        That number is not folklore. Word and colleagues added explicit
        hydrogens to 1,554 Asn and Gln sidechains across 100 unrelated
        high-quality structures, all between 0.9 and 1.7 angstrom
        resolution, and used small-probe contact analysis to decide the
        orientation of each. About 20 percent required a 180-degree flip to
        optimize hydrogen bonding or avoid steric clashes. In structures
        that good. Below 2.0 angstroms the rate is worse.
      </p>
      <p>
        A flipped Asn in the binding site inverts a donor into an acceptor.
        Your scoring function will happily reward a pose that satisfies the
        wrong one.
      </p>

      <h2>Histidine is three residues wearing one label</h2>
      <p>
        Histidine has a pKa near physiological pH, which is precisely why it
        is so common in catalytic sites and so annoying computationally. The
        imidazole ring can be neutral with the proton on the epsilon
        nitrogen, neutral with it on the delta nitrogen, or positively
        charged with both protonated. These are three chemically different
        residues. The PDB file calls all three HIS and tells you nothing.
      </p>
      <p>
        On top of that, the ring itself can be flipped in the deposited
        coordinates for the same carbon-versus-nitrogen reason as Asn and
        Gln. So a single active-site histidine can be wrong in two
        independent ways at once. If your ligand hydrogen-bonds to a His,
        deciding its tautomer and charge state is not a detail, it is a
        binding hypothesis.
      </p>

      <h2>Missing loops and missing sidechains</h2>
      <p>
        Disordered regions do not produce interpretable density, so
        crystallographers leave them out. Kinase activation loops are the
        canonical case: frequently absent or partially absent, and
        frequently adjacent to the pocket you are docking into. If a loop is
        missing, the pocket in your file is open to solvent in a place where
        the real protein is not, and docking will cheerfully place ligand
        atoms into that phantom space.
      </p>
      <p>
        Long charged sidechains such as lysine, arginine, and glutamate are
        the other common casualty. They are flexible, they average out in
        the density, and they get truncated in the model. A missing Lys
        sidechain deletes a positive charge from your electrostatic
        environment. If it was going to form a salt bridge to your ligand,
        that interaction cannot be scored because the atoms do not exist.
      </p>
      <p>
        Check for both before you dock. Look for gaps in residue numbering
        and for residues with fewer atoms than they should have. Either
        rebuild them or, if the gap is far from the site and clearly
        irrelevant, decide that consciously rather than by not looking.
      </p>

      <h2>How much does this actually change the answer</h2>
      <p>
        Enough to be worth an hour. Sastry and colleagues ran a systematic
        study of preparation steps, first on the Glide validation set of 36
        crystal structures with 1,000 decoys, then across the DUD database.
        Their result was that database enrichment improves with proper
        preparation, and that skipping individual preparation steps produces
        systematic degradation in enrichment, which is large for some
        targets. The work was done with a specific commercial toolchain, but
        the mechanism is generic: the failures come from the structures, not
        from the software brand.
      </p>
      <p>
        The Iridium work from Warren and colleagues is even more sobering as
        a comment on input quality. They defined explicit criteria for
        protein-ligand structure trustworthiness and applied them to 728
        structures that had previously been used to validate docking
        software. Only 17 percent met the bar. Most published docking
        benchmarks, in other words, were partly measuring the noise in their
        own reference structures.
      </p>

      <h2>A practical order of operations</h2>
      <ul>
        <li>
          <strong>Pick the structure deliberately.</strong> Highest
          resolution is a decent default but not the only criterion. Prefer
          a structure co-crystallized with a ligand chemically similar to
          what you intend to dock, since the pocket is already in a
          compatible conformation. Check the R-free, check whether the
          binding site residues have high B-factors, check for alternate
          conformations.
        </li>
        <li>
          <strong>Consider a re-refined version.</strong> PDB-REDO
          re-refines and partially rebuilds deposited entries against the
          original diffraction data with modern methods, and often produces
          a measurably better model than the original deposition,
          particularly for older structures.
        </li>
        <li>
          <strong>Strip what does not belong.</strong> Crystallization
          additives, cryoprotectants, buffer components, and symmetry
          copies. Glycerol and sulfate ions sitting in your pocket will
          block it.
        </li>
        <li>
          <strong>Decide about waters explicitly.</strong> Removing all of
          them is the usual default and is often wrong when a structurally
          conserved water bridges ligand and protein. This deserves its own
          decision rather than a global setting.
        </li>
        <li>
          <strong>Fix the flips and assign protonation.</strong> Optimize
          Asn, Gln, and His orientations, assign His tautomers, and set
          ionization states for Asp, Glu, Lys, and Arg at your target pH.
          Do not assume the defaults are right in the site.
        </li>
        <li>
          <strong>Rebuild missing sidechains and evaluate missing loops.</strong>{" "}
          Sidechains are cheap to model. Loops are not, and a badly modelled
          loop over the pocket is worse than an honest gap far from it.
        </li>
        <li>
          <strong>Minimize lightly, with restraints.</strong> Enough to
          relieve clashes introduced by hydrogen placement, not enough to
          drift the heavy atoms away from the experimental positions.
        </li>
        <li>
          <strong>Redock the native ligand.</strong> If the prepared
          receptor cannot reproduce the crystallographic pose to within
          about 2 angstroms RMSD, the preparation is suspect and everything
          downstream inherits the problem.
        </li>
      </ul>

      <h2>The special case of predicted structures</h2>
      <p>
        Everything above assumes an experimental structure. Predicted models
        have the opposite failure mode: no missing atoms at all, because the
        model always outputs a complete chain, including for regions where
        it has no idea. There is no B-factor to warn you and no gap in the
        numbering. The per-residue confidence score is the closest analogue
        and it should be read the same way you would read a B-factor: low
        confidence near the pocket means the pocket geometry is a guess.
        Sidechain rotamers in predicted models are also generally less
        reliable than backbone placement, which matters because sidechains
        are what your ligand touches.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link
          to="/studio"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          Open Studio
        </Link>{" "}
        and run the same ligand against two preparations of the same target:
        one with default settings, one after flipping the active-site
        histidine tautomer. When you run molecular docking online it is easy
        to treat receptor preparation as a checkbox, but the two runs will
        usually disagree on pose ranking, and that disagreement is a
        reasonable estimate of how much your conclusion depends on a choice
        the crystal structure never made for you.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Word JM, Lovell SC, Richardson JS, Richardson DC.{" "}
          <em>
            Asparagine and glutamine: using hydrogen atom contacts in the
            choice of side-chain amide orientation.
          </em>{" "}
          J Mol Biol 285, 1735-1747 (1999).{" "}
          <a
            href="https://doi.org/10.1006/jmbi.1998.2401"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1006/jmbi.1998.2401
          </a>
        </li>
        <li>
          Sastry GM, Adzhigirey M, Day T, Annabhimoju R, Sherman W.{" "}
          <em>
            Protein and ligand preparation: parameters, protocols, and
            influence on virtual screening enrichments.
          </em>{" "}
          J Comput Aided Mol Des 27, 221-234 (2013).{" "}
          <a
            href="https://doi.org/10.1007/s10822-013-9644-8"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1007/s10822-013-9644-8
          </a>
        </li>
        <li>
          Warren GL, Do TD, Kelley BP, Nicholls A, Warren SD.{" "}
          <em>
            Essential considerations for using protein-ligand structures in
            drug discovery.
          </em>{" "}
          Drug Discov Today 17, 1270-1281 (2012).{" "}
          <a
            href="https://doi.org/10.1016/j.drudis.2012.06.011"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/j.drudis.2012.06.011
          </a>
        </li>
        <li>
          Joosten RP, Long F, Murshudov GN, Perrakis A.{" "}
          <em>
            The PDB_REDO server for macromolecular structure model
            optimization.
          </em>{" "}
          IUCrJ 1, 213-220 (2014).{" "}
          <a
            href="https://doi.org/10.1107/S2052252514009324"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1107/S2052252514009324
          </a>
        </li>
      </ul>
    </>
  );
}
