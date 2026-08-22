/**
 * Post: TP53 Y220C and rezatapopt — refolding a broken tumor suppressor
 * by filling the crevice its mutation carved.
 *
 * SEO target: "TP53 Y220C", "p53 reactivator", "rezatapopt", "PC14586",
 * "mutant p53 drug", "p53 Y220C pocket docking".
 * Mutation-specific deep dive. Internal CTA into /studio via the
 * mutation-induced-pocket docking angle.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "tp53-y220c-rezatapopt-p53-reactivator",
  title: "TP53 Y220C: the mutation that drilled its own drug pocket",
  description:
    "Y220C destabilizes p53 by carving a surface crevice that wild-type protein does not have. Rezatapopt fills it, refolds the protein, and is now producing responses across eight tumor types.",
  date: "2026-07-28",
  author: "Liganx team",
  tags: ["tp53", "y220c", "rezatapopt", "p53-reactivator", "mutation-analysis"],
  readingMin: 7,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        <em>TP53</em> is the most frequently mutated gene in human cancer and
        the most stubbornly undruggable. You cannot inhibit a tumor
        suppressor that has already been switched off; you have to switch it
        back on. Most <em>TP53</em> missense mutations offer no obvious
        chemical handle for doing that. Y220C is the exception, and it is an
        exception for a reason that should interest anyone who thinks about
        binding sites: the mutation physically creates a pocket that does not
        exist in wild-type p53.
      </p>

      <h2>What Y220C actually breaks</h2>
      <p>
        p53 binds DNA through a central DNA-binding domain whose fold is
        already marginally stable at body temperature. Cancer mutations in
        that domain split into two rough classes. Contact mutants (R248Q,
        R273H) keep the fold but lose direct contacts with DNA. Structural
        mutants destabilize the fold itself, so the protein unfolds,
        aggregates, and never reaches its response elements.
      </p>
      <p>
        Y220C is a structural mutant, and a particularly clean one. Tyrosine
        220 sits in the hydrophobic core, wedged between two beta-sandwich
        strands. Swapping that bulky aromatic side chain for a small cysteine
        removes roughly the volume of a benzene ring from a place that was
        tightly packed. The surrounding strands do not fully collapse to fill
        the gap. Instead a surface crevice opens where the tyrosine used to
        be, and the domain loses about 4 kcal/mol of thermodynamic stability,
        dropping its melting temperature by roughly 8&nbsp;&deg;C. At 37&nbsp;&deg;C
        that is enough to leave a large fraction of the protein unfolded at
        any given moment. Crucially, the residual folded population is
        structurally normal: it still binds DNA and still activates
        transcription. The protein is not miswired, it is merely melting.
      </p>
      <p>
        Y220C accounts for roughly 1&ndash;2% of all <em>TP53</em> mutations
        across cancer, which sounds small until you multiply it by how often
        <em> TP53</em> is hit. It appears in ovarian, lung, breast,
        endometrial, colorectal, head-and-neck and biliary tumors, which makes
        it a genuinely tumor-agnostic target.
      </p>

      <h2>Fill the hole, restore the fold</h2>
      <p>
        The therapeutic logic follows directly from the biophysics. If the
        mutant is destabilized because a cavity opened, a ligand that binds
        that cavity should shift the folding equilibrium back toward the
        native state by simple thermodynamic coupling. Stabilize the folded
        form and you raise the fraction of functional p53 in the cell. No
        inhibition, no allostery in the classical sense: just chaperoning by
        small molecule.
      </p>
      <p>
        Fersht and colleagues laid the groundwork. Structural work in the
        mid-2000s characterized the Y220C crevice, and in 2008 Boeckler and
        coworkers ran an in-silico screen against it, identified the
        carbazole PhiKan083, and confirmed by crystallography and
        thermal-shift assays that occupying the site raised the mutant&apos;s
        melting temperature. The affinity was weak, in the high-micromolar
        range, but the concept was proven: a computationally screened
        fragment could rescue a destabilized tumor suppressor.
      </p>
      <p>
        Rezatapopt (PC14586, PMV Pharmaceuticals) is what that idea looks
        like after a full medicinal chemistry campaign. It is an orally
        available small molecule that binds the Y220C crevice with nanomolar
        affinity, restores the wild-type conformation of the mutant
        DNA-binding domain, and reinstates p53-dependent transcription. It is
        exquisitely genotype-dependent, which is the point: cells carrying
        wild-type <em>TP53</em> or other mutant alleles have no pocket to
        bind, so there is nothing for the drug to do.
      </p>

      <h2>What the clinic has shown so far</h2>
      <ul>
        <li>
          <strong>PYNNACLE Phase 1</strong> &mdash; the first-in-human portion
          (NCT04585750) enrolled heavily pretreated patients with
          Y220C-mutant advanced solid tumors and established proof of concept
          for pharmacologic p53 reactivation, alongside a tolerability
          profile that supported a 2,000&nbsp;mg daily monotherapy dose. The
          Phase 1 results across 77 patients were published in the{" "}
          <em>New England Journal of Medicine</em>.
        </li>
        <li>
          <strong>PYNNACLE Phase 2</strong> &mdash; interim monotherapy data
          reported an objective response rate of roughly a third across all
          cohorts (35 of 103 patients as of the September 2025 cut), with
          confirmed responses in eight tumor types including ovarian, lung,
          endometrial, breast, head and neck, colorectal, gallbladder and
          ampullary carcinoma. Ovarian cancer was the standout at about 46%.
          Median time to response was 1.3 months and median duration of
          response 7.6 months.
        </li>
        <li>
          <strong>Regulatory path</strong> &mdash; PMV has guided toward an
          NDA submission following completion of Phase 2 enrollment. Nothing
          is approved yet, and the duration-of-response figure is the number
          to watch as the data mature.
        </li>
      </ul>
      <p>
        A caveat worth stating plainly: restoring p53 function is not the
        same as durable tumor control. Reactivated p53 pushes cells toward
        apoptosis and senescence, but tumors that have spent years growing
        without functional p53 have usually acquired other lesions in the
        same pathway. Combination strategies, rather than monotherapy, are
        where this class is likely to end up.
      </p>

      <h2>Why this is a structure-based design story</h2>
      <p>
        Y220C is the cleanest available example of a principle that shows up
        repeatedly in structure-based design: the druggable pocket is a
        property of a particular conformational state, not of the sequence.
        Dock against a wild-type p53 DNA-binding domain and the Y220 site is
        simply not there, because tyrosine 220 fills it. Mutate the residue
        and a real, enclosed, hydrophobic crevice appears. The same logic
        underlies cryptic-pocket work more generally, and it is why the
        receptor structure you choose determines the answer you get before
        you have scored a single ligand.
      </p>
      <p>
        The pocket also illustrates why binding-site quality matters more
        than binding-site size. The Y220C crevice is small and partly
        solvent-exposed, which is why early fragments stalled in the
        micromolar range and why getting to nanomolar required careful
        exploitation of subsites around the central cavity. Molecular docking
        is well suited to exactly this kind of question: given a small,
        shallow site, which chemotypes can reach the buried subpockets
        without paying an unreasonable desolvation or strain penalty.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and set up a mutation-aware comparison: dock a ligand series against a
        wild-type receptor and against the corresponding point mutant, then
        look at the &Delta;&Delta; between them rather than the absolute
        scores. That differential is the signal you care about for a
        genotype-selective molecule. Our write-ups on{" "}
        <Link
          to="/blog/cryptic-allosteric-pockets-docking"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          cryptic and allosteric pockets
        </Link>{" "}
        and on{" "}
        <Link
          to="/blog/ddg-vs-absolute-docking-scores"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          why &Delta;&Delta; beats absolute scores
        </Link>{" "}
        cover the protocol details.
      </p>
      <p>
        Because Liganx runs molecular docking online and free, you can set up
        a mutant-versus-wild-type molecular docking comparison in the browser
        without installing a local toolchain first.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Boeckler FM, et al. <em>Targeted rescue of a destabilized mutant of
          p53 by an in silico screened drug.</em> Proc Natl Acad Sci USA 105,
          10360&ndash;10365 (2008).{" "}
          <a
            href="https://doi.org/10.1073/pnas.0805326105"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1073/pnas.0805326105
          </a>
        </li>
        <li>
          Joerger AC, Ang HC, Fersht AR. <em>Structural basis for
          understanding oncogenic p53 mutations and designing rescue drugs.</em>{" "}
          Proc Natl Acad Sci USA 103, 15056&ndash;15061 (2006).{" "}
          <a
            href="https://doi.org/10.1073/pnas.0607286103"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1073/pnas.0607286103
          </a>
        </li>
        <li>
          Discovery of Rezatapopt (PC14586), a First-in-Class, Small-Molecule
          Reactivator of p53 Y220C Mutant in Development.{" "}
          <em>ACS Medicinal Chemistry Letters</em> (2024).{" "}
          <a
            href="https://doi.org/10.1021/acsmedchemlett.4c00379"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acsmedchemlett.4c00379
          </a>
        </li>
        <li>
          PYNNACLE phase II clinical trial protocol: rezatapopt (PC14586)
          monotherapy in advanced or metastatic solid tumors with a TP53 Y220C
          mutation. <em>Future Oncology</em> (2025).{" "}
          <a
            href="https://doi.org/10.1080/14796694.2025.2557176"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1080/14796694.2025.2557176
          </a>
        </li>
        <li>
          ClinicalTrials.gov. <em>PYNNACLE: A Study of PC14586 in Patients
          With Advanced Solid Tumors Harboring a TP53 Y220C Mutation</em>{" "}
          (NCT04585750).{" "}
          <a
            href="https://clinicaltrials.gov/study/NCT04585750"
            target="_blank"
            rel="noreferrer noopener"
          >
            clinicaltrials.gov
          </a>
        </li>
      </ul>
    </>
  );
}
