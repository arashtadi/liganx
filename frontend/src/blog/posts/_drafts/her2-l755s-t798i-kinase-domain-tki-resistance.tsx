/**
 * Post: HER2 L755S and T798I - kinase-domain resistance to HER2 TKIs
 *
 * SEO target: "HER2 L755S", "HER2 T798I gatekeeper", "neratinib resistance",
 * "lapatinib resistance mutation". Internal CTA into /studio with HER2 +
 * mutation selection.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "her2-l755s-t798i-kinase-domain-tki-resistance",
  title: "HER2 L755S and T798I: when HER2 TKIs stop working",
  description:
    "Two HER2 kinase-domain mutations that blunt lapatinib and neratinib, why the gatekeeper position keeps producing the same failure mode, and what still works.",
  date: "2026-08-03",
  author: "Liganx team",
  tags: ["her2", "resistance", "breast-cancer", "kinase-inhibitors"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Most people meet HER2 as an amplification — extra copies of{" "}
        <em>ERBB2</em>, too much receptor on the surface, treat with
        trastuzumab. But there is a second, smaller HER2 population defined
        not by copy number but by point mutations inside the kinase domain.
        Those tumours are treated with tyrosine kinase inhibitors rather than
        antibodies, and like every other kinase target, they eventually
        acquire second-site mutations that push the drug back out of the
        pocket. Two of them, L755S and T798I, are worth knowing in detail
        because they fail in completely different ways.
      </p>

      <h2>HER2 mutations without HER2 amplification</h2>
      <p>
        Bose and colleagues pulled 25 patients with somatic{" "}
        <em>ERBB2</em> mutations out of eight breast cancer
        genome-sequencing projects, all of them without HER2 gene
        amplification, and functionally characterized thirteen of the
        mutations. Seven were activating on their own: G309A, D769H, D769Y,
        V777L, P780ins, V842I, and R896C. Every one of the thirteen was
        sensitive to the irreversible inhibitor neratinib. That paper is
        the reason HER2-mutant, HER2-non-amplified breast cancer became a
        drug target at all.
      </p>
      <p>
        The clinical follow-through was SUMMIT, a genomically selected
        basket trial of neratinib across HER2- and HER3-mutant cancers.
        The headline result was that response depended on both tumour type
        and the specific allele, to a degree the preclinical models had not
        predicted. Activity was highest in breast, cervical and biliary
        cancers, and in tumours carrying kinase-domain missense mutations.
        &ldquo;HER2-mutant&rdquo; is not one disease, and the allele matters.
      </p>

      <h2>L755S: the lapatinib escape hatch</h2>
      <p>
        L755S sits in the beta-3/alpha-C region of the HER2 kinase domain.
        In the Bose characterization it was notable for what it did{" "}
        <em>not</em> do: it was not an activating mutation in their assays,
        but it did produce lapatinib resistance. That combination is the
        signature of a pure drug-binding mutation rather than a driver.
      </p>
      <p>
        Xu and colleagues later showed how it arises. They took two
        independent BT474 HER2-amplified lines, drove them to resistance
        against lapatinib and against the lapatinib-plus-trastuzumab
        combination, and sequenced. L755S was the only somatic mutation
        common to both resistant derivatives. The causality checks were
        clean in both directions: forced expression of L755S conferred
        lapatinib resistance in parental BT474, SK-BR-3 and AU565 cells,
        and mutant-specific siRNA knockdown reversed resistance in the
        resistant lines. Critically, the irreversible HER1/HER2 inhibitors
        afatinib and neratinib still suppressed growth and still shut down
        the downstream AKT and MAPK signalling.
      </p>
      <p>
        The caveat worth flagging: conference reports since then have
        described L755S models that are also cross-resistant to neratinib
        and tucatinib. That work has not, as far as we can find, appeared
        as a peer-reviewed primary paper, so treat the covalent-inhibitor
        rescue as the published position and the cross-resistance claim as
        unresolved rather than settled.
      </p>

      <h2>T798I: a textbook gatekeeper</h2>
      <p>
        The gatekeeper residue sits at the mouth of the hydrophobic back
        pocket behind the ATP site, and it is the single most reliable
        place in a kinase to break an inhibitor without breaking the
        enzyme. ABL has T315I. EGFR has T790M. ALK has L1196M. FLT3 has
        F691L. HER2 has T798I, and it behaves exactly as the pattern
        predicts.
      </p>
      <p>
        Hanker and colleagues reported it in a patient with HER2-L869R
        mutant breast cancer who had a sustained partial response to
        neratinib and then progressed. T798I turned up in plasma
        cell-free DNA at progression. Structural modelling attributed the
        resistance to the extra bulk of isoleucine relative to threonine,
        which reduces neratinib binding. In cells, HER2 T798I resisted
        neratinib while HER2 wild type did not. Two other irreversible
        agents — afatinib, and AZ5104, an active metabolite of osimertinib —
        still suppressed T798I signalling and growth.
      </p>
      <p>
        That is the useful clinical shape of a gatekeeper mutation: it
        rarely kills a whole drug class, it kills the specific chemotypes
        whose back-pocket footprint is too wide. Substituting a different
        irreversible inhibitor with a slimmer back-pocket occupancy is a
        rational next move, and in this case it worked in the laboratory
        models.
      </p>

      <h2>What still works when the kinase domain fails</h2>
      <ul>
        <li>
          <strong>A different irreversible TKI.</strong> Afatinib retained
          activity against both L755S and T798I in the published cell
          models. Chemotype matters more than mechanism label.
        </li>
        <li>
          <strong>Tucatinib</strong> — a reversible, HER2-selective TKI
          approved in 2020 on the strength of HER2CLIMB. Its selectivity
          for HER2 over EGFR is what makes the combination tolerable, but
          it is a reversible ATP-competitive binder, so it is exposed to
          the same steric arguments as lapatinib.
        </li>
        <li>
          <strong>Antibody-drug conjugates.</strong> Trastuzumab
          emtansine and trastuzumab deruxtecan bind the extracellular
          domain and deliver a cytotoxic payload. A kinase-domain point
          mutation is invisible to them. This is the strongest argument
          for keeping ADCs in reserve for a patient whose TKI failure is
          driven by a back-pocket mutation.
        </li>
      </ul>

      <h2>Why gatekeepers are the easy case for docking</h2>
      <p>
        Resistance mutations vary enormously in how tractable they are to
        structural modelling. Allosteric and dimerization-interface
        mutations are hard, because the effect is propagated through
        conformational equilibria that a single docked pose does not
        capture. Gatekeeper mutations are the opposite: the change is
        local, steric, and sits directly in the binding site. Threonine to
        isoleucine adds a couple of heavy atoms of bulk and removes a
        hydroxyl that some inhibitors hydrogen-bond to. A rigid-receptor
        dock will usually reproduce the direction of that effect.
      </p>
      <p>
        The number to look at is not the absolute score. It is the
        difference between the score against wild-type HER2 and the score
        against the mutant, for the same ligand and the same protocol. A
        compound that loses 1.5 kcal/mol going from wild type to T798I is
        telling you something; a compound that scores -9.8 against T798I
        in isolation is telling you almost nothing.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick HER2 with T798I or L755S, then run the same ligand against
        wild-type HER2 in a second job and compare. Neratinib, afatinib,
        lapatinib and tucatinib are a good four-compound panel to start
        with, because the published cell data give you a ground truth to
        check the ranking against.
      </p>
      <p>
        Liganx makes mutation-aware molecular docking online and free in
        the browser, so running a wild-type versus mutant pair is a
        two-job experiment rather than a software installation. Molecular
        docking will not tell you whether a patient responds, but it will
        tell you which of your candidate chemotypes is structurally
        exposed to a gatekeeper substitution before you spend bench time
        finding out.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Bose R, Kavuri SM, Searleman AC, et al. <em>Activating HER2
          mutations in HER2 gene amplification negative breast cancer.</em>{" "}
          Cancer Discov 3, 224-237 (2013).{" "}
          <a
            href="https://doi.org/10.1158/2159-8290.CD-12-0349"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2159-8290.CD-12-0349
          </a>
        </li>
        <li>
          Hanker AB, Brewer MR, Sheehan JH, et al. <em>An acquired HER2
          T798I gatekeeper mutation induces resistance to neratinib in a
          patient with HER2 mutant-driven breast cancer.</em> Cancer Discov
          7, 575-585 (2017).{" "}
          <a
            href="https://doi.org/10.1158/2159-8290.CD-16-1431"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2159-8290.CD-16-1431
          </a>
        </li>
        <li>
          Xu X, De Angelis C, Burke KA, et al. <em>HER2 reactivation through
          acquisition of the HER2 L755S mutation as a mechanism of acquired
          resistance to HER2-targeted therapy in HER2-positive breast
          cancer.</em> Clin Cancer Res 23, 5123-5134 (2017).{" "}
          <a
            href="https://doi.org/10.1158/1078-0432.CCR-16-2191"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/1078-0432.CCR-16-2191
          </a>
        </li>
        <li>
          Hyman DM, Piha-Paul SA, Won H, et al. <em>HER kinase inhibition in
          patients with HER2- and HER3-mutant cancers.</em> Nature 554,
          189-194 (2018).{" "}
          <a
            href="https://doi.org/10.1038/nature25475"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nature25475
          </a>
        </li>
      </ul>
    </>
  );
}
