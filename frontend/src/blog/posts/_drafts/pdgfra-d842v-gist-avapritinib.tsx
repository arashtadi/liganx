/**
 * Post: PDGFRA D842V GIST - why imatinib fails and avapritinib works
 *
 * SEO target: "PDGFRA D842V", "avapritinib GIST", "imatinib resistant GIST".
 * Internal link to /studio pre-loading PDGFRA with the D842V mutation so a
 * reader can see the activation-loop pocket that defines this whole story.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "pdgfra-d842v-gist-avapritinib",
  title: "PDGFRA D842V: the GIST mutation that broke imatinib",
  description:
    "Why the PDGFRA D842V activation-loop mutation is intrinsically resistant to imatinib, how avapritinib gets around it, and what resistance looks like next.",
  date: "2026-07-17",
  author: "Liganx team",
  tags: ["pdgfra", "gist", "oncology", "resistance"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Most gastrointestinal stromal tumors are driven by KIT, and most of
        those respond to imatinib. But a small slice - roughly 5 to 10% of GIST
        - are driven by PDGFRA instead, and one specific PDGFRA mutation, D842V,
        is the textbook example of a lesion that is resistant to a drug before
        the patient ever takes it. Here is why that happens, and why one drug
        finally cracked it.
      </p>

      <h2>KIT's quieter cousin</h2>
      <p>
        PDGFRA (platelet-derived growth factor receptor alpha) is a type III
        receptor tyrosine kinase, structurally close to KIT. In GIST, activating
        mutations in PDGFRA are mutually exclusive with KIT mutations: a tumor is
        driven by one or the other. PDGFRA-mutant GISTs skew toward gastric
        location and an epithelioid morphology, and the single most common PDGFRA
        alteration is a point mutation in exon 18 - the activation loop - swapping
        aspartate 842 for valine. That is D842V.
      </p>

      <h2>Why imatinib never had a chance</h2>
      <p>
        Imatinib is a type II inhibitor. It binds the kinase only in its inactive,
        DFG-out conformation, wedging into a pocket that exists when the activation
        loop is folded down and the kinase is switched off. That binding mode is
        imatinib's whole mechanism - and it is exactly what D842V destroys.
      </p>
      <p>
        Aspartate 842 sits in the activation loop. Substituting the small, rigid
        valine stabilizes the active (DFG-in) conformation and destabilizes the
        inactive state that imatinib requires. The drug's pocket effectively stops
        forming. The result is not gradual resistance that emerges under treatment
        pressure; it is primary, intrinsic resistance. The same logic sinks
        sunitinib and regorafenib, both of which also lean on the inactive
        conformation. For years, patients with D842V GIST had no active
        systemic option and a correspondingly poor prognosis.
      </p>

      <h2>Avapritinib: attack the active state instead</h2>
      <p>
        Avapritinib inverts the strategy. It is a type I inhibitor, designed to
        bind the active conformation of mutant KIT and PDGFRA - precisely the
        state that D842V locks the kinase into. Rather than fighting the mutation's
        conformational bias, avapritinib exploits it. In biochemical assays its
        potency against D842V is on the order of 3,000-fold greater than imatinib's.
      </p>
      <p>
        The clinical readout matched the biochemistry. In the phase 1 NAVIGATOR
        trial, avapritinib produced an objective response rate around 88 to 91% in
        the PDGFRA D842V population, with a meaningful fraction of complete
        responses - numbers rarely seen with a targeted agent in a heavily
        resistant setting.
      </p>
      <ul>
        <li>
          <strong>Avapritinib (BLU-285, Ayvakit)</strong> - Blueprint Medicines.
          FDA approved January 2020 for unresectable or metastatic GIST harboring a
          PDGFRA exon 18 mutation, including D842V, at 300 mg once daily. It was the
          first therapy specifically active against this mutation.
        </li>
      </ul>

      <h2>Resistance, take two</h2>
      <p>
        Turning off the primary driver just moves the problem. In patients who
        progress on avapritinib, resistance is typically driven by new secondary
        mutations elsewhere in the PDGFRA kinase domain - in exons 13, 14, and 15 -
        that interfere with drug binding while the D842V driver persists. Recurrent
        substitutions include V658A, N659K, Y676C, and G680R. These sit in the
        ATP-binding pocket and neighboring regions, the classic escape route for a
        type I inhibitor that depends on occupying the active-site cleft. Covering
        both the activation-loop driver and these second-site pocket mutations is
        the open medicinal-chemistry problem in PDGFRA GIST.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The entire D842V story is conformational, which makes it a good one to see
        in three dimensions.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick PDGFRA with the D842V mutation to dock against the active-state
        structure - then compare how a type I binder settles into the pocket versus
        where imatinib's inactive-state pocket would have been.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Heinrich MC, et al. <em>Avapritinib in advanced PDGFRA D842V-mutant
          gastrointestinal stromal tumour (NAVIGATOR): a multicentre, open-label,
          phase 1 trial.</em> Lancet Oncol 21, 935&ndash;946 (2020).{" "}
          <a
            href="https://doi.org/10.1016/S1470-2045(20)30269-2"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1016/S1470-2045(20)30269-2
          </a>
        </li>
        <li>
          Grunewald S, et al. <em>Resistance to Avapritinib in PDGFRA-Driven GIST
          Is Caused by Secondary Mutations in the PDGFRA Kinase Domain.</em> Cancer
          Discov 11, 108&ndash;125 (2021).{" "}
          <a
            href="https://doi.org/10.1158/2159-8290.CD-20-0487"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1158/2159-8290.CD-20-0487
          </a>
        </li>
        <li>
          U.S. Food and Drug Administration. <em>FDA approves avapritinib for
          gastrointestinal stromal tumor with a rare mutation</em> (January 2020).{" "}
          <a
            href="https://www.fda.gov/drugs/resources-information-approved-drugs/fda-approves-avapritinib-gastrointestinal-stromal-tumor-rare-mutation"
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
