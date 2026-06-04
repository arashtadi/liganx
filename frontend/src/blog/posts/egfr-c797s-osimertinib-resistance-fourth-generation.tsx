import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "egfr-c797s-osimertinib-resistance-fourth-generation",
  title: "EGFR C797S: the mutation behind osimertinib resistance",
  description:
    "C797S is the mutation that breaks osimertinib's covalent bond. Here's the mechanism, why allelic context decides treatment, and the fourth-generation inhibitors chasing it.",
  date: "2026-05-23",
  author: "Liganx team",
  tags: ["egfr", "oncology", "resistance", "nsclc"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Osimertinib works because it forms a covalent bond to a single cysteine
        in the EGFR kinase domain: Cys797. Mutate that cysteine to serine and the
        warhead has nothing to hook onto. That is C797S, the on-target resistance
        mutation that ends third-generation EGFR therapy for a meaningful slice of
        patients, and the reason a fourth generation of inhibitors exists at all.
      </p>

      <h2>The covalent bond C797S abolishes</h2>
      <p>
        Osimertinib carries an acrylamide warhead that undergoes Michael addition
        with the thiol of Cys797, sitting at the lip of the ATP pocket. That
        covalent tether is what gives the drug its durable, mutant-selective
        inhibition. Substituting serine for cysteine removes the reactive thiol,
        so no covalent bond forms and the drug's residence time collapses to
        whatever its weak reversible affinity provides, which is not enough.
      </p>
      <p>
        C797S shows up in roughly 10 to 20% of patients progressing on
        second-line osimertinib (those who had T790M first) and about 6 to 12% of
        patients progressing on first-line osimertinib. It was first characterized
        by Thress and colleagues in 2015, almost as soon as the drug entered wide
        use.
      </p>

      <h2>Why allelic context decides everything</h2>
      <p>
        Here is the clinically decisive subtlety: when C797S co-occurs with T790M,
        whether the two mutations sit on the <em>same</em> allele (cis) or
        <em> different</em> alleles (trans) changes what can still work.
      </p>
      <ul>
        <li>
          <strong>Trans (different alleles)</strong> — one allele carries T790M,
          the other C797S. A first-generation EGFR TKI can hit the C797S allele
          and a third-generation TKI can hit the T790M allele, so a combination
          can still suppress the tumor. Niederst et al. (2015) showed this
          experimentally.
        </li>
        <li>
          <strong>Cis (same allele)</strong> — T790M and C797S on one molecule.
          No single approved EGFR TKI, and no first-plus-third-generation
          combination, restores control. This is the dead end that the
          fourth-generation programs were built for.
        </li>
      </ul>
      <p>
        This is why C797S reports increasingly come with allelic phasing from
        ctDNA, not just a variant call. The geometry of the two side chains in the
        binding pocket is the whole story, and it is exactly the kind of thing you
        can look at structurally before committing to a sequencing strategy.
      </p>

      <h2>The fourth-generation chase</h2>
      <p>
        Two design philosophies are competing to drug the triple mutant
        (19Del or L858R, plus T790M, plus C797S):
      </p>
      <ul>
        <li>
          <strong>Non-covalent ATP-competitive inhibitors</strong> — give up the
          covalent bond entirely and bind reversibly with high affinity.{" "}
          <strong>BLU-945</strong> (Blueprint), tested in the SYMPHONY phase 1/2
          trial, reports more than 450-fold selectivity for C797S/T790M mutants
          over wild-type EGFR, and is being run both as monotherapy and combined
          with osimertinib. <strong>BBT-176</strong> (Bridge Biotherapeutics) is
          an orally available non-covalent TKI with nanomolar potency against the
          triple mutant; early SYMPHONY-era reports noted tumor shrinkage in
          19Del/T790M/C797S patients.
        </li>
        <li>
          <strong>Allosteric inhibitors</strong> — bind a pocket outside the ATP
          site that opens in the C-helix-out conformation, so they are
          intrinsically indifferent to whether Cys797 is mutated.{" "}
          <strong>EAI045</strong> was the proof of concept; <strong>JBJ-09-063</strong>
          {" "}is a more drug-like successor. Because they bind a different site,
          allosteric agents pair naturally with ATP-competitive drugs to cover
          multiple resistance contingencies at once.
        </li>
      </ul>
      <p>
        Most of these remain investigational. The honest status as of 2026 is that
        no fourth-generation EGFR inhibitor has reached approval, and the field is
        still working out which allelic and co-mutation contexts each chemotype
        actually rescues.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The cleanest way to build intuition for C797S is to look at the bond that
        is no longer there. <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">Open Studio</Link>{" "}
        and pick EGFR from the target catalog with C797S from the mutation chips to
        run molecular docking against the resistant receptor. Liganx renders the
        wild-type and C797S structures so you can see the serine substitution
        sitting where the acrylamide warhead used to anchor, and a covalent docking
        run will simply fail to place the bond, which is the point. For candidate
        non-covalent binders, compare the docked score against wild-type and mutant
        to read the selectivity story directly.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and built for
        exactly this mutation-aware question. If you want to try molecular docking
        on EGFR resistance mutations without a local install, that is the fastest
        path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Thress KS, et al. <em>Acquired EGFR C797S mutation mediates resistance
          to AZD9291 in non-small cell lung cancer harbouring EGFR T790M.</em>{" "}
          Nat Med 21, 560-562 (2015).{" "}
          <a href="https://doi.org/10.1038/nm.3854" target="_blank" rel="noreferrer noopener">
            doi:10.1038/nm.3854
          </a>
        </li>
        <li>
          Niederst MJ, et al. <em>The Allelic Context of the C797S Mutation
          Acquired upon Treatment with Third-Generation EGFR Inhibitors Impacts
          Sensitivity to Subsequent Treatment Strategies.</em> Clin Cancer Res 21,
          3924-3933 (2015).{" "}
          <a href="https://doi.org/10.1158/1078-0432.CCR-15-0560" target="_blank" rel="noreferrer noopener">
            doi:10.1158/1078-0432.CCR-15-0560
          </a>
        </li>
        <li>
          Lim SM, et al. <em>BBT-176, a Novel Fourth-Generation Tyrosine Kinase
          Inhibitor for Osimertinib-Resistant EGFR Mutations in Non-Small Cell
          Lung Cancer.</em> Clin Cancer Res 29, 3004-3016 (2023).{" "}
          <a href="https://doi.org/10.1158/1078-0432.CCR-22-3901" target="_blank" rel="noreferrer noopener">
            doi:10.1158/1078-0432.CCR-22-3901
          </a>
        </li>
      </ul>
    </>
  );
}
