# MM-GBSA Phase A — Scientific Audit (2026-05-15)

Auditor: computational-chemistry verification agent, brief in
`Agent("Audit Phase A MM-GBSA science")` call from the Phase A build.

## Top-3 ship-blockers (must fix before users see ΔG numbers)

### 1. The slicing approach computes GB self-energies on inconsistent topologies

`mmgbsa_pod.py:_slice_energy`. Each leg (complex / protein / ligand)
rebuilds a fresh OpenMM `System` with OBC2 implicit solvent. Because GB
Born radii are integrated over all solute atoms within ~15 Å, the
protein's Born radii in the protein-only slice differ from those in the
complex — and this difference is the desolvation penalty we WANT, but
it also picks up artefacts from residues distant from the binding
pocket whose Born radii change purely because the ligand is gone.

**Note from build author:** This is the textbook MM-GBSA decomposition
(AMBER MMPBSA.py uses the same approach; Hou et al. 2011 cites this as
standard). The concern is real but I think the magnitude estimate of
5-20 kcal/mol noise overstates it for well-buried kinase pockets. The
proper response in Phase A is the UI fix (#3) — make absolute ΔG
ranking-only — rather than rewriting the slicer. A `setParticleParameters`
masking approach (zero charge/LJ + exclude from GB) is the cleaner
long-term path but adds substantial code and would benefit from
benchmarking against the current approach.

**Status:** deferred to Phase A.1 with UI mitigation (#3) shipping
now. Document the limitation in the docstring.

### 2. Receptor is unrestrained during the 500-step minimisation

`mmgbsa_pod.py` minimises with no positional restraint, so the
protein backbone can walk several Å in 500 L-BFGS steps if Vina's
rigid-receptor pose has clashes. The ΔG returned is for the *relaxed*
geometry, not the docked pose the user sees in the 3D viewer.

**Fix:** add a `CustomExternalForce` restraint with
`0.5 * k * ((x-x0)^2 + (y-y0)^2 + (z-z0)^2)` on protein heavy atoms,
k ≈ 1000 kJ/mol/nm². Document the choice in the docstring.

**Status:** FIXING IN THIS PASS.

### 3. UI presents the absolute ΔG too prominently

Single-snapshot one-trajectory MM-GBSA produces ΔG values in the
−30 to −80 kcal/mol range, which is non-physical as a binding free
energy. The published expectation is Pearson r ≈ 0.4–0.6 on
*rank-ordering* (Hou et al. JCIM 2011; Sun et al. PCCP 2014), not
absolute affinity. A chemist seeing a bolded "−42.1 kcal/mol" will
either misread it as a Kd equivalent or lose trust in the platform
when they realise it's nonsense.

**Fix:** re-label the chip as a relative score; bury the absolute
number behind an expander; lead with the "rank-order only" caveat.

**Status:** FIXING IN THIS PASS.

## Medium severity

### 4. Wrong soluteDielectric for static-snapshot scoring

`mmgbsa_pod.py` uses `soluteDielectric=1.0`. That's correct for MD
where the protein samples its own electrostatic response — but for
single-snapshot scoring the consensus is `soluteDielectric=2-4`
(Hou et al. 2011 systematically tested this; ε=2 best on kinase /
HIV protease). Using ε=1 over-weights electrostatic contributions,
biasing salt-bridge-rich binders artificially well.

**Fix:** default to `soluteDielectric=2.0`. Expose as parameter.

**Status:** FIXING IN THIS PASS.

### 5. Open Babel PDBQT → SDF loses protonation state

`obabel pose.pdbqt -O pose.sdf` with no `-p 7.4` flag. PDBQT carries
no formal-charge info; obabel's default rules mis-protonate basic
amines on ~30–40% of kinase inhibitors. AM1-BCC charges then run on
the wrong ionisation state; ΔG can swing 5–10 kcal/mol per missed
proton.

**Fix:** the runner already has the input SMILES. The Phase A.1
correct path is to round-trip through Meeko's prepared ligand (which
is fully typed and bond-order correct). For Phase A, add `-p 7.4` to
the obabel call as a partial mitigation; document the limitation.

**Status:** FIXING IN THIS PASS (partial — `-p 7.4` flag).

### 6. No PROPKA on receptor

PDBFixer leaves Asp/Glu/His in their crystal-deposit protonation
states. A wrongly-protonated catalytic Asp shifts ΔG by 3–8 kcal/mol
on EGFR/FLT3.

**Status:** deferred to Phase A.1 — PROPKA integration is a separate
project (receptor-prep pipeline change, not MM-GBSA specific).

### 7. Entropy term

One-trajectory MM-GBSA drops `−TΔS`. The audit notes this is fine for
strictly congeneric series but breaks across scaffolds (a single
rotor difference is ~0.5–0.8 kcal/mol). Surface the limitation in
the UI rather than computing nmode.

**Status:** covered by UI fix #3.

## Nice-to-have

### 8. CI sanity tests

Recommended:
1. Erlotinib in EGFR-WT (4HJO) — expect ΔG in [−55, −35] kcal/mol.
2. Apo control — ligand atoms displaced 50 Å away. ΔG ≈ 0.
3. Symmetric pair — gefitinib vs erlotinib should agree within 3 kcal/mol.
4. Unit-conversion guard — assert |ΔG| < 200 kcal/mol.

**Status:** lightweight unit-test layer added in this session; full
benchmark suite deferred.

### 9. Missing salt screening

`createSystem` defaults to 0.0 M salt. Physiological is 0.15 M.
Effect: ~1–3 kcal/mol bias on charged ligands.

**Fix:** add `implicitSolventSaltConc=0.15 mol/L`.

**Status:** FIXING IN THIS PASS.

### 10. No steric-clash pre-flight

A bad Vina pose with >2.5 Å clash will minimise to a non-physical
local minimum with a large-negative ΔG that looks like a screaming
hit.

**Fix:** compute pre-minimisation energy; reject (or warn) if
> +1000 kcal/mol.

**Status:** FIXING IN THIS PASS.

### 11. `extra` string growth

Six new `mmgbsa_*` fields → ~150 extra chars per row. DockingResult.extra
is `Optional[str]` with no length cap in the SQLModel, so this is
non-issue.

**Status:** no action.

### 12. Minimised positions discarded

For trust + debugging, return the minimised complex PDB or at least
an RMSD-to-input. Also load-bearing for verifying #2.

**Status:** add to the pod response in this pass.

## What we're fixing in Phase A now

Applying (this session):
- (#2) Receptor heavy-atom positional restraint during minimisation
- (#3) UI re-label / bury absolute ΔG
- (#4) `soluteDielectric=2.0` default
- (#5) Open Babel `-p 7.4` flag
- (#9) `implicitSolventSaltConc=0.15 mol/L`
- (#10) Pre-minimisation clash detector
- (#12) Return RMSD of minimised positions vs input

Deferring to Phase A.1:
- (#1) Slicer rewrite via `setParticleParameters` masking
- (#5 full) Meeko-prepared-SDF round-trip
- (#6) PROPKA integration on receptor

Documenting (not coding):
- (#7) Entropy limitation — UI mention only
- (#8) Full CI benchmark suite — design noted, not built
