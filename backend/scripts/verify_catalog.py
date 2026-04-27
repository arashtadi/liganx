"""Verify each Target in the catalog and auto-fill its pocket centroid.

For every target:
  - download the PDB
  - confirm each mutation's residue exists at the listed position with the
    listed wild-type amino acid
  - find a non-trivial HETATM (the co-crystal ligand) and compute its centroid
    as the suggested pocket centre

Run from the backend dir:  python scripts/verify_catalog.py
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make the catalog importable
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "pipeline"))

import urllib.request

from deltadock.catalog import CATALOG

# 3-letter ↔ 1-letter amino acid map for matching mutation codes against PDB residues
AA3 = {
    "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C",
    "GLN": "Q", "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I",
    "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P",
    "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V",
}

# Hetatms we don't care about as pocket markers
SKIP_HETS = {"HOH", "SO4", "CL", "NA", "K", "MG", "CA", "ZN", "GOL", "EDO", "PEG", "FMT", "ACT", "DMS"}


def fetch(pdb_id: str) -> str:
    cache = Path.home() / ".deltadock" / "pdb"
    cache.mkdir(parents=True, exist_ok=True)
    p = cache / f"{pdb_id.upper()}.pdb"
    if not p.exists() or p.stat().st_size == 0:
        with urllib.request.urlopen(f"https://files.rcsb.org/download/{pdb_id.upper()}.pdb", timeout=30) as r:
            p.write_bytes(r.read())
    return p.read_text()


def verify(target) -> tuple[bool, list[str]]:
    notes: list[str] = []
    try:
        pdb_text = fetch(target.pdb_id)
    except Exception as e:
        return False, [f"FETCH FAILED: {e}"]

    # Parse residues by chain
    residues_in_chain: dict[int, str] = {}
    het_atoms: dict[str, list[tuple[float, float, float]]] = {}
    for line in pdb_text.splitlines():
        if line.startswith("ATOM") and line[21] == target.chain:
            try:
                residues_in_chain[int(line[22:26].strip())] = line[17:20].strip()
            except ValueError:
                continue
        elif line.startswith("HETATM"):
            res = line[17:20].strip()
            if res in SKIP_HETS:
                continue
            try:
                xyz = (float(line[30:38]), float(line[38:46]), float(line[46:54]))
            except ValueError:
                continue
            het_atoms.setdefault(res, []).append(xyz)

    ok = True
    for m in target.mutations:
        from_aa = m.code[0].upper()
        try:
            resnum = int(m.code[1:-1])
        except ValueError:
            notes.append(f"  [BAD] mutation code {m.code} unparsable")
            ok = False
            continue
        actual = residues_in_chain.get(resnum)
        if actual is None:
            notes.append(f"  [MISS] {m.code}: residue {resnum} not in chain {target.chain}")
            ok = False
        elif AA3.get(actual) != from_aa:
            notes.append(f"  [WRONG] {m.code}: PDB has {actual}({AA3.get(actual,'?')}) at {resnum}, not {from_aa}")
            ok = False
        else:
            notes.append(f"  [OK]  {m.code} → {actual}{resnum} matches")

    # Pocket suggestion: largest non-trivial HET
    if het_atoms:
        biggest = max(het_atoms.items(), key=lambda kv: len(kv[1]))
        name, atoms = biggest
        cx = sum(a[0] for a in atoms) / len(atoms)
        cy = sum(a[1] for a in atoms) / len(atoms)
        cz = sum(a[2] for a in atoms) / len(atoms)
        notes.append(f"  pocket suggestion: ({cx:.1f}, {cy:.1f}, {cz:.1f}) from {name} ({len(atoms)} atoms)")
        # Check distance from currently configured pocket
        ccx, ccy, ccz = target.pocket.center
        dist = ((cx-ccx)**2 + (cy-ccy)**2 + (cz-ccz)**2) ** 0.5
        if dist > 5:
            notes.append(f"  [WARN] configured pocket is {dist:.1f} Å from suggested centroid — likely wrong")
    else:
        notes.append("  (no co-crystal ligand to suggest a pocket)")

    return ok, notes


def main() -> int:
    print(f"Verifying {len(CATALOG)} targets...\n")
    failed = 0
    for t in CATALOG:
        print(f"==== {t.id.upper()}  {t.name}  (PDB {t.pdb_id} chain {t.chain}) ====")
        ok, notes = verify(t)
        for n in notes:
            print(n)
        if not ok:
            failed += 1
        print()
    print(f"\nDone. {len(CATALOG) - failed} ok, {failed} failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
