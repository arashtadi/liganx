/**
 * Post: PIK3CA H1047R and inavolisib — the mutant-selective PI3K alpha degrader
 *
 * SEO target: long-tail queries around "PIK3CA H1047R", "inavolisib mechanism",
 * "PI3K alpha inhibitor breast cancer", "Itovebi INAVO120". Internal link
 * into /studio with PI3K alpha and H1047R pre-loaded so the reader can
 * dock alpelisib and inavolisib analogs against the same pocket.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "pik3ca-h1047r-inavolisib-pi3k-alpha-degrader",
  title: "PIK3CA H1047R and inavolisib — the mutant-selective degrader story",
  description:
    "Why PIK3CA H1047R activates PI3K alpha, how inavolisib goes beyond inhibition by degrading the mutant protein, and what the INAVO120 results mean for HR+/HER2- breast cancer.",
  date: "2026-05-19",
  author: "Liganx team",
  tags: ["pik3ca", "pi3k-alpha", "breast-cancer", "resistance", "clinical-landscape"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        PIK3CA is the most frequently mutated oncogene in hormone
        receptor&ndash;positive breast cancer, and for fifteen years
        the field tried to drug it with isoform-selective inhibitors
        that worked just well enough to be approved and just poorly
        enough to be disappointing. Inavolisib changes the shape of
        that story. It is the first PI3K alpha&ndash;targeting agent
        designed not just to block the mutant enzyme but to degrade
        it. The FDA approval in October 2024 and the INAVO120 phase
        3 readout give the cleanest validation yet that you can
        selectively kill a mutant protein in the clinic without
        wrecking the wild-type isoform.
      </p>

      <h2>Two hotspots, two different mechanisms</h2>
      <p>
        About 80% of PIK3CA mutations in cancer fall into two
        hotspots, and they activate p110 alpha by completely
        different structural routes. Understanding this is the
        difference between picking the right inhibitor chemistry
        and picking the wrong one.
      </p>
      <ul>
        <li>
          <strong>H1047R</strong> sits in the kinase domain near the
          C-terminus. The wild-type histidine at 1047 helps the
          C-terminal tail fold back against the catalytic core in
          an auto-inhibited conformation; mutating it to arginine
          abolishes that auto-inhibition, opens the membrane-binding
          face of the enzyme, and increases affinity for anionic
          phospholipid head groups. The mutant is essentially always
          docked on the membrane where its substrate PIP2 lives.
        </li>
        <li>
          <strong>E542K and E545K</strong> sit in the helical domain.
          The wild-type glutamates make salt bridges with lysine
          residues on the nSH2 regulatory subunit, which keeps p110
          alpha inhibited until a phosphotyrosine peptide displaces
          nSH2. The charge-reversal mutation (glutamate to lysine)
          breaks that salt bridge directly &mdash; the inhibitory
          contact is gone whether or not a tyrosine kinase has fired
          upstream.
        </li>
      </ul>
      <p>
        Both routes converge on constitutive PI3K alpha activation,
        but the conformations are different, and that matters for
        drug binding. Compounds optimized against the H1047R kinase
        domain are not automatically the best fit for helical-domain
        mutants, and vice versa. Most modern inhibitors aim for the
        ATP-binding cleft, where the geometry is more conserved.
      </p>

      <h2>Alpelisib: the proof of concept</h2>
      <p>
        Alpelisib (Piqray) was the first PI3K alpha&ndash;selective
        inhibitor to clear the FDA, approved in 2019 for HR+/HER2&minus;
        advanced breast cancer with a PIK3CA mutation, in combination
        with fulvestrant. The SOLAR-1 trial showed a roughly doubled
        progression-free survival in the mutant population (11.0 vs
        5.7 months) but no benefit in the wild-type cohort &mdash;
        the predictive biomarker is the mutation, not the disease.
      </p>
      <p>
        The clinical experience also exposed the on-target toxicity
        that haunts the whole PI3K class: hyperglycemia. PI3K alpha
        sits at the heart of insulin signaling in skeletal muscle
        and adipose tissue, so inhibiting it systemically blunts
        the post-prandial insulin response. Severe hyperglycemia
        led to dose reductions or discontinuations in a sizeable
        fraction of SOLAR-1 patients, which set the bar for the
        next generation: same antitumor effect, less metabolic
        damage. The way to get there was either better isoform
        selectivity or better mutant-versus-wild-type selectivity.
      </p>

      <h2>Inavolisib: degrade, do not just inhibit</h2>
      <p>
        Inavolisib (Itovebi, Genentech) is a highly selective
        p110 alpha inhibitor with a second, more interesting
        property: it accelerates the degradation of mutant p110
        alpha while sparing the wild-type protein. The mechanism
        appears to involve trapping the mutant enzyme in a
        conformation that is recognized by the cellular protein
        quality-control machinery, so the drug both blocks
        catalysis and reduces the steady-state level of the
        oncogenic protein. The functional consequence is that
        inavolisib achieves deeper pathway suppression at lower
        systemic exposure, and the wild-type alpha activity that
        runs insulin signaling is less affected.
      </p>
      <p>
        That mechanism showed up in the INAVO120 phase 3 trial.
        First-line inavolisib added to palbociclib and fulvestrant
        in PIK3CA-mutated, HR+/HER2&minus; endocrine-resistant
        advanced breast cancer doubled the progression-free
        survival (15.0 vs 7.3 months, hazard ratio 0.43) and
        improved overall survival to 34.0 months versus 27.0
        months in the control arm. The FDA approval on October
        10, 2024 covers the triplet in this exact setting.
      </p>

      <h2>What is still hard</h2>
      <p>
        Hyperglycemia did not disappear with inavolisib, and the
        full PI3K&ndash;mTOR&ndash;AKT pathway still has many
        bypass options once it is pressured. Combinations are the
        ongoing story: PI3K alpha plus CDK4/6 plus endocrine therapy
        is now the validated triplet, and the next questions are
        what to add for ESR1-mutant patients, and how to sequence
        against the inevitable resistance. Resistance pathways
        already characterized include PTEN loss (which reactivates
        downstream PI3K signaling regardless of p110 alpha activity)
        and AKT1 E17K. The selectivity of inavolisib for the mutant
        protein also raises the question of whether the same
        degrader logic extends to other PIK3CA mutations beyond
        H1047R, particularly the helical-domain hotspots where the
        induced conformation may differ.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The canonical PI3K alpha H1047R structure with a
        mutant-selective inhibitor bound is{" "}
        <a
          href="https://www.rcsb.org/structure/4JPS"
          target="_blank"
          rel="noreferrer noopener"
        >
          4JPS
        </a>{" "}
        &mdash; H1047R in the open membrane-binding conformation.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick PI3K alpha from the target catalog with H1047R from
        the mutation chips to dock your own ligands against the
        mutant ATP pocket. Liganx renders both the wild-type and
        H1047R receptors side-by-side so you can see the
        selectivity story directly &mdash; the differential
        ATP-pocket geometry around the C-terminal tail is what
        gives mutant-selective compounds their handle.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based,
        and set up for exactly this kind of mutation question. If
        you want to try molecular docking on PIK3CA H1047R without
        a local install, that is the fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Jhaveri KL, Im SA, Saura C, et al.{" "}
          <em>
            Inavolisib-Based Therapy in PIK3CA-Mutated Advanced
            Breast Cancer.
          </em>{" "}
          NEJM 391(17), 1584&ndash;1596 (2024).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2404625"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2404625
          </a>
        </li>
        <li>
          Andr&eacute; F, Ciruelos E, Rubovszky G, et al.{" "}
          <em>
            Alpelisib for PIK3CA-Mutated, Hormone Receptor-Positive
            Advanced Breast Cancer.
          </em>{" "}
          NEJM 380, 1929&ndash;1940 (2019).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1813904"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1813904
          </a>
        </li>
        <li>
          Burke JE, Perisic O, Masson GR, et al.{" "}
          <em>
            Oncogenic mutations mimic and enhance dynamic events in
            the natural activation of phosphoinositide 3-kinase
            p110 alpha (PIK3CA).
          </em>{" "}
          PNAS 109, 15259&ndash;15264 (2012).{" "}
          <a
            href="https://doi.org/10.1073/pnas.1205508109"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1073/pnas.1205508109
          </a>
        </li>
        <li>
          FDA.{" "}
          <em>
            FDA approves inavolisib with palbociclib and fulvestrant
            for endocrine-resistant, PIK3CA-mutated, HR-positive,
            HER2-negative, advanced breast cancer.
          </em>{" "}
          October 10, 2024.{" "}
          <a
            href="https://www.fda.gov/drugs/resources-information-approved-drugs/fda-approves-inavolisib-palbociclib-and-fulvestrant-endocrine-resistant-pik3ca-mutated-hr-positive"
            target="_blank"
            rel="noreferrer noopener"
          >
            FDA.gov
          </a>
        </li>
      </ul>
    </>
  );
}
