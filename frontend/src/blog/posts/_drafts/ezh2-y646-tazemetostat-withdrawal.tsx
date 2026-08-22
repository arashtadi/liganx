/**
 * Post: EZH2 Y646 and the tazemetostat withdrawal — a gain-of-function
 * epigenetic target that just lost its lead drug.
 *
 * SEO target: "EZH2 Y646 mutation", "EZH2 Y641", "tazemetostat mechanism",
 * "Tazverik withdrawal", "EZH2 inhibitor". News-anchored mutation/target
 * deep-dive. Internal CTA into /studio via the SAM-competitive catalytic
 * pocket docking angle.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "ezh2-y646-tazemetostat-withdrawal",
  title: "EZH2 Y646: a gain-of-function target that just lost its lead drug",
  description:
    "EZH2 Y646 (Y641) mutations drive follicular lymphoma by hyperactivating H3K27 trimethylation. Tazemetostat targeted it for six years, until Ipsen pulled it in March 2026.",
  date: "2026-08-11",
  author: "Liganx team",
  tags: ["ezh2", "epigenetics", "lymphoma", "tazemetostat", "mutation-analysis"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Most of the mutations that show up on this blog are loss-of-function
        or resistance events: a kinase domain that stops binding a drug, a
        tumor suppressor that unfolds. EZH2 Y646 is the opposite kind of
        story. It is a gain-of-function mutation in a chromatin-modifying
        enzyme that made the enzyme better at its job, in exactly the wrong
        way, and it produced one of the field&rsquo;s cleaner biomarker-drug
        pairings &mdash; until March 2026, when the drug came off the market.
      </p>

      <h2>EZH2 and PRC2, briefly</h2>
      <p>
        EZH2 is the catalytic subunit of Polycomb Repressive Complex 2
        (PRC2), the enzyme complex responsible for trimethylating lysine 27
        on histone H3 (H3K27me3). H3K27me3 is a repressive mark: genes
        sitting under it get silenced. PRC2 is how cells keep large blocks of
        the genome switched off during differentiation, and EZH2 is the SET-domain
        methyltransferase that actually swings the methyl group from
        S-adenosylmethionine (SAM) onto the histone tail.
      </p>
      <p>
        In germinal-center B cells, PRC2 activity has to be tightly tuned:
        too little and cells fail to silence genes that should stay off
        during rapid proliferation, too much and tumor suppressors get
        buried under repressive chromatin. EZH2 mutations found in lymphoma
        push activity in the second direction.
      </p>

      <h2>The Y646 (Y641) switch</h2>
      <p>
        Morin and colleagues first reported recurrent heterozygous mutations
        at EZH2 codon Y641 in follicular lymphoma and germinal-center-derived
        diffuse large B-cell lymphoma in 2010, using the older isoform
        numbering that current literature and FDA labeling render as Y646.
        The mutations cluster at a single tyrosine inside the SET domain and
        substitute it for asparagine, phenylalanine, serine, histidine or
        cysteine.
      </p>
      <p>
        The mechanism turned out to be unusually elegant. Wild-type EZH2 is
        efficient at the first two methylation steps (H3K27 to me1, me1 to
        me2) but comparatively poor at the third, the me2-to-me3 step that
        produces the fully repressive mark. McCabe and colleagues showed that
        Y641 mutants flip that substrate preference: they lose activity
        against unmethylated H3K27 but gain activity against the
        dimethylated substrate. Because wild-type EZH2 is still present from
        the second allele in these heterozygous tumors, the mutant and
        wild-type enzymes work in sequence &mdash; wild-type does the first
        two methylations, mutant finishes the job &mdash; and the net result
        is H3K27me3 hypertrimethylation across the genome, silencing tumor
        suppressors that should have stayed on. Roughly a quarter of
        follicular lymphomas carry an EZH2 Y646 mutation.
      </p>

      <h2>Tazemetostat: hitting the cofactor pocket, not the mutation site</h2>
      <p>
        This is a useful contrast with mutation-created pockets like TP53
        Y220C: Y646 does not open a new drug-binding site. It is buried in
        the catalytic core and changes substrate handling, not the
        SAM-binding pocket. Tazemetostat (EPZ-6438) and related PRC2
        inhibitors instead work by competing directly with SAM for the
        cofactor site &mdash; a pyridone &ldquo;head&rdquo; group anchors where the
        cofactor&rsquo;s methionine would sit, blocking the methyl-transfer
        chemistry regardless of which histone substrate the enzyme is
        working on. Both mutant and wild-type EZH2 get shut down; the
        selectivity for mutant-driven tumors comes from those cells being
        disproportionately dependent on continued H3K27me3 deposition to
        keep tumor suppressors silenced, not from the drug discriminating
        the mutant active site.
      </p>
      <p>
        On that logic, tazemetostat became the first EZH2 inhibitor and the
        first PRC2-targeted drug to reach approval: accelerated approval for
        epithelioid sarcoma in January 2020, then for relapsed or refractory
        follicular lymphoma in June 2020, the latter with an EZH2-mutation
        companion diagnostic built directly into the label.
      </p>
      <ul>
        <li>
          <strong>Epithelioid sarcoma</strong> &mdash; approved on a 15%
          objective response rate in a phase 2 basket study of patients with
          SMARCB1/INI1-deficient tumors, a different vulnerability (loss of
          the SWI/SNF component that normally opposes PRC2) but the same
          drug and target.
        </li>
        <li>
          <strong>Follicular lymphoma</strong> &mdash; the pivotal phase 2
          trial split patients by EZH2 mutation status: 69% ORR in the
          EZH2-mutant cohort versus 34% in EZH2 wild-type, a textbook
          biomarker-enriched result that justified the mutation-selection
          label language.
        </li>
      </ul>

      <h2>What happened in March 2026</h2>
      <p>
        Ipsen, which acquired tazemetostat rights from Epizyme, announced on
        March 9, 2026 that it was voluntarily withdrawing Tazverik in all
        indications, in all markets. The trigger was not new safety data
        from the approved monotherapy setting but an interim signal from
        SYMPHONY-1, a phase Ib/III trial testing tazemetostat added to
        lenalidomide plus rituximab (R2) in follicular lymphoma. An
        independent data monitoring committee flagged an excess of secondary
        hematologic malignancies in the combination arm and concluded the
        risk-benefit balance no longer supported continued use, including in
        the already-approved monotherapy indications.
      </p>
      <p>
        Secondary hematologic malignancies are a known class concern for
        epigenetic modifiers &mdash; durable, genome-wide changes to
        chromatin state are, mechanistically, exactly the kind of
        perturbation that can also promote clonal outgrowth in bone marrow.
        It is a sobering data point for a target class where the drug&rsquo;s
        entire therapeutic premise is broad, sustained repression of gene
        expression programs.
      </p>

      <h2>The target isn&rsquo;t dead, just this drug</h2>
      <p>
        Tazemetostat&rsquo;s withdrawal is a setback for the specific molecule and
        the specific combination regimen, not necessarily a verdict on
        SAM-competitive PRC2 inhibition as a class. Valemetostat, a
        dual EZH1/EZH2 inhibitor, remains approved for adult T-cell
        leukemia/lymphoma and relapsed peripheral T-cell lymphoma on a
        different safety and efficacy profile, and other PRC2-directed
        programs continue in earlier development. Whether the field
        concludes that dual EZH1/EZH2 inhibition, different dosing
        strategies, or avoiding IMiD combinations altogether is the safer
        path forward is exactly the kind of question that will play out
        over the next few trial readouts.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock a pyridone-class scaffold against the EZH2 catalytic
        domain&rsquo;s SAM pocket. Because Y646 sits in the substrate channel
        rather than the cofactor site, a wild-type-versus-mutant comparison
        here is a good illustration of when mutation status changes
        pharmacology (which patients respond) without changing the docking
        geometry (where the drug binds) &mdash; worth reading alongside our
        piece on{" "}
        <Link
          to="/blog/ddg-vs-absolute-docking-scores"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          &Delta;&Delta; versus absolute docking scores
        </Link>
        . Liganx runs molecular docking online and free, so you can set this
        comparison up in the browser without a local install.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Morin RD, et al. <em>Somatic mutations altering EZH2 (Tyr641) in
          follicular and diffuse large B-cell lymphomas of germinal-center
          origin.</em> Nat Genet 42, 181&ndash;185 (2010).{" "}
          <a href="https://doi.org/10.1038/ng.518" target="_blank" rel="noreferrer noopener">
            doi:10.1038/ng.518
          </a>
        </li>
        <li>
          McCabe MT, et al. <em>Mutation of A677 in histone methyltransferase
          EZH2 in human B-cell lymphoma promotes hypertrimethylation of
          histone H3 on lysine 27 (H3K27).</em> Somatic mutations at EZH2
          Y641 act dominantly to increase H3K27 trimethylation, Blood 117,
          2451&ndash;2459 (2011).{" "}
          <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC3062411/" target="_blank" rel="noreferrer noopener">
            pmc.ncbi.nlm.nih.gov/articles/PMC3062411
          </a>
        </li>
        <li>
          Morschhauser F, et al. <em>Tazemetostat for patients with relapsed
          or refractory follicular lymphoma: an open-label, single-arm,
          multicentre, phase 2 trial.</em> Lancet Oncol 21, 1433&ndash;1442
          (2020).{" "}
          <a href="https://doi.org/10.1016/S1470-2045(20)30441-1" target="_blank" rel="noreferrer noopener">
            doi:10.1016/S1470-2045(20)30441-1
          </a>
        </li>
        <li>
          Ipsen. <em>Ipsen voluntarily withdraws Tazverik&reg; (tazemetostat)
          in follicular lymphoma and epithelioid sarcoma.</em> Press release,
          March 9, 2026.{" "}
          <a href="https://www.ipsen.com/press-release/ipsen-voluntarily-withdraws-tazverik-tazemetostat-in-follicular-lymphoma-and-epithelioid-sarcoma-3251503/" target="_blank" rel="noreferrer noopener">
            ipsen.com
          </a>
        </li>
      </ul>
    </>
  );
}
