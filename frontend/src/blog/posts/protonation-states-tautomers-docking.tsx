/**
 * Post: Protonation states and tautomers in docking
 *
 * Methodology theme. Ligand preparation is the silent variable that decides
 * whether a docking run is meaningful. Covers pKa, microspecies, tautomers,
 * and why enumerating states matters. Internal CTA to /studio.
 */

import { Link } from "react-router-dom";
import type { PostMeta } from "../types";

export const meta: PostMeta = {
  slug: "protonation-states-tautomers-docking",
  title: "The state you dock matters: protonation and tautomers",
  description:
    "Docking the wrong protonation state or tautomer quietly wrecks your scores. Here is what pKa, microspecies, and ligand prep actually do to a docking run.",
  date: "2026-06-07",
  author: "Liganx team",
  tags: ["methodology", "ligand-preparation", "docking", "pka"],
  readingMin: 6,
};

export default function Post() {
  return (
    <>
      <p className="lead">
        Most docking failures are blamed on the scoring function. A surprising
        number are actually ligand-preparation failures: you docked a molecule
        in a protonation state or tautomer that does not exist at
        physiological pH, and no scoring function can rescue a chemically wrong
        input. The SMILES you drew is not the species that sits in the pocket.
        Getting from one to the other is the quiet, decisive step that happens
        before any pose is ever scored.
      </p>

      <h2>Why the drawn structure is not the docked structure</h2>
      <p>
        A SMILES string encodes one fixed arrangement of atoms, bonds, and
        formal charges. In water at pH 7.4, a real drug-like molecule is an
        equilibrium mixture of microspecies: protonated and deprotonated forms
        of every ionizable group, plus tautomers that shuttle a hydrogen and a
        double bond between two positions. A basic amine is mostly protonated
        and positively charged. A carboxylic acid is mostly deprotonated and
        negative. An imidazole or a 2-hydroxypyridine flips between tautomers
        that present hydrogen-bond donors and acceptors in completely
        different places. Each of these changes the molecule's net charge,
        its hydrogen-bonding pattern, and therefore the interactions a docking
        engine can score.
      </p>

      <h2>How much does it actually change the result?</h2>
      <p>
        A lot. Brink and Exner's systematic study fed different protonation,
        tautomeric, and stereoisomeric states of the same ligands into GOLD
        and PLANTS and found that both programs frequently failed to identify
        the correct protomer for a given complex, and that the chosen state
        materially changed both the predicted pose and the score. The
        practical lessons:
      </p>
      <ul>
        <li>
          <strong>Charge drives placement.</strong> Flip an amine from neutral
          to protonated and you add a salt-bridge or strong hydrogen bond that
          can reorient the entire pose toward an acidic residue. Dock the
          neutral form by accident and you miss the interaction the molecule
          actually makes.
        </li>
        <li>
          <strong>Tautomers move the donors and acceptors.</strong> The same
          heteroaromatic ring can read as a donor in one tautomer and an
          acceptor in another at the same atom. Pick the wrong one and the
          hinge hydrogen bond that defines a kinase inhibitor's binding mode
          simply will not form.
        </li>
        <li>
          <strong>The lowest-energy state in water is not always the bound
          state.</strong> The pocket can stabilize a minor microspecies. This
          is why best practice is to enumerate and dock an ensemble of
          highly-populated states rather than committing to a single one.
        </li>
      </ul>

      <h2>What ligand-preparation tools do</h2>
      <p>
        The job of a preparation step is to turn one drawn structure into the
        set of physically relevant 3D species. pKa predictors such as Epik
        extend the classic Hammett and Taft schemes to estimate micro-pKa
        values, enumerate the protonation states populated at a target pH,
        rank them by energy, and attach a penalty to states that are
        unfavorable under physiological conditions. Tautomer enumerators do
        the analogous job for hydrogen/double-bond shifts. The output is not a
        single molecule but a small ensemble, each member tagged with how
        likely it is to exist. You dock the ensemble and let the scoring
        compare like-for-like.
      </p>

      <h2>A practical default</h2>
      <p>
        For a routine run: generate states at pH 7.4, keep every microspecies
        above a few percent population, and dock them all. If two protonation
        states score within noise of each other, report both rather than
        pretending the cleaner number is the truth. The discipline matters
        most when you are comparing a congeneric series, because a silent
        inconsistency in how two analogs were protonated will masquerade as a
        real potency difference.
      </p>

      <h2>Try the docking yourself</h2>
      <p>
        The fastest way to build intuition is to dock two protonation states
        of the same ligand and watch the pose and score move.{" "}
        <Link to="/studio" className="text-cyan-600 dark:text-cyan-400 underline">
          Open Studio
        </Link>{" "}
        and run molecular docking on a basic-amine ligand against a target with
        an acidic residue in the pocket, then compare the neutral and
        protonated forms side by side. Liganx is molecular docking online,
        free and browser-based, so you can test how sensitive your result is to
        ligand preparation before you trust a single number.
      </p>

      <h2>Primary sources</h2>
      <ul>
        <li>
          ten Brink T, Exner TE. <em>Influence of Protonation, Tautomeric, and
          Stereoisomeric States on Protein-Ligand Docking Results.</em> J Chem
          Inf Model 49, 1535-1546 (2009).{" "}
          <a
            href="https://doi.org/10.1021/ci800420z"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1021/ci800420z
          </a>
        </li>
        <li>
          ten Brink T, Exner TE. <em>pKa based protonation states and
          microspecies for protein-ligand docking.</em> J Comput Aided Mol Des
          24, 935-942 (2010).{" "}
          <a
            href="https://doi.org/10.1007/s10822-010-9385-x"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1007/s10822-010-9385-x
          </a>
        </li>
        <li>
          Shelley JC, et al. <em>Epik: a software program for pKa prediction
          and protonation state generation for drug-like molecules.</em> J
          Comput Aided Mol Des 21, 681-691 (2007).{" "}
          <a
            href="https://doi.org/10.1007/s10822-007-9133-z"
            target="_blank"
            rel="noreferrer noopener"
          >
            doi:10.1007/s10822-007-9133-z
          </a>
        </li>
      </ul>
    </>
  );
}
