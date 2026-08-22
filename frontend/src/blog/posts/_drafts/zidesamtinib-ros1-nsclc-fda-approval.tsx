/**
 * Post: Zidesamtinib approved for ROS1+ NSCLC after prior TKI
 *
 * SEO target: "zidesamtinib", "Jideytro", "NVL-520", "ROS1 selective
 * inhibitor", "ROS1 G2032R drug", "next generation ROS1 TKI". News/clinical
 * commentary on the July 22, 2026 FDA approval. Internal CTA into /studio to
 * dock against ROS1 with the G2032R resistance mutation applied.
 *
 * Theme: news / clinical.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "zidesamtinib-ros1-nsclc-fda-approval",
  title: "Zidesamtinib approved for ROS1+ lung cancer after prior TKI",
  description:
    "The FDA cleared zidesamtinib (Jideytro) on July 22, 2026 for pretreated ROS1-positive NSCLC. A brain-penetrant, TRK-sparing macrocycle built to survive G2032R.",
  date: "2026-07-23",
  author: "Liganx team",
  tags: ["ros1", "resistance-mutation", "nsclc", "kinase-inhibitors"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        On July 22, 2026 the FDA approved zidesamtinib (brand name Jideytro,
        formerly NVL-520) for adults with locally advanced or metastatic
        ROS1-positive non-small cell lung cancer who have already progressed on
        a prior ROS1 tyrosine kinase inhibitor. It is the newest entry in a
        target that has now cycled through three generations of drugs, and it
        was designed from the crystal structure outward to fix the two problems
        that keep ending ROS1 therapy: the solvent-front resistance mutation
        G2032R, and disease that escapes into the brain.
      </p>

      <h2>Why ROS1 keeps needing new drugs</h2>
      <p>
        ROS1 fusions drive roughly 1-2% of NSCLC. The first-generation
        inhibitors crizotinib and entrectinib work well at first, but relapse is
        the rule, and the single most common reason is G2032R: a glycine-to-
        arginine swap at the rim of the ATP pocket where the site opens out to
        solvent. The bulky, positively charged arginine collides with the part
        of the drug that reaches toward that rim, and the inhibitor can no longer
        seat. Repotrectinib and taletrectinib, the second wave, were drawn
        smaller and more compact specifically to tuck inside the pocket without
        protruding into the arginine. They cover G2032R, but real-world use
        keeps surfacing patients who progress on them too, often with brain
        metastases where prior drugs never reached high enough concentrations.
      </p>

      <h2>What makes zidesamtinib different</h2>
      <p>
        Zidesamtinib is a macrocyclic, ROS1-selective, brain-penetrant, and
        deliberately TRK-sparing inhibitor. That last property matters: many
        earlier ROS1 drugs also hit the structurally related TRK kinases
        (NTRK1/2/3), and off-target TRK inhibition drives the dizziness,
        weight gain, and withdrawal-related CNS effects that limit tolerability.
        By threading the needle to bind ROS1 while clashing with the TRK
        pocket, zidesamtinib was engineered to keep the on-target potency and
        drop the off-target burden.
      </p>
      <p>
        The selectivity story is grounded in structure. A published 2.2 Angstrom
        cocrystal of zidesamtinib bound to ROS1 G2032R shows the compound
        accommodating the mutated arginine rather than fighting it, while the
        same shape would clash in the TRK binding site. This is exactly the kind
        of design logic that a docking pose makes visible: the drug is not just
        potent, it is potent because of a specific geometric fit around the
        residue that breaks its predecessors.
      </p>

      <h2>The ARROS-1 data behind the label</h2>
      <p>
        Approval rests on ARROS-1 (NCT05118789), a global phase 1/2 single-arm
        study in heavily pretreated ROS1-positive solid tumors. Key results at
        the 100 mg once-daily recommended phase 2 dose:
      </p>
      <ul>
        <li>
          <strong>TKI-pretreated NSCLC</strong> — objective response rate 44%
          (95% CI 34-53) across 117 patients who had already failed at least one
          ROS1 TKI.
        </li>
        <li>
          <strong>G2032R-mutant disease</strong> — ORR 54% (95% CI 33-73) in the
          26-patient subgroup, with responses lasting at least 6 months in 79%
          and at least 12 months in 60% of responders. This is the population
          that defines the unmet need, and it responded better than the overall
          pretreated group.
        </li>
        <li>
          <strong>Intracranial activity</strong> — among patients with
          measurable brain metastases and two or more prior ROS1 TKIs, the
          intracranial ORR was 57%, with no intracranial progression observed in
          responders during follow-up. The brain penetration is not a
          theoretical claim; it shows up in the imaging.
        </li>
      </ul>
      <p>
        The approval also landed nearly two months ahead of the drug's
        September 18, 2026 PDUFA target date, a sign the review ran smoothly on a
        clean single-arm package in a well-defined, biomarker-selected
        population.
      </p>

      <h2>Where zidesamtinib sits in the sequence</h2>
      <p>
        The ROS1 story now rhymes closely with ALK and BCR-ABL: a potent but
        solvent-front-fragile first generation, a more compact second generation
        that reclaims G2032R, and now a purpose-built selective agent aimed at
        patients who have exhausted the earlier options and whose disease has
        often moved into the CNS. The next question is the mutation past this
        one. For ROS1 that pressure point is L2086F, a substitution deeper in
        the kinase core that can blunt even the compact macrocycles, and where
        the emerging idea is a type-switch to a type-II binder such as
        cabozantinib. "Next-generation" is always relative to a specific
        residue, never absolute.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The reason zidesamtinib survives G2032R while crizotinib does not is
        geometric, and a pose makes it obvious in a way a sequence never will.
      </p>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick ROS1 with the G2032R mutation, then dock crizotinib against the
        mutant and compare it to a compact macrocyclic binder in the same
        pocket. With molecular docking you can watch the arginine side chain
        crowd the crizotinib solvent-front substituent while the more compact
        scaffold stays clear of it. Running this kind of molecular docking online
        - wild-type versus mutant, defeated drug versus surviving one - is the
        fastest way to build intuition for why the newest ROS1 inhibitor keeps
        working where the first one stopped.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Nuvalent, Inc. <em>Jideytro (zidesamtinib) approved in the US for
          previously treated ROS1-positive non-small cell lung cancer.</em>{" "}
          Press release (July 22, 2026).{" "}
          <a
            href="https://www.prnewswire.com/news-releases/jideytro-zidesamtinib-approved-in-the-us-for-previously-treated-ros1-positive-non-small-cell-lung-cancer-302832452.html"
            target="_blank"
            rel="noreferrer noopener"
          >
            prnewswire.com
          </a>
        </li>
        <li>
          Tangpeerachaikul A, et al. <em>Zidesamtinib selective targeting of
          diverse ROS1 drug-resistant mutations.</em> Mol Cancer Ther 24,
          1005-1019 (2025).{" "}
          <a
            href="https://doi.org/10.1158/1535-7163.MCT-25-0025"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/1535-7163.MCT-25-0025
          </a>
        </li>
        <li>
          Drilon A, et al. <em>Phase I/II ARROS-1 study of zidesamtinib
          (NVL-520) in ROS1 fusion-positive solid tumours.</em> Ann Oncol 35,
          S802 (2024), abstract 1256MO. ClinicalTrials.gov{" "}
          <a
            href="https://clinicaltrials.gov/study/NCT05118789"
            target="_blank"
            rel="noreferrer noopener"
          >
            NCT05118789
          </a>
        </li>
      </ul>
    </>
  );
}
