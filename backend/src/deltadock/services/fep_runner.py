"""FEP+ runner — Phase B scaffold (not implemented).

This is the orchestration entry point for relative free-energy
perturbation studies. See docs/fep_plus_design.md for the full design
and timeline; this module is the week-1 scaffold that lets us land DB
models + API shape + the feature flag without committing to the
2-3 week pod-image + LOMAP + alchemical-sampling work.

WHAT THIS WILL DO (Phase B, future sessions):

  1. Take a (target, variant, hit_compound, analog_compounds) request.
  2. Build a perturbation graph via LOMAP + radial+MST topology.
  3. For each edge, dispatch a `/fep_edge` job to the dedicated FEP pod
     (separate from the Vina dock pod — see design doc §6).
  4. Aggregate per-edge ΔΔG via MBAR + cycle-closure analysis.
  5. Persist results to the FepJob / FepNode / FepPerturbation tables.

WHAT THIS DOES NOW: nothing. Imports are guarded behind a feature
flag so a deploy without FEP_ENABLED set never tries to load
openfe/openmmtools/pymbar. The router returns 501 'not implemented'
for every endpoint until the pod-image + this module are filled in.

CRITICAL FILES referenced by the design doc:
  - docs/fep_plus_design.md — the design doc
  - runpod/dock_pod/fep_pod.py — to be created (Phase B week 2)
  - backend/migrations/017_fep_tables.sql — to be created (week 1)
"""
from __future__ import annotations

import logging
import os

log = logging.getLogger(__name__)


def is_fep_enabled() -> bool:
    """Feature flag gating FEP+ endpoints. Default OFF for safety —
    until the dedicated FEP pod is up and openfe is pinned in the
    Dockerfile, exposing the endpoints would just produce 503s for
    real users. Flip via FEP_ENABLED=1 in Fly secrets when ready.

    Design doc §10 week 6: this flag stays OFF in prod until we've
    run the published EGFR-T790M validation set."""
    return os.environ.get("FEP_ENABLED", "").strip().lower() in {"1", "true", "yes"}


class FepNotImplementedError(NotImplementedError):
    """Raised when an FEP endpoint is hit before the Phase B build
    lands. The router catches this and returns HTTP 501 with a clear
    message pointing at the design doc."""


def start_fep_study(*args, **kwargs):                                # noqa: D401
    """Phase B placeholder. Will dispatch a FepJob through Celery's
    'fep' queue once the pod + openfe wiring exists."""
    raise FepNotImplementedError(
        "Relative FEP is in Phase B scaffolding — not yet runnable. "
        "Design at docs/fep_plus_design.md; tracking at task F6 in "
        "the platform roadmap."
    )


def get_fep_study_status(share_id: str):                             # noqa: D401
    """Phase B placeholder."""
    raise FepNotImplementedError(
        "FEP studies aren't dispatched yet. See docs/fep_plus_design.md."
    )


def cancel_fep_study(share_id: str):                                 # noqa: D401
    """Phase B placeholder."""
    raise FepNotImplementedError(
        "FEP studies aren't dispatched yet. See docs/fep_plus_design.md."
    )
