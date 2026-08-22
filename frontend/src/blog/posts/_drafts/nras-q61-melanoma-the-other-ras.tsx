/**
 * Draft: NRAS Q61 in melanoma.
 *
 * Angle: the RAS isoform nobody drugged. Q61 breaks GTP hydrolysis rather
 * than offering a covalent handle, so the whole G12C playbook does not
 * transfer. Everything clinical happens downstream at RAF and MEK, which
 * is also where the docking is tractable. CTA routes to BRAF in Studio.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "nras-q61-melanoma-the-other-ras",
  title: "NRAS Q61 in melanoma: the RAS mutation with no warhead",
  description:
    "Q61 mutations lock NRAS in the GTP-bound ON state and offer no cysteine to hook. Why the KRAS G12C playbook does not transfer, and what is actually being tested.",
  date: "2026-08-01",
  author: "Liganx team",
  tags: ["nras", "melanoma", "ras", "mek", "resistance"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Roughly a fifth of cutaneous melanomas carry an activating NRAS
        mutation, and the overwhelming majority of those sit at codon 61.
        NRAS-mutant melanoma has been a recognized molecular subtype for
        two decades and still has no approved targeted therapy. That is not
        for lack of interest. It is because Q61 breaks RAS in a way that
        leaves nothing obvious to bind.
      </p>

      <h2>What Q61 actually does</h2>
      <p>
        Glutamine 61 is the catalytic residue of the RAS GTPase. Its side
        chain helps position and orient the water molecule that attacks the
        gamma-phosphate of GTP, and it stabilizes the transition state of
        hydrolysis. Substituting arginine, lysine, or leucine at that
        position removes the catalytic machinery entirely. Both the slow
        intrinsic hydrolysis and the much faster GAP-stimulated hydrolysis
        collapse, and the protein sits in the GTP-bound state essentially
        permanently.
      </p>
      <p>
        This matters enormously for chemistry. The four approved KRAS G12C
        drugs all exploit two things Q61 does not provide: a nucleophilic
        cysteine introduced by the mutation itself, and a switch-II pocket
        that only opens when the protein cycles through the GDP-bound
        state. Q61R, Q61K, and Q61L give you neither. There is no new
        cysteine. And a protein that cannot hydrolyze GTP never visits the
        conformation where the pocket appears. Every design assumption
        behind the G12C generation fails at once.
      </p>
      <p>
        The three common substitutions are also not interchangeable. Q61R
        and Q61K dominate in melanoma; Q61L is less common. They differ in
        how completely they ablate hydrolysis and in the effector output
        that follows, which is one reason mutation-specific docking is
        worth doing rather than treating &ldquo;NRAS-mutant&rdquo; as one
        bucket.
      </p>

      <h2>Downstream is where the drugs are</h2>
      <p>
        Because the node itself resisted direct targeting, the field went
        one step down the cascade to MEK1/2.
      </p>
      <ul>
        <li>
          <strong>Binimetinib</strong> — an allosteric MEK1/2 inhibitor,
          tested against dacarbazine in the phase 3 NEMO trial in
          NRAS Q61-mutant advanced melanoma. It met its primary endpoint:
          median progression-free survival improved from 1.5 to 2.8 months
          (HR 0.62), with a higher objective response rate. Overall survival
          did not separate. The regulatory application in this indication
          was withdrawn, and binimetinib went on to be approved in
          combination with encorafenib for BRAF V600 disease instead.
        </li>
        <li>
          <strong>Trametinib plus low-dose dabrafenib</strong> — the
          TraMel-WT phase 2 study asked whether adding a RAF inhibitor at a
          low dose to MEK blockade improves tolerability and depth of
          response in NRAS Q61R/K/L melanoma. It is an instructive design
          because in a RAS-mutant background, V600E-selective RAF
          inhibitors cause paradoxical pathway activation rather than
          inhibition.
        </li>
        <li>
          <strong>Naporafenib plus trametinib</strong> — the current lead
          hypothesis. Naporafenib is a pan-RAF inhibitor, which is the
          point: signaling downstream of GTP-loaded NRAS runs through RAF
          dimers, and dimer-competent pan-RAF inhibition avoids the
          paradox that traps V600E-selective compounds. Pooled phase 1b/2
          data in NRAS-mutant melanoma showed median overall survival
          around 13 to 14 months with median PFS near 5 months, and the
          combination carries FDA fast track designation. The pivotal
          SEACRAFT-2 phase 3 compares it to physician&rsquo;s choice in the
          post-immunotherapy setting.
        </li>
      </ul>
      <p>
        The sequencing context matters when reading any of these numbers.
        Anti-PD-1 therapy, with or without anti-CTLA-4, remains first line
        in advanced melanoma regardless of NRAS status, so targeted-agent
        trials in this population are almost all running in
        immunotherapy-refractory patients. That is a harder bar than the
        first-line BRAF V600E data most readers have calibrated on.
      </p>

      <h2>The vertical blockade problem</h2>
      <p>
        MEK monotherapy in a RAS-mutant tumor is fighting relief of
        feedback. Inhibiting MEK removes ERK-dependent negative feedback on
        RAF and on upstream receptor signaling, so the pathway partially
        rebounds and the therapeutic window closes. This is why nearly
        every current NRAS strategy is vertical: RAF plus MEK, or a
        SHP2/SOS1 agent added to reduce the fraction of NRAS that gets
        reloaded with GTP in the first place. Combining upward instead of
        outward is the structural lesson from a decade of MEK
        monotherapy disappointment.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        NRAS itself has no orthosteric pocket worth screening against in
        the GTP state, but the tractable part of this pathway does.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick BRAF from the target catalog to dock against the RAF
        kinase domain, then compare a V600E-selective chemotype against a
        type II or dimer-competent scaffold. The scoring difference between
        the two receptor states is the same structural fact that makes
        pan-RAF inhibitors the sensible choice in an NRAS-mutant background
        and makes V600E-selective drugs actively counterproductive there.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and set up
        so you can hold the mutation fixed and vary the ligand, which is the
        comparison that actually answers a medicinal chemistry question.
        If you want to run molecular docking on the RAF/MEK axis without a
        local install, that is the fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Dummer R, et al. <em>Binimetinib versus dacarbazine in patients
          with advanced NRAS-mutant melanoma (NEMO): a multicentre,
          open-label, randomised, phase 3 trial.</em> Lancet Oncol 18,
          435&ndash;445 (2017).{" "}
          <a
            href="https://pubmed.ncbi.nlm.nih.gov/28284557/"
            target="_blank"
            rel="noreferrer noopener"
          >
            PMID:28284557
          </a>
        </li>
        <li>
          Hunter JC, et al. <em>Biochemical and Structural Analysis of Common
          Cancer-Associated KRAS Mutations.</em> Mol Cancer Res 13,
          1325&ndash;1335 (2015).{" "}
          <a
            href="https://doi.org/10.1158/1541-7786.MCR-15-0203"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/1541-7786.MCR-15-0203
          </a>
        </li>
        <li>
          Cancer Genome Atlas Network. <em>Genomic Classification of
          Cutaneous Melanoma.</em> Cell 161, 1681&ndash;1696 (2015).{" "}
          <a
            href="https://doi.org/10.1016/j.cell.2015.05.044"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/j.cell.2015.05.044
          </a>
        </li>
        <li>
          <em>A Phase 2 Clinical Trial of Trametinib and Low-Dose Dabrafenib
          in Patients with Advanced Pretreated NRAS Q61R/K/L Mutant Melanoma
          (TraMel-WT).</em>{" "}
          <a
            href="https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8122428/"
            target="_blank"
            rel="noreferrer noopener"
          >
            PMC8122428
          </a>
        </li>
        <li>
          Erasca, Inc. <em>Initiation of SEACRAFT-2 pivotal phase 3 trial of
          naporafenib plus trametinib in NRAS-mutant melanoma.</em> (2024).{" "}
          <a
            href="https://investors.erasca.com/news-releases/news-release-details/erasca-initiates-seacraft-2-pivotal-phase-3-trial-evaluating"
            target="_blank"
            rel="noreferrer noopener"
          >
            investors.erasca.com
          </a>
        </li>
      </ul>
    </>
  );
}
