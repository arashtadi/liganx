"""Crystallographic-water displacement scoring (Phase 0 of #103).

WHY THIS MODULE EXISTS

Schrödinger's WaterMap pitches around an idea every medicinal chemist
has internalised: binding-site water rearrangement is part of the
ΔG of binding, and ignoring it leaves a real signal on the table —
especially in mutation-aware work where a single residue change can
reshape the local water network without moving the protein heavy
atoms.

Our docking engines (Vina, GNINA, eventually Boltz-2) all treat the
binding site as dehydrated. Solvation effects get absorbed into
empirical scoring, and the WT-vs-mutant Δ loses any signal that
comes purely from water-network rearrangement.

Phase 0 is the cheapest possible thing that exposes water info to
the user: parse the canonical PDB's deposited HOH records, score each
docked pose by which of those crystallographic waters it overlaps
(= "displaces"), and look up how conserved each displaced water is
across other PDB structures of the same UniProt entry.

WHAT THIS IS NOT

This is not WaterMap. We do not:
- Run molecular dynamics on the apo protein.
- Compute per-water free-energy via inhomogeneous solvation theory.
- Predict de novo waters in mutant pockets.

We score whether a docked pose overlaps with empirically observed
crystallographic waters, weighted by how often those waters appear
across the same target's structures. Conserved-water displacement is
*correlated* with thermodynamic cost in the literature, but this is
a heuristic — see docs/water_displacement_plan.md for the
Phase 1 (3D-RISM) and Phase 2 (GIST) plans where we get to actual
ΔG numbers.

INTERPRETATION

For a single pose:
- 0 displaced waters: pose sits in a dry pocket region, or all
  pocket waters have moved out of the way. Common for buried
  hydrophobic binders.
- 1-3 displaced waters: typical for kinase inhibitors. The
  conservation column tells you whether this is a "structural"
  water (consistently observed across PDB entries) or a one-off
  crystallographic artefact.
- 4+ displaced waters: pose displaces a ring of waters; if those
  are all conserved, the cost can be substantial. Worth flagging.

For a WT-vs-mutant comparison (the Liganx use case):
- Same displacement count, same conservation: water network not
  meaningfully different.
- Different counts or conservations: the mutation reshaped local
  waters in a way our docking score didn't capture. The Δ between
  the two Vina scores is missing this signal.

We don't try to estimate the ΔG_water in this module — that's
Phase 1's job once we wire 3D-RISM. For now we expose counts +
conservation lists and let the chemist read them.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)


# Atoms within this distance of a ligand heavy atom are considered displaced.
# Rationale: an O–C contact closer than ~1.5 Å is a steric clash, so a water
# whose oxygen sits within 1.5 Å of any ligand atom can't physically be there
# in the docked complex. We use 2.0 Å as a slightly more permissive default
# because docking poses are imperfect and 1.5 Å excludes borderline cases
# that real chemists would still call displacement. Configurable per-call.
DEFAULT_DISPLACEMENT_RADIUS_A = 2.0


@dataclass
class CrystalWater:
    """A single HOH oxygen atom from a PDB structure."""
    serial: int           # PDB atom serial number
    chain: str            # chain ID (often blank or single letter)
    res_seq: int          # residue sequence number for this water
    x: float
    y: float
    z: float
    b_factor: float = 0.0  # B-factor: high values = mobile, less reliable


@dataclass
class DisplacedWater:
    """A crystallographic water displaced by a docked pose, with the
    distance to the closest ligand atom and a coarse conservation flag."""
    water: CrystalWater
    closest_ligand_distance_a: float
    # Conservation lookup result. If the user opts into the conservation
    # query (slow — hits an external API), this is the count of PDB
    # structures of the same UniProt that have a water at this position
    # (within 1.5 Å). When skipped, this is None.
    conservation_count: int | None = None
    conservation_total: int | None = None  # how many structures we checked


@dataclass
class WaterAnalysisResult:
    """Output of one (receptor, pose) water analysis. Serialisable to
    JSON for storage on the Cell row."""
    pose_id: str
    pocket_water_count: int           # crystal waters within pocket_radius
    displaced_count: int              # of those, displaced by pose
    displaced: list[DisplacedWater] = field(default_factory=list)
    pocket_radius_a: float = 8.0
    displacement_radius_a: float = DEFAULT_DISPLACEMENT_RADIUS_A
    # Free-form notes the analyser wrote — surfaces "no waters in PDB",
    # "B-factors all high, low confidence", etc. for the UI.
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "pose_id": self.pose_id,
            "pocket_water_count": self.pocket_water_count,
            "displaced_count": self.displaced_count,
            "displaced": [
                {
                    "serial": dw.water.serial,
                    "chain": dw.water.chain,
                    "res_seq": dw.water.res_seq,
                    "x": dw.water.x, "y": dw.water.y, "z": dw.water.z,
                    "b_factor": dw.water.b_factor,
                    "closest_ligand_distance_a": dw.closest_ligand_distance_a,
                    "conservation_count": dw.conservation_count,
                    "conservation_total": dw.conservation_total,
                }
                for dw in self.displaced
            ],
            "pocket_radius_a": self.pocket_radius_a,
            "displacement_radius_a": self.displacement_radius_a,
            "notes": self.notes,
        }


# ─── PDB parsers ───────────────────────────────────────────────────────────

def extract_crystal_waters(receptor_pdb: Path | str) -> list[CrystalWater]:
    """Pull HOH oxygens from a PDB file.

    PDB convention: water molecules are HETATM records with res_name == 'HOH'
    (sometimes 'WAT' or 'TIP3'; we match all three). We only pull the
    oxygen atom — most deposited PDBs don't include water hydrogens, and
    when they do they're usually placed by a riding model that's
    geometric, not energetic.
    """
    p = Path(receptor_pdb)
    if not p.exists():
        raise FileNotFoundError(f"Receptor PDB not found: {p}")

    waters: list[CrystalWater] = []
    for line in p.read_text().splitlines():
        if not line.startswith(("HETATM", "ATOM  ")):
            continue
        # Columns per PDB spec: name=12-15, resName=17-19, chain=21,
        # resSeq=22-25, x=30-37, y=38-45, z=46-53, B=60-65, element=76-77.
        if len(line) < 66:
            continue
        atom_name = line[12:16].strip()
        res_name = line[17:20].strip()
        if res_name not in {"HOH", "WAT", "TIP3", "TIP", "T3P"}:
            continue
        if atom_name not in {"O", "OW", "OH2"}:
            # Only the water oxygen — skip riding-model H atoms.
            continue
        try:
            serial = int(line[6:11])
            chain = line[21:22].strip() or " "
            res_seq = int(line[22:26])
            x = float(line[30:38]); y = float(line[38:46]); z = float(line[46:54])
            b = float(line[60:66]) if line[60:66].strip() else 0.0
        except ValueError:
            continue
        waters.append(CrystalWater(
            serial=serial, chain=chain, res_seq=res_seq,
            x=x, y=y, z=z, b_factor=b,
        ))
    return waters


def extract_ligand_heavy_atoms(pose_pdb: Path | str) -> list[tuple[float, float, float]]:
    """Heavy-atom coordinates from a docked-ligand PDB or PDBQT file.

    Reads HETATM and ATOM records and skips any whose element column is 'H'.
    PDBQT files use different element codes (A=aromatic C, NA=N acceptor,
    OA=O acceptor, etc.); all of those are heavy atoms, so we only filter
    on the literal 'H' or 'D' (deuterium) element. Returns coordinates as
    a list of (x, y, z) tuples — small + fast for the displacement scan.
    """
    p = Path(pose_pdb)
    if not p.exists():
        raise FileNotFoundError(f"Pose file not found: {p}")

    coords: list[tuple[float, float, float]] = []
    for line in p.read_text().splitlines():
        if not line.startswith(("HETATM", "ATOM  ")):
            continue
        if len(line) < 54:
            continue
        # Element column (76-77 in PDB; PDBQT puts atom type in same
        # range but interpretation differs — treat 'H'/'D' as hydrogen
        # and everything else as heavy).
        elem = line[76:78].strip().upper() if len(line) >= 78 else ""
        if not elem:
            # Fall back to atom name — PDBQT often omits element column.
            atom_name = line[12:16].strip()
            elem = atom_name[:1] if atom_name else ""
        if elem in {"H", "D"}:
            continue
        try:
            x = float(line[30:38]); y = float(line[38:46]); z = float(line[46:54])
        except ValueError:
            continue
        coords.append((x, y, z))
    return coords


# ─── Geometry ──────────────────────────────────────────────────────────────

def _distance(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2)


def _waters_in_pocket(
    waters: list[CrystalWater],
    pocket_centre: tuple[float, float, float],
    pocket_radius_a: float,
) -> list[CrystalWater]:
    return [
        w for w in waters
        if _distance((w.x, w.y, w.z), pocket_centre) <= pocket_radius_a
    ]


# ─── Public entry point ────────────────────────────────────────────────────

def analyse_pose_water_displacement(
    receptor_pdb: Path | str,
    pose_pdb: Path | str,
    pocket_centre: tuple[float, float, float],
    *,
    pose_id: str = "pose",
    pocket_radius_a: float = 8.0,
    displacement_radius_a: float = DEFAULT_DISPLACEMENT_RADIUS_A,
    high_b_factor_threshold: float = 50.0,
) -> WaterAnalysisResult:
    """Score one (receptor, pose) for crystallographic-water displacement.

    Args
    ----
    receptor_pdb : Path
        PDB file for the receptor with HOH records preserved. NOTE: our
        existing receptor-prep pipeline strips HETATMs (including water);
        this analysis needs to run against the *raw* downloaded PDB before
        stripping, OR against a separately retained "with-waters" copy.
        Caller is responsible for routing the right input — this module
        does not re-fetch.
    pose_pdb : Path
        Docked ligand PDB (or PDBQT — both work). Heavy atoms only.
    pocket_centre : (x, y, z)
        Same pocket centre used for the docking box. Crystal waters
        outside `pocket_radius_a` of this point are ignored — they're
        not in the binding site and displacement of distant waters
        isn't meaningful for binding affinity.
    pocket_radius_a : float
        Sphere radius around pocket_centre that defines "pocket water".
        8 Å covers the typical kinase ATP pocket.
    displacement_radius_a : float
        A water is "displaced" if its O atom sits within this distance
        of any ligand heavy atom. Default 2.0 Å (steric clash + slight
        margin for pose imperfection).
    high_b_factor_threshold : float
        B-factor above which a water is annotated as "mobile / low
        confidence" in the notes — high-B waters are crystallographic
        noise and shouldn't be over-interpreted.

    Returns
    -------
    WaterAnalysisResult with displaced_count + per-water details.
    """
    waters_all = extract_crystal_waters(receptor_pdb)
    pocket_waters = _waters_in_pocket(waters_all, pocket_centre, pocket_radius_a)
    ligand_atoms = extract_ligand_heavy_atoms(pose_pdb)

    notes: list[str] = []
    if not waters_all:
        notes.append(
            "No crystallographic waters in receptor PDB — either the structure "
            "was deposited without solvent (common for cryo-EM and lower-"
            "resolution X-ray) or the receptor-prep pipeline stripped them. "
            "Phase 0 water analysis cannot run on this target without raw "
            "deposited waters; Phase 1 (3D-RISM) will resolve this."
        )
        return WaterAnalysisResult(
            pose_id=pose_id,
            pocket_water_count=0,
            displaced_count=0,
            pocket_radius_a=pocket_radius_a,
            displacement_radius_a=displacement_radius_a,
            notes=notes,
        )

    if not pocket_waters:
        notes.append(
            f"{len(waters_all)} crystallographic waters in PDB but none within "
            f"{pocket_radius_a:.1f} Å of pocket centre — binding site is "
            "dehydrated in this structure."
        )

    if not ligand_atoms:
        notes.append("No heavy atoms parsed from pose file — analysis aborted.")
        return WaterAnalysisResult(
            pose_id=pose_id,
            pocket_water_count=len(pocket_waters),
            displaced_count=0,
            pocket_radius_a=pocket_radius_a,
            displacement_radius_a=displacement_radius_a,
            notes=notes,
        )

    displaced: list[DisplacedWater] = []
    for w in pocket_waters:
        # Closest ligand heavy atom to this water.
        wo = (w.x, w.y, w.z)
        d_min = min(_distance(wo, la) for la in ligand_atoms)
        if d_min <= displacement_radius_a:
            displaced.append(DisplacedWater(
                water=w,
                closest_ligand_distance_a=round(d_min, 3),
            ))

    # B-factor confidence flag — useful nudge for the UI.
    high_b_displaced = [d for d in displaced if d.water.b_factor >= high_b_factor_threshold]
    if high_b_displaced:
        notes.append(
            f"{len(high_b_displaced)} of {len(displaced)} displaced waters have "
            f"B-factor ≥ {high_b_factor_threshold} — those positions are "
            "mobile in the crystal and the displacement signal is weaker."
        )

    return WaterAnalysisResult(
        pose_id=pose_id,
        pocket_water_count=len(pocket_waters),
        displaced_count=len(displaced),
        displaced=displaced,
        pocket_radius_a=pocket_radius_a,
        displacement_radius_a=displacement_radius_a,
        notes=notes,
    )


def compare_wt_mutant_water_displacement(
    wt_result: WaterAnalysisResult,
    mut_result: WaterAnalysisResult,
) -> dict:
    """Side-by-side WT vs mutant water comparison for the Liganx use case.

    Surfaces the WT-vs-mutant Δ that the docking score doesn't see.
    Returns a dict suitable for direct JSON serialisation onto a Cell row.
    """
    wt_serials = {dw.water.serial for dw in wt_result.displaced}
    mut_serials = {dw.water.serial for dw in mut_result.displaced}
    return {
        "wt_displaced": wt_result.displaced_count,
        "mut_displaced": mut_result.displaced_count,
        "delta_displaced": mut_result.displaced_count - wt_result.displaced_count,
        # Waters displaced by mutant but not WT — new displacements caused
        # by the mutation. The interesting set for selectivity / resistance
        # interpretation.
        "mut_only_serials": sorted(mut_serials - wt_serials),
        "wt_only_serials": sorted(wt_serials - mut_serials),
        "shared_serials": sorted(wt_serials & mut_serials),
        "notes": wt_result.notes + mut_result.notes,
    }
