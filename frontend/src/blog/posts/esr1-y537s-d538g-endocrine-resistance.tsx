/**
 * Post: ESR1 Y537S / D538G - the ligand-binding-domain mutations that
 * break aromatase inhibitors, and the SERD that survives them.
 *
 * SEO target: "ESR1 mutation breast cancer", "Y537S D538G resistance",
 * "elacestrant ESR1". Internal CTA into /studio with ESR1 + Y537S
 * pre-loaded so the reader can dock against the constitutively active
 * mutant LBD.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "esr1-y537s-d538g-endocrine-resistance",
  title: "ESR1 Y537S and D538G: the mutations that switch ER on",
  description:
    "How the two most common ESR1 ligand-binding-domain mutations lock the estrogen receptor in its active state, why aromatase inhibitors fail, and which SERD still works.",
  date: "2026-06-29",
  author: "Liganx team",
  tags: ["esr1", "breast-cancer", "resistance", "endocrine-therapy"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Most resistance mutations weaken a drug&rsquo;s grip on its target.
        The ESR1 hotspots do something stranger: they make the estrogen
        receptor stop needing estrogen at all. Y537S and D538G lock the
        receptor in its &ldquo;on&rdquo; conformation, so a class of drugs
        that works by starving the receptor of its hormone simply has
        nothing left to starve. That single mechanistic fact explains a
        decade of clinical failures and the one approval that beat them.
      </p>

      <h2>Where the mutations sit and what they do</h2>
      <p>
        ESR1 encodes estrogen receptor alpha (ERα). The receptor&rsquo;s
        ligand-binding domain ends in a short stretch called helix 12
        (H12), which acts as a lid. When estradiol (E2) binds, H12 folds
        down into the agonist position and creates the activation
        function-2 (AF-2) surface that recruits coactivators and turns on
        transcription. No hormone, no folded lid, no signal. That is the
        whole logic of endocrine therapy.
      </p>
      <p>
        Y537 and D538 sit in the loop that connects helix 11 to H12 and
        are by far the two most frequently mutated residues, together
        accounting for more than half of all ESR1 mutants found in the
        clinic. Fanning et al. (2016) showed structurally what they do:
        Y537S, and to a lesser degree D538G, stabilize H12 in the agonist
        conformation even when no ligand is present. The receptor adopts
        the active shape on its own. This is constitutive, ligand-
        independent activation.
      </p>
      <ul>
        <li>
          <strong>Y537S</strong> replaces a tyrosine with serine, removing
          a hydrogen-bond network and letting H12 settle into the active
          pose. It is the strongest and most resistant of the hotspots.
        </li>
        <li>
          <strong>D538G</strong> sits one residue over and produces a
          milder version of the same effect via altered backbone
          flexibility in the H11-H12 loop.
        </li>
      </ul>

      <h2>Why they show up only after treatment</h2>
      <p>
        ESR1 mutations are vanishingly rare in untreated primary tumors
        but appear in roughly 20-40% of ER-positive metastatic cancers
        that have progressed on endocrine therapy (Toy et al., 2013;
        Robinson et al., 2013). They are an acquired escape, selected for
        under the pressure of estrogen deprivation. The clinical
        consequence is direct:
      </p>
      <ul>
        <li>
          <strong>Aromatase inhibitors</strong> (letrozole, anastrozole,
          exemestane) work by lowering circulating estrogen. A receptor
          that no longer needs estrogen is unaffected. AIs lose the most.
        </li>
        <li>
          <strong>Tamoxifen</strong> competes for the ligand pocket but
          the mutant&rsquo;s shifted conformational equilibrium blunts its
          antagonism.
        </li>
        <li>
          <strong>Selective estrogen receptor degraders (SERDs)</strong>
          do not rely on hormone deprivation. They bind the receptor and
          drive its degradation, so an estrogen-independent receptor is
          still a target. This is why SERDs keep working when AIs fail.
        </li>
      </ul>

      <h2>Elacestrant: the SERD that earned an ESR1 label</h2>
      <p>
        Elacestrant (Orserdu) is an oral SERD. The FDA approved it on
        January 27, 2023 specifically for ER-positive, HER2-negative
        advanced breast cancer with an ESR1 mutation, after progression on
        at least one line of endocrine therapy. It is the first targeted
        therapy approved on the basis of an ESR1 mutation, paired with a
        companion liquid-biopsy assay.
      </p>
      <p>
        The approval rests on the phase III EMERALD trial (Bidard et al.,
        2022). Among the 228 patients with detectable ESR1 mutations,
        median progression-free survival was 3.8 months on elacestrant
        versus 1.9 months on standard-of-care endocrine therapy (hazard
        ratio 0.55). The absolute numbers look modest because this is a
        heavily pretreated metastatic population, but the relative benefit
        was concentrated in exactly the mutant subgroup the drug was
        designed for. Later analyses showed the benefit was largest in
        patients who had a longer prior run on a CDK4/6 inhibitor, a proxy
        for endocrine-sensitive disease.
      </p>
      <p>
        Elacestrant retains activity against models carrying Y537S and
        D538G, the two hotspots that defeat aromatase inhibitors. The
        broader field, including next-generation oral SERDs and ER
        PROTACs, is being built around the same premise: degrade the
        receptor rather than try to out-compete a hormone the mutant no
        longer needs.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick ESR1 from the target catalog with the Y537S mutation
        chip. Dock a ligand against both the wild-type and Y537S
        ligand-binding domain and compare the poses: the mutant&rsquo;s H12
        is biased toward the agonist conformation, which is the structural
        reason antagonists lose grip. The interesting readout here is not
        a single binding score but the ΔΔ between wild-type and mutant,
        because the resistance story is conformational, not a clean loss
        of contacts. Liganx renders both receptors side by side so you can
        see it.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and set
        up for mutation questions like this one. Running molecular docking
        against ESR1 Y537S is a fast way to build intuition for why a SERD
        beats an aromatase inhibitor in this setting.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Fanning SW, et al. <em>Estrogen receptor alpha somatic mutations
          Y537S and D538G confer breast cancer endocrine resistance by
          stabilizing the activating function-2 binding conformation.</em>{" "}
          eLife 5, e12792 (2016).{" "}
          <a
            href="https://doi.org/10.7554/eLife.12792"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.7554/eLife.12792
          </a>
        </li>
        <li>
          Toy W, et al. <em>ESR1 ligand-binding domain mutations in
          hormone-resistant breast cancer.</em> Nat Genet 45, 1439-1445
          (2013).{" "}
          <a
            href="https://doi.org/10.1038/ng.2822"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/ng.2822
          </a>
        </li>
        <li>
          Bidard FC, et al. <em>Elacestrant (oral selective estrogen
          receptor degrader) versus standard endocrine therapy for
          estrogen receptor-positive, HER2-negative advanced breast
          cancer: results from the randomized phase III EMERALD trial.</em>{" "}
          J Clin Oncol 40, 3246-3256 (2022).{" "}
          <a
            href="https://doi.org/10.1200/JCO.22.00338"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1200/JCO.22.00338
          </a>
        </li>
      </ul>
    </>
  );
}
