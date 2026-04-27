"""FoldX BuildModel wrapper.

Generates a mutant PDB structure from a wild-type structure + a list of mutations.
Caches results because mutation building is the slowest step (~30s per mutation).

FoldX mutation syntax: <orig_aa><chain><resnum><new_aa>
e.g. T790M on chain A → "TA790M;"
"""

from __future__ import annotations

import hashlib
import logging
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)


class FoldXError(RuntimeError):
    pass


# Map 3-letter ↔ 1-letter amino acid codes — needed to convert mutation codes
# like "T790M" into FoldX's required format.
AA3 = {
    "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C",
    "GLN": "Q", "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I",
    "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P",
    "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V",
}


@dataclass
class FoldXResult:
    """Outcome of a BuildModel run."""
    mutant_pdb: Path
    wt_reference_pdb: Path        # FoldX's repaired WT, for fair score comparison
    ddg_kcal_mol: float | None    # mutant total energy − WT total energy


def _residue_at(pdb_path: Path, chain: str, resnum: int) -> str | None:
    """Return the 3-letter residue name at (chain, resnum) in a PDB file.

    Used to build the FoldX mutation string — we need to know the *current*
    residue identity to give FoldX the original amino acid.
    """
    with pdb_path.open() as f:
        for line in f:
            if not line.startswith("ATOM"):
                continue
            if line[21] != chain:
                continue
            try:
                r = int(line[22:26].strip())
            except ValueError:
                continue
            if r == resnum:
                return line[17:20].strip()
    return None


def parse_mutation(code: str) -> tuple[str, int, str]:
    """Parse a one-letter mutation code like "T790M" → ("T", 790, "M")."""
    code = code.strip().upper()
    if len(code) < 3:
        raise FoldXError(f"Mutation code too short: {code!r}")
    orig = code[0]
    new = code[-1]
    try:
        resnum = int(code[1:-1])
    except ValueError as e:
        raise FoldXError(f"Bad mutation code {code!r}: {e}") from e
    return orig, resnum, new


def build_mutant(
    pdb_path: Path | str,
    chain: str,
    mutation_code: str,
    out_dir: Path | str,
    *,
    foldx_path: str = "foldx",
    cache_dir: Path | str | None = None,
) -> FoldXResult:
    """Apply one or more point mutations to a PDB and return the mutant structure.

    Args:
        pdb_path:       cleaned PDB to mutate (HETATMs already stripped, ideally).
        chain:          which chain the residue(s) are on (e.g. "A").
        mutation_code:  single mutation like "T790M" OR "+"-joined combo like
                        "T790M+C797S" — applied to the SAME mutant model.
        out_dir:        scratch directory; FoldX writes its outputs here.
        foldx_path:     FoldX binary on PATH.
        cache_dir:      if set, results are cached keyed on (pdb hash, chain, mutation).

    Returns:
        FoldXResult with the mutant PDB, the FoldX-repaired WT reference, and ΔΔG.

    Raises:
        FoldXError if the mutation can't be applied (residue mismatch, FoldX crash, etc.)
    """
    pdb_path = Path(pdb_path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    if not pdb_path.exists():
        raise FoldXError(f"PDB not found: {pdb_path}")
    if not shutil.which(foldx_path):
        raise FoldXError(f"FoldX binary not on PATH: {foldx_path!r}")

    # Cache hit?
    if cache_dir:
        cache_dir = Path(cache_dir)
        key = _cache_key(pdb_path, chain, mutation_code)
        cache_root = cache_dir / key
        cache_mutant = cache_root / "mutant.pdb"
        cache_wt = cache_root / "wt_ref.pdb"
        cache_ddg = cache_root / "ddg.txt"
        if cache_mutant.exists() and cache_wt.exists():
            ddg = float(cache_ddg.read_text().strip()) if cache_ddg.exists() else None
            log.info("FoldX cache hit for %s %s %s", pdb_path.name, chain, mutation_code)
            return FoldXResult(mutant_pdb=cache_mutant, wt_reference_pdb=cache_wt, ddg_kcal_mol=ddg)

    # Split combo mutations like "T790M+C797S" into a list of single mutations
    individual_codes = [c.strip() for c in mutation_code.split("+") if c.strip()]
    if not individual_codes:
        raise FoldXError(f"Empty mutation code: {mutation_code!r}")

    # Verify each residue actually exists with the expected wild-type identity
    parsed: list[tuple[str, int, str]] = []
    for code in individual_codes:
        orig, resnum, new = parse_mutation(code)
        actual = _residue_at(pdb_path, chain, resnum)
        if actual is None:
            raise FoldXError(
                f"Residue {chain}{resnum} (from {code}) not found in {pdb_path.name}. "
                "The PDB likely uses different numbering — pick another reference structure."
            )
        if AA3.get(actual) != orig:
            raise FoldXError(
                f"Mutation {code} expects {orig} at {chain}{resnum}, but the structure "
                f"has {actual} ({AA3.get(actual, '?')}) there. Wrong PDB or wrong numbering."
            )
        parsed.append((orig, resnum, new))

    # FoldX wants its molecules/ folder accessible from CWD. Symlink it in.
    work = out_dir
    foldx_assets = Path.home() / ".deltadock" / "foldx" / "molecules"
    if foldx_assets.exists() and not (work / "molecules").exists():
        try:
            (work / "molecules").symlink_to(foldx_assets)
        except FileExistsError:
            pass

    # Copy PDB into the work dir so FoldX writes outputs alongside it
    work_pdb = work / pdb_path.name
    if not work_pdb.exists():
        shutil.copy(pdb_path, work_pdb)

    # FoldX combo-mutation syntax: comma-separated within a single line means
    # apply ALL substitutions to one model. Semicolon terminates the mutant.
    # e.g. "TA790M,CA797S;" → one model with both T790M AND C797S applied.
    mut_str = ",".join(f"{o}{chain}{r}{n}" for (o, r, n) in parsed) + ";"
    mut_file = work / "individual_list.txt"
    mut_file.write_text(mut_str + "\n")

    cmd = [
        foldx_path,
        "--command=BuildModel",
        f"--pdb={work_pdb.name}",
        f"--mutant-file={mut_file.name}",
        f"--output-dir={work}",
    ]
    log.info("Running FoldX: %s on %s", mut_str, work_pdb.name)
    res = subprocess.run(cmd, capture_output=True, text=True, cwd=work, check=False)

    # FoldX is finicky about output naming and frequently exits non-zero even when
    # it has successfully produced output files (it prints "Your file run OK" and
    # then "BuildModel failed" on the same run when input has multi-dot names).
    # Source of truth: did the output files actually get written?
    stem = work_pdb.stem               # e.g. "2ITY_A" from "2ITY_A.pdb"
    flat_stem = stem.split(".")[0]     # e.g. "2ITY_A" from "2ITY_A.clean" — FoldX strips later parts
    mutant_pdb, wt_pdb = _find_outputs(work, [stem, flat_stem])

    if mutant_pdb is None or wt_pdb is None:
        raise FoldXError(
            f"FoldX rc={res.returncode}; could not locate mutant/WT outputs in {work}.\n"
            f"stdout tail: {res.stdout.strip().splitlines()[-3:] if res.stdout else []}\n"
            f"stderr: {res.stderr.strip()}"
        )

    if res.returncode != 0:
        log.warning("FoldX exited rc=%d but output files are present — proceeding", res.returncode)

    # Parse ΔΔG — FoldX names the report file based on whichever stem it used.
    ddg = _parse_ddg(work / f"Dif_{stem}.fxout") or _parse_ddg(work / f"Dif_{flat_stem}.fxout")
    if ddg is not None:
        log.info("FoldX %s on %s: ΔΔG = %.2f kcal/mol", mut_str, stem, ddg)

    # Populate cache
    if cache_dir:
        cache_root.mkdir(parents=True, exist_ok=True)
        shutil.copy(mutant_pdb, cache_root / "mutant.pdb")
        shutil.copy(wt_pdb, cache_root / "wt_ref.pdb")
        if ddg is not None:
            (cache_root / "ddg.txt").write_text(f"{ddg}\n")

    return FoldXResult(
        mutant_pdb=mutant_pdb,
        wt_reference_pdb=wt_pdb,
        ddg_kcal_mol=ddg,
    )


def _find_outputs(work: Path, stems: list[str]) -> tuple[Path | None, Path | None]:
    """Locate the mutant + WT-reference PDBs FoldX wrote.

    FoldX uses different naming based on the input file stem. We try the standard
    `<stem>_1.pdb` / `WT_<stem>_1.pdb` form first, then fall back to bare
    `<stem>.pdb` / `WT_<stem>.pdb` (which FoldX uses for inputs with multiple dots).
    """
    for stem in stems:
        for mutant_name, wt_name in [
            (f"{stem}_1.pdb", f"WT_{stem}_1.pdb"),
            (f"{stem}.pdb",   f"WT_{stem}.pdb"),
        ]:
            m = work / mutant_name
            w = work / wt_name
            if m.exists() and w.exists():
                return m, w
    return None, None


def _parse_ddg(dif_file: Path) -> float | None:
    """Pull the total-energy difference from a FoldX Dif_*.fxout report."""
    if not dif_file.exists():
        return None
    try:
        lines = dif_file.read_text().splitlines()
        # Header line starts with "Pdb<TAB>total energy<TAB>..."
        # Then data lines follow. Find the first data line and pull column 1.
        for i, line in enumerate(lines):
            if line.startswith("Pdb") and "total energy" in line:
                for data in lines[i + 1:]:
                    if not data.strip() or data.startswith("Pdb"):
                        continue
                    parts = data.split("\t")
                    if len(parts) >= 2:
                        return float(parts[1])
        return None
    except Exception as e:
        log.warning("Could not parse ΔΔG from %s: %s", dif_file.name, e)
        return None


def _cache_key(pdb_path: Path, chain: str, mutation: str) -> str:
    h = hashlib.sha1()
    h.update(pdb_path.read_bytes())
    h.update(f"|{chain}|{mutation}".encode())
    return f"{pdb_path.stem}_{chain}_{mutation}_{h.hexdigest()[:10]}"
