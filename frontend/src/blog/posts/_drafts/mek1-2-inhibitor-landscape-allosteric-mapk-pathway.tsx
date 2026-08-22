/**
 * Post: MEK1/2 inhibitors — the allosteric backbone of MAPK-pathway therapy
 *
 * SEO target: "MEK inhibitor list", "trametinib mechanism", "MEK inhibitor
 * resistance", "BRAF MEK combination therapy". MEK1/2 is not a dockable
 * target in the Liganx catalog, so the CTA is honest about that and routes
 * to BRAF V600E instead — the partner kinase in every approved MEK-inhibitor
 * combination regimen.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "mek1-2-inhibitor-landscape-allosteric-mapk-pathway",
  title: "MEK1/2 inhibitors: the allosteric backbone of MAPK therapy",
  description:
    "Five approved MEK inhibitors, one shared allosteric pocket, and a resistance story that explains why none of them are ever used alone.",
  date: "2026-08-13",
  author: "Liganx team",
  tags: ["mek", "mapk-pathway", "combination-therapy", "melanoma"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Every approved MEK1/2 inhibitor shares two things: an allosteric
        binding site well outside the ATP pocket, and a package insert that
        pairs it with something else. Trametinib doesn&rsquo;t ship alone
        anymore; neither does cobimetinib or binimetinib. Understanding why
        MEK inhibition only really works in combination is the single most
        useful thing to know about this drug class, and it comes straight
        out of how the MAPK pathway reacts to being cut at this particular
        node.
      </p>

      <h2>A different pocket, a different logic</h2>
      <p>
        MEK1 and MEK2 sit directly downstream of RAF and directly upstream of
        ERK in the RAS-RAF-MEK-ERK cascade. Unlike most kinase drugs on this
        blog, MEK inhibitors are not ATP-competitive. They bind an allosteric
        pocket adjacent to the ATP site and lock MEK in its catalytically
        inactive conformation — a mechanism first worked out for
        trametinib and shared, with variation, across the whole class. That
        allosteric mode is part of why these drugs are so selective for
        MEK1/2 over the rest of the kinome: the pocket is shaped by residues
        that are not conserved the way the ATP site is.
      </p>

      <h2>Five approved compounds</h2>
      <ul>
        <li>
          <strong>Trametinib (Mekinist)</strong> — Novartis, FDA
          approved May 2013 as the first MEK inhibitor, initially as
          monotherapy for BRAF V600E/K metastatic melanoma. Flaherty et al.
          (2012) showed a survival benefit over chemotherapy, but
          monotherapy activity faded fast as resistance set in. Now almost
          always dosed with dabrafenib.
        </li>
        <li>
          <strong>Cobimetinib (Cotellic)</strong> — Genentech/Exelixis,
          approved November 2015, always paired with vemurafenib for BRAF
          V600E/K melanoma (coBRIM trial).
        </li>
        <li>
          <strong>Binimetinib (Mektovi)</strong> — Array/Pfizer,
          approved June 2018, paired with encorafenib for BRAF V600E/K
          melanoma (COLUMBUS trial) and later extended to encorafenib
          combinations in BRAF-mutant colorectal and NSCLC.
        </li>
        <li>
          <strong>Selumetinib (Koselugo)</strong> — AstraZeneca/Merck,
          approved April 2020, the first MEK inhibitor cleared for
          neurofibromatosis type 1 (NF1) with inoperable plexiform
          neurofibromas in pediatric patients, based on the SPRINT trial.
          Notably used as monotherapy — NF1-PN is driven by loss of
          neurofibromin, a direct RAS-GAP, so the tumor is MAPK-addicted
          without a BRAF mutation to co-target.
        </li>
        <li>
          <strong>Mirdametinib (Gomekli)</strong> — SpringWorks, FDA
          approved February 11, 2025, for adult <em>and</em> pediatric NF1-PN.
          The pivotal ReNeu trial (Moertel et al., 2024) reported confirmed
          objective response rates of 41% in adults and 52% in children, with
          durable tumor volume reduction in both groups.
        </li>
      </ul>

      <h2>Why MEK inhibitors travel in pairs</h2>
      <p>
        The melanoma and colorectal indications all use MEK inhibitors on
        top of a RAF inhibitor, and the reason is feedback wiring, not
        marketing. RAF inhibition alone relieves a physiological brake:
        ERK normally feeds back to suppress RAF and RAS activity, so
        blocking RAF paradoxically de-represses upstream signaling and can
        drive RAF dimerization that reactivates the pathway around the drug.
        Adding a MEK inhibitor blocks the pathway one node downstream of
        that reactivation, closing the loophole. The net effect in
        BRAF-mutant melanoma is longer progression-free survival and fewer
        cutaneous squamous-cell carcinomas — a paradoxical-activation
        toxicity of RAF-inhibitor monotherapy that the MEK inhibitor largely
        suppresses. NF1-PN is the exception that proves the rule: there is
        no RAF mutation to pair against, so MEK monotherapy is the
        correct architecture from the start.
      </p>

      <h2>How resistance shows up</h2>
      <p>
        MEK inhibitor resistance converges on one outcome — restoring
        ERK activity — through several distinct routes:
      </p>
      <ul>
        <li>
          <strong>RAF or RAS reactivation</strong> — acquired NRAS or
          KRAS mutations, CRAF amplification, or COT/MAP3K8 amplification
          all re-drive the pathway from a point upstream of the inhibited
          node.
        </li>
        <li>
          <strong>RAF dimerization</strong> — back-to-back RAF/RAF or
          face-to-face RAF/MEK dimers can transmit signal even with MEK
          partially inhibited, a structural workaround rather than a
          mutation.
        </li>
        <li>
          <strong>Oncogene amplification and ERK &ldquo;addiction&rdquo;</strong>
          — Little et al. (2011) showed that BRAF- or KRAS-amplified
          resistant clones become dependent on the inhibitor to keep ERK
          activity inside a narrow tolerable window; withdrawing the drug
          overshoots ERK activation and triggers senescence or death in
          those same cells. It is a rare example of a resistance mechanism
          that also exposes a targetable vulnerability.
        </li>
        <li>
          <strong>Bypass signaling</strong> — increased PI3K/AKT
          signaling, STAT3 activation, or ERBB3 induction can sustain
          proliferation around a fully blocked MAPK pathway.
        </li>
      </ul>

      <h2>Try the docking yourself</h2>
      <p>
        MEK1/2 isn&rsquo;t a dockable target in the Liganx catalog yet
        — the allosteric pocket and induced-fit conformational change
        make it a harder structure-based target than most kinase ATP
        sites. But the kinase that MEK inhibitors are paired with in every
        approved melanoma regimen, BRAF, is. <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick BRAF with the V600E mutation to dock against the same
        target the paradoxical-activation problem above is describing, and
        see how differently the DFG-out pocket scores wild-type versus
        mutant BRAF.
      </p>
      <p>
        Liganx is molecular docking online: free, browser-based, and set up
        for exactly this kind of mutation question. If you want to try
        molecular docking on BRAF V600E without a local install, that is the
        fastest path.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Flaherty KT, et al. <em>Improved survival with MEK inhibition in
          BRAF-mutated melanoma.</em> N Engl J Med 367, 107–114 (2012).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa1203421"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa1203421
          </a>
        </li>
        <li>
          Little AS, et al. <em>Amplification of the driving oncogene, KRAS
          or BRAF, underpins acquired resistance to MEK1/2 inhibitors in
          colorectal cancer cells.</em> Sci Signal 4, ra17 (2011).{" "}
          <a
            href="https://doi.org/10.1126/scisignal.2001752"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1126/scisignal.2001752
          </a>
        </li>
        <li>
          Moertel CL, et al. <em>ReNeu: A Pivotal Phase IIb Trial of
          Mirdametinib in Adults and Children With Symptomatic
          Neurofibromatosis Type 1-Associated Plexiform Neurofibroma.</em>{" "}
          J Clin Oncol (2024).{" "}
          <a
            href="https://doi.org/10.1200/JCO.24.01034"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1200/JCO.24.01034
          </a>
        </li>
      </ul>
    </>
  );
}
