/**
 * Post: KRAS G13D in colorectal cancer — the codon-13 mutation that spent
 * a decade as the exception to "all KRAS mutations block anti-EGFR."
 *
 * SEO target: "KRAS G13D", "KRAS G13D cetuximab", "KRAS codon 13 mutation
 * colorectal", "G13D vs G12 KRAS". Internal CTA into /studio with KRAS +
 * G13D so a reader can compare the switch-II region against G12 variants.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "kras-g13d-colorectal-cetuximab-controversy",
  title: "KRAS G13D: the codon-13 exception that wasn't",
  description:
    "Why a retrospective signal suggested KRAS G13D colorectal tumors respond to cetuximab, why the prospective ICECREAM trial deflated it, and what the biology actually says.",
  date: "2026-07-12",
  author: "Liganx team",
  tags: ["kras", "g13d", "colorectal", "mutation", "cetuximab"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        For most of the RAS story in colorectal cancer, the rule is brutally
        simple: any activating KRAS mutation predicts resistance to anti-EGFR
        antibodies, so those patients do not get cetuximab or panitumumab. KRAS
        G13D is the mutation that made oncologists question the rule for a
        decade. A single glycine-to-aspartate change one codon over from the
        classic G12 hotspot behaved differently in the clinic, and untangling
        why it did (and whether it really does) is a small masterclass in how
        allele-specific biology meets messy clinical data.
      </p>

      <h2>Where G13D sits</h2>
      <p>
        KRAS is a small GTPase that cycles between an active GTP-bound state and
        an inactive GDP-bound state. GTPase-activating proteins (GAPs, chiefly
        neurofibromin/NF1 and p120-RasGAP) accelerate hydrolysis to switch the
        protein off. The codon 12 and codon 13 glycines sit in the phosphate-
        binding loop right at the catalytic interface. Mutating either one
        introduces a side chain that sterically blocks the GAP arginine finger,
        so the protein stays GTP-loaded and signaling stays on.
      </p>
      <p>
        G12 mutations (G12D, G12V, G12C and the rest) are the most common across
        KRAS-driven cancers. Codon 13 mutations are a minority, and G13D is by
        far the most frequent of them. In the pooled 579-patient dataset that
        first flagged the anomaly, KRAS was mutated in about 40 percent of
        tumors, and roughly 14.5 percent of those mutants were G13D. So this is
        not a rare curiosity; it is a meaningful slice of the KRAS-mutant
        colorectal population.
      </p>

      <h2>The retrospective signal</h2>
      <p>
        In 2010, De Roock and colleagues mined outcomes from patients with
        chemotherapy-refractory metastatic colorectal cancer treated with
        cetuximab and reported something heretical: patients whose tumors
        carried G13D had longer overall and progression-free survival than
        patients with other KRAS mutations, and their outcomes looked closer to
        KRAS wild-type than to G12-mutant disease. The implication was that
        G13D tumors retained some sensitivity to EGFR blockade that G12 tumors
        lacked, and that excluding them from anti-EGFR therapy might be a
        mistake.
      </p>
      <p>
        A mechanistic rationale followed. Biochemically, G13D is a weaker
        transforming allele than G12 variants in several assays, and modeling
        work argued that G13D-mutant KRAS remains partially responsive to
        neurofibromin, so its output still depends on upstream tone in a way
        that pure G12 signaling does not. If some of the pathway drive still
        runs through wild-type RAS and EGFR, then cutting EGFR could plausibly
        do something. It was a tidy hypothesis with a real biochemical spine.
      </p>

      <h2>Why the prospective test deflated it</h2>
      <p>
        Retrospective subgroup signals in oncology have a long history of not
        surviving contact with a randomized trial, and G13D is a case in point.
        The ICECREAM study prospectively tested single-agent cetuximab against
        cetuximab plus irinotecan specifically in refractory G13D-mutant
        metastatic colorectal cancer. Single-agent cetuximab produced
        essentially no meaningful monotherapy activity; the combination arm
        showed some response, but that is confounded by the chemotherapy and
        does not establish that EGFR blockade is driving benefit in G13D tumors.
      </p>
      <p>
        The verdict that stuck: G13D should not be treated as an anti-EGFR-
        sensitive allele. Guidelines never adopted a G13D carve-out. The
        biomarker that governs cetuximab and panitumumab eligibility in
        colorectal cancer is expanded RAS wild-type status, meaning no activating
        mutation across KRAS and NRAS exons 2, 3, and 4. Any KRAS mutation,
        including G13D, keeps a patient off anti-EGFR therapy outside a trial.
      </p>

      <h2>What is actually druggable here</h2>
      <p>
        The frustration with G13D is that, unlike its neighbor, it has no direct
        inhibitor. The mutant-selective revolution has been built on covalent
        chemistry aimed at G12C, whose cysteine gives a warhead something to
        latch onto, and on the newer noncovalent G12D agents. G13D offers
        neither an obvious covalent handle nor, so far, a dedicated selective
        binder. The realistic near-term paths are the pan-RAS(ON) inhibitors and
        SOS1 or SHP2 modulators that throttle the whole pathway rather than one
        allele, which is where much of the current colorectal RAS pipeline is
        pointed.
      </p>
      <ul>
        <li>
          <strong>Cetuximab / panitumumab</strong> — anti-EGFR antibodies,
          reserved for expanded RAS wild-type tumors. G13D is excluded despite
          the historical debate.
        </li>
        <li>
          <strong>Sotorasib, adagrasib</strong> — G12C-selective covalent
          inhibitors. Not applicable to G13D; there is no cysteine to engage.
        </li>
        <li>
          <strong>Pan-RAS and upstream agents</strong> — pan-RAS(ON) inhibitors
          and SOS1/SHP2 approaches aim to cover alleles like G13D that lack a
          bespoke drug, and are the more plausible route for codon-13 disease.
        </li>
      </ul>

      <h2>The takeaway</h2>
      <p>
        G13D is a reminder that "KRAS mutant" is not one thing. Two glycines a
        single codon apart produce measurably different biochemistry, and that
        difference was real enough to generate a decade-long clinical debate.
        But it is also a reminder that a plausible mechanism plus a retrospective
        survival curve is not the same as a prospective result. The biology of
        G13D is genuinely distinct; the therapeutic conclusion drawn from it was
        not durable.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        Seeing the codon-12 versus codon-13 difference at the structure level is
        more convincing than reading about it.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick KRAS from the target catalog, then add the G13D mutation from
        the mutation chips and compare it against G12D or G12V at the P-loop and
        switch-II region. Molecular docking lets you inspect how the different
        side chains sit against the nucleotide and the GAP interface, and why the
        covalent G12C strategy has no equivalent handle at position 13.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and built
        around exactly this kind of mutation-versus-drug question. If you want to
        run molecular docking on KRAS G13D without a local install, that is the
        fastest way to a pose you can actually look at.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          De Roock W, Jonker DJ, Di Nicolantonio F, et al. <em>Association of
          KRAS p.G13D mutation with outcome in patients with chemotherapy-
          refractory metastatic colorectal cancer treated with cetuximab.</em>{" "}
          JAMA 304(16), 1812-1820 (2010).{" "}
          <a
            href="https://doi.org/10.1001/jama.2010.1535"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1001/jama.2010.1535
          </a>
        </li>
        <li>
          Segelov E, Thavaneswaran S, Waring PM, et al. <em>Response to
          cetuximab with or without irinotecan in patients with refractory
          metastatic colorectal cancer harboring the KRAS G13D mutation:
          Australasian Gastro-Intestinal Trials Group ICECREAM study.</em> J Clin
          Oncol 34(19), 2258-2264 (2016).{" "}
          <a
            href="https://doi.org/10.1200/JCO.2015.65.6843"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1200/JCO.2015.65.6843
          </a>
        </li>
        <li>
          McFall T, Diedrich JK, Mengistu M, et al. <em>A systems mechanism for
          KRAS mutant allele-specific responses to targeted therapy.</em> Sci
          Signal 12(600), eaaw8288 (2019).{" "}
          <a
            href="https://doi.org/10.1126/scisignal.aaw8288"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1126/scisignal.aaw8288
          </a>
        </li>
      </ul>
    </>
  );
}
