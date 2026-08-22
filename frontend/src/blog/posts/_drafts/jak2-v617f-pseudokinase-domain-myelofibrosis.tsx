/**
 * Post: JAK2 V617F and the JH2 pseudokinase domain
 *
 * Mutation-specific theme. SEO target: "JAK2 V617F", "myelofibrosis JAK
 * inhibitor", "pseudokinase domain allosteric inhibitor". Internal CTA into
 * /studio for JH2-pocket docking.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "jak2-v617f-pseudokinase-domain-myelofibrosis",
  title: "JAK2 V617F: a mutation in the domain nobody drugs",
  description:
    "Why every approved JAK inhibitor targets the wrong domain of JAK2, and how mutant-selective compounds aimed at the JH2 pseudokinase pocket could change that.",
  date: "2026-07-27",
  author: "Liganx team",
  tags: ["jak2", "mutations", "myelofibrosis", "allosteric"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        JAK2 V617F is one of the most common driver mutations in human cancer,
        present in roughly 95 percent of polycythemia vera and about half of
        essential thrombocythemia and myelofibrosis cases. Four JAK inhibitors
        are approved for myelofibrosis. None of them binds the mutation. That
        gap explains almost everything about how these drugs behave in the
        clinic, and it is the reason a new generation of compounds is aiming at
        a pocket most medicinal chemists were taught to ignore.
      </p>

      <h2>Two kinase domains, only one of them catalytic</h2>
      <p>
        JAK2 is unusual. It carries two tandem kinase folds: JH1, the real
        catalytic tyrosine kinase, and JH2, a pseudokinase domain immediately
        upstream. JH2 looks like a kinase and even binds Mg-ATP, but it does so
        noncanonically and does not act as a conventional catalytic kinase on
        downstream substrates. Its actual job is regulatory. JH2 clamps JH1 into
        an inactive conformation, holding the activation loop down and
        restraining the movement of the catalytic domain&rsquo;s alpha-C helix
        through a set of hydrophobic and electrostatic contacts.
      </p>
      <p>
        Valine 617 sits in JH2, not JH1. Substituting it with phenylalanine
        rigidifies the alpha-C helix in the JH2 N-lobe, and structural and
        mutagenesis work points to a pi-stacking interaction between the new
        F617 and the neighbouring F595 as the key event. Mutating F595 to
        alanine, lysine, valine or isoleucine largely abolishes V617F
        constitutive activity, while F595W and F595Y restore it, which is about
        as clean an aromaticity requirement as mechanistic biology gets. The
        result is that the autoinhibitory grip on JH1 loosens, JH1
        trans-phosphorylates, and cytokine receptor signalling runs without a
        ligand.
      </p>

      <h2>Why the approved drugs cannot be selective</h2>
      <p>
        Every approved JAK inhibitor is an ATP-competitive binder of the JH1
        catalytic site. The JH1 ATP pocket of mutant JAK2 is structurally
        identical to that of wild-type JAK2, because the mutation is 200-plus
        residues away in a different domain. These drugs therefore inhibit
        mutant and wild-type JAK2 with the same affinity, and wild-type JAK2 is
        the signalling hub for erythropoietin and thrombopoietin.
      </p>
      <ul>
        <li>
          <strong>Ruxolitinib</strong> (JAK1/JAK2), approved 2011 for
          myelofibrosis on the COMFORT-I and COMFORT-II trials. Reliable spleen
          volume reduction and symptom improvement, with dose-limiting anemia
          and thrombocytopenia that follow directly from wild-type JAK2
          blockade.
        </li>
        <li>
          <strong>Fedratinib</strong> (JAK2/FLT3), approved 2019, active in some
          ruxolitinib-exposed patients but carrying a boxed warning for
          encephalopathy including Wernicke.
        </li>
        <li>
          <strong>Pacritinib</strong> (JAK2/IRAK1/ACVR1), approved 2022,
          positioned for patients with severe thrombocytopenia where ruxolitinib
          dosing is not tolerable.
        </li>
        <li>
          <strong>Momelotinib</strong> (JAK1/JAK2/ACVR1), approved 2023, with
          an anemia benefit attributed to ACVR1 inhibition lowering hepcidin
          rather than to anything JAK2-selective.
        </li>
      </ul>
      <p>
        Notice the pattern. Each successive agent is differentiated by its
        off-target profile, not by mutant selectivity. Clinically these drugs
        are excellent at controlling spleen size and constitutional symptoms,
        but none of them reliably clears the mutant clone. They manage the
        disease rather than modify it, and the therapeutic window is set by how
        much wild-type JAK2 inhibition a patient&rsquo;s marrow can absorb.
      </p>

      <h2>The JH2 pocket as a drug target</h2>
      <p>
        If the mutation lives in JH2, and JH2 has a real nucleotide-binding
        pocket, then a compound that binds JH2 has something the JH1 binders
        never will: a structurally distinct site in a domain that differs
        between mutant and wild-type protein. That is the premise behind current
        mutant-selective programs. Reported preclinical compounds bind the JH2
        allosteric pocket where V617F resides, with picomolar affinity for the
        mutant JH2 domain and substantial selectivity over other JAK family
        members, and several groups have described orally bioavailable
        JAK2 V617F-selective JH2 binders moving toward first-in-human studies.
      </p>
      <p>
        The mechanistic hope is disease modification rather than symptom
        control. A compound that restores or mimics JH2-mediated autoinhibition
        specifically in the mutant protein would leave wild-type JAK2 signalling
        intact, which in principle removes the anemia and thrombocytopenia
        ceiling that constrains every current agent. These are preclinical and
        early-clinical claims, not outcomes, and pseudokinase pharmacology has
        historically been difficult, so the appropriate posture is interested
        scepticism.
      </p>

      <h2>What this means for a modelling workflow</h2>
      <p>
        JAK2 is an unusually good case study in why the identity of the pocket
        matters more than the potency number. A virtual screen run against the
        JH1 ATP site will produce plenty of nanomolar-looking hits and every one
        of them will be, by construction, mutant-agnostic. The interesting
        question is whether a scaffold discriminates between the V617F and
        wild-type JH2 domains, and that is a differential question: dock the
        same ligand into both receptor states and look at the difference, not
        the absolute score.
      </p>
      <p>
        Two practical cautions. First, JH2 binds nucleotide noncanonically, so
        assumptions carried over from canonical ATP-site pharmacophores may not
        transfer cleanly. Second, a point mutation like V617F produces a modest
        change in pocket shape and electrostatics, which puts the signal near
        the noise floor of a single docking run. Ensemble receptors and
        consensus scoring are worth the extra compute here.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and set up JAK2 with and without V617F to run the comparison directly.
        Docking a candidate into both receptor states and reading the delta is
        the cheapest way to ask whether a scaffold has any mutant preference at
        all, and it is exactly the kind of question molecular docking online is
        good at answering before anyone commits to synthesis. If you are
        exploring the JH2 pocket rather than the JH1 ATP site, define the search
        box around the pseudokinase nucleotide site and validate your poses
        before trusting the ranking.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Bandaranayake RM, Ungureanu D, Shan Y, Shaw DE, Silvennoinen O,
          Hubbard SR. <em>Crystal structures of the JAK2 pseudokinase domain and
          the pathogenic mutant V617F.</em> Nat Struct Mol Biol 19, 754-759
          (2012).{" "}
          <a
            href="https://doi.org/10.1038/nsmb.2348"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1038/nsmb.2348
          </a>
        </li>
        <li>
          Dusa A, Mouton C, Pecquet C, Herman M, Constantinescu SN.{" "}
          <em>JAK2 V617F constitutive activation requires JH2 residue F595: a
          pseudokinase domain target for specific inhibitors.</em> PLoS One 5,
          e11157 (2010).{" "}
          <a
            href="https://doi.org/10.1371/journal.pone.0011157"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1371/journal.pone.0011157
          </a>
        </li>
        <li>
          Verstovsek S, et al. <em>A double-blind, placebo-controlled trial of
          ruxolitinib for myelofibrosis.</em> N Engl J Med 366, 799-807 (2012).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1110557"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1110557
          </a>
        </li>
        <li>
          <em>Next-generation JAK inhibitors in the treatment of
          myeloproliferative neoplasms.</em> Blood 147, 1255 (2026).{" "}
          <a
            href="https://ashpublications.org/blood/article/147/12/1255/565933/Next-generation-JAK-inhibitors-in-the-treatment-of"
            target="_blank"
            rel="noreferrer noopener"
          >
            ashpublications.org
          </a>
        </li>
      </ul>
    </>
  );
}
