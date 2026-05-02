# PDFs reviewed but NOT integrated into the skill

These were processed by a sub-agent and explicitly judged out-of-scope
for the medchem-phd skill. Documented here so we don't waste time
re-reading them in future iterations.

## SKIP: `jacs3c05680.pdf`

- **Title:** Late-Stage Molecular Editing Enabled by Ketone Chain-Walking Isomerization
- **Authors:** Brägger, Y.; Green, O.; Bhawal, B. N.; Morandi, B. *et al.*
- **Citation:** *J. Am. Chem. Soc.* 2023, 145(36). DOI: 10.1021/jacs.3c05680
- **Why skipped:** Pure synthetic-methodology paper. Describes a catalytic
  ketone isomerization (pyrrolidine + S₈) for accessing unnatural
  steroid regioisomers. Beautiful chemistry, but it does not address
  protein-ligand docking, mutation modeling, scoring, SMILES design,
  or any of the medchem-phd skill's audit/advisor surface. Useful
  only as a citation if a user ever asks "can we synthesise this
  unusual steroid isomer in 1-2 steps?" — at which point: yes,
  reference Brägger 2023.

## SKIP: `PhD thesis - Maria Gordillo Maranon.pdf`

- **Title:** Genetically Guided Drug Development
- **Author:** María Gordillo Marañón
- **Institution:** University College London, Institute of Cardiovascular Science
- **Why skipped:** Genetic epidemiology / Mendelian-randomization
  thesis. Covers GWAS-based drug-target prioritization and causal
  inference. Zero content on docking, structure-based design,
  molecular modeling, or compound-level structural reasoning. Would
  be highly relevant to a separate skill focused on target validation
  from genetics, but not to medchem-phd's structural-biology surface.

## How to handle a similar PDF in future

If a future PDF lands here and an agent's verdict is SKIP, do this
instead of integrating it:

1. Add an entry to this SKIPPED.md with title + author + 1-line reason
2. Move the PDF to `references/inputs/skipped/` (create the subfolder)
3. Update `SKILL.md`'s reference-pointer section if the PDF would have
   created a new reference file the user might expect to see

This keeps the inputs/ folder lean and prevents re-processing.
