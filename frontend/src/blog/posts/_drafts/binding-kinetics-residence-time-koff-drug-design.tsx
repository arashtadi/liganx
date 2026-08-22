/**
 * Post: Binding kinetics and residence time (koff) — what docking scores
 * don't tell you.
 *
 * SEO target: "drug-target residence time", "koff kinase inhibitor",
 * "binding kinetics drug design", "docking scores vs residence time".
 * Methodology explainer. Internal CTA into /studio via the honest
 * limitation angle: docking gives a thermodynamic snapshot, not kinetics.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "binding-kinetics-residence-time-koff-drug-design",
  title: "Residence time and koff: what your docking score can't tell you",
  description:
    "Two EGFR inhibitors with similar affinity can differ 150-fold in how long they stay bound. Here's why residence time matters and why static docking can't see it.",
  date: "2026-08-11",
  author: "Liganx team",
  tags: ["binding-kinetics", "residence-time", "docking-methodology", "koff"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        A docking score, an IC50, a &Delta;G of binding &mdash; all of these
        describe a thermodynamic endpoint: how much more stable the
        bound state is than the unbound state. None of them say anything
        about how the complex got there or how long it stays formed once
        it does. That second question, governed by the association and
        dissociation rate constants k<sub>on</sub> and k<sub>off</sub>,
        turns out to matter a great deal for how a drug behaves in a
        patient, and it is invisible to a standard docking run.
      </p>

      <h2>Affinity and residence time are not the same number</h2>
      <p>
        Binding affinity (K<sub>D</sub>) is a ratio: k<sub>off</sub> /
        k<sub>on</sub>. Two compounds can have identical K<sub>D</sub> while
        arriving at it through completely different kinetics &mdash; one
        binding fast and leaving fast, the other binding slowly and leaving
        slowly. Residence time, t<sub>R</sub> = 1/k<sub>off</sub>, isolates
        the second half of that ratio and asks a more clinically relevant
        question: once the drug is on the target, how long does it stay
        there, independent of whatever the free plasma concentration is
        doing in the meantime.
      </p>
      <p>
        That independence is the whole point. Plasma drug levels rise after
        a dose and fall as the drug clears. A short-residence-time inhibitor
        needs the free concentration to stay above some threshold to keep
        the target occupied; once levels dip, target engagement follows
        almost immediately. A long-residence-time inhibitor can keep the
        target inhibited well past the point where free drug has largely
        cleared, because dissociation itself is the slow step. Copeland,
        Pompliano and Meek formalized this argument in their influential
        2006 lead-optimization framework, and the field has spent the two
        decades since arguing about how central k<sub>off</sub> should be to
        compound design.
      </p>

      <h2>The gefitinib/lapatinib case</h2>
      <p>
        The cleanest illustration sits inside EGFR itself. Gefitinib and
        lapatinib both inhibit the EGFR kinase domain, but Wood and
        colleagues measured dramatically different off-rates from purified
        intracellular domain: gefitinib dissociates with a half-life on the
        order of a couple of minutes, while lapatinib&rsquo;s off-rate is slow
        enough to correspond to residence times measured in hours. The
        structural reason traces back to the conformational state each
        compound selects. Lapatinib binds an inactive, DFG-out-like EGFR
        conformation that is reached slowly and left slowly, in contrast to
        the more readily accessible active-like state that gefitinib
        occupies. The clinical readout matched the biochemistry: in tumor
        cells, receptor phosphorylation recovered far faster after
        gefitinib washout than after lapatinib washout, exactly as the
        purified-protein off-rates predicted.
      </p>
      <p>
        Neither compound is &ldquo;better&rdquo; in the abstract &mdash;
        gefitinib&rsquo;s faster kinetics arguably make sense for a
        reversible ATP-site inhibitor dosed once daily against a driver
        mutation, while lapatinib&rsquo;s long residence time was
        historically framed as a mechanism for sustaining pathway shutdown
        between doses. The point is that affinity alone would not have told
        you these compounds behave this differently in cells.
      </p>

      <h2>Why a docking pose can't see this</h2>
      <p>
        A docking calculation, even a good one with induced-fit sampling and
        rescoring, evaluates one static geometry (or an ensemble of static
        geometries) and estimates how favorable that bound state is
        relative to the unbound state. It says nothing about the path the
        ligand takes to reach that state, the energy barriers along the way,
        or how deep a kinetic trap the bound conformation represents. Two
        poses can score similarly while sitting behind transition-state
        barriers of very different heights &mdash; and it is that barrier
        height, not the depth of the final well, that sets k<sub>off</sub>.
        This is the same limitation underlying why{" "}
        <Link
          to="/blog/ddg-vs-absolute-docking-scores"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          relative &Delta;&Delta; scores
        </Link>{" "}
        outperform absolute docking scores for ranking: both are reminders
        that a docking score is a thermodynamic estimate at a single
        geometry, not a kinetic or mechanistic prediction.
      </p>
      <p>
        Getting at kinetics computationally means going beyond a single pose
        and simulating (or forcing) the unbinding process itself.
        Metadynamics-based approaches and enhanced-sampling molecular
        dynamics reconstruct the free-energy surface along an unbinding
        coordinate. A more efficient alternative, &tau;-random acceleration
        molecular dynamics (&tau;RAMD), applies a randomly reoriented
        biasing force to pull the ligand out of the pocket across many
        repeated short simulations and uses the distribution of exit times
        to rank compounds by relative residence time; Kokh and colleagues
        validated the approach against 70 ligands of the HSP90&alpha;
        N-terminal domain and it has since been applied to kinase
        chemotypes including FAK and PYK2, where predicted rankings
        correlated well with measured residence times.
      </p>

      <h2>What this means in practice</h2>
      <ul>
        <li>
          <strong>Docking is a filter, not a kinetics predictor.</strong>{" "}
          Use it to ask whether a chemotype fits a pocket and how the
          series ranks thermodynamically. Don&rsquo;t over-read a favorable
          score as a promise about duration of target engagement.
        </li>
        <li>
          <strong>Residence time still needs a wet-lab measurement.</strong>{" "}
          Surface plasmon resonance and related biophysical assays remain
          the standard for measuring k<sub>off</sub> directly; computational
          methods like &tau;RAMD are best used to rank and prioritize
          candidates before committing to those assays, not to replace them.
        </li>
        <li>
          <strong>Structural hypotheses are still worth generating in
          silico.</strong> If two compounds in a series diverge sharply in
          measured residence time, docking against multiple receptor
          conformations can at least suggest whether one is accessing a
          different, more occluded state &mdash; a testable hypothesis, even
          if not a quantitative kinetic prediction.
        </li>
      </ul>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock a small series against both an active-like and an
        inactive-like (DFG-out) conformation of a kinase target. A ligand
        that scores comparably in both states is behaving more like a fast
        ATP-competitive binder; one that only fits well in the inactive
        state is closer to the lapatinib pattern, which is at least a
        structural clue worth following up with a real off-rate assay. Our
        posts on{" "}
        <Link
          to="/blog/induced-fit-docking-receptor-flexibility"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          induced-fit docking
        </Link>{" "}
        and{" "}
        <Link
          to="/blog/dfg-out-type-ii-kinase-inhibitors"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          DFG-out type II inhibitors
        </Link>{" "}
        cover the conformational side of this in more depth. Liganx runs
        molecular docking online and free, so setting up that comparison
        takes a browser tab, not a local install.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Copeland RA, Pompliano DL, Meek TD. <em>Drug&ndash;target residence
          time and its implications for lead optimization.</em> Nat Rev Drug
          Discov 5, 730&ndash;739 (2006).{" "}
          <a href="https://doi.org/10.1038/nrd2082" target="_blank" rel="noreferrer noopener">
            doi:10.1038/nrd2082
          </a>
        </li>
        <li>
          Wood ER, et al. <em>A unique structure for epidermal growth factor
          receptor bound to GW572016 (Lapatinib): relationships among protein
          conformation, inhibitor off-rate, and receptor activity in tumor
          cells.</em> Cancer Res 64, 6652&ndash;6659 (2004).{" "}
          <a href="https://doi.org/10.1158/0008-5472.CAN-04-1168" target="_blank" rel="noreferrer noopener">
            doi:10.1158/0008-5472.CAN-04-1168
          </a>
        </li>
        <li>
          Kokh DB, et al. <em>Estimation of Drug-Target Residence Times by
          &tau;-Random Acceleration Molecular Dynamics Simulations.</em> J
          Chem Theory Comput 14, 3859&ndash;3869 (2018).{" "}
          <a href="https://doi.org/10.1021/acs.jctc.8b00230" target="_blank" rel="noreferrer noopener">
            doi:10.1021/acs.jctc.8b00230
          </a>
        </li>
      </ul>
    </>
  );
}
