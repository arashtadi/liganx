"""Receptor and ligand preparation for docking.

Pipeline: PDBFixer cleans the structure (removes heterogens, adds missing atoms +
hydrogens at pH 7.4). Meeko writes the receptor PDBQT. Meeko also handles ligand
prep from SMILES.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path

log = logging.getLogger(__name__)


class PrepError(RuntimeError):
    pass


def fix_pdb(pdb_path: Path | str, out_path: Path | str, *, chain: str | None = None, ph: float = 7.4) -> Path:
    """Run PDBFixer on a raw PDB to remove heterogens, add missing residues/atoms, add H's.

    Output is a clean polymer-only PDB ready for receptor prep.
    """
    try:
        from pdbfixer import PDBFixer
        from openmm.app import PDBFile
    except ImportError as e:
        raise PrepError(f"PDBFixer/OpenMM not installed: {e}") from e

    pdb_path = Path(pdb_path)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    log.info("PDBFixer: %s → %s (chain=%s, pH=%.1f)", pdb_path.name, out_path.name, chain, ph)
    fixer = PDBFixer(filename=str(pdb_path))

    # Strip everything but the requested chain, then strip non-standard residues/het
    if chain:
        kept = []
        for ch in fixer.topology.chains():
            if ch.id != chain:
                kept.append(ch.index)
        if kept:
            fixer.removeChains(kept)

    fixer.findMissingResidues()
    fixer.findNonstandardResidues()
    fixer.replaceNonstandardResidues()
    fixer.removeHeterogens(keepWater=False)
    fixer.findMissingAtoms()
    fixer.addMissingAtoms()
    # NOTE: Don't add hydrogens here — Meeko adds them itself with chemistry-aware
    # valence handling. PDBFixer's hydrogens trip RDKit sanitization in Meeko.

    with out_path.open("w") as fh:
        PDBFile.writeFile(fixer.topology, fixer.positions, fh, keepIds=True)
    return out_path


def strip_hetatm(pdb_path: Path | str, out_path: Path | str, *, chain: str | None = None) -> Path:
    """Strip co-crystal ligands, waters, ions, and (optionally) other chains from a PDB.

    Meeko's receptor prep treats every HETATM as something it has to build a
    chemical template for, and chokes on most ligands. Stripping HETATMs and
    keeping only the requested chain produces a clean polymer that Meeko handles.
    """
    pdb_path = Path(pdb_path)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    kept = 0
    skipped_het = 0
    with pdb_path.open() as fin, out_path.open("w") as fout:
        for line in fin:
            rec = line[:6].rstrip()
            if rec == "HETATM":
                skipped_het += 1
                continue
            if rec == "ATOM":
                if chain and len(line) > 21 and line[21] != chain:
                    continue
                kept += 1
                fout.write(line)
            elif rec in {"TER", "END", "HEADER", "TITLE", "CRYST1", "REMARK", "SEQRES"}:
                fout.write(line)
    log.info("Cleaned %s → %s (%d ATOM lines, dropped %d HETATM)", pdb_path.name, out_path.name, kept, skipped_het)
    if kept == 0:
        raise PrepError(f"No ATOM lines kept after cleaning {pdb_path}")
    return out_path


def prepare_receptor(pdb_path: Path | str, out_pdbqt: Path | str, *, chain: str | None = None) -> Path:
    """Prepare a receptor PDBQT from a PDB file.

    Pipeline:
      1. PDBFixer: strip heterogens, add missing atoms (no hydrogens — obabel does those).
      2. Open Babel: convert to receptor PDBQT (`-xr` flag = rigid receptor).

    Open Babel handles raw PDBs robustly. Meeko's receptor prep is finicky on
    real-world structures; we use it for ligand prep where it shines.
    """
    pdb_path = Path(pdb_path)
    out_pdbqt = Path(out_pdbqt)
    if not pdb_path.exists():
        raise PrepError(f"Receptor PDB not found: {pdb_path}")
    if not shutil.which("obabel"):
        raise PrepError("obabel not on PATH. Install Open Babel: brew install open-babel")

    fixed = out_pdbqt.with_suffix(".fixed.pdb")
    fix_pdb(pdb_path, fixed, chain=chain)

    cmd = ["obabel", str(fixed), "-O", str(out_pdbqt), "-xr", "-p", "7.4"]
    log.info("Preparing receptor: %s", " ".join(cmd))
    res = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if res.returncode != 0:
        raise PrepError(f"obabel receptor prep failed: {res.stderr.strip() or res.stdout.strip()}")

    if not out_pdbqt.exists() or out_pdbqt.stat().st_size == 0:
        raise PrepError(f"obabel reported success but {out_pdbqt} was not written / empty")
    return out_pdbqt


def _parse_smiles_resilient(smiles: str):
    """Parse a SMILES with progressively looser strategies.

    Returns an RDKit Mol or None. The cascade exists because RDKit's default
    `MolFromSmiles` is strict — it rejects aromaticity-quirky SMILES that other
    cheminformatics tools (PubChem, ChemDraw, Open Babel) emit, and that we
    therefore see for real-world drugs (e.g. Capmatinib's imidazo[1,2-a]pyridine
    SMILES `Cn1ccc2cc(...)cc21`).

    Order of attempts:
      1. Strict default parse — fastest and what most clean SMILES produce.
      2. Loose parse + manual sanitization without aromaticity perception. This
         lets us salvage molecules where the input has explicit kekulé bonds or
         non-standard aromatic ring perception.
      3. Open Babel canonicalization round-trip — OB has different aromaticity
         rules and often produces SMILES RDKit accepts. We feed the SMILES to
         `obabel -ismi -osmi --canonical` and retry RDKit on the output.

    Each step logs which strategy worked so we can tell from the backend log
    when a compound needed rescue.
    """
    from rdkit import Chem

    # Strategy 1: strict default parse
    mol = Chem.MolFromSmiles(smiles)
    if mol is not None:
        return mol

    # Strategy 2: skip default sanitization, then re-sanitize with everything
    # except aromaticity perception (the usual culprit for imidazo-fused rings).
    log.info("SMILES failed strict parse; trying loose-sanitize path: %s", smiles[:80])
    mol = Chem.MolFromSmiles(smiles, sanitize=False)
    if mol is not None:
        try:
            # Sanitize with all flags EXCEPT SANITIZE_SETAROMATICITY. That's the
            # one most likely to reject non-canonical aromaticity.
            sanitize_ops = Chem.SanitizeFlags.SANITIZE_ALL ^ Chem.SanitizeFlags.SANITIZE_SETAROMATICITY
            Chem.SanitizeMol(mol, sanitizeOps=sanitize_ops)
            # Now apply aromaticity using the more permissive MDL model
            Chem.SetAromaticity(mol, Chem.AromaticityModel.AROMATICITY_MDL)
            log.info("SMILES recovered via loose sanitize + MDL aromaticity")
            return mol
        except Exception as e:
            log.info("Loose sanitize failed: %s", e)

    # Strategy 3: Open Babel canonicalization — OB perceives aromaticity
    # differently and often emits a form RDKit accepts.
    if shutil.which("obabel"):
        log.info("Trying Open Babel canonicalization for SMILES rescue")
        try:
            res = subprocess.run(
                ["obabel", f"-:{smiles}", "-osmi", "--canonical"],
                capture_output=True, text=True, timeout=10, check=False,
            )
            ob_smiles = (res.stdout or "").strip().split()[0] if res.stdout.strip() else ""
            if ob_smiles and ob_smiles != smiles:
                mol = Chem.MolFromSmiles(ob_smiles)
                if mol is not None:
                    log.info("SMILES recovered via Open Babel: %s → %s", smiles[:60], ob_smiles[:60])
                    return mol
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
            log.info("Open Babel canonicalization failed: %s", e)

    return None


def prepare_ligand(smiles: str, out_pdbqt: Path | str, *, name: str | None = None) -> Path:
    """Convert a SMILES string into a docking-ready PDBQT.

    Pipeline:
      1. RDKit: SMILES → 3D conformer (ETKDG) + UFF minimization → SDF
      2. Meeko: SDF → PDBQT with proper torsion tree

    SMILES parsing uses a resilient cascade (strict → loose sanitize → Open
    Babel canonicalization) so we can dock real-world drugs that come from
    PubChem/ChemDraw with quirky aromaticity (e.g. Capmatinib).

    Requires `meeko` and `rdkit` in the backend Python env.
    """
    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem
    except ImportError as e:
        raise PrepError(f"RDKit not installed: {e}") from e

    out_pdbqt = Path(out_pdbqt)
    out_pdbqt.parent.mkdir(parents=True, exist_ok=True)

    if not shutil.which("mk_prepare_ligand.py"):
        raise PrepError("mk_prepare_ligand.py (Meeko) not on PATH. pip install meeko")

    # 1) SMILES → 3D SDF — uses the resilient cascade above so quirky SMILES
    # (e.g. Capmatinib's imidazo[1,2-a]pyridine) get a second and third chance
    # via loose sanitization or Open Babel rather than failing the whole row.
    mol = _parse_smiles_resilient(smiles)
    if mol is None:
        raise PrepError(
            f"Could not parse SMILES after strict, loose-sanitize, and Open Babel "
            f"fallbacks: {smiles!r}. The structure may be invalid or use a feature "
            f"none of the parsers support."
        )
    mol = Chem.AddHs(mol)
    if AllChem.EmbedMolecule(mol, AllChem.ETKDGv3()) != 0:
        raise PrepError(f"RDKit could not embed 3D conformer for SMILES: {smiles!r}")
    AllChem.UFFOptimizeMolecule(mol, maxIters=200)
    if name:
        mol.SetProp("_Name", name)

    sdf_path = out_pdbqt.with_suffix(".sdf")
    writer = Chem.SDWriter(str(sdf_path))
    writer.write(mol)
    writer.close()

    # 2) SDF → PDBQT via meeko
    cmd = ["mk_prepare_ligand.py", "-i", str(sdf_path), "-o", str(out_pdbqt)]
    log.info("Preparing ligand: %s → %s", smiles[:60], out_pdbqt.name)
    res = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if res.returncode != 0:
        raise PrepError(f"Ligand prep failed for {smiles!r}: {res.stderr.strip() or res.stdout.strip()}")

    if not out_pdbqt.exists() or out_pdbqt.stat().st_size == 0:
        raise PrepError(f"Ligand prep wrote no file: {out_pdbqt}")
    return out_pdbqt
