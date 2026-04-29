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
    """Clean a PDB for docking while preserving the ORIGINAL residue numbering.

    Output is a clean polymer-only PDB ready for receptor prep.

    **Why this is delicate:** PDBFixer's `findMissingResidues()` + `addMissingAtoms()`
    pipeline inserts gap-filler residues into the topology and re-emits residue IDs
    starting from 1. That silently breaks every literature-numbered mutation
    ("D835V", "T790M", "R132C") because the residue the user typed no longer
    points to where they think it does — and FoldX then mutates whatever atom
    happens to land at that index, with no error. This caused every precached
    mutant receptor to be effectively WT (see project_pdbfixer_renumbering_bug.md).

    **Fix:** Use pure-Python HETATM/chain stripping (preserves all original
    residue IDs from the PDB), then run PDBFixer ONLY for replacing
    nonstandard residues (MSE → MET, etc.) and adding *missing atoms within
    existing residues* — but skip `findMissingResidues` so we never insert
    new residues that would perturb numbering.
    """
    try:
        from pdbfixer import PDBFixer
        from openmm.app import PDBFile
    except ImportError as e:
        raise PrepError(f"PDBFixer/OpenMM not installed: {e}") from e

    pdb_path = Path(pdb_path)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Step 1: pre-strip HETATMs and non-requested chains in pure Python so we
    # know the residue IDs are preserved bit-for-bit from the input PDB.
    pre_stripped = out_path.with_suffix(".prestrip.pdb")
    strip_hetatm(pdb_path, pre_stripped, chain=chain)

    # Step 2: hand the pre-stripped PDB to PDBFixer for chemistry repairs ONLY.
    # We deliberately do NOT call findMissingResidues — that's the call that
    # inserts gap residues and renumbers everything.
    log.info("PDBFixer (numbering-preserving): %s → %s (chain=%s, pH=%.1f)",
             pre_stripped.name, out_path.name, chain, ph)
    fixer = PDBFixer(filename=str(pre_stripped))

    # Replace selenomethionine/etc with their standard counterparts (in-place
    # in the existing residue, no renumbering).
    fixer.findNonstandardResidues()
    fixer.replaceNonstandardResidues()

    # Add missing heavy atoms within existing residues (e.g., disordered
    # side chains in flexible loops). Critically: with missingResidues set
    # to {} explicitly, addMissingAtoms only fills WITHIN-residue gaps and
    # never adds new residues to the topology.
    fixer.missingResidues = {}
    fixer.findMissingAtoms()
    fixer.addMissingAtoms()
    # NOTE: Don't add hydrogens here — Meeko adds them itself with chemistry-aware
    # valence handling. PDBFixer's hydrogens trip RDKit sanitization in Meeko.

    with out_path.open("w") as fh:
        PDBFile.writeFile(fixer.topology, fixer.positions, fh, keepIds=True)

    # Tidy up the intermediate file
    try:
        pre_stripped.unlink()
    except FileNotFoundError:
        pass
    return out_path


# ──────────────────────────────────────────────────────────────────────
# Mutation verification — guard against silently-wrong precaches.
# ──────────────────────────────────────────────────────────────────────

# Map 3-letter ↔ 1-letter for verification messages.
_AA3_TO_1 = {
    "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C",
    "GLN": "Q", "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I",
    "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P",
    "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V",
}


def chain_residue_map(pdb_path: Path | str, chain: str) -> dict[int, str]:
    """Parse a PDB file and return {residue_number: 3-letter-aa} for one chain.

    Reads ATOM records only (HETATM is skipped — we don't want bound ligands or
    waters showing up as "residues" in the chain). Multiple ATOM lines for the
    same residue (e.g. each backbone atom) all carry the same residue number,
    so the dict is keyed by resnum and we keep the first 3-letter name we see.

    This is a *fast* operation (one pass over a file usually <1 MB), so it's
    cheap enough to run synchronously inside POST /jobs as a pre-flight check
    before kicking off the 30-second FoldX build.

    Args:
        pdb_path: Path to a raw RCSB PDB or a cleaned/chain-filtered one.
        chain: Single-letter chain ID (case-sensitive — must match the PDB).

    Returns:
        Dict mapping residue number → 3-letter amino-acid code, e.g.
        {1058: "MET", 1059: "ASP", ...}. Empty when the chain has no ATOM
        records (chain doesn't exist OR wasn't modeled).
    """
    p = Path(pdb_path)
    residues: dict[int, str] = {}
    if not p.exists():
        return residues
    try:
        with p.open() as fh:
            for line in fh:
                if not line.startswith("ATOM"):
                    continue
                if len(line) < 27:
                    continue
                if line[21] != chain:
                    continue
                aa = line[17:20].strip()
                try:
                    rn = int(line[22:26].strip())
                except ValueError:
                    continue
                # First write wins — keeps it deterministic for residues with
                # alt-locs or duplicated rows.
                residues.setdefault(rn, aa)
    except OSError:
        pass
    return residues


def validate_mutations(
    pdb_path: Path | str,
    chain: str,
    pdb_id: str,
    mutations: list[str],
) -> list[dict]:
    """Pre-flight check: every requested mutation has a residue we can build at.

    For each mutation code (e.g. "Y1230H" or "T790M+C797S"), confirms two
    things in the structure:

      1. The numbered residue actually exists in the chain. Crystal structures
         routinely omit flexible loops / disordered tails, so a residue that
         exists in the protein sequence may not exist in the PDB file.
      2. The wildtype letter the user typed matches the residue actually at
         that position. Some PDBs use construct numbering or shifted ranges,
         which makes "Y1230H" silently apply to the wrong residue if not
         caught.

    Returns a list of issue dicts — empty list means every mutation is buildable.
    Each issue is JSON-serializable so it can ride on a 422 response body and
    drive a structured UI panel on the frontend.

    Issue shape:
        {
            "mutation": "Y1230H",        # original code as the user typed it
            "code": "residue_not_resolved" | "wildtype_mismatch"
                    | "unparseable" | "chain_empty",
            "pdb_id": "2WGJ",
            "chain": "A",
            "residue": 1230,             # int, when a residue number was parsed
            "expected_wt": "Y",          # one-letter, on wildtype_mismatch
            "actual_wt": "H",            # one-letter, on wildtype_mismatch
            "chain_range": [1058, 1247], # min/max resnum present, when known
            "message": "human-readable explanation"
        }
    """
    issues: list[dict] = []

    residues = chain_residue_map(pdb_path, chain)
    chain_range: list[int] | None = (
        [min(residues), max(residues)] if residues else None
    )

    if not residues:
        # Chain genuinely has no ATOM records in this PDB. Could be a typo
        # (chain B vs A) or a chain that's modeled but only as HETATM (rare).
        # All requested mutations fail for the same reason.
        for mut in mutations:
            issues.append({
                "mutation": mut,
                "code": "chain_empty",
                "pdb_id": pdb_id,
                "chain": chain,
                "residue": None,
                "chain_range": None,
                "message": (
                    f"Chain {chain} has no protein atoms in {pdb_id}. "
                    f"Check the chain ID, or pick a different structure."
                ),
            })
        return issues

    for mut_code in mutations:
        # Multi-residue codes like "T790M+C797S" must each individually validate.
        parts = [c.strip().upper() for c in mut_code.split("+") if c.strip()]
        for code in parts:
            if len(code) < 3 or not code[1:-1].isdigit():
                issues.append({
                    "mutation": mut_code,
                    "code": "unparseable",
                    "pdb_id": pdb_id,
                    "chain": chain,
                    "residue": None,
                    "chain_range": chain_range,
                    "message": f"Couldn't parse mutation code {code!r}.",
                })
                continue
            wt_one = code[0]
            try:
                resnum = int(code[1:-1])
            except ValueError:
                issues.append({
                    "mutation": mut_code,
                    "code": "unparseable",
                    "pdb_id": pdb_id,
                    "chain": chain,
                    "residue": None,
                    "chain_range": chain_range,
                    "message": f"Bad residue number in {code!r}.",
                })
                continue

            if resnum not in residues:
                # Residue isn't modeled. This is the common case — flexible
                # loops, terminal tails, etc. Surface the chain's actual range
                # so the UI can suggest a better-coverage structure.
                issues.append({
                    "mutation": mut_code,
                    "code": "residue_not_resolved",
                    "pdb_id": pdb_id,
                    "chain": chain,
                    "residue": resnum,
                    "chain_range": chain_range,
                    "message": (
                        f"Residue {resnum} is not modeled in {pdb_id} "
                        f"chain {chain} (resolved range: "
                        f"{chain_range[0]}–{chain_range[1]}). "
                        f"Disordered loops and termini are commonly "
                        f"missing from crystal structures."
                    ),
                })
                continue

            actual_three = residues[resnum]
            actual_one = _AA3_TO_1.get(actual_three, "?")
            if actual_one != wt_one:
                # Wildtype letter mismatch — usually means the PDB uses
                # construct numbering or the user typed a code from a
                # different isoform.
                issues.append({
                    "mutation": mut_code,
                    "code": "wildtype_mismatch",
                    "pdb_id": pdb_id,
                    "chain": chain,
                    "residue": resnum,
                    "expected_wt": wt_one,
                    "actual_wt": actual_one,
                    "chain_range": chain_range,
                    "message": (
                        f"Residue {chain}{resnum} in {pdb_id} is "
                        f"{actual_three} ({actual_one}), not {wt_one} "
                        f"as your code {code} expects. The structure may "
                        f"use different numbering than UniProt."
                    ),
                })
                continue
    return issues


def verify_mutation_applied(
    receptor_pdbqt: Path | str,
    chain: str,
    mutation_code: str,
) -> tuple[bool, str]:
    """Confirm a mutant receptor file actually contains the requested mutation.

    Reads the PDBQT/PDB and looks for a residue at (chain, resnum) whose
    3-letter name matches the *new* amino acid. Returns (True, "ok") on
    success, or (False, reason) with a human-readable diagnosis.

    For combo mutations like "T790M+C797S", every individual substitution
    must be present.

    Why this exists: PDBFixer historically renumbered residues, causing FoldX
    to mutate the wrong atom and produce mutant receptors that look correct
    but are biophysically WT. This function catches that class of bug at the
    last possible moment — right before the file is sent to Vina — so the
    failing cell shows an honest error instead of a fake-equal score.
    """
    receptor = Path(receptor_pdbqt)
    if not receptor.exists():
        return False, f"receptor file missing: {receptor.name}"

    # Build set of (chain, resnum, 3-letter-aa) tuples actually in the file.
    residues: set[tuple[str, int, str]] = set()
    chain_max: dict[str, int] = {}
    try:
        with receptor.open() as fh:
            for line in fh:
                if not (line.startswith("ATOM") or line.startswith("HETATM")):
                    continue
                if len(line) < 27:
                    continue
                ch = line[21]
                aa = line[17:20].strip()
                try:
                    rn = int(line[22:26].strip())
                except ValueError:
                    continue
                residues.add((ch, rn, aa))
                if rn > chain_max.get(ch, -1):
                    chain_max[ch] = rn
    except OSError as e:
        return False, f"could not read receptor: {e}"

    # Parse "T790M" or "T790M+C797S" into [(orig, resnum, new), ...]
    individual = [c.strip().upper() for c in mutation_code.split("+") if c.strip()]
    for code in individual:
        if len(code) < 3 or not code[1:-1].isdigit():
            return False, f"unparseable mutation code: {code!r}"
        new_one = code[-1]
        try:
            resnum = int(code[1:-1])
        except ValueError:
            return False, f"bad residue number in {code!r}"

        # Find what's actually at (chain, resnum)
        present = [aa for (ch, rn, aa) in residues if ch == chain and rn == resnum]
        if not present:
            max_in_chain = chain_max.get(chain, -1)
            return False, (
                f"residue {chain}{resnum} (from {code}) not found in receptor "
                f"(chain {chain} max residue: {max_in_chain}). "
                "PDB likely uses different numbering, OR the prep pipeline "
                "renumbered residues — check fix_pdb."
            )
        # The new amino acid should match the one specified
        actual_one = _AA3_TO_1.get(present[0], "?")
        if actual_one != new_one:
            return False, (
                f"residue {chain}{resnum} is {present[0]} ({actual_one}) — "
                f"expected {new_one} (from {code}). FoldX mutation didn't apply correctly."
            )
    return True, "ok"


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
            elif rec == "TER":
                # TER lines also have a chain ID at column 22 — must filter
                # the same way as ATOM, otherwise PDBFixer sees TER records
                # for chains we deleted and emits malformed coordinates
                # while trying to "complete" the missing chain. This caused
                # the 2HYY ValueError ("could not convert string to float").
                if chain and len(line) > 21 and line[21] != chain:
                    continue
                fout.write(line)
            elif rec == "SEQRES":
                # SEQRES has chain ID at column 12 (1-indexed) — filter so
                # PDBFixer doesn't believe other chains exist.
                if chain and len(line) > 11 and line[11] != chain:
                    continue
                fout.write(line)
            elif rec in {"END", "HEADER", "TITLE", "CRYST1", "REMARK"}:
                fout.write(line)
    log.info("Cleaned %s → %s (%d ATOM lines, dropped %d HETATM)", pdb_path.name, out_path.name, kept, skipped_het)
    if kept == 0:
        raise PrepError(f"No ATOM lines kept after cleaning {pdb_path}")
    return out_path


def prepare_receptor(pdb_path: Path | str, out_pdbqt: Path | str, *, chain: str | None = None) -> Path:
    """Convert a cleaned PDB to a receptor PDBQT via Open Babel.

    Caller's contract: pdb_path is ALREADY cleaned (HETATMs stripped, single
    chain, no nonstandard residues). Both common callers (runner.py and
    mutate.py) pass output of fix_pdb directly. Calling fix_pdb a second
    time here was a bug — it would (a) re-strip non-A chains using a chain
    ID that PDBFixer may have rewritten ("No ATOM lines kept" for IDH1)
    and (b) try to re-parse PDBFixer's output which sometimes has empty
    coordinate fields when an atom couldn't be placed (4WO5 ValueError).

    Now we just hand the file straight to obabel which is robust on
    real-world PDBs.
    """
    pdb_path = Path(pdb_path)
    out_pdbqt = Path(out_pdbqt)
    if not pdb_path.exists():
        raise PrepError(f"Receptor PDB not found: {pdb_path}")
    if not shutil.which("obabel"):
        raise PrepError("obabel not on PATH. Install Open Babel: brew install open-babel")

    cmd = ["obabel", str(pdb_path), "-O", str(out_pdbqt), "-xr", "-p", "7.4"]
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
    #
    # --rigid_macrocycles: by default Meeko detects spanning macrocycles
    # (e.g. Lorlatinib's lactam path through the fused aromatic ring) and
    # "opens" them with dummy glue atoms typed `G` / `CG0` so the macrocycle
    # gets pseudo-flexible torsions. AutoDock Vina (and QuickVina2-GPU,
    # which our Pod runs) DO NOT recognize the `G` atom type — the engine
    # silently rejects the ligand and returns no pose. This was making
    # every Lorlatinib docking fail across all variants with the cryptic
    # "batch err: no pose written" message. Forcing macrocycles to stay
    # rigid sacrifices a small amount of conformational sampling but lets
    # Vina actually dock the compound. Non-macrocyclic compounds are
    # unaffected (the flag only applies when a spanning macrocycle is
    # detected).
    cmd = ["mk_prepare_ligand.py", "--rigid_macrocycles",
           "-i", str(sdf_path), "-o", str(out_pdbqt)]
    log.info("Preparing ligand: %s → %s", smiles[:60], out_pdbqt.name)
    res = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if res.returncode != 0:
        raise PrepError(f"Ligand prep failed for {smiles!r}: {res.stderr.strip() or res.stdout.strip()}")

    if not out_pdbqt.exists() or out_pdbqt.stat().st_size == 0:
        raise PrepError(f"Ligand prep wrote no file: {out_pdbqt}")
    return out_pdbqt
