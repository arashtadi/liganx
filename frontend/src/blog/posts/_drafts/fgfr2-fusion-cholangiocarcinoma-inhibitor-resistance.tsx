/**
 * Post: FGFR2-fusion cholangiocarcinoma - inhibitor landscape + resistance
 *
 * Draft (auto-generated). Awaiting human review before publish.
 * Theme: target / mutation deep-dive. FGFR was not yet covered in the
 * blog, so this fills a real catalog gap (biliary + urothelial FGFR).
 * SEO target: "FGFR2 inhibitor resistance", "pemigatinib gatekeeper",
 * "futibatinib covalent FGFR", "FGFR2 V564F", "molecular docking FGFR2".
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "fgfr2-fusion-cholangiocarcinoma-inhibitor-resistance",
  title: "FGFR2-fusion cholangiocarcinoma: drugs and how they fail",
  description:
    "The three approved FGFR inhibitors for biliary cancer, the gatekeeper and molecular-brake mutations that defeat the reversible ones, and why futibatinib is built differently.",
  date: "2026-07-10",
  author: "Liganx team",
  tags: ["fgfr2", "cholangiocarcinoma", "resistance", "oncology"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Intrahepatic cholangiocarcinoma is a rare, aggressive bile-duct
        cancer, and for the roughly 10-15% of patients whose tumors carry an
        FGFR2 fusion it has become one of the cleaner examples of
        genotype-directed therapy. Three FGFR inhibitors are approved in the
        setting, they work well for a while, and then most patients relapse
        through a small, recurring set of kinase-domain mutations. The
        resistance story here is unusually crisp, and it maps directly onto
        the structural biology of the ATP pocket.
      </p>

      <h2>Why FGFR2 fusions are druggable</h2>
      <p>
        A gene fusion joins the FGFR2 kinase domain to a partner protein
        (BICC1, AHCTF1, and dozens of others) that supplies a
        dimerization motif. Forced dimerization switches the kinase on
        constitutively, and the tumor becomes dependent on that signal, the
        classic oncogene-addiction setup. Because the driver is a kinase with
        a well-defined ATP pocket, it is tractable for small-molecule
        inhibitors in a way that a transcription factor or a RAS GTPase is
        not.
      </p>

      <h2>The three approved drugs</h2>
      <ul>
        <li>
          <strong>Pemigatinib (Pemazyre)</strong> - Incyte, FDA accelerated
          approval April 2020, the first targeted drug for cholangiocarcinoma.
          A reversible, ATP-competitive, FGFR1/2/3-selective inhibitor. The
          registrational FIGHT-202 trial reported a 36% objective response
          rate in previously treated FGFR2-fusion disease.
        </li>
        <li>
          <strong>Infigratinib (Truseltiq)</strong> - reversible
          ATP-competitive FGFR1-3 inhibitor, accelerated approval May 2021.
          Chemically distinct from pemigatinib but mechanistically similar,
          and it shares the same resistance liabilities.
        </li>
        <li>
          <strong>Futibatinib (Lytgobi)</strong> - Taiho, approved September
          2022. The important outlier: a covalent, irreversible FGFR1-4
          inhibitor. Its acrylamide warhead forms a bond to a cysteine
          (C491/C492) at the edge of the ATP pocket rather than relying
          purely on reversible contacts. FOENIX-CCA2 reported a 42% objective
          response rate, including durable responses in patients who had
          progressed on a prior reversible FGFR inhibitor.
        </li>
      </ul>
      <p>
        Erdafitinib (Balversa) belongs to the same chemical family but is
        approved in FGFR2/3-altered urothelial cancer rather than biliary
        disease, and the THOR trial established its survival benefit there. It
        is worth mentioning because urothelial and biliary FGFR programs share
        almost identical resistance chemistry.
      </p>

      <h2>How resistance happens</h2>
      <p>
        Unlike the heterogeneous mess of KRAS G12C escape, FGFR2 resistance
        concentrates on two structural themes inside the kinase domain
        itself. Both are on-target, which is the tell-tale sign that these
        drugs bind exactly where they are supposed to.
      </p>
      <ul>
        <li>
          <strong>Gatekeeper mutations (V564F, V564L)</strong> - the
          gatekeeper residue sits at the mouth of the hydrophobic back pocket.
          Swapping the small valine for a bulky phenylalanine or leucine
          creates a steric clash with the aryl group that reversible
          inhibitors thread into that pocket. Reported IC50 shifts exceed
          100-fold for pemigatinib, infigratinib, and erdafitinib. This is the
          FGFR analog of EGFR T790M or ABL T315I: one substitution, one back
          pocket, catastrophic loss of potency.
        </li>
        <li>
          <strong>Molecular-brake mutations (N549K, N549H, K641R,
          E565A)</strong> - these hit the "molecular brake" hinge and the
          activation loop, residues that normally hold the kinase in its
          autoinhibited state. Mutating them doesn't block the drug directly;
          it makes the kinase easier to activate, raising the bar the
          inhibitor has to clear. They tend to confer cross-resistance across
          the reversible selective inhibitors.
        </li>
      </ul>
      <p>
        The clinically useful fact is that futibatinib retains activity
        against several of these mutants, including the V564I/L gatekeeper
        variants, precisely because its covalent bond does not depend on the
        reversible back-pocket contacts that the gatekeeper disrupts.
        Sequencing a covalent inhibitor after a reversible one is now a real
        clinical strategy, and next-generation covalent agents (KIN-3248,
        lirafugratinib and others) are being built specifically to cover the
        resistance spectrum.
      </p>

      <h2>Why this is a docking-shaped problem</h2>
      <p>
        Gatekeeper resistance is fundamentally a shape-complementarity story:
        a single side chain grows, and a ligand that fit yesterday no longer
        fits today. That is exactly the kind of question molecular docking is
        good at making visible. When you dock the same inhibitor against the
        wild-type and V564F receptors, the score gap and the clash geometry in
        the back pocket tell you whether your scaffold is gatekeeper-sensitive
        before you ever synthesize an analog.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and load an FGFR2 kinase-domain structure, then introduce the V564F
        gatekeeper substitution and re-dock your candidate against both the
        wild-type and the mutant receptor. A gatekeeper-sensitive reversible
        inhibitor typically loses 1-3 kcal/mol against the mutant and shows an
        obvious steric overlap where the phenylalanine ring now sits. A
        covalent-style scaffold that anchors near the pocket cysteine should
        hold its pose. Liganx is molecular docking online: free and
        browser-based, so you can run the mutation comparison without a local
        install and see the resistance mechanism as geometry rather than a
        table of IC50 values. If you have never tried molecular docking on a
        gatekeeper mutant, this is the fastest way to build intuition for it.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Abou-Alfa GK, et al. <em>Pemigatinib for previously treated,
          locally advanced or metastatic cholangiocarcinoma: a multicentre,
          open-label, phase 2 study (FIGHT-202).</em> Lancet Oncol 21,
          671-684 (2020).{" "}
          <a
            href="https://doi.org/10.1016/S1470-2045(20)30109-1"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/S1470-2045(20)30109-1
          </a>
        </li>
        <li>
          Goyal L, et al. <em>Futibatinib for FGFR2-Rearranged Intrahepatic
          Cholangiocarcinoma (FOENIX-CCA2).</em> N Engl J Med 388, 228-239
          (2023).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2206834"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2206834
          </a>
        </li>
        <li>
          Sootome H, et al. <em>Futibatinib Is a Novel Irreversible FGFR1-4
          Inhibitor That Shows Selective Antitumor Activity against
          FGFR-Deregulated Tumors.</em> Cancer Res 80, 4986-4997 (2020).{" "}
          <a
            href="https://doi.org/10.1158/0008-5472.CAN-19-2568"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/0008-5472.CAN-19-2568
          </a>
        </li>
        <li>
          Wu Q, et al. <em>Landscape of Clinical Resistance Mechanisms to FGFR
          Inhibitors in FGFR2-Altered Cholangiocarcinoma.</em> Clin Cancer Res
          (2024).{" "}
          <a
            href="https://pmc.ncbi.nlm.nih.gov/articles/PMC10767308/"
            target="_blank"
            rel="noreferrer noopener"
          >
            PMC10767308
          </a>
        </li>
      </ul>
    </>
  );
}
