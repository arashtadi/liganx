/**
 * Draft: PRMT5 / MTAP-deletion synthetic lethality.
 *
 * Angle: MTA-cooperative inhibitors are the cleanest recent example of a
 * drug whose selectivity comes from the receptor state rather than the
 * ligand. Docking hook: you must model the PRMT5:MEP50:MTA complex, not
 * apo PRMT5, or the pocket you screen against does not exist.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "prmt5-mtap-deletion-mta-cooperative-inhibitors",
  title: "PRMT5 and MTAP deletion: selectivity from a metabolite",
  description:
    "MTA-cooperative PRMT5 inhibitors get their tumor selectivity from a metabolite in the pocket, not from the ligand. How that works and what the clinic shows.",
  date: "2026-08-01",
  author: "Liganx team",
  tags: ["prmt5", "mtap", "synthetic-lethality", "target-landscape"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        PRMT5 is essential in every cell, which normally disqualifies a
        target. The reason it is now one of the most crowded areas in
        oncology chemistry is a genomic accident: the MTAP gene sits
        immediately adjacent to CDKN2A on chromosome 9p21, and when tumors
        delete the tumor suppressor they usually take MTAP with it. That
        accident hands medicinal chemists a selectivity handle made of
        metabolite rather than protein.
      </p>

      <h2>The synthetic lethality, in one paragraph</h2>
      <p>
        MTAP degrades methylthioadenosine, a byproduct of polyamine
        synthesis. Delete MTAP and MTA accumulates to high intracellular
        concentrations. MTA happens to be a weak, SAM-competitive inhibitor
        of PRMT5, so MTAP-null cells already run with PRMT5 partially
        suppressed. They survive on the residual activity, and they are
        acutely sensitive to anything that removes the rest. Three
        independent groups reported this dependency in 2016, and roughly
        10 to 15 percent of all human cancers carry the deletion, with
        strong enrichment in glioblastoma, mesothelioma, pancreatic
        adenocarcinoma, bladder, and biliary tract tumors.
      </p>

      <h2>Why the first generation failed</h2>
      <p>
        The obvious move was a potent PRMT5 inhibitor. Several reached the
        clinic, mostly SAM-competitive or substrate-competitive compounds.
        They worked on the enzyme and were disappointing as drugs, because
        they inhibited PRMT5 identically in MTAP-null tumor cells and in
        MTAP-intact normal tissue. The synthetic-lethal window exists in
        biology but the molecule could not see it, so dose was limited by
        on-target hematologic toxicity long before tumor coverage was
        achieved. This is a general lesson worth internalizing: a
        genotype-defined dependency does not give you a therapeutic index
        unless the ligand itself can distinguish the two cell states.
      </p>

      <h2>MTA-cooperative binding</h2>
      <p>
        The second generation solved it by binding the PRMT5:MTA complex
        preferentially over apo PRMT5. The inhibitor packs directly against
        the bound MTA in the cofactor site, so its affinity depends on MTA
        occupancy, which depends on MTAP status. In tumor cells the
        metabolite is present and the compound binds tightly; in normal
        cells MTAP has cleared the MTA and the same compound binds far more
        weakly. Selectivity comes from the receptor state, not from any
        difference in the protein sequence between tumor and host. There is
        no mutant PRMT5 anywhere in this story.
      </p>
      <ul>
        <li>
          <strong>MRTX1719 / BMS-986504 (navlimetostat)</strong> — the
          first MTA-cooperative compound described, from Mirati and now
          Bristol Myers Squibb. Phase 1 in homozygous MTAP-deleted solid
          tumors showed tolerability and activity across multiple tumor
          types, with symmetric dimethylarginine used as the
          pharmacodynamic readout: plasma SDMA fell by roughly half from
          baseline by cycle 2 in patients with matched samples. Combination
          studies with olaparib and with KRAS inhibitors are ongoing.
        </li>
        <li>
          <strong>AMG 193</strong> — Amgen&rsquo;s MTA-cooperative inhibitor,
          structurally distinct with a different binding mode to the same
          complex. The first-in-human dose exploration in 80 patients with
          MTAP-deleted tumors reported an objective response rate of about
          21 percent among those receiving active doses, with a median
          duration of response of 8.3 months, and complete tumor SDMA
          suppression at 480 mg and above. Responses included pancreatic
          and biliary tract cancers, which are two of the hardest
          populations in solid tumor oncology.
        </li>
        <li>
          <strong>TNG908 and TNG462</strong> — Tango Therapeutics, with
          TNG462 designed for improved MTA cooperativity and CNS exposure
          relative to the earlier compound. Glioblastoma is heavily
          MTAP-deleted, so brain penetration is a real differentiator here
          rather than a nice-to-have.
        </li>
      </ul>
      <p>
        Two distinct chemotypes achieving the same cooperativity through
        different binding modes is the strongest available evidence that
        the mechanism is a designable property rather than a lucky
        scaffold.
      </p>

      <h2>What this means for docking</h2>
      <p>
        If you screen against apo PRMT5, you will find SAM-competitive
        binders and you will rediscover the first generation. The pocket
        that MTA-cooperative compounds occupy only exists with MTA in
        place, and MTA contributes a substantial share of the buried
        surface that the inhibitor packs against. The receptor you dock
        into therefore has to be the PRMT5:MEP50 heterooctamer with MTA
        modeled as part of the receptor, and any scoring you do should
        treat the metabolite as a structural component rather than
        something to strip out during protein preparation. It is the
        clearest recent case of a cofactor deciding whether a virtual
        screen is answering the right question at all.
      </p>
      <p>
        The corollary is that a proper selectivity assessment here is a
        differential calculation, not an absolute one. What you want is the
        score difference between the MTA-bound and MTA-free receptors for
        the same ligand, which is the same delta-delta logic that makes
        mutation-selective docking informative.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The combination story is where this intersects with the targets
        most readers already work on. MTAP deletion is common in pancreatic
        adenocarcinoma, which is overwhelmingly KRAS-mutant, and
        preclinical work has shown that pairing an MTA-cooperative PRMT5
        inhibitor with a KRAS inhibitor is more effective than either alone
        in MTAP-deleted KRAS-mutant pancreatic models.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick KRAS with G12D from the mutation chips to dock against the
        partner half of that combination, then use the ADMET panel to check
        whether your candidate has the exposure profile a doublet would
        require.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and built
        for exactly this kind of receptor-state question. If you want to
        run molecular docking against a mutant target without a local
        install, that is the fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Kryukov GV, et al. <em>MTAP deletion confers enhanced dependency on
          the PRMT5 arginine methyltransferase in cancer cells.</em> Science
          351, 1214&ndash;1218 (2016).{" "}
          <a
            href="https://doi.org/10.1126/science.aad5214"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1126/science.aad5214
          </a>
        </li>
        <li>
          Mavrakis KJ, et al. <em>Disordered methionine metabolism in
          MTAP/CDKN2A-deleted cancers leads to dependence on PRMT5.</em>{" "}
          Science 351, 1208&ndash;1213 (2016).{" "}
          <a
            href="https://doi.org/10.1126/science.aad5944"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1126/science.aad5944
          </a>
        </li>
        <li>
          Marjon K, et al. <em>MTAP Deletions in Cancer Create Vulnerability
          to Targeting of the MAT2A/PRMT5/RIOK1 Axis.</em> Cell Rep 15,
          574&ndash;587 (2016).{" "}
          <a
            href="https://doi.org/10.1016/j.celrep.2016.03.043"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/j.celrep.2016.03.043
          </a>
        </li>
        <li>
          <em>MRTX1719 Is an MTA-Cooperative PRMT5 Inhibitor That Exhibits
          Synthetic Lethality in Preclinical Models and Patients with
          MTAP-Deleted Cancer.</em> Cancer Discov 13, 2412&ndash;2431 (2023).{" "}
          <a
            href="https://aacrjournals.org/cancerdiscovery/article/13/11/2412/729848/MRTX1719-Is-an-MTA-Cooperative-PRMT5-Inhibitor"
            target="_blank"
            rel="noreferrer noopener"
          >
            aacrjournals.org
          </a>
        </li>
        <li>
          <em>AMG 193, a Clinical Stage MTA-Cooperative PRMT5 Inhibitor,
          Drives Antitumor Activity Preclinically and in Patients with
          MTAP-Deleted Cancers.</em> Cancer Discov 15, 139 (2025).{" "}
          <a
            href="https://aacrjournals.org/cancerdiscovery/article/15/1/139/750846/AMG-193-a-Clinical-Stage-MTA-Cooperative-PRMT5"
            target="_blank"
            rel="noreferrer noopener"
          >
            aacrjournals.org
          </a>
        </li>
        <li>
          <em>First-in-human study of AMG 193, an MTA-cooperative PRMT5
          inhibitor, in patients with MTAP-deleted solid tumors: results
          from phase I dose exploration.</em> Ann Oncol (2024).{" "}
          <a
            href="https://www.annalsofoncology.org/article/S0923-7534(24)03919-X/fulltext"
            target="_blank"
            rel="noreferrer noopener"
          >
            annalsofoncology.org
          </a>
        </li>
      </ul>
    </>
  );
}
