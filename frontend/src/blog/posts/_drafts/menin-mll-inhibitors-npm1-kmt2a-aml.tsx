/**
 * Post: Menin-MLL inhibitors — the new AML target class (2026)
 *
 * SEO target: "menin inhibitor", "revumenib", "ziftomenib", "NPM1
 * mutant AML treatment", "KMT2A rearranged leukemia". Internal link
 * into /studio framed around modeling the menin-MLL interface and the
 * MEN1 M327I resistance mutation.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "menin-mll-inhibitors-npm1-kmt2a-aml",
  title: "Menin-MLL inhibitors: a new drug class for AML",
  description:
    "Two menin inhibitors are now FDA-approved for NPM1-mutant and KMT2A-rearranged leukemia. Here is how they work and why MEN1 mutations break them.",
  date: "2026-07-26",
  author: "Liganx team",
  tags: ["menin", "aml", "oncology", "clinical-landscape"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Acute myeloid leukemia driven by NPM1 mutations or KMT2A
        rearrangements accounts for roughly a third of adult AML, and until
        recently there was no targeted option for either. That changed with
        menin inhibitors — a protein-protein-interaction drug class that
        went from first-in-human dosing to two FDA approvals in under four
        years. Here is where the class actually stands.
      </p>

      <h2>Why menin matters in these leukemias</h2>
      <p>
        Menin is a scaffold protein, the product of the <em>MEN1</em> gene.
        In NPM1-mutant and KMT2A-rearranged AML it binds the N-terminus of
        MLL (KMT2A) and tethers a transcriptional complex to the promoters
        of leukemogenic genes such as <em>HOXA9</em> and <em>MEIS1</em>.
        Those genes keep the blasts locked in an undifferentiated,
        self-renewing state. Break the menin-MLL interaction and the
        leukemia cells lose that program and begin to differentiate back
        toward normal myeloid cells. Unlike a kinase, menin has no catalytic
        pocket to inhibit; the drugs instead occupy the deep hydrophobic
        pocket where the MLL peptide docks, which is why this is a
        protein-protein-interaction problem rather than an active-site one.
      </p>

      <h2>The two approved compounds</h2>
      <ul>
        <li>
          <strong>Revumenib (Revuforj, SNDX-5613)</strong> — Syndax. FDA
          approved November 2024 for relapsed/refractory acute leukemia
          with a KMT2A translocation, in patients 1 year and older, then
          expanded in October 2025 to relapsed/refractory NPM1-mutant AML.
          The pivotal AUGMENT-101 phase 1/2 trial treated 104 patients; the
          CR plus CR-with-partial-hematologic-recovery (CR+CRh) rate was
          about 21%, with a median duration of roughly 6.4 months and a
          median time to response near 1.9 months. It carries a boxed
          warning for differentiation syndrome and requires QTc monitoring.
        </li>
        <li>
          <strong>Ziftomenib (Komzifti)</strong> — Kura Oncology and Kyowa
          Kirin. FDA approved November 2025 for adults with
          relapsed/refractory NPM1-mutant AML. The KOMET-001 trial enrolled
          112 patients; CR+CRh was 21.4% with a median duration around 5.0
          months. It is dosed once daily and had a low discontinuation rate
          for adverse events (about 3%), a chemotype and pharmacology
          distinct from revumenib.
        </li>
      </ul>
      <p>
        Both drugs hit the same pocket but with different scaffolds, which
        matters for sequencing: a tumor that escapes one may still be
        vulnerable to the other.
      </p>

      <h2>How resistance emerges: MEN1 mutations</h2>
      <p>
        The most informative resistance signal is on-target. Perner and
        colleagues (Nature, 2023) sequenced patients relapsing on revumenib
        and found acquired somatic mutations in <em>MEN1</em> itself,
        clustered at residues that line the inhibitor pocket — M327, G331,
        and T349. These were absent before treatment and appeared in a large
        fraction of relapses. The M327I variant is the cleanest example:
        methionine-to-isoleucine at position 327 abolishes a key hydrogen
        bond (involving W346 in the wild-type pocket) that anchors revumenib,
        so the drug can no longer hold its pose while the MLL peptide can
        still bind. It is the same logic as a kinase gatekeeper mutation, just
        on a scaffold protein instead of an ATP site.
      </p>
      <p>
        Because the two approved compounds are chemically distinct, an
        emergent MEN1 mutation that cripples one inhibitor does not
        necessarily cripple the other. Early clinical reports describe
        switching menin inhibitors after an M327I-driven relapse, and
        preclinical work suggests some newer chemotypes retain binding
        against the mutant pocket. That is an argument for genotyping
        <em>MEN1</em> at relapse rather than abandoning the whole class.
      </p>

      <h2>What is next for the class</h2>
      <p>
        The obvious direction is moving menin inhibitors earlier — into
        frontline combinations with venetoclax plus azacitidine, or with
        intensive chemotherapy — where the leukemia burden is lower and
        resistant subclones have had less time to expand. Multiple
        next-generation menin binders are in trials specifically designed to
        hold affinity against the M327/G331/T349 resistance residues. The
        broader lesson is that a well-defined protein-protein interface, long
        considered undruggable, turned into a validated target class in a few
        years — and the resistance playbook looks remarkably like the one
        oncologists already know from kinase inhibitors.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The menin-MLL interface is a textbook case for structure-based work:
        a deep, mostly hydrophobic pocket with a handful of anchoring polar
        contacts. In{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Studio
        </Link>{" "}
        you can load a menin structure, dock a menin-MLL inhibitor scaffold
        into that pocket, then model the M327I substitution and re-dock to
        watch the anchoring hydrogen bond disappear — the structural reason
        the drug fails. Comparing wild-type versus M327I poses side by side
        is exactly the kind of mutation question molecular docking is good at.
        Liganx is molecular docking online: free and browser-based, so you can
        run this without a local install.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Perner F, et al. <em>MEN1 mutations mediate clinical resistance to
          menin inhibition.</em> Nature 615, 913-919 (2023).{" "}
          <a
            href="https://doi.org/10.1038/s41586-023-05755-9"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41586-023-05755-9
          </a>
        </li>
        <li>
          Issa GC, et al. <em>Menin inhibition with revumenib for
          NPM1-mutated relapsed or refractory acute myeloid leukemia: the
          AUGMENT-101 study.</em> Blood 146(9), 1065 (2025).{" "}
          <a
            href="https://ashpublications.org/blood/article/146/9/1065/537139"
            target="_blank"
            rel="noreferrer noopener"
          >
            ashpublications.org/blood
          </a>
        </li>
        <li>
          U.S. FDA / ASCO Post. <em>FDA Approves Ziftomenib for NPM1-Positive
          AML.</em> (November 2025).{" "}
          <a
            href="https://ascopost.com/news/november-2025/fda-approves-ziftomenib-for-npm1-positive-aml/"
            target="_blank"
            rel="noreferrer noopener"
          >
            ascopost.com
          </a>
        </li>
      </ul>
    </>
  );
}
