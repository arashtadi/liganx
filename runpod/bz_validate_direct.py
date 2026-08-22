#!/usr/bin/env python3
"""Self-contained Boltz-2 positive-control validation — runs ON the GPU pod.

No API, no token, no app wiring: for each literature case, fetch the PDB from
RCSB, extract the chain sequence (same column logic as
pipeline/deltadock_pipeline/boltz2_seq.py, inlined to stay dependency-free),
derive a pocket constraint from the co-crystal ligand, apply the mutation,
run `boltz predict` for WT and mutant, and check the Delta direction against
the literature.

Score = affinity_pred_value = log10(IC50 uM): more-negative = stronger binder.
Delta = mutant - WT.  resistance => Delta > 0 (mutant weaker);
selectivity => Delta < 0 (mutant stronger); retained => |Delta| small.

Usage on the pod:  python3 bz_validate_direct.py
"""
import glob
import json
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

_AA = ("ALA A ARG R ASN N ASP D CYS C GLN Q GLU E GLY G HIS H ILE I LEU L "
       "LYS K MET M PHE F PRO P SER S THR T TRP W TYR Y VAL V MSE M").split()
AA3_TO_1 = {_AA[i]: _AA[i + 1] for i in range(0, len(_AA), 2)}

CACHE = "/root/boltz2_cache"
_SKIP_HET = {"HOH", "WAT", "SO4", "PO4", "GOL", "EDO", "CL", "NA", "MG", "ZN",
             "CA", "K", "ACT", "DMS", "BME", "MRD", "TRS", "IMD", "FMT", "PEG"}

# (name, pdb, chain, (wt, resnum, mut), drug SMILES, expected_direction)
CASES = [
    ("ABL T315I / Imatinib", "2HYY", "A", ("T", 315, "I"),
     "Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1", "resistance"),
    ("EGFR T790M / Gefitinib", "2ITY", "A", ("T", 790, "M"),
     "COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1", "resistance"),
    ("EGFR T790M / Osimertinib", "2ITY", "A", ("T", 790, "M"),
     "COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1", "selectivity"),
    ("BRAF V600E / Vemurafenib", "4WO5", "A", ("V", 600, "E"),
     "CCCS(=O)(=O)Nc1ccc(F)c(C(=O)c2c[nH]c3ncc(-c4ccc(Cl)cc4)cc23)c1F", "selectivity"),
    ("KIT D816V / Imatinib", "1T46", "A", ("D", 816, "V"),
     "Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1", "resistance"),
    ("BTK C481S / Ibrutinib", "5P9J", "A", ("C", 481, "S"),
     "C=CC(=O)N1CCC[C@H]1c1nc(-c2ccc(Oc3ccccc3)cc2)c2c(N)ncnc21", "resistance"),
]


def fetch_pdb(pdb):
    url = "https://files.rcsb.org/download/%s.pdb" % pdb
    return urllib.request.urlopen(url, timeout=60).read().decode().splitlines()


def extract_chain(lines, chain):
    seq, resnums, seen = [], [], set()
    for l in lines:
        if not l.startswith("ATOM") or len(l) < 54 or l[21] != chain:
            continue
        if l[12:16].strip() != "CA":
            continue
        try:
            rn = int(l[22:26])
        except ValueError:
            continue
        if rn in seen:
            continue
        seq.append(AA3_TO_1.get(l[17:20].strip().upper(), "X"))
        resnums.append(rn)
        seen.add(rn)
    return "".join(seq), {rn: i for i, rn in enumerate(resnums)}


def pocket_seq_indices(lines, chain, rmap, max_res=22):
    """Return 1-based sequence indices of residues near the co-crystal ligand.
    boltz indexes a plain-sequence protein 1..N, so pocket contacts must be
    sequence positions, not PDB resnums."""
    groups = {}
    for l in lines:
        if not l.startswith("HETATM") or len(l) < 54:
            continue
        if l[17:20].strip() in _SKIP_HET:
            continue
        key = (l[17:20], l[21], l[22:26])
        try:
            groups.setdefault(key, []).append(
                (float(l[30:38]), float(l[38:46]), float(l[46:54])))
        except ValueError:
            continue
    if not groups:
        return []
    lig = max(groups.values(), key=len)
    near = set()
    for l in lines:
        if not l.startswith("ATOM") or len(l) < 54 or l[21] != chain:
            continue
        try:
            x, y, z = float(l[30:38]), float(l[38:46]), float(l[46:54])
            rn = int(l[22:26])
        except ValueError:
            continue
        idx = rmap.get(rn)
        if idx is None:
            continue
        for lx, ly, lz in lig:
            if (x - lx) ** 2 + (y - ly) ** 2 + (z - lz) ** 2 <= 36.0:
                near.add(idx + 1)  # 1-based sequence index
                break
    return sorted(near)[:max_res]


def run_boltz(seq, smiles, chain, pocket, tag):
    d = Path(tempfile.mkdtemp(prefix="bz_%s_" % tag))
    contacts = "".join("\n          - [%s, %d]" % (chain, r) for r in pocket)
    cons = ("\nconstraints:\n  - pocket:\n      binder: L\n      contacts:%s"
            % contacts) if pocket else ""
    (d / "in.yaml").write_text(
        "sequences:\n  - protein:\n      id: %s\n      sequence: %s\n"
        "      msa: empty\n  - ligand:\n      id: L\n      smiles: '%s'\n"
        "properties:\n  - affinity:\n      binder: L%s\n"
        % (chain, seq, smiles, cons))
    t = time.time()
    p = subprocess.run(
        ["boltz", "predict", str(d / "in.yaml"), "--out_dir", str(d / "out"),
         "--cache", CACHE, "--output_format", "pdb", "--diffusion_samples", "1",
         "--override"], capture_output=True, text=True, timeout=900)
    el = time.time() - t
    if p.returncode != 0:
        return None, el, (p.stderr or p.stdout)[-400:]
    js = glob.glob(str(d / "out" / "**" / "affinity_*.json"), recursive=True)
    if not js:
        return None, el, "no affinity json produced"
    return json.load(open(js[0])).get("affinity_pred_value"), el, None


def main():
    hdr = ("%-30s %8s %8s %8s %11s %11s %6s %6s"
           % ("CASE", "WT", "MUT", "delta", "DIRECTION", "EXPECT", "OK", "t(s)"))
    print(hdr)
    print("-" * len(hdr))
    npass = ntot = 0
    for name, pdb, chain, (wt_aa, rn, new_aa), smiles, expect in CASES:
        try:
            lines = fetch_pdb(pdb)
            seq, rmap = extract_chain(lines, chain)
            idx = rmap.get(rn)
            if idx is None:
                print("%-30s  SKIP: residue %d not resolved in %s chain %s"
                      % (name, rn, pdb, chain))
                continue
            got = seq[idx]
            pocket = pocket_seq_indices(lines, chain, rmap)
            mut = list(seq)
            mut[idx] = new_aa
            wt_v, t1, e1 = run_boltz(seq, smiles, chain, pocket, "wt")
            mu_v, t2, e2 = run_boltz("".join(mut), smiles, chain, pocket, "mut")
            if wt_v is None or mu_v is None:
                print("%-30s  ERROR wt=%s mut=%s" % (name, e1, e2))
                continue
            delta = mu_v - wt_v
            direction = ("resistance" if delta > 0.15
                         else "selectivity" if delta < -0.15 else "retained")
            ok = (direction == expect
                  or (expect == "retained" and abs(delta) <= 0.30))
            npass += int(ok)
            ntot += 1
            note = "" if got == wt_aa else " (PDB has %s@%d)" % (got, rn)
            print("%-30s %8.3f %8.3f %8.3f %11s %11s %6s %6.1f%s"
                  % (name, wt_v, mu_v, delta, direction, expect,
                     "PASS" if ok else "FAIL", t1 + t2, note))
        except Exception as e:
            print("%-30s  EXCEPTION %s" % (name, e))
    print("-" * len(hdr))
    print("%d/%d correct direction  |  pocket-constrained, msa=empty, "
          "score=log10(IC50 uM) more-neg=stronger, delta=mut-wt" % (npass, ntot))


if __name__ == "__main__":
    main()
