/**
 * Post: Water networks in docking - the waters you displace decide potency
 *
 * SEO target: "water in drug design", "WaterMap", "displaceable water
 * docking", "structure-based design hydration". Methodology theme.
 * Internal CTA into /studio. DRAFT - awaiting human review.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "water-networks-displaceable-waters-docking",
  title: "Water networks in docking: the waters you displace decide potency",
  description:
    "Binding pockets are full of water, not vacuum. Which waters you displace and which you keep often explains potency better than the ligand contacts themselves.",
  date: "2026-06-03",
  author: "Liganx team",
  tags: ["methodology", "docking", "water", "thermodynamics", "drug-design"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Most docking pictures show a ligand dropping into an empty pocket.
        The real pocket is full of water, and a large fraction of the
        binding free energy comes not from the ligand touching the protein
        but from what happens to those water molecules when the ligand
        arrives. Get the water story wrong and your scoring function will
        confidently rank the wrong analog. Get it right and a single
        methyl group that displaces an unhappy water can buy you an order
        of magnitude in affinity.
      </p>

      <h2>Why a pocket is not a vacuum</h2>
      <p>
        Before a ligand binds, the pocket is solvated. Each water sits in
        some local environment: some are perfectly happy, making a full
        complement of hydrogen bonds; others are trapped in a greasy,
        enclosed spot where they cannot satisfy their hydrogen-bonding
        partners and pay an entropic penalty for being pinned in place.
        Binding is a swap. The ligand evicts some of those waters back into
        bulk solvent and leaves others in place, sometimes bridging the
        ligand to the protein.
      </p>
      <p>
        The thermodynamic accounting is the whole game. Displacing a
        high-energy, frustrated water is strongly favorable: that water was
        unhappy in the pocket and is much happier back in bulk, so kicking
        it out releases free energy. Displacing a contented, well-satisfied
        water is the opposite &mdash; you pay to remove something that was
        already comfortable. This is why two ligands that make almost
        identical contacts with a protein can differ enormously in potency:
        they are displacing different waters.
      </p>

      <h2>The classic result that made this concrete</h2>
      <p>
        The framework most people cite traces to work from the Friesner and
        Berne groups in the late 2000s. By running molecular dynamics on the
        solvated apo pocket and clustering the water density into discrete
        hydration sites, they could assign each site an enthalpy and entropy
        relative to bulk &mdash; the approach commercialized as WaterMap. In
        their factor Xa analysis, the pattern of which hydration sites a
        ligand displaced tracked the measured binding affinities across a
        congeneric series, even where the direct protein-ligand contacts
        looked similar. The earlier &ldquo;hydrophobic enclosure&rdquo; work
        explained the underlying physics: waters in tightly enclosed,
        hydrophobic sub-pockets are the most frustrated, so displacing them
        is where the biggest potency gains hide.
      </p>

      <h2>Conserved waters: the ones you keep</h2>
      <p>
        The flip side matters just as much. Some pocket waters are so well
        coordinated that the smart move is to design around them rather than
        displace them. A conserved bridging water that donates and accepts
        hydrogen bonds between the ligand and the protein can be worth more
        than a direct contact, and a series of FDA-approved drugs are
        predicted to rely on a ligand-contacting water network. The trap is
        that displacing one water in a connected network can destabilize the
        rest, so an &ldquo;obvious&rdquo; modification that should pick up a
        contact instead collapses the network and loses potency. Treating
        these waters as part of the receptor, not as empty space to be
        filled, is the difference between a rational SAR step and a
        surprise.
      </p>

      <h2>What this means for docking</h2>
      <p>
        Standard docking treats the pocket as dry and bakes a crude
        desolvation term into the scoring function. That is fine for triage
        but it is exactly the approximation that breaks down on the analogs
        you care most about. A few practical habits help:
      </p>
      <ul>
        <li>
          <strong>Keep crystallographic waters that are clearly conserved.</strong>
          If a bridging water appears in multiple structures of the same
          target, dock with it present rather than deleting every water by
          reflex.
        </li>
        <li>
          <strong>Treat displaceable waters explicitly when you can.</strong>
          Methods that let docking add or remove discrete waters with a
          desolvation penalty &mdash; the hydrated-docking force fields built
          for this &mdash; recover poses that dry docking misses.
        </li>
        <li>
          <strong>Be suspicious of a potency jump your contacts cannot
          explain.</strong> If an analog gains affinity without any new
          protein contact, a displaced unhappy water is the usual culprit,
          and that insight generalizes to the next compound.
        </li>
      </ul>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock a small congeneric series against your target, then compare
        the poses and interaction fingerprints between analogs that differ by
        a single substituent. When molecular docking gives two close analogs
        very different scores, ask which pocket waters each one is displacing
        before you trust the ranking. Liganx brings molecular docking online
        in the browser so you can run the comparison and inspect every pose
        without a local setup.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Abel R, Young T, Farid R, Berne BJ, Friesner RA. <em>Role of the
          Active-Site Solvent in the Thermodynamics of Factor Xa Ligand
          Binding.</em> J Am Chem Soc 130, 2817-2831 (2008).{" "}
          <a
            href="https://doi.org/10.1021/ja0771033"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/ja0771033
          </a>
        </li>
        <li>
          Young T, Abel R, Kim B, Berne BJ, Friesner RA. <em>Motifs for
          molecular recognition exploiting hydrophobic enclosure in
          protein-ligand binding.</em> Proc Natl Acad Sci USA 104, 808-813
          (2007).{" "}
          <a
            href="https://doi.org/10.1073/pnas.0610202104"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1073/pnas.0610202104
          </a>
        </li>
        <li>
          Forli S, Olson AJ. <em>A force field with discrete displaceable
          waters and desolvation entropy for hydrated ligand docking.</em>
          {" "}J Med Chem 55, 623-638 (2012).{" "}
          <a
            href="https://doi.org/10.1021/jm2005145"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/jm2005145
          </a>
        </li>
      </ul>
    </>
  );
}
