"""CLI for the docking pipeline. Useful for sanity checks and pre-computing demo data.

Examples
--------

Fetch and dock gefitinib against EGFR (1M17):

    python -m deltadock_pipeline.cli dock \
        --pdb 1M17 --chain A \
        --smiles 'COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1' \
        --name Gefitinib \
        --center 22 0 53 --size 22 22 22 \
        --work ./work
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .dock import PocketBox, dock_one
from .fetch import fetch_pdb
from .prep import prepare_ligand, prepare_receptor


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="deltadock_pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)

    # fetch
    f = sub.add_parser("fetch", help="Download a PDB structure")
    f.add_argument("--pdb", required=True)
    f.add_argument("--cache", default="./.cache/pdb")

    # dock
    d = sub.add_parser("dock", help="Run a single docking job")
    d.add_argument("--pdb", required=True)
    d.add_argument("--chain", default="A")
    d.add_argument("--smiles", required=True)
    d.add_argument("--name", default="ligand")
    d.add_argument("--center", nargs=3, type=float, required=True, metavar=("X", "Y", "Z"))
    d.add_argument("--size", nargs=3, type=float, default=[22.0, 22.0, 22.0], metavar=("X", "Y", "Z"))
    d.add_argument("--work", default="./work")
    d.add_argument("--exhaustiveness", type=int, default=8)
    d.add_argument("--vina-path", default="vina")

    args = p.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    if args.cmd == "fetch":
        path = fetch_pdb(args.pdb, args.cache)
        print(path)
        return 0

    if args.cmd == "dock":
        work = Path(args.work)
        work.mkdir(parents=True, exist_ok=True)

        pdb = fetch_pdb(args.pdb, work / "pdb")
        receptor = prepare_receptor(pdb, work / f"{args.pdb}_receptor.pdbqt", chain=args.chain)
        ligand = prepare_ligand(args.smiles, work / f"{args.name}.pdbqt", name=args.name)

        box = PocketBox(*args.center, *args.size)
        result = dock_one(receptor, ligand, box, work, exhaustiveness=args.exhaustiveness, vina_path=args.vina_path)

        print(f"Best score: {result.best_score:.2f} kcal/mol")
        print(f"Pose:       {result.pose_pdbqt}")
        print(f"Log:        {result.log_path}")
        for m in result.modes:
            print(f"  mode {m.rank:2d}  {m.affinity_kcal_mol:7.2f}  rmsd_lb={m.rmsd_lb}  rmsd_ub={m.rmsd_ub}")
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
