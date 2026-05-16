"""Pod-side alchemical free-energy edge calculation — ESPALOMA tier (K2).

This is the Tier-2 ("Standard") engine for the multi-tier FEP architecture.
It is a sibling of `fep_pod.py` (Tier-1 "Basic", OpenFF Sage 2.2.0). The
two files are intentionally independent — same protocol, same return
shape, only the small-molecule force field differs:

    fep_pod.py            → OpenFF Sage 2.2.0 (rule-based)
    fep_pod_espaloma.py   → Espaloma 0.3.2     (graph neural network)

Espaloma parameterizes ligands with a learned message-passing GNN that
predicts partial charges + bonded parameters directly from molecular
graphs. Published benchmarks (Wang et al. 2024) show ~0.1–0.2 kcal/mol
improvement over Sage on protein-ligand RBFE for kinase / non-standard
chemotypes. The cost: ~30s of GPU inference per ligand at parameterize
time (negligible vs. the 8–12 GPU-hour edge total).

WHY A SEPARATE FILE (not a kwarg on the existing run_edge):

K1 established that installing Espaloma in the existing /workspace/
miniconda3/envs/fep/ env would force pytorch CUDA → CPU and numpy
2.x → 1.x — too risky for the live Sage env. So Espaloma gets a
sibling conda env (/workspace/miniconda3/envs/fep_espaloma/) and a
sibling pod module that lives in that env. The Sage path is
provably unchanged: no edits to fep_pod.py, no shared mutable state,
no Python-level coupling.

WHEN run_edge IS CALLED:

Identical to fep_pod.run_edge — same args, same return shape, same
error kinds. The dispatcher in dock_server.py picks which one based
on the FepEdgeRequest's `force_field_engine` field (K4).

POD DEPS (sibling env, not the Sage env):

    conda create -n fep_espaloma --override-channels -c conda-forge \\
        python=3.11 \\
        openfe openmm openmmtools openff-toolkit openff-interchange \\
        openmmforcefields espaloma \\
        ambertools pdbfixer pymbar lomap2 \\
        fastapi uvicorn pydantic

The `openmmforcefields` package ships an EspalomaTemplateGenerator
that openfe picks up automatically when `small_molecule_forcefield`
is set to a string starting with "espaloma-". No openfe code path
changes — espaloma is a drop-in template generator.
"""

from __future__ import annotations

import json
import logging
import os
import signal as _signal
import tempfile
import threading as _threading
import time
from pathlib import Path


# (M11) Mirror of fep_pod.py thread-safety patch for signal.signal.
# LOMAP's SIGALRM timeout crashes when invoked from a non-main thread,
# which is the only context we ever call run_edge from (fep_server's
# daemon worker thread). See fep_pod.py for full background.
_ORIGINAL_SIGNAL_SIGNAL = _signal.signal


def _thread_safe_signal_signal(signalnum, handler):
    if _threading.current_thread() is _threading.main_thread():
        return _ORIGINAL_SIGNAL_SIGNAL(signalnum, handler)
    return _signal.SIG_DFL


if getattr(_signal.signal, "_liganx_thread_safe_patched", False) is False:
    _signal.signal = _thread_safe_signal_signal                      # type: ignore[assignment]
    _signal.signal._liganx_thread_safe_patched = True                # type: ignore[attr-defined]
from typing import Callable, Optional

log = logging.getLogger("fep_pod_espaloma")

# (L5 / mirrors fep_pod.py L5 patch) The OPENMM_DEFAULT_PLATFORM env
# var doesn't actually steer openmm — discovery from two consecutive
# CUDA_ERROR_UNSUPPORTED_PTX_VERSION crashes on 2026-05-16. The real
# fix lives in _apply_compute_platform() below, called from
# _run_openfe_edge before protocol construction. Espaloma's own
# pytorch inference uses its own CUDA context (independent of
# openmm's), so we still get GPU speedup on the graph-neural-net
# parameterization step. OpenCL handles the MD portion safely.
LIGANX_OPENMM_PLATFORM = os.environ.get("LIGANX_OPENMM_PLATFORM", "OpenCL").strip()


def _get_openfe_version() -> str:
    try:
        import openfe
        return getattr(openfe, "__version__", "unknown")
    except Exception:                                                # noqa: BLE001
        return "import-failed"


def _apply_compute_platform(settings, target_platform: str = LIGANX_OPENMM_PLATFORM) -> str:
    """Mirror of fep_pod._apply_compute_platform — same defensive
    multi-attribute scan to set the openmm Platform via openfe."""
    candidates = [
        ("engine_settings", "compute_platform"),
        ("simulation_settings", "platform"),
        ("integrator_settings", "platform"),
    ]
    for parent_attr, field in candidates:
        parent = getattr(settings, parent_attr, None)
        if parent is None:
            continue
        if hasattr(parent, field):
            try:
                setattr(parent, field, target_platform)
                resolved = f"{parent_attr}.{field}"
                log.info(
                    "Set openmm platform via %s = %r (L5, Espaloma tier)",
                    resolved, target_platform,
                )
                return resolved
            except Exception as e:                                   # noqa: BLE001
                log.warning(
                    "Failed to set %s.%s = %r: %s — trying next path",
                    parent_attr, field, target_platform, e,
                )
                continue
    return "NONE_FOUND"

# Default Espaloma version. Pinned for reproducibility — bump only after
# re-validating on the published kinase reference set. openmmforcefields
# maps this string to the EspalomaTemplateGenerator with a download of
# the matching torchscript model on first use.
ESPALOMA_VERSION = "espaloma-0.3.2"

# (J12 stage callback type — same protocol as Sage tier so the polling
# UI doesn't care which engine ran.)
StageCallback = Callable[[str], None]


def _noop_stage(_: str) -> None:
    pass


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
    stage_callback: Optional[StageCallback] = None,
) -> dict:
    """Run one alchemical edge A→B with the Espaloma force field.

    Identical to fep_pod.run_edge in every observable way — same args,
    same return dict, same error kinds — except `method` reports
    Espaloma instead of OpenFF Sage. Wall time is comparable
    (Espaloma adds ~30s of GPU inference at parameterize time, which
    is rounding error against the 8–12 GPU-hour edge total).
    """
    t0 = time.time()
    stage = stage_callback or _noop_stage

    if not receptor_pdb_text or not ligand_a_sdf_text or not ligand_b_sdf_text:
        return _err("missing_input", "Empty receptor/ligand SDF input", t0)

    # Deferred imports — let the server boot even if the sibling env
    # is broken (the operator can read /health and see deps_ok=False).
    try:
        import openfe                                                # noqa: F401
        import openmmtools                                           # noqa: F401
        import pymbar                                                # noqa: F401
        import openmmforcefields                                     # noqa: F401
        import espaloma                                              # noqa: F401
        from openff.toolkit import Molecule
        from openfe.protocols.openmm_rfe import (                    # noqa: F401
            RelativeHybridTopologyProtocol,
        )
        from openfe.setup import LomapAtomMapper, KartografAtomMapper  # noqa: F401
    except ImportError as e:
        return _err(
            "missing_deps",
            (
                f"Espaloma-tier FEP dependencies missing on this pod: {e}. "
                "Expected sibling env /workspace/miniconda3/envs/fep_espaloma/ "
                "to contain openfe + openmmforcefields + espaloma. "
                "See K2 in the task list / runpod/DEPLOY_FEP_ESPALOMA.md."
            ),
            t0,
        )

    # (Same gufe Molecule-codec registration as the Sage tier — required
    # for openfe 1.11 + gufe to JSON-serialise openff.Molecule during
    # protocol.create()'s token cache build.)
    try:
        from gufe.tokenization import JSON_HANDLER as _GUFE_JSON_HANDLER
        from gufe.serialization.json import JSONCodec as _GUFE_JSONCodec

        if not getattr(_GUFE_JSON_HANDLER, "_liganx_molecule_codec_added", False):
            def _mol_to_dict(mol):
                return {
                    ":is_custom:": True,
                    "openff_mapped_smiles": mol.to_smiles(mapped=True),
                }

            def _mol_from_dict(dct):
                return Molecule.from_mapped_smiles(
                    dct["openff_mapped_smiles"],
                    allow_undefined_stereo=True,
                )

            OPENFF_MOLECULE_CODEC = _GUFE_JSONCodec(
                cls=Molecule,
                to_dict=_mol_to_dict,
                from_dict=_mol_from_dict,
                is_my_obj=lambda obj: isinstance(obj, Molecule),
                is_my_dict=lambda dct: (
                    isinstance(dct, dict)
                    and dct.get(":is_custom:") is True
                    and "openff_mapped_smiles" in dct
                ),
            )
            _GUFE_JSON_HANDLER.add_codec(OPENFF_MOLECULE_CODEC)
            _GUFE_JSON_HANDLER._liganx_molecule_codec_added = True
            log.info("Registered openff.Molecule JSONCodec with gufe JSON_HANDLER (Espaloma tier)")
    except Exception as _codec_e:                                    # noqa: BLE001
        log.warning("gufe Molecule codec registration skipped: %s", _codec_e)

    # Parse + reject charge-changing pairs (same policy as Sage tier).
    stage("parsing_ligand_sdfs")
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

        try:
            charge_a = sum(a.formal_charge.m_as("e") for a in mol_a.atoms)
            charge_b = sum(a.formal_charge.m_as("e") for a in mol_b.atoms)
        except Exception:                                            # noqa: BLE001
            charge_a = sum(int(a.formal_charge) for a in mol_a.atoms)
            charge_b = sum(int(a.formal_charge) for a in mol_b.atoms)
        if int(charge_a) != int(charge_b):
            return _err(
                "charge_change",
                (
                    f"Net charge differs between A ({charge_a:+d}) and "
                    f"B ({charge_b:+d}). Charge-changing transformations "
                    "need counter-ion legs not supported in v1."
                ),
                t0,
            )

        receptor_path = td_path / "receptor.pdb"
        receptor_path.write_text(receptor_pdb_text)

        try:
            ddg_complex_kj, ddg_solvent_kj, mbar_info = _run_openfe_edge(
                receptor_pdb_path=receptor_path,
                ligand_a=mol_a,
                ligand_b=mol_b,
                stage_callback=stage,
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
            log.exception("openfe RFE edge failed (Espaloma tier)")
            # (M5) Same error classification as the Sage tier — import
            # the helper from fep_pod so we share one source of truth.
            try:
                from fep_pod import _classify_runtime_error
                err_kind, err_msg = _classify_runtime_error(e)
            except Exception:                                        # noqa: BLE001
                err_kind, err_msg = "runtime", f"FEP edge crashed: {type(e).__name__}: {e}"
            return _err(err_kind, err_msg, t0)

    # Combine + convergence flags (identical math to Sage tier).
    _KJ_PER_KCAL = 4.184
    ddg_complex_kcal = ddg_complex_kj["dg"] / _KJ_PER_KCAL
    ddg_solvent_kcal = ddg_solvent_kj["dg"] / _KJ_PER_KCAL
    ddg_binding_kcal = ddg_complex_kcal - ddg_solvent_kcal

    err_complex = ddg_complex_kj["dg_err"] / _KJ_PER_KCAL
    err_solvent = ddg_solvent_kj["dg_err"] / _KJ_PER_KCAL
    ddg_uncertainty = float((err_complex ** 2 + err_solvent ** 2) ** 0.5)

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

    if hysteresis_unknown:
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
        # The one observable difference vs. Sage: method string reports
        # Espaloma. Downstream UI will format this for users.
        "method": (
            f"openfe-1.0 / amber14sb+{ESPALOMA_VERSION} / "
            f"HREX-{n_lambda_windows}x{ns_per_window:.1f}ns"
        ),
        "engine": "espaloma",
        "wall_seconds": round(time.time() - t0, 1),
    }


def _run_openfe_edge(
    *, receptor_pdb_path: Path, ligand_a, ligand_b,
    n_windows: int, ns_total: float, ns_equil: float,
    salt_conc: float, temperature_k: float, hmr_mass: float,
    timestep_fs: float, work_dir: Path,
    stage_callback: StageCallback = _noop_stage,
) -> tuple[dict, dict, dict]:
    """Same as fep_pod._run_openfe_edge but overrides the small-molecule
    force-field setting to Espaloma. openfe + openmmforcefields handle
    the rest — the EspalomaTemplateGenerator is auto-registered when a
    `small_molecule_forcefield` string starts with 'espaloma-'."""
    from openfe import (
        ChemicalSystem,
        ProteinComponent,
        SmallMoleculeComponent,
        SolventComponent,
    )
    from openfe.protocols.openmm_rfe import RelativeHybridTopologyProtocol
    from openff.units import unit as offunit
    from gufe import LigandAtomMapping                               # noqa: F401

    ns_production = max(0.1, ns_total - ns_equil)

    # ─── Atom mapping (same LOMAP 2D config as Sage tier). ──────────
    stage_callback("lomap_mapping")
    from openfe.setup import LomapAtomMapper, KartografAtomMapper
    mapper = LomapAtomMapper(
        time=20,
        threed=False,
        max3d=0.95,
        element_change=False,
    )
    lig_a_comp = SmallMoleculeComponent.from_openff(ligand_a) if hasattr(
        SmallMoleculeComponent, "from_openff"
    ) else SmallMoleculeComponent(ligand_a)
    lig_b_comp = SmallMoleculeComponent.from_openff(ligand_b) if hasattr(
        SmallMoleculeComponent, "from_openff"
    ) else SmallMoleculeComponent(ligand_b)

    mapping = next(mapper.suggest_mappings(lig_a_comp, lig_b_comp), None)
    if mapping is None:
        try:
            mapper = KartografAtomMapper(atom_max_distance=0.95)
            mapping = next(mapper.suggest_mappings(lig_a_comp, lig_b_comp), None)
        except TypeError as e:
            if "JSON serializable" in str(e):
                raise RuntimeError(
                    "Kartograf fallback hit the known openfe-1.11/gufe "
                    "Molecule-tokenisation bug. Try a more conservative analog."
                ) from e
            raise
        if mapping is None:
            raise RuntimeError(
                "Neither LOMAP nor Kartograf could produce an atom map "
                "for this ligand pair. Try a more conservative analog."
            )

    # ─── Receptor + chemical systems (identical to Sage tier). ──────
    stage_callback("preparing_receptor")
    from pdbfixer import PDBFixer
    from openmm.app import PDBFile
    fixer = PDBFixer(filename=str(receptor_pdb_path))
    fixer.findMissingResidues()
    fixer.findMissingAtoms()
    fixer.addMissingAtoms()
    fixer.addMissingHydrogens(pH=7.0)
    receptor_h_path = receptor_pdb_path.parent / "receptor_with_h.pdb"
    with open(receptor_h_path, "w") as _f:
        PDBFile.writeFile(fixer.topology, fixer.positions, _f)
    protein = ProteinComponent.from_pdb_file(str(receptor_h_path))
    solvent = SolventComponent(
        positive_ion="Na+",
        negative_ion="Cl-",
        ion_concentration=salt_conc * offunit.molar,
    )
    complex_a = ChemicalSystem({"ligand": lig_a_comp, "protein": protein, "solvent": solvent})
    complex_b = ChemicalSystem({"ligand": lig_b_comp, "protein": protein, "solvent": solvent})
    solvent_a = ChemicalSystem({"ligand": lig_a_comp, "solvent": solvent})
    solvent_b = ChemicalSystem({"ligand": lig_b_comp, "solvent": solvent})

    # ─── Protocol settings: THE ONLY MEANINGFUL DIFFERENCE FROM SAGE.
    # `small_molecule_forcefield` set to "espaloma-0.3.2" causes
    # openmmforcefields to register the EspalomaTemplateGenerator,
    # which parameterizes both ligands via the trained GNN at
    # protocol.create() time. Sage's path used the default
    # ("openff-2.2.0"); we override it here.
    settings = RelativeHybridTopologyProtocol.default_settings()
    settings.thermo_settings.temperature = temperature_k * offunit.kelvin
    settings.lambda_settings.lambda_windows = n_windows
    if hasattr(settings.simulation_settings, "n_replicas"):
        settings.simulation_settings.n_replicas = n_windows
    settings.simulation_settings.equilibration_length = ns_equil * offunit.nanosecond
    settings.simulation_settings.production_length = ns_production * offunit.nanosecond
    settings.integrator_settings.timestep = timestep_fs * offunit.femtosecond
    settings.forcefield_settings.hydrogen_mass = hmr_mass
    # ★ Espaloma-tier override ★
    settings.forcefield_settings.small_molecule_forcefield = ESPALOMA_VERSION

    # (L5) Force OpenCL platform — same fix as Sage tier.
    _resolved_platform_path = _apply_compute_platform(settings)
    if _resolved_platform_path == "NONE_FOUND":
        raise RuntimeError(
            "L5 (Espaloma): no openfe settings path found for compute_platform "
            f"on openfe {_get_openfe_version()} — refusing to run before "
            "openmm crashes mid-MD."
        )

    protocol = RelativeHybridTopologyProtocol(settings=settings)

    # ─── Complex leg. ──────────────────────────────────────────────
    stage_callback("building_complex_dag")
    complex_dag = protocol.create(
        stateA=complex_a, stateB=complex_b, mapping=mapping,
        name="complex_edge_espaloma",
    )
    stage_callback("running_complex_leg")
    complex_results = _execute_dag(complex_dag, work_dir / "complex")

    # ─── Solvent leg. ──────────────────────────────────────────────
    stage_callback("building_solvent_dag")
    solvent_dag = protocol.create(
        stateA=solvent_a, stateB=solvent_b, mapping=mapping,
        name="solvent_edge_espaloma",
    )
    stage_callback("running_solvent_leg")
    solvent_results = _execute_dag(solvent_dag, work_dir / "solvent")

    stage_callback("analysing_legs")
    # (M1 fix) Gather DAG results → ProtocolResult before summarising.
    # openfe 1.11 doesn't expose dag_result.protocol_result.
    complex_protocol_result = protocol.gather([complex_results])
    solvent_protocol_result = protocol.gather([solvent_results])
    return (
        _summarise_leg(complex_protocol_result),
        _summarise_leg(solvent_protocol_result),
        {
            "complex": _leg_diagnostics(complex_protocol_result),
            "solvent": _leg_diagnostics(solvent_protocol_result),
        },
    )


def _execute_dag(dag, work_dir: Path):
    """Identical to the Sage tier's _execute_dag — sequential single-host
    SerialDAGExecutor against gufe's execute_DAG."""
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


def _summarise_leg(protocol_result) -> dict:
    """Same MBAR + hysteresis extraction as Sage tier. Takes a gathered
    ProtocolResult (caller calls protocol.gather([dag_result]))."""
    from openff.units import unit as offunit

    dg = protocol_result.get_estimate()
    dg_kj = dg.to(offunit.kilojoule_per_mole).m

    err = protocol_result.get_uncertainty()
    err_kj = err.to(offunit.kilojoule_per_mole).m

    hysteresis: float
    try:
        fwd_dg = protocol_result.forward_estimate.to(offunit.kilojoule_per_mole).m
        rev_dg = protocol_result.reverse_estimate.to(offunit.kilojoule_per_mole).m
        hysteresis = float(fwd_dg - rev_dg)
    except (AttributeError, KeyError):
        try:
            forward = protocol_result.get_forward_and_reverse_energy_analysis()
            fwd_kj = float(forward["forward_DGs"][-1].to(offunit.kilojoule_per_mole).m)
            rev_kj = float(forward["reverse_DGs"][-1].to(offunit.kilojoule_per_mole).m)
            hysteresis = fwd_kj - rev_kj
        except Exception:                                            # noqa: BLE001
            log.warning(
                "openfe protocol_result has no fwd/rev hysteresis API on "
                "this version (Espaloma tier) — convergence flag will be conservative."
            )
            hysteresis = -1.0

    return {
        "dg": float(dg_kj),
        "dg_err": float(err_kj),
        "hysteresis": hysteresis,
    }


def _leg_diagnostics(protocol_result) -> dict:
    """Same diagnostics shape as Sage tier. Takes a gathered
    ProtocolResult, not a raw ProtocolDAGResult."""
    try:
        return {
            "n_replicas": getattr(protocol_result, "n_replicas", None),
            "overlap_min": float(getattr(protocol_result, "min_overlap", 0.0)),
            "n_effective": int(getattr(protocol_result, "n_effective", 0)),
        }
    except Exception:                                                # noqa: BLE001
        return {"diagnostics_unavailable": True}


def _err(kind: str, message: str, t0: float) -> dict:
    return {
        "ok": False,
        "error": message,
        "kind": kind,
        "engine": "espaloma",
        "wall_seconds": round(time.time() - t0, 2),
    }
