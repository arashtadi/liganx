/**
 * Post: AlphaFold for docking — when the predicted structure is usable,
 * when it isn't, and how to tell the difference before you waste a screen.
 *
 * SEO target: "AlphaFold docking", "AlphaFold virtual screening",
 * "AlphaFold2 protein structure for docking", "AlphaFold pLDDT pocket".
 * Internal CTA into /studio noting that Liganx uses crystal structures
 * by default but falls back to AlphaFold for targets without one.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "alphafold-structures-for-docking",
  title: "AlphaFold for docking: when the predicted structure is usable",
  description:
    "What the validation literature actually says about AlphaFold2 and AlphaFold3 structures as docking targets, and the pre-flight checks that catch the failure modes before they cost you a screen.",
  date: "2026-05-13",
  author: "Liganx team",
  tags: ["alphafold", "docking-method", "virtual-screening"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        AlphaFold has unblocked targets that had no crystal structure for
        decades. It has also generated a steady stream of plausible-looking
        models that fail silently when you run a docking screen against them.
        The distinction matters for any program trying to use AlphaFold to
        replace, rather than supplement, experimental structure. Here is
        what the validation literature actually shows, and the pre-flight
        checks that flag a model as risky before you commit a screen to it.
      </p>

      <h2>What AlphaFold gets right (and how well)</h2>
      <p>
        AlphaFold2 (Jumper et al., Nature 2021) produces backbone
        coordinates that are, on average, within experimental resolution
        for well-folded globular domains. The original CASP14 results put
        median backbone RMSD around 1 Å for domains where the model was
        confident (per-residue pLDDT &gt; 90). AlphaFold3 (Abramson et al.,
        Nature 2024) extends the same architecture to protein-ligand and
        protein-nucleic-acid complexes, with reported success on PoseBusters
        v1 above the level of conventional docking pipelines.
      </p>
      <p>
        For a docking user the practical translation: if your binding site
        sits inside a high-pLDDT region (call it &gt; 85 across every
        pocket residue), the backbone you&rsquo;re docking against is most
        likely a faithful representation of the underlying fold. Most
        kinase and GPCR cores fall into this regime. Many active-site
        loops, post-translational-modification sites, and intrinsically
        flexible regions do not.
      </p>

      <h2>Where it falls down — the failure modes that matter for docking</h2>
      <ul>
        <li>
          <strong>Side-chain rotamers in the pocket.</strong> Karelina,
          Noh and Dror (eLife 2023) docked against AlphaFold2 models for
          a panel of GPCRs and kinases. Backbone was generally fine; pocket
          side chains were often in the wrong rotamer relative to the
          holo (ligand-bound) crystal. The result was that pose recovery
          was significantly worse than against crystal structures, even
          when the backbone RMSD was &lt; 1.5 Å. Side-chain prediction is
          a different problem than backbone prediction, and a 90+ pLDDT
          does not promise the rotamer is right.
        </li>
        <li>
          <strong>Apo-like conformations.</strong> AlphaFold tends to
          produce one conformational state, and it is trained on a database
          dominated by apo and holo crystal structures with no preference
          signal between them. For targets where the pocket opens on
          ligand binding (induced fit), the predicted structure may show
          a closed pocket that no inhibitor can reach. Díaz-Rovira et al.
          (J Chem Inf Model 2023) reported degraded virtual-screening
          performance against AlphaFold structures relative to holo
          crystals on a DUD-E benchmark, with closed pockets a frequent
          cause.
        </li>
        <li>
          <strong>Disordered loops near the active site.</strong> Low-pLDDT
          loops can be physically real (the protein is disordered there)
          or a confidence artifact. In either case, docking against a
          poorly-modeled loop next to the pocket pollutes the pose with
          spurious clashes or false contacts. The mitigation is usually
          a short MD relaxation of the loop, or — better — choosing a
          template that doesn&rsquo;t have a disordered loop adjacent to
          the pocket.
        </li>
        <li>
          <strong>Cofactor and metal-binding sites.</strong> AlphaFold2
          predicts unligated protein. If your target needs Mg<sup>2+</sup>,
          Zn<sup>2+</sup>, heme, NADP, or another cofactor for catalytic
          competence, the prediction will not place it. AlphaFold3 closes
          part of this gap by co-predicting common cofactors, but the
          published accuracy is uneven across cofactor classes.
        </li>
      </ul>

      <h2>The pre-flight checks worth running</h2>
      <p>
        Before committing a virtual screen to an AlphaFold structure:
      </p>
      <ul>
        <li>
          <strong>Pocket-residue pLDDT scan.</strong> Identify the pocket
          (CASTp, fpocket, or a known ligand-contact set if a homolog
          structure exists) and average the per-residue pLDDT across just
          the pocket-lining residues. If that average is below ~80, treat
          the screen as exploratory only.
        </li>
        <li>
          <strong>Sidechain sanity against any known holo template.</strong>
          If any homolog of your target has been crystallized with a
          ligand, superpose and compare pocket side-chain orientations.
          A handful of wrong rotamers is normal; a wholesale rearrangement
          is the signal that the apo prediction has the wrong pocket
          shape.
        </li>
        <li>
          <strong>Pocket volume check.</strong> Compute the pocket volume
          on the predicted structure and on the closest holo homolog. If
          the AlphaFold pocket is &gt; 30% smaller, the structure is most
          likely in an apo-like closed conformation. Either model an
          induced-fit step or look for an alternative structure.
        </li>
        <li>
          <strong>Self-dock a known binder.</strong> If even one ligand is
          known for the target or a close homolog, dock it against the
          AlphaFold structure and check whether the top pose recapitulates
          the published binding mode. If it doesn&rsquo;t, your screen on
          unknown chemistry will not either.
        </li>
      </ul>

      <h2>When AlphaFold is the right call anyway</h2>
      <p>
        Despite the failure modes, the alternative on a target with no
        crystal structure is almost always worse: homology modeling from a
        distant template, a one-off cryo-EM map at low resolution, or
        nothing at all. AlphaFold gets you into the screening regime
        earlier than the experimental pipeline ever could. The discipline
        is to treat the predicted structure as a starting hypothesis
        rather than as ground truth — a tool that points to a hit list
        that still needs orthogonal confirmation (biophysics, mutagenesis,
        or eventually a co-crystal) before it advances.
      </p>

      <h2>Try it yourself</h2>
      <p>
        Liganx uses experimental crystal structures by default for every
        target in its catalog and falls back to AlphaFold only for targets
        that lack one. When an AlphaFold structure is used, the target
        card surfaces the average pLDDT across pocket residues so you can
        see at a glance whether the model is in the high-confidence regime.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick any target — for the kinases that have co-crystals with
        approved inhibitors, dock the known binder first and confirm the
        pose looks right before you screen unknown chemistry. That single
        self-docking check catches most of the silent failures the
        validation papers warn about.
      </p>
      <p>
        Liganx brings molecular docking online into the browser, so you
        can run a self-docking check and screen against a predicted or
        experimental structure without standing up a local pipeline.
        Molecular docking is only as good as the structure underneath
        it, and the target card tells you which kind you are working
        with.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Jumper J, et al. <em>Highly accurate protein structure prediction
          with AlphaFold.</em> Nature 596, 583-589 (2021).{" "}
          <a
            href="https://doi.org/10.1038/s41586-021-03819-2"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41586-021-03819-2
          </a>
        </li>
        <li>
          Abramson J, et al. <em>Accurate structure prediction of biomolecular
          interactions with AlphaFold 3.</em> Nature 630, 493-500 (2024).{" "}
          <a
            href="https://doi.org/10.1038/s41586-024-07487-w"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41586-024-07487-w
          </a>
        </li>
        <li>
          Karelina M, Noh JJ, Dror RO. <em>How accurately can one predict
          drug binding modes using AlphaFold models?</em> eLife 12, RP89386
          (2023).{" "}
          <a
            href="https://doi.org/10.7554/eLife.89386"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.7554/eLife.89386
          </a>
        </li>
        <li>
          Díaz-Rovira AM, et al. <em>Are deep learning structural models
          sufficient for virtual screening?</em> J Chem Inf Model 63,
          1668-1674 (2023).{" "}
          <a
            href="https://doi.org/10.1021/acs.jcim.2c01270"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jcim.2c01270
          </a>
        </li>
      </ul>
    </>
  );
}
