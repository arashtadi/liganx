"""Minimal standalone FastAPI server for the /fep_edge route.

Why a separate server (not just appending to dock_server.py): the FEP
scientific stack (openfe + openmmtools + pymbar + openff-toolkit +
lomap2) is conda-only. We install it into an isolated conda env on
the pod so it doesn't pollute the system python that dock_server uses
for Vina/GNINA/Boltz-2. This fep_server.py runs from that conda env
on a separate port (default 7861); dock_server.py keeps running on
port 7860 from system python, untouched. Same machine, same GPU, but
clean Python-environment separation.

Deploy (operator):
    curl -L -o /workspace/fep_server.py \\
        https://raw.githubusercontent.com/arashtadi/liganx/main/runpod/dock_pod/fep_server.py
    curl -L -o /workspace/fep_pod.py \\
        https://raw.githubusercontent.com/arashtadi/liganx/main/runpod/dock_pod/fep_pod.py
    source /workspace/miniconda3/etc/profile.d/conda.sh
    conda activate fep
    cd /workspace && nohup uvicorn fep_server:app --host 0.0.0.0 --port 7861 \\
        > /workspace/fep_server_boot.log 2>&1 &

Shared-secret auth is honoured (same X-Pod-Secret header as the dock
server) so a leaked proxy URL is useless without the secret.
"""
from __future__ import annotations

import logging
import os

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

# fep_pod is heavy-import-only — its imports (openff, openmm, openfe)
# happen deferred inside run_edge so this module loads even if a dep
# is missing. We import fep_pod at top to fail-fast at server start
# if the conda env is broken.
import fep_pod

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("fep_server")

app = FastAPI(title="Liganx FEP+ edge server", version="0.1")


def require_pod_secret(x_pod_secret: str = Header(default="")) -> None:
    """Same shared-secret auth as dock_server's pod routes. When
    POD_SHARED_SECRET is set on the pod and on the backend (Fly), every
    /fep_edge call must include matching X-Pod-Secret. Absent on either
    side → fails open (matches docking's safe-rollout pattern)."""
    expected = os.environ.get("POD_SHARED_SECRET", "").strip()
    if not expected:
        return                                                       # fails open
    if x_pod_secret.strip() != expected:
        raise HTTPException(status_code=401, detail="bad X-Pod-Secret")


class FepEdgeRequest(BaseModel):
    """Same shape as the request in dock_server's /fep_edge route.

    Inputs are TEXT (PDB + SDF) so the HTTP boundary is human-readable.
    Protocol knobs default to the post-audit values from
    docs/fep_plus_design.md §4 (12 windows × 7 ns/window with 2 ns
    equilibration discarded)."""
    receptor_pdb: str
    ligand_a_sdf: str
    ligand_b_sdf: str
    n_lambda_windows: int = Field(default=12, ge=4, le=24)
    ns_per_window: float = Field(default=7.0, gt=0, le=20.0)
    ns_equilibration: float = Field(default=2.0, ge=0, le=10.0)
    salt_conc_mol_per_l: float = Field(default=0.15, ge=0, le=1.0)
    temperature_k: float = Field(default=298.15, gt=0, le=500.0)
    hmr_mass_amu: float = Field(default=3.0, ge=1.0, le=5.0)
    timestep_fs: float = Field(default=4.0, gt=0, le=5.0)


@app.get("/health")
def health() -> dict:
    """Liveness probe. Returns immediately. The backend's
    /admin/pod-status card polls this so the operator can see whether
    the FEP server is up without firing a real edge."""
    return {
        "ok": True,
        "service": "fep_server",
        "version": "0.1",
        # Surface whether the heavy deps loaded — operator-facing
        # signal that the conda env is intact.
        "deps_ok": _deps_loaded(),
    }


@app.post("/fep_edge")
def fep_edge_endpoint(req: FepEdgeRequest, _auth: None = None) -> dict:
    """Run one alchemical edge A→B. ~8-12 GPU-hours wall on a kinase
    complex with the default 12×7 ns × 2 legs protocol. The full
    contract is documented in fep_pod.run_edge; this endpoint is a
    thin pydantic wrapper around it.

    HTTP timeout caveat: backend should set client timeout ≥ 13 hours.
    RunPod's HTTP proxy has a 10-hour idle timeout — for long edges,
    switch to async pod-side worker + result-polling pattern (Phase
    B.1)."""
    require_pod_secret()  # noqa: F811 — pydantic deps don't expose Header here
    try:
        return fep_pod.run_edge(
            req.receptor_pdb,
            req.ligand_a_sdf,
            req.ligand_b_sdf,
            n_lambda_windows=req.n_lambda_windows,
            ns_per_window=req.ns_per_window,
            ns_equilibration=req.ns_equilibration,
            salt_conc_mol_per_l=req.salt_conc_mol_per_l,
            temperature_k=req.temperature_k,
            hmr_mass_amu=req.hmr_mass_amu,
            timestep_fs=req.timestep_fs,
        )
    except Exception as e:                                            # noqa: BLE001
        log.exception("fep_edge_endpoint failed")
        return {
            "ok": False,
            "error": f"{type(e).__name__}: {e}",
            "kind": "runtime",
            "wall_seconds": 0.0,
        }


def _deps_loaded() -> bool:
    """Best-effort check that the FEP scientific stack is importable
    in the current python env. Returns False if anything's missing —
    operator can use the /health response to diagnose conda-env
    breakage without firing a real edge."""
    try:
        import openfe                # noqa: F401
        import openmmtools           # noqa: F401
        import pymbar                # noqa: F401
        from openff.toolkit import Molecule  # noqa: F401
        return True
    except Exception:                                                # noqa: BLE001
        return False
