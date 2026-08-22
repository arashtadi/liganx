import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "pharmacophore-based-virtual-screening",
  title: "Pharmacophore-based virtual screening, and where docking fits",
  description:
    "A pharmacophore encodes the pattern of interactions a binder must make, not a specific scaffold. Here is how the models are built, what they catch, and how they pair with docking.",
  date: "2026-07-02",
  author: "Liganx team",
  tags: ["methodology", "virtual-screening", "pharmacophore", "docking"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        A pharmacophore is not a molecule. It is an abstract map of the chemical
        features a ligand must present, and in what 3D arrangement, to engage a
        target: a hydrogen-bond donor here, an acceptor there, an aromatic ring
        at that distance, a positive charge in that pocket. Because it describes
        interactions rather than atoms, a single pharmacophore can retrieve
        chemically unrelated scaffolds that all hit the same spot, which is
        exactly what you want when you are scaffold-hopping away from a crowded
        or patented chemotype.
      </p>

      <h2>What a pharmacophore encodes</h2>
      <p>
        A pharmacophore model is a set of features placed in space, each with a
        type and a tolerance sphere. The common feature types are hydrogen-bond
        donors and acceptors, hydrophobic centers, aromatic rings, and positive
        or negative ionizable groups. Good models add excluded volumes, regions
        the ligand is forbidden to occupy because the protein is there. Excluded
        volumes are what turn a permissive feature set into a selective filter;
        without them a pharmacophore tends to over-retrieve.
      </p>

      <h2>Two ways to build one</h2>
      <ul>
        <li>
          <strong>Structure-based:</strong> derive the features directly from a
          protein-ligand complex by reading off the interactions the bound
          ligand actually makes. This is the LigandScout approach, which
          interprets the complex and places donor, acceptor, and hydrophobic
          features plus excluded volumes automatically. It needs a crystal or
          cryo-EM structure with a bound ligand, or at least a credible docked
          pose.
        </li>
        <li>
          <strong>Ligand-based:</strong> when you have several known actives but
          no structure, align them and extract the features they share. The
          shared arrangement becomes the hypothesis. The risk is that a bad
          alignment produces a physically meaningless model, so ligand-based
          work lives or dies on the conformer generation and overlay quality.
        </li>
      </ul>

      <h2>How screening actually runs</h2>
      <p>
        Screening a library against a pharmacophore means generating conformers
        for each candidate and testing whether any conformer can place the
        required features inside their tolerance spheres while avoiding the
        excluded volumes. A molecule that fits is a hit; the fit quality gives a
        rough rank. The appeal is speed: pharmacophore matching is far cheaper
        than docking, so it scales to very large libraries as a first-pass
        filter. The Wolber and Langer parallel-screening work showed you can even
        run one compound against many models at once to profile its likely
        targets.
      </p>

      <h2>Pharmacophore versus docking</h2>
      <p>
        They answer different questions. A pharmacophore asks "does this molecule
        present the right features in the right geometry?" Docking asks "given
        the full pocket, what pose and score does this molecule get?" Benchmark
        comparisons across multiple targets have found neither method dominates
        universally: pharmacophore screening is faster and sometimes enriches
        better on well-characterized binding modes, while docking captures shape
        complementarity and induced effects a feature map cannot. The pragmatic
        answer used in most real campaigns is to chain them: use a pharmacophore
        to prune a huge library down to a tractable set, then dock that set to
        add pose-level scoring and to weed out molecules that match the features
        but clash with the pocket.
      </p>

      <h2>Where it goes wrong</h2>
      <p>
        The failure modes are predictable. Too few features and the model
        retrieves everything; too many and it retrieves nothing. Missing
        excluded volumes let bulky molecules through that could never physically
        bind. Poor conformer sampling means a real active is rejected because its
        bioactive conformation was never generated. And a structure-based model
        is only as good as the pose it came from, so a questionable ligand
        placement propagates its error into every hit list downstream.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        Pharmacophore filtering and docking are complementary, and Liganx covers
        the docking half. Take the hits your pharmacophore model returns,{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          open Studio
        </Link>
        , and dock them into the target pocket to add pose-level scoring on top
        of the feature match. Running molecular docking online after a
        pharmacophore pre-filter is a fast way to confirm that a feature-matched
        molecule can actually occupy the site without clashing, which is the step
        a pharmacophore alone cannot check.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Wolber G, Langer T. <em>LigandScout: 3-D pharmacophores derived from
          protein-bound ligands and their use as virtual screening filters.</em>{" "}
          J Chem Inf Model 45, 160-169 (2005).{" "}
          <a
            href="https://doi.org/10.1021/ci049885e"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/ci049885e
          </a>
        </li>
        <li>
          Steindl TM, Schuster D, Laggner C, Langer T. <em>Parallel screening: a
          novel concept in pharmacophore modeling and virtual screening.</em>{" "}
          J Chem Inf Model 46, 2146-2157 (2006).{" "}
          <a
            href="https://doi.org/10.1021/ci6002043"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/ci6002043
          </a>
        </li>
        <li>
          Chen Z, et al. <em>Pharmacophore-based virtual screening versus
          docking-based virtual screening: a benchmark comparison against eight
          targets.</em> Acta Pharmacol Sin 30, 1694-1708 (2009).{" "}
          <a
            href="https://www.nature.com/articles/aps2009159"
            target="_blank"
            rel="noreferrer noopener"
          >
            nature.com/articles/aps2009159
          </a>
        </li>
      </ul>
    </>
  );
}
