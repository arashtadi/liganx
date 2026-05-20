/**
 * Post: KRAS G12D — drugging the bigger cousin in pancreatic cancer
 *
 * SEO target: long-tail "KRAS G12D inhibitor", "MRTX1133", "daraxonrasib
 * RMC-6236", "RAS(ON) pancreatic cancer". Internal CTA into /studio with
 * KRAS + G12D pre-loaded so the reader can dock against the G12D switch
 * pocket and compare with WT/G12C.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "kras-g12d-pdac-drugging-the-bigger-cousin",
  title: "KRAS G12D — drugging the bigger cousin in pancreatic cancer",
  description:
    "G12D is the most common KRAS mutation and the dominant driver in PDAC. With no cysteine to hook, the field had to invent two new playbooks. Here is where they stand.",
  date: "2026-05-16",
  author: "Liganx team",
  tags: ["kras", "oncology", "pdac", "mutation"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        The G12C playbook does not transfer to G12D. The whole reason
        sotorasib and adagrasib work is the engineered cysteine at position
        12 — a covalent handle that does not exist in any other KRAS
        variant. G12D is a bigger problem in two senses: it is the most
        common KRAS mutation overall, dominating pancreatic ductal
        adenocarcinoma (PDAC), and it forces the chemistry to find a
        different way in. The field has spent the past four years building
        that alternative, and the 2026 clinical readouts are the first
        meaningful evidence it might work.
      </p>

      <h2>Why G12D is harder than G12C</h2>
      <p>
        Mutations at codon 12 are the bulk of oncogenic KRAS. G12C
        accounts for roughly 13% of KRAS-mutant tumors and is concentrated
        in NSCLC. G12D accounts for closer to 36% of KRAS-mutant tumors
        and is the dominant variant in PDAC, where it appears in around
        half of all cases. It also shows up in colorectal and endometrial
        cancers, so a working G12D drug is a much bigger therapeutic
        market than G12C was.
      </p>
      <p>
        The structural problem is the residue itself. Aspartate is
        negatively charged at physiological pH and offers no nucleophile
        to react with. Every covalent G12C inhibitor — sotorasib,
        adagrasib, divarasib, garsorasib — uses an acrylamide warhead
        that forms a Michael adduct with the Cys12 thiol. Bolt that same
        warhead onto a G12D-shaped binder and there is nothing for it to
        bond to. The two viable strategies are non-covalent binders that
        get enough affinity from shape and electrostatics alone, or
        bifunctional approaches (tri-complex inhibitors, degraders) that
        do not rely on a single hook on the target.
      </p>

      <h2>MRTX1133: the high-affinity non-covalent path</h2>
      <p>
        MRTX1133 (Mirati Therapeutics, now Bristol-Myers Squibb) was the
        first credible KRAS G12D-selective small molecule. The discovery
        paper from Wang et al. (2022) reports a biochemical IC50 below
        2 nM against KRASG12D-GDP with roughly 700-fold selectivity over
        wild-type KRAS, and an in-cell pERK IC50 of about 5 nM in
        G12D-mutant lines vs. greater than 1000-fold weaker in
        WT-KRAS-driven lines. Hallin et al. (2022) followed up with the
        in vivo case: tumor regression in 8 of 11 PDAC patient-derived
        xenograft models. The selectivity comes from a key salt bridge
        with the mutant D12 carboxylate — exactly the kind of pose you
        can rationalize from a docking run, since the wild-type protein
        has no charged residue there to engage.
      </p>
      <p>
        The MRTX1133 problem is route. The original compound is not
        orally bioavailable and the Phase 1/2 trial dosed it
        intravenously. An oral prodrug program is reportedly in
        progress (Lin et al., ACS Omega 2023), but as of mid-2026 the
        leading clinical-stage G12D drug in oral dosing is coming from
        a different chemotype entirely.
      </p>

      <h2>RAS(ON) tri-complex inhibitors: Revolution Medicines</h2>
      <p>
        Revolution Medicines built a fundamentally different mechanism.
        Instead of competing with effectors for the RAS surface, the
        RAS(ON) class glues RAS-GTP to cyclophilin A (CypA) through a
        small-molecule bridge. The resulting ternary complex sterically
        occludes the effector binding site — RAS is still GTP-loaded
        and conformationally &ldquo;on&rdquo;, but it cannot signal because RAF and
        PI3K cannot reach it. Holderfield et al. (Nature 2024)
        characterized the mechanism for the tool compound RMC-7977 and
        the clinical candidate RMC-6236.
      </p>
      <ul>
        <li>
          <strong>Daraxonrasib (RMC-6236)</strong> — a multi-selective
          RAS(ON) inhibitor that hits G12D, G12V, G12R, G13D, and
          wild-type RAS-GTP. The Phase 1 RMC-6236-001 trial reported a
          47% objective response rate in previously untreated metastatic
          PDAC with RAS-mutant disease. FDA granted breakthrough therapy
          designation for previously treated metastatic PDAC harboring
          KRAS G12X mutations. The Phase 3 RASolute 302 study is reading
          out across 2026.
        </li>
        <li>
          <strong>Zoldonrasib (RMC-9805)</strong> — a G12D-selective
          covalent RAS(ON) inhibitor. The covalent handle here is not
          a cysteine; the chemistry engages the mutant aspartate
          itself. Early Phase 1 signals in G12D PDAC were reported at
          ESMO 2025.
        </li>
      </ul>
      <p>
        The mechanistic appeal is that the tri-complex hits RAS in its
        active state, not the GDP-bound state that the G12C drugs wait
        for. That removes a kinetic ceiling — you do not need to outpace
        the nucleotide cycle to engage the target.
      </p>

      <h2>What resistance probably looks like</h2>
      <p>
        Too early for clinical resistance data on G12D the way we have
        for G12C, but two patterns are predictable from first principles.
        Switch-II pocket mutations (Y96, H95, R68) that broke sotorasib
        will likely break MRTX1133 — it binds in the same general
        location. The tri-complex compounds are vulnerable to a different
        class: cyclophilin A loss-of-function, alterations in the RAS
        surface where CypA is glued in, or upregulation of RAS isoforms
        outside the inhibitor&rsquo;s coverage. The first cell-line resistance
        screens against RMC-6236 published in 2025 (Bekele et al., not
        yet peer-reviewed) saw a different escape spectrum than the G12C
        program — closer to bypass via PI3K and RTK reactivation than
        on-target second-site mutation.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The MRTX1133 binding pose is captured in PDB{" "}
        <a
          href="https://www.rcsb.org/structure/7T47"
          target="_blank"
          rel="noreferrer noopener"
        >
          7T47
        </a>{" "}
        — switch-II pocket opened in the G12D mutant, with the inhibitor
        making the key salt bridge to D12.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick KRAS from the target catalog with G12D from the mutation
        chips. Liganx will dock against the G12D receptor and you can
        run the same ligand against G12C and wild-type in parallel — the
        ΔΔ between G12D and WT for MRTX1133 should land around 2 kcal/mol
        in Vina, which is the docking-level signature of that salt-bridge
        selectivity story. The ADMET panel will flag oral bioavailability
        concerns for high-MW analogs, which is most of the chemistry
        challenge in this series.
      </p>
      <p>
        Liganx is molecular docking online and free in the browser, set
        up for exactly this kind of mutation-vs-wildtype comparison. If
        you want to run molecular docking on KRAS G12D without a local
        install, it is the fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Wang X, et al. <em>Identification of MRTX1133, a Noncovalent,
          Potent, and Selective KRAS G12D Inhibitor.</em> J Med Chem 65,
          3123-3133 (2022).{" "}
          <a
            href="https://doi.org/10.1021/acs.jmedchem.1c01688"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jmedchem.1c01688
          </a>
        </li>
        <li>
          Hallin J, et al. <em>Anti-tumor efficacy of a potent and
          selective non-covalent KRASG12D inhibitor.</em> Nat Med 28,
          2171-2182 (2022).{" "}
          <a
            href="https://doi.org/10.1038/s41591-022-02007-7"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41591-022-02007-7
          </a>
        </li>
        <li>
          Holderfield M, et al. <em>Concurrent inhibition of oncogenic
          and wild-type RAS-GTP for cancer therapy.</em> Nature 629,
          919-926 (2024).{" "}
          <a
            href="https://doi.org/10.1038/s41586-024-07205-6"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41586-024-07205-6
          </a>
        </li>
        <li>
          Jiang J, et al. <em>Translational and Therapeutic Evaluation
          of RAS-GTP Inhibition by RMC-6236 in RAS-Driven Cancers.</em>{" "}
          Cancer Discov 14, 994-1017 (2024).{" "}
          <a
            href="https://doi.org/10.1158/2159-8290.CD-24-0027"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2159-8290.CD-24-0027
          </a>
        </li>
      </ul>
    </>
  );
}
