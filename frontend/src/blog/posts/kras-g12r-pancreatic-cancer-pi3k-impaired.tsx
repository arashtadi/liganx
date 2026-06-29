/**
 * Post: KRAS G12R — the atypical PDAC mutant that signals differently
 *
 * Mutation-specific theme. G12R is the third most common KRAS variant in
 * pancreatic ductal adenocarcinoma and is biochemically atypical: it is
 * impaired for PI3K (p110a) engagement and canonical macropinocytosis, which
 * changes both the biology and the drugging strategy. Distinct from the
 * existing G12C/G12D/G12V/Q61 posts. Internal CTA into /studio with KRAS +
 * G12R for a mutant-vs-wildtype docking comparison.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "kras-g12r-pancreatic-cancer-pi3k-impaired",
  title: "KRAS G12R: the atypical PDAC mutant that signals differently",
  description:
    "G12R is the third most common KRAS mutation in pancreatic cancer and is biochemically odd: impaired for PI3K and macropinocytosis. Here is why it matters.",
  date: "2026-06-06",
  author: "Liganx team",
  tags: ["kras", "oncology", "pdac", "mutation"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Most discussion of oncogenic KRAS treats the codon-12 variants as
        interchangeable drivers that differ mainly in which warhead can
        reach them. G12R breaks that assumption. It is the third most
        common KRAS mutation in pancreatic ductal adenocarcinoma (PDAC),
        accounting for roughly 20% of cases, yet it is nearly absent from
        lung and colorectal cancer. More importantly, it does not signal
        the way G12D and G12V do, which has real consequences for how you
        would try to drug it.
      </p>

      <h2>Why arginine at position 12 is different</h2>
      <p>
        Substituting a bulky, positively charged arginine at residue 12
        does the usual thing of impairing GTP hydrolysis and locking KRAS
        in the active state. But the side chain also reaches into switch II
        and perturbs the surface that the lipid kinase PI3K docks against.
        Hobbs et al. (Cancer Discovery, 2020) showed that KRAS G12R is
        defective for interaction with the p110a catalytic subunit of
        PI3K. As a result, G12R-mutant PDAC does not drive
        macropinocytosis through the canonical RAS-to-PI3K route that
        feeds G12D and G12V tumors their nutrients; the cells lean instead
        on a RAS-independent, PI3K-gamma-supported pathway.
      </p>
      <p>
        That is not a trivia point. Macropinocytosis is how PDAC scavenges
        protein from a nutrient-poor stroma, and the PI3K axis is a major
        survival input. A mutant that has rewired both of those is a
        different therapeutic target than its codon-12 siblings, even
        though the activating lesion sits on the same residue.
      </p>

      <h2>Why the existing KRAS drugs miss it</h2>
      <p>
        G12R falls into the gap between the two main drugging playbooks.
      </p>
      <ul>
        <li>
          <strong>Covalent G12C inhibitors</strong> (sotorasib, adagrasib)
          are irrelevant: there is no cysteine 12 to form a Michael adduct
          with. Arginine offers no comparable nucleophile.
        </li>
        <li>
          <strong>Non-covalent pan-KRAS inhibitors</strong> have struggled
          here too. BI-2865, the pan-KRAS tool compound from Kim et al.
          (Nature, 2023), suppresses a wide spectrum of KRAS mutants but
          specifically excludes G12R and the Q61 variants, because the
          arginine reshapes the pocket those compounds rely on.
        </li>
        <li>
          <strong>MEK inhibition</strong> was the early rationale: if G12R
          cannot engage PI3K, the tumor should lean harder on the MAPK
          arm. In practice a phase 2 study of selumetinib in G12R-mutant
          PDAC produced no radiographic responses, with a median
          progression-free survival around 3 months. Loss of PI3K input
          did not translate into MEK dependence in the clinic.
        </li>
      </ul>

      <h2>Where the hope is now</h2>
      <p>
        The most credible path to G12R is the RAS(ON) multi-selective
        class. Daraxonrasib (RMC-6236) glues active RAS-GTP to cyclophilin
        A and blocks effector engagement regardless of which residue is
        mutated, so it covers G12R alongside G12D, G12V and G13D rather
        than depending on a residue-specific handle. In the phase 1
        program it produced a 36% objective response rate in second-line
        KRAS G12X-mutant metastatic PDAC at the 300 mg dose, with a median
        progression-free survival of 8.8 months, and earned FDA
        breakthrough therapy designation. The phase 3 RASolute 302 study
        explicitly enrolls G12X, G13X and Q61X disease, so G12R patients
        finally sit inside a registrational trial rather than outside every
        targeted option.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The G12R pocket is the interesting part: the arginine guanidinium
        is exactly what reshapes switch II and defeats pocket-binders tuned
        for the smaller codon-12 mutants.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick KRAS from the target catalog with the G12R mutation chip,
        then run the same ligand against G12R, G12D and wild-type in
        parallel. The molecular docking scores should show a non-covalent
        binder that fits G12D losing ground against G12R as the arginine
        crowds the site, which is the structure-level version of why
        BI-2865 excludes this variant. The point of the comparison is the
        ΔΔ across mutants, not the absolute score on any one.
      </p>
      <p>
        Liganx is molecular docking online and free in the browser, built
        for this kind of mutant-versus-wildtype triage. If you want to run
        molecular docking on KRAS G12R without a local install, it is the
        fastest way to see the pocket difference for yourself.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Hobbs GA, et al. <em>Atypical KRASG12R mutant is impaired in
          PI3K signaling and macropinocytosis in pancreatic cancer.</em>{" "}
          Cancer Discov 10, 104-123 (2020).{" "}
          <a
            href="https://doi.org/10.1158/2159-8290.CD-19-1006"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2159-8290.CD-19-1006
          </a>
        </li>
        <li>
          Kim D, et al. <em>Pan-KRAS inhibitor disables oncogenic
          signalling and tumour growth.</em> Nature 619, 160-166 (2023).{" "}
          <a
            href="https://doi.org/10.1038/s41586-023-06123-3"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41586-023-06123-3
          </a>
        </li>
        <li>
          Wolpin BM, et al. <em>Daraxonrasib in previously treated
          advanced RAS-mutated pancreatic cancer.</em> N Engl J Med (2026).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2505783"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2505783
          </a>
        </li>
      </ul>
    </>
  );
}
