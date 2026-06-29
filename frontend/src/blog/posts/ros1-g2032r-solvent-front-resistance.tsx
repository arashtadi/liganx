/**
 * Post: ROS1 G2032R — the solvent-front mutation that breaks crizotinib
 *
 * SEO target: "ROS1 G2032R", "ROS1 solvent front mutation", "repotrectinib
 * taletrectinib resistance", "ROS1 NSCLC resistance". Internal CTA into
 * /studio to dock against ROS1 with the G2032R mutation applied.
 *
 * Theme: mutation-specific deep-dive.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "ros1-g2032r-solvent-front-resistance",
  title: "ROS1 G2032R: the solvent-front mutation that breaks crizotinib",
  description:
    "A single glycine-to-arginine swap at the edge of the ROS1 pocket ends crizotinib and entrectinib. How repotrectinib and taletrectinib were built to fit around it.",
  date: "2026-06-05",
  author: "Liganx team",
  tags: ["ros1", "resistance-mutation", "nsclc", "kinase-inhibitors"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        ROS1 fusions drive about 1-2% of non-small cell lung cancers, and the
        first-generation inhibitors hit them hard. Then, almost on schedule,
        the disease comes back. The most common reason is a single amino-acid
        substitution at codon 2032 — glycine to arginine — sitting right at
        the mouth of the ATP pocket. G2032R is the ROS1 equivalent of the
        ALK G1202R and ABL T315I gatekeeper-class problems: a small change in
        a structurally critical spot that converts a frontline drug into an
        inert passenger.
      </p>

      <h2>Why a residue in the solvent does so much damage</h2>
      <p>
        The "solvent front" is the rim of the kinase active site where the
        ATP pocket opens out to bulk water. Residue 2032 sits there. In
        wild-type ROS1 it is a glycine — small, no side chain, plenty of room.
        Crizotinib and entrectinib both reach a substituent out toward that
        rim. When glycine becomes arginine, you bolt a long, positively
        charged side chain onto the edge of the pocket. It is pure steric and
        electrostatic interference: the bulky arginine collides with the part
        of the drug that pokes into solvent, and the inhibitor can no longer
        seat properly. Catalytic activity of the kinase is barely affected, so
        the fusion keeps signaling while the drug is locked out.
      </p>
      <p>
        G2032R was the first crizotinib-resistance mechanism ever reported in
        a ROS1-rearranged patient, and it remains the most frequently detected
        secondary mutation at progression. Because it is a binding-site
        problem rather than a bypass-pathway problem, the fix is chemical:
        design an inhibitor compact enough to avoid the arginine entirely.
      </p>

      <h2>The drugs, in order of who survives G2032R</h2>
      <ul>
        <li>
          <strong>Crizotinib</strong> (Xalkori) — first ROS1 TKI, FDA-approved
          for ROS1+ NSCLC in 2016. Potent against wild-type fusion, poor CNS
          penetration, and knocked out by G2032R.
        </li>
        <li>
          <strong>Entrectinib</strong> (Rozlytrek) — approved 2019, designed
          for CNS activity and active against ROS1 and NTRK fusions. Better in
          the brain than crizotinib, but it also reaches into the solvent
          front and is likewise defeated by G2032R.
        </li>
        <li>
          <strong>Repotrectinib</strong> (Augtyro) — approved November 2024 on
          the TRIDENT-1 trial. A compact macrocycle deliberately engineered to
          tuck inside the ATP pocket without protruding toward residue 2032,
          so the arginine has nothing to clash with. Retains activity against
          G2032R and the related D2033N, and crosses into the CNS.
        </li>
        <li>
          <strong>Taletrectinib</strong> (Ibtrozi) — approved June 2025 on the
          TRUST-I and TRUST-II trials. Built specifically to cover acquired
          ROS1 mutations including the G2032R solvent-front substitution.
          Objective response rates ran around 85-90% in TKI-naive patients and
          roughly 50-60% in those who had already progressed on a prior ROS1
          TKI.
        </li>
      </ul>
      <p>
        The pattern is the same one that played out in ALK and in BCR-ABL:
        the first generation is potent but fragile at the solvent front, and
        the next generation is drawn smaller and rounder so the resistance
        residue has nothing to push against.
      </p>

      <h2>The mutation past the mutation</h2>
      <p>
        Solving G2032R does not close the book. The next escape hatch for ROS1
        is <strong>L2086F</strong>, a substitution in the central beta-sheet 6
        (Cβ6) that sits deeper in the kinase core. L2086F can blunt even
        repotrectinib and taletrectinib, and the emerging strategy against it
        is a type-switch: moving from a type-I, DFG-in binder to a type-II
        inhibitor such as cabozantinib that engages the kinase in its inactive
        conformation. It is a useful reminder that "next-generation" is always
        relative to a specific resistance residue, never absolute.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        Seeing why G2032R breaks crizotinib is much clearer with a structure
        in front of you than from a sequence. The collision is geometric, and
        a pose makes it obvious.
      </p>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick ROS1 with the G2032R mutation, then dock crizotinib and
        repotrectinib side by side. With molecular docking you can watch the
        arginine side chain crowd the crizotinib solvent-front substituent
        while the more compact repotrectinib stays clear of it. Running this
        kind of molecular docking online — wild-type versus mutant, old drug
        versus new — is the fastest way to build intuition for why one
        inhibitor keeps working and the other stops.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Drilon A, et al. <em>Repotrectinib in ROS1 fusion-positive
          non-small-cell lung cancer (TRIDENT-1).</em> Reviewed in: Cancer
          Med (2024).{" "}
          <a
            href="https://pmc.ncbi.nlm.nih.gov/articles/PMC11473655/"
            target="_blank"
            rel="noreferrer noopener"
          >
            PMC11473655
          </a>
        </li>
        <li>
          Comprehensive review of ROS1 tyrosine kinase inhibitors classified
          by structural design and mutation spectrum (solvent-front G2032R and
          Cβ6 L2086F). <em>J Thorac Oncol</em> (2024).{" "}
          <a
            href="https://www.jto.org/article/S1556-0864(23)02413-9/fulltext"
            target="_blank"
            rel="noreferrer noopener"
          >
            S1556-0864(23)02413-9
          </a>
        </li>
        <li>
          U.S. Food &amp; Drug Administration. <em>FDA approves taletrectinib
          for ROS1-positive non-small cell lung cancer</em> (June 11, 2025).{" "}
          <a
            href="https://www.fda.gov/drugs/resources-information-approved-drugs/fda-approves-taletrectinib-ros1-positive-non-small-cell-lung-cancer"
            target="_blank"
            rel="noreferrer noopener"
          >
            fda.gov
          </a>
        </li>
      </ul>
    </>
  );
}
