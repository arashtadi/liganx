"""End-to-end smoke test for the pod's /relax_ensemble endpoint.

Run ON THE POD (it POSTs to localhost:7860, which is only reachable
in-pod — the RunPod proxy doesn't expose 7860 externally):

    cd /workspace && python3 smoke_relax_ensemble.py

It POSTs a real cleaned KRas receptor (test_receptor_kras.pdb, expected
next to this script) to /relax_ensemble with a short MD, then checks the
response is well-formed: a conformer ensemble where element 0 is the
un-relaxed input and the relaxed snapshots have the fold pinned
(small Cα-RMSD) but pocket side chains moved (all-atom RMSD > Cα-RMSD).

Exit code 0 on PASS, 1 on FAIL — so it can gate a deploy.
"""

from __future__ import annotations

import json
import math
import sys
import time
import urllib.request
from pathlib import Path

ENDPOINT = "http://localhost:7860/relax_ensemble"
# KRas 4OBE GDP-pocket centre (Å) — matches the test receptor fixture.
BOX_CENTER = [-7.7, -11.7, 27.8]


def _read_coords(pdb_text: str, ca_only: bool) -> dict:
    """(chain, resSeq, atomName) -> (x, y, z) from ATOM lines."""
    out = {}
    for line in pdb_text.splitlines():
        if not line.startswith("ATOM"):
            continue
        name = line[12:16].strip()
        if ca_only and name != "CA":
            continue
        out[(line[21], line[22:26].strip(), name)] = (
            float(line[30:38]), float(line[38:46]), float(line[46:54]),
        )
    return out


def _rmsd(a_text: str, b_text: str, ca_only: bool):
    a, b = _read_coords(a_text, ca_only), _read_coords(b_text, ca_only)
    shared = a.keys() & b.keys()
    if len(shared) < 3:
        return None
    sq = sum(
        (a[k][0] - b[k][0]) ** 2 + (a[k][1] - b[k][1]) ** 2 + (a[k][2] - b[k][2]) ** 2
        for k in shared
    )
    return math.sqrt(sq / len(shared))


def main() -> int:
    receptor_path = Path(__file__).with_name("test_receptor_kras.pdb")
    if not receptor_path.exists():
        print(f"FAIL: test receptor not found at {receptor_path}")
        return 1
    receptor_pdb = receptor_path.read_text()
    n_input_atoms = sum(1 for ln in receptor_pdb.splitlines() if ln.startswith("ATOM"))
    print(f"test receptor: {receptor_path.name}, {n_input_atoms} ATOM lines")

    body = json.dumps({
        "receptor_pdb": receptor_pdb,
        "box_center": BOX_CENTER,
        "n_relaxed": 2,
        "md_ps": 8.0,       # short — this is a smoke test, not production length
        "equil_ps": 0.0,
        "pocket_radius": 12.0,
    }).encode()
    req = urllib.request.Request(
        ENDPOINT, data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    print(f"POST {ENDPOINT} (n_relaxed=2, md_ps=8) ...")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            resp = json.loads(r.read().decode())
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: request errored: {type(e).__name__}: {e}")
        return 1
    dt = time.time() - t0
    print(f"response in {dt:.1f}s")

    ok = True

    def check(label: str, cond: bool, detail: str = ""):
        nonlocal ok
        ok &= cond
        print(f"  {'PASS' if cond else 'FAIL'}  {label}{(' — ' + detail) if detail else ''}")

    check("response ok flag", resp.get("ok") is True, f"ok={resp.get('ok')} error={resp.get('error')}")
    confs = resp.get("conformers") or []
    check("conformer count == 3 (1 input + 2 relaxed)", len(confs) == 3, f"got {len(confs)}")
    if len(confs) < 3:
        print("RESULT: FAIL")
        return 1

    inp = confs[0]
    check("conf[0] is the un-relaxed input", inp.strip() == receptor_pdb.strip())
    for i, c in enumerate(confs[1:], 1):
        n_atoms = sum(1 for ln in c.splitlines() if ln.startswith("ATOM"))
        ca = _rmsd(inp, c, ca_only=True)
        aa = _rmsd(inp, c, ca_only=False)
        good = (
            n_atoms > 100
            and ca is not None and aa is not None
            and ca < 1.0           # backbone restrained → fold stays pinned
            and aa > ca            # pocket side chains moved more than backbone
        )
        check(
            f"relaxed conf[{i}]: fold pinned + pocket relaxed",
            good,
            f"{n_atoms} atoms, CA-RMSD={ca:.3f}A allatom-RMSD={aa:.3f}A" if ca and aa else "RMSD failed",
        )
    d = _rmsd(confs[1], confs[2], ca_only=False)
    check("relaxed conformers distinct from each other", bool(d and d > 0.02),
          f"conf1-conf2 RMSD={d:.3f}A" if d else "RMSD failed")

    print("RESULT:", "PASS — /relax_ensemble works end-to-end on the pod GPU" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
