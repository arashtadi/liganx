import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "flt3-f691l-gatekeeper-gilteritinib-resistance",
  title: "FLT3 F691L: the gatekeeper that ends the inhibitor ladder",
  description:
    "Why the F691L gatekeeper mutation breaks gilteritinib and quizartinib in FLT3-mutant AML, the structural mechanism, and which compounds still bind.",
  date: "2026-06-29",
  author: "Liganx team",
  tags: ["flt3", "aml", "resistance", "mutation"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        FLT3-mutant AML now has two approved second-generation inhibitors that
        actually move survival numbers: gilteritinib and quizartinib. Both are
        vulnerable to the same on-target escape hatch. When a leukemic clone
        swaps the bulky phenylalanine at position 691 for a smaller leucine, the
        drugs lose their grip and the disease comes back. F691L is the FLT3
        gatekeeper mutation, and it is the closest thing the field has to a
        universal resistance allele.
      </p>

      <h2>What "gatekeeper" means here</h2>
      <p>
        Every ATP-competitive kinase inhibitor has to thread past a single
        residue that sits at the entrance to the back hydrophobic pocket of the
        ATP site. That residue is the gatekeeper. In FLT3 it is Phe691. Its
        large aromatic side chain does double duty: it shapes the pocket that
        type-I and type-II inhibitors exploit, and in the case of quizartinib it
        makes a direct edge-to-face aromatic contact that anchors the drug.
        Smith et al. solved the first FLT3-quizartinib cocrystal structure and
        showed that quizartinib binding leans on exactly that F691 contact plus
        a second aromatic interaction with F830 in the DFG motif.
      </p>
      <p>
        Mutate Phe691 to leucine and two things happen at once. The aromatic
        anchor disappears, and the smaller leucine reshapes the back pocket in a
        way that no longer accommodates the inhibitor. The same logic explains
        gatekeeper resistance across the kinase world: BCR-ABL T315I, EGFR
        T790M, and ALK L1196M are all gatekeeper substitutions that trade a
        small residue for a bulkier one or vice versa, each one breaking the
        drugs that depended on the original geometry.
      </p>

      <h2>How F691L shows up in the clinic</h2>
      <p>
        Resistance to selective FLT3 inhibition is not dominated by F691L the
        way EGFR resistance was once dominated by T790M. McMahon et al.
        sequenced patients progressing on gilteritinib and quizartinib and found
        that the most common route to clinical resistance is activation of
        parallel RAS/MAPK signaling - NRAS, KRAS, and PTPN11 mutations that route
        around the inhibited kinase entirely. F691L is the leading on-target
        mechanism, but it sits inside a heterogeneous resistance landscape.
      </p>
      <ul>
        <li>
          <strong>On-target tyrosine kinase domain (TKD) mutations</strong> -
          secondary point mutations at D835 and F691. Most D835 variants stay
          sensitive to gilteritinib; F691L is the one that confers resistance to
          essentially all clinically available FLT3 inhibitors.
        </li>
        <li>
          <strong>RAS/MAPK pathway activation</strong> - NRAS/KRAS/PTPN11
          mutations driving bypass signaling. This is the most frequent
          mechanism overall and is invisible to any FLT3-directed drug.
        </li>
        <li>
          <strong>Combination pressure</strong> - F691L has been reported to
          drive clinical resistance to gilteritinib plus venetoclax regimens,
          not just single-agent gilteritinib, so the gatekeeper problem follows
          the drug into combination therapy.
        </li>
      </ul>

      <h2>What still binds an F691L pocket</h2>
      <p>
        The interesting part is that F691L is not a dead end for chemistry the
        way it is for the approved drugs. Smith et al. identified PLX3397
        (pexidartinib) as a FLT3 inhibitor whose binding mode depends far less
        on the gatekeeper position, so it retains activity against the F691L
        mutant in vitro. The general design principle is to build a binder that
        does not rely on a specific aromatic contact with residue 691 - if the
        drug never needed that interaction, removing it costs nothing. Several
        multi-kinase inhibitors with FLT3 activity, including sitravatinib, have
        been explored preclinically for exactly this gatekeeper-agnostic
        property. None has yet displaced gilteritinib as standard of care, which
        is why F691L remains an open clinical problem rather than a solved one.
      </p>

      <h2>Why this is a docking question</h2>
      <p>
        F691L is a textbook case where the absolute docking score matters less
        than the difference between wild-type and mutant. A useful next-gen FLT3
        inhibitor should score roughly the same against F691L as it does against
        the unmutated kinase - that flat profile is the signal that the binding
        mode does not depend on the gatekeeper. A drug like quizartinib will
        show a large score penalty when you swap in the leucine, because you have
        deleted the aromatic contact it was built around.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The canonical FLT3-quizartinib structure is{" "}
        <a
          href="https://www.rcsb.org/structure/4XUF"
          target="_blank"
          rel="noreferrer noopener"
        >
          4XUF
        </a>{" "}
        - the cocrystal that first revealed the F691 gatekeeper contact.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick FLT3 from the target catalog with F691L from the mutation chips
        to dock against the gatekeeper-mutant pocket. Liganx renders the
        wild-type and F691L receptors side by side, so you can read the
        gatekeeper penalty directly: a compound that loses 1-2 kcal/mol against
        F691L is leaning on the Phe691 contact, while a gatekeeper-agnostic
        binder holds its score across both.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and built for
        exactly this kind of mutation-versus-wild-type comparison. If you want to
        try molecular docking on an FLT3 gatekeeper mutation without a local
        install, that is the fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Smith CC, et al. <em>Characterizing and Overriding the Structural
          Mechanism of the Quizartinib-Resistant FLT3 "Gatekeeper" F691L
          Mutation with PLX3397.</em> Cancer Discov 5, 668-679 (2015).{" "}
          <a
            href="https://doi.org/10.1158/2159-8290.CD-15-0060"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2159-8290.CD-15-0060
          </a>
        </li>
        <li>
          McMahon CM, et al. <em>Clonal Selection with RAS Pathway Activation
          Mediates Secondary Clinical Resistance to Selective FLT3 Inhibition in
          Acute Myeloid Leukemia.</em> Cancer Discov 9, 1050-1063 (2019).{" "}
          <a
            href="https://doi.org/10.1158/2159-8290.CD-18-1453"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2159-8290.CD-18-1453
          </a>
        </li>
        <li>
          Perl AE, et al. <em>Gilteritinib or Chemotherapy for Relapsed or
          Refractory FLT3-Mutated AML (ADMIRAL).</em> N Engl J Med 381,
          1728-1740 (2019).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1902688"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1902688
          </a>
        </li>
      </ul>
    </>
  );
}
