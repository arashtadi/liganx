/**
 * Post: Why ΔΔ beats absolute docking scores
 *
 * SEO target: "docking score reliability", "relative binding free energy",
 * "delta delta G docking", "wild-type vs mutant docking", "scoring function
 * accuracy". Methodology explainer. Internal CTA into /studio to run the
 * wild-type-versus-mutant comparison the post argues for.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "ddg-vs-absolute-docking-scores",
  title: "Why ΔΔ beats absolute docking scores",
  description:
    "Docking scores are bad at predicting binding affinity but good at ranking. Here is why the wild-type-minus-mutant difference is the number you should trust.",
  date: "2026-05-24",
  author: "Liganx team",
  tags: ["methodology", "docking", "scoring-functions", "free-energy"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        A docking score looks like an affinity. It comes back as a number in
        kcal/mol, it has a minus sign, and a more negative one feels like a
        tighter binder. That intuition is the single most common way to misread
        a docking run. Scoring functions are mediocre at predicting absolute
        binding free energy and much better at ranking related things against
        each other. The practical consequence: the number worth trusting is
        rarely a single score &mdash; it is the <strong>difference</strong>
        between two scores computed the same way.
      </p>

      <h2>Why absolute scores are unreliable</h2>
      <p>
        A docking score is a fast approximation of binding free energy, and the
        approximations are aggressive. Most scoring functions treat the receptor
        as rigid or nearly so, model solvent only implicitly or not at all, and
        ignore or crudely estimate the entropic cost of freezing a flexible
        ligand into one pose. Each of those shortcuts introduces error, and the
        errors do not cancel cleanly across chemically different molecules.
      </p>
      <p>
        The field has measured this directly. Warren et al. (2006) ran ten
        docking programs and 37 scoring functions across eight protein targets
        and found that while docking could often place a ligand in roughly the
        right pose, no scoring function reliably predicted binding affinity
        &mdash; the correlation between score and measured potency was weak and
        target-dependent. Twenty years of subsequent work has improved the
        details without overturning the headline: <em>scoring functions are not
        affinity meters.</em> Reading an absolute docking score as a predicted
        K<sub>d</sub> is the mistake the literature has been warning about since
        before most of today&rsquo;s tools existed.
      </p>

      <h2>What cancels when you take a difference</h2>
      <p>
        Here is the useful part. Many of those systematic errors are shared
        between two closely related calculations, so they subtract out when you
        compare. If you dock the same ligand against a wild-type receptor and a
        point-mutant of that receptor, the parts of the score that come from the
        ligand&rsquo;s own internal energy, its desolvation, and the bulk of the
        unchanged pocket are nearly identical in both runs. What is left in the
        difference is dominated by the one thing that actually changed: the
        mutated residue and its local contacts.
      </p>
      <p>
        That difference is a <strong>ΔΔ</strong> &mdash; a change in a change.
        It approximates how much the mutation shifts the binding free energy of
        that ligand, and it is far more robust than either absolute number,
        because the noise floor partly cancels. This is the same logic that
        makes rigorous relative binding free energy (RBFE) methods the gold
        standard for lead optimization: Wang et al. (2015) showed that modern
        free-energy perturbation, which computes the ΔΔG between two ligands
        rather than two absolute values, predicted relative potency within about
        1 kcal/mol across thousands of compounds &mdash; accuracy that no
        absolute docking score approaches. Docking ΔΔ is the cheap, fast cousin
        of that idea: less rigorous, but built on the same cancellation
        principle.
      </p>

      <h2>The two comparisons worth making</h2>
      <ul>
        <li>
          <strong>Wild-type vs mutant, one ligand.</strong> Does this drug lose
          grip on the resistance mutant? A large positive ΔΔ (the mutant scores
          worse) is the structural signature of resistance &mdash; it is what
          you see when you dock a first-generation inhibitor against a gatekeeper
          or solvent-front mutation.
        </li>
        <li>
          <strong>Two ligands, same receptor.</strong> Which of my two analogs
          binds the mutant better? Rank them by their scores against the same
          structure; trust the ordering far more than the magnitudes.
        </li>
      </ul>
      <p>
        In both cases you are asking a relative question and answering it with a
        relative quantity. The moment you start quoting a single score as if it
        were a measured affinity, you have left the regime where the method is
        trustworthy.
      </p>

      <h2>Caveats that keep ΔΔ honest</h2>
      <p>
        Cancellation is not magic. It works best when the two calculations are
        as similar as possible: same protonation states, same docking protocol,
        same box, poses that occupy the same sub-pocket. If a mutation triggers
        a real backbone rearrangement rather than a simple side-chain swap, a
        rigid-receptor ΔΔ will miss it &mdash; the assumption that &ldquo;only
        the mutated residue changed&rdquo; breaks. And a ΔΔ near zero is genuinely
        ambiguous: it can mean no effect, or it can mean two larger errors that
        happened not to cancel. Treat small differences as noise and large,
        reproducible ones as signal.
      </p>

      <h2>Try the comparison yourself</h2>
      <p>
        This is exactly what Liganx is built around.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick any target from the catalog along with a clinically important
        mutation &mdash; EGFR with T790M, BCR-ABL with T315I, ALK with G1202R.
        Dock the same ligand against the wild-type and mutant receptors in one
        run, and read the <strong>ΔΔ</strong> Liganx reports between them rather
        than fixating on either absolute score. A drug that holds its number
        against the mutant is one the mutation does not defeat; a drug that loses
        a kcal/mol or two is showing you the resistance mechanism directly.
      </p>
      <p>
        Liganx is molecular docking online: a free, browser-based platform that
        runs the wild-type and mutant side by side so the ΔΔ is the first thing
        you see. Using molecular docking this way &mdash; as a difference engine
        rather than an affinity meter &mdash; is how you get reliable answers out
        of an unreliable score.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Warren GL, et al. <em>A Critical Assessment of Docking Programs and
          Scoring Functions.</em> J Med Chem 49, 5912&ndash;5931 (2006).{" "}
          <a
            href="https://doi.org/10.1021/jm050362n"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/jm050362n
          </a>
        </li>
        <li>
          Wang L, et al. <em>Accurate and Reliable Prediction of Relative Ligand
          Binding Potency in Prospective Drug Discovery by Way of a Modern
          Free-Energy Calculation Protocol and Force Field.</em> J Am Chem Soc
          137, 2695&ndash;2703 (2015).{" "}
          <a
            href="https://doi.org/10.1021/ja512751q"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/ja512751q
          </a>
        </li>
        <li>
          Cournia Z, Allen B, Sherman W. <em>Relative Binding Free Energy
          Calculations in Drug Discovery: Recent Advances and Practical
          Considerations.</em> J Chem Inf Model 57, 2911&ndash;2937 (2017).{" "}
          <a
            href="https://doi.org/10.1021/acs.jcim.7b00564"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jcim.7b00564
          </a>
        </li>
      </ul>
    </>
  );
}
