import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "btk-degraders-cll-bexobrutideg-bgb16673",
  title: "BTK degraders: what happens after the inhibitors run out",
  description:
    "Bexobrutideg and BGB-16673 are protein degraders that remove BTK instead of blocking it, keeping CLL responses going after covalent and reversible inhibitors both fail.",
  date: "2026-07-08",
  author: "Liganx team",
  tags: ["btk", "cll", "protac", "resistance", "targeted-degradation"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        For fifteen years the story of BTK in chronic lymphocytic leukemia has
        been a story of occupancy: how tightly can you hold the ATP pocket, and
        for how long. Covalent inhibitors bond to Cys481. Reversible inhibitors
        hold on without it. But both strategies share a fatal assumption &mdash;
        that the protein is still there to be blocked. BTK degraders throw that
        assumption out. Instead of occupying the enzyme, they delete it.
      </p>

      <h2>The resistance ladder that led here</h2>
      <p>
        The clinical problem is well mapped. Covalent BTK inhibitors like
        ibrutinib and acalabrutinib bind Cys481 in the ATP pocket. The classic
        escape is the <strong>C481S</strong> mutation, which swaps the reactive
        cysteine for a serine and abolishes covalent bonding. Pirtobrutinib, a
        non-covalent inhibitor, was designed to sidestep exactly that &mdash; it
        does not need Cys481. But patients then relapse on pirtobrutinib through
        a new set of mutations, including <strong>T474</strong> gatekeeper
        substitutions and the kinase-impaired <strong>L528W</strong>, which
        blunt both covalent and non-covalent binding at once. When a tumor has
        stacked several of these, the ATP pocket is no longer a reliable place
        to attack.
      </p>
      <p>
        Degraders change the target of the attack. They still have to bind BTK,
        but they only need to touch it long enough to tag it, not to inhibit it.
        A binding event that would be too weak or too transient to shut down
        signaling is enough to mark the protein for destruction, and because the
        cell then has to resynthesize BTK from scratch, catalytic-site mutations
        that rescue enzyme activity do not rescue the protein from the
        proteasome.
      </p>

      <h2>How the molecules work</h2>
      <p>
        Both leading candidates are oral small-molecule degraders built on the
        cereblon E3 ligase. Structurally they are chimeras: one end binds BTK,
        the other recruits cereblon, and the linker holds the two proteins close
        enough that cereblon&rsquo;s ubiquitin machinery decorates BTK with a
        polyubiquitin chain. The tagged BTK is then fed into the proteasome and
        chewed up. The degrader itself is released intact and goes on to tag the
        next BTK molecule, so it works catalytically rather than
        stoichiometrically.
      </p>
      <ul>
        <li>
          <strong>Bexobrutideg (NX-5948)</strong> &mdash; Nurix&rsquo;s oral BTK
          degrader. It removes both wild-type and mutant BTK, including
          resistance variants, and notably crosses into the CNS, which matters
          for the subset of CLL patients with central nervous system
          involvement. It holds FDA fast track designation in relapsed/refractory
          CLL.
        </li>
        <li>
          <strong>BGB-16673</strong> &mdash; BeiGene&rsquo;s oral BTK degrader
          (a chimeric degradation activating compound), studied in the
          CaDAnCe-101 program across CLL/SLL, Richter transformation, and
          Waldenstrom macroglobulinemia. It also carries FDA fast track
          designation in relapsed/refractory CLL.
        </li>
      </ul>

      <h2>What the Phase 1 data actually show</h2>
      <p>
        Both programs read out updated Phase 1 results at ASH 2025, and the
        headline is that these are heavily pretreated populations that had
        already exhausted the standard options.
      </p>
      <ul>
        <li>
          In the bexobrutideg Phase 1a/1b CLL/SLL cohorts, patients had received
          a median of four prior lines of therapy, and the great majority had
          already progressed on both a covalent BTK inhibitor and a BCL-2
          inhibitor (venetoclax). Overall response rates in the high-70s percent
          were reported, with a median time to response around two months, and
          the drug was generally well tolerated across the dose range.
        </li>
        <li>
          In the BGB-16673 CaDAnCe-101 CLL/SLL cohort, responses were reported in
          roughly 8 of 10 evaluable patients, including patients with high-risk
          genetics and prior BTK-inhibitor resistance. As expected for this
          population, grade 3 or higher treatment-emergent adverse events were
          common, with neutropenia, fatigue, bruising, and diarrhea among the
          frequent events.
        </li>
      </ul>
      <p>
        Cross-trial percentages should be read loosely &mdash; these are
        single-arm early-phase cohorts with different eligibility and response
        assessment, not head-to-head comparisons. The signal that matters is
        qualitative: durable responses in patients who have already failed both
        the covalent and reversible inhibitor classes, which is precisely the
        population that had no good targeted option left. Pivotal trials for both
        degraders are underway, so these remain investigational, not approved.
      </p>

      <h2>Why the mechanism resists resistance</h2>
      <p>
        The elegant part is that degradation decouples potency from the exact
        geometry of the binding event. An inhibitor has to hold the pocket in a
        way that stops catalysis; a single well-placed mutation can break that.
        A degrader only has to form a ternary complex productive enough for
        ubiquitin transfer, which tolerates a much looser and more transient
        interaction. That is why degraders keep working against C481S, and why
        they retain activity against the pirtobrutinib-resistant mutations that
        defeat non-covalent inhibitors. The obvious next question &mdash; whether
        tumors will evolve resistance at the cereblon or ubiquitin-transfer step
        instead of at BTK &mdash; is exactly what the ongoing expansion cohorts
        will answer.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        Degrader design is a ternary-complex problem, but it still starts with
        the BTK-binding warhead, and that is something you can model directly.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock against BTK carrying the C481S, T474, or L528W resistance
        mutations to see how the ATP pocket reshapes under each substitution.
        Comparing the pose and the interaction fingerprint across wild-type and
        mutant BTK is the fastest way to build intuition for why occupancy-based
        inhibitors fail where a degradation warhead can still make contact.
        Running molecular docking online against the mutant structures side by
        side is the cheapest way to see the pocket the degrader has to grab.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Sharman JP, et al. <em>Bexobrutideg (NX-5948), a novel BTK degrader,
          demonstrates rapid and durable clinical responses in
          relapsed/refractory CLL: updated findings from an ongoing Phase 1a/b
          trial.</em> Blood 146 (Supplement 1), 86 (2025).{" "}
          <a
            href="https://ashpublications.org/blood/article/146/Supplement%201/86/549702/"
            target="_blank"
            rel="noreferrer noopener"
          >
            ASH 2025 abstract 86
          </a>
        </li>
        <li>
          Ahn IE, et al. <em>Updated efficacy and safety results of the BTK
          degrader BGB-16673 in patients with relapsed/refractory CLL/SLL from
          the ongoing phase 1 CaDAnCe-101 study.</em> Blood 146 (Supplement 1),
          85 (2025).{" "}
          <a
            href="https://ashpublications.org/blood/article/146/Supplement%201/85/548770/"
            target="_blank"
            rel="noreferrer noopener"
          >
            ASH 2025 abstract 85
          </a>
        </li>
        <li>
          <em>BTK Is the Target That Keeps on Giving: A Review of BTK-Degrader
          Drug Development, Clinical Data, and Future Directions in CLL.</em>{" "}
          <a
            href="https://pmc.ncbi.nlm.nih.gov/articles/PMC11817010/"
            target="_blank"
            rel="noreferrer noopener"
          >
            PMC11817010
          </a>
        </li>
      </ul>
    </>
  );
}
