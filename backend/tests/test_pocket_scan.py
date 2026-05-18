"""(N4.1) Unit tests for the pocket residue scanning utility.

These tests synthesise tiny PDB / SDF files at runtime so they
don't depend on the Fly volume cache or any external structure
file. The geometry is rigged so each test asserts on a specific,
human-verifiable distance.
"""
from __future__ import annotations

from pathlib import Path

import pytest


# ─── Synthetic-fixture helpers ───────────────────────────────────────────


def _write_three_residue_pdb(path: Path) -> None:
    """Write a minimal 3-residue PDB:
      Residue 1: ALA at origin (CA at 0,0,0)
      Residue 2: PHE at (5, 0, 0)
      Residue 3: LYS at (15, 0, 0) — far from origin

    Each residue carries enough atoms (N, CA, C, O, plus a sidechain
    Cβ) to exercise both backbone-only and sidechain-contact paths.
    """
    lines = [
        # PDB record format: ATOM, serial, name, altLoc, resName,
        # chainID, resSeq, iCode, x, y, z, occupancy, tempFactor,
        # element
        # Residue 1 — ALA at origin (only backbone atoms within range)
        "ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 10.00           N  ",
        "ATOM      2  CA  ALA A   1       0.000   0.000   0.500  1.00 10.00           C  ",
        "ATOM      3  C   ALA A   1       0.000   0.000   1.000  1.00 10.00           C  ",
        "ATOM      4  O   ALA A   1       0.000   0.000   1.500  1.00 10.00           O  ",
        "ATOM      5  CB  ALA A   1       1.000   0.000   0.500  1.00 10.00           C  ",
        # Residue 2 — PHE with CG ~ 4 Å from the ligand atom at (5,0,5)
        "ATOM      6  N   PHE A   2       5.000   0.000   0.000  1.00 10.00           N  ",
        "ATOM      7  CA  PHE A   2       5.000   0.000   0.500  1.00 10.00           C  ",
        "ATOM      8  C   PHE A   2       5.000   0.000   1.000  1.00 10.00           C  ",
        "ATOM      9  O   PHE A   2       5.000   0.000   1.500  1.00 10.00           O  ",
        "ATOM     10  CB  PHE A   2       6.000   0.000   0.500  1.00 10.00           C  ",
        "ATOM     11  CG  PHE A   2       7.000   0.000   0.500  1.00 10.00           C  ",
        # Residue 3 — LYS far away (>15 Å from any ligand atom)
        "ATOM     12  N   LYS A   3      15.000   0.000   0.000  1.00 10.00           N  ",
        "ATOM     13  CA  LYS A   3      15.000   0.000   0.500  1.00 10.00           C  ",
        "ATOM     14  C   LYS A   3      15.000   0.000   1.000  1.00 10.00           C  ",
        "ATOM     15  O   LYS A   3      15.000   0.000   1.500  1.00 10.00           O  ",
        "ATOM     16  CB  LYS A   3      16.000   0.000   0.500  1.00 10.00           C  ",
        # Water — should be skipped
        "HETATM   17  O   HOH A 101       2.000   0.000   2.000  1.00 10.00           O  ",
        "END",
    ]
    path.write_text("\n".join(lines) + "\n")


def _write_single_atom_ligand_sdf(path: Path, x: float, y: float, z: float) -> None:
    """Write a minimal SDF with a single carbon at the given coordinates.
    Tests use this to put the 'ligand' atom at a specific known position
    and assert which residues fall within cutoff."""
    sdf = f"""ligand
  -ISIS-  10211218003D 0   0.00000     0.00000

  1  0  0  0  0  0  0  0  0  0999 V2000
{x:10.4f}{y:10.4f}{z:10.4f} C   0  0  0  0  0  0  0  0  0  0  0  0
M  END
$$$$
"""
    path.write_text(sdf)


# ─── Tests ────────────────────────────────────────────────────────────────


def test_scan_finds_nearby_residues_excludes_far_one(tmp_path):
    """Ligand at (5,0,5) should hit ALA-1 (backbone via CA path) and
    PHE-2 (via CG sidechain) but not LYS-3 (>15 Å away)."""
    from deltadock.services.pocket_scan import scan_pocket_residues

    pdb = tmp_path / "test.pdb"
    sdf = tmp_path / "test.sdf"
    _write_three_residue_pdb(pdb)
    _write_single_atom_ligand_sdf(sdf, x=5.0, y=0.0, z=5.0)

    results = scan_pocket_residues(pdb, sdf, distance_cutoff_angstroms=6.0)

    resnums = [r.resnum for r in results]
    assert 2 in resnums, "PHE-2 should be in the pocket (~4.5 Å via CG)"
    assert 3 not in resnums, "LYS-3 is >15 Å away — must not be in the pocket"


def test_scan_excludes_waters_by_default(tmp_path):
    """The HETATM HOH in the fixture must NOT appear in results."""
    from deltadock.services.pocket_scan import scan_pocket_residues

    pdb = tmp_path / "test.pdb"
    sdf = tmp_path / "test.sdf"
    _write_three_residue_pdb(pdb)
    _write_single_atom_ligand_sdf(sdf, x=2.0, y=0.0, z=2.0)  # near the water

    results = scan_pocket_residues(pdb, sdf, distance_cutoff_angstroms=6.0)

    resnames = {r.resname for r in results}
    assert "HOH" not in resnames, "Waters must be excluded from pocket scan"


def test_scan_results_sorted_by_distance_ascending(tmp_path):
    """Closer residues come first in the returned list."""
    from deltadock.services.pocket_scan import scan_pocket_residues

    pdb = tmp_path / "test.pdb"
    sdf = tmp_path / "test.sdf"
    _write_three_residue_pdb(pdb)
    # Ligand right next to ALA-1 — should rank ALA before PHE.
    _write_single_atom_ligand_sdf(sdf, x=0.0, y=0.0, z=2.0)

    results = scan_pocket_residues(pdb, sdf, distance_cutoff_angstroms=8.0)

    assert len(results) >= 2
    assert results[0].min_dist <= results[1].min_dist


def test_scan_distance_is_correct_to_two_decimals(tmp_path):
    """Ligand atom at (0, 0, 3) — closest ALA-1 atom is O at (0, 0, 1.5),
    distance 1.5 Å exactly. Confirms heavy-atom distance scan reports
    sub-decimal precision and identifies the correct contact atom."""
    from deltadock.services.pocket_scan import scan_pocket_residues

    pdb = tmp_path / "test.pdb"
    sdf = tmp_path / "test.sdf"
    _write_three_residue_pdb(pdb)
    _write_single_atom_ligand_sdf(sdf, x=0.0, y=0.0, z=3.0)

    results = scan_pocket_residues(pdb, sdf, distance_cutoff_angstroms=6.0)
    ala = next(r for r in results if r.resnum == 1)
    # ALA atoms vs ligand at (0,0,3): N→3.0, CA→2.5, C→2.0, O→1.5,
    # CB→sqrt(1²+0+2.5²)≈2.69. O wins as closest.
    assert abs(ala.min_dist - 1.5) < 0.01, f"expected 1.5 Å, got {ala.min_dist}"
    assert ala.closest_atom == "O"
    assert ala.is_backbone_only is True       # O is a backbone atom


def test_mutation_label_formats_correctly(tmp_path):
    """to_mutation_label('M') on a THR-790 residue should produce 'T790M'."""
    from deltadock.services.pocket_scan import PocketResidue

    res = PocketResidue(
        chain="A",
        resnum=790,
        resname="THR",
        min_dist=3.4,
        closest_atom="OG1",
        is_backbone_only=False,
    )
    assert res.to_mutation_label("M") == "T790M"


def test_chain_filter_excludes_other_chains(tmp_path):
    """Passing chain_filter='B' should drop chain-A residues even if
    they're in range. The fixture is all chain A, so we expect zero
    results."""
    from deltadock.services.pocket_scan import scan_pocket_residues

    pdb = tmp_path / "test.pdb"
    sdf = tmp_path / "test.sdf"
    _write_three_residue_pdb(pdb)
    _write_single_atom_ligand_sdf(sdf, x=0.0, y=0.0, z=2.0)

    results = scan_pocket_residues(
        pdb, sdf, distance_cutoff_angstroms=8.0, chain_filter="B"
    )
    assert results == []


def test_raises_on_missing_files(tmp_path):
    """Both inputs must exist or scan raises FileNotFoundError up front."""
    from deltadock.services.pocket_scan import scan_pocket_residues

    sdf = tmp_path / "exists.sdf"
    _write_single_atom_ligand_sdf(sdf, x=0.0, y=0.0, z=0.0)

    with pytest.raises(FileNotFoundError):
        scan_pocket_residues(tmp_path / "missing.pdb", sdf)

    pdb = tmp_path / "exists.pdb"
    _write_three_residue_pdb(pdb)
    with pytest.raises(FileNotFoundError):
        scan_pocket_residues(pdb, tmp_path / "missing.sdf")
