/**
 * Post: conformer generation and the ligand input structure
 *
 * Methodology theme. SEO target: "conformer generation docking",
 * "ETKDG RDKit", "how many conformers for docking", "ligand
 * preparation molecular docking". Internal link to /studio.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "conformer-generation-ligand-input-docking",
  title: "Conformer generation: the ligand prep step nobody audits",
  description:
    "How the 3D structure you hand a docking program is built, why ETKDG beats naive distance geometry, and how many conformers actually help.",
  date: "2026-08-08",
  author: "Liganx team",
  tags: ["methodology", "conformer-generation", "ligand-preparation", "rdkit"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Every docking run starts with a 3D ligand that did not exist a
        moment earlier. You gave the software a SMILES string — a flat graph
        with no coordinates — and something had to invent bond lengths,
        angles, ring puckers, and torsions before any pose could be scored.
        That invention step gets far less scrutiny than the scoring function
        does, and it silently caps how good your results can be. If the
        bioactive conformation is not reachable from your input, no search
        algorithm will find it.
      </p>

      <h2>What distance geometry actually does</h2>
      <p>
        The standard approach is distance geometry. You build a matrix of
        upper and lower bounds on every interatomic distance in the molecule
        from chemical knowledge — bond lengths, 1-3 distances implied by
        angles, ring closure constraints, van der Waals lower bounds for
        atom pairs that are far apart in the graph. Then you sample a
        distance matrix consistent with those bounds and embed it into
        three dimensions, usually followed by a force-field cleanup with
        MMFF94 or UFF.
      </p>
      <p>
        Pure distance geometry has a known failure mode: it produces
        geometries that satisfy every bound and still look wrong. Amides
        come out non-planar. Aromatic substituents sit at torsions no
        crystal structure has ever shown. The bounds matrix simply does not
        encode the torsional preferences that real molecules obey, because
        torsions are not distance constraints in any direct sense.
      </p>

      <h2>ETKDG: putting the crystallographic knowledge back in</h2>
      <p>
        Riniker and Landrum&rsquo;s ETKDG (Experimental-Torsion Distance
        Geometry with basic Knowledge) fixed this by mining torsion-angle
        preferences from the Cambridge Structural Database and applying them
        as explicit terms during embedding, alongside hard-coded rules for
        things like aromatic ring planarity. The result is that a
        first-pass ETKDG conformer already sits near a plausible local
        minimum before any force-field minimization, and the ensemble you
        generate covers the space real molecules occupy rather than the
        space the bounds matrix technically permits.
      </p>
      <p>
        ETKDGv3, published in 2020, extended the same idea to the two cases
        where v1 struggled hardest: small rings and macrocycles. Macrocycles
        are the pathological case for distance geometry because the ring
        closure constraint couples every torsion to every other torsion, and
        naive sampling wastes most of its effort on geometries that cannot
        close. v3 adds elliptical heuristics and customizable Coulombic
        terms to bias sampling toward closable, experimentally plausible
        ring conformations. If you are docking a macrocyclic ligand and you
        are still on default v1 settings, this is the single highest-value
        change you can make.
      </p>

      <h2>How many conformers</h2>
      <p>
        The honest answer is that it depends on rotatable bond count, and
        that the returns flatten faster than people expect. Common practice,
        and the practice supported by the benchmark literature:
      </p>
      <ul>
        <li>
          <strong>Rigid ligands (0 to 3 rotatable bonds)</strong> — a handful
          of conformers is enough. Ten is generous.
        </li>
        <li>
          <strong>Moderate flexibility (4 to 7)</strong> — on the order of 50
          to 100. This covers most lead-like chemical matter.
        </li>
        <li>
          <strong>High flexibility (8+)</strong> — several hundred to a few
          thousand, and you should be pruning by RMSD as you go so you are
          storing distinct conformations rather than a thousand copies of
          the same one.
        </li>
      </ul>
      <p>
        Two things matter more than the raw count. First, prune with an RMSD
        threshold (0.5 Angstrom is a common default) so ensemble size
        reflects real coverage. Second, do not filter aggressively on
        force-field energy. The bioactive conformation is usually not the
        global minimum, and it is frequently a few kcal/mol above it,
        because the protein pays for that strain with binding interactions.
        Discarding everything outside a tight energy window is one of the
        more common ways to throw away the answer before docking starts.
      </p>

      <h2>Where this interacts with the docking engine</h2>
      <p>
        Flexible-ligand docking programs such as AutoDock Vina sample
        torsions internally, which raises a fair question: if the engine
        does its own conformational search, why prepare an ensemble at all?
        Because the engine samples torsions, not everything else. Ring
        conformations are usually held rigid during docking. Stereochemistry
        is fixed. Amide geometry is fixed. Whatever ring pucker, bridged
        geometry, or macrocycle conformation your input file happens to
        carry is the one the docking will use. The input structure is not a
        starting guess for those degrees of freedom, it is a constraint.
      </p>
      <p>
        Practically: for acyclic flexibility, one good conformer plus a
        flexible-ligand engine is fine. For anything with a non-trivial ring
        system, dock an ensemble that spans the ring conformations, and
        treat each as a separate run.
      </p>

      <h2>A quick sanity check</h2>
      <p>
        Before trusting any campaign, take a ligand with a known
        co-crystallized pose, generate your ensemble from SMILES alone with
        your production settings, and measure the best RMSD in the ensemble
        against the crystal conformation. That number is your ceiling. If
        the closest conformer you can generate is 2.5 Angstrom from the
        bioactive one, a 2.0 Angstrom docking success criterion is not
        reachable no matter how good the scoring function is, and you should
        fix ligand prep before touching anything else.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock the same molecule twice: once from a SMILES string, once
        from an SDF you generated yourself with ETKDGv3 settings. On a rigid
        scaffold the two will agree. On a macrocycle or a fused polycyclic
        they often will not, and the gap between them is the size of the
        error that ligand preparation was contributing all along.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and it
        accepts both SMILES and prepared 3D structures, so running that
        comparison takes a couple of minutes. If you want to try molecular
        docking without setting up a local RDKit and AutoDock toolchain
        first, that is the fastest way in.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Riniker S, Landrum GA.{" "}
          <em>
            Better Informed Distance Geometry: Using What We Know To Improve
            Conformation Generation.
          </em>{" "}
          J Chem Inf Model 55, 2562-2574 (2015).{" "}
          <a
            href="https://doi.org/10.1021/acs.jcim.5b00654"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jcim.5b00654
          </a>
        </li>
        <li>
          Wang S, Witek J, Landrum GA, Riniker S.{" "}
          <em>
            Improving Conformer Generation for Small Rings and Macrocycles
            Based on Distance Geometry and Experimental Torsional-Angle
            Preferences.
          </em>{" "}
          J Chem Inf Model 60, 2044-2058 (2020).{" "}
          <a
            href="https://doi.org/10.1021/acs.jcim.0c00025"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jcim.0c00025
          </a>
        </li>
        <li>
          Hawkins PCD. <em>Conformation Generation: The State of the Art.</em>{" "}
          J Chem Inf Model 57, 1747-1756 (2017).{" "}
          <a
            href="https://doi.org/10.1021/acs.jcim.7b00221"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jcim.7b00221
          </a>
        </li>
        <li>
          <em>
            Conformer Generation for Structure-Based Drug Design: How Many
            and How Good?
          </em>{" "}
          J Chem Inf Model 63, 6598 (2023).{" "}
          <a
            href="https://doi.org/10.1021/acs.jcim.3c01245"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jcim.3c01245
          </a>
        </li>
      </ul>
    </>
  );
}
