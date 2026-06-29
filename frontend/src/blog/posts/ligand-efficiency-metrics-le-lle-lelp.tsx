import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "ligand-efficiency-metrics-le-lle-lelp",
  title: "Ligand efficiency metrics: LE, LLE, and LELP explained",
  description:
    "Why raw potency lies, how ligand efficiency, lipophilic efficiency, and LELP keep optimization honest, and how to read them off your docking scores.",
  date: "2026-06-18",
  author: "Liganx team",
  tags: ["admet", "medicinal-chemistry", "methodology", "fragment-based"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        The easiest way to make a compound bind harder is to make it bigger and
        greasier. Add a lipophilic group, bury more surface in the pocket, and
        the IC50 drops. The problem is that this kind of potency is borrowed,
        not earned: the same molecular changes that buy raw affinity also wreck
        solubility, permeability, metabolic stability, and safety margins.
        Ligand efficiency metrics exist to stop medicinal chemists from
        congratulating themselves on potency they will pay for later.
      </p>

      <h2>Ligand efficiency (LE): potency per atom</h2>
      <p>
        Ligand efficiency normalizes binding free energy by molecular size. The
        standard definition, from Hopkins and colleagues, is the binding free
        energy divided by the number of non-hydrogen (heavy) atoms:
      </p>
      <ul>
        <li>
          <strong>LE = -1.37 x log(IC50 or Kd) / HAC</strong>, where HAC is the
          heavy-atom count and the 1.37 factor converts pIC50 to kcal/mol at
          room temperature. LE comes out in kcal/mol per heavy atom.
        </li>
      </ul>
      <p>
        A nanomolar inhibitor with 50 heavy atoms and a 100 nanomolar fragment
        with 18 heavy atoms can have the same LE, which tells you the small
        fragment is using every atom as productively as the big lead. A common
        rule of thumb is that an LE around 0.3 kcal/mol per heavy atom or better
        is a healthy starting point for a drug-sized molecule. LE is the metric
        that made fragment-based drug discovery rigorous: it lets you compare a
        weak, tiny fragment to a potent, large lead on equal footing and decide
        which one is the better chemical starting point.
      </p>

      <h2>Lipophilic ligand efficiency (LLE or LipE): potency per unit of grease</h2>
      <p>
        LE controls for size; LLE controls for lipophilicity, which is the
        property most tightly coupled to downstream attrition. The definition is
        deliberately simple:
      </p>
      <ul>
        <li>
          <strong>LLE = pIC50 - logP</strong> (or logD). It is the potency you
          have achieved over and above what raw greasiness would buy you.
        </li>
      </ul>
      <p>
        The interpretation is intuitive once you frame it as a competition. A
        molecule with LLE near zero binds its target about as well as it
        partitions into octanol, meaning its affinity is essentially just
        lipophilicity in disguise. A candidate with LLE of 6 has a roughly
        million-fold preference for its target over the oily phase, which means
        it is binding through specific, designed interactions rather than
        nonspecific stickiness. Most quality oral drug leads aim for LLE in the
        5 to 7 range. Watching LLE rather than IC50 during optimization keeps a
        series from drifting into the high-logP territory where hERG, CYP
        inhibition, and poor solubility cluster.
      </p>

      <h2>LELP: catching the metric that LE and LLE can both miss</h2>
      <p>
        LE and LLE can each be gamed. LELP combines them to catch a series that
        looks fine on size but is quietly buying its efficiency with fat:
      </p>
      <ul>
        <li>
          <strong>LELP = logP / LE</strong>. It asks how much lipophilicity you
          are spending per unit of ligand efficiency. Values roughly between
          -10 and +10 are considered the desirable window; large positive LELP
          flags a compound that is efficient per atom only because it is heavily
          lipophilic.
        </li>
      </ul>
      <p>
        The point of carrying three numbers is that no single metric is
        sufficient. LE alone rewards shrinking the molecule; LLE alone rewards
        de-greasing it; LELP ties the two together so that a chemist cannot
        improve one at the silent expense of the other. Used together they turn
        lead optimization from a potency chase into a balanced negotiation among
        affinity, size, and lipophilicity.
      </p>

      <h2>Reading efficiency off a docking run</h2>
      <p>
        Docking gives you a predicted binding score, and it is tempting to rank
        a virtual library on that score alone. That reproduces exactly the trap
        these metrics were built to avoid: docking scores, like measured
        affinities, tend to reward larger and greasier molecules that fill the
        pocket with more contacts. Converting a docking score into a
        size-normalized efficiency, and pairing it with the computed logP of
        each candidate, gives a far more honest ranking, the molecules that
        bind well for their size and polarity rather than the ones that simply
        sprawl across the pocket.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        Efficiency metrics are most useful when you can see size, lipophilicity,
        and predicted binding for the same molecule at once.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock a small panel of analogs against your target. Read the predicted
        binding score alongside the heavy-atom count and the logP from the ADMET
        panel, and rank your analogs by efficiency rather than raw score. The
        compound that wins on potency-per-atom is usually a better lead than the
        one that simply scores hardest.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and set up to
        show binding scores next to the physicochemical properties you need to
        compute efficiency. If you want to try molecular docking and read
        ligand efficiency off the results without a local install, that is the
        fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Hopkins AL, Groom CR, Alex A. <em>Ligand efficiency: a useful metric
          for lead selection.</em> Drug Discov Today 9, 430-431 (2004).{" "}
          <a
            href="https://doi.org/10.1016/S1359-6446(04)03069-7"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/S1359-6446(04)03069-7
          </a>
        </li>
        <li>
          Leeson PD, Springthorpe B. <em>The influence of drug-like concepts on
          decision-making in medicinal chemistry.</em> Nat Rev Drug Discov 6,
          881-890 (2007).{" "}
          <a
            href="https://doi.org/10.1038/nrd2445"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nrd2445
          </a>
        </li>
        <li>
          Hopkins AL, Keseru GM, Leeson PD, Rees DC, Reynolds CH. <em>The role
          of ligand efficiency metrics in drug discovery.</em> Nat Rev Drug
          Discov 13, 105-121 (2014).{" "}
          <a
            href="https://doi.org/10.1038/nrd4163"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nrd4163
          </a>
        </li>
      </ul>
    </>
  );
}
