/**
 * Post: SHP2 allosteric inhibitors — the combination partner for KRAS
 *
 * SEO target: "SHP2 inhibitor", "PTPN11 inhibitor", "SHP2 KRAS G12C
 * combination", "TNO155 RMC-4630". Internal CTA into /studio around the
 * SHP2 allosteric tunnel and the KRAS G12C combination rationale.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "shp2-allosteric-inhibitors-kras-combination-landscape",
  title: "SHP2 inhibitors: the combination partner for KRAS",
  description:
    "SHP2 allosteric inhibitors flopped as monotherapy but became the backbone combination partner for KRAS G12C drugs. Here is the mechanism and the clinical map.",
  date: "2026-07-09",
  author: "Liganx team",
  tags: ["shp2", "ptpn11", "kras", "oncology", "clinical-landscape"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        SHP2 is the node almost every KRAS combination trial routes through.
        On its own it was a disappointment in the clinic. As a partner for
        KRAS G12C inhibitors, SOS1 inhibitors, and MEK inhibitors, it has
        become one of the most-tested combination backbones in oncology.
        Understanding why requires understanding where SHP2 sits in the
        signaling cascade and how the allosteric drugs shut it off.
      </p>

      <h2>What SHP2 actually does</h2>
      <p>
        SHP2 (gene name PTPN11) is a protein tyrosine phosphatase that sits
        upstream of RAS, relaying signals from receptor tyrosine kinases
        (EGFR, MET, FGFR, and others) down into the RAS-MAPK pathway. It is
        one of the few phosphatases that is a positive driver of proliferation
        rather than a brake. In its resting state the protein is
        autoinhibited: its N-terminal SH2 domain folds back over the catalytic
        PTP domain and physically blocks the active site. Phosphotyrosine
        ligands binding the SH2 domains pull that latch open and switch the
        phosphatase on.
      </p>
      <p>
        That autoinhibited closed conformation is the whole reason SHP2 became
        druggable. The active site itself is a shallow, highly charged pocket
        that medicinal chemists spent decades failing to drug selectively.
        The breakthrough came from targeting a completely different site.
      </p>

      <h2>The allosteric mechanism</h2>
      <p>
        In 2016 a Novartis team described SHP099, a small molecule that binds
        a tunnel at the interface of the N-SH2, C-SH2, and PTP domains, far
        from the catalytic site. By gluing those three domains together, it
        stabilizes the closed, autoinhibited state and prevents the
        phosphatase from ever opening. It is an allosteric molecular clamp,
        not an active-site blocker. This solved the selectivity problem in
        one move, because the tunnel is unique to SHP2 while the catalytic
        site is conserved across the phosphatase family.
      </p>
      <p>
        SHP099 was a tool compound. The clinical descendants that followed
        used the same allosteric strategy:
      </p>
      <ul>
        <li>
          <strong>TNO155 (batoprotafib)</strong> — Novartis, the most
          clinically advanced allosteric SHP2 inhibitor. The lead partner in
          the KontRASt program combining it with the KRAS G12C inhibitor
          opnurasib (JDQ433).
        </li>
        <li>
          <strong>RMC-4630</strong> — Revolution Medicines/Sanofi. Tested
          with sotorasib in CodeBreaK 101 and with an ERK inhibitor in the
          SHERPA trial. Derived from the earlier tool compound RMC-4550.
        </li>
        <li>
          <strong>JAB-3312</strong> — Jacobio, run in combination with the
          company&rsquo;s own KRAS G12C inhibitor glecirasib (JAB-21822).
        </li>
        <li>
          <strong>BBP-398 (formerly IACS-15509)</strong> — Navire/BridgeBio,
          combined with sotorasib in KRAS G12C solid tumors.
        </li>
      </ul>
      <p>
        None of these is FDA approved as of mid-2026. All of them are in
        combination-focused development, which is the important part of the
        story.
      </p>

      <h2>Why monotherapy failed and combinations did not</h2>
      <p>
        The first two allosteric SHP2 inhibitors to reach patients, RMC-4630
        and TNO155, made the same point: blocking SHP2 alone produces modest,
        transient antitumor activity. The pathway adapts. Because SHP2 sits
        upstream of RAS, tumors escape by reactivating RAS-MAPK through
        parallel inputs, and single-agent SHP2 blockade rarely drives deep
        responses.
      </p>
      <p>
        The combination logic is where it gets interesting. KRAS G12C
        inhibitors like sotorasib and adagrasib only bind the GDP-bound
        (&ldquo;off&rdquo;) state of KRAS. As the tumor is treated, upstream
        RTK signaling keeps reloading KRAS with GTP, refilling the pool of
        active protein the covalent drug cannot touch. SHP2 is a key relay in
        that reloading step. Inhibit SHP2 and you slow the reloading, keeping
        more KRAS in the GDP state where the G12C drug can trap it. The two
        drugs are mechanistically complementary: one traps the off state, the
        other blocks the machinery that refills the on state. This vertical
        pathway inhibition is the rationale behind essentially every
        SHP2/KRAS G12C combination in the clinic.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The canonical SHP2 allosteric structure is{" "}
        <a
          href="https://www.rcsb.org/structure/5EHR"
          target="_blank"
          rel="noreferrer noopener"
        >
          5EHR
        </a>{" "}
        — SHP099 bound in the central tunnel with the protein locked in the
        closed, autoinhibited conformation. That tunnel, not the catalytic
        site, is the pocket to dock against.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and place your search box over the N-SH2/C-SH2/PTP interface rather
        than the phosphatase active site — docking the wrong pocket is the
        single most common mistake on allosteric targets. If you are working
        the KRAS side of the combination, pick KRAS with G12C from the
        mutation chips and dock against the switch-II pocket instead. Liganx
        is molecular docking online, free and browser-based, and set up for
        exactly this kind of allosteric-versus-orthosteric pocket question.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Chen YN, LaMarche MJ, Chan HM, et al. <em>Allosteric inhibition of
          SHP2 phosphatase inhibits cancers driven by receptor tyrosine
          kinases.</em> Nature 535, 148&ndash;152 (2016).{" "}
          <a
            href="https://doi.org/10.1038/nature18621"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nature18621
          </a>
        </li>
        <li>
          LaMarche MJ, Acker M, Argintaru A, et al. <em>Identification of
          TNO155, an Allosteric SHP2 Inhibitor for the Treatment of Cancer.</em>{" "}
          J Med Chem 63, 13578&ndash;13594 (2020).{" "}
          <a
            href="https://doi.org/10.1021/acs.jmedchem.0c01170"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jmedchem.0c01170
          </a>
        </li>
        <li>
          Nichols RJ, Haderk F, Stahlhut C, et al. <em>RAS nucleotide cycling
          underlies the SHP2 phosphatase dependence of mutant BRAF-, NF1- and
          RAS-driven cancers.</em> Nat Cell Biol 20, 1064&ndash;1073 (2018).{" "}
          <a
            href="https://doi.org/10.1038/s41556-018-0169-1"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41556-018-0169-1
          </a>
        </li>
      </ul>
    </>
  );
}
