"""Quick sanity check for a library JSON file.

Verifies every SMILES parses with RDKit and reports MW + canonical form.
Usage:
    python backend/scripts/validate_library.py backend/data/libraries/<file>.json
"""
import json
import sys
from pathlib import Path

from rdkit import Chem
from rdkit import RDLogger
from rdkit.Chem import Descriptors

RDLogger.DisableLog("rdApp.warning")
RDLogger.DisableLog("rdApp.error")


def main(path: str) -> int:
    data = json.loads(Path(path).read_text())
    print(f'Library: {data["name"]} ({len(data["compounds"])} cmpds)')
    bad = []
    for c in data["compounds"]:
        m = Chem.MolFromSmiles(c["smiles"])
        if m is None:
            bad.append(c["name"])
            print(f'  FAIL: {c["name"]} -> {c["smiles"]}')
        else:
            canon = Chem.MolToSmiles(m, canonical=True)
            mw = Descriptors.MolWt(m)
            print(f'  OK:   {c["name"]:18s} MW={mw:6.1f}  canon={canon[:60]}')
    print()
    print(f"{len(bad)} failed parse" if bad else f'all {len(data["compounds"])} parsed cleanly')
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
