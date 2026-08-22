/**
 * Post: gastric pH and oral TKI absorption
 *
 * SEO target: "PPI tyrosine kinase inhibitor interaction", "gastric pH
 * drug absorption oncology", "erlotinib omeprazole interaction",
 * "pH-dependent solubility". ADMET-theme post. The honest angle: a
 * docking score says nothing about whether the drug is ever dissolved
 * in the first place. CTA into /studio via the ADMET panel.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "gastric-ph-acid-reducing-agents-oral-tki-absorption",
  title: "Gastric pH: the interaction that halves your TKI exposure",
  description:
    "Most oral kinase inhibitors are weak bases that only dissolve in acid. A proton pump inhibitor can cut exposure by half, and no binding-affinity model will warn you.",
  date: "2026-08-04",
  author: "Liganx team",
  tags: ["admet", "pharmacokinetics", "solubility", "drug-interactions"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        A large share of the oncology patients taking an oral kinase
        inhibitor are also taking something for reflux or gastritis. That
        combination is not neutral. Most oral kinase inhibitors are weak
        bases with steeply pH-dependent solubility: they dissolve readily in
        stomach acid and precipitate out when the stomach is neutralized.
        Raise gastric pH with a proton pump inhibitor and you can lose forty
        to sixty percent of a drug&rsquo;s systemic exposure without changing a
        single thing about the molecule or the target.
      </p>

      <h2>Why weak bases care about stomach acid</h2>
      <p>
        Kinase inhibitors are typically flat, aromatic, lipophilic scaffolds
        carrying a basic nitrogen somewhere on a solubilizing side chain,
        often a piperazine, a morpholine or a dimethylamino group. In a
        normal fasted stomach at pH 1 to 2, that nitrogen is protonated, the
        molecule carries a positive charge, and it goes into solution. Move
        the pH above the compound&rsquo;s pKa and the nitrogen deprotonates. The
        neutral free base is far less soluble, and if it has not dissolved
        by the time it reaches the small intestine, it will not be absorbed
        there either, because intestinal pH is higher still.
      </p>
      <p>
        This is a dissolution problem, not a permeability or metabolism
        problem. The compound never gets the chance to be a good drug. Acid
        suppression is common and long-running in oncology populations, which
        makes it one of the more consequential pharmacokinetic interactions
        in the field and one of the easiest to overlook.
      </p>

      <h2>The magnitude, drug by drug</h2>
      <ul>
        <li>
          <strong>Erlotinib</strong> is the textbook case. With omeprazole
          40 mg daily, the geometric mean ratio for erlotinib AUC to infinity
          was 0.54 (90% CI 0.49-0.59) and for Cmax 0.39 (0.32-0.48). Roughly
          half the exposure disappears. The label advises against concomitant
          proton pump inhibitors.
        </li>
        <li>
          <strong>Erlotinib with an H2 blocker</strong> shows why timing is
          not a detail. Concomitant ranitidine reduced AUC by 33% and Cmax by
          54%; staggering the doses so that erlotinib was given 10 hours
          after the evening H2 blocker dose and at least 2 hours before the
          next one cut the losses to 15% and 17%.
        </li>
        <li>
          <strong>Pazopanib</strong> lost 40% of AUC and 42% of Cmax when
          co-administered with esomeprazole 40 mg in patients with solid
          tumors. The same study found ketoconazole raised pazopanib AUC by
          66% through CYP3A4, so pazopanib is exposed at both ends.
        </li>
        <li>
          <strong>Dasatinib</strong> has an especially narrow solubility
          window. In Japanese leukemia patients, the dose-adjusted AUC over
          the first four hours was a median 1.47 ng&middot;h/mL/mg on an acid
          suppressant versus 3.51 without (P = 0.0008), a difference of more
          than half.
        </li>
        <li>
          <strong>Quizartinib</strong> is the counterexample that proves the
          effect is formulation-dependent. Lansoprazole 60 mg gave a
          quizartinib Cmax geometric mean ratio of 86.1% and an AUC ratio of
          94.0%, close enough to no effect that the drug can be given with
          acid-reducing agents.
        </li>
      </ul>
      <p>
        Osimertinib also appears comparatively insensitive. A rat study
        titrating gastric pH with omeprazole and vonoprazan saw gefitinib
        and erlotinib exposure fall to 47% and 59% of control at elevated
        pH while osimertinib was essentially unchanged. Rodent data does not
        transfer cleanly to humans, but the direction of the finding matches
        the clinical labels.
      </p>

      <h2>What medicinal chemists can do about it</h2>
      <p>
        The liability is designed in, and it can be designed out. The usual
        levers are raising intrinsic solubility of the free base so that the
        molecule does not depend on ionization, tuning the pKa of the basic
        center so that the compound remains substantially ionized across the
        physiological range, choosing a salt or an amorphous solid dispersion
        that dissolves independently of gastric pH, or accepting the
        limitation and writing an explicit staggered-dosing scheme into the
        label. Formulation work is genuinely effective here: the quizartinib
        tablet result is a formulation win, not a chemistry win.
      </p>

      <h2>Where computational work sits</h2>
      <p>
        This is a useful reminder of what structure-based methods do and do
        not cover. Molecular docking predicts how tightly a ligand binds to a
        target once the two are in the same compartment. It says nothing
        about whether the compound ever dissolved, survived the gut, or
        reached plasma. A compound can post an excellent docking score and
        still be undosable in half the intended patient population because a
        common comedication neutralizes its stomach.
      </p>
      <p>
        The practical workflow is to treat affinity and developability as two
        separate filters run in parallel. Aqueous solubility and predicted
        pKa belong in the same triage table as the binding score, not in a
        later stage. Liganx runs molecular docking online in the browser and
        returns an ADMET panel alongside every pose, so solubility and
        related physicochemical flags surface at the same moment as the
        score rather than months later.
      </p>

      <h2>Try the prediction yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock a candidate against a target such as EGFR or ABL. When the
        run finishes, open the ADMET pill on the result row and read the
        solubility and lipophilicity values next to the binding score. If a
        compound is both poorly soluble and strongly basic, treat gastric pH
        as an open question rather than a detail for the formulation group to
        solve later.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Kletzl H, Giraudon M, Ducray PS, Abt M, Hamilton M, Lum BL.{" "}
          <em>Effect of gastric pH on erlotinib pharmacokinetics in healthy
          individuals: omeprazole and ranitidine.</em> Anticancer Drugs 26,
          565-572 (2015).{" "}
          <a
            href="https://doi.org/10.1097/CAD.0000000000000212"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1097/CAD.0000000000000212
          </a>
        </li>
        <li>
          Tan AR, Gibbon DG, Stein MN, et al. <em>Effects of ketoconazole and
          esomeprazole on the pharmacokinetics of pazopanib in patients with
          solid tumors.</em> Cancer Chemother Pharmacol 71, 1635-1643 (2013).{" "}
          <a
            href="https://doi.org/10.1007/s00280-013-2164-3"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1007/s00280-013-2164-3
          </a>
        </li>
        <li>
          Takahashi N, Miura M, Niioka T, Sawada K. <em>Influence of
          H2-receptor antagonists and proton pump inhibitors on dasatinib
          pharmacokinetics in Japanese leukemia patients.</em> Cancer
          Chemother Pharmacol 69, 999-1004 (2012).{" "}
          <a
            href="https://doi.org/10.1007/s00280-011-1797-3"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1007/s00280-011-1797-3
          </a>
        </li>
        <li>
          Li J, Trone D, Mendell J, O&rsquo;Donnell P, Cook N. <em>A drug-drug
          interaction study to assess the potential effect of acid-reducing
          agent, lansoprazole, on quizartinib pharmacokinetics.</em> Cancer
          Chemother Pharmacol 84, 799-807 (2019).{" "}
          <a
            href="https://doi.org/10.1007/s00280-019-03915-1"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1007/s00280-019-03915-1
          </a>
        </li>
        <li>
          Yasumuro O, Uchida S, Kashiwagura Y, et al. <em>Changes in
          gefitinib, erlotinib and osimertinib pharmacokinetics under various
          gastric pH levels following oral administration of omeprazole and
          vonoprazan in rats.</em> Xenobiotica 48, 1106-1112 (2018).{" "}
          <a
            href="https://doi.org/10.1080/00498254.2017.1396379"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1080/00498254.2017.1396379
          </a>
        </li>
      </ul>
    </>
  );
}
