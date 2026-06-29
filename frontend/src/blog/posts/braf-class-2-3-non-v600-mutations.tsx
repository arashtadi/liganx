/**
 * Post: BRAF beyond V600 — class I/II/III mutations and the RAF dimer problem
 *
 * SEO target: "non-V600 BRAF mutations", "BRAF class 2 class 3", "BRAF dimer
 * inhibitor", "paradoxical activation vemurafenib". Mutation-specific theme.
 * Internal CTA into /studio with BRAF + V600E vs a non-V600 residue so a
 * reader can see why a monomer-selective inhibitor scores differently.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "braf-class-2-3-non-v600-mutations",
  title: "BRAF beyond V600: class II and III mutations and RAF dimers",
  description:
    "Why vemurafenib only works on V600, how class II and III BRAF mutants signal as dimers, and why paradoxical activation makes non-V600 disease a different drug-design problem.",
  date: "2026-06-01",
  author: "Liganx team",
  tags: ["braf", "oncology", "resistance", "kinase"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Almost everything written about BRAF in cancer is really about one
        residue: V600. But roughly a third of BRAF mutations seen in the clinic
        fall outside codon 600, and they do not behave like V600E at all. They
        signal through RAF dimers rather than monomers, some of them are
        catalytically dead yet still oncogenic, and the V600-selective drugs
        that transformed melanoma either do nothing against them or actively
        make them worse. The framework that makes sense of this — the class I /
        II / III scheme from Zvi Yao and Neal Rosen&rsquo;s group — is worth
        understanding before you dock anything against a non-V600 BRAF.
      </p>

      <h2>Three classes, defined by how the kinase signals</h2>
      <p>
        The classes are not about where the mutation sits in the sequence;
        they are about the mechanism of ERK activation. Yao et al. (Cancer
        Cell 2015; Nature 2017) sorted BRAF mutants into three groups:
      </p>
      <ul>
        <li>
          <strong>Class I — V600 mutants (V600E/K/D/R).</strong> Constitutively
          active as <em>monomers</em>, fully independent of upstream RAS. This
          is the only class the approved BRAF inhibitors were designed for.
        </li>
        <li>
          <strong>Class II — non-V600, high or intermediate activity.</strong>
          Examples include K601E, L597Q, G469A/V, and the BRAF fusions
          (e.g. KIAA1549-BRAF). These signal as constitutive <em>dimers</em>,
          still RAS-independent, but they need two protomers working together
          rather than one.
        </li>
        <li>
          <strong>Class III — kinase-impaired or kinase-dead.</strong>
          Examples include D594G/N, G466V/E, G596R, and N581S/I. These have
          low or no intrinsic kinase activity, yet they are oncogenic because
          they bind RAS more tightly than wild type and amplify signaling
          through CRAF. They are <em>RAS-dependent</em>: they only drive
          tumors when there is a coexisting source of active RAS, such as an
          NRAS/KRAS mutation, NF1 loss, or upstream receptor tyrosine kinase
          signaling.
        </li>
      </ul>

      <h2>Why vemurafenib fails outside V600</h2>
      <p>
        Vemurafenib, dabrafenib, and encorafenib are <em>monomer-preferring</em>
        type-I RAF inhibitors. They bind the active conformation of a single
        BRAF protomer, which is exactly what a V600E monomer presents. Put one
        of these drugs in front of a RAF <em>dimer</em> and you hit the
        defining failure mode of the whole class: <strong>paradoxical
        activation</strong>. The inhibitor occupies one protomer of the dimer,
        which allosterically transactivates the unoccupied partner protomer.
        Net ERK output goes up, not down.
      </p>
      <p>
        That is not a theoretical curiosity. It is the mechanism behind the
        cutaneous squamous-cell carcinomas seen in vemurafenib-treated patients
        whose normal cells carry RAS mutations, and it is why a class II or
        class III BRAF tumor will often progress, not respond, on a V600
        inhibitor. The structural lesson: if the oncogenic unit is a dimer,
        a drug that binds only one half of it can do the wrong thing.
      </p>

      <h2>Where the drugs are going</h2>
      <p>
        The non-V600 problem is fundamentally a dimer problem, so the design
        goal shifts from &ldquo;bind the active monomer&rdquo; to &ldquo;shut
        down both protomers of the dimer without triggering
        transactivation.&rdquo; Several approaches are in play:
      </p>
      <ul>
        <li>
          <strong>Tovorafenib (Ojemda)</strong> — a type-II pan-RAF inhibitor,
          FDA accelerated approval April 2024 for relapsed/refractory pediatric
          low-grade glioma driven by BRAF fusions or V600 mutations. It is the
          first targeted agent approved for BRAF-fusion (class-II-like) disease,
          precisely because type-I inhibitors paradoxically activate fusion-
          driven tumors. In FIREFLY-1 the overall response rate was 53%.
        </li>
        <li>
          <strong>Plixorafenib (PLX8394)</strong> — a &ldquo;paradox
          breaker&rdquo; designed to disrupt RAF dimerization rather than just
          occupy the active site, blunting the transactivation that drives
          paradoxical signaling.
        </li>
        <li>
          <strong>Pan-RAF / dimer inhibitors</strong> — belvarafenib and
          naporafenib (LXH254) target the dimer directly and have been studied
          in RAS-mutant and class II/III BRAF contexts, often paired with a MEK
          inhibitor to close the downstream escape route.
        </li>
        <li>
          <strong>Hitting upstream RAS for class III.</strong> Because class III
          mutants are RAS-dependent, Yao et al. (Nature 2017) showed they are
          sensitive to anything that lowers active RAS — RTK inhibitors in lung
          and colorectal disease, and the broader RAS-pathway toolkit
          (including the newer KRAS and SHP2 inhibitors) where the RAS lesion is
          drug-accessible.
        </li>
      </ul>

      <h2>What this means for a docking workflow</h2>
      <p>
        Two practical points. First, a monomer-binding score against a class II
        or III BRAF is misleading on its own — the biology that matters is
        dimerization and RAS engagement, which a single-protomer rigid dock does
        not capture. Second, the meaningful comparison is relative: a
        V600-selective inhibitor should look comparable against a V600E monomer
        and noticeably worse, or simply irrelevant, against a dimer-driven
        non-V600 setup. That ΔΔ is the structural echo of why these drugs split
        so cleanly in the clinic.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick BRAF from the target catalog. Dock a V600-selective inhibitor
        such as vemurafenib against V600E, then against a non-V600 residue, and
        watch the binding signature change. It is a fast way to build intuition
        for why the class I / II / III split is a drug-design fault line, not
        just a genetics footnote.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, no install.
        Running molecular docking against V600 and non-V600 BRAF side by side is
        the quickest way to see why one residue reshaped an entire treatment
        landscape.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Yao Z, et al. <em>BRAF mutants evade ERK-dependent feedback by
          different mechanisms that determine their sensitivity to pharmacologic
          inhibition.</em> Cancer Cell 28, 370-383 (2015).{" "}
          <a
            href="https://doi.org/10.1016/j.ccell.2015.08.001"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/j.ccell.2015.08.001
          </a>
        </li>
        <li>
          Yao Z, et al. <em>Tumours with class 3 BRAF mutants are sensitive to
          the inhibition of activated RAS.</em> Nature 548, 234-238 (2017).{" "}
          <a
            href="https://doi.org/10.1038/nature23291"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nature23291
          </a>
        </li>
        <li>
          U.S. FDA. <em>FDA grants accelerated approval to tovorafenib for
          patients with relapsed or refractory BRAF-altered pediatric low-grade
          glioma</em> (April 23, 2024).{" "}
          <a
            href="https://www.fda.gov/drugs/resources-information-approved-drugs/fda-grants-accelerated-approval-tovorafenib-patients-relapsed-or-refractory-braf-altered-pediatric"
            target="_blank"
            rel="noreferrer noopener"
          >
            fda.gov
          </a>
        </li>
      </ul>
    </>
  );
}
