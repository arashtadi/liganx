/**
 * Post: AR ligand-binding domain mutations — when your antagonist
 * becomes the tumour's agonist.
 *
 * SEO target: "AR F877L", "AR T878A", "enzalutamide resistance mutation",
 * "androgen receptor ligand binding domain mutation", "L702H prednisone".
 * Internal CTA into /studio for wild-type vs LBD-mutant docking with an
 * emphasis on helix 12 positioning.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "androgen-receptor-lbd-mutations-antagonist-to-agonist",
  title: "AR mutations that turn antiandrogens into agonists",
  description:
    "F877L, T878A, L702H and W742C do not block the drug from binding. They keep it bound and flip it from antagonist to agonist, which is a harder problem to model.",
  date: "2026-08-02",
  author: "Liganx team",
  tags: ["androgen-receptor", "prostate-cancer", "resistance", "enzalutamide", "nuclear-receptor"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Most resistance mutations you learn about in oncology work by
        exclusion: a gatekeeper residue swells and the inhibitor no longer
        fits, or a solvent-front side chain clashes with the tail of the
        molecule. The androgen receptor does something stranger. Its
        ligand-binding domain mutations often <em>improve</em> drug binding.
        The drug stays in the pocket, and the tumour reads it as a hormone.
      </p>

      <h2>Why the mechanism is different</h2>
      <p>
        AR is a nuclear receptor, not a kinase. Its ligand-binding domain has
        no catalytic site to block. Antagonism works allosterically: the
        antagonist occupies the pocket in a way that leaves helix 12 unable
        to dock into the agonist position, so the AF-2 surface never forms
        and coactivators are never recruited. Agonism and antagonism are
        therefore the same binding event with two different helix 12
        outcomes, separated by a couple of kilocalories.
      </p>
      <p>
        That is a much shallower energetic barrier than a steric clash, and it
        is why single point mutations lining the pocket can flip the sign of
        the pharmacology rather than simply reducing affinity. A note on
        numbering before the mutation list: the older literature uses AR
        numbering that runs one residue behind the current convention, so
        F876L and F877L are the same mutation, as are T877A and T878A, W741C
        and W742C, L701H and L702H, H874Y and H875Y. Both conventions still
        appear in active clinical papers.
      </p>

      <h2>The mutations that matter clinically</h2>
      <ul>
        <li>
          <strong>F877L</strong> converts the second-generation antiandrogens
          enzalutamide and apalutamide from antagonists into agonists.
          Korpal and colleagues derived it from LNCaP cells under enzalutamide
          selection; Joseph and colleagues found it independently in
          apalutamide-resistant models and, importantly, detected it in plasma
          DNA from apalutamide-treated patients with progressive
          castration-resistant disease. It was one of the earliest
          demonstrations that a resistance allele could be tracked in ctDNA
          before it was tracked in tissue.
        </li>
        <li>
          <strong>T878A</strong> is the classic LNCaP mutation. It confers
          agonism to the first-generation antiandrogens flutamide and
          bicalutamide and lets progesterone stimulate the receptor
          promiscuously.
        </li>
        <li>
          <strong>F877L plus T878A</strong> is where the pharmacology gets
          decisive. Prekovic and colleagues showed that enzalutamide is only
          a very weak partial agonist of AR F877L on its own, and that strong
          agonist activity requires the double mutant. Ligand-binding assays
          confirmed F877L raises relative affinity for enzalutamide, and the
          modelling showed the double mutation relieves steric clashes; the
          functional readout followed in coregulator recruitment and chromatin
          binding. The lesson is that single-mutation panels can understate
          the problem.
        </li>
        <li>
          <strong>L702H</strong> is the glucocorticoid mutation. It broadens
          the pocket to be activated by corticosteroids, which matters
          enormously in practice because prednisone is co-administered with
          abiraterone. Serial ctDNA sequencing studies have repeatedly found
          L702H among the most frequently emerging LBD mutations.
        </li>
        <li>
          <strong>W742C</strong> and <strong>H875Y</strong> round out the
          recurring set, with W742C classically associated with bicalutamide
          agonism.
        </li>
      </ul>
      <p>
        These alleles are not mutually exclusive. Structures of compound
        mutants exist, including a crystal structure of the L702H/H875Y/F877L/T878A
        quadruple mutant LBD with DHT bound (PDB 8FGY), which is a useful
        receptor to have in an ensemble precisely because it represents the
        heavily pretreated end state rather than a clean single substitution.
      </p>

      <h2>What this does to a docking campaign</h2>
      <p>
        The uncomfortable implication is that a better docking score against
        the mutant is not good news. If your scoring function ranks a
        candidate more favourably against AR F877L than against wild type,
        that is precisely the profile of a compound that has become an
        agonist in the resistant setting. Affinity and functional direction
        have decoupled.
      </p>
      <p>
        Three practical consequences for anyone modelling this target:
      </p>
      <ul>
        <li>
          <strong>Score the helix 12 state, not just the ligand.</strong> The
          question is whether the bound pose is compatible with helix 12
          docking into the AF-2 groove. Balbas and colleagues used molecular
          dynamics on antiandrogen-AR complexes to show that F876L relieves
          antagonism through repositioning of that helix, then used the model
          to run a focused chemical screen that produced three compounds
          antagonising both the mutant and wild-type receptor. Structure-based
          design against AR is really design against a conformational
          equilibrium.
        </li>
        <li>
          <strong>Dock against compound mutants, not just singles.</strong>
          The F877L/T878A result says the interesting behaviour can be
          emergent.
        </li>
        <li>
          <strong>Include the steroid ligands in the panel.</strong> For L702H
          the failure mode is a corticosteroid activating the receptor, so
          docking prednisolone and cortisol against the mutant tells you
          something a candidate-only panel cannot.
        </li>
      </ul>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and build an AR ligand-binding domain panel: wild type, F877L, T878A,
        the F877L/T878A double, and L702H. Dock enzalutamide, apalutamide and
        bicalutamide across all five and read the &Delta;&Delta; per mutant
        rather than the absolute scores, then repeat with the endogenous
        steroids to see which mutants open the pocket to promiscuous
        activation. Our write-ups on{" "}
        <Link
          to="/blog/ddg-vs-absolute-docking-scores"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          why &Delta;&Delta; beats absolute scores
        </Link>{" "}
        and on{" "}
        <Link
          to="/blog/ensemble-docking-multiple-receptor-conformations"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          ensemble docking
        </Link>{" "}
        cover the protocol, and the ensemble piece matters more than usual
        here because the agonist and antagonist conformations of the receptor
        are genuinely different structures.
      </p>
      <p>
        Liganx runs molecular docking online in the browser, so a
        five-receptor mutant panel is a molecular docking setup you can build
        in an afternoon without a local toolchain. Just remember that the
        score tells you about binding, and for AR the clinical question is
        about direction.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Korpal M, Korn JM, Gao X, et al. <em>An F876L mutation in androgen
          receptor confers genetic and phenotypic resistance to MDV3100
          (enzalutamide).</em> Cancer Discov 3, 1030-1043 (2013).{" "}
          <a
            href="https://doi.org/10.1158/2159-8290.CD-13-0142"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2159-8290.CD-13-0142
          </a>
        </li>
        <li>
          Joseph JD, Lu N, Qian J, et al. <em>A clinically relevant androgen
          receptor mutation confers resistance to second-generation
          antiandrogens enzalutamide and ARN-509.</em> Cancer Discov 3,
          1020-1029 (2013).{" "}
          <a
            href="https://doi.org/10.1158/2159-8290.CD-13-0226"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2159-8290.CD-13-0226
          </a>
        </li>
        <li>
          Balbas MD, Evans MJ, Hosfield DJ, et al. <em>Overcoming
          mutation-based resistance to antiandrogens with rational drug
          design.</em> eLife 2, e00499 (2013).{" "}
          <a
            href="https://doi.org/10.7554/eLife.00499"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.7554/eLife.00499
          </a>
        </li>
        <li>
          Prekovic S, van Royen ME, Voet ARD, et al. <em>The effect of F877L
          and T878A mutations on androgen receptor response to
          enzalutamide.</em> Mol Cancer Ther 15, 1702-1712 (2016).{" "}
          <a
            href="https://doi.org/10.1158/1535-7163.MCT-15-0892"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/1535-7163.MCT-15-0892
          </a>
        </li>
        <li>
          RCSB PDB.{" "}
          <a
            href="https://www.rcsb.org/structure/8FGY"
            target="_blank"
            rel="noreferrer noopener"
          >
            8FGY: crystal structure of mutant androgen receptor ligand-binding
            domain L702H/H875Y/F877L/T878A with DHT
          </a>
        </li>
      </ul>
    </>
  );
}
