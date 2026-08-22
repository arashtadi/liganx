/**
 * Post: Kinase selectivity metrics and what docking can say about off-targets
 *
 * SEO target: "kinase selectivity score", "S-score kinase", "Gini coefficient
 * kinase inhibitor", "off-target kinase docking". Internal CTA into /studio
 * for anti-target panel docking.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "kinase-selectivity-scores-off-target-docking",
  title: "Kinase selectivity: S-scores, Gini, and what docking can add",
  description:
    "How selectivity is actually measured across the kinome, why sequence similarity is a poor guide to cross-reactivity, and where structure-based screening helps.",
  date: "2026-08-03",
  author: "Liganx team",
  tags: ["selectivity", "kinome", "docking", "off-targets"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Potency is the easy half of a kinase program. There are roughly 518
        human protein kinases, they all bind the same cofactor, and the
        adenine-recognition machinery at the hinge is close to universal.
        Any ATP-competitive compound you design is, by default, a
        promiscuous compound until proven otherwise. The interesting
        question is never &ldquo;how hard does it hit the target&rdquo; but
        &ldquo;what else does it hit at the concentration that hits the
        target.&rdquo;
      </p>

      <h2>The two datasets that set the baseline</h2>
      <p>
        Davis and colleagues tested 72 kinase inhibitors against 442
        kinases, covering more than 80% of the human catalytic protein
        kinome. Two findings from that paper have stuck. First, as a
        class, type II inhibitors (the DFG-out binders that reach into the
        allosteric back pocket) are more selective than type I inhibitors,
        though with important individual exceptions. Second, they
        identified a distinct behaviour they called{" "}
        <strong>group selectivity</strong>: compounds broadly active
        across one kinase subfamily but clean outside it. Group-selective
        is a perfectly respectable design goal, and it is invisible if you
        only report a single scalar selectivity number.
      </p>
      <p>
        Klaeger and colleagues came at it from the proteomics side,
        profiling 243 clinically evaluated kinase drugs with kinobeads
        against native cell lysate. Because the assay reads whatever
        binds, not a predefined panel, it surfaced non-kinase off-targets
        as well as unexpected kinase targets for established drugs. The
        translational payoff in that paper included repurposing
        cabozantinib against FLT3-ITD-positive AML on the basis of a
        target it was not designed for. Polypharmacology is not always a
        liability; sometimes it is the mechanism.
      </p>

      <h2>The metrics, and what each one hides</h2>
      <ul>
        <li>
          <strong>S-score</strong> (Davis and colleagues) — the number of
          kinases inhibited above a threshold divided by the number
          tested, written as S(50%), S(35%), S(10 nM) and so on. Simple,
          widely reported, and completely dependent on where you put the
          threshold and which kinases went into the panel.
        </li>
        <li>
          <strong>Gini coefficient</strong> (Graczyk) — borrowed from
          economics, applied to the distribution of percent inhibition
          across a panel. Non-selective compounds sit near zero;
          staurosporine came in at 0.150. Highly selective compounds
          approach one; the MEK inhibitor PD184352 scored 0.905. A useful
          property is that relative selectivity by Gini does not depend on
          the ATP concentration used in the assay, which is not true of
          raw IC50 ratios.
        </li>
        <li>
          <strong>CATDS</strong> (Klaeger and colleagues) — concentration-
          and target-dependent selectivity, the reduction in binding of
          one target relative to the summed reduction across all detected
          targets. Values near one mean selective, near zero mean
          promiscuous. It has the advantage of being defined at a
          specific, clinically relevant drug concentration rather than in
          the abstract.
        </li>
      </ul>
      <p>
        All three share the same failure mode: they compress a vector into
        a scalar. A compound with a Gini of 0.8 that happens to hit the
        one anti-target that causes your toxicity is worse than a
        compound with a Gini of 0.6 whose off-targets are all
        pharmacologically silent. Report the number, then look at the
        heatmap anyway.
      </p>

      <h2>Sequence similarity is a bad predictor</h2>
      <p>
        The intuitive shortcut is to assume that the kinases most likely
        to be hit are the ones closest to your target on the kinome
        dendrogram. Metz and colleagues built kinome interaction networks
        from pharmacology data rather than sequence, and showed that the
        sequence-derived and activity-derived networks diverge
        substantially. Cross-reactivity tracks the shape and
        electrostatics of the ATP site and the conformational states the
        kinase can access, not the overall fold similarity that drives
        the dendrogram.
      </p>
      <p>
        The practical consequence is that anti-target panels assembled by
        walking outward on the phylogenetic tree miss the off-targets
        that actually matter, and include a lot of close relatives that
        are never touched.
      </p>

      <h2>Where structure-based screening genuinely helps</h2>
      <p>
        Molecular docking is not going to reproduce a 442-kinase panel.
        The scoring functions do not have the resolution to distinguish a
        five-fold selectivity window, and in a cross-docking setting the
        errors compound. What it does well is triage, in a specific and
        limited sense:
      </p>
      <ul>
        <li>
          <strong>Relative, same-ligand comparisons.</strong> Dock one
          compound against your on-target and against a handful of
          anti-target structures with an identical protocol and box
          definition, then compare the deltas. This is the same argument
          that makes mutant-versus-wild-type docking useful: systematic
          errors partially cancel when the ligand is held constant.
        </li>
        <li>
          <strong>Conformational-state matching.</strong> Whether a kinase
          structure is DFG-in or DFG-out dominates the docking result far
          more than the sequence differences between kinases do. If you
          dock a type II compound into a DFG-in anti-target structure you
          will get a meaningless answer. Choose the structures
          deliberately, and consider an ensemble per target rather than a
          single crystal form.
        </li>
        <li>
          <strong>Hypothesis generation for a panel you then buy.</strong>{" "}
          A commercial kinome panel is expensive. A structure-based
          pre-screen that nominates ten anti-targets worth measuring is
          cheap, and being wrong about a few of them costs you very
          little.
        </li>
      </ul>

      <h2>An anti-target shortlist worth docking</h2>
      <p>
        For an oncology kinase program, the off-targets that most often
        turn into clinical problems are reasonably predictable:
        <strong> KDR/VEGFR2</strong> (hypertension, bleeding),{" "}
        <strong>wild-type EGFR</strong> (rash and diarrhoea, the classic
        dose-limiting pair for pan-HER agents),{" "}
        <strong>insulin receptor and IGF1R</strong> (hyperglycaemia), and{" "}
        <strong>the CDK family</strong> (myelosuppression). None of these
        are exotic, and all of them have good public structures. Add hERG
        to the same triage step even though it is not a kinase, because
        the cardiac liability is orthogonal and just as fatal to a
        program.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and run the same ligand against your on-target and two or three
        anti-targets in separate jobs, keeping the search box definition
        and scoring function fixed across all of them. Compare the
        deltas rather than the raw numbers, and treat any anti-target
        that lands within about 1 kcal/mol of the on-target as worth
        measuring in an assay.
      </p>
      <p>
        Liganx puts molecular docking online for free, which makes this
        kind of multi-target comparison a matter of queueing a few jobs
        rather than provisioning a cluster. Molecular docking gives you a
        prioritized list; a kinome panel gives you the answer. Use the
        first to decide what to spend the second on.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Davis MI, Hunt JP, Herrgard S, et al. <em>Comprehensive analysis
          of kinase inhibitor selectivity.</em> Nat Biotechnol 29,
          1046-1051 (2011).{" "}
          <a
            href="https://doi.org/10.1038/nbt.1990"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nbt.1990
          </a>
        </li>
        <li>
          Klaeger S, Heinzlmeir S, Wilhelm M, et al. <em>The target
          landscape of clinical kinase drugs.</em> Science 358, eaan4368
          (2017).{" "}
          <a
            href="https://doi.org/10.1126/science.aan4368"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1126/science.aan4368
          </a>
        </li>
        <li>
          Graczyk PP. <em>Gini coefficient: a new way to express
          selectivity of kinase inhibitors against a family of kinases.</em>{" "}
          J Med Chem 50, 5773-5779 (2007).{" "}
          <a
            href="https://doi.org/10.1021/jm070562u"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/jm070562u
          </a>
        </li>
        <li>
          Metz JT, Johnson EF, Soni NB, et al. <em>Navigating the
          kinome.</em> Nat Chem Biol 7, 200-202 (2011).{" "}
          <a
            href="https://doi.org/10.1038/nchembio.530"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nchembio.530
          </a>
        </li>
      </ul>
    </>
  );
}
