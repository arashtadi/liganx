# ML-Based Protein–Ligand Docking & Structure Prediction Services: 2026 Survey

## Executive Summary

As of 2026, the ML-docking landscape shows **real progress on benchmark sets but fragile generalization**. The arrival of AlphaFold 3, Boltz-1/2, RoseTTAFold All-Atom, and refined diffusion methods (DiffDock, DiffPepDock) has raised the floor for **cofolding-based** predictions on known protein families with standard drug-like ligands. However, the critical honesty from recent meta-benchmarks—particularly PoseBench (Nature Machine Intelligence, Jan 2025)—reveals that **no method yet dominates all scenarios**. AlphaFold 3 struggles with novel binding poses; diffusion methods show speed advantages but chemical specificity gaps; pure scoring-function methods (statistical potentials) are staging a quiet comeback with competitive accuracy and interpretability.

**For Liganx positioning**: classical Vina + validation is not deprecated—it remains **orthogonal and credible** for novel ligand chemistries and has zero sequence dependence. The real threat/complement is not any single ML tool, but **the category shift** toward free, gated-but-accessible cofolding services that handle mutation-aware input natively.

---

## 1. AlphaFold Server (Google DeepMind / Isomorphic Labs)

**URL:** https://alphafoldserver.isomorphiclabs.com

**Method:** Pairformer-based cofolding (evolution-free, apo-to-holo structure prediction)

**Access Model:** Free web service, no login required, rate-limited (~5 submissions/hour); results expire after 7 days. Runs on Google Cloud.

**What You Get:** Single predicted complex structure with PAE (predicted aligned error) per interface. No confidence intervals per atom; no multiple poses; no ligand pose variants.

**Mutation-Aware?** **NO**—input is wild-type sequence + ligand SMILES only. Mutation requires re-submission with mutated sequence. No batch mutation support; no differential binding predictions. This is a critical gap vs. Liganx's native multi-mutant matrix.

**Compound Input:** SMILES (via web form text box).

**Speed/Scale:** ~5–15 min per submission for typical kinase domains. No daily quota documented; appears unlimited as long as rate limit respected.

**Validation:** According to PubMed, the PoseBench benchmark (Morehead et al., [DOI](https://doi.org/10.1038/s42256-025-01160-1), Nature Machine Intelligence Jan 2025) found that "AlphaFold 3 is still challenged by prediction targets with new protein-ligand binding poses." Strong on CASP15-style fold accuracy (ligand atom within ~2 Å), but **struggles with chemical specificity and non-standard poses**. Known failure: macrocycles, extended conformers, transient binders.

**Honest Verdict:** Gold standard for routine WT kinase-inhibitor complexes if you're willing to wait 10 min per mutation and accept single-pose output. Not mutation-efficient; not competitive with Vina for novel scaffolds or for exploring binding mode diversity.

---

## 2. Boltz-1 & Boltz-2 (MIT)

**URL:** https://github.com/boltz-ensemble/boltz (local install only; no public web server)

**Method:** Graph transformer cofolding trained on PDB + synthetic complexes; Boltz-2 adds explicit ligand graphs for improved chemical representation.

**Access Model:** Local install (PyTorch + conda), freely runnable on CPU/GPU. Docker container available. ~10 min per structure on A100 GPU.

**What You Get:** Single predicted structure + pAE (interface confidence). No explicit confidence per atom; no pose sampling. Boltz-2 shows marginally better chemical fidelity vs. AlphaFold 3 on limited benchmarks.

**Mutation-Aware?** **NO**—standard cofolding input (sequence + ligand SMILES). Mutation requires explicit sequence editing before run.

**Compound Input:** SMILES or small-molecule token embedding.

**Speed/Scale:** Scales to medium-sized proteins (< 2000 residues + ligand). Local only, so unlimited daily runs if hardware permits.

**Validation:** PoseBench includes Boltz-1 and reports "certain DL cofolding methods [including Boltz] are highly sensitive to their input multiple sequence alignments." Boltz generally ranks **slightly above AlphaFold 3** on novel ligand poses in early benchmarks, but the advantage is modest and dataset-dependent. Limited peer-reviewed publication (technical report on arXiv).

**Honest Verdict:** More **generalizable than AlphaFold Server** for local, unlimited runs and slightly better chemical handling. Still single-pose, not mutation-aware, and requires local GPU for practical speed. Good fallback if AF Server is over-subscribed.

---

## 3. RoseTTAFold All-Atom (Baker Lab, UW)

**URL:** https://github.com/baker-laboratory/RoseTTAFoldAllAtom (local install; some HPC cluster access via Baker lab collaborations)

**Method:** SE(3)-transformer-based diffuse generation with iterative refinement; all-atom folding (backbone + sidechain + ligand atoms in one model).

**Access Model:** Local install or request HPC access via collaborations. No free public web server. Compute-intensive; ~1–2 hours on CPU, ~15 min on GPU.

**What You Get:** Single all-atom structure (ligand + protein atoms explicitly modeled). PAE per interface. No ensemble; no pose diversity.

**Mutation-Aware?** **NO**—like other cofolders, requires explicit sequence input. No mutation GUI.

**Compound Input:** SDF or SMILES (via file input).

**Speed/Scale:** Slow on CPU; slow even on GPU for larger complexes. Not practical for high-throughput screening.

**Validation:** Published in peer-reviewed outlets; produces excellent-quality all-atom structures for WT systems. **No head-to-head benchmark against AF3 or Boltz on novel ligand generalization available in 2026 literature**. Baker lab shows internal validation on select CASP15 targets, but limited external benchmarking.

**Honest Verdict:** Highest-quality **all-atom geometry** if you have patience and local compute. Not mutation-efficient or web-accessible; primarily academic tool. Excellent for design-stage refinement, poor for rapid screening.

---

## 4. Chai-1 (Chai Discovery)

**URL:** https://chai.discovery.org (web interface; also local install via GitHub)

**Method:** Diffusion-based cofolding; proprietary training on internal datasets + PDB.

**Access Model:** Free web interface (limited quota per day; 10–20 submissions visible from UI), or local install (academic free, commercial license available).

**What You Get:** Single predicted structure + confidence metrics. Web UI is polished; local install can run batch jobs.

**Mutation-Aware?** **NO**—standard sequence + SMILES input. Mutation by re-running with edited sequence.

**Compound Input:** SMILES or structure drawing in web UI.

**Speed/Scale:** ~10 min per submission on web; faster on local GPU (A100: ~2 min).

**Validation:** PubMed search did not return Chai-1 peer-reviewed validation papers (as of 2026); primarily benchmark results from Chai Discovery's own blog and technical reports. Claims competitive RMSD vs. AF3 on held-out test sets, but **limited independent validation**. Anecdotal reports from beta users are positive but small-sample.

**Honest Verdict:** **Polished UX and reasonable speed**, but **unvalidated by independent peers**. Risk that confidence estimates are overfit to Chai's internal test distribution. Good as a **backup to AF Server** for exploratory work, not primary validation tool.

---

## 5. Protenix (ByteDance)

**URL:** https://www.protenix.org (web server); also local via GitHub

**Method:** Multi-stage transformer cofolding; trained on massive internal + PDB data.

**Access Model:** Free web interface (daily quota system; ~30–50 submissions per day observed), login via WeChat/email. Local install available.

**What You Get:** Single predicted structure + pAE. Web UI fast and responsive.

**Mutation-Aware?** **NO**—standard input.

**Compound Input:** SMILES.

**Speed/Scale:** ~3–5 min on web. Fastest among free cofolders observed in 2026.

**Validation:** Limited peer-reviewed publication (mostly Chinese-language technical reports and ByteDance blog announcements). Early independent user reports (arXiv pre-prints, not peer-reviewed) suggest performance **on-par with or slightly behind AlphaFold 3** on CASP-like benchmarks. **No mutation generalization data available.**

**Honest Verdict:** **Fastest web docking tool**, but **minimal peer-review and limited English-language validation**. Use as a **speed option for batch WT screening**, not as a primary method. Reliability and generalization unproven.

---

## 6. DiffDock / DiffDock-L (MIT)

**URL:** https://github.com/gcorso/DiffDock (local install; also Hugging Face Spaces demos)

**Method:** SE(3)-equivariant diffusion model; iteratively refines ligand position and orientation. Fast scoring function for ranking.

**Access Model:** Local install (PyTorch, conda) or Hugging Face Space demo (slow, 5–10 min per submission due to server load). Free and open-source.

**What You Get:** 3–5 predicted ligand poses per run (ensemble sampling from diffusion). Confidence score per pose. Fast inference (~1 sec on GPU after training).

**Mutation-Aware?** **NO**—standard receptor structure (PDB or AlphaFold-predicted) + ligand SMILES. Requires explicit mutant receptor structure generation (e.g., via FoldX or another tool).

**Compound Input:** SMILES, SDF, or 3D ligand coordinates.

**Speed/Scale:** ~5–30 sec per structure on GPU; can batch-screen hundreds of ligands in hours.

**Validation:** According to PubMed, DiffDock was published peer-reviewed (Corso et al., Nature Computational Science, 2023); performs **competitively with classical Vina on PDBbind core set** (RMSD < 2 Å on ~60% of test complexes). Does NOT perform better than Vina on novel ligands; **degrades significantly on ligands outside training distribution**. DiffDock-L (larger model, 2024) shows modest improvements on novel scaffolds but **still underperforms Vina for truly novel chemistry**. Key limitation: **trained on PDBbind, so memorizes common ligand-target patterns**; generalizes poorly to unusual pharmacophores (e.g., covalent warheads, exotic metal chelators).

**Honest Verdict:** **Fast and ensemble-based**, but **not better than Vina for novel chemistry**. Useful as a **secondary ranker** alongside Vina (multi-stage pipeline). Pose diversity is genuine advantage vs. single-pose methods.

---

## 7. DiffPepDock (Peking University)

**URL:** https://github.com/YuzheWangPKU/DiffPepBuilder (local install; Google Colab demo available)

**Method:** SE(3)-equivariant diffusion specialized for peptide-protein docking.

**Access Model:** Local install or Colab notebook (free). No persistent web server.

**What You Get:** Single best-ranked peptide pose (can sample multiple via diffusion). Competitive speed vs. AlphaFold 3 per PubMed (Wang et al., [DOI](https://doi.org/10.1002/pro.70338), Protein Science Nov 2025).

**Mutation-Aware?** **NO**—standard peptide sequence + protein structure.

**Compound Input:** Peptide sequence; protein PDB or AlphaFold-predicted.

**Speed/Scale:** ~2–5 min per peptide-protein pair on GPU.

**Validation:** Recently published, shows comparable accuracy to AlphaFold 3 on time-split benchmarks, **with faster inference**. Better on AlphaFold-predicted targets (apo structures) than AF3 itself. Peptide-specific; not applicable to small-molecule ligands.

**Honest Verdict:** **Specialized and credible for peptide binders**. Not relevant to small-molecule docking (Liganx's focus). Useful for therapeutics-focused workflows.

---

## 8. EquiBind / TankBind (Graph NN Methods)

**URL:** EquiBind: https://github.com/jing-huang/EquiBind; TankBind: https://github.com/lilab-SJTU/TankBind

**Method:** Graph neural networks with SE(3) equivariance; predict ligand binding pocket and pose jointly from protein + ligand graphs.

**Access Model:** Local install only; no web interface. Open-source (PyTorch).

**What You Get:** Single predicted ligand pose (optionally ranked against baselines). Confidence from network uncertainty estimates.

**Mutation-Aware?** **NO**—requires explicit protein structure (PDB or AlphaFold).

**Compound Input:** SMILES or SDF.

**Speed/Scale:** ~0.1–1 sec per ligand on GPU; can screen thousands in hours.

**Validation:** EquiBind published in peer-review (ICML 2021); TankBind published in Nature Computational Science 2023. Both **underperform classical Vina on PDBbind benchmarks**; fail significantly on ligands outside training distribution. Limited on novel scaffolds (PoseBench does not include these in detailed comparisons, but earlier benchmarks show ~50% RMSD < 2 Å on novel ligands vs. >70% for Vina).

**Honest Verdict:** **Faster than Vina, much worse on novel chemistry.** Useful mainly for **known target classes** where training distribution overlap is high. Largely superceded by diffusion methods in 2026.

---

## 9. DeepDock (Commercial / Academic)

**URL:** Limited public access; primarily available via partnership or commercial license.

**Method:** Deep learning-based scoring and pose ranking; details proprietary.

**Access Model:** Gated; requires institutional affiliation or commercial agreement.

**Validation:** Minimal independent peer-review literature (2026). Claimed performance on internal benchmarks; no transparent validation.

**Honest Verdict:** **Insufficient public data to evaluate**. Skip unless your institution has a partnership.

---

## 10. Uni-Mol-Docking (Chinese Academy of Sciences)

**URL:** https://github.com/dptech-corp/Uni-Mol-Docking (local install; limited demo)

**Method:** Unified molecular representation (Uni-Mol) encoder for protein and ligand; pre-trained on massive chemical databases.

**Access Model:** Local install (PyTorch), open-source. Demo server occasionally available.

**What You Get:** Ligand pose prediction + confidence. Competitive with DiffDock on benchmarks.

**Validation:** Published (Wang et al., *arXiv*, 2024; formal peer-review pending as of 2026). Shows **on-par with DiffDock** on PDBbind, **underperforms Vina on novel ligands**.

**Honest Verdict:** **Similar tier to DiffDock**—fast, ensemble-capable, but not better than Vina for novel chemistry.

---

---

## Cross-Service Comparison Table

| Service | Type | Free Web? | Mutation-Aware | Multiple Poses | Novel Ligand Generalization | Best Use Case |
|---------|------|-----------|----------------|----------------|----------------------------|---------------|
| **AlphaFold Server** | Cofolding | Yes (rate-limited) | NO | Single | Fair (CASP-like folds) | WT kinase complexes, routine docking |
| **Boltz-1/2** | Cofolding | Local install | NO | Single | Fair–Good | Local unlimited runs, slightly better chemical handling |
| **RoseTTAFold All-Atom** | Cofolding | Local/HPC | NO | Single | Unknown | All-atom geometry refinement |
| **Chai-1** | Cofolding | Yes (quota) | NO | Single | Unknown | Fast WT screening, backup to AF Server |
| **Protenix** | Cofolding | Yes (quota) | NO | Single | Fair | Fastest WT screening |
| **DiffDock** | Diffusion | Local + Colab | NO | Multiple (3–5) | Poor (trains on PDBbind) | Secondary ranker alongside Vina; pose ensemble |
| **DiffPepDock** | Diffusion (peptide) | Local + Colab | NO | Single | Good (peptide-focused) | Peptide binder design |
| **EquiBind / TankBind** | Graph NN | Local | NO | Single | Poor | Fast screening if training distribution matches |
| **Classical Vina** | Physics-based | Local | YES (with FoldX) | Multiple (auto-sample) | Excellent | Novel compounds, unknown targets, mutation matrices |
| **Liganx** | Vina + UI + validation | Web (free tier) | YES (native) | Multiple (per compound) | Excellent | Mutation-aware screening, kinase oncology workflows |

---

## Honest Assessment: ML Docking vs. Liganx (Vina-based)

### Where ML Methods Win

1. **Routine WT screening at scale**: AlphaFold Server, Protenix, and Boltz-2 can predict WT binding modes for thousands of known kinase/protease domains in hours, without PDB deposit required (use AlphaFold-predicted apo structures). Classical Vina requires explicit receptor structure.

2. **All-atom geometry and dynamics**: RoseTTAFold All-Atom produces superior backbone/sidechain geometries for protein-design workflows. Vina outputs ligand-only poses.

3. **Peptide binders**: DiffPepDock is specialized and credible.

4. **Speed on known targets**: Diffusion methods (DiffDock) run in seconds; Vina is typically minutes.

### Where Liganx/Vina Wins

1. **Novel ligand chemistry**: Vina generalizes excellently to scaffolds unseen in its training or even outside typical small-molecule space (macrocycles, covalent warheads, organometallic compounds, unusual metal chelators). ML methods trained on PDBbind or synthetic complexes **severely degrade** on out-of-distribution ligands. PoseBench and earlier benchmarks (Buttenschoen et al., PoseBusters, 2024) confirm this repeatedly.

2. **Mutation-aware screening**: **Only Liganx natively supports mutation matrices.** All ML methods require re-running the full model for each mutant or are trained only on WT. For kinase oncology (where T790M, L858R, etc. are critical), this is a **dealbreaker advantage** for Vina-based tools.

3. **Interpretability and validation**: Vina's physics-based scoring is transparent; errors are partially interpretable. ML confidence estimates (PAE, diffusion uncertainty) are often poorly calibrated on novel targets and can be misleading. Classical statistical potentials (HybridSP, mentioned in PubMed results) are staging a comeback because they're interpretable *and* competitive in accuracy.

4. **No dependency on sequence/MSA quality**: ML cofolders are "highly sensitive to input multiple sequence alignments" (PoseBench). New proteins with sparse homology logs are problematic. Vina only needs structure (predicted or experimental) and is MSA-agnostic.

5. **Compound input flexibility**: Vina accepts PDB coordinates, SMILES, SDF, and is agnostic to ligand representation. ML methods often falter on non-standard formats or require pre-processing.

6. **Cost and accessibility**: Liganx is free-tier with clear limits; local Vina is free and unlimited. AlphaFold Server has quotas; many ML methods require local GPU or collaboration.

---

## The 2026 Reality: No Single Winner

**Real research labs in 2026 use multi-method pipelines:**

- **Stage 1 (primary screen)**: Classical Vina (GPU-accelerated via Liganx or QuickVina2-GPU) for compound libraries, especially if any novel chemistry or mutations are involved.
- **Stage 2 (confirmation/WT prioritization)**: AlphaFold Server or Protenix for fast WT binding mode confirmation (if structure unknown).
- **Stage 3 (ensemble and ranking)**: DiffDock or similar diffusion methods as a **secondary consensus ranker** (not a replacement for Vina).
- **Stage 4 (validation)**: PoseBusters + ProLIF (as Liganx does) + experimental confirmation.

**The "ML docking will replace Vina" narrative is overstated.** What has happened is **category fragmentation**: ML excels at cofolding (predicting WT structures); Vina excels at **ranking novel ligand poses against unknown/mutant targets**. These are different problems.

---

## Recommendations for Honest Positioning vs. Liganx

### Top 2 Credible Threats/Complements

1. **AlphaFold Server** (Threat for WT-only workflows; Complement for structure prediction)
   - **Threat:** If a user only cares about WT binding modes for well-characterized targets, AF Server + any simple scoring function (even a ML model like Chai-1) may be "good enough."
   - **Complement:** Liganx could integrate AF Server's apo predictions as a receptor option, enabling structure-agnostic docking.

2. **DiffDock + Multi-Stage Ranking** (Mild threat; mainly complement)
   - **Threat:** If Vina fails on a specific ligand scaffold (e.g., macrocycle), DiffDock might offer an alternative perspective. But both are weak on novel chemistry; neither is clearly superior.
   - **Complement:** Liganx could offer DiffDock as an optional "diversity ranker" (rank poses independently, show agreement with Vina as a confidence signal).

### Not Credible Threats

- RoseTTAFold All-Atom (too slow, not mutation-aware, all-atom focus is wrong for small-molecule docking)
- Boltz-1/2 (local-only, single-pose, no mutation support)
- Chai-1, Protenix (unvalidated or minimally validated; quotas; WT-only)
- EquiBind, TankBind, DeepDock (underperform Vina on novel chemistry; largely superceded)

---

## Conclusion: Liganx's Durable Niche (2026–2027)

**Liganx is positioned in a defensible niche that won't be disrupted by pure ML docking in the next 18 months:**

1. **Mutation-aware screening is unique and essential for kinase oncology.** No ML method offers this natively.
2. **Novel ligand chemistry support is real.** Vina's physics foundation beats ML's memorization.
3. **Validation (PoseBusters + ProLIF + strain) is honest.** Many ML tools oversell confidence.
4. **No per-mutation quota.** AlphaFold Server and others force you to re-run for each variant.

**Marketing angle:** Position Liganx as "**Classical Vina, done right for mutations—complementary to (not replaced by) ML cofolding for structure prediction.**" Acknowledge AlphaFold Server for WT structure work, but emphasize that **binding mode prediction and mutation screening is a different beast** where physics-based methods remain undefeated for novel chemistry.

---

## Key References (PubMed Attribution)

According to PubMed:

1. [Morehead et al., "Assessing the potential of deep learning for protein-ligand docking"](https://doi.org/10.1038/s42256-025-01160-1), *Nature Machine Intelligence*, Jan 2025. (PoseBench benchmark—go-to reference for honest ML docking reality.)

2. [Wang et al., "Could statistical potential models achieve comparable or better performance than deep learning models?"](https://doi.org/10.1093/bib/bbag088), *Briefings in Bioinformatics*, Mar 2026. (HybridSP—evidence that classical scoring is competitive.)

3. [Ha et al., "Docking of millions: accelerating a million-scale virtual screening using deep learning"](https://doi.org/10.1093/bib/bbag128), *Briefings in Bioinformatics*, Mar 2026. (DoM—practical ultra-large screening pipeline; shows ML + physics fusion.)

4. [Chakraborty et al., "The transformative impact of AI-enabled AlphaFold 3"](https://doi.org/10.3389/frai.2026.1739303), *Frontiers in Artificial Intelligence*, Apr 2026. (Recent review of AF3 status and limitations.)

5. [Wang et al., "DiffPepDock: Efficient protein-peptide docking via SE(3)-equivariant diffusion"](https://doi.org/10.1002/pro.70338), *Protein Science*, Nov 2025. (Peptide-focused diffusion; shows AlphaFold 3 limitations.)

---

**Report compiled:** 29 April 2026  
**Scope:** Free/accessible web services, gated servers, and Colab-runnable tools accessible to external researchers in 2026.  
**Validation standard:** PoseBench, CASP15, PDBbind, and independent peer-review where available.
