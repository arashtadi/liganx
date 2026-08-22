/**
 * Post: PARP1-selective inhibitors and the trapping hypothesis
 *
 * SEO target: "PARP1 selective inhibitor", "saruparib AZD5305", "PARP
 * trapping", "PARP inhibitor resistance BRCA reversion". Internal CTA
 * into /studio framed around docking the PARP1 catalytic domain and
 * contrasting it with PARP2.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "parp1-selective-inhibitors-trapping-saruparib",
  title: "PARP1-selective inhibitors: why trapping beats potency",
  description:
    "The first-generation PARP inhibitors all hit PARP2 as well. Here is why that costs you the combination, and how PARP1-selective chemistry fixes it.",
  date: "2026-07-29",
  author: "Liganx team",
  tags: ["parp", "dna-repair", "oncology", "clinical-landscape"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Four PARP inhibitors reached the market between 2014 and 2018, and
        every one of them inhibits PARP1 and PARP2 at roughly the same
        concentration. That was never a design goal — it was a consequence
        of building compounds around a nicotinamide mimetic that binds a
        catalytic site the two enzymes share. The bill for that promiscuity
        came due in combination trials, where overlapping myelosuppression
        made it impossible to dose a PARP inhibitor alongside chemotherapy.
        The next generation is trying to unpick the two.
      </p>

      <h2>What PARP1 does, and what the drug actually kills with</h2>
      <p>
        PARP1 is a damage sensor. It binds single-strand breaks through its
        zinc-finger domains, undergoes an allosteric change that switches on
        the catalytic (ART) domain, and then builds chains of poly(ADP-ribose)
        on itself and on nearby chromatin. Those chains are a recruitment
        signal for the base excision repair machinery, and they are also what
        ejects PARP1 from the DNA once the job is done — the negatively
        charged polymer repels the negatively charged backbone.
      </p>
      <p>
        This is the part that matters for drug design. A PARP inhibitor
        blocks the catalytic site, so PARP1 never builds the chain that would
        eject it. The enzyme stays clamped onto the break. That trapped
        PARP1-DNA complex is the cytotoxic lesion: it stalls replication
        forks and generates double-strand breaks, which a
        homologous-recombination-deficient cell (BRCA1, BRCA2, PALB2,
        RAD51C/D mutant) cannot repair accurately. Synthetic lethality
        follows.
      </p>
      <p>
        The practical consequence is that catalytic potency and trapping
        potency are different properties and do not track each other.
        Veliparib is a good catalytic inhibitor and a poor trapper, which is
        the usual explanation for its weak single-agent activity. Talazoparib
        is roughly the same catalytic potency as olaparib but traps far
        harder. CRISPR mutagenesis screens made the point directly: PARP1
        point mutations both inside and outside the DNA-binding zinc fingers
        confer PARP inhibitor resistance by altering trapping, without
        touching the catalytic site the drug occupies.
      </p>

      <h2>Why PARP2 is the problem</h2>
      <p>
        PARP2 covers overlapping but not identical ground, and it appears to
        matter disproportionately in the bone marrow. Hematopoietic
        progenitors are sensitive to combined PARP1/2 inhibition, which shows
        up in the clinic as anemia, neutropenia and thrombocytopenia. That
        toxicity is why PARP inhibitors are dosed as monotherapy or with
        carefully staggered partners rather than layered onto cytotoxic
        chemotherapy, and it is why several combination programmes were
        abandoned.
      </p>
      <p>
        The AstraZeneca hypothesis was that if trapping PARP1 is what drives
        efficacy, and inhibiting PARP2 is what drives a meaningful share of
        the hematologic toxicity, then a PARP1-selective trapper should have
        a wider therapeutic window. Saruparib (AZD5305) is the compound that
        tested it: a naphthyridinone core with a piperazine-linked
        picolinamide, reported at IC50 values around 3 nM for PARP1 versus
        roughly 1400 nM for PARP2, about 500-fold selectivity, with reduced
        effects on human bone marrow progenitor cells in vitro relative to
        first-generation inhibitors.
      </p>
      <ul>
        <li>
          <strong>Olaparib</strong> — approved 2014. Dual PARP1/2. Broad label
          across ovarian, breast, pancreatic and prostate cancer in HRR-mutant
          settings.
        </li>
        <li>
          <strong>Niraparib, rucaparib, talazoparib</strong> — approved
          2016-2018. Also dual. Talazoparib is the strongest trapper of the
          group and correspondingly the most myelosuppressive per milligram.
        </li>
        <li>
          <strong>Saruparib (AZD5305)</strong> — PARP1-selective inhibitor and
          trapper, not yet approved. In the phase 1/2a PETRA study of patients
          with BRCA1/2, PALB2 or RAD51C/D mutations, the 60 mg once-daily dose
          produced an objective response rate reported at 48.4%, with low
          rates of dose reduction and discontinuation.
        </li>
      </ul>

      <h2>Where it is being tested</h2>
      <p>
        The most consequential readout ahead is EvoPAR-Prostate01, a phase III
        double-blind trial randomising roughly 1800 men with metastatic
        hormone-sensitive prostate cancer 1:1 to saruparib plus a
        physician&rsquo;s-choice androgen receptor pathway inhibitor
        (abiraterone with prednisone, darolutamide, or enzalutamide) versus
        placebo plus ARPI. It runs as two separate cohorts — about 550 with
        homologous recombination repair mutations and about 1250 without —
        each analysed on its own, with radiographic progression-free survival
        as the primary endpoint and overall survival as a key secondary.
        Enrolment opened in November 2023.
      </p>
      <p>
        The non-HRR-mutant cohort is the interesting one. Existing PARP
        inhibitor plus ARPI approvals in prostate cancer lean on HRR
        selection; whether a better-tolerated PARP1-selective agent can show
        benefit in an unselected population is a question about therapeutic
        window as much as about biology.
      </p>

      <h2>Resistance: reversions, and now PARP1 itself</h2>
      <p>
        Resistance to first-generation PARP inhibitors is dominated by
        restoration of homologous recombination — most often a secondary
        &ldquo;reversion&rdquo; mutation in BRCA1 or BRCA2 that shifts the
        reading frame back and produces a functional, if truncated, protein.
        Hypomorphic BRCA1 alleles and loss of 53BP1 or REV7 do similar work by
        other routes. Reversions are detectable in circulating tumour DNA and
        are the main reason re-challenge after progression tends to fail.
      </p>
      <p>
        A patient-derived xenograft study across thirteen BRCA1, BRCA2 and
        PALB2 mutant breast, ovarian and pancreatic models put numbers on
        this. Saruparib outperformed olaparib on preclinical complete response
        rate (75% versus 37%) and median preclinical progression-free survival
        (over 386 days versus 90 days), and induced more replication stress.
        But every one of the 39 tumours that eventually progressed on either
        drug had regained homologous recombination function as measured by
        RAD51 foci, most often through BRCA reversion or accumulation of
        hypomorphic BRCA1. Saruparib also failed to rescue models that had
        already acquired olaparib resistance — on this evidence the selective
        agent delays resistance rather than circumventing it, which argues for
        using it first rather than in sequence.
      </p>
      <p>
        A PARP1-selective drug changes the selection pressure. If the only
        target that matters is PARP1, mutations in PARP1 that reduce trapping
        become a more attractive escape route for the tumour, and preclinical
        work has begun reporting catalytic-domain PARP1 mutations as drivers
        of saruparib resistance rather than the HR restoration seen with less
        selective agents. That work is preprint-stage and should be read as a
        hypothesis rather than a clinical finding, but it is a useful reminder
        that selectivity narrows the target and therefore narrows the escape
        hatch the tumour has to find.
      </p>

      <h2>What this means if you are modelling PARP</h2>
      <p>
        Two things are worth internalising before you set up a virtual screen
        against this target family.
      </p>
      <p>
        First, the PARP1 and PARP2 catalytic domains are close homologues, and
        the nicotinamide subpocket is nearly identical between them.
        Selectivity in this series comes from contacts outside that subpocket
        and from conformational differences in the surrounding helical
        subdomain, not from the anchoring hydrogen bonds every PARP chemotype
        makes to the conserved glycine and serine. If your scoring function is
        dominated by that anchor, both proteins will score the same. Docking
        the same ligand into both structures and looking at the
        <em> difference</em> is far more informative than either absolute
        number.
      </p>
      <p>
        Second, trapping is not something molecular docking predicts. Docking
        evaluates ligand binding to a protein pocket; trapping is a property
        of the ternary PARP1-DNA-inhibitor complex and depends on allosteric
        communication between the catalytic domain and the DNA-binding zinc
        fingers. A compound can score beautifully in the catalytic site and
        trap poorly. Treat a docking score here as a filter for catalytic
        engagement and nothing more, then confirm trapping with a chromatin
        retention assay.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link
          to="/studio"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          Open Studio
        </Link>{" "}
        and dock a nicotinamide-mimetic scaffold into the PARP1 catalytic
        domain, then repeat the run against PARP2 and compare the poses. It is
        a clean worked example of why selectivity questions need paired runs:
        molecular docking online gives you a per-target score in seconds, but
        the number that carries information is the delta between the two
        homologues, not either score on its own.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Johannes JW, Balazs A, Barratt D, et al.{" "}
          <em>
            Discovery of AZD5305: a PARP1-DNA trapper with high selectivity for
            PARP1 over PARP2 and other PARPs.
          </em>{" "}
          J Med Chem 64, 14498-14512 (2021).{" "}
          <a
            href="https://doi.org/10.1021/acs.jmedchem.1c01012"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.jmedchem.1c01012
          </a>
        </li>
        <li>
          Illuzzi G, Staniszewska AD, Gill SJ, et al.{" "}
          <em>
            Preclinical characterization of AZD5305, a next-generation, highly
            selective PARP1 inhibitor and trapper.
          </em>{" "}
          Clin Cancer Res 28, 4724-4736 (2022).{" "}
          <a
            href="https://doi.org/10.1158/1078-0432.CCR-22-0301"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/1078-0432.CCR-22-0301
          </a>
        </li>
        <li>
          Pettitt SJ, Krastev DB, Brandsma I, et al.{" "}
          <em>
            Genome-wide and high-density CRISPR-Cas9 screens identify point
            mutations in PARP1 causing PARP inhibitor resistance.
          </em>{" "}
          Nat Commun 9, 1849 (2018).{" "}
          <a
            href="https://doi.org/10.1038/s41467-018-03917-2"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/s41467-018-03917-2
          </a>
        </li>
        <li>
          Azad AA, Agarwal N, Armstrong AJ, et al.{" "}
          <em>
            Saruparib in combination with androgen receptor pathway inhibitors
            in metastatic hormone-sensitive prostate cancer: EvoPAR-Prostate01.
          </em>{" "}
          Future Oncol 22, 1153-1163 (2026).{" "}
          <a
            href="https://doi.org/10.1080/14796694.2026.2655433"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1080/14796694.2026.2655433
          </a>
        </li>
        <li>
          Herencia-Ropero A, Llop-Guevara A, Staniszewska AD, et al.{" "}
          <em>
            The PARP1 selective inhibitor saruparib (AZD5305) elicits potent and
            durable antitumor activity in patient-derived BRCA1/2-associated
            cancer models.
          </em>{" "}
          Genome Med 16 (2024).{" "}
          <a
            href="https://doi.org/10.1186/s13073-024-01370-z"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1186/s13073-024-01370-z
          </a>
        </li>
      </ul>
    </>
  );
}
