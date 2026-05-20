/**
 * Post: PROTACs and oral bioavailability — what bRo5 chemistry actually requires
 *
 * SEO target: long-tail "PROTAC oral bioavailability", "beyond Rule of Five",
 * "vepdegestrant ARV-471", "PROTAC drug design properties". Internal CTA
 * into /studio with the ADMET panel which flags oral absorption red flags
 * even on bRo5 molecules.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "protac-oral-bioavailability-beyond-rule-of-five",
  title: "PROTACs and oral bioavailability — what bRo5 chemistry actually requires",
  description:
    "PROTACs blow past Lipinski on every count. Vepdegestrant still got oral. Here is the empirical bRo5 window that separates an oral degrader from an IV-only one.",
  date: "2026-05-16",
  author: "Liganx team",
  tags: ["admet", "protac", "drug-design", "bioavailability"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Lipinski&rsquo;s Rule of Five was empirical: orally absorbed drugs
        tend to weigh less than 500 Da, have fewer than five hydrogen-bond
        donors, fewer than ten acceptors, and a cLogP under 5. PROTACs
        violate every one of those numbers and the early ones in the
        clinic were IV-dosed because of it. Then vepdegestrant became
        the first PROTAC to win a Phase 3 with oral dosing and the
        question stopped being &ldquo;can a bRo5 PROTAC be oral&rdquo; and started
        being &ldquo;which physicochemical parameters actually matter when you
        are already past Lipinski.&rdquo; The answer is more useful than the
        original rule.
      </p>

      <h2>Why PROTACs sit outside Ro5</h2>
      <p>
        A PROTAC is a heterobifunctional molecule: a ligand for the
        protein of interest (POI), a ligand for an E3 ubiquitin ligase
        (typically VHL or CRBN), and a linker connecting them. The
        molecule does not occupy a binding site so much as bridge two
        proteins, recruiting the E3 ligase to ubiquitinate the POI,
        which is then degraded by the proteasome. The molecule itself
        is catalytic — it dissociates and recycles after each
        degradation event.
      </p>
      <p>
        The chemistry of doing that with small organic molecules ends
        up between 700 and 1100 Da, with a topological polar surface
        area (TPSA) in the 150-250 range and hydrogen-bond counts well
        above Lipinski limits. The molecule is not a Lipinski drug. The
        question is whether it is in the &ldquo;beyond Rule of Five&rdquo; (bRo5)
        space where cyclic peptides and macrocycles already showed oral
        absorption is possible, or in the genuinely non-oral space.
      </p>

      <h2>The empirical bRo5 window for PROTACs</h2>
      <p>
        Pike et al. (J Med Chem 2023) and the Arvinas team
        (independently, in the AstraZeneca-collaborative work) looked
        at hundreds of PROTACs in rat oral absorption assays and found
        a usable window. The headline numbers, for CRBN-based PROTACs
        with bioavailability above 20%:
      </p>
      <ul>
        <li>
          <strong>Molecular weight 700-900 Da</strong> — CRBN PROTACs
          can absorb well in this band; VHL PROTACs typically run heavier
          (above 1000 Da) and get poor oral exposure as a result.
        </li>
        <li>
          <strong>cLogP 3-6</strong> — higher than Ro5 allows, but the
          lipophilicity is needed to balance the polar surface required
          for two ligand pharmacophores plus a linker.
        </li>
        <li>
          <strong>TPSA up to 200</strong> — well past the 140 ceiling
          that Veber&rsquo;s rules suggested for oral absorption. PROTACs
          break that.
        </li>
        <li>
          <strong>Exposed HBDs (eHBD) ≤ 2</strong> — this is the
          parameter the Arvinas and AstraZeneca papers both isolated as
          the strongest predictor. The number of hydrogen-bond donors
          that are solvent-exposed (not engaged in an intramolecular
          interaction) is what kills membrane permeability. A molecule
          with 5 HBDs but only 2 unsatisfied can still cross the
          membrane; one with 3 HBDs all exposed cannot.
        </li>
      </ul>
      <p>
        The eHBD insight is the actionable design rule that came out of
        this. It explains why two molecules with identical Lipinski
        descriptors can have a 10-fold gap in bioavailability — the
        difference is whether the linker conformation buries the
        donors.
      </p>

      <h2>Vepdegestrant: the clinical proof</h2>
      <p>
        Vepdegestrant (ARV-471, Arvinas/Pfizer) is an oral PROTAC
        degrader of the estrogen receptor. It launched as a VHL-based
        molecule and the chemistry team switched to a CRBN ligand,
        which dropped molecular weight by roughly 200 Da and brought
        the polar surface area into the absorption window. The Phase 3
        VERITAC-2 study in ER+/HER2- metastatic breast cancer with
        ESR1 mutations reported a statistically significant
        progression-free survival benefit over fulvestrant — the
        previous standard injectable degrader. Arvinas and Pfizer
        submitted the NDA in June 2025; the molecule earned Fast Track
        designation in 2024.
      </p>
      <p>
        The clinical milestone matters because every previous PROTAC
        that reached patients was IV-dosed. Vepdegestrant is the
        existence proof that a 720 Da heterobifunctional degrader with
        TPSA around 190 can be a daily oral tablet — provided the
        eHBD count is constrained and the linker geometry encourages
        intramolecular hydrogen bonding. That blueprint is now being
        applied across the PROTAC pipeline.
      </p>

      <h2>What this means for docking workflows</h2>
      <p>
        Two practical implications. First, conventional docking against
        a single protein under-describes a PROTAC&rsquo;s behavior — the
        relevant geometry is the <em>ternary complex</em> of POI,
        PROTAC, and E3 ligase. Tools like PRosettaC, MOE&rsquo;s PROTAC
        module, and Rosetta-based ternary docking exist for that
        problem; standard Vina-class docking is not built for it.
        Second, ADMET prediction at the bRo5 boundary is harder than
        for Ro5 compounds because the training distributions are
        sparser. Models from admet-ai and ADMETLab were trained
        primarily on small molecules and will systematically
        under-predict the oral absorption of well-designed PROTACs and
        over-predict it for poorly designed ones.
      </p>
      <p>
        The pragmatic workflow today is to dock the POI warhead
        separately to confirm it engages the target, dock the E3
        ligand to confirm it engages VHL or CRBN, and run ternary
        modeling in a dedicated tool. The eHBD count, MW, and TPSA
        you compute from the resulting structure are the descriptors
        that should drive linker iteration.
      </p>

      <h2>Try the warhead docking yourself</h2>
      <p>
        While Liganx does not currently do ternary-complex modeling,
        warhead optimization on the POI side is exactly what Liganx is
        built for.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock your candidate POI-side ligand against the target.
        The ADMET panel flags molecular weight, logP, and TPSA
        explicitly on every result row, so you can see at a glance
        whether the warhead alone is consuming so much of the bRo5
        budget that the final PROTAC will not be orally bioavailable.
        Aim to keep the warhead under 350 Da and below cLogP 4 if you
        want headroom for the linker plus E3 ligand.
      </p>
      <p>
        Liganx is molecular docking online and free in the browser,
        useful for the target-side optimization step even when the
        final molecule is bRo5. Using molecular docking on the warhead
        before committing to a linker is the cheapest place to fix
        physicochemical drift.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Edmondson SD, Yang B, Fallan C. <em>Phenotypic drug discovery
          for protein-protein degraders: physicochemical property
          determinants of oral absorption for PROTAC protein
          degraders.</em> J Med Chem 66, 8810-8839 (2023).{" "}
          <a
            href="https://doi.org/10.1021/acs.jmedchem.3c00740"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jmedchem.3c00740
          </a>
        </li>
        <li>
          Pike A, Williamson B, Harlfinger S, Martin S, McGinnity DF.{" "}
          <em>Optimising proteolysis-targeting chimeras (PROTACs) for
          oral drug delivery: a drug metabolism and pharmacokinetics
          perspective.</em> Drug Discov Today 25, 1793-1800 (2020).{" "}
          <a
            href="https://doi.org/10.1016/j.drudis.2020.07.013"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/j.drudis.2020.07.013
          </a>
        </li>
        <li>
          Hamilton EP, et al. <em>Vepdegestrant, a PROTAC estrogen
          receptor degrader, in advanced ER-positive HER2-negative
          breast cancer.</em> Nat Med 30, 3289-3297 (2024).{" "}
          <a
            href="https://doi.org/10.1038/s41591-024-03245-7"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41591-024-03245-7
          </a>
        </li>
        <li>
          Snyder LB, et al. <em>NDA submission of vepdegestrant
          (ARV-471) to U.S. FDA: the beginning of a new era of PROTAC
          degraders.</em> J Med Chem (2025).{" "}
          <a
            href="https://doi.org/10.1021/acs.jmedchem.5c01818"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jmedchem.5c01818
          </a>
        </li>
      </ul>
    </>
  );
}
