/**
 * Post: BCR-ABL in CML — from imatinib to the allosteric STAMP inhibitor
 *
 * SEO target: "BCR-ABL inhibitors", "CML TKI landscape", "asciminib mechanism",
 * "STAMP inhibitor myristoyl pocket", "ponatinib T315I". Internal CTA into
 * /studio with ABL1 + a resistance mutation so the reader can dock the ATP-site
 * TKIs and contrast them with the allosteric binder.
 *
 * NOTE: draft awaiting human review. Lives in _drafts/ so the registry glob
 * does not pick it up. Import path is ../../types (one level deeper).
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "bcr-abl-tki-landscape-imatinib-to-asciminib",
  title: "BCR-ABL in CML: from imatinib to the allosteric STAMP inhibitor",
  description:
    "Five ATP-site TKIs, one notorious gatekeeper mutation, and a sixth drug that binds a completely different pocket. The BCR-ABL drug landscape, structurally.",
  date: "2026-06-17",
  author: "Liganx team",
  tags: ["abl", "bcr-abl", "cml", "oncology", "clinical-landscape"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Chronic myeloid leukemia is the disease where targeted therapy
        was born. Imatinib turned a uniformly fatal leukemia into a
        condition many patients die with rather than from. But the
        twenty-five years since have been a slow structural argument
        about a single kinase pocket, one famous mutation that defeats
        almost everything aimed at that pocket, and a final drug that
        won by refusing to fight there at all. If you want a clean case
        study in how protein structure dictates drug sequencing, BCR-ABL
        is the one to study.
      </p>

      <h2>The driver: a fusion that never switches off</h2>
      <p>
        CML is defined by the Philadelphia chromosome, a t(9;22)
        translocation that fuses the <em>BCR</em> gene to <em>ABL1</em>.
        The product is a constitutively active ABL1 tyrosine kinase that
        signals continuously through STAT5, RAS-MAPK, and PI3K-AKT. The
        ABL kinase domain is the druggable half of the fusion, and every
        approved CML small molecule except one targets the same ATP
        binding site in that domain. That shared dependence is exactly
        why a single pocket mutation can knock out an entire generation
        of drugs at once.
      </p>

      <h2>The ATP-site generations</h2>
      <p>
        The first five approved BCR-ABL inhibitors all compete with ATP
        for the catalytic cleft. They differ in which kinase conformation
        they prefer and how much of the resistance-mutation space they
        cover.
      </p>
      <ul>
        <li>
          <strong>Imatinib (Gleevec)</strong> — first-in-class, FDA
          approved 2001. A type-II inhibitor that binds the inactive,
          DFG-out conformation. Spectacular frontline durability, but
          a relatively narrow grip that secondary mutations escape.
        </li>
        <li>
          <strong>Dasatinib (Sprycel)</strong> — second generation,
          approved 2006. A type-I inhibitor that binds the active
          (DFG-in) conformation and is far more potent, covering many
          imatinib-resistant mutants. It is sensitive to the F317L
          contact mutation.
        </li>
        <li>
          <strong>Nilotinib (Tasigna)</strong> — second generation,
          approved 2007. A type-II inhibitor like imatinib but a tighter
          fit, with activity against many imatinib-resistant clones. It
          is vulnerable to Y253H, E255K/V, and F359 mutations in and
          around the P-loop.
        </li>
        <li>
          <strong>Bosutinib (Bosulif)</strong> — second generation,
          approved 2012. A dual SRC/ABL inhibitor used in later lines,
          with a distinct off-target profile.
        </li>
        <li>
          <strong>Ponatinib (Iclusig)</strong> — third generation,
          approved 2012. The first ATP-site drug deliberately engineered
          with a carbon-carbon triple bond linker to reach past the bulky
          <strong> T315I</strong> gatekeeper. Powerful and pan-mutational,
          but carrying a boxed warning for arterial occlusive events that
          shapes how aggressively it can be dosed.
        </li>
      </ul>

      <h2>Why T315I is the wall</h2>
      <p>
        The recurring theme in CML resistance is the gatekeeper residue
        threonine 315. Most ATP-site TKIs make a hydrogen bond to the
        threonine hydroxyl and rely on the small threonine side chain to
        leave room in the back of the pocket. The <strong>T315I</strong>{" "}
        mutation swaps in isoleucine: it removes the hydrogen-bond donor
        and adds a bulky hydrophobic side chain that sterically blocks
        imatinib, dasatinib, nilotinib, and bosutinib simultaneously. For
        years T315I was the mutation that ended the treatment line. Until
        ponatinib, it had no targeted answer, and ponatinib's
        cardiovascular liability meant the field still wanted a cleaner
        option.
      </p>

      <h2>The allosteric escape: asciminib</h2>
      <p>
        Asciminib (Scemblix, Novartis) is the structural plot twist. It
        does not bind the ATP site at all. Instead it occupies the
        myristoyl pocket, a regulatory site near the C-terminus of the
        ABL kinase domain that normally accepts the protein's own
        myristoylated N-terminal tail to hold the kinase in an
        autoinhibited state. BCR-ABL loses that tail in the fusion, which
        is part of why it stays switched on. Asciminib is a synthetic
        surrogate for the missing myristate: it docks into the empty
        pocket and clamps the kinase back into its inactive conformation.
        Novartis and the literature call this class a STAMP inhibitor,
        for Specifically Targeting the ABL Myristoyl Pocket.
      </p>
      <p>
        Because the myristoyl pocket is physically separate from the ATP
        cleft, asciminib is largely indifferent to the ATP-site mutations
        that defeat the older drugs, including T315I. The discovery work
        by Wylie and colleagues established the dual-targeting rationale,
        and the medicinal chemistry that produced ABL001/asciminib was
        described by Schoepfer and colleagues. The drug first reached the
        clinic for heavily pretreated patients and for T315I disease.
      </p>
      <p>
        The pivotal ASC4FIRST phase 3 trial then moved asciminib to the
        front line, comparing it head to head against investigator-selected
        standard-of-care TKIs in newly diagnosed CML in chronic phase.
        Asciminib met its primary endpoint with a superior major molecular
        response rate at 48 weeks and a favorable tolerability profile,
        and that readout supported its frontline approval. A drug that was
        designed as the answer to the resistance endgame ended up
        competing for first-line use, which is an unusual arc.
      </p>

      <h2>The structural lesson for docking</h2>
      <p>
        BCR-ABL is a tidy demonstration that <em>where</em> a ligand binds
        determines which mutations matter to it. The ATP-site drugs share
        a fate because they share a pocket. Run molecular docking with
        imatinib or nilotinib against wild-type ABL and you get a sensible
        type-II pose in the DFG-out cleft. Introduce T315I and the
        isoleucine side chain collides with the back of the pocket: the
        score degrades and the favorable hydrogen-bond geometry to residue
        315 disappears. The deltadelta between wild type and T315I is the
        number that tells the resistance story, far more than the absolute
        score of either pose. An allosteric binder like asciminib lives in
        a different pocket entirely, so an ATP-site mutation barely touches
        its predicted binding mode, which is exactly the point of the
        design.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick ABL1 from the target catalog, then add the T315I
        gatekeeper mutation from the mutation chips. Dock imatinib,
        nilotinib, and ponatinib against wild type and against T315I and
        watch the first two lose the pocket while ponatinib, engineered
        to reach past the gatekeeper, holds on. Molecular docking makes
        the gatekeeper argument concrete in a way a resistance table never
        will.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and built
        around exactly this mutation-versus-drug question. If you want to
        run molecular docking across the BCR-ABL resistance mutations
        without a local install, that is the fastest way to a pose you can
        actually inspect.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Wylie AA, Schoepfer J, Jahnke W, et al.{" "}
          <em>The allosteric inhibitor ABL001 enables dual targeting of
          BCR-ABL1.</em> Nature 543, 733-737 (2017).{" "}
          <a
            href="https://doi.org/10.1038/nature21702"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nature21702
          </a>
        </li>
        <li>
          Schoepfer J, Jahnke W, Berellini G, et al.{" "}
          <em>Discovery of asciminib (ABL001), an allosteric inhibitor of
          the tyrosine kinase activity of BCR-ABL1.</em> J Med Chem 61,
          8120-8135 (2018).{" "}
          <a
            href="https://doi.org/10.1021/acs.jmedchem.8b01040"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jmedchem.8b01040
          </a>
        </li>
        <li>
          Hochhaus A, Wang J, Kim DW, et al.{" "}
          <em>Asciminib in newly diagnosed chronic myeloid leukemia.</em>{" "}
          N Engl J Med 391, 885-896 (2024).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2400858"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2400858
          </a>
        </li>
        <li>
          Réa D, Mauro MJ, Boquimpani C, et al.{" "}
          <em>A phase 3, open-label, randomized study of asciminib versus
          bosutinib in heavily pretreated patients with chronic myeloid
          leukemia (ASCEMBL).</em> Blood 138, 2031-2041 (2021).{" "}
          <a
            href="https://doi.org/10.1182/blood.2020009984"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1182/blood.2020009984
          </a>
        </li>
      </ul>
    </>
  );
}
