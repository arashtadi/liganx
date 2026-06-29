/**
 * Post: MET D1228 and Y1230 — the on-target wall after capmatinib/tepotinib
 *
 * SEO target: "MET D1228 resistance", "MET Y1230 mutation", "capmatinib
 * resistance", "tepotinib resistance", "type I vs type II MET inhibitor".
 * Internal CTA into /studio with MET + the resistance mutations so the
 * reader can dock a type I binder against WT, D1228, and Y1230 and watch
 * the activation-loop score collapse.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "met-d1228-y1230-resistance-type-i-met-inhibitors",
  title: "MET D1228 and Y1230: the wall after capmatinib and tepotinib",
  description:
    "Why the two most common acquired resistance mutations break every approved type I MET inhibitor, the structural reason, and the type II switch that sometimes rescues it.",
  date: "2026-06-10",
  author: "Liganx team",
  tags: ["met", "oncology", "resistance", "nsclc"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        MET exon 14 skipping NSCLC got its first real targeted therapies in
        2020. Within two years the field already had a textbook on-target
        resistance problem, and it lands on just two residues:{" "}
        <strong>D1228</strong> and <strong>Y1230</strong>. If you work on any
        kinase that gets drugged with an active-state binder, this is the
        same trap EGFR and ALK walked into, playing out one more time.
      </p>

      <h2>The drugs that opened the door</h2>
      <p>
        MET exon 14 skipping alterations delete the juxtamembrane regulatory
        exon, stabilize the receptor, and drive roughly 3-4% of lung
        adenocarcinomas. Two type I MET tyrosine kinase inhibitors won
        approval on the strength of single-arm phase II data:
      </p>
      <ul>
        <li>
          <strong>Capmatinib</strong> (Tabrecta) - approved 2020 on the
          GEOMETRY mono-1 trial, with response rates around 68% in
          treatment-naive exon 14 skipping NSCLC.
        </li>
        <li>
          <strong>Tepotinib</strong> (Tepmetko) - approved 2021 on the
          VISION trial, with durable responses and the convenience of
          once-daily dosing.
        </li>
      </ul>
      <p>
        Both are <strong>type I</strong> inhibitors: they bind the active
        (DFG-in) conformation of the MET kinase, wedging into the ATP pocket
        and hydrogen-bonding to the hinge. That binding mode is exactly what
        the two resistance mutations are built to disrupt.
      </p>

      <h2>What D1228 and Y1230 actually do</h2>
      <p>
        Both residues sit in the activation loop, right where a type I drug
        makes its closest contacts.
      </p>
      <ul>
        <li>
          <strong>Y1230 (C/H/D/S/N)</strong> - tyrosine 1230 packs directly
          against the inhibitor in the active-state pocket. Substituting it
          removes a key aromatic contact and reshapes the loop, so the type I
          drug loses grip. This is the single most common on-target escape
          mechanism reported after capmatinib or tepotinib.
        </li>
        <li>
          <strong>D1228 (N/V/H/Y)</strong> - aspartate 1228 is the DFG-motif
          aspartate that coordinates the catalytic magnesium. Mutating it
          shifts the conformational equilibrium and weakens the drug-kinase
          interaction. In the docking, you will see the activation-loop
          contacts that anchored the type I pose simply stop being available.
        </li>
      </ul>
      <p>
        Recondo and colleagues mapped these in patients: profiling
        post-progression biopsies and circulating tumor DNA, they found
        on-target acquired resistance clustering on codons H1094, G1163,
        L1195, D1228, and Y1230, with D1228 and Y1230 the dominant pair.
        These are the residues to put on a mutation-selectivity benchmark for
        any MET program.
      </p>

      <h2>Why a type II switch sometimes rescues it</h2>
      <p>
        The clinically interesting twist is that D1228 and Y1230 do not behave
        the same way against the other inhibitor class.{" "}
        <strong>Type II</strong> inhibitors (cabozantinib, merestinib,
        glesatinib, foretinib) bind the inactive (DFG-out) conformation,
        reaching into the back pocket that opens when the activation loop
        flips out. Because they do not depend on the same active-loop contacts:
      </p>
      <ul>
        <li>
          <strong>Y1230X</strong> mutations are often still sensitive to type
          II inhibitors - the back-pocket binding mode tolerates the changed
          tyrosine.
        </li>
        <li>
          <strong>D1228X</strong> mutations are more stubborn. Some type II
          agents show reduced potency here too, because the DFG aspartate
          itself is part of the conformation type II drugs exploit.
        </li>
      </ul>
      <p>
        That asymmetry is why sequencing a type I inhibitor into a type II
        inhibitor at progression is an active clinical strategy rather than a
        guaranteed fix. It is also a clean illustration of why conformation,
        not just sequence, decides whether a mutation is a resistance
        mutation.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        This is a conformation story, so it is worth seeing in poses rather
        than reading about. Open Studio, pick MET from the target catalog, and
        dock a type I binder against the wild-type kinase, then against the
        D1228 and Y1230 mutants. Watch the activation-loop contacts that hold
        the type I pose disappear in the mutants while the hinge interaction
        survives - that gap is the resistance signal. As always with
        mutation-selectivity work, read the ΔΔ between wild-type and mutant
        rather than the absolute score.
      </p>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick MET with D1228 or Y1230 to dock against this structure.
      </p>
      <p>
        Liganx puts molecular docking online and free in the browser. It is a
        quick way to run molecular docking across MET wild-type, D1228, and
        Y1230 and see why the type I inhibitors hit a wall.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Recondo G, Bahcall M, Spurr LF, et al. <em>Molecular Mechanisms of
          Acquired Resistance to MET Tyrosine Kinase Inhibitors in Patients
          with MET Exon 14-Mutant NSCLC.</em> Clin Cancer Res 26, 2615-2625
          (2020).{" "}
          <a
            href="https://doi.org/10.1158/1078-0432.CCR-19-3608"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/1078-0432.CCR-19-3608
          </a>
        </li>
        <li>
          Wolf J, Seto T, Han JY, et al. <em>Capmatinib in MET Exon
          14-Mutated or MET-Amplified Non-Small-Cell Lung Cancer (GEOMETRY
          mono-1).</em> N Engl J Med 383, 944-957 (2020).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2002787"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2002787
          </a>
        </li>
        <li>
          Paik PK, Felip E, Veillon R, et al. <em>Tepotinib in Non-Small-Cell
          Lung Cancer with MET Exon 14 Skipping Mutations (VISION).</em> N
          Engl J Med 383, 931-943 (2020).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2004407"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2004407
          </a>
        </li>
      </ul>
    </>
  );
}
