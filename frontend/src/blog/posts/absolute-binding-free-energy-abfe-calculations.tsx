import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "absolute-binding-free-energy-abfe-calculations",
  title: "Absolute binding free energy: scoring one ligand at a time",
  description:
    "ABFE calculations predict a ligand's standard binding free energy without needing a reference compound, filling the gap between fast docking and reference-anchored FEP.",
  date: "2026-08-22",
  author: "Liganx team",
  tags: ["methodology", "free-energy", "abfe", "fep", "scoring"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Relative free energy calculations answer the question every medicinal
        chemist actually asks &mdash; is this analog better than that one &mdash;
        but they only work when the two molecules look alike. The moment you want
        to compare a pyrimidine against a pyrazole, or rank a set of unrelated
        hits with no shared scaffold, the reference compound disappears and RBFE
        has nothing to anchor to. Absolute binding free energy calculations are
        the answer to that problem: they compute a single ligand&rsquo;s binding
        free energy on its own, with no partner molecule required.
      </p>

      <h2>What ABFE computes</h2>
      <p>
        ABFE targets the standard binding free energy, the thermodynamic quantity
        that maps directly to a dissociation constant. Rather than mutating one
        ligand into another the way RBFE does, ABFE runs an alchemical path in
        which the ligand is decoupled &mdash; its interactions with the
        surroundings are switched off &mdash; in two separate legs: once while
        bound in the protein pocket, and once free in bulk solvent. The
        difference between the two decoupling free energies, after correcting for
        the standard-state volume, is the absolute binding free energy. This is
        the classic double-decoupling construction.
      </p>
      <p>
        Because each ligand is evaluated independently, ABFE can rank chemically
        diverse molecules against each other, which is precisely what RBFE cannot
        do. That makes it attractive for scaffold hopping, for triaging fragment
        hits that share no common core, and for any early-stage campaign where
        the chemical space is too scattered for a reference-anchored map.
      </p>

      <h2>The awkward part: restraints and the standard state</h2>
      <p>
        There is a subtlety that trips up newcomers. When you fully decouple a
        ligand inside the pocket, nothing holds it in place, and it can wander
        the whole simulation box &mdash; sampling becomes hopeless and the
        calculation never converges. The fix is to add geometric restraints (a
        set of distance, angle, and dihedral terms tying the ligand to the
        protein) that keep it localized while it is being switched off. But those
        restraints are artificial: you added free energy to the system by
        imposing them, and you have to subtract exactly that much back out with an
        analytical correction. Get the correction wrong and your absolute number
        is off by a constant, which quietly poisons every ranking.
      </p>
      <p>
        The same care applies to the standard state. A binding free energy is
        only meaningful relative to a defined reference concentration (1 mol/L, or
        equivalently a standard-state volume), and the double-decoupling formalism
        requires you to replace the system-specific volume with that standard
        volume. These bookkeeping steps are not optional flourishes; they are the
        difference between an ABFE number you can compare to an experimental
        &Delta;G and one you cannot.
      </p>

      <h2>How well does it work, and what does it cost</h2>
      <p>
        When it is set up carefully, ABFE is competitive with the best physics
        based methods. Published benchmarks on bromodomains and other targets have
        reached accuracies in the range of roughly 1 kcal/mol against experiment,
        and in fragment optimization studies ABFE has ranked fragment-sized
        binders with strong rank correlation. The catch is cost. Each ligand needs
        its own pair of alchemical decoupling simulations with adequate sampling,
        so ABFE is far more expensive per compound than docking and generally
        heavier than a well-built RBFE map where the perturbations are small. That
        economics is why ABFE is used as a late-stage filter on a short list, not
        as a primary screen over millions of molecules.
      </p>
      <ul>
        <li>
          <strong>Docking</strong> &mdash; cents per compound, ranks by an
          empirical or knowledge-based score, best for enrichment over large
          libraries, weak at fine affinity differences.
        </li>
        <li>
          <strong>RBFE</strong> &mdash; accurate for congeneric series, needs a
          reference and structural similarity, the workhorse of lead optimization.
        </li>
        <li>
          <strong>ABFE</strong> &mdash; no reference needed, handles diverse
          chemistry, highest cost per ligand, reserved for the final shortlist and
          for cross-scaffold comparisons RBFE cannot make.
        </li>
      </ul>

      <h2>Where docking fits in the funnel</h2>
      <p>
        ABFE does not replace docking; it depends on it. A double-decoupling
        calculation starts from a bound pose, and if that pose is wrong the
        expensive free energy number is confidently wrong too. The sensible
        workflow is a funnel: dock a large set to get poses and a first-pass
        ranking, keep the plausible poses, then spend ABFE compute only on the
        handful of chemically diverse candidates that survive. The docking step is
        cheap insurance that the ligand you are about to decouple is sitting where
        it belongs.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        Before you ever queue an ABFE run, you need a defensible pose, and that is
        the part you can do right now.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock your diverse hit set against the target to generate starting
        poses and interaction fingerprints. Use the pose quality and the
        fingerprint overlap to decide which chemically distinct candidates are
        worth the cost of an absolute free energy calculation downstream. Running
        molecular docking online first is how you make sure your ABFE budget goes
        to real binders in real poses, not to artifacts.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Gilson MK, Given JA, Bush BL, McCammon JA. <em>The
          statistical-thermodynamic basis for computation of binding affinities: a
          critical review.</em> Biophys J 72, 1047-1069 (1997).{" "}
          <a
            href="https://doi.org/10.1016/S0006-3495(97)78756-3"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/S0006-3495(97)78756-3
          </a>
        </li>
        <li>
          Boresch S, Tettinger F, Leitgeb M, Karplus M. <em>Absolute binding free
          energies: a quantitative approach for their calculation.</em> J Phys
          Chem B 107, 9535-9551 (2003).{" "}
          <a
            href="https://doi.org/10.1021/jp0217839"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/jp0217839
          </a>
        </li>
        <li>
          Aldeghi M, Heifetz A, Bodkin MJ, Knapp S, Biggin PC. <em>Accurate
          calculation of the absolute free energy of binding for drug
          molecules.</em> Chem Sci 7, 207-218 (2016).{" "}
          <a
            href="https://doi.org/10.1039/C5SC02678D"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1039/C5SC02678D
          </a>
        </li>
        <li>
          Khalak Y, et al. <em>Evaluating the use of absolute binding free energy
          in the fragment optimisation process.</em> Commun Chem 5, 74 (2022).{" "}
          <a
            href="https://doi.org/10.1038/s42004-022-00721-4"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s42004-022-00721-4
          </a>
        </li>
      </ul>
    </>
  );
}
