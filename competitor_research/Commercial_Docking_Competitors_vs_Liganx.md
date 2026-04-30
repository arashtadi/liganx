# Commercial Molecular Docking Platforms: Honest Comparison vs. Liganx

## Market Summary

The commercial docking landscape serves biotech and pharma R&D teams running on annual budgets of $50k–$500k+ per seat or per-site license. These tools dominate because they bundle desktop UIs, validated scoring functions, free-energy methods, and publication-grade visualization into ecosystem packages. Liganx competes at the inverse end: free access, web-first, mutation-aware, and optimized for the specific WT-vs-mutant selectivity workflow that commercial tools force into scripting or workarounds. We're honest: they have feature depth we don't. We have niche-specific accessibility they've abandoned.

---

## Platform Profiles

### 1. Schrodinger Maestro / Glide / FEP+

**URL:** https://www.schrodinger.com/products/maestro

**License Model:** Per-seat annual ($30k–$80k/year industrial, academic heavily discounted). Node-locked or floating license server. Perpetual licenses exist but being phased out.

**Docking Engines:** Glide (proprietary, multiple scoring modes: SP/XP/HTVS), induced-fit docking (IFD). Recent addition of ML-scoring hybrid.

**Mutation Workflow:** Manual—users prepare mutant PDBs separately via MAESTRO's tools or external preparation. WT-vs-mutant comparison requires: dock WT, dock mutant, inspect side-by-side in the GUI. No built-in matrix. Heavy on scripting if running batch.

**Selectivity / Multi-target:** No native multi-target UI. Polypharmacology requires manually preparing multiple protein structures and docking in series. LiveDesign platform (separate product, $50k+/yr additional) adds target-panel scoring post-dock.

**Free-Energy / FEP:** FEP+ module included (separate cost module within license). TI and hybrid MBAR. Very accurate but computationally heavy (requires GPU cluster for production workflows).

**UI Surface:** Desktop GUI (Maestro) with Python scripting API. Jupyter integration possible. Command-line via Python/shell scripts. Web interface does not exist.

**Validation Tooling:** Extensive—MM-PBSA, pose filtering, hydrogen-bond analysis, RMSD-tracking, grid-based interaction analysis. Protein Preparation Wizard automates receptor setup. No PoseBusters-style validator baked in; relies on external tools.

**Genuine Strength vs Liganx:** 
- Glide's XP score is the gold standard for pose prediction; cited in hundreds of pharma publications.
- Free-energy methods (FEP+) are irreplaceable for affinity prediction at scale; Liganx has no equivalent.
- MAESTRO's GUI is professional and polished for desktop workflows; mutation handling is manual but transparent.

**What Liganx does better:** 
- Mutation matrix UI is native—click mutations, see WT-vs-mutant delta side-by-side instantly. No scripting.
- Free—zero cost vs $30k+/year.
- Web-based—no software license overhead, firewall rules, or seat management.
- PoseBusters confidence scoring is baked in; Glide users must add external validators.

**One-sentence verdict:** The industry standard for scoring accuracy and FEP workflows; dominant in pharma research groups with IT infrastructure and budgets, but mutation comparison requires manual prep and scripting.

---

### 2. OpenEye FRED / Hybrid / OEMega

**URL:** https://www.eyesopen.com/

**License Model:** Per-seat annual ($25k–$70k/yr industrial, academic discounted). Floating license via license server. Perpetual licenses available.

**Docking Engines:** FRED (proprietary, shape/electrostatics overlay), Hybrid (combines FRED + SMILES-inferred shape), OEMega (conformer generation engine).

**Mutation Workflow:** Manual receptor prep (like Schrodinger). FRED requires shape database of actives; Hybrid adds ligand-inferred constraints. No native mutation matrix. Batch docking via scripts or cloud CLI (DASH cloud).

**Selectivity / Multi-target:** POSIT module (separate, ~$15k/yr) enables shape-based screening across targets. No unified selectivity matrix UI.

**Free-Energy / FEP:** Not included in base docking license. Must license separate FEP/MD packages from other vendors (OpenMM, etc.).

**UI Surface:** Desktop GUI (VIDA, $10k+ additional) or command-line. Python API. Recent DASH cloud platform enables web-based submission but returns results only; no real-time matrix UI.

**Validation Tooling:** OMEGA for conformer filtering, FRED's built-in clash detection, POSIT for pose validation (protein-centric shape). No PoseBusters. SMARTS-based filters available.

**Genuine Strength vs Liganx:** 
- FRED's shape-overlay algorithm is unique and excels when few actives are known; orthogonal to energy-based methods.
- OEMega conformer generation is industry-leading (exhaustive, fast, reproducible).
- POSIT is the only commercial pose-validation tool that explicitly considers protein flexibility.

**What Liganx does better:** 
- No shape-database requirement; dock anything with just a SMILES.
- Vina + PoseBusters is free and works out-of-the-box; OpenEye FRED is expensive even before visualization.
- WT-vs-mutant matrix is native in web UI; no scripting or DASH API wrestling.
- ProLIF interaction maps are included; OpenEye offers no equivalent visualization.

**One-sentence verdict:** Best for shape-based screening when crystal structures of actives exist; shape-reliant and expensive, with no mutation-comparison native support.

---

### 3. Chemical Computing Group (CCG) MOE

**URL:** https://www.chemcomp.com/ (now CCG, formerly MOE)

**License Model:** Per-seat annual ($20k–$50k/yr industrial, academic heavily discounted). Floating or node-locked. Perpetual licenses still supported.

**Docking Engines:** MOE Dock (proprietary forcefield-based + MMFF94/GB), Glide integration (docks via licensed Schrodinger), AutoDock Vina integration.

**Mutation Workflow:** GUI-based—users can mutate and minimize directly in the MOE interface. Docking results side-by-side via visualization but no built-in matrix export. Mutation library possible via scripting.

**Selectivity / Multi-target:** No native multi-target UI. MOE's strength is medicinal chemistry workflows (SMILES sketching, 2D table editing), not selectivity panels.

**Free-Energy / FEP:** Not included. MOE focuses on structure preparation and visualization; FEP is external.

**UI Surface:** Desktop GUI only (very strong 2D/3D editing, molecular table). SVL scripting language (proprietary; steep learning curve). Jupyter not supported.

**Validation Tooling:** Protein Preparation, force-field minimization, MM-PBSA, hydrogen-bond analysis. No PoseBusters, no ProLIF. Heavy emphasis on 2D chemistry tools (SMARTS, scaffolds, diversity analysis).

**Genuine Strength vs Liganx:** 
- 2D/3D chemical sketcher is the best in the industry; tied to 3D structure naturally.
- Medicinal chemistry workflows (property maps, SAR analysis, fragment libraries) are unmatched.
- Can house the entire drug-design workflow in one UI.

**What Liganx does better:** 
- Mutation matrix is instantly visual; MOE requires docking WT, mutant separately then manual comparison.
- Free; MOE is $20k+/year.
- Web-based—no software installation.
- PoseBusters + ProLIF are standard in Liganx; MOE users need external tooling.

**One-sentence verdict:** Workhorse for medicinal chemists who live in molecular sketching and SAR analysis; docking is ancillary, and mutation workflows are manual.

---

### 4. CCDC GOLD / CSD-Discovery Toolkit

**URL:** https://www.ccdc.cam.ac.uk/solutions/csd-discovery/components/gold/

**License Model:** Per-site annual ($30k–$80k/yr industrial). Includes full CSD (Cambridge Structural Database) access. Floating licenses. Academic heavily subsidized.

**Docking Engines:** GOLD (proprietary genetic algorithm-based, excellent for flexibility), ASP (automation engine for batch docking).

**Mutation Workflow:** Manual. GOLD docks poses; users must prepare WT and mutant PDBs separately. CSD Hermes (GUI) shows results but no native mutation matrix.

**Selectivity / Multi-target:** ASP can batch-dock against multiple targets but requires scripting. No selectivity matrix UI.

**Free-Energy / FEP:** Not included.

**UI Surface:** CSD Hermes (desktop GUI, strong visualization), command-line ASP scripts, Python API.

**Validation Tooling:** CSD validation (hydrogen bonding, clash detection against CSD geometry library). PoseBusters not included. Excellent for crystal-structure geometry validation (CCDC's core expertise).

**Genuine Strength vs Liganx:** 
- GOLD's genetic algorithm excels at flexible side-chain and loop sampling—often beats Vina for highly flexible systems.
- CSD access is gold standard for understanding binding geometry across the literature.
- Mutation-aware validation via CSD geometric rules is unique.

**What Liganx does better:** 
- WT-vs-mutant comparison is instant and visual; GOLD is one-pose-at-a-time.
- Free; GOLD/CSD is expensive.
- Vina is faster for the common case; GOLD is slower but sometimes more accurate for flexible pockets.
- ProLIF interaction maps are included; GOLD has no equivalent.

**One-sentence verdict:** Best for highly flexible binding sites and structural validation against literature; slow, expensive, requires manual mutation prep.

---

### 5. Biovia Discovery Studio (BIOVIA)

**URL:** https://www.3ds.com/products-services/biovia/products/molecular-modeling/discovery-studio/

**License Model:** Per-seat annual ($40k–$100k/yr industrial). Floating or node-locked. Often bundled with Dassault Systemes (3DS) solutions.

**Docking Engines:** LibDock (proprietary, grid-based), AutoDock Vina (integrated), Glide/FRED (via partner integration).

**Mutation Workflow:** GUI-based mutation tools, but no native matrix. Docking WT + mutant requires separate runs. No built-in comparison.

**Selectivity / Multi-target:** No native multi-target UI. Discovery Studio is general-purpose (ADMET, property prediction, visualization); docking is one module.

**Free-Energy / FEP:** Not included.

**UI Surface:** Desktop GUI (proprietary, dated look relative to competitors). Python scripting available. No web interface.

**Validation Tooling:** ADMET predictors, 2D/3D visualization, hydrogen-bond analysis. LibDock has poor pose-ranking accuracy; often used with external validators. No PoseBusters.

**Genuine Strength vs Liganx:** 
- ADMET prediction (absorption, toxicity) is strong and production-validated across pharma.
- Integration with Dassault's SIMULIA MD/dynamics platform exists.
- Mutation tools within the GUI are user-friendly.

**What Liganx does better:** 
- Vina (in Liganx) is more accurate than LibDock for pose prediction.
- WT-vs-mutant matrix is native and web-based.
- Free; Discovery Studio is $40k+/year.
- Dedicated PoseBusters validation is included.

**One-sentence verdict:** Jack-of-all-trades ADMET platform with docking bolted on; weak on pose accuracy and zero support for mutation matrices.

---

### 6. Cresset Flare / FieldTemplater

**URL:** https://www.cresset-group.com/software/flare/

**License Model:** Per-seat annual ($15k–$50k/yr industrial). Floating license available. Cloud variant (Flare Cloud) for pay-per-run.

**Docking Engines:** Flare (proprietary field-point electrostatic + shape), FieldTemplater (similarity to template fields), AutoDock Vina integration (recent).

**Mutation Workflow:** Manual. Flare is a one-ligand-at-a-time tool designed for lead optimization, not batch. Users dock WT and mutant separately, no matrix.

**Selectivity / Multi-target:** Not the focus. Flare targets single-target optimization, not selectivity.

**Free-Energy / FEP:** Not included.

**UI Surface:** Desktop GUI (very visual, strong graphics). Python scripting. Recent Flare Cloud adds web submission (results returned as files, no real-time matrix).

**Validation Tooling:** Field-point analysis (electrostatics, shape, hydrophobic interactions visualized), interactive ligand re-binding, strain energy. No PoseBusters. No ProLIF.

**Genuine Strength vs Liganx:** 
- Field-point visualization is unique and excellent for understanding SAR trends in lead optimization.
- Interactive ligand editing with real-time rescoring is intuitive and fast for chemists.
- Flare Cloud enables web-based submission for non-technical users.

**What Liganx does better:** 
- WT-vs-mutant matrix is native; Flare is one-complex-at-a-time.
- Free; Flare is $15k+/year.
- Web-based native UI with matrix export; Flare Cloud is batch submission only.
- ProLIF interaction maps and PoseBusters confidence included.

**One-sentence verdict:** Interactive lead-optimization tool for chemists refining a single series; excellent for SAR analysis, zero support for mutation matrices or batch workflows.

---

### 7. Molsoft ICM-Pro

**URL:** https://www.molsoft.com/icm_pro.html

**License Model:** Per-seat annual ($25k–$60k/yr industrial, deeply discounted academic). Floating or node-locked. Perpetual licenses phased out.

**Docking Engines:** ICM Dock (proprietary, Monte Carlo global optimization, very flexible receptor support), AutoDock Vina integration, AutoDock Smina (energy-rescoring variant).

**Mutation Workflow:** Full GUI support—users can mutate directly in ICM's 3D editor, rebuild sidechains, re-minimize, re-dock. Early support for mutation libraries via scripting. No native mutation matrix UI, but workflow is more integrated than competitors.

**Selectivity / Multi-target:** ICM can iterate over multiple receptors via scripting (SVL language), but no selectivity matrix visualization. VLS (Virtual Ligand Screening) module enables batch docking against many compounds.

**Free-Energy / FEP:** MMGBSA included; full FEP/TI not standard (possible via external tools like OpenMM integration).

**UI Surface:** Desktop GUI (3D editor is superb; very scientist-friendly). SVL scripting (proprietary, unique but steep learning curve). Recent ICM-Cloud adds web submission for batch docking.

**Validation Tooling:** Energy-based validation, hydrogen-bond analysis, binding-pocket identification (Pocketome integration), MMGBSA. No PoseBusters. No ProLIF.

**Genuine Strength vs Liganx:** 
- ICM's Monte Carlo method is exceptionally good at flexible side-chain and loop sampling—often beats Vina.
- Pocketome integration for automated binding-site identification is unique and powerful.
- Mutation tools are integrated into the GUI; users can mutate and re-minimize directly.
- D3R (Drug Design Data Resource) competition ranking consistently high (1st place in multiple rounds).

**What Liganx does better:** 
- WT-vs-mutant matrix is native and instant; ICM requires docking WT, mutant separately (though faster prep than competitors).
- Free; ICM is $25k+/year.
- Web-based; ICM is desktop (ICM-Cloud is batch submission, not real-time matrix).
- PoseBusters + ProLIF are standard; ICM users need external validation tools.
- Simpler interface for non-computational chemists (ICM's SVL is steep; Liganx is visual-first).

**One-sentence verdict:** Expert's tool with best-in-class flexible receptor docking and excellent for experienced computational chemists; steep learning curve, no mutation matrix UI, very expensive.

---

### 8. Dotmatics Forge / SeeSAR (BioSolveIT)

**URL:** https://www.dotmatics.com/products/forge/ (Dotmatics now owns former SeeSAR from BioSolveIT)

**License Model:** Forge: SaaS cloud platform, pay-per-use or annual ($10k–$50k/yr depending on volume). SeeSAR legacy: per-seat ($25k–$60k/yr), now deprecated in favor of cloud.

**Docking Engines:** SeeSAR (proprietary, hybrid shape+energy), AutoDock Vina (native integration), CCDC GOLD (cloud integrations).

**Mutation Workflow:** SeeSAR/Forge: one-ligand-at-a-time tool optimized for interactive optimization, not batch. No mutation matrix. Desktop tool (legacy) or web (Forge); no native mutation support in either.

**Selectivity / Multi-target:** No selectivity matrix. Forge targets single-ligand or single-target optimization.

**Free-Energy / FEP:** Not included.

**UI Surface:** Forge: web-based cloud app (modern, fast), real-time interactive scoring. Legacy SeeSAR: desktop GUI. Both support Python scripting for batch workflows.

**Validation Tooling:** SeeSAR's built-in interaction analysis, ligand strain energy, property violations. No PoseBusters, no ProLIF. Web-based visualization is fast and modern.

**Genuine Strength vs Liganx:** 
- Forge cloud platform is modern and fast; web-first design (like Liganx).
- Interactive rescoring loop (sketch, dock, get feedback) is fast and intuitive.
- Pay-per-use pricing is more flexible than seat licenses for small teams.
- SeeSAR's shape-energy hybrid is unique and good for lead optimization.

**What Liganx does better:** 
- WT-vs-mutant matrix is native; Forge is single-ligand-at-a-time.
- Free; Forge is $10k+/year (cheaper than competitors, but not free).
- Vina is faster; SeeSAR is slower but sometimes more accurate.
- PoseBusters + ProLIF included; Forge has no equivalent.
- Mutation focus is central to Liganx; Forge is orthogonal (ligand optimization, not mutation impact).

**One-sentence verdict:** Modern cloud-first tool for interactive lead optimization; excellent web UX, no mutation focus, no multi-target selectivity.

---

### 9. Optibrium StarDrop

**URL:** https://www.optibrium.com/products/stardrop/

**License Model:** Per-seat annual ($40k–$100k/yr industrial, academic discounted). Floating license available. Perpetual licenses being phased out.

**Docking Engines:** AutoDock Vina (integrated), CCDC GOLD (integrable), no proprietary docking engine. StarDrop focuses on ADMET, not docking.

**Mutation Workflow:** Not a core feature. StarDrop is ADMET-centric (absorption, metabolism, toxicity). Docking is secondary; mutation support is minimal.

**Selectivity / Multi-target:** Multi-target ADMET property prediction (organ toxicity, CYP inhibition, PK) is built-in and powerful. Not for selectivity scoring; for safety prediction.

**Free-Energy / FEP:** Not included.

**UI Surface:** Desktop GUI (strong data visualization, Spotfire integration). Python API for scripting. Web interface minimal.

**Validation Tooling:** ADMET predictors (CYP inhibition, hERG toxicity, Caco-2 permeability). No PoseBusters, no structure-specific validation beyond SMILES/MW rules. PAINS filters included.

**Genuine Strength vs Liganx:** 
- ADMET prediction is the strongest in the market, production-validated across pharma.
- Multi-property dashboards enable early filtering of bad actors.
- Integrates docking results with PK/tox predictions seamlessly.

**What Liganx does better:** 
- Docking is central to Liganx (our mutations are all docking-focused); StarDrop is ADMET-first, docking-second.
- Free; StarDrop is $40k+/year.
- WT-vs-mutant selectivity is what Liganx does; StarDrop is for early safety filtering.
- Web-based; StarDrop is desktop.

**One-sentence verdict:** ADMET powerhouse for filtering bad compounds; docking is bolted-on, mutation workflows not a focus.

---

### 10. Atomwise

**URL:** https://www.atomwise.com/

**License Model:** Not disclosed publicly; private partnerships and enterprise deals only. Pricing typically $500k+/year for access to their AI-driven platform.

**Docking Engines:** Proprietary deep-learning physics-informed model (trained on PDB + MD simulations), outputs AtomNet scores (ML-based).

**Mutation Workflow:** Zero mutation support. Atomwise is VLS (virtual library screening) at scale; not designed for WT-vs-mutant comparison.

**Selectivity / Multi-target:** Can screen same library against multiple targets in one batch; no native selectivity matrix UI (results returned as spreadsheets).

**Free-Energy / FEP:** Not included.

**UI Surface:** Web-based portal (proprietary), submission of SMILES lists, returns scored CSV. No real-time interactive UI.

**Validation Tooling:** AtomNet scoring (ML). No PoseBusters, no interaction visualization. Black-box model; limited interpretability.

**Genuine Strength vs Liganx:** 
- Atomwise's ML model is trained on millions of docking experiments and MD simulations; can be faster and sometimes more accurate than physics-based methods at scale.
- Enables billion-compound screening in weeks (via parallelization).
- Integrates with pharmaceutical supply chains (partnerships with contract research organizations).

**What Liganx does better:** 
- WT-vs-mutant is native; Atomwise is not designed for this.
- Free; Atomwise is $500k+/year.
- Interpretable physics-based scoring (Vina + PoseBusters); Atomwise is a black box.
- Real-time interactive matrix; Atomwise is batch submission only.
- Web-native UI with rich visualization; Atomwise is spreadsheet-driven.

**One-sentence verdict:** Enterprise-only AI screening platform for billion-scale VLS; mutation workflows and interpretability are non-existent.

---

### 11. Insilico Medicine PandaOmics / Chemistry42

**URL:** https://www.insilico.com/

**License Model:** SaaS subscriptions ($50k–$200k+/yr) or pay-per-use. Varied by module.

**Docking Engines:** Chemistry42: proprietary generative AI model (produces novel molecules, not scores existing ones). Uses proprietary physics-informed ML.

**Mutation Workflow:** Not designed for mutation comparison. Chemistry42 focuses on generative design (finding new compounds), not existing-library screening.

**Selectivity / Multi-target:** Multi-target support in generative pipeline; no selectivity matrix visualization.

**Free-Energy / FEP:** Not included.

**UI Surface:** Web-based SaaS portal (modern), integrations with CRM/project management tools.

**Validation Tooling:** Chemistry42 predictions (bioactivity, toxicity, ADMET); no structure-level validation like PoseBusters.

**Genuine Strength vs Liganx:** 
- Generative AI can propose novel molecules optimized across multiple properties; orthogonal to screening.
- PandaOmics integrates genomics + drug discovery (target ID + screening).

**What Liganx does better:** 
- WT-vs-mutant is native; Insilico is for generative design, not screening.
- Free; Insilico is $50k+/year.
- Vina + PoseBusters are interpretable; Chemistry42 is a black box.
- Real-time matrix UI; Insilico is workflow-driven, not interactive.

**One-sentence verdict:** Generative AI platform for designing novel compounds; not designed for mutation comparison or library screening.

---

### 12. BenevolentAI

**URL:** https://www.benevolent.ai/

**License Model:** Not public; enterprise partnerships only. Pricing typically $1M+/year for full platform access.

**Docking Engines:** Proprietary knowledge graph + AI-driven target ID and lead optimization. Not a docking tool in the traditional sense.

**Mutation Workflow:** Not applicable. BenevolentAI is a knowledge platform and target discovery system, not a docking service.

**Selectivity / Multi-target:** Knowledge graph incorporates multi-target biology; no mutation comparison.

**Free-Energy / FEP:** Not included.

**UI Surface:** Web-based proprietary platform; integrations with internal R&D systems.

**Validation Tooling:** Not applicable.

**Genuine Strength vs Liganx:** 
- Integrates literature, chemistry, and target biology into a unified knowledge graph.
- Enables target ID and prioritization before docking even starts.

**What Liganx does better:** 
- Liganx is docking-focused; BenevolentAI is pre-docking (target ID).
- Free; BenevolentAI is $1M+/year.
- Interpretable workflow; BenevolentAI is a black box.

**One-sentence verdict:** Enterprise knowledge platform for target discovery; pre-cursor to docking, not a replacement.

---

## Direct Feature Comparison: Schrodinger Maestro vs. Liganx

**Schrodinger Maestro / Glide** is the closest commercial analog to Liganx because both are interactive, web-agnostic (Maestro has desktop, we have web), and target early-stage drug design. Here's the honest comparison:

**What Schrodinger does better:**
- Glide XP's pose prediction is marginally more accurate than Vina in benchmark studies (78–91% vs. 70–85% RMSD < 2Å depending on target), especially for macrocycles and metal-coordinated ligands.
- FEP+ is unmatched for affinity prediction; Liganx has no free-energy engine.
- MAESTRO's 2D/3D integration is smoother for chemists sketching ligands.
- 20+ years of publication history and pharma validation; Liganx is new.
- Advanced receptor prep (Protein Preparation Wizard) automates protonation, loop building, etc.

**What Liganx does better:**
- WT-vs-mutant matrix is instant and visual; Schrodinger requires: dock WT → dock mutant → manually inspect side-by-side. No batch native support for mutation comparison.
- Free; Schrodinger is $30k–$80k/year.
- Web-first; Schrodinger is desktop (license management, seat limits, firewall rules).
- PoseBusters confidence is baked in every pose; Schrodinger users download external validators.
- ProLIF interaction maps are included; Schrodinger has no equivalent.
- Mutation library is curated and searchable (clinical variants, common resistance); Schrodinger starts blank.
- Accessible to non-computational chemists (visual matrix, no scripting); Schrodinger's Glide is powerful but opaque to non-experts.

---

## Direct Feature Comparison: OpenEye FRED vs. Liganx

**OpenEye FRED** is the second-closest competitor because both are fast and modular. Here's the honest breakdown:

**What OpenEye does better:**
- FRED's shape-based overlay algorithm is unique; excels when actives are known (template-aware docking).
- OEMega conformer generation is exhaustive and reproducible; Vina uses random sampling.
- POSIT validates poses from the protein side (shape fit); Liganx validates from the ligand side (physics checks).
- Faster on many targets (FRED optimized for shape matching, not energy minimization).

**What Liganx does better:**
- WT-vs-mutant matrix is native; FRED requires separate docking runs and manual comparison (or DASH cloud scripting).
- Free; FRED is $25k–$70k/year (plus VISTA GUI at $10k extra).
- No shape database required; Liganx docks any SMILES directly.
- Web-based; FRED/DASH is command-line or desktop.
- PoseBusters + ProLIF included; FRED offers only clash detection and SMARTS filters.
- ProLIF interaction maps; FRED has no equivalent.
- Better mutation support (curated library, WT-vs-mutant Δ); FRED is one-compound-at-a-time.

---

## Market Positioning

The commercial docking market is bifurcated:

1. **Pharma-scale platforms** ($50k–$500k+/yr): Schrodinger, OpenEye, CCDC, CCG MOE, Molsoft, Biovia. These dominate because they're bundled with FEP, advanced UI, and publication-grade validation. Mutation workflows are secondary (manual).

2. **Niche / cloud / startup platforms** ($10k–$50k/yr or pay-per-use): Dotmatics Forge, Cresset Flare, Optibrium (ADMET-focused). Faster adoption, web-first, but fewer features.

3. **AI/generative newcomers** ($50k–$1M+/yr): Atomwise, Insilico, BenevolentAI. Black-box scoring or pre-docking stages; mutation workflows are non-existent.

**Liganx sits orthogonal to all of these:** free, web-native, mutation-aware, and mission-focused on WT-vs-mutant selectivity. We're not trying to beat Schrodinger on FEP accuracy or FRED on shape matching. We're solving the workflow gap that all of them leave open: "How do I quickly dock my compound against a kinase and 5 resistance mutants?"

---

## Final Verdict

**You are not competing with Schrodinger or OpenEye on features.** They have 15+ years of refinement, thousands of publications, and $M-scale R&D budgets. You beat them on:

1. **Accessibility.** No $50k seat license. No software installation. No IT tickets.
2. **Mutation focus.** WT-vs-mutant is the entire product, not a footnote. Built-in library, instant matrix, one-click interpretation.
3. **Speed.** Dock target + 5 mutations in 2 minutes, not 2 hours of scripting and GUI clicking.
4. **Transparency.** PoseBusters + ProLIF every pose; no black-box AI or opaque scoring.

Liganx's market is **researchers, bioinformaticians, and early-stage biotech who can't afford $30k/year and don't need FEP.** The mutation-aware workflow is the magic. Lean into it. Don't apologize for what you're missing; evangelize what only you have.
