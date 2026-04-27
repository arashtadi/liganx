"""Pocket detection.

Phase 1 strategy: use the centroid of the largest non-trivial HETATM in the PDB.
Most PDBs that scientists actually want to dock against were crystallized with a
ligand sitting in the binding pocket — that ligand's centroid is an excellent
pocket centre. This single heuristic handles ~80% of real PDBs for free.

Phase 2: integrate fpocket (via conda) or P2Rank for de-novo pocket detection
when no co-crystal ligand exists.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

# Heteroatoms we ignore — these are crystallographic noise, not the binding ligand.
_NOISE_HETS = {
    # Solvents / cryoprotectants
    "HOH", "WAT", "GOL", "EDO", "PEG", "PG4", "DMS", "ACT", "FMT", "TRS", "BME",
    # Common ions
    "CL", "BR", "F", "I", "NA", "K", "MG", "CA", "ZN", "FE", "MN", "CU", "NI",
    "SO4", "PO4", "NO3", "ACE",
    # Sugars/lipids that often co-crystallize but aren't the drug pocket
    "NAG", "MAN", "FUC", "GAL", "BMA", "BGC", "GLC",
    # Cofactors that mark a different binding site (not the drug pocket)
    # — these we KEEP (NAP, FAD, etc.) because for some targets they ARE the
    # pocket of interest. The user can override if needed.
}


@dataclass
class DetectedPocket:
    """A pocket centroid found by the heuristic."""
    center: tuple[float, float, float]
    source_het: str          # which HET group it came from
    atom_count: int          # how many atoms — bigger = more confident
    method: str = "biggest_het"  # detection method, for telemetry


def detect_pocket(pdb_path: Path | str, *, chain: str | None = None) -> DetectedPocket | None:
    """Find a pocket centroid in a PDB by largest non-trivial HETATM.

    Args:
        pdb_path: any PDB file (raw or cleaned).
        chain: if given, only consider HETATMs on this chain.

    Returns:
        A DetectedPocket, or None if no usable HETATM exists.
    """
    pdb_path = Path(pdb_path)
    if not pdb_path.exists():
        return None

    het_groups: dict[str, list[tuple[float, float, float]]] = {}
    with pdb_path.open() as f:
        for line in f:
            if not line.startswith("HETATM"):
                continue
            res = line[17:20].strip()
            if res in _NOISE_HETS:
                continue
            if chain and len(line) > 21 and line[21] != chain:
                continue
            try:
                xyz = (float(line[30:38]), float(line[38:46]), float(line[46:54]))
            except ValueError:
                continue
            het_groups.setdefault(res, []).append(xyz)

    if not het_groups:
        log.info("No co-crystal HETATM found in %s — pocket cannot be auto-detected", pdb_path.name)
        return None

    # Largest non-trivial HET = most likely the bound drug
    name, atoms = max(het_groups.items(), key=lambda kv: len(kv[1]))
    cx = sum(a[0] for a in atoms) / len(atoms)
    cy = sum(a[1] for a in atoms) / len(atoms)
    cz = sum(a[2] for a in atoms) / len(atoms)
    log.info(
        "Auto-detected pocket from %s in %s: centroid (%.1f, %.1f, %.1f), %d atoms",
        name, pdb_path.name, cx, cy, cz, len(atoms),
    )
    return DetectedPocket(
        center=(cx, cy, cz),
        source_het=name,
        atom_count=len(atoms),
    )
