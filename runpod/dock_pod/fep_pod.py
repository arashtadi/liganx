"""Pod-side alchemical free-energy edge calculation (G6).

One call = one perturbation edge A→B. The backend's fep_runner
dispatches edges sequentially via /fep_edge; we run the full
two-leg (complex + solvent) HREX alchemy and return the ΔΔG_binding
with MBAR error bars + convergence diagnostics.

WHAT THIS COMPUTES
------------------

For each edge A → B the relative binding free energy:

    ΔΔG_binding(A→B) = ΔG_complex(A→B) − ΔG_solvent(A→B)

where each ΔG is the alchemical work of mutating ligand A into
ligand B in its environment, accumulated across N lambda windows
with HREX (Hamiltonian Replica Exchange). The thermodynamic cycle:

       ΔG_complex(A→B)
   A·R ─────────────────────→ B·R
    │                          │
    │ ΔG_bind(A)               │ ΔG_bind(B)
    ↓                          ↓
    A         ΔG_solvent(A→B)  B
              ─────────────→

ΔΔG_binding = ΔG_bind(B) − ΔG_bind(A) (the difference between two
unmeasurable absolute affinities) is computed instead as the
horizontal difference (alchemical work in each environment) — the
two vertical legs cancel because ΔG is a state function.

PROTOCOL (defaults match docs/fep_plus_design.md §4 + audit fixes)
------------------------------------------------------------------

  Force field protein:  Amber14SB
  Force field ligand:   OpenFF Sage 2.2.0 + AM1-BCC charges
  Water model:          TIP3P
  Salt:                 0.15 M NaCl + neutralising counterions
  Sampling:             12 lambda windows × 7 ns/window
                        (2 ns equilibration discarded + 5 ns production)
  Replica exchange:     HREX every 1 ps via openmmtools
  Hydrogen mass:        HMR 3 amu (allows 4 fs timestep)
  Temperature:          298.15 K (Langevin, friction 1/ps)
  Cutoff:               1.0 nm PME for electrostatics, switched LJ
  Analysis:             MBAR via pymbar 4.x with bootstrap error,
                        forward/reverse hysteresis check
  Convergence flags:    NOT_CONVERGED if hysteresis > 0.5 kcal/mol
                        HIGH_UNCERTAINTY if MBAR 95% CI > 0.4 kcal/mol

WHAT THIS IS NOT
----------------

  * Not absolute FEP. We compute ΔΔG between two ligands, not absolute
    K_d. Absolute FEP needs decoupling + restraints — bigger build.
  * Not for charge-changing transformations. If the net charge of A
    differs from B, the calculation needs counter-ion legs we haven't
    implemented. Return ok=False with a clear error message.
  * Not for covalent ligands. Osimertinib's acrylamide warhead is
    technically covalent; we treat the recognition complex (pre-bond
    formation) only. Document this in the UI.

POD DEPS
--------

This module requires (in addition to OpenMM which is already on the
pod):

    pip install --no-cache-dir \
        'openfe==1.0.*' \
        'openmmtools==0.23.*' \
        'pymbar==4.0.*' \
        'openff-toolkit==0.16.*' \
        'openmmforcefields==0.14.*' \
        'openff-interchange==0.4.*' \
        'lomap2'

If missing, /fep_edge returns ok=False with kind='missing_deps' —
same fail-soft pattern as mmgbsa_pod.py. The DEPLOY_FEP_POD.md
runbook covers the install.

CONTRACT
--------

`run_edge(receptor_pdb, ligand_a_sdf, ligand_b_sdf, ...)` returns:

    {
        "ok": True,
        "ddg_complex_kcal_mol":  −12.3,   # ΔG of A→B in complex
        "ddg_solvent_kcal_mol":  −11.5,   # ΔG of A→B in solvent
        "ddg_binding_kcal_mol":  −0.8,    # ΔΔG_binding (negative = B binds tighter)
        "ddg_uncertainty":        0.18,   # MBAR 95% CI half-width, kcal/mol
        "hysteresis_kcal_mol":    0.12,   # |fwd - rev|, kcal/mol
        "convergence_flag":      "ok",    # ok | high_uncertainty | not_converged
        "mbar_diagnostics_json": "...",   # JSON blob of overlap, decorrelation
        "method":                "openfe-1.0 / amber14sb+openff-2.2 / HREX-12x7ns",
        "wall_seconds":          32400.0, # ~9 GPU-hours for kinase complex
    }

or on failure:

    {
        "ok": False,
        "error": "...",
        "kind": "missing_deps" | "parameterisation" | "charge_change" | "runtime",
        "wall_seconds": 0.1,
    }
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from pathlib import Path

log = logging.getLogger("fep_pod")


def run_edge(
    receptor_pdb_text: str,
    ligand_a_sdf_text: str,
    ligand_b_sdf_text: str,
    *,
    n_lambda_windows: int = 12,
    ns_per_window: float = 7.0,
    ns_equilibration: float = 2.0,
    salt_conc_mol_per_l: float = 0.15,
    temperature_k: float = 298.15,
    hmr_mass_amu: float = 3.0,
    timestep_fs: float = 4.0,
) -> dict:
    """Run one alchemical edge A→B in both complex and solvent legs.

    Returns the ΔΔG_binding + MBAR diagnostics, or a structured error.
    Never raises — failures return ``{"ok": False, ...}`` so the
    backend's fep_runner can persist them cleanly without HTTP 5xx.

    Wall time on Blackwell sm_120 (60K-atom kinase complex):
      ~8-12 GPU-hours per edge with default 12×7 ns × 2 legs.
    The fep_runner dispatches sequentially, so this is the per-call
    cost; a 10-edge study takes ~3-5 days end-to-end.
    """
    t0 = time.time()

    if not receptor_pdb_text or not ligand_a_sdf_text or not ligand_b_sdf_text:
        return _err("missing_input", "Empty receptor/ligand SDF input", t0)

    # ─── Deferred imports — let the pod boot without these deps. ───
    try:
        import openfe                                                # noqa: F401
        import openmmtools                                            # noqa: F401
        import pymbar                                                 # noqa: F401
        from openff.toolkit import Molecule
        from openfe.protocols.openmm_rfe import (                     # noqa: F401
            RelativeHybridTopologyProtocol,
        )
        from openfe.setup import LomapAtomMapper, KartografAtomMapper  # noqa: F401
    except ImportError as e:
        return _err(
            "missing_deps",
            (
                f"FEP dependencies missing on this pod: {e}. "
                "Install with: pip install 'openfe==1.0.*' "
                "'openmmtools==0.23.*' 'pymbar==4.0.*' "
                "'openff-toolkit==0.16.*' 'openmmforcefields==0.14.*' "
                "'openff-interchange==0.4.*' lomap2. See "
                "runpod/DEPLOY_FEP_POD.md for the full setup."
            ),
            t0,
        )

    # ─── Parameterise ligands + reject charge-changing pairs. ──────
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        a_path = td_path / "ligand_a.sdf"
        b_path = td_path / "ligand_b.sdf"
        a_path.write_text(ligand_a_sdf_text)
        b_path.write_text(ligand_b_sdf_text)
        try:
            mol_a = Molecule.from_file(str(a_path), allow_undefined_stereo=True)
            mol_b = Molecule.from_file(str(b_path), allow_undefined_stereo=True)
        except Exception as e:                                       # noqa: BLE001
            return _err("parameterisation", f"Ligand SDF parse failed: {e}", t0)

        # (Phase B audit risk) Charge-changing transformations need
        # separate counter-ion legs that openfe's
        # RelativeHybridTopologyProtocol doesn't implement. Reject
        # explicitly rather than producing a silent ~5 kcal/mol bias.
        try:
            charge_a = sum(a.formal_charge.m_as("e") for a in mol_a.atoms)
            charge_b = sum(a.formal_charge.m_as("e") for a in mol_b.atoms)
        except Exception:                                            # noqa: BLE001
            # Some OpenFF versions return ints, others Quantities.
            charge_a = sum(int(a.formal_charge) for a in mol_a.atoms)
            charge_b = sum(int(a.formal_charge) for a in mol_b.atoms)
        if int(charge_a) != int(charge_b):
            return _err(
                "charge_change",
                (
                    f"Net charge differs between A ({charge_a:+d}) and "
                    f"B ({charge_b:+d}). Charge-changing transformations "
                    "need counter-ion legs not supported in v1. Submit "
                    "B as a separate FEP study or use neutral analogs."
                ),
                t0,
            )

        # ─── Build perturbation. This is where openfe takes over. ──
        receptor_path = td_path / "receptor.pdb"
        receptor_path.write_text(receptor_pdb_text)

        try:
            ddg_complex_kj, ddg_solvent_kj, mbar_info = _run_openfe_edge(
                receptor_pdb_path=receptor_path,
                ligand_a=mol_a,
                ligand_b=mol_b,
                n_windows=n_lambda_windows,
                ns_total=ns_per_window,
                ns_equil=ns_equilibration,
                salt_conc=salt_conc_mol_per_l,
                temperature_k=temperature_k,
                hmr_mass=hmr_mass_amu,
                timestep_fs=timestep_fs,
                work_dir=td_path,
            )
        except Exception as e:                                       # noqa: BLE001
            log.exception("openfe RFE edge failed")
            return _err("runtime", f"FEP edge crashed: {type(e).__name__}: {e}", t0)

    # ─── Combine into ΔΔG_binding + apply convergence flags. ───────
    _KJ_PER_KCAL = 4.184
    ddg_complex_kcal = ddg_complex_kj["dg"] / _KJ_PER_KCAL
    ddg_solvent_kcal = ddg_solvent_kj["dg"] / _KJ_PER_KCAL
    ddg_binding_kcal = ddg_complex_kcal - ddg_solvent_kcal

    # MBAR uncertainty: combine in quadrature (legs are independent).
    err_complex = ddg_complex_kj["dg_err"] / _KJ_PER_KCAL
    err_solvent = ddg_solvent_kj["dg_err"] / _KJ_PER_KCAL
    ddg_uncertainty = float((err_complex ** 2 + err_solvent ** 2) ** 0.5)

    # Hysteresis: max across the two legs (whichever drifts more).
    # (Final audit M3) -1.0 is the sentinel for "openfe didn't expose
    # fwd/rev estimates on this version" — treat as unknown, not 0.0,
    # which would dangerously read as converged.
    h_complex = ddg_complex_kj["hysteresis"]
    h_solvent = ddg_solvent_kj["hysteresis"]
    hysteresis_unknown = (h_complex < 0) or (h_solvent < 0)
    if hysteresis_unknown:
        hysteresis = -1.0
    else:
        hysteresis = max(
            abs(h_complex) / _KJ_PER_KCAL,
            abs(h_solvent) / _KJ_PER_KCAL,
        )

    # Tightened convergence flags from Mey et al. 2020 / Phase B audit:
    #   NOT_CONVERGED   — hysteresis > 0.5 kcal/mol
    #   HIGH_UNCERTAINTY — MBAR 95% CI > 0.4 kcal/mol OR hysteresis unknown
    if hysteresis_unknown:
        # Conservative downgrade — we can't confirm convergence so we
        # mark high_uncertainty rather than ok. Audit fix M3.
        convergence_flag = "high_uncertainty"
    elif hysteresis > 0.5:
        convergence_flag = "not_converged"
    elif ddg_uncertainty > 0.4:
        convergence_flag = "high_uncertainty"
    else:
        convergence_flag = "ok"

    return {
        "ok": True,
        "ddg_complex_kcal_mol": round(ddg_complex_kcal, 3),
        "ddg_solvent_kcal_mol": round(ddg_solvent_kcal, 3),
        "ddg_binding_kcal_mol": round(ddg_binding_kcal, 3),
        "ddg_uncertainty": round(ddg_uncertainty, 3),
        "hysteresis_kcal_mol": round(hysteresis, 3),
        "convergence_flag": convergence_flag,
        "mbar_diagnostics_json": json.dumps({
            "complex_leg": mbar_info["complex"],
            "solvent_leg": mbar_info["solvent"],
            "n_windows": n_lambda_windows,
            "ns_per_window": ns_per_window,
            "ns_equilibration": ns_equilibration,
        }, separators=(",", ":")),
        "method": (
            f"openfe-1.0 / amber14sb+openff-2.2 / "
            f"HREX-{n_lambda_windows}x{ns_per_window:.1f}ns"
        ),
        "wall_seconds": round(time.time() - t0, 1),
    }


def _run_openfe_edge(
    *, receptor_pdb_path: Path, ligand_a, ligand_b,
    n_windows: int, ns_total: float, ns_equil: float,
    salt_conc: float, temperature_k: float, hmr_mass: float,
    timestep_fs: float, work_dir: Path,
) -> tuple[dict, dict, dict]:
    """Run the actual openfe RelativeHybridTopologyProtocol for one
    edge. Returns three dicts:
      • complex leg: {dg: kJ/mol, dg_err: kJ/mol, hysteresis: kJ/mol}
      • solvent leg: same shape
      • mbar_info:   per-leg overlap matrices + decorrelation times

    This is the load-bearing science function — its correctness is
    what determines whether the platform reproduces published ΔΔG.
    The openfe API has been stable in 1.x; below is the canonical
    invocation pattern from openfe's tutorials.

    Production length per window = ns_total − ns_equil.
    """
    from openfe import ChemicalSystem, ProteinComponent, SolventComponent
    from openfe.protocols.openmm_rfe import RelativeHybridTopologyProtocol
    from openff.units import unit as offunit
    from gufe import LigandAtomMapping

    ns_production = max(0.1, ns_total - ns_equil)

    # ─── 1. Atom mapping (LOMAP, fall back to Kartograf). ──────────
    # openfe ships LomapAtomMapper that wraps LOMAP2. Use it first;
    # fall back to KartografAtomMapper if LOMAP refuses (rare —
    # weird ring transformations).
    from openfe.setup import LomapAtomMapper, KartografAtomMapper
    mapper = LomapAtomMapper(
        time=20,                # LOMAP timeout sec — generous
        threed=True,            # 3D-aware: use docked coords if present
        max3d=0.95,             # max heavy-atom distance for "same atom"
        element_change=False,   # forbid element changes (most edges)
    )
    mapping = next(mapper.suggest_mappings(ligand_a, ligand_b), None)
    if mapping is None:
        mapper = KartografAtomMapper(atom_max_distance=0.95)
        mapping = next(mapper.suggest_mappings(ligand_a, ligand_b), None)
        if mapping is None:
            raise RuntimeError(
                "Neither LOMAP nor Kartograf could produce an atom map "
                "for this ligand pair. Try a more conservative analog."
            )

    # ─── 2. Build chemical systems for the two legs. ────────────────
    protein = ProteinComponent.from_pdb_file(str(receptor_pdb_path))
    solvent = SolventComponent(
        positive_ion="Na+",
        negative_ion="Cl-",
        ion_concentration=salt_conc * offunit.molar,
    )
    complex_a = ChemicalSystem({"ligand": ligand_a, "protein": protein, "solvent": solvent})
    complex_b = ChemicalSystem({"ligand": ligand_b, "protein": protein, "solvent": solvent})
    solvent_a = ChemicalSystem({"ligand": ligand_a, "solvent": solvent})
    solvent_b = ChemicalSystem({"ligand": ligand_b, "solvent": solvent})

    # ─── 3. Configure the alchemical protocol. ──────────────────────
    settings = RelativeHybridTopologyProtocol.default_settings()
    settings.thermo_settings.temperature = temperature_k * offunit.kelvin
    settings.alchemical_sampler_settings.n_replicas = n_windows
    settings.simulation_settings.equilibration_length = ns_equil * offunit.nanosecond
    settings.simulation_settings.production_length = ns_production * offunit.nanosecond
    settings.integrator_settings.timestep = timestep_fs * offunit.femtosecond
    # HMR — distribute heavy-atom mass to attached H so we can take
    # 4 fs timesteps. Standard practice for production RBFE.
    settings.forcefield_settings.hydrogen_mass = hmr_mass

    protocol = RelativeHybridTopologyProtocol(settings=settings)

    # ─── 4. Run complex leg. ────────────────────────────────────────
    complex_dag = protocol.create(
        stateA=complex_a, stateB=complex_b, mapping=mapping,
        name="complex_edge",
    )
    complex_results = _execute_dag(complex_dag, work_dir / "complex")

    # ─── 5. Run solvent leg. ────────────────────────────────────────
    solvent_dag = protocol.create(
        stateA=solvent_a, stateB=solvent_b, mapping=mapping,
        name="solvent_edge",
    )
    solvent_results = _execute_dag(solvent_dag, work_dir / "solvent")

    return (
        _summarise_leg(complex_results),
        _summarise_leg(solvent_results),
        {
            "complex": _leg_diagnostics(complex_results),
            "solvent": _leg_diagnostics(solvent_results),
        },
    )


def _execute_dag(dag, work_dir: Path):
    """Execute an openfe ProtocolDAG and return the result object.
    Sequential single-host execution (no Dask) for v1; openfe's
    SerialDAGExecutor is the right primitive for a single-edge-per-call
    pod model. Multi-edge parallelism is the runner's responsibility."""
    from openfe.protocols.openmm_utils import (                       # noqa: F401
        omm_compute,
    )
    from gufe.protocols import execute_DAG

    work_dir.mkdir(parents=True, exist_ok=True)
    shared_dir = work_dir / "shared"
    scratch_dir = work_dir / "scratch"
    shared_dir.mkdir(parents=True, exist_ok=True)
    scratch_dir.mkdir(parents=True, exist_ok=True)
    return execute_DAG(
        dag,
        shared_basedir=shared_dir,
        scratch_basedir=scratch_dir,
        keep_shared=False,
        keep_scratch=False,
    )


def _summarise_leg(dag_result) -> dict:
    """Extract ΔG + MBAR error + forward/reverse hysteresis from a
    completed protocol DAG. Returns kJ/mol throughout — convert at
    the boundary."""
    from openff.units import unit as offunit

    protocol_result = dag_result.protocol_result
    dg = protocol_result.get_estimate()
    dg_kj = dg.to(offunit.kilojoule_per_mole).m

    err = protocol_result.get_uncertainty()
    err_kj = err.to(offunit.kilojoule_per_mole).m

    # Forward/reverse hysteresis. openfe 1.x's RelativeHybridTopology
    # ProtocolResult does NOT expose forward_estimate / reverse_estimate
    # by default — that's a separate pymbar.timeseries call against
    # the cumulative work data.
    #
    # (Final audit M3) The previous fall-through silently returned
    # `hysteresis = 0.0` on any AttributeError, which disabled the
    # entire NOT_CONVERGED safety net (every edge would read as
    # converged). Now we return a sentinel `-1.0` so the runner can
    # tell "unknown" from "actually zero" and downgrade the
    # convergence flag accordingly.
    hysteresis: float
    try:
        fwd_dg = protocol_result.forward_estimate.to(offunit.kilojoule_per_mole).m
        rev_dg = protocol_result.reverse_estimate.to(offunit.kilojoule_per_mole).m
        hysteresis = float(fwd_dg - rev_dg)
    except (AttributeError, KeyError):
        # Try the alternate API path some openfe versions expose.
        try:
            forward = protocol_result.get_forward_and_reverse_energy_analysis()
            # forward returns a dict with 'forward_DGs' / 'reverse_DGs' arrays;
            # take the final point of each as the converged estimate.
            fwd_kj = float(forward["forward_DGs"][-1].to(offunit.kilojoule_per_mole).m)
            rev_kj = float(forward["reverse_DGs"][-1].to(offunit.kilojoule_per_mole).m)
            hysteresis = fwd_kj - rev_kj
        except Exception:                                            # noqa: BLE001
            # Unknown — downstream code (run_edge) will see -1.0
            # and downgrade convergence_flag to "high_uncertainty"
            # rather than the dangerous "ok" default.
            log.warning(
                "openfe protocol_result has no fwd/rev hysteresis API on "
                "this version — convergence flag will be conservative."
            )
            hysteresis = -1.0

    return {
        "dg": float(dg_kj),
        "dg_err": float(err_kj),
        "hysteresis": hysteresis,
    }


def _leg_diagnostics(dag_result) -> dict:
    """Per-leg MBAR diagnostics — overlap matrix between adjacent
    lambda windows, decorrelation times, n_effective_samples.
    Returned as a JSON-serialisable dict the UI's diagnostics panel
    can render."""
    try:
        pr = dag_result.protocol_result
        return {
            "n_replicas": getattr(pr, "n_replicas", None),
            "overlap_min": float(getattr(pr, "min_overlap", 0.0)),
            "n_effective": int(getattr(pr, "n_effective", 0)),
        }
    except Exception:                                                # noqa: BLE001
        return {"diagnostics_unavailable": True}


def _err(kind: str, message: str, t0: float) -> dict:
    """Build the structured error response shape — same for every
    failure mode so the backend can route on `kind`."""
    return {
        "ok": False,
        "error": message,
        "kind": kind,
        "wall_seconds": round(time.time() - t0, 2),
    }
