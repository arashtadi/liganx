/**
 * Post: BTK T474I and L528W — how CLL escapes pirtobrutinib
 *
 * SEO target: "BTK T474I resistance", "pirtobrutinib resistance mutations",
 * "L528W BTK", "non-covalent BTK inhibitor resistance CLL". Internal CTA
 * into /studio with BTK + T474I pre-loaded so the reader can dock
 * pirtobrutinib and the covalent inhibitors against the gatekeeper mutant.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../../types";

export const meta: PostMeta = {
  slug: "btk-t474i-l528w-pirtobrutinib-resistance",
  title: "BTK T474I and L528W: how CLL escapes pirtobrutinib",
  description:
    "Pirtobrutinib was built to sidestep C481S, but the gatekeeper T474I and kinase-dead L528W mutations open a new escape route. Here is what drives them and why they cross-resist covalent BTK inhibitors.",
  date: "2026-07-07",
  author: "Liganx team",
  tags: ["btk", "resistance", "cll", "oncology", "mutation"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Pirtobrutinib (Jaypirca) was the field&rsquo;s answer to the C481S
        problem: a non-covalent BTK inhibitor that binds without needing the
        cysteine that ibrutinib and acalabrutinib depend on. It works, and it
        works in patients who have already burned through the covalent drugs.
        But resistance found a different door. In the patients who relapse on
        pirtobrutinib, the recurring culprits are two kinase-domain mutations
        that the covalent inhibitors never selected for: the gatekeeper
        <strong> T474I</strong> and the kinase-impaired <strong>L528W</strong>.
      </p>

      <h2>Why C481S was only half the story</h2>
      <p>
        Covalent BTK inhibitors form an irreversible bond to Cys481 in the ATP
        pocket. Mutate that cysteine to serine (C481S) and the warhead has
        nothing to anchor to, so ibrutinib and acalabrutinib drop from
        subnanomolar to weak reversible binders. C481S accounts for the large
        majority of covalent-inhibitor resistance in CLL. Pirtobrutinib was
        designed to not care about Cys481 at all: it makes a reversible,
        non-covalent contact network in the pocket, so a serine at 481 barely
        dents its potency. That is the whole reason it recovers responses in
        covalent-refractory disease.
      </p>
      <p>
        The catch is that a drug which no longer relies on one residue is
        instead exposed to every other residue that shapes the pocket. When
        Wang and colleagues sequenced CLL patients who progressed on
        pirtobrutinib in the BRUIN trial, the C481 clones actually shrank, and
        non-C481 clones grew out in their place. Mutations in BTK or its
        downstream substrate PLCG2 were found in every one of the nine
        patients with acquired genetic resistance.
      </p>

      <h2>T474I: the gatekeeper strikes back</h2>
      <p>
        Thr474 is the gatekeeper residue of BTK, the amino acid that guards the
        entrance to the hydrophobic back pocket of the ATP site. Gatekeeper
        mutations are a recurring theme across the kinase field for a reason:
        swapping the small threonine for a bulkier, more hydrophobic isoleucine
        reshapes the pocket and introduces a steric clash with inhibitors that
        reach toward the back cleft. T474I (and the related T474S/M variants)
        degrade pirtobrutinib binding while leaving BTK catalytically active
        enough to keep B-cell receptor signaling running.
      </p>
      <p>
        The clinically inconvenient part is cross-resistance. Because T474
        sits in the shared ATP pocket, a bulky substitution there can also
        blunt the covalent inhibitors, so a patient who acquires T474I on
        pirtobrutinib may have limited fallback to ibrutinib-class drugs. This
        is the opposite of the tidy sequential story people hoped for, where
        you exhaust covalent drugs, switch to non-covalent, and each mutation
        stays in its lane.
      </p>

      <h2>L528W: breaking the kinase to break the drug</h2>
      <p>
        L528W is stranger. Tryptophan is enormous compared with leucine, and
        parking it at position 528 is thought to substantially impair BTK&rsquo;s
        own kinase activity. That raises an obvious question: if the mutation
        cripples the enzyme the drug is trying to inhibit, why does it help the
        tumor survive? The leading interpretation is that BTK has a scaffolding
        role beyond its catalytic output, so a kinase-impaired but still-present
        BTK can sustain survival signaling in a way that no longer depends on a
        druggable active conformation. L528W clusters with T474 in the reports
        as a dominant non-C481 escape route on pirtobrutinib, and like T474I it
        can carry cross-resistance to some covalent agents.
      </p>

      <h2>What this means for sequencing therapy</h2>
      <ul>
        <li>
          <strong>Pirtobrutinib</strong> (Jaypirca) - non-covalent BTK
          inhibitor, FDA approved in CLL/SLL after prior BTK and BCL2 inhibitor
          therapy. Recovers responses in C481S disease; selects instead for
          T474 and L528W kinase-domain mutants at relapse.
        </li>
        <li>
          <strong>Ibrutinib / acalabrutinib / zanubrutinib</strong> - covalent
          inhibitors anchored at Cys481. Effective until C481S emerges; may
          retain little activity once T474I or L528W appears because those
          reshape the shared pocket.
        </li>
        <li>
          <strong>PLCG2 mutations</strong> - a BTK-independent escape acting
          downstream, found alongside the BTK mutations and a reminder that not
          every relapse is a re-drugging problem at BTK itself.
        </li>
      </ul>
      <p>
        The practical takeaway is that non-covalent BTK inhibition does not
        end the resistance arms race, it moves it. The next wave of interest is
        in agents that do not read the ATP pocket at all, such as BTK
        degraders, which aim to eliminate the protein regardless of whether it
        carries C481S, T474I, or L528W.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and pick BTK with the T474I gatekeeper mutation to dock pirtobrutinib
        against the reshaped back pocket, then compare it to the wild-type and
        C481S structures to see where the steric clash lands. Docking the
        covalent inhibitors against the same mutant is a quick way to build
        intuition for why cross-resistance shows up.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          Wang E, Mi X, Thompson MC, et al.{" "}
          <em>
            Mechanisms of resistance to noncovalent Bruton&apos;s tyrosine
            kinase inhibitors.
          </em>{" "}
          N Engl J Med 386, 735&ndash;743 (2022).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2114110"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2114110
          </a>
        </li>
        <li>
          Montoya S, Bourcier J, Noviski M, et al.{" "}
          <em>
            Kinase-impaired BTK mutations are susceptible to clinical-stage
            BTK and IKZF1/3 degrader NX-2127.
          </em>{" "}
          Science 383, eadi5798 (2024).{" "}
          <a
            href="https://doi.org/10.1126/science.adi5798"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1126/science.adi5798
          </a>
        </li>
        <li>
          Mato AR, Woyach JA, Brown JR, et al.{" "}
          <em>
            Pirtobrutinib after a covalent BTK inhibitor in chronic lymphocytic
            leukemia (BRUIN).
          </em>{" "}
          N Engl J Med 389, 33&ndash;44 (2023).{" "}
          <a
            href="https://doi.org/10.1056/NEJMoa2300696"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1056/NEJMoa2300696
          </a>
        </li>
      </ul>
    </>
  );
}
