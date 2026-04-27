"""Probe a list of candidate PDB IDs to see which ones are usable for our catalog.

For each candidate, fetches the PDB and prints:
  - what residues are present at the positions of clinical mutations
  - which non-trivial HETATM ligands exist (and their centroids)

Use the output to decide which PDB to enshrine in the catalog and what pocket
box to set.
"""
from __future__ import annotations

import urllib.request
from pathlib import Path

CACHE = Path.home() / ".deltadock" / "pdb"
CACHE.mkdir(parents=True, exist_ok=True)

SKIP_HETS = {"HOH", "SO4", "CL", "NA", "K", "MG", "CA", "ZN", "GOL", "EDO", "PEG",
             "FMT", "ACT", "DMS", "BME", "NAG", "MAN"}

CANDIDATES = [
    # (target_id, pdb, chain, [residues to inspect])
    ("kras",   "4OBE", "A", [12, 13, 61]),
    ("braf",   "4WO5", "A", [600, 597]),
    ("braf",   "3OG7", "A", [600, 597]),
    ("idh1",   "1T0L", "A", [132]),
    ("her2",   "3PP0", "A", [310, 755, 769, 776, 777]),
    ("alk",    "2XP2", "A", [1196, 1202, 1174]),
    ("ros1",   "3ZBF", "A", [2032, 1983]),
    ("met",    "2WGJ", "A", [1228, 1163]),
    ("flt3",   "4XUF", "A", [691, 835, 842]),
    ("jak2",   "3UGC", "A", [617]),
    ("btk",    "5P9J", "A", [481]),
    ("pi3ka",  "4JPS", "A", [1047, 542, 545]),
    ("mtor",   "4JT5", "A", [2549]),
    ("cdk4",   "2W96", "A", []),
    ("cdk6",   "1XO2", "A", []),
    ("kit",    "1T46", "A", [670, 816]),
]


def fetch(pdb_id: str) -> str:
    p = CACHE / f"{pdb_id.upper()}.pdb"
    if not p.exists():
        try:
            with urllib.request.urlopen(f"https://files.rcsb.org/download/{pdb_id}.pdb", timeout=30) as r:
                p.write_bytes(r.read())
        except Exception as e:
            return f"ERR {e}"
    return p.read_text()


for tid, pdb, chain, residues in CANDIDATES:
    print(f"\n=== {tid} : {pdb} chain {chain} ===")
    txt = fetch(pdb)
    if txt.startswith("ERR"):
        print("  could not fetch:", txt)
        continue

    res_at: dict[int, str] = {}
    chain_residues_present = False
    het_atoms: dict[str, list] = {}
    for line in txt.splitlines():
        if line.startswith("ATOM") and len(line) >= 22 and line[21] == chain:
            chain_residues_present = True
            try:
                rn = int(line[22:26].strip())
            except ValueError:
                continue
            res_at[rn] = line[17:20].strip()
        elif line.startswith("HETATM"):
            r = line[17:20].strip()
            if r in SKIP_HETS:
                continue
            try:
                het_atoms.setdefault(r, []).append(
                    (float(line[30:38]), float(line[38:46]), float(line[46:54]))
                )
            except ValueError:
                continue

    if not chain_residues_present:
        print(f"  chain {chain} not in this PDB")
        continue

    for rn in residues:
        print(f"  residue {rn}: {res_at.get(rn, 'missing')}")

    if het_atoms:
        for name, atoms in sorted(het_atoms.items(), key=lambda kv: -len(kv[1]))[:3]:
            cx = sum(a[0] for a in atoms) / len(atoms)
            cy = sum(a[1] for a in atoms) / len(atoms)
            cz = sum(a[2] for a in atoms) / len(atoms)
            print(f"  HET {name}: {len(atoms)} atoms, centroid ({cx:.1f}, {cy:.1f}, {cz:.1f})")
    else:
        print("  no co-crystal ligand")
