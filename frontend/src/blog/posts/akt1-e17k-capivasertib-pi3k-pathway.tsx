/**
 * Post: AKT1 E17K and capivasertib — drugging the node below PI3Kalpha.
 *
 * SEO target: long-tail "AKT1 E17K mutation", "capivasertib AKT
 * inhibitor", "PI3K AKT PTEN pathway breast cancer". Mutation /
 * target-landscape theme, with a recent-news hook (oral AKT1-selective
 * inhibitor fast-tracked June 2026). Internal CTA into /studio framing
 * PI3Kalpha as the catalog node directly upstream of AKT.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "akt1-e17k-capivasertib-pi3k-pathway",
  title: "AKT1 E17K and capivasertib: drugging below PI3K-alpha",
  description:
    "AKT sits downstream of PI3K-alpha and PTEN, so hitting it catches pathway activation from any of three upstream alterations. Here is the biology and the drugs.",
  date: "2026-06-09",
  author: "Liganx team",
  tags: ["akt", "pi3k", "oncology", "resistance"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        The PI3K/AKT/PTEN pathway is one of the most frequently
        dysregulated signaling axes in cancer, and most of the drug
        attention has landed on the top of it. But there is a structural
        argument for hitting the node one step down. AKT integrates the
        output of the whole upstream cassette, so an AKT inhibitor catches
        pathway activation no matter which of several upstream genes is
        broken. That logic is what put capivasertib on the market and what
        is now drawing a new wave of AKT-selective candidates into the
        clinic.
      </p>

      <h2>Where AKT sits, and why that matters</h2>
      <p>
        PI3K-alpha (the catalytic subunit encoded by PIK3CA) phosphorylates
        the membrane lipid PIP2 to PIP3. PTEN is the phosphatase that
        reverses that reaction. AKT is recruited to the membrane by PIP3
        through its pleckstrin homology (PH) domain, gets phosphorylated,
        and then drives growth and survival signaling downstream. Three
        different lesions all converge on the same outcome of too much
        active AKT: an activating PIK3CA mutation that makes more PIP3,
        loss of PTEN that fails to clear PIP3, or an activating mutation in
        AKT itself.
      </p>
      <p>
        Because AKT is the convergence point, an AKT inhibitor is agnostic
        to which upstream gene caused the trouble. A PI3K-alpha-selective
        drug only addresses the PIK3CA branch; it does nothing for PTEN
        loss or a direct AKT mutation. That is the clinical pitch for
        going one node lower.
      </p>

      <h2>AKT1 E17K: the textbook activating mutation</h2>
      <p>
        The canonical activating mutation in AKT itself is{" "}
        <strong>E17K</strong>, a glutamate-to-lysine swap in the PH domain
        first reported by Carpten and colleagues in 2007. The mutation
        changes the electrostatics of the lipid-binding pocket so that AKT1
        is pulled to the membrane in a PIP3-independent way. In other
        words, the mutant AKT no longer waits for PI3K to generate the
        signal; it constitutively localizes and activates. E17K shows up
        in breast, endometrial, ovarian, and colorectal cancers, and it is
        the cleanest example of pathway activation that originates at AKT
        rather than above it.
      </p>

      <h2>Capivasertib: the first approved AKT inhibitor</h2>
      <p>
        Capivasertib (Truqap) is an oral, ATP-competitive pan-AKT
        inhibitor and the first AKT inhibitor to win FDA approval. The
        pivotal CAPItello-291 trial paired capivasertib with fulvestrant
        in hormone-receptor-positive, HER2-negative advanced breast cancer
        that had progressed on an aromatase inhibitor. The biomarker
        design is the interesting part: enrollment captured tumors with
        alterations in any of PIK3CA, AKT1, or PTEN, precisely the three
        upstream lesions that funnel into AKT.
      </p>
      <ul>
        <li>
          <strong>Capivasertib + fulvestrant</strong> — in the
          AKT-pathway-altered population, median progression-free survival
          was 7.3 months versus 3.1 months with placebo plus fulvestrant
          (hazard ratio roughly 0.50). The overall-population benefit was
          smaller but still significant, which is the data that drove the
          biomarker-restricted label.
        </li>
        <li>
          The dominant adverse events were diarrhea and rash, the
          on-target consequences of inhibiting AKT in normal tissue, and
          an intermittent four-days-on, three-days-off schedule is used to
          keep them manageable.
        </li>
      </ul>
      <p>
        Capivasertib is ATP-competitive and pan-AKT, meaning it hits all
        three AKT isoforms. That breadth is part of why the tolerability
        ceiling exists, and it is the gap the next generation is trying to
        close.
      </p>

      <h2>What is next: isoform- and mutant-selective AKT drugs</h2>
      <p>
        The frontier is selectivity. A drug that spares AKT2 (heavily
        involved in insulin signaling and glucose handling) or that
        preferentially engages the E17K-mutant PH domain could widen the
        therapeutic window that diarrhea and hyperglycemia currently cap.
        In early June 2026, Targeted Oncology reported that the FDA
        granted fast-track designation to an oral AKT1-selective candidate
        for HR-positive/HER2-negative advanced breast cancer carrying
        AKT/PI3K/PTEN-pathway alterations, signaling that the
        isoform-selective thesis is now being tested clinically rather
        than just argued on paper. Selectivity claims like these are
        exactly the kind of thing worth checking against structure: an
        isoform- or mutant-selective binder should show a visible
        binding-mode or score difference between the targeted pocket and
        its near-neighbors.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        AKT sits one step below PI3K-alpha, which is in the Liganx target
        catalog.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick PI3K-alpha to dock against the node directly upstream of
        AKT, including the PIK3CA H1047R and E545K hotspots that drive the
        pathway from the top. Comparing how an inhibitor scores against
        wild-type versus the activating mutant is the same ΔΔ exercise that
        separates a real selectivity story from a single headline number,
        and it is the conversion moment for any pathway-targeting program.
      </p>
      <p>
        Liganx puts molecular docking online and free in the browser, so
        running molecular docking across a pathway hotspot and its
        wild-type counterpart is a couple of clicks.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Carpten JD, et al.{" "}
          <em>
            A transforming mutation in the pleckstrin homology domain of
            AKT1 in cancer.
          </em>{" "}
          Nature 448, 439-444 (2007).{" "}
          <a
            href="https://doi.org/10.1038/nature05933"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nature05933
          </a>
        </li>
        <li>
          Turner NC, et al.{" "}
          <em>
            Capivasertib in hormone receptor-positive advanced breast
            cancer.
          </em>{" "}
          N Engl J Med 388, 2058-2070 (2023).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2214131"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2214131
          </a>
        </li>
        <li>
          U.S. Food and Drug Administration.{" "}
          <em>
            FDA approves capivasertib with fulvestrant for breast cancer.
          </em>{" "}
          (November 16, 2023).{" "}
          <a
            href="https://www.fda.gov/drugs/resources-information-approved-drugs/fda-approves-capivasertib-fulvestrant-breast-cancer"
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
