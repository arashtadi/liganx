/**
 * Post: KRAS G12C — clinical landscape (2026)
 *
 * SEO target: long-tail queries around "KRAS G12C inhibitors", "sotorasib
 * resistance", "KRAS G12C clinical trials". Internal link to /studio
 * with a reseed payload that pre-loads the canonical KRAS structure +
 * the G12C mutation, so a curious reader can see the docking pocket
 * for themselves in two clicks. That's the SEO conversion moment.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "kras-g12c-clinical-landscape",
  title: "KRAS G12C — clinical landscape, 2026",
  description:
    "A field guide to the four approved KRAS G12C inhibitors, what's known about resistance pathways, and where the medicinal chemistry is going next.",
  date: "2026-05-08",
  author: "Liganx team",
  tags: ["kras", "oncology", "clinical-landscape"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        KRAS sat in the &ldquo;undruggable&rdquo; column for thirty years before sotorasib
        cleared FDA in 2021. Five years on, four covalent G12C inhibitors are
        approved or filed, the first resistance mechanisms have been
        characterized in the clinic, and the next-generation chemistry is
        already moving past the cysteine warhead. Here&rsquo;s where the field
        actually stands.
      </p>

      <h2>The four approved compounds</h2>
      <p>
        All four target the same druggable switch-II pocket that opens only
        in the GDP-bound state of the G12C mutant. The cysteine at position
        12 is the hook every covalent inhibitor exploits — wild-type KRAS
        has glycine there, so the wild-type protein is intrinsically spared.
      </p>
      <ul>
        <li>
          <strong>Sotorasib (AMG 510, Lumakras)</strong> — Amgen, FDA approved
          May 2021 for previously-treated NSCLC. CodeBreaK-100 reported a
          37% objective response rate. Hepatotoxicity is on the label;
          AST/ALT monitoring is mandatory.
        </li>
        <li>
          <strong>Adagrasib (MRTX849, Krazati)</strong> — Mirati/BMS, FDA
          approved December 2022. Slightly higher CNS penetration than
          sotorasib (TPSA &lt; 90 Å²) — relevant because brain mets are
          common in NSCLC. KRYSTAL-1 ORR was 43%.
        </li>
        <li>
          <strong>Divarasib (GDC-6036)</strong> — Genentech, filed 2024.
          Higher selectivity for G12C over related KRAS mutants in vitro,
          which may translate to a cleaner safety profile.
        </li>
        <li>
          <strong>Garsorasib (D-1553)</strong> — InventisBio, approved in
          China 2024. Independent chemotype from the others; useful as
          a sequencing option after first-line resistance.
        </li>
      </ul>

      <h2>What resistance looks like</h2>
      <p>
        Awad et al. (2021) and Tanaka et al. (2021) characterized the first
        sotorasib failures and the resistance landscape is heterogeneous,
        not dominated by a single &ldquo;gateway&rdquo; mutation the way EGFR T790M
        was for first-gen EGFR inhibitors. The recurring motifs:
      </p>
      <ul>
        <li>
          <strong>On-target second-site mutations</strong> — Y96D, R68S, H95D,
          H95Q. Each disrupts the switch-II pocket geometry that the inhibitor
          relies on. These are the cleanest signal that a drug binds where
          you think it binds.
        </li>
        <li>
          <strong>KRAS amplification</strong> — straightforward gene-dosage
          escape. The drug is doing its job, there's just more target.
        </li>
        <li>
          <strong>Bypass-track activations</strong> — co-occurring mutations
          in MET, BRAF, NRAS, MAP2K1. Pathway pivots that route around
          the inhibited node entirely.
        </li>
      </ul>
      <p>
        The clinical implication: G12C inhibitor monotherapy has a ceiling.
        Combinations with SHP2, SOS1, MEK, or anti-PD-1 are most of the
        ongoing trials. The chemistry implication: the next wave is going
        after the GTP-bound state (the &ldquo;ON&rdquo; conformation), not
        just the GDP-bound state these four work on.
      </p>

      <h2>What's coming next</h2>
      <p>
        Three threads are worth watching. <strong>Pan-KRAS inhibitors</strong>
        (e.g. RMC-6236) bind the GDP-bound state non-covalently and hit
        G12D, G12V, and G13D in addition to G12C — which would address
        the 80% of KRAS-mutant tumors the covalent G12C drugs miss.
        <strong>GTP-state binders</strong> (RMC-7977, BI-2865) target the
        ON conformation directly and short-circuit the GTP-loading step
        rather than waiting for the cycle to land in GDP. And{" "}
        <strong>protein-degraders</strong> (KRAS-targeting PROTACs) are
        in early development at Arvinas and Foghorn — degrading the
        protein avoids the resistance-via-second-site-mutation pattern
        entirely, since you can't second-site-mutate something that's
        not there.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The canonical KRAS G12C structure for sotorasib is{" "}
        <a
          href="https://www.rcsb.org/structure/6OIM"
          target="_blank"
          rel="noreferrer noopener"
        >
          6OIM
        </a>{" "}
        — switch-II pocket open, sotorasib covalently bound to Cys12.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick KRAS from the target catalog with G12C from the mutation
        chips to dock your own ligands against the same structure. Liganx
        renders both the wild-type and G12C receptors side-by-side so you
        can see the selectivity story directly — most G12C-selective
        compounds will score 1-2 kcal/mol better against the mutant. The
        ADMET panel will flag hepatotoxicity (the sotorasib pattern) if
        your candidate has the same liabilities.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Canon J, et al. <em>The clinical KRAS(G12C) inhibitor AMG 510 drives
          anti-tumour immunity.</em> Nature 575, 217–223 (2019).{" "}
          <a
            href="https://doi.org/10.1038/s41586-019-1694-1"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41586-019-1694-1
          </a>
        </li>
        <li>
          Awad MM, et al. <em>Acquired Resistance to KRAS G12C Inhibition in
          Cancer.</em> NEJM 384, 2382–2393 (2021).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2105281"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2105281
          </a>
        </li>
        <li>
          Tanaka N, et al. <em>Clinical acquired resistance to KRASG12C
          inhibition through a novel KRAS switch-II pocket mutation and
          polyclonal alterations converging on RAS-MAPK reactivation.</em>{" "}
          Cancer Discov 11, 1913–1922 (2021).
        </li>
      </ul>
    </>
  );
}
