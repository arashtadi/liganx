"""Cross-docking sanity check.

Re-docks the bound co-crystal ligand back into its own pocket using the
exact same pipeline (Vina/QuickVina-GPU + meeko prep) the user's compounds
go through, then measures heavy-atom RMSD between the docked pose and the
original crystallographic geometry.

This is the gold-standard self-consistency test for any docking workflow
— see CASF-2016, DUD-E, every docking benchmark paper. Industry rule of
thumb (Wang 2003, Hartshorn 2007, Cole 2018):

    < 2.0 Å RMSD  → "valid"     pocket + scoring + box are well-behaved
    2.0-4.0 Å     → "uncertain" docked in the right neighborhood but off
    > 4.0 Å       → "questionable" pocket likely mis-defined or scoring junk

We surface this as a "PDB quality" badge in the JobPage header so users
know whether to trust the docking matrix on a custom PDB. Catalog targets
(curated kinases) skip the check — they're pre-validated by us.

Cost: one extra dock per (pdb_id, chain), cached to disk forever after.
Runs lazily as a background task triggered by the first user job for that
target, so it never blocks the user's actual results.
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
from dataclasses import dataclass, asdict
from pathlib import Path

log = logging.getLogger(__name__)

# Cache directory (per-machine; ephemeral on Fly. Pre-baking these for
# catalog targets at build time is the natural follow-up.)
CACHE_DIR = Path.home() / ".deltadock" / "crossdock-cache"


@dataclass
class CrossDockResult:
    """Outcome of one cross-docking sanity check.

    Stored as JSON in CACHE_DIR/{pdb_id}_{chain}.json so the next
    request for the same (pdb_id, chain) hits the cache instantly.
    """
    pdb_id: str
    chain: str
    ligand_resname: str         # which HETATM was used (e.g. "HYZ", "GFB")
    rmsd_angstroms: float       # heavy-atom RMSD docked-vs-crystal
    verdict: str                # "valid" | "uncertain" | "questionable"
    smiles: str                 # canonical SMILES of the extracted ligand
    crystal_atom_count: int     # heavy atoms in the crystal ligand
    docked_atom_count: int      # heavy atoms in the docked ligand (should match)
    timestamp: str = ""         # ISO date for telemetry


def _cache_path(pdb_id: str, chain: str) -> Path:
    """Where the cached result for this target lives."""
    return CACHE_DIR / f"{pdb_id}_{chain}.json"


def load_cached(pdb_id: str, chain: str) -> dict | None:
    """Return the cached cross-dock result for (pdb_id, chain), or None.

    The router calls this in /jobs serializer to cheaply enrich every job
    response — no work, just a JSON read."""
    path = _cache_path(pdb_id, chain)
    if not path.exists() or path.stat().st_size == 0:
        return None
    try:
        return json.loads(path.read_text())
    except Exception as e:
        log.info("crossdock cache read failed for %s_%s: %s", pdb_id, chain, e)
        return None


def save_cached(result: CrossDockResult) -> None:
    """Persist a cross-dock outcome. Atomic write so partial reads can't
    return half a result if the process dies mid-write."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _cache_path(result.pdb_id, result.chain)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(asdict(result), indent=2))
    tmp.replace(path)


def extract_cocrystal_ligand(pdb_path: Path, chain: str | None = None) -> dict | None:
    """Extract the largest non-trivial HETATM from a PDB into its own
    file + SMILES. Returns None if no ligand found (apo structure).

    Uses the same noise-het filter as pocket detection so the chosen
    ligand is the same one the docking box was anchored to — no surprise
    "wait, you docked into a glycerol pocket?" cases.

    Returns: {resname, atom_count, lig_pdb_path, smiles}
    """
    from .pocket import _NOISE_HETS

    pdb_path = Path(pdb_path)
    if not pdb_path.exists():
        return None

    # Group HETATM lines by residue name (capturing the entire ATOM block).
    het_groups: dict[str, list[str]] = {}
    with pdb_path.open() as f:
        for line in f:
            if not line.startswith("HETATM"):
                continue
            res = line[17:20].strip()
            if res in _NOISE_HETS:
                continue
            if chain and len(line) > 21 and line[21] != chain:
                continue
            het_groups.setdefault(res, []).append(line)

    if not het_groups:
        return None

    # Pick the largest = most likely the actual co-crystal drug.
    name, lines = max(het_groups.items(), key=lambda kv: len(kv[1]))
    if len(lines) < 6:
        # < 6 heavy atoms is too small to be a meaningful drug — likely a
        # buffer molecule that escaped the noise filter.
        log.info("crossdock: largest HETATM %s in %s has only %d atoms — skipping",
                 name, pdb_path.name, len(lines))
        return None

    lig_pdb = pdb_path.parent / f"{pdb_path.stem}_{name}_crystal.pdb"
    lig_pdb.write_text("".join(lines) + "END\n")

    # Convert PDB → SMILES via RDKit (uses connectivity from the file's
    # CONECT records when present; falls back to bond perception by
    # geometry otherwise — usually fine for drug-sized ligands).
    smiles = _pdb_to_smiles(lig_pdb)
    if not smiles:
        log.info("crossdock: could not derive SMILES from %s ligand %s", pdb_path.name, name)
        return None

    return {
        "resname": name,
        "atom_count": len(lines),
        "lig_pdb_path": str(lig_pdb),
        "smiles": smiles,
    }


def _pdb_to_smiles(lig_pdb: Path) -> str | None:
    """Read a single-ligand PDB and return canonical SMILES.

    Tries RDKit's MolFromPDBFile first (fast, uses CONECT records);
    falls back to obabel SMILES output if RDKit can't parse (common with
    atypical metal coordination or unusual residues)."""
    try:
        from rdkit import Chem
        mol = Chem.MolFromPDBFile(str(lig_pdb), removeHs=True, sanitize=True)
        if mol is not None:
            smi = Chem.MolToSmiles(mol, canonical=True)
            if smi:
                return smi
    except Exception as e:
        log.info("crossdock: RDKit PDB parse failed for %s: %s", lig_pdb.name, e)

    # Obabel fallback
    if shutil.which("obabel"):
        try:
            res = subprocess.run(
                ["obabel", str(lig_pdb), "-osmi"],
                capture_output=True, text=True, check=False, timeout=15,
            )
            if res.returncode == 0:
                # obabel prints "smiles\tname"; we just want the first token.
                line = (res.stdout.strip().splitlines() or [""])[0]
                tok = line.split()[0] if line else ""
                if tok and tok != "":
                    return tok
        except Exception as e:
            log.info("crossdock: obabel SMILES extraction failed: %s", e)
    return None


def heavy_atom_rmsd(pose_sdf: Path, crystal_pdb: Path) -> float | None:
    """Compute heavy-atom RMSD between two structures of the same molecule.

    Uses RDKit's GetBestRMS with substructure matching as a fallback for
    the common case where atom orders diverge between PDBQT round-trip
    output and the original crystal PDB.
    """
    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem, rdMolAlign
    except ImportError:
        return None

    pose_sdf = Path(pose_sdf)
    crystal_pdb = Path(crystal_pdb)
    if not pose_sdf.exists() or not crystal_pdb.exists():
        return None

    try:
        suppl = Chem.SDMolSupplier(str(pose_sdf), removeHs=True, sanitize=True)
        pose = next((m for m in suppl if m is not None), None)
    except Exception:
        return None
    try:
        crystal = Chem.MolFromPDBFile(str(crystal_pdb), removeHs=True, sanitize=True)
    except Exception:
        return None
    if pose is None or crystal is None:
        return None

    # Try direct RMSD first (works if atom orders match).
    try:
        return float(AllChem.GetBestRMS(pose, crystal))
    except Exception:
        pass

    # Substructure-match fallback for atom-order divergence.
    try:
        match = pose.GetSubstructMatch(crystal)
        if match and len(match) == crystal.GetNumAtoms():
            atom_map = list(zip(match, range(crystal.GetNumAtoms())))
            return float(rdMolAlign.GetBestRMS(pose, crystal, map=[atom_map]))
    except Exception:
        pass
    try:
        match = crystal.GetSubstructMatch(pose)
        if match and len(match) == pose.GetNumAtoms():
            atom_map = list(zip(range(pose.GetNumAtoms()), match))
            return float(rdMolAlign.GetBestRMS(pose, crystal, map=[atom_map]))
    except Exception:
        pass
    return None


def verdict_from_rmsd(rmsd: float) -> str:
    """Bucket RMSD into the badge color the UI shows."""
    if rmsd < 2.0:
        return "valid"
    if rmsd < 4.0:
        return "uncertain"
    return "questionable"
