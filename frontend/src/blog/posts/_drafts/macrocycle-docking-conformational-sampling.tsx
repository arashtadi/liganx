/**
 * Post: Docking macrocycles — why the ring breaks your protocol
 *
 * SEO target: "macrocycle docking", "docking macrocyclic compounds",
 * "macrocycle conformational sampling", "flexible ring docking",
 * "macrocycle virtual screening". Internal CTA into /studio to dock a
 * macrocyclic inhibitor (repotrectinib, lorlatinib) against a kinase.
 *
 * Theme: methodology / workflow.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "macrocycle-docking-conformational-sampling",
  title: "Docking macrocycles: why the ring breaks your protocol",
  description:
    "Macrocyclic drugs like lorlatinib and repotrectinib are conformationally awkward for docking. Here is why standard protocols fail on them and how to fix the sampling.",
  date: "2026-07-23",
  author: "Liganx team",
  tags: ["docking", "methodology", "macrocycles", "conformational-sampling"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Macrocycles are having a moment in oncology. Lorlatinib, repotrectinib,
        zidesamtinib, and a growing list of ring-closed kinase inhibitors were
        drawn as macrocycles precisely because tying a molecule into a ring
        pre-pays some of the entropic cost of binding and can lock a scaffold
        into the shape the pocket wants. That same ring, though, is a menace for
        docking. If you feed a macrocycle into a protocol tuned for ordinary
        drug-like molecules and trust the result, you are very likely looking at
        a confident, wrong pose.
      </p>

      <h2>Why a ring is harder than a chain</h2>
      <p>
        A normal docking engine samples ligand flexibility by rotating around
        single bonds. Each rotatable bond is an independent dial the search
        algorithm can turn. Close those atoms into a ring and the dials stop
        being independent: turning one bond forces compensating changes in the
        others so the ring stays closed. That is the ring-closure constraint,
        and most docking algorithms were never built to respect it. The common
        shortcut is to treat the macrocyclic ring as rigid and only sample the
        substituents hanging off it, which means the single most important
        degree of freedom, the shape of the ring itself, is frozen at whatever
        conformation you happened to feed in.
      </p>
      <p>
        The consequence is that macrocycle docking lives or dies on the input
        conformer. A macrocyclic ring of moderate size can populate many
        distinct low-energy shapes, and if the bioactive one is not in your
        starting ensemble, no amount of clever scoring will recover it. This is
        a sampling problem masquerading as a scoring problem.
      </p>

      <h2>How badly standard docking fails</h2>
      <p>
        The failure is well documented. In one benchmark, ten different docking
        programs were unable to recover the crystallographic binding mode of a
        moderately sized macrocyclic Gyrase B inhibitor, and the failure was
        traced directly to the conformational complexity of the ring rather than
        to scoring. In controlled redocking experiments where the ring is
        allowed to flex, success rates drop sharply compared with rigid
        redocking, one study reporting roughly 53% success for flexible
        macrocycle redocking against 76% for the rigid case. And rigid redocking
        flatters the method, because it starts from the answer: it reuses the
        crystallographic ring shape. In a real prospective run you only have the
        2D structure, so the honest number is the lower one.
      </p>

      <h2>Approaches that actually work</h2>
      <p>
        There are three broad strategies, in increasing cost and reliability:
      </p>
      <ul>
        <li>
          <strong>Pre-generated conformer ensembles</strong> — sample the
          macrocycle's ring conformations up front with a dedicated
          conformational search (distance-geometry or specialized macrocycle
          samplers such as Schrodinger's Prime macrocycle module), then dock the
          ensemble as if each ring shape were a separate rigid ligand. Cheap and
          parallel, but only as good as the ensemble's coverage of the bioactive
          shape.
        </li>
        <li>
          <strong>Explicit in-docking ring sampling</strong> — some engines can
          break a ring bond internally, dock with the ring open, and re-close it
          with a restraint, effectively giving the search algorithm access to
          ring flexibility during pose generation. AutoDock's flexible
          macrocycle mode works this way and measurably improves ring pose
          recovery over rigid treatment.
        </li>
        <li>
          <strong>MD-based refinement</strong> — protocols such as DynaDock use
          short molecular-dynamics runs at elevated temperature to sample the
          ring inside the pocket, and can drive ligand RMSDs below 1.8 Angstrom
          on cases where docking alone fails. Most reliable, most expensive,
          reserved for the poses you care about.
        </li>
      </ul>

      <h2>The practical rules</h2>
      <p>
        If you take nothing else from this: never trust a single-conformer
        macrocycle dock. Generate a real ring-conformer ensemble before you
        dock, check that redocking a known macrocyclic ligand actually recovers
        its crystal pose before you believe any prospective result, and treat a
        macrocycle score as a shape-plus-sampling question, not a pure affinity
        readout. The molecules that most reward this care are exactly the ones
        oncology keeps producing: compact, brain-penetrant, resistance-beating
        rings whose whole reason for existing is a specific pocket geometry.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        A macrocyclic kinase inhibitor is the ideal test case for seeing how
        much ring conformation matters to a pose.
      </p>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock a macrocyclic inhibitor such as repotrectinib or lorlatinib
        against its kinase target, then compare the pose and score to a
        non-macrocyclic inhibitor of the same target. Running
        molecular docking online on a ring-closed compound makes the conformational challenge
        concrete: you can see how the ring seats in the pocket and judge whether
        the pose is one you would stake a design decision on. Doing this
        molecular docking side by side is the fastest way to build intuition for
        when a macrocycle deserves extra sampling before you believe its number.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Alogheli H, Olanders G, Schaal W, Brandt P, Karlen A. <em>Docking of
          macrocycles: comparing rigid and flexible docking in Glide.</em> J
          Chem Inf Model 57, 190-202 (2017).{" "}
          <a
            href="https://doi.org/10.1021/acs.jcim.6b00443"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jcim.6b00443
          </a>
        </li>
        <li>
          Kotev M, Soliva R, Orozco M. <em>Challenges of docking in large,
          flexible and promiscuous binding sites.</em> Bioorg Med Chem 24,
          4961-4969 (2016).{" "}
          <a
            href="https://doi.org/10.1016/j.bmc.2016.08.010"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/j.bmc.2016.08.010
          </a>
        </li>
        <li>
          Ugur I, et al. <em>Predicting the bioactive conformations of
          macrocycles: a molecular dynamics-based docking procedure with
          DynaDock.</em> J Mol Model 25, 197 (2019).{" "}
          <a
            href="https://doi.org/10.1007/s00894-019-4077-5"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1007/s00894-019-4077-5
          </a>
        </li>
      </ul>
    </>
  );
}
