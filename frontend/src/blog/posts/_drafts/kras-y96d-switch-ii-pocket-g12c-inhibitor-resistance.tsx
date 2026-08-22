/**
 * Post: KRAS Y96D — the switch-II pocket mutation that unseats sotorasib
 * and adagrasib.
 *
 * SEO target: "KRAS Y96D", "KRAS G12C inhibitor resistance", "switch-II
 * pocket mutation", "RAS ON inhibitor". Internal CTA into /studio to dock
 * against KRAS G12C with the Y96D substitution.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "kras-y96d-switch-ii-pocket-g12c-inhibitor-resistance",
  title: "KRAS Y96D: the mutation that unseats sotorasib and adagrasib",
  description:
    "A single tyrosine-to-aspartate swap in the switch-II pocket erases the key hydrogen bond that anchors covalent KRAS G12C inhibitors. Here is why it matters.",
  date: "2026-07-24",
  author: "Liganx team",
  tags: ["kras", "g12c", "resistance", "mutation"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Sotorasib and adagrasib were the first drugs to make the
        &ldquo;undruggable&rdquo; KRAS oncoprotein yield, and both do it by
        the same trick: they slip into a shallow groove called the switch-II
        pocket and form a covalent bond to the mutant cysteine at position 12.
        The problem is that the pocket they exploit is held open by a handful
        of residues, and tumors have learned to mutate one of them. The
        clinically dominant escape route is Y96D, a tyrosine-to-aspartate
        substitution that quietly deletes the hydrogen bond both drugs depend
        on.
      </p>

      <h2>How the OFF-state inhibitors bind</h2>
      <p>
        KRAS G12C inhibitors are state-selective. They only engage KRAS in its
        inactive, GDP-bound conformation, where the switch-II loop swings away
        to expose a cryptic pocket underneath. Once a compound like sotorasib
        or adagrasib docks into that pocket, its acrylamide warhead reaches
        across to Cys12 and forms an irreversible covalent bond, trapping the
        protein in the OFF state so it can never load GTP and signal.
      </p>
      <p>
        The pocket is not deep, so the affinity comes from a network of small
        interactions rather than one dominant contact. Tyr96 sits at the lip of
        the switch-II pocket and donates a hydrogen bond to the drug, helping
        to clamp the reversible portion of the molecule in place long enough for
        the covalent reaction to occur. Structural modeling by Tanaka and
        colleagues showed that this Tyr96 contact is load-bearing: remove it and
        the reversible dwell time collapses, and the warhead rarely gets its
        shot at Cys12.
      </p>

      <h2>What Y96D does</h2>
      <p>
        Y96D replaces the bulky, hydrogen-bonding tyrosine with a small,
        negatively charged aspartate. Two things happen at once. The hydrogen
        bond to the inhibitor is lost, and the electrostatics and shape of the
        pocket rim change enough to weaken binding further. The mutation is
        subtle from the cell&rsquo;s point of view — KRAS still folds, still
        cycles, still signals — but from the drug&rsquo;s point of view the
        anchor point is gone.
      </p>
      <p>
        The consequences in the lab are stark. Y96D confers strong resistance
        to essentially every OFF-state G12C inhibitor tested:
      </p>
      <ul>
        <li>
          <strong>Adagrasib (Krazati)</strong> — Y96D first emerged in a
          patient on adagrasib, detected in circulating tumor DNA at
          progression alongside a polyclonal spray of other RAS-MAPK
          reactivating alterations. In cell lines it drives high-level
          adagrasib resistance.
        </li>
        <li>
          <strong>Sotorasib (Lumakras)</strong> — the same substitution
          cross-resists sotorasib, because both drugs lean on the Tyr96
          contact even though their scaffolds differ.
        </li>
        <li>
          <strong>ARS-1620</strong> — the tool-compound ancestor of the
          clinical series is also defeated, confirming the mechanism is
          scaffold-agnostic rather than specific to one chemotype.
        </li>
      </ul>

      <h2>Why RAS(ON) inhibitors escape the trap</h2>
      <p>
        The elegant part of the Y96D story is what beats it. RM-018, a
        tricomplex inhibitor that engages the active, GTP-bound RAS(ON) state
        rather than the OFF state, retained activity against Y96D in the same
        experiments. Because it binds a different surface and does not rely on
        the Tyr96 hydrogen bond, the mutation that blinds sotorasib and
        adagrasib is invisible to it. That result helped motivate the whole
        RAS(ON) class now in the clinic, and it is a clean example of why
        understanding the exact contact a mutation breaks tells you which
        next-line chemistry has a chance.
      </p>

      <h2>Y96 is not the only escape residue</h2>
      <p>
        Y96D is the headline, but systematic in vitro mutagenesis has mapped a
        broader switch-II pocket resistance landscape. Koga and colleagues
        catalogued secondary KRAS mutations — including Y96S, Y96C, and
        residues such as R68, H95, and A59 — that confer graded resistance to
        sotorasib and adagrasib, often with different potencies against each
        drug. H95 mutations, for instance, tend to hit adagrasib harder than
        sotorasib because adagrasib reaches deeper into an H95-lined cleft.
        That asymmetry is a reminder that &ldquo;G12C inhibitor resistance&rdquo;
        is not one thing, and that the specific residue matters when you pick
        the follow-on agent.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The fastest way to build intuition for Y96D is to look at the two poses
        side by side. <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">Open Studio</Link>{" "}
        and dock adagrasib or sotorasib into KRAS G12C, then repeat against the
        structure carrying the Y96D substitution. Watch the Tyr96 hydrogen bond
        disappear in the interaction fingerprint and the score fall off. Because
        Liganx is mutation-aware, the switch-II pocket geometry updates with the
        substitution rather than treating the mutant as wild type — which is the
        entire point of running molecular docking on the resistant structure
        rather than the parental one.
      </p>
      <p>
        Liganx brings molecular docking online in the browser, so you can score
        an OFF-state warhead against Y96D and a RAS(ON) scaffold against the
        same mutant without leaving the tab. Using molecular docking to compare
        the two mechanisms on the resistant structure is how you decide which
        chemistry to chase next.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Tanaka N, Lin JJ, Li C, et al. <em>Clinical Acquired Resistance to
          KRAS(G12C) Inhibition through a Novel KRAS Switch-II Pocket Mutation
          and Polyclonal Alterations Converging on RAS-MAPK Reactivation.</em>{" "}
          Cancer Discov 11, 1913-1922 (2021).{" "}
          <a
            href="https://doi.org/10.1158/2159-8290.CD-21-0365"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2159-8290.CD-21-0365
          </a>
        </li>
        <li>
          Awad MM, Liu S, Rybkin II, et al. <em>Acquired Resistance to
          KRAS(G12C) Inhibition in Cancer.</em> N Engl J Med 384, 2382-2393
          (2021).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2105281"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2105281
          </a>
        </li>
        <li>
          Koga T, Suda K, Fujino T, et al. <em>KRAS Secondary Mutations That
          Confer Acquired Resistance to KRAS G12C Inhibitors, Sotorasib and
          Adagrasib, and Overcoming Strategies: Insights From In Vitro
          Experiments.</em> J Thorac Oncol 16, 1321-1332 (2021).{" "}
          <a
            href="https://doi.org/10.1016/j.jtho.2021.04.015"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/j.jtho.2021.04.015
          </a>
        </li>
      </ul>
    </>
  );
}
