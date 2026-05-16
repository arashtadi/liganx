"""Backend client for the pod's /mmgbsa/rescore endpoint.

Phase A of the FEP+ programme — see docs/fep_plus_design.md for the
full plan; this is the second-pass rescoring layer that sits above
Vina docking and below full alchemical FEP. Single-snapshot one-
trajectory MM-GBSA on a docked complex, ~30-90 s per pose on the pod.

WHY THIS EXISTS
---------------

Vina's score (kcal/mol, more negative = stronger) is a fast empirical
scoring function whose absolute calibration against IC50 is famously
poor. Real chemists use it as a SHAPE-FIT signal, not a binding-
affinity prediction. MM-GBSA is a physics-based rescoring layer that:

  * uses real force-field terms (Amber14SB + OpenFF Sage 2.2) instead
    of the empirical Vina pseudo-energy;
  * accounts for implicit-solvent (OBC2 GBSA) effects that Vina ignores;
  * gives a ΔG_bind that's better-calibrated for rank-ordering analogs
    within a target series.

It is NOT a replacement for FEP. The single-snapshot one-trajectory
approximation drops entropy and protein-reorganisation terms, so
absolute affinities are biased. The use case is "I have 10 docked
poses for the same target — which 3 should I make first?".

PROTOCOL (see runpod/dock_pod/mmgbsa_pod.py for the implementation)
-------------------------------------------------------------------

  1. Parameterise the receptor with Amber14SB.
  2. Parameterise the ligand with OpenFF Sage 2.2 + AM1-BCC charges.
  3. Combine into a complex topology.
  4. Minimise in OBC2 implicit solvent (L-BFGS, force-tolerance 10
     kJ/mol/nm, step cap 500).
  5. Compute E_complex, E_protein, E_ligand on the minimised geometry
     (no re-minimisation of slices — one-trajectory).
  6. ΔG_bind = E_complex − E_protein − E_ligand.

CONTRACT
--------

`rescore_pose(...)` returns a `MmgbsaResult` dataclass on success,
raises `MmgbsaError` on any failure (pod-side parameterisation, pod
missing deps, network, timeout). Callers map MmgbsaError → HTTP 503
so the user sees a clear "rescoring unavailable" message rather than
a generic 500.

DB SERIALISATION
----------------

The result round-trips through DockingResult.extra in the existing
pipe-delimited key=value format. Keys (added to _summarize_extra):

  * mmgbsa_dg          — ΔG_bind, kcal/mol (float, signed)
  * mmgbsa_e_complex   — E_complex, kcal/mol
  * mmgbsa_e_protein   — E_protein, kcal/mol
  * mmgbsa_e_ligand    — E_ligand, kcal/mol
  * mmgbsa_method      — short label, e.g. "amber14sb+openff-2.2/OBC2"
  * mmgbsa_seconds     — wall time (float)

So a typical extra string post-rescore looks like:

    engine=pod_gpu|vinardo=-8.42|...|mmgbsa_dg=-42.1|mmgbsa_e_complex=-8421.3|...

The lenient parser in services/ask_ai.py silently ignores unknown
keys, so old cells (without the new fields) and new cells coexist.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

log = logging.getLogger(__name__)


class MmgbsaError(RuntimeError):
    """Raised when MM-GBSA rescoring fails for any reason.

    Includes a `kind` field so callers (and tests) can branch on
    whether this was a missing-dep error (recoverable — pod just
    needs the pip install), a parameterisation error (compound-
    specific, surface to user), or a transport error (transient,
    retry).
    """

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind   # "missing_deps" | "parameterisation" | "transport" | "runtime"


@dataclass
class MmgbsaResult:
    """Structured MM-GBSA result. Energies are in kcal/mol throughout."""
    dg_bind_kcal_mol: float
    e_complex_kcal_mol: float
    e_protein_kcal_mol: float
    e_ligand_kcal_mol: float
    method: str
    wall_seconds: float
    # (Audit fix #12) RMSD of the minimised receptor heavy atoms vs
    # the input pose. ~0.1-0.5 Å is healthy; >1.0 Å is a warning
    # sign that the restraint wasn't strong enough or there were
    # significant clashes. Negative = couldn't compute.
    receptor_rmsd_a: float = 0.0

    def to_extra_segment(self) -> str:
        """Render as the pipe-delimited key=value segment we append to
        DockingResult.extra. Bounded floats so a degenerate run can't
        produce an unparseable string; missing decimal is fine, the
        parser does float() either way."""
        return (
            f"mmgbsa_dg={self.dg_bind_kcal_mol:.2f}"
            f"|mmgbsa_e_complex={self.e_complex_kcal_mol:.2f}"
            f"|mmgbsa_e_protein={self.e_protein_kcal_mol:.2f}"
            f"|mmgbsa_e_ligand={self.e_ligand_kcal_mol:.2f}"
            f"|mmgbsa_method={self.method}"
            f"|mmgbsa_seconds={self.wall_seconds:.1f}"
            f"|mmgbsa_rmsd={self.receptor_rmsd_a:.2f}"
        )


def rescore_pose(
    receptor_pdb: str,
    ligand_sdf: str,
    *,
    timeout_s: float = 180.0,
    max_minimization_steps: int = 500,
) -> MmgbsaResult:
    """POST a docked complex to the pod's /mmgbsa/rescore endpoint.

    Args:
        receptor_pdb: cleaned receptor PDB text (the same format we
            send to /relax_ensemble — heavy atoms, PDBFixer-cleaned).
        ligand_sdf:  docked-pose ligand SDF text with 3D coordinates.
        timeout_s:   HTTP timeout. 180 s default is the upper-end of
            the pod-side wall-time budget (60K-atom kinase system on
            Blackwell minimises in ~30-60 s in our test runs; we leave
            generous slack so transient GPU thermal-throttling doesn't
            time us out).
        max_minimization_steps: passed through to OpenMM
            minimizeEnergy; 500 is ample for a docked pose.

    Returns:
        MmgbsaResult on success.

    Raises:
        MmgbsaError: with `.kind` set so callers can map to specific
            HTTP status codes / user-facing messages.
    """
    from ..config import get_settings, pod_auth_headers
    settings = get_settings()
    pod_url = (settings.pod_dock_url or "").rstrip("/")
    if not pod_url:
        raise MmgbsaError("transport",
                          "pod_dock_url not configured; cannot rescore")

    import httpx
    try:
        with httpx.Client(timeout=timeout_s) as client:
            resp = client.post(
                f"{pod_url}/mmgbsa/rescore",
                json={
                    "receptor_pdb": receptor_pdb,
                    "ligand_sdf": ligand_sdf,
                    "max_minimization_steps": max_minimization_steps,
                },
                headers=pod_auth_headers(),
            )
    except httpx.TimeoutException as e:
        raise MmgbsaError("transport",
                          f"pod /mmgbsa/rescore timeout after {timeout_s}s") from e
    except httpx.RequestError as e:
        raise MmgbsaError("transport",
                          f"pod /mmgbsa/rescore network error: {e}") from e

    if resp.status_code == 401:
        raise MmgbsaError("transport", "pod auth failed (bad X-Pod-Secret)")
    if resp.status_code >= 500:
        raise MmgbsaError("transport",
                          f"pod /mmgbsa/rescore HTTP {resp.status_code}: "
                          f"{resp.text[:300]}")
    if not resp.is_success:
        raise MmgbsaError("transport",
                          f"pod /mmgbsa/rescore HTTP {resp.status_code}: "
                          f"{resp.text[:300]}")

    try:
        payload = resp.json()
    except Exception as e:                                           # noqa: BLE001
        raise MmgbsaError("transport",
                          f"pod /mmgbsa/rescore non-JSON: {resp.text[:200]}") from e

    if not payload.get("ok"):
        error_msg = str(payload.get("error", "unknown pod error"))
        # Triage the kind so the backend can return a useful HTTP code.
        # Missing-deps is the most likely failure mode in v1 since
        # openff-toolkit isn't on the pod by default.
        if "openff-toolkit" in error_msg or "dependencies missing" in error_msg:
            kind = "missing_deps"
        elif "parameterise" in error_msg.lower() or "smarts" in error_msg.lower():
            kind = "parameterisation"
        else:
            kind = "runtime"
        raise MmgbsaError(kind, f"pod MM-GBSA failed: {error_msg}")

    # Defensive: the pod is supposed to return numeric energies, but
    # if it returns None we'd otherwise blow up at float() — wrap.
    try:
        return MmgbsaResult(
            dg_bind_kcal_mol=float(payload["dg_bind_kcal_mol"]),
            e_complex_kcal_mol=float(payload["e_complex_kcal_mol"]),
            e_protein_kcal_mol=float(payload["e_protein_kcal_mol"]),
            e_ligand_kcal_mol=float(payload["e_ligand_kcal_mol"]),
            method=str(payload.get("method", "mmgbsa-openmm")),
            wall_seconds=float(payload.get("wall_seconds", 0.0)),
            receptor_rmsd_a=float(payload.get("receptor_rmsd_a", 0.0)),
        )
    except (KeyError, TypeError, ValueError) as e:
        raise MmgbsaError("runtime",
                          f"pod /mmgbsa/rescore malformed payload: {e}") from e


def merge_into_extra(existing_extra: str | None, result: MmgbsaResult) -> str:
    """Append the MM-GBSA segment to a DockingResult.extra string,
    overwriting any previous mmgbsa_* keys.

    Preserves all non-MM-GBSA segments verbatim — engine, vinardo,
    contacts, strain, etc. all flow through unchanged. Idempotent:
    re-rescoring the same pose replaces the prior MM-GBSA segment
    rather than duplicating it.
    """
    if not existing_extra:
        return result.to_extra_segment()
    # Drop any existing mmgbsa_* segments. The extra string is
    # pipe-delimited key=value pairs; split, filter, join.
    parts = [
        p for p in existing_extra.split("|")
        if not p.lstrip().startswith("mmgbsa_")
    ]
    parts.append(result.to_extra_segment())
    # Note: to_extra_segment includes its own internal '|'s, so we
    # don't add another between the surviving parts and the new
    # segment — join handles that.
    return "|".join(p for p in parts if p)
