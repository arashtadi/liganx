# DeltaDock pipeline

Standalone Python pipeline for one docking unit of work:

```
PDB ID + chain + (optional) mutation + SMILES + pocket box → docking score + pose file
```

Used three ways:
1. **CLI** — `python -m deltadock_pipeline.dock --help` (for sanity checks and demo data)
2. **Imported by the backend** — Phase 1 in-process runner calls these functions directly
3. **Wrapped as a RunPod template** — Phase 2, the worker container ships these scripts

## Phases

| Step                  | Phase 1                | Phase 2 (RunPod)        | Phase 3 (mutation)         |
|-----------------------|------------------------|-------------------------|-----------------------------|
| 1. Fetch WT structure | `requests` from RCSB   | same                    | same                        |
| 2. Clean structure    | PDBFixer               | same                    | same                        |
| 3. Apply mutation     | (skipped — WT only)    | (skipped)               | FoldX BuildModel            |
| 4. Define pocket      | Co-crystal centroid    | + fpocket / P2Rank      | same                        |
| 5. Prep receptor      | Meeko → PDBQT          | same                    | same                        |
| 6. Prep ligand        | RDKit 3D + Meeko       | same                    | same                        |
| 7. Dock               | Vina (local binary)    | Vina on RunPod CPU spot | same + smina option         |
| 8. Post-process       | Parse Vina output      | + ProLIF fingerprints   | + plain-English summary     |

## Layout

```
pipeline/
├── deltadock_pipeline/
│   ├── __init__.py
│   ├── fetch.py        # PDB fetch + cache
│   ├── prep.py         # PDBFixer cleanup, receptor + ligand prep
│   ├── dock.py         # Vina runner + score parsing
│   └── cli.py          # `python -m deltadock_pipeline.cli`
├── tests/
└── pyproject.toml
```

## Phase 1 prerequisites

- `vina` binary on PATH (`brew install autodock-vina` on macOS, or download from https://vina.scripps.edu/)
- Python 3.11+
- `pip install -e .` from this directory

`prep.py` and `dock.py` are written so they can run on stub data (no Vina installed) for unit testing — just the actual `dock()` call requires a real Vina binary.
