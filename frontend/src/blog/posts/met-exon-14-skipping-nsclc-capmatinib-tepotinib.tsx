/**
 * Post: MET exon 14 skipping in NSCLC — capmatinib, tepotinib, and what skipping really means
 *
 * SEO target: long-tail queries around "MET exon 14 skipping",
 * "capmatinib mechanism", "tepotinib NSCLC", "METex14 resistance".
 * Internal CTA into /studio with MET pre-loaded so the reader can
 * see the kinase pocket and dock candidates against it.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "met-exon-14-skipping-nsclc-capmatinib-tepotinib",
  title: "MET exon 14 skipping in NSCLC — capmatinib, tepotinib, and what skipping really means",
  description:
    "Why MET exon 14 skipping is an oncogenic event even without a kinase-domain mutation, how capmatinib and tepotinib exploit the resulting half-life increase, and where resistance shows up.",
  date: "2026-05-19",
  author: "Liganx team",
  tags: ["met", "oncology", "nsclc", "clinical-landscape", "resistance"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Most oncogenic kinase events in lung cancer are point
        mutations or fusions that rewire the kinase domain itself.
        MET exon 14 skipping is a stranger kind of oncogene: the
        kinase domain is unchanged, but a regulatory cassette
        that normally tags MET for destruction gets spliced out
        of the mRNA. The receptor that hits the membrane lasts
        longer than it should, and that extra half-life is enough
        to drive a real cancer. Capmatinib and tepotinib both
        exploit that single biological fact &mdash; and the
        clinical results have been convincing enough that
        METex14 is now a standard biomarker in NSCLC molecular
        panels.
      </p>

      <h2>The Y1003 trick</h2>
      <p>
        MET is a receptor tyrosine kinase for hepatocyte growth
        factor (HGF). After HGF binding, MET autophosphorylates,
        signals through PI3K, MAPK, and STAT, and is then turned
        off by the same mechanism that turns off most RTKs:
        ubiquitination and degradation. The ubiquitin handle is
        a single tyrosine in the juxtamembrane domain at position
        1003. When Y1003 is phosphorylated, the E3 ligase CBL
        binds, ubiquitinates MET, and routes it to the lysosome.
        Steady-state MET levels are kept low because activated
        receptor is constantly being recycled out.
      </p>
      <p>
        Exon 14 of the MET gene encodes the juxtamembrane region
        that contains Y1003. Splice-site mutations &mdash; point
        mutations or deletions at the splice donor, the splice
        acceptor, or the surrounding intronic region &mdash; cause
        exon 14 to be skipped during pre-mRNA processing. The
        resulting protein lacks Y1003, cannot be efficiently
        ubiquitinated by CBL, and is therefore not degraded after
        activation. The kinase domain is fully wild-type. The
        oncogenic signal is just the same kinase, present at higher
        steady-state levels and active for longer.
      </p>

      <h2>Why this is good for medicinal chemistry</h2>
      <p>
        Because the kinase domain is wild-type, ATP-competitive MET
        inhibitors developed before METex14 was recognized as a
        biomarker still work on it. The pocket has the same shape,
        the same gatekeeper, the same hinge contacts. METex14 is
        not a structural problem at the protein level &mdash; it is
        a mRNA problem. The drug just has to bind MET well; the
        oncogenicity of the variant takes care of itself.
      </p>
      <p>
        Two ATP-competitive MET inhibitors have FDA approval in
        this setting:
      </p>
      <ul>
        <li>
          <strong>Capmatinib (Tabrecta, Novartis)</strong> &mdash;
          Type Ib MET inhibitor, FDA approved May 2020 for advanced
          NSCLC with a MET exon 14 skipping mutation, based on the
          GEOMETRY mono-1 trial. Final results showed a 68%
          objective response rate in treatment-naive patients
          (n=28) and 41% in previously treated patients (n=69).
          Capmatinib is highly selective for MET over related
          kinases &mdash; the off-target profile is comparatively
          clean.
        </li>
        <li>
          <strong>Tepotinib (Tepmetko, Merck KGaA)</strong> &mdash;
          Type Ib MET inhibitor, FDA approved February 2021 for
          the same indication, based on the VISION trial. Objective
          response rate was 51.4% with median duration of response
          of 18.0 months and median progression-free survival of
          11.2 months. Tepotinib has good CNS penetration, which
          matters because MET-driven NSCLC has a high rate of brain
          metastases.
        </li>
      </ul>
      <p>
        Both are once-daily oral agents. Peripheral edema is the
        on-target class effect for MET inhibitors &mdash; not life
        threatening, but enough of an issue that supportive care
        and dose reductions are routine. Crizotinib (originally
        developed for ALK) also has MET activity and has been used
        off-label in this setting, but it is multikinase and is no
        longer the standard of care once capmatinib or tepotinib
        is available.
      </p>

      <h2>Resistance: what to expect</h2>
      <p>
        Resistance to capmatinib and tepotinib has begun to be
        characterized in the clinic and falls into recognizable
        patterns. On-target secondary mutations in the MET kinase
        domain &mdash; particularly <strong>D1228</strong>{" "}
        substitutions (D1228N, D1228H, D1228V) and{" "}
        <strong>Y1230</strong> substitutions (Y1230H, Y1230C,
        Y1230S) &mdash; disrupt the Type Ib binding mode of both
        drugs. These are the MET equivalents of EGFR T790M
        gatekeeper-style mutations: cleanly on-target, predictably
        located near the drug-binding face. Bypass-track activation
        through HER3, EGFR, or KRAS amplification is also seen,
        and combination strategies with EGFR inhibitors are in
        clinical testing.
      </p>
      <p>
        The next-generation MET inhibitor most likely to address
        D1228/Y1230 resistance is{" "}
        <strong>elzovantinib (TPX-0022)</strong>, a Type II MET
        inhibitor designed to bind the kinase in the DFG-out
        conformation that the Type Ib resistance mutations do not
        disrupt. Elzovantinib is in early-phase trials and may
        eventually serve a similar second-line role to osimertinib
        in the EGFR setting.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The canonical MET kinase domain structure for the Type Ib
        binding mode is{" "}
        <a
          href="https://www.rcsb.org/structure/3R7O"
          target="_blank"
          rel="noreferrer noopener"
        >
          3R7O
        </a>{" "}
        &mdash; MET kinase with a Type Ib inhibitor. Because METex14
        leaves the kinase domain unchanged, docking against the
        wild-type kinase is the right starting point for any METex14
        program.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick MET from the target catalog to dock your own
        ligands against the same structure. Liganx also exposes
        D1228N and Y1230H from the mutation chips, so you can see
        how a Type Ib chemotype loses contacts against the
        resistance mutants and where a Type II scaffold has room
        to make new contacts.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based,
        and set up for exactly this kind of resistance question.
        If you want to try molecular docking on MET without a
        local install, that is the fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Wolf J, Seto T, Han JY, et al.{" "}
          <em>
            Capmatinib in MET Exon 14-Mutated or MET-Amplified
            Non-Small-Cell Lung Cancer.
          </em>{" "}
          NEJM 383, 944&ndash;957 (2020).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2002787"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2002787
          </a>
        </li>
        <li>
          Paik PK, Felip E, Veillon R, et al.{" "}
          <em>
            Tepotinib in Non-Small-Cell Lung Cancer with MET Exon
            14 Skipping Mutations.
          </em>{" "}
          NEJM 383, 931&ndash;943 (2020).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2004407"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2004407
          </a>
        </li>
        <li>
          Kong-Beltran M, Seshagiri S, Zha J, et al.{" "}
          <em>
            Somatic mutations lead to an oncogenic deletion of
            Met in lung cancer.
          </em>{" "}
          Cancer Research 66, 283&ndash;289 (2006).{" "}
          <a
            href="https://doi.org/10.1158/0008-5472.CAN-05-2749"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/0008-5472.CAN-05-2749
          </a>
        </li>
        <li>
          Recondo G, Bahcall M, Spurr LF, et al.{" "}
          <em>
            Molecular Mechanisms of Acquired Resistance to MET
            Tyrosine Kinase Inhibitors in Patients with MET Exon
            14-Mutant NSCLC.
          </em>{" "}
          Clinical Cancer Research 26, 2615&ndash;2625 (2020).{" "}
          <a
            href="https://doi.org/10.1158/1078-0432.CCR-19-3608"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/1078-0432.CCR-19-3608
          </a>
        </li>
      </ul>
    </>
  );
}
