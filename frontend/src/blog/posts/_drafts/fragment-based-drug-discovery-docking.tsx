/**
 * Post: Fragment-based drug discovery and why fragment docking is different
 *
 * SEO target: "fragment-based drug discovery", "fragment docking",
 * "ligand efficiency fragments", "FBDD vemurafenib". Internal CTA into
 * /studio, using BRAF (vemurafenib) and ABL (asciminib) as the two
 * approved fragment-derived drugs the reader can dock.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "fragment-based-drug-discovery-docking",
  title: "Fragment-based drug discovery: why fragment docking is harder",
  description:
    "Fragments bind weakly but efficiently, and that breaks the assumptions docking scores rely on. Here is how FBDD works and how to dock fragments without being fooled by their scores.",
  date: "2026-07-15",
  author: "Liganx team",
  tags: ["docking-method", "medicinal-chemistry", "ligand-efficiency"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        A typical drug-like molecule weighs 350 to 500 Da and makes a dozen
        contacts with its target. A fragment weighs 150 to 250 Da and might
        make three or four. Fragment-based drug discovery starts from those
        tiny, weak binders on purpose &mdash; and the reasons it works are the
        same reasons ordinary docking scores lie to you about fragments.
      </p>

      <h2>Why start small</h2>
      <p>
        The case for fragments is a numbers argument. Chemical space grows
        combinatorially with molecular size, so the space of possible fragments
        (say, up to 17 heavy atoms) is vastly smaller than the space of
        lead-sized molecules. A library of a few thousand well-chosen fragments
        samples its slice of chemical space far more densely than a
        million-compound lead library samples its slice. If a fragment binds at
        all, it tends to make a small number of high-quality contacts &mdash;
        which is exactly what you want as a starting point to grow from.
      </p>
      <p>
        The catch: fragments bind <em>weakly</em>. Affinities in the high
        micromolar to millimolar range are normal and expected. That is too
        weak for most functional assays, so FBDD leans on biophysical detection
        &mdash; X-ray crystallography, protein-observed and ligand-observed NMR,
        and surface plasmon resonance &mdash; that can see a real but weak
        binding event and, ideally, tell you exactly where the fragment sits.
      </p>

      <h2>Ligand efficiency, not potency</h2>
      <p>
        The metric that makes fragments make sense is <strong>ligand
        efficiency</strong> (LE): binding energy per heavy atom. A 200 Da
        fragment with a 1 mM affinity looks unimpressive until you notice it is
        extracting a large amount of binding energy from very few atoms. Grow
        that fragment carefully and you can carry its high efficiency up to a
        nanomolar lead. Start from a bloated micromolar hit instead and you are
        often stuck &mdash; there is no room to add potency without blowing
        past drug-like size. This is why an FBDD campaign optimizes LE first
        and raw potency second.
      </p>
      <p>
        This is also where it connects to everything else in a docking
        workflow: the number to watch for a fragment is not the docking score,
        it is the score <em>divided by heavy-atom count</em>. A fragment that
        scores -6 kcal/mol on eight heavy atoms is a far better lead than one
        that scores -8 on twenty-five.
      </p>

      <h2>It actually produces drugs</h2>
      <ul>
        <li>
          <strong>Vemurafenib (BRAF V600E)</strong> &mdash; the proof of
          concept. Plexxikon screened a fragment library by X-ray and
          biochemistry, found a 7-azaindole fragment sitting in the BRAF ATP
          pocket, and elaborated it over multiple cycles into a ~490 Da
          nanomolar inhibitor. Approved in 2011, it was the first drug from a
          fragment-based campaign to reach the market.
        </li>
        <li>
          <strong>Venetoclax (BCL-2)</strong> &mdash; a fragment-and-SAR-by-NMR
          lineage that drugged a protein-protein interaction long considered
          undruggable, by linking fragments occupying adjacent hot spots on the
          BCL-2 surface.
        </li>
        <li>
          <strong>Asciminib (BCR-ABL1)</strong> &mdash; the allosteric myristoyl
          pocket binder for CML grew out of a fragment and structure-guided
          campaign. It binds outside the ATP site entirely, which is how it
          sidesteps ATP-pocket resistance mutations like T315I.
        </li>
      </ul>

      <h2>Why fragment docking is genuinely harder</h2>
      <p>
        Docking was built and benchmarked on lead-sized molecules, and
        fragments violate several of its working assumptions:
      </p>
      <ul>
        <li>
          <strong>The signal is small.</strong> A few kcal/mol of true binding
          energy is inside the error bars of most scoring functions. The
          rank-ordering you trust for leads is much noisier for fragments.
        </li>
        <li>
          <strong>Poses are ambiguous.</strong> A small fragment can fit a
          pocket several ways with nearly identical scores. Without the anchor
          of many simultaneous contacts, the &ldquo;top&rdquo; pose is often
          one of several near-degenerate options.
        </li>
        <li>
          <strong>Placement matters more than affinity.</strong> For a fragment
          you care less about how tightly it binds and more about <em>where</em>
          and in what orientation, because that determines the growth vectors
          available to medicinal chemistry. A pose that points a substitutable
          position toward open space is worth more than a slightly better score
          pointing into a wall.
        </li>
      </ul>
      <p>
        The practical response is to lean on consensus and validation rather
        than a single score: retain multiple poses per fragment, cross-check
        with a second scoring function, sanity-check geometry with a pose
        validator, and rank on ligand efficiency. Where an experimental
        fragment structure exists, use it to anchor the pose and dock analogs
        into that frame rather than re-predicting placement from scratch.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick BRAF, then dock vemurafenib &mdash; the archetypal
        fragment-grown drug &mdash; and watch how much of the ATP pocket the
        full molecule fills compared to the small azaindole core it grew from.
        Then pick ABL and dock asciminib to see a fragment-derived binder that
        lives in the allosteric myristoyl pocket instead. Reading the score per
        heavy atom, not the raw score, is the habit that carries over from
        fragments to every early-stage docking run.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Erlanson DA, Fesik SW, Hubbard RE, Jahnke W, Jhoti H.{" "}
          <em>Twenty years on: the impact of fragments on drug discovery.</em>{" "}
          Nat Rev Drug Discov 15, 605&ndash;619 (2016).{" "}
          <a
            href="https://doi.org/10.1038/nrd.2016.109"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nrd.2016.109
          </a>
        </li>
        <li>
          Bollag G, et al. <em>Vemurafenib: the first drug approved for
          BRAF-mutant cancer.</em> Nat Rev Drug Discov 11, 873&ndash;886 (2012).{" "}
          <a
            href="https://doi.org/10.1038/nrd3847"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nrd3847
          </a>
        </li>
        <li>
          Schoepfer J, et al. <em>Discovery of asciminib (ABL001), an allosteric
          inhibitor of the tyrosine kinase activity of BCR-ABL1.</em> J Med Chem
          61, 8120&ndash;8135 (2018).{" "}
          <a
            href="https://doi.org/10.1021/acs.jmedchem.8b01040"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jmedchem.8b01040
          </a>
        </li>
      </ul>
    </>
  );
}
