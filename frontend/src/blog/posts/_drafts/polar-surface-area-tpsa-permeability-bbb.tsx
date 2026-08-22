/**
 * Post: Polar surface area (TPSA) as the permeability dial in drug design
 *
 * SEO target: "TPSA drug design", "polar surface area permeability",
 * "TPSA blood brain barrier", "Veber rule oral bioavailability". Internal
 * link to /studio where the ADMET panel reports predicted TPSA alongside
 * docking scores.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "polar-surface-area-tpsa-permeability-bbb",
  title: "Polar surface area (TPSA): the permeability dial",
  description:
    "TPSA is a fast 2D descriptor that predicts oral absorption and blood-brain-barrier penetration almost as well as a full 3D calculation, in a fraction of the time.",
  date: "2026-08-13",
  author: "Liganx team",
  tags: ["admet", "tpsa", "permeability", "medchem"],
  readingMin: 5,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Topological polar surface area, almost always abbreviated TPSA, is
        one of the more unusual descriptors in medicinal chemistry: it is
        both a 2D approximation of a genuinely 3D physical quantity and, in
        practice, nearly as predictive as the real thing. It shows up on
        every ADMET dashboard next to logP for a reason — it is the
        single number most tightly linked to whether a compound gets
        absorbed orally and whether it crosses into the brain.
      </p>

      <h2>What TPSA actually measures</h2>
      <p>
        Polar surface area, properly defined, is the surface area of a
        molecule contributed by polar atoms — oxygen, nitrogen, and
        the hydrogens attached to them, plus sulfur and phosphorus in most
        implementations. Computing that from a real 3D conformer is slow and
        conformation-dependent, since polar surface area can shift
        meaningfully between conformers of the same molecule. Ertl, Rohde,
        and Selzer (2000) solved this by tabulating a polar contribution for
        each type of polar fragment — a specific kind of nitrogen or
        oxygen environment — from a large set of pre-computed 3D
        surface areas, then summing those fragment contributions directly
        from the 2D structure. No conformer generation required. The
        resulting topological PSA correlates with true 3D PSA at r
        ≈ 0.99 and computes two to three orders of magnitude faster,
        which is why TPSA rather than 3D PSA is what shows up in virtual
        screening pipelines and ADMET panels.
      </p>

      <h2>The two rules of thumb that use it</h2>
      <ul>
        <li>
          <strong>Oral bioavailability — Veber et al. (2002).</strong>{" "}
          Analyzing bioavailability data across more than 1,100 compounds,
          Veber and colleagues found that TPSA &le; 140 &Aring;&sup2;
          (or, as a proxy, 12 or fewer combined hydrogen-bond donors and
          acceptors) together with 10 or fewer rotatable bonds predicted
          good oral bioavailability in rats independent of molecular
          weight. It became a standard companion filter to Lipinski&rsquo;s
          Rule of Five, and unlike Ro5 it captures flexibility and polarity
          rather than just size and lipophilicity.
        </li>
        <li>
          <strong>CNS penetration — Clark (1999).</strong> A tighter
          threshold applies to the blood-brain barrier: Clark&rsquo;s QSAR
          model, built on a diverse 55-compound set using PSA and calculated
          logP, showed that TPSA below roughly 90 &Aring;&sup2; is generally
          required for meaningful brain penetration, with penetration
          dropping off sharply above that line. This is the number
          medicinal chemists targeting CNS-penetrant kinase inhibitors watch
          most closely — it is part of why some later-generation EGFR
          and ALK inhibitors were deliberately redesigned with lower TPSA
          than their predecessors to reach CNS metastases.
        </li>
      </ul>

      <h2>Where TPSA breaks down</h2>
      <p>
        TPSA is a topological sum, not a physical measurement, and it has
        known blind spots. It cannot see intramolecular hydrogen bonding:
        a molecule where a polar group folds back and hydrogen-bonds to
        another part of the same molecule effectively shields that polarity
        from the membrane, behaving more permeable than its TPSA predicts.
        This matters most for macrocycles and for peptide-like chemotypes,
        where chameleonic behavior — the same molecule presenting a
        polar face in water and a folded, non-polar face in membrane —
        can let compounds violate the Veber and Clark thresholds and still
        permeate. TPSA also does not distinguish which polar groups are
        ionizable at physiological pH, so it is best read alongside logD,
        not as a replacement for it.
      </p>

      <h2>The design tension</h2>
      <p>
        The reason TPSA is a genuine optimization variable rather than a
        box to check is that target engagement usually wants polarity and
        permeability usually does not. Hydrogen-bond donors and acceptors
        that make a high-affinity contact with a kinase hinge or a catalytic
        lysine are the same atoms that raise TPSA and blunt permeability.
        Lead optimization against a CNS-penetrant target is very often a
        search for the minimum TPSA that still preserves the key polar
        contacts — removing a hydroxyl or converting an amide to a
        less polar bioisostere, then checking that binding survives the
        swap. Tracking TPSA alongside the docking score through that process
        shows directly whether a permeability-motivated change is coming at
        the cost of the interactions driving affinity.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock a candidate against your target of choice — the
        ADMET panel reports predicted TPSA next to the docking score, so you
        can check a series against the Veber and Clark thresholds without
        leaving the results page. If you are working a CNS-relevant target
        such as EGFR or ALK, watch how TPSA moves as you trim polar groups,
        and confirm the docking score against the mutant structure holds up
        before you commit to the swap.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and set up
        to show structure-based potency and property risk together. If you
        want to run molecular docking while keeping an eye on TPSA and
        permeability, that is the fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Ertl P, Rohde B, Selzer P. <em>Fast Calculation of Molecular Polar
          Surface Area as a Sum of Fragment-Based Contributions and Its
          Application to the Prediction of Drug Transport Properties.</em>{" "}
          J Med Chem 43, 3714–3717 (2000).{" "}
          <a
            href="https://doi.org/10.1021/jm000942e"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/jm000942e
          </a>
        </li>
        <li>
          Veber DF, et al. <em>Molecular Properties That Influence the Oral
          Bioavailability of Drug Candidates.</em> J Med Chem 45,
          2615–2623 (2002).{" "}
          <a
            href="https://doi.org/10.1021/jm020017n"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/jm020017n
          </a>
        </li>
        <li>
          Clark DE. <em>Rapid calculation of polar molecular surface area
          and its application to the prediction of transport phenomena. 2.
          Prediction of blood–brain barrier penetration.</em> J Pharm
          Sci 88, 815–821 (1999).{" "}
          <a
            href="https://doi.org/10.1021/js980402t"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/js980402t
          </a>
        </li>
      </ul>
    </>
  );
}
