/**
 * Post: Giredestrant's lidERA win — the first oral SERD into the adjuvant setting
 *
 * News/clinical theme. Triggered by the 2-Jun-2026 FDA acceptance + priority
 * review of Roche's giredestrant NDA in early ER+/HER2- breast cancer, off the
 * back of the phase 3 lidERA iDFS readout. Frames the oral SERD class (ESR1)
 * and contrasts with the persevERA metastatic miss. Internal CTA into /studio
 * with ESR1 + Y537S so the reader can dock against the activating LBD mutant.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "giredestrant-lidera-oral-serd-adjuvant-breast-cancer",
  title: "Giredestrant's lidERA win: oral SERDs reach the adjuvant setting",
  description:
    "The phase 3 lidERA trial made giredestrant the first oral SERD to improve invasive disease-free survival as adjuvant therapy. What it means for ER+ disease.",
  date: "2026-06-06",
  author: "Liganx team",
  tags: ["esr1", "oncology", "breast-cancer", "serd"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        On June 2, 2026 the FDA accepted and granted priority review to
        Roche's new drug application for giredestrant in early-stage ER+,
        HER2-negative breast cancer. It is the first oral selective
        estrogen receptor degrader (SERD) to post a positive phase 3
        readout in the curative setting, and it lands after a high-profile
        metastatic flop for the same molecule. The split result is a good
        lesson in why where you test an endocrine agent matters as much as
        what the agent does.
      </p>

      <h2>What a SERD actually does</h2>
      <p>
        Estrogen receptor alpha (ERα, gene ESR1) is the dependency that
        defines roughly 70% of breast cancers. The decades-old standard is
        to starve the receptor of ligand with an aromatase inhibitor, or
        to block it with the SERM tamoxifen. SERDs go further: they bind
        the ligand-binding domain, destabilize the receptor, and route it
        for proteasomal degradation, so the cell loses the protein
        entirely rather than just having it occupied. Fulvestrant proved
        the mechanism works but it is an intramuscular injection with poor
        exposure. The whole oral SERD race has been about getting that
        degradation pharmacology into a once-daily pill.
      </p>
      <p>
        The clinical urgency is a single recurring mutation. ESR1
        mutations in the ligand-binding domain, dominated by Y537S and
        D538G, are acquired under aromatase-inhibitor pressure and lock
        the receptor into a constitutively active conformation that no
        longer needs estrogen. They are found in up to 40% of endocrine-
        pretreated metastatic tumors, and they are the reason elacestrant
        (the first approved oral SERD) carries an ESR1-mutation-restricted
        label. A SERD that degrades the mutant is the point of the class.
      </p>

      <h2>lidERA: the adjuvant win</h2>
      <p>
        lidERA Breast Cancer (NCT04961996) randomized 4,170 patients with
        resected, medium- or high-risk stage I to III ER+, HER2-negative
        disease to 30 mg giredestrant daily or physician's choice of
        standard endocrine therapy for at least five years. Adjuvant
        giredestrant cut the risk of invasive recurrence or death by 30%
        (HR 0.70; 95% CI, 0.57 to 0.87; P = .0014). The benefit held
        across menopausal status, with a hazard ratio of 0.65 in the 1,687
        premenopausal patients and 0.74 in the 2,456 postmenopausal
        patients. The PDUFA target action date is November 30, 2026.
      </p>
      <ul>
        <li>
          <strong>Giredestrant</strong> (Roche) — oral SERD; first in the
          class to improve invasive disease-free survival as adjuvant
          therapy in early ER+ disease. NDA under FDA priority review as
          of June 2026.
        </li>
        <li>
          <strong>Elacestrant</strong> (Orserdu, Stemline/Menarini) — the
          first FDA-approved oral SERD (2023), restricted to ESR1-mutant
          metastatic disease after progression on endocrine therapy.
        </li>
        <li>
          <strong>Camizestrant and imlunestrant</strong> — later oral
          SERDs reading out in the metastatic and early settings; the
          class is converging on ESR1-mutant selectivity plus combinability
          with CDK4/6 inhibitors.
        </li>
      </ul>

      <h2>The persevERA caution</h2>
      <p>
        The same drug missed its primary endpoint in persevERA, the phase
        3 first-line metastatic study pairing giredestrant with palbociclib
        against the standard aromatase-inhibitor combination. Progression-
        free survival did not reach statistical significance. The contrast
        with lidERA is instructive: in the adjuvant setting you are
        suppressing micrometastatic, largely treatment-naive disease where
        clean ER degradation has room to help, while in heavily co-treated
        first-line metastatic disease the bar set by an established CDK4/6
        combination is high and the tumors are more heterogeneous. The
        molecule did not change between trials. The disease context did.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The interesting structural biology for this class is the Y537S
        mutant, where the substituted serine hydrogen-bonds to D351 and
        stabilizes the agonist conformation of helix 12 even with no
        ligand bound. That is what an oral SERD has to overcome.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick ESR1 from the target catalog with the Y537S mutation chip,
        then dock a SERD scaffold against both the wild-type and mutant
        ligand-binding domain. The molecular docking pose for a basic-side-
        chain SERD should show the amine reaching toward the helix-12 path
        that drives degradation, and the ΔΔ between mutant and wild-type is
        the structure-level readout of why ESR1-mutant selectivity is hard.
      </p>
      <p>
        Liganx is molecular docking online and free in the browser, set up
        for exactly this kind of mutant-versus-wildtype comparison. If you
        want to run molecular docking on ESR1 Y537S without a local install,
        it is the fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Roche. <em>FDA accepts New Drug Application for Roche's
          giredestrant in ER-positive early-stage breast cancer.</em> Media
          release, 2 June 2026.{" "}
          <a
            href="https://www.roche.com/media/releases/med-cor-2026-06-02"
            target="_blank"
            rel="noreferrer noopener"
          >
            roche.com/media/releases/med-cor-2026-06-02
          </a>
        </li>
        <li>
          Jhaveri K, et al. <em>lidERA Breast Cancer: phase III adjuvant
          study of giredestrant vs physician's choice of endocrine therapy
          in ER+, HER2- early breast cancer.</em> ASCO Annual Meeting 2026
          (abstr).{" "}
          <a
            href="https://www.asco.org/abstracts-presentations/225743"
            target="_blank"
            rel="noreferrer noopener"
          >
            asco.org/abstracts-presentations/225743
          </a>
        </li>
        <li>
          Bidard FC, et al. <em>Elacestrant for ER-positive, HER2-negative
          advanced breast cancer with ESR1 mutations (EMERALD).</em> J Clin
          Oncol 40, 3246-3256 (2022).{" "}
          <a
            href="https://doi.org/10.1200/JCO.22.00338"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1200/JCO.22.00338
          </a>
        </li>
      </ul>
    </>
  );
}
