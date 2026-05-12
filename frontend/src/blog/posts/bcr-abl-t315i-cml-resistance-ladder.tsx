/**
 * Post: BCR-ABL T315I — the gatekeeper that broke imatinib
 *
 * SEO target: long-tail queries around "BCR-ABL T315I", "ponatinib
 * resistance", "asciminib mechanism", "CML kinase inhibitors". Internal
 * CTA into /studio with ABL + T315I pre-loaded so a reader can dock
 * imatinib, ponatinib, and asciminib against both wild-type and the
 * gatekeeper mutant in a few clicks.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "bcr-abl-t315i-cml-resistance-ladder",
  title: "BCR-ABL T315I: the gatekeeper that broke imatinib",
  description:
    "How a single threonine-to-isoleucine swap at position 315 walled off four BCR-ABL inhibitors, and how ponatinib and asciminib eventually got around it.",
  date: "2026-05-11",
  author: "Liganx team",
  tags: ["bcr-abl", "cml", "resistance", "oncology"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Imatinib was the first targeted kinase inhibitor that actually
        worked. It turned chronic myeloid leukemia from a death sentence
        into a chronic disease with near-normal life expectancy. Then a
        single point mutation at position 315 of ABL emerged, and four
        consecutive generations of inhibitors hit the same wall. The
        story of T315I is the cleanest illustration in oncology of why
        gatekeeper residues matter and what it takes structurally to
        get past one.
      </p>

      <h2>The gatekeeper, in one paragraph</h2>
      <p>
        Threonine 315 sits at the back of the ATP-binding pocket of ABL,
        directly above the hinge region. Imatinib (and dasatinib, and
        nilotinib, and bosutinib) all rely on a hydrogen bond between
        the threonine hydroxyl and the inhibitor scaffold, plus a
        favorable shape complementarity with the small threonine
        sidechain. Substitute that threonine with isoleucine and two
        things happen at once: you lose the hydrogen bond, and the
        bulkier branched isoleucine sidechain sterically clashes with
        the inhibitor. Both penalties stack. The drug, in practice,
        is gone.
      </p>

      <h2>The four-drug pile-up</h2>
      <p>
        The order matters because each generation was optimized against
        the resistance pattern of the previous one, and yet T315I
        knocked all four out:
      </p>
      <ul>
        <li>
          <strong>Imatinib (Gleevec, STI-571)</strong> — Novartis, FDA
          approved 2001. Type II inhibitor, binds the inactive
          DFG-out conformation. The original CML breakthrough.
          IRIS trial showed durable responses in chronic phase. T315I
          drops imatinib affinity by orders of magnitude.
        </li>
        <li>
          <strong>Dasatinib (Sprycel)</strong> — BMS, approved 2006.
          Type I, binds DFG-in. Also hits Src-family kinases.
          Effective against most imatinib-resistance mutations
          (Y253F, E255K, M351T) but not T315I.
        </li>
        <li>
          <strong>Nilotinib (Tasigna)</strong> — Novartis, approved
          2007. A redesigned imatinib scaffold with better fit to the
          DFG-out pocket and higher absolute potency. Same gatekeeper
          dependency. Same failure on T315I.
        </li>
        <li>
          <strong>Bosutinib (Bosulif)</strong> — Pfizer, approved 2012.
          Dual Src/Abl inhibitor. Active against many compound
          mutations but, again, not T315I.
        </li>
      </ul>
      <p>
        By 2010 every patient with a T315I mutation in chronic-phase
        CML had run out of approved options. Allogeneic stem cell
        transplant was the only remaining curative path, with all the
        morbidity that implies.
      </p>

      <h2>Ponatinib: the first answer</h2>
      <p>
        Ponatinib (Iclusig, AP24534) was designed with T315I as the
        explicit target. The medicinal chemistry move was a carbon-carbon
        triple bond linker that threads <em>around</em> the bulky
        isoleucine sidechain instead of trying to displace it. The alkyne
        is rigid and slim — the geometry happens to fit a pocket with
        either threonine or isoleucine at position 315. O&apos;Hare et al.
        (2009) showed the structural basis in complex with the T315I
        mutant.
      </p>
      <p>
        Clinically, the PACE trial (Cortes et al., NEJM 2013) demonstrated
        major cytogenetic responses in roughly 70% of T315I-positive
        chronic-phase patients who had failed prior TKIs. The catch was
        cardiovascular: arterial occlusive events emerged at concerning
        rates, leading to a temporary marketing suspension in 2013, a
        revised dose, and a black box warning that has shaped how
        ponatinib is dosed ever since. The OPTIC trial later validated
        a response-driven dose-reduction strategy that preserves efficacy
        while attenuating the vascular signal.
      </p>

      <h2>Asciminib: the allosteric end-run</h2>
      <p>
        Asciminib (Scemblix, ABL001) takes a different route entirely.
        Instead of competing with ATP, it binds the myristoyl pocket on
        the C-lobe of ABL — the natural docking site for the
        N-terminal myristoyl group that normally autoinhibits c-ABL.
        BCR-ABL, the fusion oncoprotein in CML, lacks that myristoyl
        group because the BCR fragment replaces the N-terminus. The
        myristoyl pocket is therefore empty and accessible in the
        oncogenic form. Asciminib occupies it and reimposes the
        autoinhibited conformation pharmacologically.
      </p>
      <p>
        Because the binding site is nowhere near position 315, T315I has
        essentially no impact on asciminib affinity for that pocket. The
        ASCEMBL trial (Hochhaus et al., Leukemia 2023) compared asciminib
        head-to-head against bosutinib in heavily pretreated CML and
        showed superior major molecular response rates. The FDA approval
        for T315I-positive CML in 2021 expanded the salvage menu beyond
        ponatinib for the first time. Asciminib is now class STAMP
        (Specifically Targeting the ABL Myristoyl Pocket), and the same
        pocket is being explored in combination regimens with ATP-site
        binders to suppress emergence of compound mutations.
      </p>

      <h2>What this means for your docking workflow</h2>
      <p>
        T315I is a small experiment you can run in an afternoon and the
        signal is unambiguous. Imatinib will lose 2-4 kcal/mol going
        from wild-type ABL to T315I in any reasonable scoring function.
        Ponatinib should hold roughly steady because the alkyne linker
        accommodates either residue. Asciminib should not care at all
        because it is not even binding the same pocket — and a docking
        run that targets the ATP site for asciminib will produce nonsense
        scores, which is itself a useful diagnostic that you have the
        wrong binding-site definition.
      </p>
      <p>
        The broader lesson is that gatekeeper mutations are the easiest
        WT-vs-mutant signal to recover with docking. The energetic
        penalty is large, the geometry change is well-localized, and
        the rank order across known inhibitors is well-characterized.
        If a workflow cannot reproduce the imatinib WT-vs-T315I gap,
        something is wrong with the workflow, not the biology.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The canonical structures are{" "}
        <a
          href="https://www.rcsb.org/structure/2HYY"
          target="_blank"
          rel="noreferrer noopener"
        >
          2HYY
        </a>{" "}
        (imatinib bound to wild-type ABL),{" "}
        <a
          href="https://www.rcsb.org/structure/3IK3"
          target="_blank"
          rel="noreferrer noopener"
        >
          3IK3
        </a>{" "}
        (ponatinib bound to the T315I mutant), and{" "}
        <a
          href="https://www.rcsb.org/structure/5MO4"
          target="_blank"
          rel="noreferrer noopener"
        >
          5MO4
        </a>{" "}
        (asciminib in the myristoyl pocket).{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick ABL from the target catalog with T315I from the mutation
        chips. Dock imatinib, ponatinib, and asciminib in turn. The
        WT-versus-T315I delta will tell you a clean story for the first
        two; for asciminib, redefine the binding site to the myristoyl
        pocket to see why allosteric inhibition is structurally immune
        to the gatekeeper.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          O&apos;Hare T, et al. <em>AP24534, a pan-BCR-ABL inhibitor for
          chronic myeloid leukemia, potently inhibits the T315I mutant
          and overcomes mutation-based resistance.</em> Cancer Cell 16,
          401-412 (2009).{" "}
          <a
            href="https://doi.org/10.1016/j.ccr.2009.09.028"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/j.ccr.2009.09.028
          </a>
        </li>
        <li>
          Cortes JE, et al. <em>A phase 2 trial of ponatinib in
          Philadelphia chromosome-positive leukemias.</em> NEJM 369,
          1783-1796 (2013).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1306494"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1306494
          </a>
        </li>
        <li>
          Wylie AA, et al. <em>The allosteric inhibitor ABL001 enables
          dual targeting of BCR-ABL1.</em> Nature 543, 733-737 (2017).{" "}
          <a
            href="https://doi.org/10.1038/nature21702"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nature21702
          </a>
        </li>
        <li>
          Hochhaus A, et al. <em>Asciminib vs bosutinib in
          chronic-phase chronic myeloid leukemia previously treated with
          at least two tyrosine kinase inhibitors: longer-term follow-up
          of ASCEMBL.</em> Leukemia 37, 617-626 (2023).{" "}
          <a
            href="https://doi.org/10.1038/s41375-023-01829-9"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41375-023-01829-9
          </a>
        </li>
      </ul>
    </>
  );
}
