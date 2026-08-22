/**
 * Post: BCRP / ABCG2 — the other efflux pump that eats your oral exposure
 *
 * SEO target: "BCRP ABCG2 efflux", "BCRP substrate drug interaction",
 * "rosuvastatin BCRP", "ABCG2 Q141K pharmacogenomics". Internal CTA into
 * /studio's ADMET panel which flags BCRP-substrate liabilities alongside P-gp.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "bcrp-abcg2-efflux-oral-absorption-ddi",
  title: "BCRP/ABCG2: the other efflux pump eating your oral exposure",
  description:
    "P-glycoprotein gets the attention, but BCRP restricts intestinal absorption and biliary clearance of a wide chemical range. Here is why it matters for oral exposure, DDIs, and a common reduced-function allele.",
  date: "2026-07-07",
  author: "Liganx team",
  tags: ["admet", "bcrp", "efflux", "drug-interactions", "pharmacokinetics"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Everyone in a discovery program learns to watch P-glycoprotein.
        Fewer teams give the same attention to BCRP, the breast cancer
        resistance protein encoded by <em>ABCG2</em>, even though it sits in the
        same gut, liver, and blood-brain barrier tissues and pumps a broad,
        overlapping set of substrates back out. If your oral exposure is lower
        than the intrinsic permeability and solubility would predict, or your
        clinical AUC jumps when you co-dose with the wrong drug, BCRP is a prime
        suspect.
      </p>

      <h2>What BCRP does</h2>
      <p>
        BCRP is an ATP-binding cassette transporter that uses ATP hydrolysis to
        efflux drugs and xenobiotics out of cells against their concentration
        gradient. It is expressed on the apical membrane of the intestinal
        epithelium, the canalicular membrane of hepatocytes, the renal proximal
        tubule, and the luminal side of brain endothelial cells. Functionally
        it is a half-transporter that homodimerizes to make a working pump,
        which is part of why a single destabilizing mutation can knock down so
        much of its activity.
      </p>
      <p>
        The consequences map directly onto ADME. In the gut, apical BCRP shovels
        absorbed drug back into the lumen and caps oral bioavailability. In the
        liver and kidney it drives biliary and urinary elimination. At the
        blood-brain barrier it teams up with P-gp to keep substrates out of the
        CNS, which is a headache for brain-penetrant oncology programs and a
        safety feature everywhere else.
      </p>

      <h2>The rosuvastatin case study</h2>
      <p>
        Rosuvastatin is the canonical clinical BCRP substrate, and its intestinal
        absorption is genuinely restricted by the pump. That makes it a probe:
        give a BCRP inhibitor and rosuvastatin exposure climbs. Elsby and
        colleagues showed that solitary inhibition of intestinal BCRP is enough
        to roughly double rosuvastatin exposure, a swing large enough to warrant
        a statin dose adjustment. Fostamatinib, for instance, raised rosuvastatin
        AUC about 1.96-fold and Cmax about 1.88-fold, driven by BCRP inhibition
        rather than any change in metabolism.
      </p>
      <p>
        That is the general shape of a BCRP DDI: it is a transport effect, not a
        CYP effect, so it hits absorption and elimination while leaving the
        metabolic profile untouched. Regulators expect BCRP substrate and
        inhibitor assessment during development for exactly this reason, and
        rosuvastatin and sulfasalazine have become the go-to clinical index
        substrates.
      </p>

      <h2>The Q141K allele nobody warned you about</h2>
      <p>
        BCRP carries a common coding polymorphism, <strong>c.421C&gt;A
        (rs2231142, p.Q141K)</strong>, that destabilizes the nucleotide-binding
        domain and roughly halves functional protein levels. It is not rare; the
        A allele is carried by hundreds of millions of people, with especially
        high frequency in East Asian populations. Reduced BCRP function means
        less efflux, so substrate drugs accumulate: a meta-analysis found A-allele
        carriers had roughly 1.5-fold higher rosuvastatin AUC. The same variant
        is a major genetic driver of hyperuricemia and gout, because BCRP also
        exports urate. For a drug that is a BCRP substrate with a narrow window,
        this is a real source of interpatient variability that a mean PK profile
        will hide.
      </p>

      <h2>Designing around it</h2>
      <ul>
        <li>
          <strong>Flag it early.</strong> Treat a strong BCRP-substrate
          prediction like a P-gp flag: it is a candidate explanation for low or
          variable oral exposure and for weak CNS penetration.
        </li>
        <li>
          <strong>Separate transport from metabolism.</strong> A clinical AUC
          increase with no change in half-life or metabolite ratios points at a
          transporter, and BCRP is high on that list next to OATP and P-gp.
        </li>
        <li>
          <strong>Mind the co-medications.</strong> BCRP inhibitors among
          marketed drugs are more common than people assume, so a real-world
          patient stack can shift a substrate&rsquo;s exposure even when the
          clean-room PK looked fine.
        </li>
      </ul>

      <h2>Try it in Studio</h2>
      <p>
        The ADMET panel in{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Studio
        </Link>{" "}
        scores efflux-transporter liabilities alongside the binding pose, so you
        can see a BCRP-substrate flag next to the P-gp call for the same
        molecule. Dock your candidate, then read the transporter predictions to
        decide whether a disappointing exposure projection is a permeability
        problem or an efflux problem.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Elsby R, Martin P, Surry D, et al.{" "}
          <em>
            Solitary inhibition of the breast cancer resistance protein efflux
            transporter results in a clinically significant drug-drug
            interaction with rosuvastatin by causing up to a 2-fold increase in
            statin exposure.
          </em>{" "}
          Drug Metab Dispos 44, 398&ndash;408 (2016).{" "}
          <a
            href="https://doi.org/10.1124/dmd.115.066795"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1124/dmd.115.066795
          </a>
        </li>
        <li>
          Heyes N, Kapoor P, Kerr ID.{" "}
          <em>
            Polymorphisms of the multidrug pump ABCG2: a systematic review of
            their effect on protein expression, function, and drug
            pharmacokinetics.
          </em>{" "}
          Drug Metab Dispos 46, 1886&ndash;1899 (2018).{" "}
          <a
            href="https://doi.org/10.1124/dmd.118.083030"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1124/dmd.118.083030
          </a>
        </li>
        <li>
          Mao Q, Unadkat JD.{" "}
          <em>
            Role of the breast cancer resistance protein (BCRP/ABCG2) in drug
            transport - an update.
          </em>{" "}
          AAPS J 17, 65&ndash;82 (2015).{" "}
          <a
            href="https://doi.org/10.1208/s12248-014-9668-6"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1208/s12248-014-9668-6
          </a>
        </li>
      </ul>
    </>
  );
}
