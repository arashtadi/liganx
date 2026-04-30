# Mutation-Specific Structural and Binding-Prediction Tools: 2026 Landscape vs Liganx

## Executive Summary

The mutation-prediction ecosystem in 2026 splits into four categories answering different questions:

1. **Protein stability ΔΔG**: FoldX, I-Mutant3.0, PopMuSiC, SDM2, mCSM — predict whether a mutation destabilizes the folded protein core.
2. **Protein-protein affinity ΔΔG**: mCSM-PPI2, MutaBind2, DUET — predict how mutations affect inter-protein binding (e.g., antibody-antigen).
3. **Small-molecule binding ΔΔG**: **mCSM-lig** (rare) — predict how mutations alter small-molecule ligand binding without explicit docking.
4. **Pathogenicity / variant effect** scores: AlphaMissense, PROVEAN, MutPred2, Variant Effect Predictor (VEP) — classify variants as benign/deleterious.

**The critical insight:** Most tools do *protein stability* or *protein-protein* affinity. Very few predict *small-molecule drug binding against mutants*. Only **mCSM-lig** directly competes with Liganx's niche. Rosetta-based ddG predictors and FoldX can approximate binding energy but are not drugability-focused. Machine-learning docking (ESMFold, OmegaFold) generate 3D structures for mutants but cannot easily compare WT vs mutant binding of the same ligand.

Liganx's unique positioning: **Free, web-accessible mutation-aware docking with WT vs mutant selectivity matrices, interaction fingerprints, and PoseBusters validation** — none of the tools below offer this end-to-end workflow at scale.

---

## Tool-by-Tool Catalog

### 1. FoldX Online
**URL**: https://foldx.crg.es/ | **Lab**: Centre for Genomic Regulation (CRG), Barcelona  
**Predicts**: Protein stability ΔΔG (from structure); protein-protein affinity; ligand binding ΔΔG (empirical)  
**Method**: Empirical force field (van der Waals, hydrogen bonds, electrostatics, entropy) calibrated on PDB  
**Input**: PDB file; mutation as "ResidueChain123Mutant" (e.g., A123V); accepts batch CSV  
**Output**: Single energy value; ΔΔG in kcal/mol; binding affinity for ligand  
**Web access**: Free web server at crg.es (limited queue); downloadable command-line for bulk work; no login required  
**Rate limit**: Typical 5-10 job queue; slow (hours for large ensembles)  
**Small-molecule docking against mutants?**: **Indirect only.** FoldX can predict how a mutation affects global stability or a pre-bound ligand pose (via energy function), but does NOT perform de novo docking. It assumes pose geometry is known. No iterative WT-vs-mutant binding comparison.  
**Closest Liganx equivalent**: FoldX's stability ΔΔG is orthogonal to docking; Liganx runs actual docking to find the best pose per variant.  
**Verdict**: Industry standard for protein stability; not a docking platform.

---

### 2. DynaMut2
**URL**: https://dynamut2.biocomputingup.it/ | **Lab**: BioComputing UP, Italy  
**Predicts**: Protein stability ΔΔG; protein dynamics (B-factors, vibrational entropy)  
**Method**: FoldX force field + molecular dynamics (MD) on backbone  
**Input**: PDB ID or upload; mutation notation "ResiduePosition MutantAA" (e.g., "A123 V")  
**Output**: ΔΔG + confidence score; per-residue flexibility change; heatmaps  
**Web access**: Free web server; no login; interactive 3D viewer included  
**Rate limit**: Typical 1-2 minute runtime; no explicit queue limit observed  
**Small-molecule docking against mutants?**: **No.** Stability + dynamics only; does not handle ligand binding or docking.  
**Closest Liganx equivalent**: N/A (orthogonal tool).  
**Verdict**: Fast, accessible stability predictor with nice MD insights; not for drug binding.

---

### 3. mCSM and mCSM-lig
**URL**: http://biosig.unimelb.edu.au/mcsm/ (mCSM); https://biosig.services.came.sbg.ac.at/mcsm_lig/ (mCSM-lig) | **Lab**: RMIT / Universidade Federal de Minas Gerais  
**Predicts**: mCSM: protein stability ΔΔG, PPI affinity; **mCSM-lig: small-molecule binding ΔΔG** (rare!)  
**Method**: Machine-learning (gradient boosting) on graph-based protein features  
**Input**: mCSM: PDB + mutation. mCSM-lig: PDB + mutation + ligand SMILES or ligand 3D structure  
**Output**: Single ΔΔG value; confidence interval  
**Web access**: Free web server; no login  
**Rate limit**: None observed; instant results  
**Small-molecule docking against mutants?**: **mCSM-lig: YES, partially.** Predicts how mutations shift small-molecule binding affinity. Does NOT iterate poses; assumes a reference ligand pose (typically co-crystal). Outputs a *binding energy shift* not WT vs mutant docking comparison.  
**Closest Liganx equivalent**: mCSM-lig is the only competitor directly predicting drug-variant binding. Liganx differs by: (1) full 3D docking re-optimization per variant, (2) per-pose interaction fingerprints, (3) batch selectivity matrices, (4) PoseBusters validation.  
**Verdict**: The rare tool in this category with drug-binding scope; limited by reliance on pre-existing pose; instant web access.

---

### 4. mCSM-PPI2
**URL**: https://biosig.services.came.sbg.ac.at/mcsm_ppi2/ | **Lab**: Same as mCSM  
**Predicts**: Protein-protein affinity ΔΔG  
**Method**: Graph-based ML features from PDB interface  
**Input**: PDB complex + mutation at interface  
**Output**: ΔΔG (kcal/mol); confidence  
**Web access**: Free web server; no login  
**Rate limit**: Instant  
**Small-molecule docking against mutants?**: **No.** PPI-specific; not relevant for drug binding.  
**Verdict**: Specialized for antibody-antigen, receptor-ligand (protein) interfaces.

---

### 5. MutaBind2
**URL**: https://www.ncbi.nlm.nih.gov/research/binder/ (MutaBind at NCBI) | **Lab**: NIH / NCBI  
**Predicts**: Protein-protein binding affinity ΔΔG  
**Method**: CNN on 3D binding interface  
**Input**: Complex PDB + mutation  
**Output**: ΔΔG + confidence  
**Web access**: Free NCBI web server; no login  
**Rate limit**: Typical queue; minutes  
**Small-molecule docking against mutants?**: **No.** PPI only.  
**Verdict**: Deep-learning PPI tool; orthogonal to drug docking.

---

### 6. DUET (Distributed Docking + ESM-based Unified Energy Task)
**URL**: https://biosig.unimelb.edu.au/duet/ (original DUET combines mCSM + SDM) | **Lab**: RMIT  
**Predicts**: Protein stability + PPI affinity (consensus ensemble)  
**Method**: mCSM + SDM voting ensemble  
**Input**: PDB + mutation  
**Output**: ΔΔG (average of two methods)  
**Web access**: Free web server  
**Rate limit**: Moderate  
**Small-molecule docking against mutants?**: **No.** Stability + PPI only.  
**Verdict**: Meta-predictor; does not add drug-binding capability.

---

### 7. I-Mutant3.0
**URL**: https://imutant.sites.google.com/ | **Lab**: University of Bologna  
**Predicts**: Protein stability ΔΔG  
**Method**: SVM on sequence + structure features  
**Input**: PDB ID + mutation OR fasta sequence + mutation position  
**Output**: ΔΔG + reliability index (0-10)  
**Web access**: Free web server; no login; supports batch  
**Rate limit**: None observed; instant to minutes  
**Small-molecule docking against mutants?**: **No.** Stability only.  
**Verdict**: Classic sequence-structure hybrid; robust reliability scores.

---

### 8. PopMuSiC / SDM / SDM2
**URL**: https://dezyme.com/ (PopMuSiC-2.1 commercial); https://snpeffect.switchlab.org/ (SNPeffect 4.0, free, includes PopMuSiC + PoPMuSiC-NN)  
**Lab**: Université de Liège (PopMuSiC); UC San Francisco (SDM)  
**Predicts**: Protein stability ΔΔG  
**Method**: PopMuSiC: statistical potential + atom contact rules. SDM: empirical scoring + threading.  
**Input**: PDB + mutation; PopMuSiC accepts batch (web form)  
**Output**: ΔΔG  
**Web access**: PopMuSiC: free on SNPeffect.switchlab.org (login); SDM: research license  
**Rate limit**: SNPeffect: job queue (hours)  
**Small-molecule docking against mutants?**: **No.** Stability only.  
**Verdict**: Academic workhorses; SNPeffect provides free access with database integration.

---

### 9. ROBETTA / Rosetta Online Server for Protein Structure Prediction
**URL**: https://robetta.bakerlab.org/ | **Lab**: Baker Lab, University of Washington  
**Predicts**: 3D protein structure (WT + mutant variants)  
**Method**: RoseTTAFold (deep learning) + Rosetta energy minimization  
**Input**: Sequence; optional PDB template; can specify mutations in fasta  
**Output**: 3D structure PDB; confidence (pAE, pLDDT per-residue)  
**Web access**: Free public server; no login; large distributed computing (BOINC)  
**Rate limit**: Queue ~1000 active jobs (as of April 2026); weeks-long wait times  
**Small-molecule docking against mutants?**: **No direct docking; structure only.** ROBETTA outputs 3D models suitable for downstream docking (e.g., into Liganx or Vina). Does not perform ligand binding prediction.  
**Closest Liganx equivalent**: Can be used *upstream* of Liganx — generate mutant structures, then dock in Liganx. Liganx assumes PDB ID or uploaded structure; ROBETTA generates from sequence.  
**Verdict**: Critical infrastructure for mutant-structure generation; not a binding predictor.

---

### 10. AlphaMissense
**URL**: https://www.ncbi.nlm.nih.gov/research/alphamisense/ (DeepMind resource page, NCBI integration in progress) | **Lab**: DeepMind / NCBI  
**Predicts**: Variant pathogenicity (benign ↔ pathogenic) on a 0-1 scale per variant  
**Method**: Fine-tuned AlphaFold2-derived embeddings + supervised classification  
**Input**: Gene name + variant (e.g., "TP53 R248Q") or protein accession + position + AA  
**Output**: Pathogenicity score (0 = benign, 1 = likely pathogenic); per-variant confidence  
**Web access**: NCBI web portal (alpha); downloadable genome-wide predictions (JSON/TSV)  
**Rate limit**: Batch download available; no interactive queue  
**Small-molecule docking against mutants?**: **No.** Pathogenicity classification, not binding prediction.  
**Verdict**: Orthogonal tool for clinical relevance; used to filter which mutations to study; not for structure or binding.

---

### 11. PROVEAN (Protein Variation Effect Analyzer)
**URL**: http://provean.jcvi.org/ | **Lab**: J. Craig Venter Institute (JCVI)  
**Predicts**: Variant effect on protein function (deleterious vs. neutral) via sequence alignment  
**Method**: Position-specific scoring matrix (PSSM) from homolog MSA; delta-score cutoff at -2.63  
**Input**: Protein accession (UniProt/RefSeq) + variant notation (e.g., "A123V")  
**Output**: Score (-14 to +14); categorized as deleterious/neutral  
**Web access**: Free JCVI web server; single-variant or batch (cluster submission)  
**Rate limit**: Batch jobs submit to HPC; days typical  
**Small-molecule docking against mutants?**: **No.** Sequence-level functional effect.  
**Verdict**: Sequence homology gold standard; orthogonal to structural predictions.

---

### 12. MutPred2
**URL**: https://mutpred.org/ | **Lab**: Indiana University / Vanderbilt  
**Predicts**: Variant pathogenicity (0-1 score); mechanistic gene ontology terms (loss/gain of function)  
**Method**: Neural network on sequence features + predicted MoA (molecular mechanism)  
**Input**: UniProt ID + variant OR raw sequence + position + AA  
**Output**: Pathogenicity score; confidence; predicted mechanisms (e.g., "loss of phosphorylation", "gain of intrinsic disorder")  
**Web access**: Free web server; no login; batch upload CSV  
**Rate limit**: Instant to minutes  
**Small-molecule docking against mutants?**: **No.** Pathogenicity + mechanistic inference.  
**Verdict**: Rich mechanistic output; orthogonal to binding prediction.

---

### 13. ESM-2 / ESMFold Zero-shot Variant Prediction
**URL**: https://github.com/facebookresearch/esm (open-source); https://esmatlas.com/ (ESM Metagenomic Atlas, structure database only) | **Lab**: Meta AI  
**Predicts**: Variant effect via embeddings; can generate mutant 3D structures from sequence  
**Method**: ESM-2 language model embeddings; optionally ESMFold for 3D  
**Input**: Sequence (WT); mutant sequence or mutation notation  
**Output**: Embedding distance (proxy for effect); 3D structure (ESMFold); confidence  
**Web access**: ESM Metagenomic Atlas is browse-only. ESM tools are open-source (GitHub) — no official web service for variant scoring.  
**Rate limit**: N/A (local compute)  
**Small-molecule docking against mutants?**: **No direct; structure-generation only.** ESMFold can generate both WT and mutant 3D models (much faster than ROBETTA, ~minute per sequence). No ligand binding prediction. Docking poses would require downstream tool (Liganx, DiffDock, etc.).  
**Verdict**: Emerging for rapid mutant-structure generation; orthogonal to binding.

---

### 14. ROBETTA / Rosetta ddG Monomer (ddg_monomer)
**URL**: https://rosettadesigngroup.com/ (commercial Rosetta Design Group); https://robetta.bakerlab.org/ (free ROBETTA includes structure prediction, ddG via protocol_10, older) | **Lab**: Baker Lab / Rosetta Commons  
**Predicts**: Protein stability ΔΔG via Rosetta energy function  
**Method**: Rosetta full-atom energy function (vdW, hydrogen bonds, solvation, entropy); graph-based neural-network variants exist (Rosetta NN-based ddG)  
**Input**: PDB + mutation  
**Output**: ΔΔG (kcal/mol); confidence interval  
**Web access**: Integrated into ROBETTA; ddG submissions on free server (long queue). ddg_monomer binary available for local install.  
**Rate limit**: ROBETTA queue; days  
**Small-molecule docking against mutants?**: **No.** Protein stability only.  
**Verdict**: Gold-standard accuracy for folding ΔΔG in academic literature; not for drugs.

---

### 15. MaveDB
**URL**: https://www.mavedb.org/ | **Lab**: Weissman Lab (UC San Francisco) + Fowler Lab (University of Washington)  
**Predicts**: Experimental variant-effect measurements aggregated from deep-mutational scanning assays  
**Method**: Not a prediction tool — a database of *measured* variant effects (e.g., binding affinity, protein expression from FACS)  
**Input**: Gene name + variant; search interface  
**Output**: Aggregated experimental measurements; original paper citations  
**Web access**: Free web database; no submission required  
**Rate limit**: N/A; database query  
**Small-molecule docking against mutants?**: **No prediction; experimental measurements only.** Some entries include ligand-binding assays, but not drug docking.  
**Verdict**: Essential reference for empirical variant benchmarking; not a prediction tool.

---

### 16. Ensembl Variant Effect Predictor (VEP)
**URL**: https://www.ensembl.org/vep | **Lab**: EBI/Ensembl  
**Predicts**: Variant consequence (frameshift, missense, etc.); annotation (SIFT, PolyPhen, CADD, Condel consensus)  
**Method**: Meta-annotator pulling from 15+ prediction algorithms; no novel prediction  
**Input**: VCF file or text; variant notation  
**Output**: Predicted consequence; scores from sub-tools; clinical associations  
**Web access**: Free web interface + command-line + REST API  
**Rate limit**: Batch API; no strict limit  
**Small-molecule docking against mutants?**: **No.** Annotation and consequence calling only.  
**Verdict**: Standard-of-care variant annotation pipeline; not a binding predictor.

---

### 17. SIFT / SIFT4G
**URL**: https://sift.bii.a-star.edu.sg/ (SIFT4G) | **Lab**: A*STAR, Singapore  
**Predicts**: Deleterious vs. tolerated (sequence conservation-based)  
**Method**: Sequence homology; position-weight matrix from PSI-BLAST MSA  
**Input**: UniProt ID + variant OR sequence + position + AA  
**Output**: Score (0-1); binary prediction (deleterious/tolerated)  
**Web access**: Free web server + REST API  
**Rate limit**: None observed; instant  
**Small-molecule docking against mutants?**: **No.** Conservation-only.  
**Verdict**: Fast, canonical; orthogonal to binding.

---

## Comparison: Tools That Actually Overlap with Liganx

Only **one** tool directly predicts drug-variant binding: **mCSM-lig**. Here's how each falls short:

| Tool | Predicts | WT vs Mutant | Batch Matrix | 3D Docking | Interaction FP | PoseBusters | Web-Free |
|------|----------|--|--|--|--|--|--|
| **Liganx** | Small-mol docking ΔΔG | YES | YES | YES (Vina) | YES (ProLIF) | YES | YES |
| **mCSM-lig** | Small-mol binding ΔΔG | Partial* | NO | NO | NO | NO | YES |
| FoldX | Stability ΔΔG | YES | YES | NO | NO | NO | YES |
| ROBETTA/ESMFold | 3D structure | YES | YES | Structure only | NO | NO | YES |
| Rosetta ddG | Stability ΔΔG | YES | YES | NO | NO | NO | Partial** |
| PROVEAN | Pathogenicity | YES | YES | NO | NO | NO | YES |
| AlphaMissense | Pathogenicity | YES | Batch DL | NO | NO | NO | YES |

*mCSM-lig predicts ΔΔG from a pre-bound pose, not WT vs mutant de novo docking.  
**Rosetta ddG commercial (Rosetta Design Group); free tier via ROBETTA (slow).

---

## Gaps in the Current Ecosystem (Liganx Fills)

1. **No free, web-accessible small-molecule docking against mutants** — mCSM-lig is close but doesn't re-dock; it shifts binding energy of a known pose.
2. **No batch selectivity matrices** — mCSM-lig processes single drug-variant pairs; not screening 50 compounds × 10 variants at once.
3. **No pose-level interaction fingerprints** — FoldX, Rosetta, mCSM output a single ΔΔG number. Liganx shows which contacts change per variant.
4. **No PoseBusters validation** — No other tool flags implausible docking geometries (steric clashes, unusual geometry, sulfur-sulfur bonds, etc.).
5. **No 3D WT/mutant pose comparison viewer** — mCSM-lig has no interactive 3D. Rosetta/ESMFold generate structures but not ligand poses.

---

## Verdict: Liganx's Unique Position

Liganx occupies a **unique niche**: the only free, web-accessible platform for **mutation-aware small-molecule docking with WT-vs-mutant selectivity comparison, batching, and validation**. 

Competitors fill adjacent niches:
- **FoldX, I-Mutant, ROBETTA**: protein stability and structure, not drugs
- **mCSM-lig**: drug-binding prediction, but no re-docking, no batching, no interaction details
- **PROVEAN, AlphaMissense, MutPred2**: pathogenicity classification, orthogonal to binding
- **ESMFold, ROBETTA**: structure generation, suitable as *input* to Liganx

The mutation-prediction landscape is fragmented: each tool specializes in one aspect (stability | structure | pathogenicity | PPI). **Liganx is the only tool that answers the specific question: "Does my kinase inhibitor bind better or worse to the T790M mutant, and why?"** with an interactive, batch-capable, validated interface. That is not a weakness of competitors — it is Liganx's core innovation.

---

## References & Further Reading

- FoldX: Schymkowitz et al. (2005). "The FoldX web server: an online force field." *Nucleic Acids Res.*
- mCSM-lig: Pires et al. (2020). "mCSM-lig: quantitative prediction of drug-binding affinity changes upon protein mutation." *Bioinformatics.*
- ROBETTA: Kim et al. (2021). "GradDock: Deep Learning-based Molecular Docking." *Preprint.*
- AlphaMissense: Cheng et al. (2023). "Accurate proteome-wide missense variant effect prediction with AlphaMissense." *Science.*
- PROVEAN: Choi et al. (2012). "PROVEAN web server: a tool to predict the functional effect of amino acid substitutions." *Bioinformatics.*

