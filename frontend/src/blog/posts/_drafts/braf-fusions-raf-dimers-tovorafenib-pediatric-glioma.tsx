/**
 * Post: BRAF fusions and RAF dimers - why V600 drugs fail and tovorafenib works
 *
 * SEO target: "BRAF fusion", "KIAA1549-BRAF", "RAF dimer inhibitor",
 * "tovorafenib mechanism", "type II RAF inhibitor". Internal CTA into
 * /studio with BRAF so the reader can contrast a V600E monomer binder
 * against the dimer-driven fusion biology.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "braf-fusions-raf-dimers-tovorafenib-pediatric-glioma",
  title: "BRAF fusions: why V600E drugs fail and tovorafenib works",
  description:
    "BRAF fusions signal as constitutive RAF dimers, so vemurafenib-class drugs fail or paradoxically activate them. Here is the structural reason and what type II inhibitors do differently.",
  date: "2026-07-15",
  author: "Liganx team",
  tags: ["braf", "oncology", "resistance", "docking-method"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Most people meet BRAF through V600E &mdash; the single point mutation
        that made vemurafenib and dabrafenib famous in melanoma. But a whole
        second class of BRAF alterations behaves nothing like V600E, breaks
        the same drugs that beat V600E, and shows up as the defining lesion
        in the most common childhood brain tumor. If you dock against BRAF
        without knowing which class you are looking at, your scores will
        mislead you.
      </p>

      <h2>Two ways to break BRAF</h2>
      <p>
        V600E is a <strong>class I</strong> alteration. The valine-to-glutamate
        swap in the activation loop locks the kinase in an active conformation
        that signals as a <em>monomer</em>, independent of upstream RAS. That
        monomeric behavior is exactly why vemurafenib works: it is a
        RAF-monomer-selective inhibitor, and a lesion that signals as a monomer
        is a lesion it can shut off.
      </p>
      <p>
        BRAF fusions are a different animal. The classic one in pediatric
        low-grade glioma is <strong>KIAA1549-BRAF</strong>, an in-frame fusion
        that splices an N-terminal partner onto the intact BRAF kinase domain.
        The fusion deletes BRAF&rsquo;s own autoinhibitory N-terminal region and
        replaces it with a partner that drives <strong>constitutive
        dimerization</strong>. The result is a kinase that is always on and,
        critically, always working as a dimer.
      </p>

      <h2>Why a monomer-selective drug fails on a dimer</h2>
      <p>
        RAF dimers have a structural quirk that first-generation inhibitors
        never solved: <strong>negative cooperativity</strong> between the two
        protomers. When vemurafenib binds one protomer of the dimer, it pushes
        that subunit into a DFG-in / alpha-C-out conformation, which
        allosterically drives the <em>partner</em> protomer into a drug-free
        active state. So the drug you added ends up switching the other half of
        the dimer on. In a fusion that is already a constitutive dimer, this is
        not a rare edge case &mdash; it is the default outcome.
      </p>
      <p>
        This is the molecular basis of <strong>paradoxical activation</strong>:
        add a monomer-selective BRAF inhibitor to fusion-driven cells and MEK
        phosphorylation goes <em>up</em>, not down. Sievert and colleagues
        showed exactly this for KIAA1549-BRAF fusions in pediatric astrocytoma
        models &mdash; PLX4720 (the vemurafenib tool analog) paradoxically
        activated the pathway rather than inhibiting it. It is the same
        mechanism behind the cutaneous squamous-cell lesions seen when
        vemurafenib is given to melanoma patients with wild-type BRAF in
        normal skin.
      </p>

      <h2>Type II inhibitors and tovorafenib</h2>
      <p>
        The fix is to stop fighting the dimer and inhibit it directly. Type II
        RAF inhibitors bind the DFG-out, inactive conformation and hold onto
        both protomers of the dimer, so there is no drug-free partner left to
        activate. <strong>Tovorafenib</strong> (Ojemda) is the first of these
        to reach approval in this setting.
      </p>
      <ul>
        <li>
          <strong>Tovorafenib (Ojemda)</strong> &mdash; a type II, pan-RAF
          inhibitor that targets both BRAF and CRAF in their dimer state.
          FDA accelerated approval April 2024 for relapsed or refractory
          pediatric low-grade glioma harboring a BRAF fusion or rearrangement,
          or a BRAF V600 mutation. It is the first systemic therapy approved
          for BRAF-rearranged pLGG.
        </li>
        <li>
          <strong>FIREFLY-1 (NCT04775485)</strong> &mdash; the single-arm phase
          2 trial behind the approval, in patients 6 months to 25 years with an
          activating BRAF alteration after prior systemic therapy. Radiologic
          overall response rate was roughly 51% by RAPNO criteria, the primary
          endpoint.
        </li>
        <li>
          <strong>Why pan-RAF matters here</strong> &mdash; because the fusion
          signals as a dimer, and because CRAF can substitute inside RAF
          dimers, an inhibitor that only touches monomeric BRAF leaves an
          escape route. Hitting the dimer covers both.
        </li>
      </ul>

      <h2>What this means for docking</h2>
      <p>
        A docking box drawn around the BRAF ATP pocket will happily score
        vemurafenib against the fusion kinase domain, and the number will look
        fine &mdash; because the pocket is intact. The score cannot see that
        the pocket is one half of a dimer whose partner is about to be
        switched on. This is the recurring trap with allosteric and
        dimer-driven biology: <strong>the binding pose is real, the cellular
        consequence is the opposite of what the pose suggests</strong>.
      </p>
      <p>
        The practical move is to compare inhibitor <em>classes</em> rather than
        trust a single absolute score. Dock a type I monomer binder and a type
        II DFG-out binder into the same BRAF structure and look at where each
        sits relative to the DFG motif and the alpha-C helix. The type II pose
        that reaches past the gatekeeper into the back pocket is the one whose
        biology survives dimerization; the type I pose that only occupies the
        adenine pocket is the one at risk of paradoxical activation on a fusion
        background.
      </p>
      <p>
        Liganx puts molecular docking online and free in the browser, which
        makes this kind of class-versus-class comparison a two-minute
        experiment rather than a modeling project.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick BRAF from the target catalog. Dock a type I binder
        (vemurafenib, dabrafenib) and a type II / pan-RAF binder against the
        V600E structure and compare the poses in the viewer. The point is not
        a single -10 kcal/mol score &mdash; it is seeing which chemotype
        reaches the DFG-out back pocket, the structural feature that separates
        a drug that controls RAF dimers from one that can inadvertently fire
        them.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Sievert AJ, et al. <em>Paradoxical activation and RAF inhibitor
          resistance of BRAF protein kinase fusions characterizing pediatric
          astrocytomas.</em> Proc Natl Acad Sci USA 110, 5957&ndash;5962 (2013).{" "}
          <a
            href="https://pubmed.ncbi.nlm.nih.gov/23533272/"
            target="_blank"
            rel="noreferrer noopener"
          >
            PMID:23533272
          </a>
        </li>
        <li>
          U.S. Food and Drug Administration. <em>FDA grants accelerated
          approval to tovorafenib for patients with relapsed or refractory
          BRAF-altered pediatric low-grade glioma.</em> April 23, 2024.{" "}
          <a
            href="https://www.fda.gov/drugs/resources-information-approved-drugs/fda-grants-accelerated-approval-tovorafenib-patients-relapsed-or-refractory-braf-altered-pediatric"
            target="_blank"
            rel="noreferrer noopener"
          >
            fda.gov
          </a>
        </li>
        <li>
          <em>FDA Approval Summary: Tovorafenib for Relapsed or Refractory
          BRAF-altered Pediatric Low-Grade Glioma.</em> Clin Cancer Res (2025).{" "}
          <a
            href="https://pmc.ncbi.nlm.nih.gov/articles/PMC11996598/"
            target="_blank"
            rel="noreferrer noopener"
          >
            PMC11996598
          </a>
        </li>
      </ul>
    </>
  );
}
