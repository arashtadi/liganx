/**
 * Post: Lipophilicity (logP vs logD) as the master ADMET variable
 *
 * SEO target: "logP vs logD", "lipophilicity drug discovery", "ClogP
 * ADMET", "lipophilic efficiency LLE". Internal link to /studio where the
 * ADMET panel surfaces predicted logP alongside docking scores.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "lipophilicity-logp-logd-admet",
  title: "Lipophilicity: logP, logD, and why they drive ADMET",
  description:
    "Lipophilicity is the single property that touches solubility, permeability, clearance, hERG, and tox. A practical guide to logP vs logD and the 3/75 rule.",
  date: "2026-06-04",
  author: "Liganx team",
  tags: ["admet", "lipophilicity", "drug-properties", "medchem"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        If you could keep an eye on only one physicochemical property across
        a medchem campaign, it should be lipophilicity. Nothing else has its
        reach: the same number that governs how well a compound dissolves
        also governs how well it crosses membranes, how fast the liver
        clears it, how promiscuously it hits off-targets, and how likely it
        is to block hERG. Push it too high and every downstream property
        degrades at once. This is a practical guide to the two numbers
        people actually use — logP and logD — and to the rules of thumb
        that keep a series in safe territory.
      </p>

      <h2>logP vs logD: they are not the same number</h2>
      <p>
        Both describe how a molecule partitions between octanol (a stand-in
        for membrane lipid) and water, but they measure different things.
      </p>
      <ul>
        <li>
          <strong>logP</strong> — the partition coefficient of the{" "}
          <em>neutral</em> species only. It ignores ionization. For a
          compound with no ionizable groups, logP is the whole story.
        </li>
        <li>
          <strong>logD</strong> — the distribution coefficient at a specified
          pH (almost always logD<sub>7.4</sub>, physiological pH). It sums
          the neutral and ionized forms, so it captures what the molecule
          actually does in blood and gut.
        </li>
      </ul>
      <p>
        For a neutral molecule, logP and logD are identical. For an acid or
        base, they diverge sharply: a basic amine that is mostly protonated
        at pH 7.4 has a logD far below its logP, because the charged form
        stays in water. That gap is a lever. Adding a basic nitrogen to dial
        down logD is one of the most common ways medicinal chemists rescue
        solubility without touching the neutral-form lipophilicity that
        drives target binding. The flip side: the protonated base is exactly
        what gets you into trouble with hERG. logD is the number to track
        for ADMET; logP is the number that often correlates with the
        binding pocket.
      </p>

      <h2>Why it touches everything downstream</h2>
      <p>
        Lipophilicity is upstream of most of the ADMET properties that kill
        compounds, which is why optimizing it pays compounding dividends.
      </p>
      <ul>
        <li>
          <strong>Aqueous solubility</strong> — falls roughly log-linearly
          as lipophilicity rises. High-logD compounds crash out, limiting
          oral absorption and complicating formulation.
        </li>
        <li>
          <strong>Permeability</strong> — rises with lipophilicity up to a
          point, then membrane retention and efflux take over. Permeability
          and solubility pull in opposite directions on the same axis, which
          is why a mid-range logD is the sweet spot for oral drugs.
        </li>
        <li>
          <strong>Metabolic clearance</strong> — the CYP450 enzymes have
          lipophilic active sites, so more lipophilic compounds are
          generally better substrates and clear faster. Lowering logD is a
          standard tactic to improve metabolic stability.
        </li>
        <li>
          <strong>hERG and off-target promiscuity</strong> — lipophilic,
          basic compounds hit the hERG channel and a long tail of unrelated
          targets. Promiscuity scales with lipophilicity; cleaner selectivity
          tends to live at lower logP.
        </li>
        <li>
          <strong>Plasma protein binding</strong> — climbs with
          lipophilicity, lowering the free fraction available to engage the
          target.
        </li>
      </ul>

      <h2>The 3/75 rule and the lipophilicity ceiling</h2>
      <p>
        The most-cited single data point here comes from Hughes et al.
        (2008), a Pfizer analysis of in vivo tolerability across 245
        preclinical compounds. Molecules with ClogP &gt; 3 <em>and</em> TPSA
        &lt; 75 Å² were markedly more likely to show toxic findings than
        molecules in the opposite corner. The practical heuristic that fell
        out — keep ClogP under ~3 and polar surface area above ~75 — became
        a fast triage filter for &ldquo;greasy and non-polar means risky.&rdquo;
        It is a correlation, not a mechanism, but it has held up well enough
        to earn a permanent place in property dashboards.
      </p>
      <p>
        This sits alongside the broader lesson from Leeson &amp; Springthorpe
        (2007): mean lipophilicity of marketed oral drugs has crept upward
        over decades, and that drift correlates with attrition. Lipinski&rsquo;s
        Rule of Five already capped logP at 5, but the modern target is more
        conservative — most oral programs aim to land logD<sub>7.4</sub>
        roughly between 1 and 3.
      </p>

      <h2>Lipophilic efficiency: spend your lipophilicity wisely</h2>
      <p>
        Raw potency is easy to buy by adding grease — a bigger, more
        lipophilic compound almost always binds tighter, but it does so by
        burying hydrophobic surface, not by making a better-quality contact.
        Lipophilic ligand efficiency (LLE, sometimes LipE) corrects for
        this:
      </p>
      <ul>
        <li>
          <strong>LLE = pIC<sub>50</sub> (or pK<sub>i</sub>) − logP</strong>{" "}
          — potency normalized against the lipophilicity that bought it.
        </li>
      </ul>
      <p>
        A series whose potency is climbing only because logP is climbing
        shows flat LLE — a warning that you are inflating affinity with
        liabilities attached. High-quality optimization raises potency{" "}
        <em>and</em> LLE together, which means the new binding is coming from
        specific polar contacts rather than from generic hydrophobic burial.
        Most teams target LLE in the 5–7 range. Tracking it alongside the
        docking score is one of the most useful habits in lead optimization.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock a candidate against your target — the ADMET panel reports
        predicted lipophilicity alongside the docking score, so you can read
        potency and property risk on the same screen. Pair the predicted
        logP with the binding score to estimate lipophilic efficiency on the
        fly: if a more potent analog also carries a higher logP, your LLE may
        not have moved at all, and that is exactly the trap this post is
        about. The panel also flags the hERG and solubility liabilities that
        ride along with high lipophilicity.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and set up
        to show structure-based potency and property risk together. If you
        want to run molecular docking while keeping an eye on lipophilicity,
        that is the fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Hughes JD, et al. <em>Physiochemical drug properties associated
          with in vivo toxicological outcomes.</em> Bioorg Med Chem Lett 18,
          4872–4875 (2008).{" "}
          <a
            href="https://doi.org/10.1016/j.bmcl.2008.07.071"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/j.bmcl.2008.07.071
          </a>
        </li>
        <li>
          Leeson PD, Springthorpe B. <em>The influence of drug-like concepts
          on decision-making in medicinal chemistry.</em> Nat Rev Drug Discov
          6, 881–890 (2007).{" "}
          <a
            href="https://doi.org/10.1038/nrd2445"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nrd2445
          </a>
        </li>
        <li>
          Gleeson MP. <em>Generation of a set of simple, interpretable ADMET
          rules of thumb.</em> J Med Chem 51, 817–834 (2008).{" "}
          <a
            href="https://doi.org/10.1021/jm701122q"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/jm701122q
          </a>
        </li>
      </ul>
    </>
  );
}
