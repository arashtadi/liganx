# Mutation-Aware Docking Platform — Competitive Landscape & User Pain Points

*Research compiled April 2026. Sources cited inline.*

---

## TL;DR

The docking-tool market splits into four tiers — free web servers, commercial desktop suites, ML newcomers, and mutation-effect predictors — and **none of them deliver the workflow we're targeting**. The closest analog (mCSM-lig) returns a single ΔΔG number for a known complex; it cannot dock a novel compound, cannot generate a mutant 3D structure, and has no selectivity-matrix output. Schrödinger's FEP+ Residue Mutation can do the comparison, but at $100k+/year it's locked behind a wall that almost no small biotech, educator, or consultant can clear.

The biggest user pain points (mined from BioStars, Reddit, and ResearchGate) are: mutation modeling fragmentation, scoring unreliability, install-and-setup friction, the cost gap between free and Schrödinger, and batch-screening bottlenecks. Each of these maps directly to a feature we already have on the table — which means the wedge in the concept doc is real, not aspirational.

The clearest path to win: a web platform with one-click mutant building, automatic WT-vs-mutant docking, an integrated selectivity matrix, plain-English interpretation, and a freemium price point under $1k/year. Backend candidates: AutoDock Vina or smina by default for trust and reproducibility, with optional Uni-Mol V2 or Boltz-2 for users who want ML speed.

---

## 1. Free Web Docking Servers

These set the price ceiling at zero and define what "good enough" looks like for academics.

### Primary players

**SwissDock** ([swissdock.ch](http://swissdock.ch/)) — Major 2024 overhaul ([NAR 2024](https://academic.oup.com/nar/article/52/W1/W324/7660078)). Now uses Attracting Cavities 2.0 + Vina 1.2.5. ~530k users, ~710k dockings since 2011. **No mutation handling.** 1-hour wall clock for AC, 10-min for Vina — users break jobs into pieces. Rigid protein only; ~80% success on ligands with <15 rotatable bonds, fails on heavier compounds.

**CB-Dock2** ([cadd.labshare.cn/cb-dock2](https://cadd.labshare.cn/cb-dock2/)) — Cavity-detection + Vina + FitDock template matching ([NAR 2022](https://academic.oup.com/nar/article/50/W1/W159/6591526)). ~200 jobs/day. 85% success at RMSD <2 Å. **No mutation handling.** Strips heteroatoms aggressively — repeatedly criticized for losing metal ions and cofactors.

**HDOCK** ([hdock.phys.hust.edu.cn](http://hdock.phys.hust.edu.cn/)) — FFT-based protein–protein/DNA/RNA docking ([Nature Protocols 2020](https://www.nature.com/articles/s41596-020-0312-x)). 30k+ jobs since 2017. Architectural bottleneck: max 20 concurrent jobs, hundreds queued. Accepts sequences, which hints at mutation handling — but doesn't actually do it.

**HADDOCK 2.5** ([wenmr.science.uu.nl](https://wenmr.science.uu.nl/haddock2.4/)) — 17k+ citations. Information-driven; can ingest mutagenesis data as Ambiguous Interaction Restraints. The only free server that touches mutation data, but requires the user to bring the experimental data. Steep learning curve.

**MTiOpenScreen** ([bioserv.rpbs.univ-paris-diderot.fr](https://bioserv.rpbs.univ-paris-diderot.fr/services/MTiOpenScreen/)) — Vina-based screening up to 10k compounds; AutoDock 4.2 capped at 10 ligands. No flexibility, no mutation.

**DockThor-VS** ([dockthor.lncc.br](https://www.dockthor.lncc.br/v2/)) — Brazilian HPC backend, academic-only. Maintained since 2013. Auto-clusters and ranks. No mutation.

**MolModa** ([durrantlab.pitt.edu/molmoda](https://durrantlab.pitt.edu/molmoda/)) — Browser-based Vina via WebAssembly ([NAR 2024](https://academic.oup.com/nar/article/52/W1/W498/7680626)). Privacy story is excellent — all compute is client-side, IP never leaves the browser. Single-ligand only, no batch, no mutation. **Strategic note**: this is the privacy model biotechs will demand from us.

**Legacy / superseded**: PatchDock (rigid-body, last meaningful update ~2005), ClusPro 2.0 (protein-protein only, no batch), COACH-D (template-dependent meta-server).

### What's missing across the entire free tier

- Zero mutation support — every single tool requires the user to upload an already-mutated PDB
- No WT-vs-mutant comparison output
- No selectivity matrix across N compounds × M variants
- Batch UX is fragmented: results come back as ZIPs or unstyled tables
- No plain-English interpretation; users get raw Vina scores

---

## 2. Commercial / Desktop Tools

The paid incumbents — what small biotechs aspire to but mostly can't afford.

**Schrödinger Glide / Maestro / FEP+** ([schrodinger.com](https://www.schrodinger.com/platform/products/glide/)) — Gold standard. Commercial seats $100k+, academic ~$6–7.5k/year ([Capterra](https://www.capterra.com/p/207300/Schrodinger/)). FEP+ Protein Residue Mutation does alchemical mutation scanning to ~1 kcal/mol accuracy ([schrodinger.com/fep](https://www.schrodinger.com/platform/products/fep/)) — this is the closest existing implementation of what we want to build, and it's exactly the workflow we're democratizing. Now offers Maestro + LiveDesign as a SaaS, but pricing is still out of reach for our target segment.

**OpenEye OEDocking / FRED / HYBRID** ([eyesopen.com](https://www.eyesopen.com/oedocking)) — Now Cadence Molecular Sciences. Non-stochastic exhaustive docking, Chemgauss4 scoring. Handles protein flexibility via ensemble docking. No explicit mutation workflow. No public pricing.

**MOE** ([chemcomp.com](https://www.chemcomp.com/en/Products.htm)) — Has a "Load Mutation Sequence" feature and Protein Contacts tooling ([release notes](https://www.chemcomp.com/release_notes/moe202406/rnotes.htm)). Custom-quoted; academic discounts. Desktop-only.

**BIOVIA Discovery Studio** ([3ds.com](https://www.3ds.com/products/biovia/discovery-studio)) — CDOCKER engine; has a Mutation Energy (Binding) protocol that calculates pH-dependent ΔΔG. Token-based licensing, free visualizer. Cloud option via 3DEXPERIENCE.

**Cresset Flare** ([cresset-group.com](https://cresset-group.com/software/flare-docking/)) — Lead Finder scoring, ensemble docking, covalent inhibitor support. Free academic, paid commercial. Blaze SaaS for cloud screening.

**Molsoft ICM-Pro** ([molsoft.com](https://molsoft.com/icm_pro.html)) — Pricing is quote-only ([Molsoft pricing page](https://www.molsoft.com/price.cgi)); community reports suggest the low-thousands range, the lowest commercial tier. **The price ceiling we need to undercut.** Biased Probability Monte Carlo. No mutation module. Some benchmarks show ~45% pose accuracy vs. Glide's ~61% — startups accept the gap because of the cost saving.

**CCDC GOLD** ([ccdc.cam.ac.uk](https://www.ccdc.cam.ac.uk/solutions/software/gold/)) — Genetic algorithm docking, four scoring functions, KNIME integration. No mutation workflow.

### Why this tier matters for our positioning

Schrödinger's Residue Mutation FEP+ workflow is the proof that what we want to build is valuable enough to charge $100k+ for. We are explicitly the "good-enough, web-based, $0–500 version" of that workflow. Every biotech that has ever priced FEP+ and walked away is a target customer.

ICM-Pro (lowest commercial tier, low-thousands per year) is the practical price ceiling for our paid tier. Anything significantly above that and we lose to incumbents.

---

## 3. ML-Based Newcomers

The new generation. Either we wrap one of these as our engine, or someone else wraps it and builds the SaaS first.

**DiffDock / DiffDock-L** ([arxiv](https://arxiv.org/abs/2210.01776)) — Diffusion model. DiffDock-L hits 43% RMSD<2Å on PDBBind. Heavily criticized post-PoseBusters for failing physical-plausibility checks at higher rates than reported ([RSC](https://pubs.rsc.org/en/content/articlehtml/2024/sc/d3sc04185a)). Open source. Web wrappers already exist: [Tamarind Bio](https://www.tamarind.bio/), Neurosnap, ProteinIQ.

**Boltz-1 / Boltz-2** (MIT, MIT license, [github](https://github.com/jwohlwend/boltz)) — Joint structure + affinity prediction. Boltz-2 won CASP16 affinity at ~1000× FEP speed ([MIT](https://jclinic.mit.edu/boltz-2-towards-accurate-and-efficient-binding-affinity-prediction/)). Adopted by all 20 largest pharmas. ~20 sec/prediction on GPU. No dedicated MIT web product, but **already hosted by Tamarind, ProteinIQ, Rowan, and Neurosnap** ([Tamarind Boltz page](https://www.tamarind.bio/tools/boltz)) — meaning the wrapper-as-SaaS race is already underway, not an unclaimed opportunity.

**Chai-1 / Chai-2** ([Chai Discovery](https://chaiassets.com/chai-1/paper/technical_report_v1.pdf)) — Multi-modal foundation model. 77% PoseBusters success. Chai-2 (June 2025) showed 16–20% success on de novo antibody design. Open source. Web access via Tamarind, Rowan.

**Uni-Mol V2 / Uni-Dock** ([arxiv](https://arxiv.org/abs/2405.11769)) — Best PoseBusters validity scores (75% pass all checks). Uni-Dock is 2000× faster than Vina on a V100. Apache 2.0 since March 2025. **Strongest backend candidate** for our ML option.

**RoseTTAFold All-Atom** ([Science](https://www.science.org/doi/10.1126/science.adl2528)) — Baker Lab. Hybrid residue + all-atom. Strong in CAMEO blind docking but research-grade speed. Web access via Tamarind.

**AlphaFold 3** ([Nature](https://www.nature.com/articles/s41586-024-07487-w)) — Joint protein + nucleic acid + ligand prediction. Closed-source from DeepMind; academic access via the AlphaFold Server. Often insensitive to point mutations — the concept doc already flags this correctly.

### The PoseBusters debate (critical context)

The community lesson from 2024–2025: pure RMSD wins from ML methods don't translate to physically valid poses. DiffDock looks great on PDBBind and falls apart on novel sequences. Classical methods (GOLD, Vina) remain more robust. Pharma trust now requires post-ML physics rescoring. This shapes our messaging — **our default engine should be Vina/smina for credibility, with ML as an opt-in fast lane**, not the other way around.

### Threats forming

- **Tamarind Bio** ([tamarind.bio](https://www.tamarind.bio/)) — aggregator hosting DiffDock, Chai-1, RFAA, Boltz, etc. Closest thing to a competitor in the SaaS-for-ML-bio space. Doesn't do mutation workflows yet.
- **ProteinIQ** — DiffDock-L SaaS launched late 2025.
- **Rowan** — multi-tool aggregator, free tier.
- **ABCFold** ([Bioinformatics Advances 2025](https://academic.oup.com/bioinformaticsadvances/article/5/1/vbaf153/8176613)) — automates AF3/Boltz-1/Chai-1 conversion. Could trivially extend to mutations.

The risk: someone wraps Boltz-2 with a mutation UI before we ship.

---

## 4. Mutation-Specific Tools

These predict ΔΔG of mutations but mostly don't dock. They're either complementary (we integrate) or partial-overlap competitors.

**mCSM-lig** ([Sci Reports](https://doi.org/10.1038/srep29575)) — **Closest existing analog.** Predicts ΔΔG for ligand-binding mutations using graph-based ML. Web server, ρ=0.67 vs. experiment. Critical limitation: requires a pre-existing complex with the same ligand, returns only a scalar ΔΔG, doesn't dock new compounds, and produces no mutant 3D structure. Not a workflow tool, just a predictor.

**FoldX** ([humu](https://doi.org/10.1002/humu.23852)) — `BuildModel` generates mutant structures, `AnalyseComplex` scores them. The de facto backend for mutation building. No web server; we'd run it server-side. Already in our concept doc as Tier 2.

**Rosetta cartesian_ddg / ddG_monomer** — Structure-based ΔΔG, locally run, slower. Best accuracy on careful workflows. Heavy compute.

**DynaMut2** — Adds normal-mode dynamics to ΔΔG. Stability-only, no docking.

**MutaBind2** ([JMB 2023](https://doi.org/10.1016/j.jmb.2023.168060)) — Mutation effect on protein-protein interactions. PPI only, no ligand binding.

**MutationExplorer** ([NAR 2024](https://academic.oup.com/nar/article/52/W1/W132/7655781)) — New web tool for visualizing mutation effects. Doesn't dock.

**Sequence-based predictors** (DDGun, SAAFEC-SEQ, PROST) — No structure, no docking. Useful for filtering, not for our core workflow.

### Conclusion

No published tool combines mutation handling + novel compound docking + selectivity output. Researchers currently chain AlphaFold/FoldX → Vina → mCSM-lig → spreadsheet manually. **This multi-step manual workflow is exactly what we automate.**

---

## 5. User Pain Points (mined from forums)

Top eight themes from BioStars, Reddit, ResearchGate, and CCL.

### 1. Mutation modeling fragmentation (highest unmet need)
> "Modelling the effect of a mutation on protein structure requires combining multiple tools and approaches, as no single tool provides complete answers." — [BioStars #17444](https://www.biostars.org/p/17444/)

> "Uncertainties in docking results are too large to analyze fine changes like single point mutants." — [BioStars #7322](https://www.biostars.org/p/7322/)

### 2. Setup and installation friction
> "Installation instructions are not more detailed because to experienced users, this is a trivial exercise and does not require a tutorial, but to beginners, it's probably gibberish." — [BioStars #6406](https://www.biostars.org/p/6406/)

> "If Linux skills are limited, one has two choices: learn the skills needed and/or get help locally, as it's not easy to walk people through an installation remotely." — [BioStars #9615397](https://www.biostars.org/p/9615397/)

### 3. Scoring function unreliability
> "AutoDock Vina Gives Wildly Different Results From Different Simulations Using Same Parameters." — [BioStars #9497623](https://www.biostars.org/p/9497623/)

> "You can't really rely on every prediction it makes." (on DiffDock) — [310.ai blog](https://310.ai/blog/diffdock-for-drug-discovery)

> "How to tell if our ligand-protein docking is good?" — [BioStars #9475227](https://www.biostars.org/p/9475227/)

### 4. Protein preparation tedium
> "Researchers spend considerable time correcting common problems: missing hydrogen atoms, incomplete side chains/loops, ambiguous protonation states, flipped residues." — [Samson blog](https://blog.samson-connect.net/streamlining-protein-preparation-with-the-prepare-tool-in-fitted-suite)

### 5. Batch / high-throughput screening cost and time
> "Screening chemical databases by computational docking is prohibitively time consuming when the databases are very large. Limiting factors include number of commercial software licenses ('software cost') and long time per molecule." — [JCIM](https://pubs.acs.org/doi/10.1021/ci050089y)

### 6. Cost / licensing barrier
> "Schrödinger is the best option if you can afford it." (~$5k/year reported by users) — [Capterra](https://www.capterra.com/p/207300/Schrodinger/)

> "AutoDock Vina is recommended" for those without budget — implies a known quality gap. — [BioStars #115663](https://www.biostars.org/p/115663/)

### 7. Steep learning curve
> "Docking software is typically complicated and comes with a steep learning curve... Parameter optimization hinges on expert guidance, hindering adoption by broader range of investigators." — [IntechOpen](https://www.intechopen.com/chapters/1179019)

> "Docking as a procedure remains labor-intensive and intimidating to new users, thereby limiting wider adoption." — [JCIM](https://pubs.acs.org/doi/10.1021/acs.jcim.3c01406)

### 8. Protocol reproducibility / cross-docking failures
> "Choice of protein structure for docking a particular ligand has dramatic impact on performance — an important limitation in cross-docking." — [PMC10515787](https://pmc.ncbi.nlm.nih.gov/articles/PMC10515787/)

---

## 6. How We Win — Concrete Plays

Each play maps to one or more pain points and competitor weaknesses.

### Play 1 — Own the mutation workflow end-to-end
Nobody offers click-mutation → mutant build → WT+mutant docking → selectivity matrix as a single product. mCSM-lig is the closest and it's not even a workflow tool. Schrödinger does it but charges $100k+.

What this looks like in product: pick UniProt ID → select residue → pick mutation from dropdown → upload SMILES list → progress bar → matrix appears. Sub-five-minute first-result experience.

### Play 2 — Trust-first scoring
The PoseBusters debate is now permanently in the comp-chem zeitgeist. Lead with classical Vina/smina as default — it's what the community trusts. Offer Uni-Mol V2 or Boltz-2 as opt-in "fast mode," with PoseBusters checks visible on every result. Show a confidence ribbon (green/yellow/red) on every pose based on clash, chirality, and pose-cluster agreement.

### Play 3 — Plain-English interpretation
Direct competitors return "Vina score: -8.2." We return: *"Compound X is predicted to bind 1.2 kcal/mol better to T790M than WT, primarily through a new hydrophobic contact with M790."* Auto-generated from the interaction fingerprint via ProLIF.

### Play 4 — Privacy-first option (steal MolModa's wedge)
Biotechs won't upload proprietary structures to a server they don't trust. Offer a browser-only mode that runs Vina via WebAssembly — same engine as MolModa, but with the mutation-aware UI on top. This unlocks the small-biotech segment that would otherwise refuse.

### Play 5 — Aggressive freemium pricing
Free tier: 5 dockings/month, 1 mutation, public structures only.
Pro: $20/month or $200/year — unlimited dockings, batch mode, private uploads.
Team: $1k/year — multi-seat, API, priority queue.
Enterprise: custom — on-prem deploy.

This sits *below* the cheapest commercial tier (ICM-Pro, low-thousands/year) and creates a clear ladder.

### Play 6 — Educator package
The concept doc already targets educators. Build a $500/year/lab institutional license with pre-curated EGFR/KRAS/BRAF/IDH1/ABL teaching modules and student accounts. Schrödinger has nothing comparable at this price.

### Play 7 — One-page docs and a frictionless first run
Pain point #2 (setup friction) is bigger than people realize. We win every academic who Googles "AutoDock tutorial" and gives up. Three-click first result. No installation. No PDBQT. No grid box config.

### Play 8 — Be the Tamarind Bio for mutation work
Tamarind aggregates ML structure tools but doesn't do mutation workflows. Position as "the mutation-selectivity layer." If they expand into mutations, our existing UX and brand should already own the search results.

---

## 7. Risks and What Could Beat Us

- **Tamarind / Rowan / ProteinIQ adds a mutation module first.** Mitigate by shipping the MVP within ~2–3 months and getting waitlist signups now.
- **Schrödinger releases a free or freemium tier of FEP+ Residue Mutation.** Low probability — they protect the price floor — but watch for it.
- **Boltz-2 community releases a free "mutation comparison" pipeline as a public Colab notebook.** This is the realistic open-source threat. We need a UI moat (selectivity matrix, plain-English, viz) that a notebook can't match.
- **Big pharma builds internal versions and never adopts ours.** Acceptable — they're not the target segment per the concept doc.
- **Trust collapse if our scoring misleads.** Mitigate with explicit confidence indicators, links to PoseBusters checks, and a "what this score means" tooltip on every result.

---

## 8. Recommended Next Steps

1. **Ship the MVP demo from the concept doc** — mocked selectivity matrix for 5–10 clinical mutations × 20 known compounds. Pre-computed, no real backend yet.
2. **Lock the brand and domain.** MutaDock and DeltaDock are the strongest. Verify availability across .bio, .io, .com.
3. **Build a 2-minute landing-page demo video** showing the click → matrix → drill-down loop. This is the single asset that converts waitlist signups.
4. **Seed the waitlist in r/bioinformatics, r/comp_chem, BioStars, and the CCL list.** Direct-link the demo, not the concept doc.
5. **Reach out to 3–5 small biotechs and 3–5 educators directly.** Twenty-minute interviews to confirm the pain points and pricing tolerance documented above.
6. **Decide on default engine before building real backend.** Recommendation: Vina/smina for default, Uni-Mol V2 as opt-in fast mode. Boltz-2 as a v2 add-on once a web wrapper exists.

---

*End of report.*
