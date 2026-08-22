/**
 * Draft post: RAS(ON) tri-complex inhibitors - the molecular glue class
 *
 * Angle: the RASolute 302 readout made daraxonrasib the biggest RAS story
 * since sotorasib, and the mechanism (CYPA molecular glue, ternary complex)
 * breaks the assumptions single-receptor docking is built on. Honest CTA:
 * dock the switch-II binders, not the glue step.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "ras-on-tri-complex-inhibitors-molecular-glue-daraxonrasib",
  title: "RAS(ON) tri-complex inhibitors: gluing RAS to cyclophilin A",
  description:
    "Daraxonrasib doubled survival in previously treated pancreatic cancer. The mechanism is a molecular glue, not a pocket binder, and that changes how you model it.",
  date: "2026-08-05",
  author: "Liganx team",
  tags: ["kras", "molecular-glue", "oncology", "clinical-landscape"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Every approved KRAS drug so far works the same way: wait for the
        protein to cycle into its GDP-bound &ldquo;OFF&rdquo; state, slip into
        the switch-II pocket that opens there, and staple to Cys12. That
        strategy covers one mutation in one codon. The tri-complex class
        does something structurally stranger &mdash; it recruits a host
        chaperone and glues it to the active, GTP-loaded protein &mdash; and
        in 2026 it produced the largest survival benefit RAS-mutant
        pancreatic cancer has ever seen.
      </p>

      <h2>What RASolute 302 actually showed</h2>
      <p>
        Daraxonrasib (RMC-6236) is an oral RAS(ON) multi-selective inhibitor.
        RASolute 302 randomized 500 patients with metastatic pancreatic ductal
        adenocarcinoma who had progressed on first-line therapy to
        daraxonrasib or investigator-choice chemotherapy. O&rsquo;Reilly et al.
        reported the results in the New England Journal of Medicine in 2026:
      </p>
      <ul>
        <li>
          <strong>Overall survival</strong> &mdash; 13.2 months with
          daraxonrasib versus 6.7 months with chemotherapy in the overall
          population (HR 0.40). In the RAS G12 subgroup the numbers were
          13.2 versus 6.6 months, same hazard ratio.
        </li>
        <li>
          <strong>Progression-free survival</strong> &mdash; 7.3 versus 3.5
          months in the RAS G12 population (HR 0.45); 7.2 versus 3.6 months
          overall (HR 0.49).
        </li>
        <li>
          <strong>Context</strong> &mdash; second-line metastatic PDAC has
          been a graveyard. Doubling median OS in that setting is not an
          incremental result, and it is the first time a RAS-directed agent
          has done it.
        </li>
      </ul>
      <p>
        Regulatory follow-through has moved quickly: an FDA safe-to-proceed
        letter for expanded access arrived in May 2026, and Revolution
        Medicines has signaled an NDA submission. Nothing is approved yet, so
        treat the label details as open.
      </p>

      <h2>The mechanism: a neomorphic interface, not a pocket</h2>
      <p>
        Daraxonrasib does not bind RAS the way sotorasib does. It first binds
        cyclophilin A (CYPA), an abundant intracellular chaperone. The
        inhibitor-CYPA binary complex presents a composite surface that has
        no natural binding partner, and that surface has high affinity for
        the GTP-bound (&ldquo;ON&rdquo;) state of RAS. The resulting
        three-body complex &mdash; drug, CYPA, RAS-GTP &mdash; sterically
        occludes the effector-binding face, so RAF and PI3K can no longer
        dock onto activated RAS. The signal dies even though RAS is still
        loaded with GTP.
      </p>
      <p>
        Holderfield et al. established the mechanism in Nature with RMC-7977,
        the pan-RAS tool compound, showing broad activity across KRAS, NRAS
        and HRAS and, notably, against G12C models that had already escaped
        covalent G12C inhibitors through pathway reactivation. Two selective
        siblings followed the same modality: elironrasib (RMC-6291), a
        covalent G12C(ON) tri-complex inhibitor with FDA Breakthrough Therapy
        designation in NSCLC, and zoldonrasib (RMC-9805), a G12D(ON) agent.
      </p>

      <h2>Resistance already has a structural signature</h2>
      <p>
        A 2026 Cell paper analyzed paired baseline and end-of-treatment
        samples from 40 patients treated with daraxonrasib and found
        recurrent alterations in 18 of them. The interesting part is that
        the resistance mutations do not cluster where you would expect from
        the OFF-state playbook. They converge on breaking the glue itself:
      </p>
      <ul>
        <li>
          <strong>KRAS Y64</strong> &mdash; this tyrosine makes a pi-pi
          stacking contact with the indole of daraxonrasib and is a key
          determinant of KRAS-CYPA complex formation. Mutate it and the
          ternary complex never assembles at high enough occupancy to
          matter.
        </li>
        <li>
          <strong>KRAS Y71</strong> &mdash; a second glue-disrupting site,
          impairing complex formation through a distinct structural
          mechanism.
        </li>
      </ul>
      <p>
        Both sit at the composite interface, not in a classical drug pocket.
        That is the signature of a molecular glue: resistance mutations map
        to the protein-protein contact the drug creates rather than to a
        cavity the drug occupies.
      </p>

      <h2>Why this class is hard to model computationally</h2>
      <p>
        Standard molecular docking assumes one rigid-ish receptor and one
        flexible ligand, scored by a function trained on binary
        protein-ligand crystal structures. A tri-complex violates most of
        that at once:
      </p>
      <ul>
        <li>
          <strong>There are two receptors.</strong> Affinity for CYPA alone
          and affinity for RAS alone are both modest; the potency comes from
          cooperativity in the ternary state. A binary docking score against
          either partner is close to meaningless in isolation.
        </li>
        <li>
          <strong>The interface is induced.</strong> Switch II adopts a
          twisted conformation on RMC-7977 binding. Docking against an
          apo or effector-bound RAS structure will not find it.
        </li>
        <li>
          <strong>Scoring functions have no cooperativity term.</strong>
          Nothing in a Vina-style function represents the entropic cost of
          organizing a third body or the gain from burying a new
          protein-protein surface.
        </li>
      </ul>
      <p>
        The practical workaround the field uses is to treat the
        inhibitor-CYPA binary complex as the receptor and dock or score the
        RAS surface against it, then validate the pose against a
        co-structure. If you only have single-receptor tools, be explicit
        that you are modeling one leg of a three-body problem.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The tractable computational question here is the OFF-state
        comparison. Structures such as{" "}
        <a
          href="https://www.rcsb.org/structure/6OIM"
          target="_blank"
          rel="noreferrer noopener"
        >
          6OIM
        </a>{" "}
        (KRAS G12C with the switch-II pocket open) let you see exactly what
        the covalent class binds and why a single codon change gates it.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick KRAS with G12C, G12D or G12V from the mutation chips to
        dock switch-II binders and compare scores across mutants
        side-by-side. That contrast is the whole argument for the ON-state
        class: the OFF-state pocket is mutation-specific, and the glue
        interface is not.
      </p>
      <p>
        Liganx is molecular docking online, free and browser-based, which
        makes it a reasonable place to run the mutation comparison before
        committing to a modeling stack. Just keep the boundary honest: use
        molecular docking for the binary switch-II question, and reach for
        ternary-complex modeling when the mechanism is a glue.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          O&rsquo;Reilly EM, et al. <em>Daraxonrasib or Chemotherapy in
          Previously Treated Metastatic Pancreatic Cancer.</em> N Engl J Med
          (2026).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2605555"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2605555
          </a>
        </li>
        <li>
          Holderfield M, et al. <em>Concurrent inhibition of oncogenic and
          wild-type RAS-GTP for cancer therapy.</em> Nature 629, 919&ndash;926
          (2024).{" "}
          <a
            href="https://doi.org/10.1038/s41586-024-07205-6"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41586-024-07205-6
          </a>
        </li>
        <li>
          <em>Disrupted molecular glue complex drives RAS inhibitor
          resistance.</em> Cell (2026).{" "}
          <a
            href="https://www.cell.com/cell/fulltext/S0092-8674(26)00332-6"
            target="_blank"
            rel="noreferrer noopener"
          >
            cell.com/S0092-8674(26)00332-6
          </a>{" "}
          (
          <a
            href="https://pubmed.ncbi.nlm.nih.gov/42092352/"
            target="_blank"
            rel="noreferrer noopener"
          >
            PMID 42092352
          </a>
          )
        </li>
        <li>
          <em>Discovery of Elironrasib (RMC-6291), a Potent and Orally
          Bioavailable, RAS(ON) G12C-Selective, Covalent Tricomplex
          Inhibitor.</em> J Med Chem (2025).{" "}
          <a
            href="https://pubmed.ncbi.nlm.nih.gov/39993169/"
            target="_blank"
            rel="noreferrer noopener"
          >
            PMID 39993169
          </a>
        </li>
      </ul>
    </>
  );
}
