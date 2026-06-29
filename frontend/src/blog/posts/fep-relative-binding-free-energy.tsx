/**
 * Post: Relative binding free energy (FEP) — what it is, when docking isn't enough
 *
 * SEO target: "relative binding free energy", "FEP drug discovery",
 * "free energy perturbation vs docking", "FEP+ accuracy kcal/mol".
 * Methodology theme. Internal CTA into /studio framing docking as the
 * fast triage step that FEP refines.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "fep-relative-binding-free-energy",
  title: "Relative binding free energy (FEP): when docking isn't enough",
  description:
    "What free energy perturbation actually computes, why it reaches ~1 kcal/mol on congeneric series, and where it fits between fast docking triage and wet-lab assays.",
  date: "2026-06-01",
  author: "Liganx team",
  tags: ["fep", "free-energy", "methodology", "lead-optimization"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Docking ranks compounds quickly, but a docking score is an empirical
        approximation, not a binding free energy. When you are deep in lead
        optimization and trying to decide whether adding a methyl group will buy
        you tenfold potency or cost you it, you need a method that estimates
        &Delta;G with real statistical mechanics behind it. That method is free
        energy perturbation — FEP — and over the past decade it has gone from a
        specialist&rsquo;s tool to something that routinely guides which analog
        gets made next.
      </p>

      <h2>What FEP actually computes</h2>
      <p>
        FEP does not try to compute the absolute binding free energy of one
        ligand from scratch. Instead it computes the <em>difference</em> in
        binding free energy between two closely related ligands — say, ligand A
        and ligand B that differ by a single substituent. The trick, which goes
        back to Zwanzig&rsquo;s 1954 free-energy perturbation theory, is a
        thermodynamic cycle: rather than physically pulling each ligand out of
        the pocket (expensive and poorly converged), you computationally morph
        ligand A into ligand B in two environments — once free in solvent, once
        bound in the protein — and take the difference.
      </p>
      <p>
        Because &Delta;G is a state function, the two &ldquo;alchemical&rdquo;
        legs of that cycle give you &Delta;&Delta;G<sub>bind</sub> = &Delta;G(B)
        &minus; &Delta;G(A) directly. You never have to simulate the physical
        binding event. You only have to sample the two end states well enough,
        usually through a series of intermediate lambda windows bridging A and
        B, with molecular dynamics doing the sampling and explicit water in the
        box. The output is a number in kcal/mol with an error bar, not a
        unitless score.
      </p>

      <h2>How accurate is it, really?</h2>
      <p>
        The landmark prospective benchmark was Wang et al. (JACS 2015), which
        ran a modern FEP protocol across eight drug-discovery targets and ~200
        ligands and reported root-mean-square errors near 1 kcal/mol on
        congeneric series. One kcal/mol is roughly a factor of five in binding
        affinity at body temperature — accurate enough to triage which analog to
        synthesize, and the dataset behind that paper (the &ldquo;JACS
        set&rdquo;) became a standard for validating new methods.
      </p>
      <p>
        That accuracy is not free or universal. It depends on a good starting
        pose, a well-behaved congeneric series (FEP is far more reliable for
        small R-group changes than for scaffold hops), adequate sampling of slow
        protein motions, and force-field quality. Independent assessments
        (e.g. Communications Chemistry 2023) put the practical ceiling of
        current rigorous methods in the ~1 kcal/mol range — meaningfully better
        than docking for ranking close analogs, but not a substitute for the
        assay.
      </p>

      <h2>Where it sits relative to docking</h2>
      <p>
        Think of it as a funnel, not a competition:
      </p>
      <ul>
        <li>
          <strong>Docking</strong> — milliseconds to seconds per pose. Screens
          thousands to millions of compounds, generates poses, and ranks them
          coarsely. The right tool for &ldquo;which 50 of these 50,000 are worth
          a closer look,&rdquo; and for getting the bound pose that FEP needs as
          a starting point.
        </li>
        <li>
          <strong>FEP</strong> — hours of GPU time per ligand pair. Applied to
          the handful of analogs that survived triage, to rank them by predicted
          potency before anyone runs a synthesis. The right tool for &ldquo;of
          these eight analogs, which three should the chemist make first.&rdquo;
        </li>
        <li>
          <strong>The assay</strong> — the ground truth FEP is calibrated
          against, and the only thing that closes the loop.
        </li>
      </ul>
      <p>
        The two methods share a deep dependency: FEP&rsquo;s answer is only as
        good as the pose it starts from. A docking workflow that produces a
        physically sensible, well-validated pose is the foundation a downstream
        free-energy calculation is built on, which is why pose validation and
        interaction-fingerprint sanity checks matter even when the eventual goal
        is a kcal/mol number.
      </p>

      <h2>The practical takeaway for a docking program</h2>
      <p>
        If you are comparing wildly different chemotypes, lean on docking and
        good judgment; FEP between non-congeneric ligands is fragile. If you are
        optimizing within a series — adding a halogen, swapping a ring,
        extending into a subpocket — that is exactly where relative free energy
        methods earn their keep, and where a 1 kcal/mol prediction can save a
        synthesis cycle. The discipline is to use each method where its error
        bars are smallest.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock a small congeneric series against your target to generate the
        starting poses. Use the docking ranking to triage, then reserve the
        expensive free-energy step for the analogs that survive. Getting a
        clean, validated pose first is the part that makes everything downstream
        trustworthy.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, no install.
        Molecular docking is the fast front end of the funnel — it produces the
        poses and the coarse ranking that a relative binding free energy
        calculation then refines into kcal/mol.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Wang L, et al. <em>Accurate and reliable prediction of relative ligand
          binding potency in prospective drug discovery by way of a modern
          free-energy calculation protocol and force field.</em> J. Am. Chem.
          Soc. 137, 2695-2703 (2015).{" "}
          <a
            href="https://doi.org/10.1021/ja512751q"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/ja512751q
          </a>
        </li>
        <li>
          Zwanzig RW. <em>High-temperature equation of state by a perturbation
          method. I. Nonpolar gases.</em> J. Chem. Phys. 22, 1420-1426 (1954).{" "}
          <a
            href="https://doi.org/10.1063/1.1740409"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1063/1.1740409
          </a>
        </li>
        <li>
          <em>The maximal and current accuracy of rigorous protein-ligand
          binding free energy calculations.</em> Communications Chemistry 6,
          222 (2023).{" "}
          <a
            href="https://doi.org/10.1038/s42004-023-01019-9"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s42004-023-01019-9
          </a>
        </li>
      </ul>
    </>
  );
}
