/**
 * Post: KIT in GIST — the four-line resistance ladder
 *
 * SEO target: "KIT inhibitors GIST", "imatinib resistance GIST",
 * "ripretinib avapritinib", "KIT secondary mutations". Internal CTA
 * into /studio with KIT + a secondary activation-loop mutation so a
 * reader can see why type-II inhibitors lose the pocket.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "kit-gist-resistance-ladder",
  title: "KIT in GIST: the four-line resistance ladder",
  description:
    "Imatinib, sunitinib, regorafenib, ripretinib, avapritinib — how five drugs map onto KIT's primary and secondary mutations, and why each line eventually fails.",
  date: "2026-05-21",
  author: "Liganx team",
  tags: ["kit", "gist", "oncology", "clinical-landscape"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        GIST was the proof of concept that small-molecule kinase inhibition
        could turn a chemo-refractory sarcoma into a chronic disease. Imatinib
        did for KIT what it had already done for BCR-ABL. But two decades on,
        GIST is also the cleanest illustration of how a tumor climbs a
        resistance ladder one secondary mutation at a time, and why the field
        needed four more drugs after imatinib to keep up.
      </p>

      <h2>The driver: KIT, not the histology</h2>
      <p>
        Roughly 80% of gastrointestinal stromal tumors are driven by an
        activating mutation in KIT (CD117), and most of the rest by the
        related receptor PDGFRA. The kinase is constitutively switched on,
        signaling through RAS-MAPK and PI3K-AKT without ever seeing its ligand.
        Where the mutation sits matters enormously for which drug works.
      </p>
      <ul>
        <li>
          <strong>KIT exon 11</strong> (juxtamembrane domain) — the most common
          primary mutation, ~70% of cases, and the most imatinib-sensitive.
          The juxtamembrane region normally clamps the kinase in an inactive
          state; mutating it releases the clamp.
        </li>
        <li>
          <strong>KIT exon 9</strong> (extracellular) — ~10% of cases, less
          sensitive to standard-dose imatinib. These patients are dosed at
          800 mg/day rather than 400 mg.
        </li>
        <li>
          <strong>PDGFRA D842V</strong> — a primary activation-loop mutation
          that is intrinsically imatinib-resistant from day one, because the
          activation loop sits where imatinib needs the kinase to be inactive.
        </li>
      </ul>

      <h2>Why imatinib eventually fails</h2>
      <p>
        Imatinib is a type-II inhibitor: it binds the DFG-out, inactive
        conformation of the kinase. That is its strength and its weakness.
        Tumors escape by acquiring <strong>secondary</strong> mutations that
        either restore the active conformation or block the drug from reaching
        the ATP pocket. Two structural neighborhoods dominate:
      </p>
      <ul>
        <li>
          <strong>ATP-binding pocket (exon 13/14)</strong> — V654A and T670I
          are the recurring gatekeeper-region mutations. They sterically
          interfere with imatinib binding while leaving the kinase otherwise
          functional.
        </li>
        <li>
          <strong>Activation loop (exon 17/18)</strong> — D816, D820, and N822K
          stabilize the active (DFG-in) conformation, which a type-II inhibitor
          like imatinib cannot bind at all.
        </li>
      </ul>
      <p>
        Critically, these secondary mutations are polyclonal: different
        metastases in the same patient can carry different escape mutations,
        which is why a single salvage drug rarely controls every lesion.
      </p>

      <h2>The salvage ladder</h2>
      <p>
        Each later-line agent was developed to cover a slice of the secondary
        mutation space that the previous drug missed.
      </p>
      <ul>
        <li>
          <strong>Sunitinib (Sutent)</strong> — second line, FDA approved 2006.
          Potent against ATP-pocket secondary mutations (exon 13 V654A, exon 14
          T670I), but weak against activation-loop mutants.
        </li>
        <li>
          <strong>Regorafenib (Stivarga)</strong> — third line, approved 2012.
          Complements sunitinib by covering activation-loop (exon 17) mutations
          better than the ATP-pocket ones.
        </li>
        <li>
          <strong>Ripretinib (Qinlock)</strong> — fourth line, approved May 2020
          on the INVICTUS phase 3 trial. A switch-control inhibitor that locks
          the activation switch in the inactive state, giving broad coverage
          across both exon 13 and exon 17 secondary mutations after three prior
          lines.
        </li>
        <li>
          <strong>Avapritinib (Ayvakit)</strong> — approved January 2020, but
          not as a sequential line. It is a type-I inhibitor that binds the
          active conformation, and it is the only drug effective against
          PDGFRA D842V, the activation-loop mutation that defeats imatinib from
          the start.
        </li>
      </ul>

      <h2>The structural lesson</h2>
      <p>
        The whole GIST story is a conformation argument. Type-II inhibitors
        (imatinib) need DFG-out; activation-loop mutations force DFG-in and
        wipe them out. Type-I inhibitors (avapritinib) bind DFG-in but are
        vulnerable to ATP-pocket gatekeeper mutations. Switch-control inhibitors
        (ripretinib) bind a different regulatory element entirely, which is why
        they survive longer against a heterogeneous mutational background. When
        you are reasoning about which mutation defeats which drug, you are
        really reasoning about which protein conformation each ligand requires.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The conformational argument is much easier to see than to read about.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick KIT from the target catalog, then add a secondary activation-loop
        mutation such as D816 from the mutation chips. Dock imatinib against the
        wild-type pocket and then against the mutant, and watch the type-II
        binding mode lose its grip as the activation loop flips conformation.
        Molecular docking makes the selectivity story concrete in a way a
        sequence table never will.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and built
        around exactly this kind of mutation-versus-drug question. If you want
        to run molecular docking on KIT secondary mutants without a local
        install, that is the fastest path to a pose you can inspect.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Heinrich MC, et al. <em>Kinase mutations and imatinib response in
          patients with metastatic gastrointestinal stromal tumor.</em> J Clin
          Oncol 21, 4342-4349 (2003).{" "}
          <a
            href="https://doi.org/10.1200/JCO.2003.04.190"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1200/JCO.2003.04.190
          </a>
        </li>
        <li>
          Blay JY, et al. <em>Ripretinib in patients with advanced
          gastrointestinal stromal tumours (INVICTUS): a double-blind,
          randomised, placebo-controlled, phase 3 trial.</em> Lancet Oncol 21,
          923-934 (2020).{" "}
          <a
            href="https://doi.org/10.1016/S1470-2045(20)30168-6"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/S1470-2045(20)30168-6
          </a>
        </li>
        <li>
          Heinrich MC, et al. <em>Avapritinib in advanced PDGFRA D842V-mutant
          gastrointestinal stromal tumour (NAVIGATOR): a multicentre, open-label,
          phase 1 trial.</em> Lancet Oncol 21, 935-946 (2020).{" "}
          <a
            href="https://doi.org/10.1016/S1470-2045(20)30269-2"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/S1470-2045(20)30269-2
          </a>
        </li>
      </ul>
    </>
  );
}
