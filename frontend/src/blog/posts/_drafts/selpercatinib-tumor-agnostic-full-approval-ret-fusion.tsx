import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "selpercatinib-tumor-agnostic-full-approval-ret-fusion",
  title: "Selpercatinib wins full tumor-agnostic approval for RET fusions",
  description:
    "The FDA converted selpercatinib's tissue-agnostic RET fusion indication from accelerated to traditional approval on July 14, 2026. What the confirmatory data showed.",
  date: "2026-07-18",
  author: "Liganx team",
  tags: ["ret", "selpercatinib", "fda-approval", "tumor-agnostic"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        On July 14, 2026, the FDA granted traditional approval to selpercatinib
        (Retevmo) for locally advanced or metastatic solid tumors carrying a
        RET gene fusion, in patients aged 2 and older who have progressed on
        prior systemic therapy or have no satisfactory alternative. It is the
        first and only RET inhibitor cleared across histologies regardless of
        tumor type, and the conversion from accelerated to full approval
        removes the confirmatory-trial cloud that has hung over the
        tissue-agnostic label since 2022.
      </p>

      <h2>What changed on July 14</h2>
      <p>
        This is not a brand-new drug. Selpercatinib first reached the market in
        2020 for RET fusion-positive NSCLC and RET-mutant medullary thyroid
        cancer. The tumor-agnostic indication &mdash; any solid tumor with a
        RET fusion &mdash; came in September 2022 under accelerated approval for
        adults, with a pediatric extension (age 2 and up) added in 2024.
        Accelerated approval is provisional: it lets a drug reach patients on
        the strength of a surrogate endpoint like response rate, but the sponsor
        has to come back with confirmatory evidence or risk losing the label.
      </p>
      <p>
        That confirmatory evidence has now been accepted. The FDA converted the
        tissue-agnostic indication to traditional (regular) approval roughly two
        months ahead of its goal date, folding the adult and pediatric
        populations into a single durable label.
      </p>

      <h2>The confirmatory data</h2>
      <p>
        The approval rests on the non-lung, non-thyroid cohort of LIBRETTO-001,
        the large basket study that has anchored selpercatinib's development
        from the start. In the 75 evaluable patients with RET fusion-positive
        tumors outside NSCLC and thyroid cancer:
      </p>
      <ul>
        <li>
          <strong>Overall response rate 47%</strong> by independent review,
          spanning a wide range of histologies.
        </li>
        <li>
          <strong>Median duration of response 24.5 months</strong> &mdash; the
          durability, not just the response rate, is what supported the switch
          to full approval.
        </li>
        <li>
          <strong>Responses across colorectal, pancreatic, salivary, soft
          tissue sarcoma, cholangiocarcinoma, breast, and neuroendocrine
          tumors</strong>, among others. RET fusions are individually rare in
          each of these but collectively define a real, targetable population.
        </li>
      </ul>
      <p>
        The clinical logic behind a tumor-agnostic label is that the driver
        matters more than the tissue. A CCDC6-RET or KIF5B-RET fusion produces
        the same constitutively active kinase whether it sits in a lung, a
        colon, or a salivary gland, and selpercatinib inhibits that kinase the
        same way in each context.
      </p>

      <h2>Why RET fusions are so druggable</h2>
      <p>
        RET (rearranged during transfection) is a receptor tyrosine kinase. In
        its normal life it needs a GDNF-family ligand and a co-receptor to
        dimerize and signal. A chromosomal rearrangement that fuses the RET
        kinase domain to a partner gene with a coiled-coil or dimerization motif
        &mdash; KIF5B, CCDC6, NCOA4, and others &mdash; short-circuits all of
        that. The fusion protein dimerizes on its own, the kinase is always on,
        and downstream RAS-MAPK and PI3K-AKT signaling drives proliferation.
      </p>
      <p>
        Selpercatinib is a selective, ATP-competitive RET inhibitor. Unlike the
        older multikinase drugs (cabozantinib, vandetanib) that hit RET as one
        target among many and carry the off-target toxicity to match,
        selpercatinib was designed around the RET pocket, which is why it
        tolerates so well and reaches the CNS. Pralsetinib is the other
        purpose-built RET inhibitor in this class.
      </p>

      <h2>The resistance question</h2>
      <p>
        Selective kinase inhibitors buy deep responses and then select for
        escape mutations, and RET is no exception. The dominant on-target
        resistance mechanism is the <strong>solvent-front mutation G810</strong>
        {" "}(G810R, G810S, G810C). Glycine 810 sits at the mouth of the ATP
        pocket where the inhibitor's solvent-exposed edge threads out; swapping
        the small glycine for a bulkier, charged residue sterically clashes with
        both selpercatinib and pralsetinib. It is the RET analog of ROS1 G2032R
        and ALK G1202R &mdash; same structural story, different kinase.
        Next-generation RET inhibitors designed to hold potency against G810 are
        the active frontier.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick RET to dock selpercatinib against the wild-type kinase, then
        introduce the G810R solvent-front mutation and re-dock the same ligand.
        Comparing the two poses is a clean illustration of why molecular docking
        online is useful for resistance work: the delta between wild-type and
        mutant scores tells you far more about whether a compound survives
        G810R than either absolute score does on its own. This is the same
        differential-docking workflow you would use to triage a next-generation
        RET scaffold before committing to synthesis.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          U.S. Food and Drug Administration.{" "}
          <em>FDA grants traditional approval to selpercatinib for locally
          advanced or metastatic RET fusion-positive solid tumors.</em> July 14,
          2026.{" "}
          <a
            href="https://www.fda.gov/drugs/resources-information-approved-drugs/fda-grants-traditional-approval-selpercatinib-locally-advanced-or-metastatic-ret-fusion-positive"
            target="_blank"
            rel="noreferrer noopener"
          >
            fda.gov
          </a>
        </li>
        <li>
          Subbiah V, Wolf J, Konda B, et al. <em>Tumour-agnostic efficacy and
          safety of selpercatinib in patients with RET fusion-positive solid
          tumours other than lung or thyroid tumours (LIBRETTO-001): a phase
          1/2, open-label, basket trial.</em> Lancet Oncol 23, 1261-1273 (2022).{" "}
          <a
            href="https://doi.org/10.1016/S1470-2045(22)00541-1"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/S1470-2045(22)00541-1
          </a>
        </li>
        <li>
          Drilon A, Oxnard GR, Tan DSW, et al. <em>Efficacy of selpercatinib in
          RET fusion-positive non-small-cell lung cancer.</em> N Engl J Med 383,
          813-824 (2020).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2005653"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2005653
          </a>
        </li>
      </ul>
    </>
  );
}
