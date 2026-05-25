/**
 * Post: KRAS G12V — the common mutation still without its own drug.
 *
 * SEO target: "KRAS G12V inhibitor", "pan-KRAS inhibitor", "pan-RAS
 * inhibitor", "KRAS G12V undruggable". Sits alongside the G12C and G12D
 * posts to round out the KRAS series. Internal CTA into /studio with KRAS
 * + G12V so the reader can dock against the mutant surface.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "kras-g12v-pan-ras-undruggable-frontier",
  title: "KRAS G12V: the common mutation still without a drug",
  description:
    "G12C has two approved drugs and G12D has clinical candidates, but KRAS G12V still has none. Here is the structural reason, and the pan-RAS programs trying to fix it.",
  date: "2026-05-22",
  author: "Liganx team",
  tags: ["kras", "oncology", "pan-ras", "mutation-deep-dive"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        KRAS G12V is one of the most common oncogenic mutations in human
        cancer, yet it is the awkward middle child of the KRAS family: G12C
        has two approved inhibitors, G12D has a clutch of clinical-stage
        candidates, and G12V has neither. The reason is partly chemical and
        partly historical, and it explains why the field has pivoted from
        allele-specific design toward pan-RAS strategies.
      </p>

      <h2>Why G12C got drugged first</h2>
      <p>
        Glycine 12 sits at the lip of the nucleotide pocket in KRAS, right
        where GTP hydrolysis happens. Mutating it to almost anything
        impairs the intrinsic hydrolysis that would otherwise switch the
        protein off, so the mutant stays locked in its active, GTP-bound,
        signaling state. G12V impairs intrinsic hydrolysis roughly 9-fold,
        which is among the most potent shut-offs of the off-switch in the
        G12 series.
      </p>
      <p>
        The breakthrough for G12C was not that the cysteine made the protein
        more druggable in general. It was that the mutant cysteine provides
        a <strong>nucleophilic handle</strong> a covalent warhead can lock
        onto, in a transient pocket (the switch-II pocket) that only opens
        in the GDP-bound state. Sotorasib and adagrasib were built around
        that cysteine. Valine has no such handle. It is small, hydrophobic,
        and chemically inert, so the entire covalent playbook that cracked
        G12C simply does not transfer.
      </p>

      <h2>The undruggable-surface problem</h2>
      <p>
        Beyond the missing warhead anchor, KRAS itself is a famously hard
        target. Its surface is comparatively smooth and the only deep,
        well-defined cavity is the picomolar-affinity nucleotide pocket
        already occupied by GTP. Competing with cellular GTP for that site
        is a non-starter. The switch-I and switch-II regions that mediate
        effector binding are shallow and polar, the kind of interface that
        looks undruggable to a classic small-molecule docking campaign. For
        G12V you do not even get the consolation of a covalent foothold.
      </p>

      <h2>The allele-specific attempts</h2>
      <p>
        A few programs are still chasing G12V directly:
      </p>
      <ul>
        <li>
          <strong>JAB-23000</strong> — an allele-selective KRAS G12V
          inhibitor in early development. Allele selectivity is the holy
          grail here because it spares wild-type RAS in normal tissue,
          which should widen the therapeutic window.
        </li>
        <li>
          <strong>MRTX1133</strong> — designed as a non-covalent G12D
          inhibitor, but preclinical data suggest its binding mode may
          extend to G12V, since neither relies on a covalent bond. It is a
          useful proof that you can get potent, selective binding to a
          non-cysteine G12 mutant without a warhead.
        </li>
      </ul>
      <p>
        The honest status as of 2026: no approved therapy is indicated for
        KRAS G12V, and most allele-specific G12V candidates are preclinical
        or in first-in-human dose finding.
      </p>

      <h2>The pan-RAS pivot</h2>
      <p>
        Because chasing each allele one at a time is slow, much of the
        energy has moved to inhibitors that hit a broad range of KRAS
        mutants at once, G12V included:
      </p>
      <ul>
        <li>
          <strong>BI-2865</strong> — a non-covalent, inactive-state
          (GDP-bound) selective pan-KRAS inhibitor that binds wild-type and
          G12A/C/D/V/S, G13 and other mutants with nanomolar affinity, while
          largely sparing the related NRAS and HRAS. It was reported with
          atomic-resolution crystal structures showing how a single
          pharmacophore can engage many different residue-12 substitutions.
        </li>
        <li>
          <strong>Daraxonrasib (RMC-6236)</strong> — a first-in-class oral
          pan-RAS(ON) inhibitor that works by a molecular-glue mechanism: it
          recruits the abundant chaperone cyclophilin A to form a
          tri-complex that clamps the active, GTP-bound RAS and blocks
          effector engagement. Because it targets the active state by a
          glue rather than a covalent bond, it covers G12V/D/A/S, G13 and
          Q61 variants. It is in late-stage trials in RAS-mutant pancreatic
          cancer.
        </li>
      </ul>
      <p>
        The trade-off is selectivity. A drug that hits every RAS allele also
        hits wild-type RAS in healthy cells, so the therapeutic window
        depends on tumors being more addicted to RAS signaling than normal
        tissue. That is the central bet of the pan-RAS class, and the
        clinical data so far suggest the window is real but narrow.
      </p>

      <h2>What this means for your docking workflow</h2>
      <p>
        G12V is a good stress test for a docking pipeline precisely because
        there is no covalent shortcut. When you dock a non-covalent
        candidate against KRAS G12V, the question is whether the pose
        engages the inactive-state switch-II pocket and whether the valine
        substitution shifts the score relative to wild-type. As with the
        EGFR resistance series, the number to watch is the ΔΔ between
        wild-type KRAS and the G12V mutant, not any single absolute score.
        A pan-KRAS candidate should show a small, consistent gap across
        several alleles rather than one spectacular score against one of
        them.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick KRAS from the target catalog, then select the G12V mutation
        chip. Dock a pan-RAS candidate against wild-type, G12C, G12D and
        G12V together and compare the poses: the inactive-state binders
        should land in the switch-II pocket across alleles, while a
        G12C-specific covalent design will only make sense against the
        cysteine. Liganx puts molecular docking online and free in the
        browser, so running molecular docking across the whole KRAS allele
        series takes a few clicks.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Kim D, et al. <em>Pan-KRAS inhibitor disables oncogenic signalling
          and tumour growth.</em> Nature 619, 160&ndash;166 (2023).{" "}
          <a
            href="https://doi.org/10.1038/s41586-023-06123-3"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41586-023-06123-3
          </a>
        </li>
        <li>
          Ma X, et al. <em>Discovery of daraxonrasib (RMC-6236), a potent and
          orally bioavailable RAS(ON) multi-selective, noncovalent tri-complex
          inhibitor.</em> J Med Chem (2024).{" "}
          <a
            href="https://doi.org/10.1021/acs.jmedchem.4c02314"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jmedchem.4c02314
          </a>
        </li>
        <li>
          Lu S, et al. <em>The structural basis of oncogenic mutations G12,
          G13 and Q61 in small GTPase K-Ras4B.</em> Sci Rep 6, 21949 (2016).{" "}
          <a
            href="https://doi.org/10.1038/srep21949"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/srep21949
          </a>
        </li>
      </ul>
    </>
  );
}
