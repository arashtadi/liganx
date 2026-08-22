/**
 * Post: HIF-2alpha and belzutifan — drugging a transcription factor's
 * hidden pocket in clear cell kidney cancer.
 *
 * SEO target: "HIF-2alpha inhibitor", "belzutifan mechanism", "EPAS1
 * cryptic pocket", "PAS-B domain drug", "clear cell RCC HIF-2".
 * Target/disease deep-dive hung on the June 2026 adjuvant belzutifan +
 * pembrolizumab approval (LITESPARK-022). Internal CTA into /studio via
 * the cryptic-pocket docking angle.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "hif2alpha-belzutifan-cryptic-pocket-kidney-cancer",
  title: "HIF-2α and belzutifan: drugging a hidden pocket in kidney cancer",
  description:
    "Belzutifan drugs a transcription factor once called undruggable by slipping into a buried cavity in the HIF-2 PAS-B domain. Here is the mechanism, the clinic, and why it is a cryptic-pocket docking story.",
  date: "2026-07-19",
  author: "Liganx team",
  tags: ["hif-2-alpha", "epas1", "belzutifan", "kidney-cancer", "clinical-landscape"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        For most of the last two decades HIF-2&alpha; was the textbook
        example of an undruggable oncoprotein: a transcription factor with
        no enzyme active site, no natural small-molecule ligand, and a
        job (turning on hypoxia genes by pairing with its partner ARNT)
        that looked impossible to block with a drug. Belzutifan proved that
        wrong by exploiting a quirk of the protein&apos;s fold. On 12 June
        2026 the FDA broadened its label again, approving belzutifan plus
        pembrolizumab as adjuvant therapy for clear cell renal cell
        carcinoma (ccRCC) after nephrectomy. It is a good moment to look
        at how a &ldquo;pocketless&rdquo; target got drugged.
      </p>

      <h2>Why HIF-2&alpha; drives clear cell kidney cancer</h2>
      <p>
        Roughly 90% of clear cell RCC carries inactivation of the{" "}
        <em>VHL</em> tumor-suppressor gene. VHL normally tags the
        hypoxia-inducible factor alpha subunits for degradation when oxygen
        is present. Lose VHL and HIF-2&alpha; (encoded by <em>EPAS1</em>)
        is stabilized constitutively, even in normoxia. Stabilized
        HIF-2&alpha; dimerizes with ARNT (HIF-1&beta;) and switches on a
        transcriptional program &mdash; VEGFA, cyclin D1, PDGF, GLUT1 and
        more &mdash; that feeds angiogenesis and proliferation. In ccRCC,
        HIF-2&alpha; is not a passenger; genetic work showed it is the
        oncogenic driver downstream of VHL loss, which is what made it worth
        the long effort to drug it directly.
      </p>

      <h2>The hidden pocket that changed everything</h2>
      <p>
        The breakthrough was structural. HIF-2&alpha; and ARNT each dimerize
        through a pair of PAS domains. In 2009, Scheuermann and colleagues
        solved the structure of the HIF-2&alpha; PAS-B domain and found
        something unexpected: a large, water-filled cavity buried in the
        hydrophobic core of the domain, with roughly 290&nbsp;&Aring;&sup3;
        of internal volume and no obvious biological ligand. It was a
        pocket that did not open to solvent in the resting structure &mdash;
        a classic cryptic site &mdash; but it was there, and it was
        druggable.
      </p>
      <p>
        Peloton Therapeutics built a chemical series into that cavity.
        Tool compound PT2399 and its clinical successor PT2385 demonstrated,
        in a pair of 2016 <em>Nature</em> papers, that occupying the PAS-B
        cavity allosterically prevents HIF-2&alpha; from binding ARNT. No
        heterodimer, no transcription. Belzutifan (originally PT2977) is the
        optimized third-generation molecule from that program, with better
        potency and pharmacokinetics. Mechanistically it does not sit on an
        active site at all &mdash; it wedges into the buried pocket and
        triggers a side-chain rearrangement (a conformational shift around
        residue M252) that distorts the dimerization surface on the far side
        of the domain. It is allostery in the purest sense: bind here, break
        a protein-protein interface over there.
      </p>

      <h2>The clinical ladder, and the new adjuvant approval</h2>
      <p>
        Belzutifan has climbed steadily through RCC indications.
      </p>
      <ul>
        <li>
          <strong>2021</strong> &mdash; first approval, for VHL
          disease-associated RCC, CNS hemangioblastomas, and pancreatic
          neuroendocrine tumors not requiring immediate surgery.
        </li>
        <li>
          <strong>2023</strong> &mdash; advanced ccRCC after a PD-1/PD-L1
          inhibitor and a VEGF-targeted therapy, on the strength of
          LITESPARK-005, which showed superior progression-free survival and
          objective response versus everolimus (though it did not meet the
          overall-survival co-primary endpoint).
        </li>
        <li>
          <strong>June 2026</strong> &mdash; the new one: adjuvant
          belzutifan plus pembrolizumab after nephrectomy for patients at
          intermediate-high or high risk of recurrence. In LITESPARK-022
          (NCT05239728), 1,841 post-nephrectomy patients were randomized to
          the combination or to pembrolizumab alone; at a median follow-up
          of 28.4 months the combination cut the risk of a
          disease-free-survival event by about 28%.
        </li>
      </ul>
      <p>
        The on-target pharmacology is visible in the safety label. Because
        HIF-2 also governs erythropoietin, blunting it predictably causes
        anemia; suppressing the hypoxia response can cause hypoxia itself.
        Both are boxed or prominent warnings, alongside embryo-fetal
        toxicity. These are not idiosyncratic effects &mdash; they are the
        mechanism showing up in the clinic.
      </p>

      <h2>Resistance: mutating a pocket that barely exists</h2>
      <p>
        As with kinase inhibitors, selection pressure finds the binding
        site. Acquired resistance to PAS-B ligands has been mapped to
        point mutations lining or adjacent to the cavity &mdash; for
        example the gatekeeper-like G323E substitution and phosphorylation
        near T324, both of which molecular-dynamics work links to weakened
        belzutifan engagement. The lesson mirrors the kinase resistance
        stories: even an allosteric, cryptic pocket is a finite piece of
        protein surface, and a single well-placed residue change can raise
        the energetic cost of binding enough to matter clinically.
      </p>

      <h2>Why this is a docking story, not just a biology story</h2>
      <p>
        HIF-2&alpha; is the poster child for a problem structure-based
        design keeps running into: the pocket you need is not visible in the
        obvious conformation. Dock a ligand against the resting apo PAS-B
        structure and you will not find the site, because in that snapshot
        the cavity is closed and buried. You have to sample the receptor
        conformation that opens it &mdash; through an ensemble of structures,
        an induced-fit protocol, or an experimentally liganded template
        &mdash; before the pocket is even there to dock into. Belzutifan is
        the clinical proof that these cryptic, transiently open cavities are
        worth chasing.
      </p>

      <h2>Try the cryptic-pocket workflow yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and set up a docking run against a receptor with a known buried or
        allosteric cavity, then compare docking into a single rigid
        structure versus an ensemble of receptor conformations &mdash; the
        difference is exactly what separates finding a HIF-2-style hidden
        pocket from missing it entirely. Our companion write-ups on{" "}
        <Link
          to="/blog/cryptic-allosteric-pockets-docking"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          cryptic and allosteric pockets
        </Link>{" "}
        and{" "}
        <Link
          to="/blog/ensemble-docking-multiple-receptor-conformations"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          ensemble docking
        </Link>{" "}
        walk through the protocol choices in detail.
      </p>
      <p>
        Because Liganx offers molecular docking online and free, you can run
        an ensemble docking experiment against a cryptic pocket in the
        browser without setting up a local molecular docking toolchain.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Scheuermann TH, et al. <em>Artificial ligand binding within the
          HIF2&alpha; PAS-B domain of the HIF2 transcription factor.</em>{" "}
          Proc Natl Acad Sci USA 106, 450&ndash;455 (2009).{" "}
          <a
            href="https://doi.org/10.1073/pnas.0808092106"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1073/pnas.0808092106
          </a>
        </li>
        <li>
          Cho H, et al. <em>On-target efficacy of a HIF-2&alpha; antagonist
          in preclinical kidney cancer models.</em> Nature 539, 107&ndash;111
          (2016).{" "}
          <a
            href="https://doi.org/10.1038/nature19795"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nature19795
          </a>
        </li>
        <li>
          Chen W, et al. <em>Targeting renal cell carcinoma with a HIF-2
          antagonist.</em> Nature 539, 112&ndash;117 (2016).{" "}
          <a
            href="https://doi.org/10.1038/nature19796"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nature19796
          </a>
        </li>
        <li>
          Choueiri TK, et al. <em>Belzutifan versus Everolimus for Advanced
          Renal-Cell Carcinoma (LITESPARK-005).</em> N Engl J Med 391,
          710&ndash;721 (2024).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2313906"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2313906
          </a>
        </li>
        <li>
          U.S. Food &amp; Drug Administration. <em>FDA approves belzutifan
          with pembrolizumab for adjuvant treatment of renal cell
          carcinoma</em> (12 June 2026).{" "}
          <a
            href="https://www.fda.gov/drugs/resources-information-approved-drugs/fda-approves-belzutifan-pembrolizumab-adjuvant-treatment-renal-cell-carcinoma"
            target="_blank"
            rel="noreferrer noopener"
          >
            fda.gov
          </a>
        </li>
      </ul>
    </>
  );
}
