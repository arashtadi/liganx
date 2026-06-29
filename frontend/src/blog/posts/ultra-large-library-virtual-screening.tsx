/**
 * Post: Ultra-large library docking - what changed when libraries went
 * from millions to billions, and why hit rates went up rather than down.
 *
 * SEO target: "ultra-large library docking", "make-on-demand library
 * virtual screening", "billion compound docking". Methodology post.
 * Internal CTA into /studio for docking individual candidates that fall
 * out of a large screen.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "ultra-large-library-virtual-screening",
  title: "Ultra-large library docking: billions of compounds, better hits",
  description:
    "Why screening hundreds of millions of make-on-demand compounds raised docking hit rates instead of drowning them, and the tricks that make billion-compound screens tractable.",
  date: "2026-06-29",
  author: "Liganx team",
  tags: ["docking-method", "virtual-screening", "chemical-space"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        For decades the intuition was that bigger screening libraries
        would mostly add noise: more compounds means more false positives
        scoring well by chance, so a docking campaign across a hundred
        million molecules should bury its real hits. The opposite turned
        out to be true. When libraries grew from a few million to hundreds
        of millions of make-on-demand compounds, hit rates and potencies
        went up. Understanding why is the single most useful thing to know
        about modern structure-based virtual screening.
      </p>

      <h2>What &ldquo;make-on-demand&rdquo; means</h2>
      <p>
        The libraries that drove this shift are not shelves of physical
        vials. They are combinatorial enumerations of compounds that
        <em>could</em> be synthesized on request from a catalog of
        building blocks and a set of reliable, validated reactions. The
        best-known is Enamine&rsquo;s REAL space. You search it
        computationally, dock the virtual molecules, then order only the
        few hundred top scorers for physical synthesis and assay. The
        synthesis success rate for these reactions is high enough
        (typically 70-80%) that the virtual library behaves like a real
        one for screening purposes.
      </p>
      <p>
        The size matters because chemical space is astronomically
        underexplored. A few million purchasable compounds is a rounding
        error against the ~10^60 drug-like molecules that could in
        principle exist. Make-on-demand libraries pushed the accessible
        slice from millions to billions, and that extra coverage is where
        the new chemotypes were hiding.
      </p>

      <h2>The result that changed the field</h2>
      <p>
        Lyu et al. (2019) docked around 138 million make-on-demand
        compounds against two targets: the enzyme AmpC beta-lactamase and
        the dopamine D4 receptor. The numbers were unusually good. For D4,
        of 549 compounds tested, 122 were active, a 22% hit rate, and they
        spanned 81 new chemotypes including a 180-picomolar,
        subtype-selective agonist. For AmpC they found one of the most
        potent non-covalent inhibitors of that enzyme reported at the
        time. The headline lesson: with a large enough, chemically diverse
        library, the very top of the docking rank-ordered list is enriched
        for genuine binders, not artifacts.
      </p>
      <p>
        Why does more compounds help rather than hurt? Two reasons. First,
        a bigger library samples the pocket&rsquo;s ideal complementary shape
        more finely, so the best-fitting molecules fit better in absolute
        terms. Second, with millions of candidates you can afford to be
        ruthless at the top: you only ever test the extreme tail of the
        score distribution, where the enrichment is strongest. You are not
        testing average compounds, you are testing the best-in-100-million.
      </p>

      <h2>How you dock a billion compounds without a supercomputer-year</h2>
      <p>
        Brute force does not scale forever. Two strategies make the very
        largest spaces tractable:
      </p>
      <ul>
        <li>
          <strong>Massive parallel brute force.</strong> Platforms like
          VirtualFlow (Gorgulla et al., 2020) distribute the dock across
          thousands of cloud or cluster cores with near-perfect scaling.
          That team prepared more than 1.4 billion molecules in
          ready-to-dock format and screened over a billion against KEAP1,
          recovering a nanomolar inhibitor.
        </li>
        <li>
          <strong>Combinatorial shortcuts.</strong> V-SYNTHES (Sadybekov
          et al., 2022) avoids enumerating the full space at all. It docks
          the building-block fragments (synthons) first, keeps the best
          scaffold-synthon seeds, then grows only the promising ones,
          guided by the reaction rules of the library. It searched an
          11-billion-compound space while explicitly docking less than
          0.1% of it, and validated hits against ROCK1. This is the
          direction the field is heading as libraries pass tens of
          billions.
        </li>
      </ul>

      <h2>The caveats that still apply</h2>
      <p>
        Scale does not repeal the limits of a docking score. Scoring
        functions remain the weak link: they approximate binding free
        energy and systematically mis-rank some chemotypes. Bigger
        libraries amplify any pose or protonation-state error because you
        are operating at the extreme tail where small artifacts get
        promoted. Practical screens still depend on a good receptor
        structure, careful pocket definition, and re-scoring or visual
        triage of the top poses before anything gets ordered. The size of
        the library raises the ceiling; it does not fix a bad setup.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        You do not need a billion-compound cluster run to use the same
        logic. The endpoint of any ultra-large screen is a short list of
        individual candidates you want to inspect carefully against your
        target and its mutants.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock your shortlisted compounds against the target structure,
        then read the pose and the ADMET panel before you commit synthesis
        budget. Comparing the wild-type and mutant ΔΔ on a handful of top
        scorers is exactly the triage step a large screen leaves you with.
      </p>
      <p>
        Liganx brings molecular docking online and free in the browser, so
        the per-compound validation that follows a large virtual screen
        does not need a local install. Running molecular docking on your
        final shortlist is the cheapest insurance against ordering the
        wrong molecules.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Lyu J, et al. <em>Ultra-large library docking for discovering
          new chemotypes.</em> Nature 566, 224-229 (2019).{" "}
          <a
            href="https://doi.org/10.1038/s41586-019-0917-9"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41586-019-0917-9
          </a>
        </li>
        <li>
          Gorgulla C, et al. <em>An open-source drug discovery platform
          enables ultra-large virtual screens.</em> Nature 580, 663-668
          (2020).{" "}
          <a
            href="https://doi.org/10.1038/s41586-020-2117-z"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41586-020-2117-z
          </a>
        </li>
        <li>
          Sadybekov AA, et al. <em>Synthon-based ligand discovery in
          virtual libraries of over 11 billion compounds.</em> Nature 601,
          452-459 (2022).{" "}
          <a
            href="https://doi.org/10.1038/s41586-021-04220-9"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41586-021-04220-9
          </a>
        </li>
      </ul>
    </>
  );
}
