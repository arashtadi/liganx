/**
 * Post: FLT3 in AML — ITD, TKD, and the type-I vs type-II resistance pivot
 *
 * SEO target: "FLT3 inhibitor resistance", "gilteritinib vs quizartinib",
 * "FLT3 D835Y mutation", "FLT3-ITD AML". Internal CTA into /studio with
 * FLT3 + D835Y / F691L pre-loaded so a reader can dock against the
 * canonical resistance mutants in two clicks.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "flt3-itd-d835y-aml-resistance",
  title: "FLT3 in AML: ITD, D835Y, and the type-I vs type-II pivot",
  description:
    "Why quizartinib works on FLT3-ITD but fails on D835Y, why gilteritinib doesn't, and what the F691L gatekeeper means for the next generation of FLT3 inhibitors.",
  date: "2026-05-13",
  author: "Liganx team",
  tags: ["flt3", "aml", "oncology", "resistance"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        FLT3 is the most frequently mutated kinase in acute myeloid leukemia,
        and the resistance story splits cleanly along a structural fault line:
        type-I inhibitors hold their potency through the TKD activation-loop
        mutations, type-II inhibitors do not. The same fault line that explains
        why quizartinib lost to D835Y in QuANTUM-R is what makes gilteritinib
        the salvage option after a type-II failure. Worth walking through,
        because most readers will hit this same decision point in their own
        program eventually.
      </p>

      <h2>Two mutation classes, very different drugs</h2>
      <p>
        Roughly a third of newly diagnosed AML patients carry an activating
        FLT3 mutation. They fall into two structurally distinct buckets:
      </p>
      <ul>
        <li>
          <strong>FLT3-ITD</strong> (internal tandem duplication, ~25% of AML)
          — an in-frame duplication of 3-400 base pairs in the juxtamembrane
          domain that destabilizes the autoinhibitory conformation. The kinase
          gets stuck signaling. Carries an independently poor prognosis when
          the allelic ratio is high.
        </li>
        <li>
          <strong>FLT3-TKD</strong> (point mutations in the tyrosine-kinase
          domain, ~7% of AML) — most often at D835 in the activation loop
          (D835Y, D835V, D835H), occasionally I836del. These also lock the
          kinase in the active conformation, but through a different
          structural route.
        </li>
      </ul>
      <p>
        That structural distinction is what the inhibitor classes hinge on.
        <strong> Type-I inhibitors</strong> bind the active (DFG-in)
        conformation. They&rsquo;re indifferent to whether the activation loop
        is held open by ITD or by a D835 substitution — both look like
        &ldquo;active&rdquo; to a type-I binder. <strong>Type-II inhibitors</strong>
        bind the inactive (DFG-out) conformation, accessing an extra
        hydrophobic pocket only available when the activation loop folds
        back. D835 mutations destabilize the DFG-out state, so type-II
        compounds lose grip.
      </p>

      <h2>The three approved drugs and where they live on this map</h2>
      <ul>
        <li>
          <strong>Midostaurin (Rydapt)</strong> — FDA approved April 2017
          based on RATIFY (Stone et al., NEJM 2017). Type-I, multi-kinase.
          Used with 7+3 induction and consolidation for newly diagnosed
          FLT3-mutant AML, not for relapsed/refractory monotherapy.
          Improved 4-year overall survival from 44% to 51%.
        </li>
        <li>
          <strong>Quizartinib (Vanflyta)</strong> — FDA approved July 2023
          for newly diagnosed FLT3-ITD AML based on QuANTUM-First (Erba et
          al., Lancet 2023). Type-II, highly selective for FLT3. Median
          OS 31.9 vs 15.1 months with chemotherapy alone. The label is
          ITD-specific: D835Y patients were excluded from QuANTUM-First
          because the in vitro data already showed quizartinib loses
          potency against TKD mutants.
        </li>
        <li>
          <strong>Gilteritinib (Xospata)</strong> — FDA approved November
          2018 for relapsed/refractory FLT3-mutant AML based on ADMIRAL
          (Perl et al., NEJM 2019). Type-I, selective for FLT3 and AXL.
          Median OS 9.3 vs 5.6 months on salvage chemotherapy. Active
          against both ITD and D835Y because type-I doesn&rsquo;t need
          the DFG-out pocket.
        </li>
      </ul>

      <h2>How resistance actually unfolds in practice</h2>
      <p>
        Smith et al. (Nature 2012) showed it before quizartinib was even
        approved: pick a type-II FLT3 inhibitor, treat ITD-positive AML,
        and the on-treatment relapse clones come back enriched for D835Y,
        D835V, and F691L. The patterns recur whenever a type-II drug
        applies selection pressure:
      </p>
      <ul>
        <li>
          <strong>D835Y / D835V (activation-loop)</strong> — the canonical
          escape from type-II compounds. The aspartate-to-tyrosine or
          -valine swap destabilizes DFG-out, the conformational state
          the drug needs. Sensitivity to type-I drugs is preserved,
          which is the rationale for sequencing gilteritinib after a
          type-II failure.
        </li>
        <li>
          <strong>F691L (gatekeeper)</strong> — the FLT3 analog of ABL T315I
          and EGFR T790M. A bulky leucine in the gatekeeper position
          sterically clashes with most ATP-pocket binders, including
          both quizartinib <em>and</em> gilteritinib. Rare in absolute terms
          but the most common pan-resistance signal when it appears.
        </li>
        <li>
          <strong>Off-target bypass</strong> — RAS pathway activations
          (NRAS, KRAS, PTPN11), AXL upregulation, BCR-ABL-like signatures.
          The clones that pick up bypass mutations don&rsquo;t care which
          FLT3 inhibitor you switch to.
        </li>
      </ul>

      <h2>Where the next generation is heading</h2>
      <p>
        The unmet need is a drug that covers ITD, D835Y, <em>and</em> F691L
        simultaneously. Three threads matter:
      </p>
      <ul>
        <li>
          <strong>Next-gen type-I inhibitors with F691L coverage.</strong>
          Crenolanib remains in late-stage trials and retains activity
          against F691L in vitro. Newer chemotypes (FF-10101 / luxeptinib)
          are designed to make a covalent bond with Cys828 in the ATP
          pocket, intentionally bypassing the gatekeeper-clash problem.
        </li>
        <li>
          <strong>Combinations with venetoclax.</strong> The BCL-2 inhibitor
          shifts the FLT3-AML cell to depend more on the apoptotic threshold
          and less on FLT3 signaling alone. Several trials (e.g. quizartinib
          plus venetoclax plus decitabine) have shown durable composite
          remissions in older patients who would not tolerate intensive
          chemo.
        </li>
        <li>
          <strong>FLT3 degraders.</strong> Early-stage PROTACs targeting FLT3
          (e.g. ARV-FLT3-class molecules in preclinical reports) follow the
          same logic as the KRAS and EGFR degrader programs: a target that
          gets degraded can&rsquo;t escape via second-site mutation in the
          binding pocket.
        </li>
      </ul>

      <h2>What this looks like in a docking workflow</h2>
      <p>
        The clean signature you want to see when validating a docking setup
        against FLT3: a type-II benchmark like quizartinib should score a
        couple kcal/mol worse against D835Y than against ITD, while a type-I
        like gilteritinib should look roughly flat across the two. That ΔΔ
        is the structural rationale the clinic ratified. F691L should
        degrade both, because the gatekeeper bulk reaches into the ATP pocket
        regardless of DFG state.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick FLT3 from the target catalog. The mutation chips include
        D835Y and F691L. Dock quizartinib and gilteritinib side-by-side
        against wild-type, D835Y, and F691L — you should see quizartinib
        degrade on D835Y while gilteritinib holds, and both compounds
        degrade on F691L. The ΔΔ between WT and D835Y is the type-II
        resistance signal that drove QuANTUM-R&rsquo;s exclusion criteria
        before it ever drove a clinical relapse.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, no
        install. It is a fast way to put molecular docking on the type-I
        versus type-II FLT3 question and watch quizartinib and
        gilteritinib diverge across D835Y and F691L.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Stone RM, et al. <em>Midostaurin plus chemotherapy for acute
          myeloid leukemia with a FLT3 mutation.</em> NEJM 377, 454-464
          (2017).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1614359"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1614359
          </a>
        </li>
        <li>
          Perl AE, et al. <em>Gilteritinib or chemotherapy for relapsed or
          refractory FLT3-mutated AML.</em> NEJM 381, 1728-1740 (2019).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1902688"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1902688
          </a>
        </li>
        <li>
          Erba HP, et al. <em>Quizartinib plus chemotherapy in newly
          diagnosed patients with FLT3-internal-tandem-duplication-positive
          acute myeloid leukaemia (QuANTUM-First): a randomised, double-blind,
          placebo-controlled, phase 3 trial.</em> Lancet 401, 1571-1583
          (2023).{" "}
          <a
            href="https://doi.org/10.1016/S0140-6736(23)00464-6"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/S0140-6736(23)00464-6
          </a>
        </li>
        <li>
          Smith CC, et al. <em>Validation of ITD mutations in FLT3 as a
          therapeutic target in human acute myeloid leukaemia.</em> Nature
          485, 260-263 (2012).{" "}
          <a
            href="https://doi.org/10.1038/nature11016"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nature11016
          </a>
        </li>
      </ul>
    </>
  );
}
