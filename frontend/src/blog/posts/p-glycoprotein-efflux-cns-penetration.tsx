/**
 * Post: P-glycoprotein (ABCB1) efflux - why drugs bounce off the brain
 *
 * SEO target: "P-glycoprotein efflux", "ABCB1 brain penetration", "P-gp
 * substrate CNS", "efflux ratio drug discovery". ADMET-theme post. Internal
 * CTA into /studio's ADMET panel. Cross-links to the BBB post.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "p-glycoprotein-efflux-cns-penetration",
  title: "P-glycoprotein: the pump that keeps drugs out of the brain",
  description:
    "P-gp efflux is why a potent, brain-targeted kinase inhibitor can still fail in CNS metastases. Here is what the transporter does, how the efflux ratio is measured, and which oncology drugs it blocks.",
  date: "2026-05-31",
  author: "Liganx team",
  tags: ["admet", "p-glycoprotein", "efflux", "blood-brain-barrier", "drug-design"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        You can design a molecule that hits its target at picomolar potency,
        crosses membranes beautifully, and still watch it fail completely in
        brain metastases. The usual culprit is not the target and not
        permeability &mdash; it is a molecular bouncer called{" "}
        <strong>P-glycoprotein</strong>. P-gp sits in the blood-brain barrier
        and pumps drugs back out into the blood faster than they can diffuse in.
        For oncology programs chasing CNS disease, it is one of the most
        underappreciated reasons a good compound never reaches the tumor.
      </p>

      <h2>What P-glycoprotein is</h2>
      <p>
        P-glycoprotein (gene <strong>ABCB1</strong>, also called MDR1) is an
        ATP-driven efflux transporter in the ABC family. It threads its
        substrate out of the cell membrane and hydrolyzes ATP to power the
        stroke, working like a one-way pump. It is expressed on the luminal
        (blood-facing) side of brain capillary endothelial cells, in the gut
        epithelium, and in the kidney and liver. In the brain, P-gp and its
        partner transporter <strong>BCRP</strong> (ABCG2) form the active half
        of the blood-brain barrier: even a lipophilic molecule that should
        diffuse across will be grabbed and ejected before it accumulates.
      </p>
      <p>
        P-gp is also gloriously promiscuous. Its binding cavity is large and
        flexible, and it recognizes a broad swath of mid-sized, moderately
        lipophilic, often hydrogen-bond-rich molecules &mdash; which describes a
        large fraction of kinase inhibitors.
      </p>

      <h2>The efflux ratio, and what counts as a problem</h2>
      <p>
        The standard readout is the <strong>efflux ratio</strong> from a
        bidirectional permeability assay across a polarized monolayer (Caco-2 or
        MDCK-MDR1 cells). You measure apparent permeability in both directions
        and divide:
      </p>
      <ul>
        <li>
          <strong>Efflux ratio = Papp(B&rarr;A) / Papp(A&rarr;B)</strong>. A
          ratio near 1 means the compound moves equally both ways &mdash; not a
          substrate. A ratio above ~2 flags active efflux; above ~3 is a real
          liability for CNS targets.
        </li>
        <li>
          <strong>Confirm with an inhibitor.</strong> Repeat the assay with a
          P-gp inhibitor (elacridar, zosuquidar) added. If the efflux ratio
          collapses toward 1, P-gp was responsible. If it does not, suspect BCRP
          or another transporter.
        </li>
        <li>
          <strong>Read it against the target.</strong> For a peripheral tumor a
          high efflux ratio may not matter, and gut P-gp can even be saturated
          at clinical dose. For a brain target it is often decisive, because the
          barrier transporters are hard to saturate.
        </li>
      </ul>

      <h2>Oncology drugs that P-gp shuts out of the brain</h2>
      <ul>
        <li>
          <strong>Ibrutinib</strong> &mdash; ABCB1 markedly restricts its brain
          penetration; transporter-deficient mice show roughly 5-fold higher
          brain-to-plasma ratios, while CYP3A separately caps its oral exposure.
        </li>
        <li>
          <strong>Vemurafenib</strong> &mdash; the BRAF V600E inhibitor is a
          substrate of both P-gp and BCRP, with brain-to-plasma ratios about
          20-fold higher in mice lacking both pumps, and the efflux can be
          reversed with elacridar.
        </li>
        <li>
          <strong>Palbociclib</strong> &mdash; the CDK4/6 inhibitor is a dual
          P-gp/BCRP substrate; brain exposure rises roughly 100-fold in
          transporter-knockout models, which is why it underperforms against
          intracranial tumors despite strong systemic activity.
        </li>
      </ul>
      <p>
        The contrast that makes the point is osimertinib, which was
        deliberately optimized for low efflux and consequently delivers real
        intracranial activity. Low P-gp liability is not a footnote &mdash; for a
        CNS-directed program it can be the whole ballgame.
      </p>

      <h2>How you fix it (and why it is hard)</h2>
      <p>
        Designing out P-gp efflux usually means reducing the count of
        hydrogen-bond donors and acceptors and trimming topological polar
        surface area, since P-gp recognition tracks with H-bonding capacity. The
        tension is that those same features often drive solubility and potency,
        so efflux optimization is a balancing act rather than a clean win.
        Co-dosing a P-gp inhibitor works in mice but has repeatedly disappointed
        in the clinic, because you cannot selectively unlock the brain barrier
        without also raising systemic and gut exposure.
      </p>

      <h2>Try the prediction yourself</h2>
      <p>
        Liganx&rsquo;s ADMET panel scores P-glycoprotein substrate likelihood
        alongside permeability, BBB penetration, and the other transport
        properties, so you can spot an efflux liability before committing
        synthesis. Read it together with the{" "}
        <Link
          to="/blog/blood-brain-barrier-cns-penetration-kinase-inhibitors"
          className="text-cyan-600 dark:text-cyan-400 underline"
        >
          blood-brain barrier penetration
        </Link>{" "}
        call: a compound that looks permeable but flags as a P-gp substrate is
        the classic CNS trap.
      </p>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and dock a candidate, then open the ADMET pill on the result row to see
        the transport profile. Liganx brings molecular docking online into the
        browser and runs the ADMET panel on every pose, so you can pair the
        molecular docking score with the efflux readout and catch a brain-barrier
        problem before it costs you a campaign.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          <em>P-Glycoprotein (MDR1/ABCB1) restricts brain penetration of the
          Bruton&rsquo;s tyrosine kinase inhibitor ibrutinib, while CYP3A limits
          its oral bioavailability.</em> Mol Pharm 15, 5103&ndash;5113 (2018).{" "}
          <a
            href="https://doi.org/10.1021/acs.molpharmaceut.8b00702"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/acs.molpharmaceut.8b00702
          </a>
        </li>
        <li>
          Durmus S, Sparidans RW, Wagenaar E, et al. <em>Oral availability and
          brain penetration of the BRAF-V600E inhibitor vemurafenib can be
          enhanced by the P-glycoprotein (ABCB1) and breast cancer resistance
          protein (ABCG2) inhibitor elacridar.</em> Mol Pharm 9, 3236&ndash;3245
          (2012).{" "}
          <a
            href="https://pubmed.ncbi.nlm.nih.gov/23020847/"
            target="_blank"
            rel="noreferrer noopener"
          >
            PMID:23020847
          </a>
        </li>
        <li>
          Parrish KE, Pokorny J, Mittapalli RK, et al. <em>Efflux transporters
          at the blood-brain barrier limit delivery and efficacy of the CDK4/6
          inhibitor palbociclib (PD-0332991) in an orthotopic brain tumor
          model.</em> J Pharmacol Exp Ther 355, 264&ndash;271 (2015).{" "}
          <a
            href="https://pmc.ncbi.nlm.nih.gov/articles/PMC4613960/"
            target="_blank"
            rel="noreferrer noopener"
          >
            PMC4613960
          </a>
        </li>
      </ul>
    </>
  );
}
