/**
 * Post: IDH1 R132H — from oncometabolite to two FDA approvals
 *
 * SEO target: "IDH1 R132H inhibitor", "vorasidenib glioma", "ivosidenib
 * AML", "2-hydroxyglutarate". Internal CTA into /studio with IDH1 +
 * R132H pre-loaded so the reader can see the neomorphic pocket directly.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "idh1-r132h-glioma-aml-vorasidenib",
  title: "IDH1 R132H: one mutation, two diseases, two FDA approvals",
  description:
    "How a gain-of-function arginine-to-histidine swap in IDH1 produces an oncometabolite, drives both glioma and AML, and finally has clean drugs against it.",
  date: "2026-05-12",
  author: "Liganx team",
  tags: ["idh1", "oncology", "glioma", "aml", "mutation"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        IDH1 R132H is the cleanest example in oncology of a gain-of-function
        mutation. The enzyme doesn&rsquo;t just lose its normal activity —
        it picks up a new one, churning out an oncometabolite that
        reprograms the epigenome of the cell. Two FDA-approved inhibitors
        now address it, in two different diseases, with two different
        clinical pictures. The IDH1 story is worth knowing because it&rsquo;s
        what targeted oncology looks like when the biology actually
        cooperates.
      </p>

      <h2>The neomorphic enzyme</h2>
      <p>
        Wild-type IDH1 (isocitrate dehydrogenase 1) sits in the cytoplasm
        and catalyzes the reversible decarboxylation of isocitrate to
        alpha-ketoglutarate (α-KG), reducing NADP+ to NADPH along the way.
        It&rsquo;s a housekeeping redox enzyme, not particularly interesting
        from a drug discovery standpoint.
      </p>
      <p>
        Then in 2008, Parsons et al. sequenced 22 glioblastomas and found
        recurrent point mutations at IDH1 residue 132. By 2009, Dang et al.
        had shown what the mutation actually does. R132H — the dominant
        variant — does not abolish enzyme activity. Instead, it shifts the
        reaction: the mutant enzyme reduces α-KG further, to
        <strong>R-2-hydroxyglutarate (R-2HG)</strong>. The wild-type allele
        is still present and still makes α-KG. The mutant allele dumps
        millimolar concentrations of an enantiomer the cell was never
        designed to handle.
      </p>
      <p>
        R-2HG is the &ldquo;oncometabolite.&rdquo; Structurally it&rsquo;s
        a near-perfect mimic of α-KG, and it competitively inhibits the
        ~70 α-KG-dependent dioxygenases the cell uses for everything from
        HIF prolyl hydroxylation to histone and DNA demethylation. The
        downstream consequences are an epigenetic train wreck:
        hypermethylated CpG islands (the &ldquo;CIMP&rdquo; phenotype in
        glioma), failure of TET-mediated 5-methylcytosine oxidation, and
        a block in cellular differentiation. In gliomas this drives slow
        clonal expansion. In hematopoietic progenitors it produces AML.
      </p>

      <h2>What the mutation does to the pocket</h2>
      <p>
        Arginine 132 sits at the dimer interface, hydrogen-bonded to the
        substrate carboxylate. Substituting in histidine collapses the
        contacts that hold isocitrate in place and opens a new pocket
        — slightly larger, slightly more hydrophobic — that accommodates
        α-KG bound at the position that lets the active site reduce it
        further to R-2HG instead of releasing it. This is the
        druggable feature: a pocket that exists only in the mutant.
        Inhibitors that hit it spare wild-type IDH1 almost entirely, so
        the on-target toxicity envelope is unusually clean for an
        oncology drug. The R132C, R132G, R132L, and R132S variants share
        the same neomorphic activity and are also targetable, though
        with smaller selectivity margins than R132H.
      </p>

      <h2>Ivosidenib (AG-120) — IDH1-mutant AML</h2>
      <p>
        Ivosidenib (Tibsovo, Agios/Servier) was the first IDH1 inhibitor
        approved, in July 2018, for relapsed or refractory IDH1-mutant
        AML. The pivotal phase 1 study (DiNardo et al., NEJM 2018) ran
        the drug as monotherapy in 125 patients. The complete-remission
        rate was 21.6% and the composite CR+CRh rate was 30.4% — modest
        numbers in absolute terms, but transformative in a population
        where the prior standard of care was supportive care plus
        hypomethylating agents. Median duration of response was 9.3
        months. Plasma R-2HG levels dropped by 1-2 orders of magnitude
        within days, and the responding patients showed restoration
        of myeloid differentiation rather than the cytoreduction you&rsquo;d
        expect from conventional chemotherapy. The signature toxicity
        is <em>differentiation syndrome</em> — fever, hypoxia, effusions
        — driven by the same mechanism that drives the response.
      </p>
      <p>
        The AGILE phase 3 trial (Montesinos et al., NEJM 2022) then
        moved ivosidenib into the front line, combined with azacitidine,
        in newly diagnosed IDH1-mutant AML patients unfit for induction
        chemotherapy. Median overall survival was 24.0 months versus
        7.9 months for azacitidine alone (HR 0.44). That ratio is among
        the largest survival hazard ratios reported in any AML
        randomized trial. The FDA expanded ivosidenib&rsquo;s label to
        front-line AML in 2022.
      </p>

      <h2>Vorasidenib (AG-881) — IDH-mutant low-grade glioma</h2>
      <p>
        Glioma was the disease where the IDH1 mutation was first
        discovered, but the drug for glioma came second. The reason is
        the blood-brain barrier. Ivosidenib has limited CNS penetration;
        even at maximum doses it doesn&rsquo;t reliably suppress R-2HG inside
        intracranial tumors. Vorasidenib was engineered for brain
        penetrance — a dual mIDH1/mIDH2 inhibitor with reduced efflux
        liability and a brain-to-plasma ratio sufficient to hit the
        target where the tumor actually lives.
      </p>
      <p>
        The INDIGO trial (Mellinghoff et al., NEJM 2023) randomized 331
        patients with residual or recurrent grade 2 IDH-mutant glioma —
        all post-surgery, none yet on chemotherapy or radiation — to
        vorasidenib 40 mg daily or placebo. The primary endpoint was
        imaging-based progression-free survival.
      </p>
      <ul>
        <li>
          Median PFS was <strong>27.7 months on vorasidenib versus
          11.1 months on placebo</strong> (HR 0.39).
        </li>
        <li>
          Time to next intervention (radiation or chemotherapy) was
          <strong>not reached on vorasidenib versus 17.8 months on
          placebo</strong> (HR 0.26).
        </li>
        <li>
          Tumor growth rate flipped sign: -2.5% per 6 months on
          vorasidenib, +13.9% on placebo.
        </li>
        <li>
          Health-related quality of life and neurocognition were
          preserved — which matters because radiation and alkylator
          chemotherapy, the alternative, both have well-documented
          long-term neurocognitive costs in this young patient
          population.
        </li>
      </ul>
      <p>
        Vorasidenib was FDA-approved in August 2024 for grade 2
        IDH-mutant astrocytoma and oligodendroglioma after surgery.
        It&rsquo;s the first systemic therapy approved for low-grade
        glioma in more than two decades, and it has reshaped the
        post-operative algorithm for a disease where the prior options
        were watchful waiting and delayed radiotherapy.
      </p>

      <h2>What this means for the medicinal chemistry</h2>
      <p>
        IDH1 R132H validates a few principles that the rest of oncology
        still struggles with. First, <strong>gain-of-function targets
        with neomorphic activity are the cleanest targets you can ask
        for</strong> — the wild-type protein is intrinsically spared
        because the drug binds a pocket that only exists in the mutant.
        Second, <strong>biomarker-driven selection works</strong>:
        every patient enrolled in INDIGO and AGILE had a confirmed IDH
        mutation, and the response rates reflect that. Third,
        <strong>CNS penetration is a design variable, not a
        post-hoc&shy;property</strong> — ivosidenib worked in the bone
        marrow but didn&rsquo;t work in brain, and Servier&rsquo;s response was
        to engineer a second molecule rather than re-purpose the first.
      </p>
      <p>
        The current frontiers: combinations of mIDH inhibitors with
        immune checkpoint blockade (R-2HG is locally immunosuppressive,
        and inhibitor treatment may restore tumor immune visibility),
        prevention trials in patients with IDH-mutant pre-malignant
        clones, and the question of whether R132C/G/L gliomas (a small
        minority) respond as well as the R132H majority.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick IDH1 from the target catalog with R132H from the
        mutation chips. The mutant-only allosteric pocket is the
        pharmacologically interesting site — most R132H-selective
        inhibitors will score 1.5-3 kcal/mol better against the mutant
        than against wild-type, which is a useful sanity check on any
        new analogue. Liganx renders wild-type and R132H side-by-side
        so the ΔΔ tells the selectivity story directly. For brain
        penetrance, the ADMET panel surfaces predicted BBB permeability
        and P-glycoprotein efflux risk, which is where ivosidenib loses
        to vorasidenib structurally.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Dang L, et al. <em>Cancer-associated IDH1 mutations produce
          2-hydroxyglutarate.</em> Nature 462, 739-744 (2009).{" "}
          <a
            href="https://doi.org/10.1038/nature08617"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nature08617
          </a>
        </li>
        <li>
          DiNardo CD, et al. <em>Durable Remissions with Ivosidenib in
          IDH1-Mutated Relapsed or Refractory AML.</em> NEJM 378,
          2386-2398 (2018).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1716984"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1716984
          </a>
        </li>
        <li>
          Montesinos P, et al. <em>Ivosidenib and Azacitidine in
          IDH1-Mutated Acute Myeloid Leukemia.</em> NEJM 386, 1519-1531
          (2022).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2117344"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2117344
          </a>
        </li>
        <li>
          Mellinghoff IK, et al. <em>Vorasidenib in IDH1- or IDH2-Mutant
          Low-Grade Glioma.</em> NEJM 389, 589-601 (2023).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2304194"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2304194
          </a>
        </li>
      </ul>
    </>
  );
}
