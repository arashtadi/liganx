/**
 * Post: Aqueous solubility — the property that quietly kills oral programs
 *
 * SEO target: "aqueous solubility drug discovery", "kinetic vs thermodynamic
 * solubility", "BCS classification", "logS prediction". Internal CTA into
 * /studio's ADMET panel.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "aqueous-solubility-drug-discovery",
  title: "Aqueous solubility: the property that quietly kills oral programs",
  description:
    "Kinetic vs thermodynamic solubility, the BCS map, and why a beautiful nanomolar binder can still fail because it will not dissolve. A practical explainer.",
  date: "2026-05-26",
  author: "Liganx team",
  tags: ["admet", "solubility", "bcs", "oral-bioavailability", "drug-design"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        A drug that does not dissolve cannot be absorbed, and a drug that is
        not absorbed cannot work. Aqueous solubility is the least glamorous
        number in a candidate&rsquo;s profile and one of the most common
        reasons an otherwise excellent oral molecule stalls in development.
        Potency gets the attention; solubility gets the program cancelled.
      </p>

      <h2>Two numbers that are both called &ldquo;solubility&rdquo;</h2>
      <p>
        Be precise about which solubility you mean, because the two values can
        differ by orders of magnitude.
      </p>
      <ul>
        <li>
          <strong>Kinetic solubility</strong> is measured by diluting a
          concentrated DMSO stock into aqueous buffer and watching for
          precipitation. It is fast, cheap, and runs in high throughput during
          early screening &mdash; but it overestimates real solubility because
          the compound never reaches its stable crystalline form.
        </li>
        <li>
          <strong>Thermodynamic solubility</strong> is measured by equilibrating
          solid crystalline material in buffer to saturation. It is the value
          that actually governs dissolution in the gut. It is slower and needs
          real solid material, so it arrives later in a program &mdash; often
          after chemists have already fallen in love with a kinetically
          &ldquo;soluble&rdquo; compound.
        </li>
      </ul>

      <h2>The BCS map</h2>
      <p>
        The Biopharmaceutics Classification System places every oral drug on a
        two-by-two grid of solubility against intestinal permeability:
      </p>
      <ul>
        <li><strong>Class I</strong> &mdash; high solubility, high permeability. The easy case.</li>
        <li><strong>Class II</strong> &mdash; low solubility, high permeability. Absorption is dissolution-rate-limited; this is where formulation tricks earn their keep.</li>
        <li><strong>Class III</strong> &mdash; high solubility, low permeability. Dissolves fine, struggles to cross the membrane.</li>
        <li><strong>Class IV</strong> &mdash; low solubility, low permeability. The danger zone, and where a surprising number of potent kinase inhibitors land.</li>
      </ul>
      <p>
        Butler and Dressman later refined this into the Developability
        Classification System, which focuses on solubility in the volume of
        fluid actually available in the small intestine and on the way
        solubility and permeability can compensate for each other. The
        practical message of both frameworks is the same: solubility only
        matters in the context of dose and permeability, not as an abstract
        number.
      </p>

      <h2>Why molecules refuse to dissolve</h2>
      <p>
        Poor solubility usually comes from one of two opposite causes, and the
        fix is different for each:
      </p>
      <ul>
        <li>
          <strong>&ldquo;Brick dust&rdquo;</strong> &mdash; a tightly packed,
          high-melting crystal lattice. The molecule is not especially greasy;
          it simply will not let go of its neighbors. Disrupting planarity,
          adding a twist or a flexible substituent, lowers the melting point
          and improves solubility.
        </li>
        <li>
          <strong>&ldquo;Grease ball&rdquo;</strong> &mdash; high lipophilicity
          (logP). The molecule would rather sit in lipid than in water.
          Trimming logP, adding a polar or ionizable group, is the lever here.
        </li>
      </ul>
      <p>
        This is the tension behind Lipinski&rsquo;s Rule of Five, whose original
        paper was literally titled around estimating solubility and
        permeability. The familiar cutoffs (molecular weight under 500, logP
        under 5, no more than five hydrogen-bond donors and ten acceptors) are
        not laws of physics &mdash; they are a statistical fence around the
        region where oral absorption tends to be tractable.
      </p>

      <h2>Predicting it in silico</h2>
      <p>
        Solubility (usually reported as logS, the log of molar solubility) is
        one of the more reliably predictable ADMET endpoints because there is
        a lot of public data. Delaney&rsquo;s ESOL model showed years ago that a
        handful of simple descriptors gets you a usable estimate; modern graph
        neural networks trained on curated datasets do better. The honest
        caveat is the same as for every QSAR model: predictions degrade for
        chemistry outside the training distribution, so treat a computed logS
        as a triage signal, not a measurement.
      </p>

      <h2>Try the prediction yourself</h2>
      <p>
        Liganx&rsquo;s ADMET panel runs an admet-ai model ensemble on every
        compound after a successful dock, and aqueous solubility is one of the
        properties it returns alongside the cardiac and liver readouts.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>
        , dock a candidate, then open the ADMET pill on the result row to read
        its predicted solubility next to potency. Liganx brings
        molecular docking online into the browser, so running molecular
        docking and the solubility forecast in the same place lets you catch a
        brick-dust problem before you commit to the synthesis.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Lipinski CA, Lombardo F, Dominy BW, Feeney PJ. <em>Experimental and
          computational approaches to estimate solubility and permeability in
          drug discovery and development settings.</em> Adv Drug Deliv Rev 46,
          3-26 (2001).{" "}
          <a
            href="https://doi.org/10.1016/S0169-409X(00)00129-0"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/S0169-409X(00)00129-0
          </a>
        </li>
        <li>
          Butler JM, Dressman JB. <em>The developability classification system:
          application of biopharmaceutics concepts to formulation
          development.</em> J Pharm Sci 99, 4940-4954 (2010).{" "}
          <a
            href="https://doi.org/10.1002/jps.22217"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1002/jps.22217
          </a>
        </li>
        <li>
          Delaney JS. <em>ESOL: estimating aqueous solubility directly from
          molecular structure.</em> J Chem Inf Comput Sci 44, 1000-1005 (2004).{" "}
          <a
            href="https://doi.org/10.1021/ci034243x"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/ci034243x
          </a>
        </li>
      </ul>
    </>
  );
}
