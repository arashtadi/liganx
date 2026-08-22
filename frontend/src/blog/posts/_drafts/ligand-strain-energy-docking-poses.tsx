import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "ligand-strain-energy-docking-poses",
  title: "Ligand strain energy: when a good docking score is still wrong",
  description:
    "A high-scoring pose that twists the ligand into a strained conformation is paying an energy debt the scoring function forgot to charge. How to catch it.",
  date: "2026-07-18",
  author: "Liganx team",
  tags: ["methodology", "docking", "ligand-strain", "pose-validation"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        A docking program will happily hand you a pose where the ligand is bent
        into a conformation it would never adopt in solution, because the extra
        contacts that bent shape makes with the pocket look good to the scoring
        function. What the score usually does not account for is the energy the
        molecule had to spend to get into that shape. That energy is called
        ligand strain, and ignoring it is one of the most common ways a
        confident docking result turns out to be an artifact.
      </p>

      <h2>What strain actually is</h2>
      <p>
        A free ligand in solution populates low-energy conformations: staggered
        torsions, relaxed ring puckers, no atoms crowding each other. To bind,
        it has to adopt the specific bioactive conformation the pocket wants.
        If that bound shape is close to a low-energy conformer, the ligand pays
        almost nothing. If the pocket demands an eclipsed torsion, a flattened
        ring, or two substituents jammed together, the molecule pays a
        conformational penalty to get there. That penalty &mdash; the energy
        difference between the bound conformation and the nearest relaxed one
        &mdash; is the internal strain, and it comes straight off the top of
        the binding free energy.
      </p>
      <p>
        Perola and Charifson made the scale of this concrete in their 2004
        survey of ligands in crystal structures. Most bound ligands carry only
        modest strain, but a meaningful fraction sit above 5 kcal/mol, and some
        exceed 9. For reference, 1.4 kcal/mol is roughly a factor of ten in
        binding affinity at room temperature. A pose carrying 5 kcal/mol of
        unaccounted strain is not a slightly-worse binder; it is very likely
        not the real pose at all.
      </p>

      <h2>Why docking scores miss it</h2>
      <p>
        Fast empirical scoring functions &mdash; the kind that let you screen
        millions of molecules &mdash; are tuned to reward
        protein-ligand contacts: hydrogen bonds, hydrophobic burial, shape
        complementarity. Their internal-energy term for the ligand is either
        crude or effectively absent. So the search engine is free to torture the
        ligand into whatever conformation maximizes contacts, and the score
        rewards the contacts without sending a bill for the torsional cost.
      </p>
      <p>
        The result is a systematic bias: strained poses get over-ranked. Gu and
        coworkers showed this directly in a 2021 study on ultra-large library
        docking &mdash; filtering out high-strain poses removed a large slice of
        false positives that would otherwise have topped the ranked list, and
        did it without discarding the genuine binders. Strain filtering is now a
        standard post-processing step in serious virtual-screening campaigns for
        exactly this reason.
      </p>

      <h2>How strain gets estimated</h2>
      <p>
        There is a spectrum of methods, trading speed for rigor:
      </p>
      <ul>
        <li>
          <strong>Torsion-library lookups.</strong> Expert-curated libraries
          like the Guba torsion rules encode, for hundreds of SMARTS-defined
          bond patterns, the dihedral angles actually observed in
          small-molecule crystal structures. A pose whose torsions fall in
          rarely-observed or forbidden ranges is flagged as strained. Fast,
          interpretable, and the basis of most automated pose-sanity checks.
        </li>
        <li>
          <strong>Force-field conformational analysis.</strong> Minimize the
          bound conformation and compare its energy to a relaxed global-minimum
          ensemble generated for the same molecule. The difference is the strain
          estimate. More quantitative, but only as good as the force field.
        </li>
        <li>
          <strong>Quantum-mechanical strain.</strong> Ab initio or DFT-level
          single points on the bound versus relaxed geometry. The most accurate
          and the most expensive; recent machine-learning surrogates aim to hit
          near-QM accuracy at a tiny fraction of the cost, which is starting to
          make QM-grade strain filtering practical at library scale.
        </li>
      </ul>

      <h2>What to do with a strained pose</h2>
      <p>
        A high strain reading is a warning, not a verdict. Sometimes a pocket
        really does pay to hold a ligand in a strained shape because the
        contacts more than repay it &mdash; but that should be the rare,
        deliberately-noted exception, not the pose you accept by default. In
        practice: if two poses score within noise of each other and one is
        relaxed while the other is strained, take the relaxed one. If your
        single top pose is heavily strained, treat the whole result as
        suspect and look at the next few poses before you build a story around
        it.
      </p>

      <h2>Try it yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock a flexible, multi-ring ligand against your target, then look
        past the single top-scoring pose at the full ranked set. When you run
        molecular docking online, the highest-scoring conformation is a
        hypothesis, not an answer &mdash; and the cheapest way to sanity-check
        it is to ask whether the ligand looks comfortable in that shape or bent
        into it. A pose that looks tortured, however good its score, is exactly
        the kind of false positive strain analysis is built to catch.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Perola E, Charifson PS. <em>Conformational analysis of drug-like
          molecules bound to proteins: an extensive study of ligand
          reorganization upon binding.</em> J Med Chem 47, 2499-2510 (2004).{" "}
          <a
            href="https://doi.org/10.1021/jm030563w"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/jm030563w
          </a>
        </li>
        <li>
          Gu S, Smith MS, Yang Y, Irwin JJ, Shoichet BK. <em>Ligand strain
          energy in large library docking.</em> J Chem Inf Model 61, 4331-4341
          (2021).{" "}
          <a
            href="https://doi.org/10.1021/acs.jcim.1c00368"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jcim.1c00368
          </a>
        </li>
        <li>
          Guba W, Meyder A, Rarey M, Hert J. <em>Torsion Library Reloaded: a new
          version of expert-derived SMARTS rules for assessing conformations of
          small molecules.</em> J Chem Inf Model 56, 1-5 (2016).{" "}
          <a
            href="https://doi.org/10.1021/acs.jcim.5b00522"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jcim.5b00522
          </a>
        </li>
      </ul>
    </>
  );
}
