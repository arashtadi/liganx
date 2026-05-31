/**
 * Post: KRAS codon 61 - the Q61 mutations and why they are different
 *
 * SEO target: long-tail queries around "KRAS Q61H", "KRAS Q61 mutation",
 * "codon 61 KRAS", "Q61 SHP2 resistance", "pan-RAS inhibitor Q61".
 * Mutation deep-dive theme. Internal link to /studio with KRAS + Q61.
 *
 * DRAFT - awaiting human review. Move to ../posts/ to publish.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "kras-q61-mutations-codon-61",
  title: "KRAS codon 61: why Q61 mutations break the GTPase",
  description:
    "Codon 61 mutations disable the catalytic glutamine that hydrolyzes GTP, locking KRAS in the ON state. What that means for SHP2 resistance and pan-RAS drugs.",
  date: "2026-05-27",
  author: "Liganx team",
  tags: ["kras", "oncology", "mutation-deep-dive", "pan-ras"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Codon 12 gets all the attention - G12C, G12D, G12V are the KRAS
        mutations with approved or filed drugs. But codon 61 sits at the other
        end of the molecule and breaks KRAS in a mechanistically distinct,
        arguably more complete way. Glutamine 61 is the catalytic residue that
        makes KRAS turn itself off. Mutate it and the off switch is gone. Here
        is why Q61 mutants behave differently from the codon 12 crowd, and what
        that does to drug design.
      </p>

      <h2>What Q61 does in wild-type KRAS</h2>
      <p>
        KRAS is a molecular switch: ON when GTP-bound, OFF when GDP-bound. The
        transition from ON to OFF is GTP hydrolysis, and glutamine 61 is the
        residue that orchestrates it. Q61 positions and polarizes the
        catalytic water molecule that attacks the gamma-phosphate of GTP. It is
        essential for both the slow intrinsic hydrolysis and the much faster
        GAP (GTPase-activating protein) accelerated hydrolysis that normally
        shuts the protein down within seconds.
      </p>
      <p>
        Codon 12 mutations impair hydrolysis mostly by sterically blocking GAP
        from inserting its arginine finger. Codon 61 mutations are more
        fundamental: they remove the catalytic machinery itself. Q61 mutants
        are essentially devoid of GTPase activity, both intrinsic and
        GAP-mediated, so the protein cannot reach the GDP-bound OFF state. It
        stays locked ON.
      </p>

      <h2>The Q61 variant spectrum</h2>
      <p>
        Codon 61 is mutated to several different residues, and the distribution
        differs by RAS isoform and tumor type:
      </p>
      <ul>
        <li>
          <strong>Q61H</strong> - the predominant codon 61 substitution in
          KRAS, roughly 57% of KRAS Q61 cases. Beyond breaking hydrolysis it
          has a second trick worth knowing about (below).
        </li>
        <li>
          <strong>Q61R, Q61L, Q61K</strong> - collectively about 40% of KRAS
          Q61 mutations. Q61R and Q61L in particular induce structural disorder
          in the switch regions, destabilizing the GTP contacts at residues
          near switch-I.
        </li>
        <li>
          <strong>Q61P, Q61E</strong> - rare, a few percent combined.
        </li>
      </ul>
      <p>
        Importantly, codon 61 is far more common in NRAS and HRAS than in KRAS.
        Q61 accounts for the majority of NRAS mutations in melanoma and of HRAS
        mutations in head and neck cancer, whereas KRAS-driven tumors skew
        heavily toward codon 12. So a Q61 program is often as much an NRAS
        melanoma story as a KRAS one.
      </p>

      <h2>Q61H and the SHP2-resistance wrinkle</h2>
      <p>
        One reason Q61H matters clinically: it decouples KRAS from upstream
        regulation. A major combination strategy for RAS-mutant tumors is
        SHP2 inhibition, which throttles the upstream nucleotide-loading
        signal that keeps mutant RAS topped up with GTP. That works when the
        mutant still depends on upstream input. Q61H does not - its biochemistry
        keeps it GTP-loaded independent of that pathway, which renders Q61H
        cells resistant to SHP2 inhibitors. It is a clean example of why
        mutation identity, not just "KRAS mutant," should drive combination
        choice.
      </p>

      <h2>Drugging a locked-ON protein</h2>
      <p>
        The covalent G12C playbook does not transfer here. Those drugs need
        two things Q61 mutants do not offer: a reactive cysteine to anchor to
        (codon 61 substitutions introduce no warhead-friendly nucleophile in
        the pocket) and meaningful occupancy of the GDP-bound state to trap
        (Q61 mutants barely visit it). Targeting Q61 means targeting the ON
        state directly.
      </p>
      <p>
        That is exactly what the RAS(ON) tri-complex inhibitors do.
        Daraxonrasib (RMC-6236) is a non-covalent molecular glue that binds
        cyclophilin A and forms a ternary complex with GTP-bound RAS, occupying
        a composite pocket spanning cyclophilin A and the switch regions and
        blocking effector engagement. It is multi-selective across wild-type
        and mutant RAS, with reported activity spanning G12X, G13X, and Q61X
        variants - which is the whole point, since it does not rely on a
        mutation-specific handle. In previously treated RAS-mutant pancreatic
        cancer it has shown clinical activity (NEJM, 2025), and the Phase 3
        RASolute 302 trial enrolls tumors carrying G12X, G13X, or Q61X
        mutations.
      </p>
      <p>
        A second, earlier-stage idea flips the logic: instead of blocking the
        ON state, restore the hydrolysis that Q61 destroyed. Small molecules
        that supply a Bronsted base to substitute chemically for the missing
        catalytic glutamine have been shown to reactivate GTP hydrolysis in
        Ras Q61 mutants in vitro - a fascinating proof of concept that the
        broken switch can in principle be chemically rescued.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        Q61 sits in switch-II, away from the codon 12 pocket, so the structural
        consequences are best appreciated visually.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick KRAS from the target catalog with a Q61 mutation from the
        mutation chips to dock against the switch-II-disordered structure.
        Liganx renders wild-type and mutant receptors side by side, so you can
        see how the switch regions reorganize relative to the codon 12 mutants
        - and why a pocket that works for G12C chemistry is not the same pocket
        a Q61 program has to attack. The canonical structural reference for the
        impaired hydrolysis geometry is{" "}
        <a
          href="https://www.rcsb.org/structure/6MNX"
          target="_blank"
          rel="noreferrer noopener"
        >
          6MNX
        </a>
        .
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and set up for
        exactly this kind of mutation-by-mutation comparison. If you want to
        try molecular docking on KRAS Q61 variants without a local install,
        that is the fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          <em>Functional and biological heterogeneity of KRAS Q61 mutations.</em>{" "}
          Sci Signal (2022); summarized in PMC.{" "}
          <a
            href="https://pmc.ncbi.nlm.nih.gov/articles/PMC9534304/"
            target="_blank"
            rel="noreferrer noopener"
          >
            PMC9534304
          </a>
        </li>
        <li>
          <em>
            The Q61H mutation decouples KRAS from upstream regulation and
            renders cancer cells resistant to SHP2 inhibitors.
          </em>{" "}
          Nat Commun 12 (2021).{" "}
          <a
            href="https://doi.org/10.1038/s41467-021-26526-y"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41467-021-26526-y
          </a>
        </li>
        <li>
          <em>
            Daraxonrasib (RMC-6236) in previously treated advanced RAS-mutated
            pancreatic cancer.
          </em>{" "}
          N Engl J Med (2025).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2505783"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2505783
          </a>
        </li>
      </ul>
    </>
  );
}
