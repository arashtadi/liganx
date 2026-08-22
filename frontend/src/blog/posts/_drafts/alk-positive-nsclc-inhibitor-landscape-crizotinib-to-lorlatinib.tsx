/**
 * Post: ALK-positive NSCLC inhibitor landscape - three generations of TKIs.
 *
 * SEO target: "ALK inhibitor landscape", "ALK positive NSCLC drugs",
 * "crizotinib alectinib lorlatinib", "ALK TKI generations". Target /
 * disease deep-dive theme. Internal CTA into /studio, framing ALK with
 * L1196M / G1202R as the docking exercise, tying to the existing
 * mutation-specific posts on those two resistance sites.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "alk-positive-nsclc-inhibitor-landscape-crizotinib-to-lorlatinib",
  title: "ALK+ NSCLC: the inhibitor landscape, crizotinib to lorlatinib",
  description:
    "ALK-positive lung cancer now has five approved TKIs across three generations. Here is what separates them on potency, CNS penetration, and resistance coverage.",
  date: "2026-07-16",
  author: "Liganx team",
  tags: ["alk", "nsclc", "kinase-inhibitor", "resistance"],
  readingMin: 8,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        ALK rearrangements drive roughly 4 to 5 percent of non-small-cell
        lung cancers, and they define one of the great success stories of
        precision oncology. In little over a decade the field has gone from
        a single first-generation inhibitor to five approved drugs across
        three generations, and the median progression-free survival on
        front-line therapy has climbed from under a year to figures never
        before reported in advanced lung cancer. This post walks the
        landscape target by target: what each generation fixed, where each
        one fails, and why the resistance mutations you have already read
        about here keep steering the sequence.
      </p>

      <h2>The oncogene: an EML4-ALK fusion, not a point mutation</h2>
      <p>
        Unlike EGFR or KRAS lung cancer, ALK-positive disease is almost
        always driven by a chromosomal rearrangement, most often EML4-ALK,
        that fuses the ALK kinase domain to a partner providing a
        dimerization motif. The result is a constitutively active kinase
        that does not need a ligand. That biology matters for drug design:
        the target is the ATP pocket of the ALK kinase domain, and every
        approved drug is an ATP-competitive inhibitor. It also means the
        resistance story is dominated by second-site mutations inside that
        same pocket, which is exactly where structure-based modeling earns
        its keep.
      </p>

      <h2>First generation: crizotinib opened the door</h2>
      <p>
        Crizotinib was approved in 2011 and was originally designed as a MET
        inhibitor; its ALK and ROS1 activity was a fortunate second life.
        Against untreated ALK-positive disease it clearly beat chemotherapy
        in PROFILE 1014, but its median progression-free survival of around
        11 months and its poor central nervous system penetration left two
        obvious gaps. The brain was the Achilles heel: crizotinib is a
        substrate for P-glycoprotein efflux at the blood-brain barrier, so
        the CNS became a common site of first progression even when
        systemic disease was controlled.
      </p>
      <ul>
        <li>
          <strong>Crizotinib</strong> - approved 2011; multi-target ALK /
          ROS1 / MET inhibitor; modest potency and weak CNS exposure;
          largely superseded first-line but still relevant for ROS1 disease.
        </li>
      </ul>

      <h2>Second generation: potency and a brain-penetrant design</h2>
      <p>
        The second-generation drugs were built to be more potent against
        ALK and to actually reach the brain. Ceritinib, alectinib, and
        brigatinib all cover most of the on-target mutations that defeat
        crizotinib, including the L1196M gatekeeper substitution, and all
        three achieve meaningful CNS concentrations. Alectinib became the
        reference front-line standard after the ALEX trial, where it more
        than doubled progression-free survival versus crizotinib and
        sharply cut the rate of CNS progression.
      </p>
      <ul>
        <li>
          <strong>Ceritinib</strong> - approved 2014; potent against many
          crizotinib-resistant mutants; GI tolerability drove dose
          refinement over time.
        </li>
        <li>
          <strong>Alectinib</strong> - approved 2015; the ALEX benchmark,
          with front-line PFS around 25 to 35 months and strong CNS
          control; a workhorse first-line option.
        </li>
        <li>
          <strong>Brigatinib</strong> - approved 2017; broad mutation
          coverage and rapid systemic responses; retains useful activity
          against several second-generation escape mutants.
        </li>
      </ul>
      <p>
        The shared weakness of the second generation is the solvent-front
        mutation G1202R. The arginine substitution at position 1202 pushes
        into the space these inhibitors rely on and blunts their binding,
        and it is a recurring reason patients progress on alectinib or
        brigatinib. That single residue is what the third generation was
        engineered to solve.
      </p>

      <h2>Third generation: lorlatinib and the macrocycle trick</h2>
      <p>
        Lorlatinib, approved in 2018, is a compact macrocyclic inhibitor
        deliberately shaped to tolerate bulky solvent-front residues and to
        cross the blood-brain barrier without being efficiently pumped back
        out. Its constrained ring reduces the entropic penalty of binding
        and lets it thread past G1202R where flatter, more flexible
        scaffolds cannot. In the CROWN trial, first-line lorlatinib cut the
        risk of progression or death by about 72 percent versus crizotinib,
        and the five-year update reported a median progression-free survival
        that was still not reached, with 60 percent of patients progression
        free at five years against 8 percent on crizotinib. That is the
        longest progression-free survival ever reported in advanced
        non-small-cell lung cancer.
      </p>
      <ul>
        <li>
          <strong>Lorlatinib</strong> - approved 2018; macrocyclic,
          brain-penetrant, covers G1202R and most single ALK resistance
          mutations; CNS and neurocognitive side effects and hyperlipidemia
          are the trade-offs.
        </li>
      </ul>

      <h2>Where resistance goes next: compound mutations</h2>
      <p>
        Lorlatinib is broad but not final. Because it is often used after
        one or two earlier inhibitors, the tumors that escape it frequently
        carry <em>compound</em> mutations, two ALK substitutions on the same
        allele, such as G1202R combined with L1196M. These double mutants
        can resist every current single-agent TKI, and they are the active
        frontier of the field. There is even a well-documented paradox: the
        L1198F mutation, which arises under lorlatinib, can resensitize the
        kinase to crizotinib, a reminder that resistance is a moving target
        and that the optimal sequence is not always forward through the
        generations. Off-target bypass resistance, through MET
        amplification or activation of parallel pathways, accounts for the
        remainder and does not respond to any ALK inhibitor at all.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The whole landscape comes down to how a given inhibitor fits an ALK
        pocket that a resistance mutation has reshaped, and that is a
        question you can pose directly with molecular docking.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock lorlatinib and alectinib against ALK carrying G1202R or the
        L1196M gatekeeper, then compare the pose and the score shift between
        wild-type and mutant. The ΔΔ between them is the quantitative echo
        of why the second generation stumbles on the solvent front while the
        macrocycle holds. For the residue-level detail, see the companion
        posts on the{" "}
        <Link to="/blog/alk-l1196m-gatekeeper-crizotinib-resistance" className="text-cyan-600 dark:text-cyan-400 underline">
          L1196M gatekeeper
        </Link>{" "}
        and the{" "}
        <Link to="/blog/alk-g1202r-solvent-front-resistance" className="text-cyan-600 dark:text-cyan-400 underline">
          G1202R solvent-front mutation
        </Link>
        .
      </p>
      <p>
        Liganx puts molecular docking online and free in the browser, so
        running molecular docking against a mutant ALK pocket and reading
        off the selectivity shift is a couple of clicks rather than a
        weekend of setup.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Peters S, Camidge DR, Shaw AT, et al.{" "}
          <em>
            Alectinib versus crizotinib in untreated ALK-positive
            non-small-cell lung cancer.
          </em>{" "}
          N Engl J Med 377, 829-838 (2017).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1704795"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1704795
          </a>
        </li>
        <li>
          Shaw AT, Bauer TM, de Marinis F, et al.{" "}
          <em>
            First-line lorlatinib or crizotinib in advanced ALK-positive
            lung cancer.
          </em>{" "}
          N Engl J Med 383, 2018-2029 (2020).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2027187"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2027187
          </a>
        </li>
        <li>
          Solomon BJ, Liu G, Felip E, et al.{" "}
          <em>
            Lorlatinib versus crizotinib in patients with advanced
            ALK-positive non-small cell lung cancer: 5-year outcomes from
            the phase III CROWN study.
          </em>{" "}
          J Clin Oncol 42, 3400-3409 (2024).{" "}
          <a
            href="https://doi.org/10.1200/JCO.24.00581"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1200/JCO.24.00581
          </a>
        </li>
      </ul>
    </>
  );
}
