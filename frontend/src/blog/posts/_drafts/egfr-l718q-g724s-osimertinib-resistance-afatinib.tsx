/**
 * Post: EGFR L718Q and G724S - the osimertinib resistance mutations that
 * are not C797S, and why afatinib (a second-generation drug) sometimes
 * beats the newer one.
 *
 * SEO target: long-tail "EGFR L718Q", "EGFR G724S", "osimertinib
 * resistance afatinib". Internal CTA into /studio with EGFR + the
 * relevant mutation so the reader can run the comparison themselves.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "egfr-l718q-g724s-osimertinib-resistance-afatinib",
  title: "L718Q and G724S: when going backwards a generation works",
  description:
    "Two rare EGFR mutations break osimertinib without touching Cys797, and both stay sensitive to afatinib. What the structures say and how to model it.",
  date: "2026-08-08",
  author: "Liganx team",
  tags: ["egfr", "oncology", "resistance", "nsclc"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Almost every conversation about osimertinib resistance defaults to
        C797S, the cysteine that the covalent warhead needs, or to MET
        amplification, the bypass track. Those two dominate the pie chart
        and they deserve the attention. But a smaller slice of patients
        progress on a pair of mutations that are more interesting from a
        structural standpoint, because neither one touches Cys797 and both
        respond to a drug approved four years before osimertinib was.
      </p>

      <h2>Two mutations, one glycine-rich loop</h2>
      <p>
        L718Q and G724S both sit in the phosphate-binding loop of the EGFR
        kinase domain, the flexible glycine-rich stretch that folds over the
        ATP site like a lid. This is not the gatekeeper (that is 790) and it
        is not the covalent anchor (797). It is the roof.
      </p>
      <ul>
        <li>
          <strong>L718Q</strong> substitutes a leucine that packs directly
          against the aromatic core of osimertinib. Leucine-to-glutamine
          swaps a greasy branched sidechain for a polar amide in a pocket
          that has no hydrogen-bond partner to offer it. The drug loses a
          hydrophobic contact it was designed around, and the sidechain also
          reshapes the space the inhibitor was occupying.
        </li>
        <li>
          <strong>G724S</strong> puts a serine where a glycine sat. Glycines
          in a P-loop are there because they have no sidechain and can adopt
          backbone angles other residues cannot. Adding a sidechain at 724
          stiffens and repositions the loop. Fassunke and colleagues showed
          by structural analysis and computational modeling that the
          resulting loop conformation is incompatible with third-generation
          TKI binding.
        </li>
      </ul>

      <h2>G724S only counts if the activating mutation is exon 19</h2>
      <p>
        This is the part worth internalizing. Brown and colleagues combined
        structure-based modeling with cell-line drug-response data and
        clinical genomic profiling, and found that G724S is
        allele-specific. In the context of an exon 19 deletion, G724S
        reduces osimertinib binding affinity and the cells are resistant.
        In the context of L858R, cells carrying G724S remain sensitive to
        osimertinib. The clinical sequencing data agreed: G724S showed up
        alongside exon 19 deletions and not alongside L858R.
      </p>
      <p>
        Their framing is the useful takeaway. The unit of analysis is not
        the drug-resistance mutation pair, it is the activating mutation,
        drug, and resistance mutation trio. The same secondary substitution
        can be a resistance driver in one genetic background and clinically
        irrelevant in another, because the activating mutation has already
        biased which conformation the kinase spends its time in.
      </p>
      <p>
        L718Q runs the other way. In the case series assembled by Li and
        colleagues, every one of the fourteen L718Q/V patients they could
        find had the mutation arise secondary to L858R, not to an exon 19
        deletion. Two mutations, three residues apart, with mirror-image
        allelic preferences.
      </p>

      <h2>Why afatinib comes back</h2>
      <p>
        Osimertinib is a third-generation drug: covalent, mutant-selective,
        engineered around T790M. Afatinib is second-generation: covalent,
        but broader, hitting wild-type EGFR and HER2 hard enough that skin
        and GI toxicity caps the dose. On the usual ladder afatinib is a
        step down.
      </p>
      <p>
        It is also a chemically different scaffold with a different binding
        pose, and a P-loop distortion that ruins the fit for one quinazoline
        does not necessarily ruin it for the other. Fassunke and colleagues
        ran systematic inhibitor screening with kinetic profiling and found
        that second-generation inhibitors retain kinase affinity against
        G724S, with afatinib producing measurable reductions in colony
        formation and tumor growth in G724S-driven models. Brown and
        colleagues independently found that exon 19 deletion plus G724S
        retains afatinib sensitivity while losing erlotinib sensitivity.
      </p>
      <p>
        The clinical evidence is real but thin, and worth stating honestly.
        In a multicenter French retrospective study, Sanchis-Borja and
        colleagues identified nine patients with acquired L718Q or G724S.
        Four went on to afatinib. Two had a partial response, one had
        stable disease, one progressed. Treatment durations ranged from 1.6
        to 31.7 months. Li and colleagues report a similar picture for
        L718Q/V: a high disease control rate on afatinib but a modest
        objective response rate, and a median PFS around two months. There
        is no consensus regimen here and no randomized data. What there is
        is a mechanistic rationale plus a handful of durable responders.
      </p>

      <h2>How common is this</h2>
      <p>
        Rare, but not vanishing. Schoenfeld and colleagues profiled 62
        patients with paired pre- and post-osimertinib tumor tissue at
        Memorial Sloan Kettering and found acquired G724S in one of 27
        first-line cases. Their broader finding is a useful corrective:
        histologic transformation, mostly squamous, accounted for roughly
        15 percent of resistance, and off-target genetic alterations
        another 19 percent in the first-line setting. On-target tertiary
        mutations are a minority of osimertinib failures. When you do find
        one, though, it is actionable in a way that squamous transformation
        is not.
      </p>

      <h2>What this looks like in a docking run</h2>
      <p>
        P-loop mutations are harder to model than gatekeeper mutations and
        you should expect that going in. A T790M substitution changes the
        volume of a fairly rigid pocket, and rigid-receptor molecular
        docking picks up the clash. L718Q and G724S change the conformational
        preferences of a loop, and a single static receptor cannot represent
        that. If you dock into one mutant structure with the loop frozen in
        its wild-type position, you will very likely see almost no score
        change and conclude the mutation is silent.
      </p>
      <p>
        Two adjustments help. First, run an ensemble rather than a single
        receptor, so the P-loop is sampled in more than one position.
        Second, read the comparison as a differential: osimertinib versus
        afatinib against the same receptor set, not either drug in
        isolation. Absolute scores on a flexible loop are not trustworthy
        enough to stand alone, but the direction of the gap between two
        ligands across wild-type and mutant receptors often is. That is the
        same logic behind reading &Delta;&Delta; rather than raw affinity
        anywhere else in the pipeline.
      </p>
      <p>
        And keep the activating mutation in the model. Given the
        allele-specificity Brown and colleagues documented, a G724S
        receptor built on an L858R background is answering a different
        question than one built on an exon 19 deletion background.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link
          to="/studio"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          Open Studio
        </Link>{" "}
        and select EGFR, then apply L718Q or G724S. Dock osimertinib and
        afatinib against the wild-type and mutant receptors and compare the
        pairs rather than the individual scores. Running{" "}
        <strong>molecular docking online</strong> across an ensemble of
        P-loop conformations, instead of a single crystal pose, is the
        difference between seeing this resistance mechanism and missing it
        entirely.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Fassunke J, M&uuml;ller F, Keul M, et al.{" "}
          <em>
            Overcoming EGFR(G724S)-mediated osimertinib resistance through
            unique binding characteristics of second-generation EGFR
            inhibitors.
          </em>{" "}
          Nat Commun 9, 4655 (2018).{" "}
          <a
            href="https://doi.org/10.1038/s41467-018-07078-0"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41467-018-07078-0
          </a>
        </li>
        <li>
          Brown BP, Zhang YK, Westover D, et al.{" "}
          <em>
            On-target resistance to the mutant-selective EGFR inhibitor
            osimertinib can develop in an allele-specific manner dependent
            on the original EGFR-activating mutation.
          </em>{" "}
          Clin Cancer Res 25, 3341-3351 (2019).{" "}
          <a
            href="https://doi.org/10.1158/1078-0432.CCR-18-3829"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/1078-0432.CCR-18-3829
          </a>
        </li>
        <li>
          Sanchis-Borja M, Guisier F, Swalduz A, et al.{" "}
          <em>
            Characterization of patients with EGFR mutation-positive NSCLC
            following emergence of the osimertinib resistance mutations,
            L718Q or G724S: a multicenter retrospective observational study
            in France.
          </em>{" "}
          Onco Targets Ther 17, 439-448 (2024).{" "}
          <a
            href="https://doi.org/10.2147/OTT.S448909"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.2147/OTT.S448909
          </a>
        </li>
        <li>
          Li M, Qin J, Xie F, et al.{" "}
          <em>
            L718Q/V mutation in exon 18 of EGFR mediates resistance to
            osimertinib: clinical features and treatment.
          </em>{" "}
          Discov Oncol 13, 72 (2022).{" "}
          <a
            href="https://doi.org/10.1007/s12672-022-00537-7"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1007/s12672-022-00537-7
          </a>
        </li>
        <li>
          Schoenfeld AJ, Chan JM, Kubota D, et al.{" "}
          <em>
            Tumor analyses reveal squamous transformation and off-target
            alterations as early resistance mechanisms to first-line
            osimertinib in EGFR-mutant lung cancer.
          </em>{" "}
          Clin Cancer Res 26, 2654-2663 (2020).{" "}
          <a
            href="https://doi.org/10.1158/1078-0432.CCR-19-3563"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/1078-0432.CCR-19-3563
          </a>
        </li>
      </ul>
    </>
  );
}
