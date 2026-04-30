"""Helpers for prepping Boltz-2 inputs from a cleaned PDB.

Boltz-2 takes a *protein sequence* (one-letter codes) plus a list of
residue indices that the ligand should bias toward — fundamentally
different inputs from Vina/GNINA, which take a PDBQT receptor and a
pocket box. The runner needs three things from the same cleaned PDB
that drives the Vina path:

  1. The WT sequence (so the matrix's WT row has something to dock).
  2. A way to derive the *mutant* sequence from a mutation code like
     "T315I" — just one character swap in the sequence string,
     handled by `apply_mutation_to_sequence`.
  3. The list of residue numbers whose CA atom lies inside the docking
     box, so Boltz-2 places the ligand in the right pocket instead of
     somewhere on the protein surface (it really will do that without
     a constraint).

Why parse the PDB by hand instead of using Biopython: the runner already
parses PDB files line-by-line elsewhere (see _residue_distance_to_pocket
in services/runner.py) and we don't want to drag in an extra import path
for one tiny job. Format guarantees from PDB v3.30:

    columns 0-6   record type ("ATOM  ", "HETATM")
    column  21    chain ID
    columns 22-26 residue sequence number (right-justified)
    columns 12-16 atom name (we want "CA")
    columns 17-20 residue name (3-letter code)
    columns 30-38 x coordinate (right-justified, 8 chars)
    columns 38-46 y
    columns 46-54 z

Edge cases we handle:
  - non-canonical residues (MSE, SEC, etc.) → 'X' so the index stays
    aligned with the residue numbering in the PDB.
  - chain mismatches → silently skipped (single-chain extraction).
  - no CA on a residue → skipped (rare; happens on incomplete loops).
  - duplicate altLoc records → first record wins (later ATOM lines for
    the same (resnum, atom_name) get ignored).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from .mutate import _AA3_TO_1, parse_mutation

log = logging.getLogger(__name__)


@dataclass
class Sequence:
    """Result of extracting a single chain's sequence from a PDB."""
    seq: str                              # one-letter codes, no gaps
    resnums: list[int]                    # PDB resnum at each seq position (parallel to `seq`)
    resnum_to_index: dict[int, int]       # PDB resnum → 0-based seq index


def extract_sequence_from_pdb(pdb_path: Path | str, chain: str) -> Sequence:
    """Pull the amino-acid sequence of a single chain from a cleaned PDB.

    Reads ATOM records (CA only) and emits one letter per residue, in
    PDB order. Returns the sequence string plus a parallel list of the
    PDB residue numbers — that's how the caller maps a mutation like
    "T315I" back to a position in the sequence string.

    Raises ValueError if the chain has no CA atoms (wrong chain ID,
    DNA-only entry, etc.) — caller is expected to surface a clean
    error to the user rather than silently sending an empty string
    to Boltz-2.
    """
    pdb_path = Path(pdb_path)
    seq_chars: list[str] = []
    resnums: list[int] = []
    seen_resnums: set[int] = set()

    with pdb_path.open() as fh:
        for line in fh:
            if not line.startswith("ATOM"):
                continue
            if len(line) < 54:  # truncated record; skip rather than crash
                continue
            if line[21] != chain:
                continue
            atom_name = line[12:16].strip()
            if atom_name != "CA":
                continue
            try:
                resnum = int(line[22:26].strip())
            except ValueError:
                continue
            if resnum in seen_resnums:
                # altLoc duplicates — first record wins.
                continue
            resname = line[17:20].strip().upper()
            one = _AA3_TO_1.get(resname, "X")
            seq_chars.append(one)
            resnums.append(resnum)
            seen_resnums.add(resnum)

    if not seq_chars:
        raise ValueError(
            f"No CA atoms found for chain {chain!r} in {pdb_path.name}. "
            f"The chain ID may be wrong, or the file may not contain "
            f"protein residues."
        )

    seq = "".join(seq_chars)
    resnum_to_index = {rn: i for i, rn in enumerate(resnums)}
    log.info(
        "Extracted %d-residue sequence from %s chain %s",
        len(seq), pdb_path.name, chain,
    )
    return Sequence(seq=seq, resnums=resnums, resnum_to_index=resnum_to_index)


def apply_mutation_to_sequence(
    sequence: Sequence,
    mutation_code: str,
) -> tuple[str, str | None]:
    """Apply a mutation like "T315I" (or combo "T790M+C797S") to the sequence.

    Returns (new_sequence, error_or_None). Error is non-None when a
    mutation references a residue not present in the chain (out of
    range, gap, etc.) — caller should write a clean failure row for
    that variant rather than silently using the WT sequence.

    Combo mutations are applied left-to-right; if any single sub fails
    the whole combo fails so we never give the user a half-mutated
    sequence with no warning.
    """
    seq_list = list(sequence.seq)
    parts = mutation_code.split("+")
    for sub in parts:
        try:
            orig, resnum, new = parse_mutation(sub)
        except Exception as e:
            return "", f"bad_mutation_code:{sub}:{e}"

        idx = sequence.resnum_to_index.get(resnum)
        if idx is None:
            return "", f"residue_{resnum}_not_in_chain"

        actual = seq_list[idx]
        if actual.upper() != orig.upper() and actual != "X":
            # The PDB has a different residue at this position than the
            # mutation code expects. Common causes: numbering offset
            # between UniProt and the deposited structure, or the user
            # typed the wrong WT letter. Boltz-2 will still happily
            # consume a "Y315I" type mutation, but we surface the
            # mismatch so the user sees it in the cell tooltip.
            return "", f"wt_mismatch_at_{resnum}:expected_{orig}_got_{actual}"

        seq_list[idx] = new

    return "".join(seq_list), None


def split_complex_pdb(
    complex_pdb: Path | str,
    out_dir: Path | str,
    *,
    ligand_chain: str = "L",
    protein_chain: str | None = None,
) -> tuple[Path, Path]:
    """Split a Boltz-2 predicted complex PDB into protein-only + ligand-only.

    ProLIF takes a protein PDB + a ligand PDB (with the ligand SMILES used
    as a bond-order template) — but Boltz-2 returns one combined PDB
    where the ligand sits as chain "L" alongside the protein. Splitting
    is straightforward: walk the lines, route each ATOM/HETATM into one
    file based on chain ID. Everything else (HEADER, REMARK, END) gets
    copied to both so 3Dmol/ProLIF parsers stay happy.

    Returns (protein_pdb_path, ligand_pdb_path).

    `protein_chain` is an optional whitelist — if None, every chain
    that ISN'T `ligand_chain` is considered protein. For Boltz-2 with
    a single protein chain "A" + ligand "L", leaving this None is fine.
    """
    complex_pdb = Path(complex_pdb)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    protein_path = out_dir / f"{complex_pdb.stem}.protein.pdb"
    ligand_path = out_dir / f"{complex_pdb.stem}.ligand.pdb"

    # We append END manually at the bottom of each file so PDB parsers
    # see a clean termination even if the source PDB had its END after
    # the last record we routed.
    with (complex_pdb.open() as fh,
          protein_path.open("w") as p_fh,
          ligand_path.open("w") as l_fh):
        for line in fh:
            if line.startswith(("ATOM", "HETATM")):
                if len(line) < 22:
                    continue
                ch = line[21]
                if ch == ligand_chain:
                    l_fh.write(line)
                elif protein_chain is None or ch == protein_chain:
                    p_fh.write(line)
            elif line.startswith(("HEADER", "TITLE", "CRYST1")):
                p_fh.write(line)
                l_fh.write(line)
            # REMARK, MODEL, TER, END, etc. are intentionally skipped to
            # keep both output files minimal — ProLIF + RDKit only need
            # the ATOM/HETATM records.
        p_fh.write("END\n")
        l_fh.write("END\n")

    return protein_path, ligand_path


def pocket_residues_within(
    pdb_path: Path | str,
    chain: str,
    centre: tuple[float, float, float],
    radius_a: float,
) -> list[int]:
    """List PDB residue numbers whose CA atom is within `radius_a` of `centre`.

    Used to build the `pocket_residues` constraint sent to Boltz-2 so
    the model places the ligand in the right pocket. Without this,
    Boltz-2 can put the ligand on the protein surface (it has no
    pocket prior beyond what's encoded in the model weights).

    Returns sorted, de-duplicated residue numbers. Empty list is fine
    — Boltz-2 falls back to its learned pocket prior in that case.
    """
    pdb_path = Path(pdb_path)
    cx, cy, cz = centre
    r2 = radius_a * radius_a
    out: list[int] = []
    seen: set[int] = set()
    with pdb_path.open() as fh:
        for line in fh:
            if not line.startswith("ATOM") or len(line) < 54:
                continue
            if line[21] != chain:
                continue
            if line[12:16].strip() != "CA":
                continue
            try:
                resnum = int(line[22:26].strip())
                x = float(line[30:38])
                y = float(line[38:46])
                z = float(line[46:54])
            except ValueError:
                continue
            d2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2
            if d2 <= r2:
                if resnum not in seen:
                    out.append(resnum)
                    seen.add(resnum)
    out.sort()
    return out
