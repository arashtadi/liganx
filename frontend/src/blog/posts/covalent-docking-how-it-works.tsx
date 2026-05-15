/**
 * Post: Covalent docking - how it differs from the non-covalent kind
 *
 * SEO target: "covalent docking", "how covalent docking works",
 * "covalent inhibitor docking", "warhead docking", "acrylamide docking".
 * Internal CTA into /studio to dock a warhead-bearing candidate against
 * KRAS G12C or EGFR, both canonical covalent targets.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "covalent-docking-how-it-works",
  title: "Covalent docking: how it differs from the non-covalent kind",
  description:
    "Standard docking assumes reversible binding. For warhead-bearing drugs that form a real bond with the target, you need a different method. Here is how it works.",
  date: "2026-05-15",
  author: "Liganx team",
  tags: ["docking-method", "covalent-inhibitors", "warhead", "methodology"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Most molecular docking rests on one quiet assumption: the ligand binds
        reversibly, and the score you compute is a non-covalent binding free
        energy. That assumption is wrong for a growing slice of the oncology
        drug list. Sotorasib, osimertinib, ibrutinib, afatinib &mdash; these
        all form an actual chemical bond with their target. Run them through
        standard docking and the score means very little. Covalent docking
        treats the bond as the whole point.
      </p>

      <h2>Why standard docking gets covalent binders wrong</h2>
      <p>
        A reversible docking score estimates the free energy of a non-covalent
        equilibrium: van der Waals contact, hydrogen bonds, electrostatics,
        desolvation. A covalent inhibitor&rsquo;s binding is dominated by
        something that scoring function does not model at all &mdash; the
        formation of a covalent bond, typically between an electrophilic
        &ldquo;warhead&rdquo; on the ligand and a nucleophilic residue on the
        protein, most often a cysteine thiol.
      </p>
      <p>
        Worse, nothing in a standard docking run forces the warhead to point
        at that cysteine. The docker will happily return a high-scoring pose
        with the warhead buried on the wrong side of the pocket: geometrically
        plausible, chemically impossible. The number looks fine and the pose is
        nonsense.
      </p>

      <h2>The warhead</h2>
      <p>
        A warhead is the reactive group that makes the bond. The most common
        one in approved drugs is the <strong>acrylamide</strong>, a Michael
        acceptor that reacts with cysteine thiols. Osimertinib, ibrutinib, and
        afatinib all carry acrylamide warheads; sotorasib and adagrasib carry
        acrylamide-type warheads aimed at the mutant cysteine of KRAS G12C.
        Other warhead chemistries exist &mdash; nitriles, &beta;-lactams,
        epoxides, activated esters &mdash; but cysteine-targeting Michael
        acceptors dominate oncology.
      </p>
      <p>
        The binding event is really two steps: a reversible recognition step,
        where the molecule docks into the pocket like any other ligand, then an
        irreversible chemical step, where the warhead reacts. Covalent docking
        has to respect both.
      </p>

      <h2>How covalent docking tools actually work</h2>
      <p>
        Covalent docking tools handle the two steps by tethering the ligand.
        You tell the software which protein residue is the nucleophile and
        which ligand atom is the warhead; it then constrains that atom pair to
        bonding distance and samples poses around the tether. A few established
        approaches:
      </p>
      <ul>
        <li>
          <strong>AutoDock covalent</strong> &mdash; Bianco et al. (2016)
          describe two variants, a two-point attractor method and a flexible
          side chain method. The flexible side chain version recovered the
          experimental pose in 75% of a 20-complex training set.
        </li>
        <li>
          <strong>CovDock</strong> &mdash; Zhu et al. (2014) combine Glide
          docking with Prime structure modeling in a parameter-free workflow;
          76% of test inhibitors landed within 2.0 &Aring; RMSD of the
          crystallographic pose.
        </li>
        <li>
          <strong>GNINA covalent mode</strong> &mdash; extends the CNN-scored
          docking engine to handle covalent constraints, so the same learned
          pose-quality model carries over.
        </li>
      </ul>
      <p>
        Scarpino et al. (2018) benchmarked six covalent docking tools across a
        large, diverse complex set and found 40&ndash;60% of top-scoring poses
        within 2.0 &Aring; RMSD, rising to 50&ndash;90% when the best of the
        top ten was counted. Success was meaningfully higher for Michael
        additions than for ring-opening reactions &mdash; the warhead
        chemistry matters to how well the method behaves.
      </p>

      <h2>What covalent docking does and does not tell you</h2>
      <p>
        Covalent docking gives you a credible bound pose and answers geometric
        questions well: can the warhead actually reach the cysteine, does the
        recognition scaffold fit the pocket, which mutant cysteine does a
        candidate prefer. What it does not give you is reactivity. Real
        covalent potency is governed by k<sub>inact</sub>/K
        <sub>i</sub> &mdash; the intrinsic chemical reaction rate divided by
        the reversible binding affinity. Docking can speak to the K
        <sub>i</sub> side and to geometry; it does not predict k
        <sub>inact</sub>.
      </p>
      <p>
        A useful sanity check, noted by Scarpino et al.: non-covalent docking
        into a protein with the target cysteine mutated to alanine reproduced
        binding modes almost as well as full covalent docking, at a fraction of
        the computational cost. The lesson is that much of the value lives in
        getting the recognition pose right &mdash; the covalent constraint
        refines it rather than rescuing it.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock a warhead-bearing candidate against KRAS with the G12C
        mutation, or against EGFR &mdash; both are canonical covalent targets
        with a reactive cysteine in the pocket. Look at where the warhead lands
        relative to that cysteine: a pose that buries the acrylamide away from
        the thiol is telling you the recognition scaffold is fighting the
        chemistry. Then compare the &Delta;&Delta; between the mutant receptor
        (reactive cysteine present) and the wild-type receptor (no reactive
        cysteine) to see the selectivity the warhead is supposed to buy you.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Zhu K, et al. <em>Docking Covalent Inhibitors: A Parameter Free
          Approach To Pose Prediction and Scoring.</em> J Chem Inf Model 54,
          1932&ndash;1940 (2014).{" "}
          <a
            href="https://doi.org/10.1021/ci500118s"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/ci500118s
          </a>
        </li>
        <li>
          Bianco G, Forli S, Goodsell DS, Olson AJ. <em>Covalent docking using
          AutoDock: Two-point attractor and flexible side chain methods.</em>{" "}
          Protein Sci 25, 295&ndash;301 (2016).{" "}
          <a
            href="https://doi.org/10.1002/pro.2733"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1002/pro.2733
          </a>
        </li>
        <li>
          Scarpino A, Ferenczy GG, Keser&uacute; GM. <em>Comparative Evaluation
          of Covalent Docking Tools.</em> J Chem Inf Model 58,
          1441&ndash;1458 (2018).{" "}
          <a
            href="https://doi.org/10.1021/acs.jcim.8b00228"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jcim.8b00228
          </a>
        </li>
      </ul>
    </>
  );
}
