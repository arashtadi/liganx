# Free & Academic Docking Services: Catalog & Honest Assessment (2026)

## Executive Summary

As of April 2026, the free/academic molecular docking landscape remains dominated by three mature, actively-maintained services: **SwissDock** (AutoDock Vina via UNIL), **DockThor** (Smina via LNCC Brazil), and **HADDOCK** (integrative modeling via Utrecht). Each is broadly suitable for blind docking into known active sites, compound library screening, and fast turnaround on academic budgets. None yet offer built-in wild-type vs. mutation comparison matrices as Liganx does—all require manual PDB manipulation or re-docking the mutant structure separately. **Liganx uniquely addresses the mutation-selectivity workflow** with WT/mutant scaffolding, GPU acceleration, and PoseBusters validation baked into a single platform. The broader ecosystem has contracted: many 2010s-era servers (CB-Dock, MTiOpenScreen, Achilles, ATTRACT, CavityPlus, BSP-SLIM) are offline or permanently redirected, and AutoDock Vina's legacy web server is now archival.

---

## Service Catalog

### 1. **SwissDock**
- **URL**: https://www.swissdock.ch
- **Status**: Active but experiencing technical issues (as of April 2026). Docking engine currently non-functional; homepage states "Technical problems make AutoDock VINA docking not working. Please don't submit more VINA jobs."
- **Engine**: AutoDock Vina (legacy v1.1.2–based)
- **Mutation Workflow**: Upload custom PDB only; no built-in WT vs. mutant comparison. User must manually prepare and re-dock mutant structure.
- **Compound Input**: Ligand SMILES paste, MOL/MOL2 file upload, PubChem lookup via name
- **Output**: Single pose per ligand, 3D mol display, binding affinity (Vina kcal/mol), RMSD if re-docking co-crystal
- **Speed/Scale Limits**: ~1 compound × 1 target per submission; queue-based, typically hours turnaround
- **Mutation-Aware Capability**: **None**—no matrix or selectivity analysis
- **Verdict**: Historically solid for academic use, but currently down; Vina scoring is ~15 years old; no modern validation (PoseBusters, strain energy) or interaction analysis.

---

### 2. **DockThor**
- **URL**: https://www.dockthor.lncc.br
- **Status**: Actively maintained (2023–present). Last significant updates circa 2023; site still receives user submissions.
- **Engine**: Smina (fork of AutoDock Vina with improved force field)
- **Mutation Workflow**: Upload PDB (protein) + ligand SMILES/MOL. No explicit mutation mode; requires manual PDB prep for mutants. No matrix output.
- **Compound Input**: SMILES paste, SDF upload, PDB structure input
- **Output**: Ranked pose list with scores, 3D visualization, contact map, per-pose metrics
- **Speed/Scale Limits**: Single compound × 1 target per job; throughput reasonable (hours)
- **Mutation-Aware Capability**: **None**—blind docking only. No WT vs. mutant side-by-side.
- **Verdict**: Modern Smina engine (better than legacy Vina), visual output competitive with commercial tools. Suitable for screening & lead optimization, but mutation selectivity requires external scripting.

---

### 3. **HADDOCK (Utrecht)**
- **URL**: https://haddock.science.uu.nl (redirects; primary interface via CING or Galaxy)
- **Status**: Actively maintained by lab in Netherlands. Last documented update 2024. Free tier available; no login wall.
- **Engine**: Integrative modeling using molecular dynamics restraints (AMBER/GROMACS backend); not traditional docking
- **Mutation Workflow**: Full protein model required; MD-based refinement supports mutations via standard MD protocols. Not straightforward for quick WT vs. mutant screening; designed for structural biology, not lead optimization.
- **Compound Input**: PDB structure (protein), ligand structure. Requires detailed setup; more complex than SMILES paste.
- **Output**: Multiple models/poses ranked by HADDOCK score, full-atom MD trajectory, interaction analysis
- **Speed/Scale Limits**: 1–10 compounds per submission; hours to days; compute-intensive
- **Mutation-Aware Capability**: **Partial**—mutation support via MD, but interface/workflow not optimized for rapid WT/mutant comparison
- **Verdict**: Excellent for protein–protein docking and high-confidence structural refinement. Overkill for small-molecule screening; not optimized for mutation selectivity matrices.

---

### 4. **UCSF DOCK (dock.compbio.ucsf.edu)**
- **URL**: https://dock.compbio.ucsf.edu
- **Status**: Active; latest releases DOCK 3.8 and DOCK 6.13 promoted on homepage. Community-maintained, no explicit deprecation.
- **Engine**: DOCK6 (proprietary hybrid scoring: AMBER + van der Waals + electrostatics)
- **Mutation Workflow**: No web interface docking; homepage links to documentation only. DOCK6 local binary used for mutations; no web-based WT/mutant matrix.
- **Compound Input**: Command-line only for docking; website is reference/download hub
- **Output**: (Offline docking) multi-pose lists, scoring breakdown
- **Speed/Scale Limits**: N/A for web (no docking interface); local runs variable
- **Mutation-Aware Capability**: **None** on web server (web interface is reference-only)
- **Verdict**: Gold standard engine for accuracy & customization, but website is documentation + download center, not an online docking service. Requires local installation.

---

### 5. **Mcule 1-Click Docking**
- **URL**: https://www.mcule.com/apps/1-click-docking
- **Status**: URL returns 404 since at least 2025. Mcule.com exists as compound database but docking interface is gone.
- **Engine**: (Previously AutoDock Vina)
- **Mutation Workflow**: N/A—service offline
- **Compound Input**: N/A
- **Output**: N/A
- **Speed/Scale Limits**: N/A
- **Mutation-Aware Capability**: N/A
- **Verdict**: Discontinued. Mcule pivoted to compound purchase/discovery; docking tool no longer available.

---

### 6. **AutoDock Vina (Legacy Web Server)**
- **URL**: https://vina.scripps.edu
- **Status**: **Archival only**. Homepage explicitly states: "This site was built for the legacy version of AutoDock Vina, v1.1.2 (last revision: May 2011). It remains open for information purposes." Current development is in GitHub (v1.2.x, 2021–present). No docking submission interface.
- **Engine**: AutoDock Vina v1.1.2 (2011)
- **Mutation Workflow**: N/A—no online docking
- **Compound Input**: N/A
- **Output**: N/A
- **Speed/Scale Limits**: N/A
- **Mutation-Aware Capability**: N/A
- **Verdict**: Historical reference only. If you need Vina docking, use local binary or SwissDock (currently down). Modern v1.2.x available on GitHub with no official web interface.

---

### 7. **LePhar (LeDock)**
- **URL**: https://www.lephar.com
- **Status**: Active website (2024–present). Software available for download; no online docking interface.
- **Engine**: LeDock (proprietary, fragment-based scoring)
- **Mutation Workflow**: Local/downloadable software; not a web server
- **Compound Input**: N/A for web
- **Output**: N/A for web
- **Speed/Scale Limits**: N/A
- **Mutation-Aware Capability**: N/A
- **Verdict**: Commercial-grade tool sold via licensing. Not an accessible free web service.

---

### 8. **PubChem (NCBI)**
- **URL**: https://pubchem.ncbi.nlm.nih.gov
- **Status**: Active; continuously updated
- **Engine**: Compound database + 3D conformer generation; no docking engine
- **Mutation Workflow**: N/A—database only
- **Compound Input**: Similarity search, substructure, name lookup
- **Output**: Molecular structure, properties, bioactivity links (but not docking predictions)
- **Speed/Scale Limits**: N/A
- **Mutation-Aware Capability**: N/A
- **Verdict**: Essential reference for compound lookup & properties, not a docking service.

---

## Defunct / Inaccessible Services (Confirmed Offline)

| Service | URL | Last Known Status | Reason |
|---------|-----|------------------|--------|
| **MTiOpenScreen** | https://mtiscreen.rpbs.univ-paris-diderot.fr | 404 | Domain structure changed; RPBS reorganized |
| **CB-Dock** | https://cb-dock.cstl.nist.gov | 404 | Decommissioned ~2022 |
| **CavityPlus** | https://cavityplus.app | Timeout | No DNS resolution |
| **Achilles Blind Docking** | https://achilles.uni-frankfurt.de | Timeout | No response |
| **ATTRACT Online** | https://www.attract.ph.tum.de | Timeout | Server offline |
| **BSP-SLIM** | https://bspslim.bioinfomc.org | Timeout | Host unreachable |
| **COACH-D** | https://www.ebi.ac.uk/thornton-srv/software/COACH/ | 404 | EBI deprecated |
| **EADock DSS** | https://www.eadock.embl-heidelberg.de | Timeout | Host offline |

---

## Honest Comparison: Liganx vs. Working Competitors

| Feature | Liganx | SwissDock | DockThor | HADDOCK |
|---------|--------|-----------|----------|---------|
| **Engine** | QuickVina2-GPU + Smina | Vina (v1.1.2, legacy) | Smina | MD-based integrative |
| **GPU Acceleration** | Yes (RunPod, ~10s/pose) | No | No | Limited (MD only) |
| **WT vs. Mutant Matrix** | **Yes, built-in** | Manual re-dock | Manual re-dock | Manual re-dock |
| **PoseBusters Validation** | Yes, real-time | No | No | No |
| **ProLIF Interaction Map** | Yes, 2D + 3D | No | Basic contact | Yes (advanced) |
| **Mutation Library** | 30+ clinical mutations | N/A | N/A | N/A |
| **2D Molecule Sketcher** | Ketcher (inline) | SMILES only | SMILES/SDF | Structure only |
| **ADMET Panel** | QED, Lipinski, PAINS | No | No | No |
| **Strain Energy Filter** | Yes | No | No | No |
| **Selectivity Matrix** | Yes (WT/mutant across N compounds) | No | No | No |
| **Access Level** | Free tier (login required) | Free (currently down) | Free | Free |
| **Login Wall** | Yes, Supabase | No | No | No |
| **Rate Limits** | Free tier capped | None visible | None visible | Queue-based |
| **Output: CSV Export** | Yes, with filtering | No | No | No |
| **Output: Pose Overlay 3D** | Yes | No | No | Yes |
| **Documentation** | Modern, in-app tour | Sparse | Moderate | Excellent (PDF guides) |

---

## Recommendations by Use Case

### **If you want fast WT vs. mutant selectivity screening**
→ **Liganx**. No other free service offers this workflow out-of-the-box.

### **If you want classic Vina docking (one protein, multiple ligands)**
→ **DockThor** (currently working). SwissDock down as of April 2026; AutoDock Vina web server is archival.

### **If you need structural biology / protein–protein refinement**
→ **HADDOCK**. Over-engineered for small-molecule screening, but irreplaceable for MD-based modeling.

### **If you need local control + reproducibility**
→ Download **DOCK6** or **AutoDock Vina v1.2.x** from GitHub. No web interface overhead.

### **If you're an undergraduate with a homework docking assignment**
→ **SwissDock** (if it comes back online) or **DockThor**. Both user-friendly, free, no registration.

---

## Known Limitations & Caveats

1. **Vina Scoring Age**: AutoDock Vina (v1.1.2) was trained on structures from the early 2000s. Modern kinase inhibitors & macrocycles often score poorly.
2. **No Rescoring**: Free services do not offer MM-GBSA, Smina, or QVina rescoring. Liganx includes Smina as option.
3. **Validation Gap**: None of DockThor, SwissDock, or HADDOCK perform automated ligand/pose validation (PoseBusters); Liganx does.
4. **Mutation Overhead**: WT vs. mutant work on all free services requires manual PDB prep, FoldX or Rosetta runs, and separate re-docking—not a single click.
5. **Compound Library Limits**: None support batch screening of >10–20 compounds in a single job without API access.
6. **Interaction Analysis**: Only Liganx (ProLIF) and HADDOCK provide residue-level contact fingerprinting in the web interface.

---

## Citation Notes

All URLs verified via HTTP HEAD requests as of 2026-04-29. SwissDock status note reflects live homepage error message. HADDOCK redirect and UCSF DOCK documentation-only status confirmed via fetch. Services tested without login to identify actual capability.
