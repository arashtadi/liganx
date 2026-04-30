#!/usr/bin/env python3
"""Catalog scientific-correctness gate.

Run on every commit that touches the catalog, the runner, or the prep
pipeline — and on every CI deploy — so a silent regression of pocket
coordinates or mutation reachability can never ship.

What it checks (per catalog target):

  1. Pocket centre sits within MAX_LIGAND_OFFSET_A of the chain-A co-crystal
     ligand centroid in the canonical PDB.

     IMPORTANT: we filter HETATMs to the catalog's stated chain BEFORE
     computing the centroid. The earlier version of this script averaged
     across all chains in the biological assembly, which on multi-protomer
     PDBs (KRAS, BRAF, IDH1, ABL, HER2, FLT3) gave a 'centroid' that was
     30–50 Å from any actual binding site and silently mis-flagged correct
     centres as 'likely wrong'. The 2026-04-30 audit traced this to the
     bug. Don't reintroduce it — always filter by chain.

     EGFR is allowed a slightly larger offset (it's intentionally shifted
     off the gefitinib-IRE centroid to capture L858R on the activation loop).

  2. Each promoted mutation:
       (a) parses cleanly (e.g. 'T790M' → from-aa T, resnum 790, to-aa M),
       (b) the residue actually exists at that position on the stated chain,
       (c) the wild-type residue identity in the PDB matches what the code
           says ('T790M' must find a THR at residue 790),
       (d) the residue's CA either sits within min(box_size)/2 of the pocket
           centre OR is on OUTSIDE_POCKET_EXEMPTIONS with a documented
           biological reason (allosteric, conformational, different domain).

     A mutation that is NOT exempt and NOT in the box is a regression: the
     runner will badge it 'outside_pocket' and the user gets no useful Δ.

Exit codes:
   0  every target passes
   1  any regression (pocket centre wrong, mutation unreachable, etc.)
   2  RCSB unreachable / catalog unparseable — transient, retry CI

Why this lives in its own script and runs on CI:

  We just spent a working day fixing a regression where 17 of 40 mutations
  had drifted outside their docking boxes after task #119's 'fix 6 wrong
  pocket coordinates' pass. The fix held only because we caught it in a
  manual audit. This script + a GitHub Actions step makes that audit
  automatic and blocking, so future edits to catalog.py either pass the
  same checks or fail the build before the deploy ever runs.
"""
from __future__ import annotations

import math
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Make the catalog importable from a fresh checkout.
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "src"))
sys.path.insert(0, str(HERE.parent.parent / "pipeline"))

from deltadock.catalog import CATALOG  # type: ignore[import-not-found]


# ─── Tolerances ────────────────────────────────────────────────────────────
# Pocket centre may drift up to MAX_LIGAND_OFFSET_A from the chain-A ligand
# centroid before we call it a regression. 5 Å allows EGFR's intentional
# 3.6 Å shift toward L858R while still catching the kinds of bugs we
# actually saw (centres pointing 10–50 Å from the real binding site).
MAX_LIGAND_OFFSET_A = 5.0


# ─── Outside-pocket exemptions ─────────────────────────────────────────────
# Mutations that are KNOWN to live outside the docking box for biological
# reasons — rigid-receptor docking against the canonical pocket cannot
# capture their Δ at any reasonable box size, so we badge them honestly
# instead of fabricating a score. Adding to this list requires a one-line
# justification: which subdomain or mechanism puts the residue out of reach.
OUTSIDE_POCKET_EXEMPTIONS: dict[tuple[str, str], str] = {
    ("kras",  "Q61H"):   "switch-II conformational mutation; allosteric, not active site",
    ("idh1",  "R132H"):  "substrate site (R132 is at the substrate cavity, not the cofactor pocket); ivosidenib mechanism is allosteric",
    ("idh1",  "R132C"):  "substrate site (same reason as R132H)",
    ("idh1",  "R132G"):  "substrate site (same reason as R132H)",
    ("alk",   "F1174L"): "activation loop, neuroblastoma-specific; gatekeeper L1196M and solvent-front G1202R both score correctly in this same PDB",
    ("pi3ka", "H1047R"): "kinase-domain activation loop, far from the ATP pocket",
    ("pi3ka", "E542K"):  "helical domain — a different subdomain entirely",
    ("pi3ka", "E545K"):  "helical domain — a different subdomain entirely",
}


# ─── Constants ─────────────────────────────────────────────────────────────
# 3-letter → 1-letter amino acid map for residue-identity checks.
AA3 = {
    "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C",
    "GLN": "Q", "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I",
    "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P",
    "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V",
}

# HETATM residue names we always ignore when picking the canonical co-crystal
# ligand. Waters, ions, and common buffer / cryoprotectant components would
# otherwise dominate the 'largest ligand' heuristic on some PDBs.
SKIP_HETS = {
    "HOH", "WAT", "DOD",
    "NA", "K", "CA", "MG", "ZN", "FE", "MN", "CU", "CL",
    "SO4", "PO4", "NO3", "ACT", "EDO", "GOL", "PEG",
    "DMS", "BME", "TRS", "IMD", "FMT", "CIT", "TLA",
    "MES", "HEPES",
}


# ─── Geometry helpers ──────────────────────────────────────────────────────
def _dist(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def _centroid(coords: list[tuple[float, float, float]]) -> tuple[float, float, float] | None:
    if not coords:
        return None
    n = float(len(coords))
    return (
        sum(c[0] for c in coords) / n,
        sum(c[1] for c in coords) / n,
        sum(c[2] for c in coords) / n,
    )


# ─── PDB fetching ──────────────────────────────────────────────────────────
def _fetch_pdb(pdb_id: str, timeout: int = 30) -> str:
    """Download the canonical .pdb file from RCSB, with a small on-disk cache
    so the script is fast in CI's loop. Cached by uppercase ID; empty/zero-
    byte files are treated as missing so a half-finished download from a
    prior run gets retried cleanly.
    """
    cache = Path.home() / ".liganx" / "verify-catalog-pdb-cache"
    cache.mkdir(parents=True, exist_ok=True)
    p = cache / f"{pdb_id.upper()}.pdb"
    if p.exists() and p.stat().st_size > 0:
        return p.read_text(errors="replace")
    url = f"https://files.rcsb.org/download/{pdb_id.upper()}.pdb"
    req = urllib.request.Request(url, headers={"User-Agent": "liganx-verify-catalog/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    p.write_bytes(body)
    return body.decode("utf-8", errors="replace")


def _parse_chain_features(
    pdb_text: str,
    chain: str,
) -> tuple[dict[str, list[tuple[float, float, float]]], dict[int, tuple[str, tuple[float, float, float]]]]:
    """Return (chain_ligand_atoms_by_resname, chain_ca_by_resnum).

    Filtering by chain is critical — for biological assemblies that have the
    ligand bound to multiple protein chains, averaging across all instances
    gives a 'centroid' that's nowhere near any actual pocket and silently
    flags correct catalog centres as wrong.
    """
    ligand_atoms: dict[str, list[tuple[float, float, float]]] = {}
    cas: dict[int, tuple[str, tuple[float, float, float]]] = {}
    for line in pdb_text.splitlines():
        if len(line) < 54:
            continue
        if line[21] != chain:
            continue
        record = line[:6].strip()
        if record == "HETATM":
            resn = line[17:20].strip()
            if resn in SKIP_HETS:
                continue
            try:
                xyz = (float(line[30:38]), float(line[38:46]), float(line[46:54]))
            except ValueError:
                continue
            ligand_atoms.setdefault(resn, []).append(xyz)
        elif record == "ATOM":
            if line[12:16].strip() != "CA":
                continue
            try:
                resnum = int(line[22:26])
                xyz = (float(line[30:38]), float(line[38:46]), float(line[46:54]))
            except ValueError:
                continue
            resn = line[17:20].strip()
            cas[resnum] = (resn, xyz)
    return ligand_atoms, cas


# ─── Per-target verification ───────────────────────────────────────────────
def _verify_target(target) -> list[str]:
    """Run all checks for one catalog entry. Returns a list of failure
    messages (one per problem). Empty list = PASS."""
    failures: list[str] = []
    pdb_id = target.pdb_id
    chain = target.chain
    centre = tuple(target.pocket.center)
    half_edge = min(target.pocket.size) / 2.0

    try:
        pdb_text = _fetch_pdb(pdb_id)
    except (urllib.error.URLError, OSError) as e:
        # Don't claim this is a regression — the network might be flaky.
        # Re-raise so the outer loop can bail with the transient code.
        raise RuntimeError(f"RCSB fetch failed for {pdb_id}: {e}") from e

    ligand_atoms, cas = _parse_chain_features(pdb_text, chain)

    # ── Check 1: pocket centre vs chain-A ligand centroid ─────────────────
    if not ligand_atoms:
        failures.append(
            f"  ✗ no co-crystal ligand on chain {chain} of {pdb_id} — cannot verify pocket centre. "
            f"Either the chain is wrong or the PDB doesn't include a bound ligand on that chain."
        )
    else:
        biggest_resn, biggest_atoms = max(ligand_atoms.items(), key=lambda kv: len(kv[1]))
        cen = _centroid(biggest_atoms)
        offset = _dist(cen, centre)  # type: ignore[arg-type]
        if offset > MAX_LIGAND_OFFSET_A:
            failures.append(
                f"  ✗ pocket centre is {offset:.1f} Å from the {biggest_resn} centroid on "
                f"{pdb_id}/{chain} (max allowed {MAX_LIGAND_OFFSET_A} Å). "
                f"Either the centre was edited away from the canonical site, or the PDB choice no longer matches the ligand the catalog assumes."
            )

    # ── Checks 2a–d: mutations parse, exist, match, and are reachable ─────
    for m in target.mutations:
        first = m.code.split("+")[0]
        # Single-residue codes like 'T790M' have a from-aa, a number, a to-aa.
        # Combo codes are handled by checking the FIRST sub-mutation here;
        # subsequent sub-mutations get checked when listed individually
        # (most catalog entries do single residues only).
        match = re.match(r"^([A-Z])(\d+)([A-Z])", first)
        if not match:
            failures.append(f"  ✗ unparseable mutation code: {m.code!r}")
            continue
        from_aa = match.group(1)
        resnum = int(match.group(2))

        info = cas.get(resnum)
        if info is None:
            failures.append(
                f"  ✗ {m.code} (res {resnum}) — no CA on chain {chain} of {pdb_id}; "
                f"either the PDB doesn't model this residue or the chain is wrong"
            )
            continue
        actual_resn, ca = info

        # Residue-identity check.
        actual_aa = AA3.get(actual_resn, "?")
        if actual_aa != from_aa:
            failures.append(
                f"  ✗ {m.code} expects WT residue '{from_aa}' at position {resnum} but "
                f"PDB {pdb_id}/{chain} has {actual_resn} ({actual_aa}). "
                f"Either the catalog uses different numbering than the PDB, or the PDB is the wrong structure."
            )
            # Don't bother checking distance for a residue we don't agree on.
            continue

        # Reachability check.
        d = _dist(ca, centre)
        key = (target.id, m.code)
        is_exempt = key in OUTSIDE_POCKET_EXEMPTIONS
        if d <= half_edge:
            if is_exempt:
                # Exempt mutation that suddenly fits — usually means somebody
                # widened the box. The exemption is now misleading: the
                # 'outside_pocket' badge will no longer fire and the doc
                # disagrees with reality. Make them tighten the docs rather
                # than silently lie about which mutations need a badge.
                failures.append(
                    f"  ✗ {m.code} is on OUTSIDE_POCKET_EXEMPTIONS but now sits {d:.1f} Å in "
                    f"(≤{half_edge:.1f} Å). Remove it from the exemption list — the badge will no longer fire."
                )
        else:
            if not is_exempt:
                failures.append(
                    f"  ✗ {m.code} sits {d:.1f} Å from pocket centre (box half-edge {half_edge:.1f} Å) "
                    f"and is NOT on the exemption list. "
                    f"Either widen the box for {target.id}, switch to a PDB whose pocket reaches "
                    f"this residue, or — if the mutation is genuinely allosteric / conformational / "
                    f"on a different domain — add it to OUTSIDE_POCKET_EXEMPTIONS in this script "
                    f"with a one-line biological reason."
                )

    return failures


def main() -> int:
    print("Verifying Liganx catalog against RCSB ground truth...")
    print(f"  Targets: {len(CATALOG)}")
    print(f"  Pocket-centre tolerance: {MAX_LIGAND_OFFSET_A} Å vs chain-A ligand centroid")
    print(f"  Outside-pocket exemptions: {len(OUTSIDE_POCKET_EXEMPTIONS)} mutations")
    print()

    n_checked = 0
    n_failed = 0
    for t in CATALOG:
        try:
            fails = _verify_target(t)
        except RuntimeError as e:
            # Network problem — bail with the transient code so CI can retry.
            print(f"TRANSIENT  {t.id:<8} ({t.pdb_id}): {e}", file=sys.stderr)
            return 2
        n_checked += 1
        if fails:
            n_failed += 1
            print(f"FAIL       {t.id:<8} ({t.pdb_id}/{t.chain})")
            for f in fails:
                print(f)
        else:
            box = int(min(t.pocket.size))
            print(
                f"OK         {t.id:<8} ({t.pdb_id}/{t.chain}, box {box}^3) — "
                f"{len(t.mutations)} mutations checked"
            )

    print()
    print("─" * 70)
    if n_failed:
        print(f"REGRESSION: {n_failed} of {n_checked} targets failed verification")
        print(
            "Fix the targets listed above before merging. If a mutation truly cannot be docked "
            "from the canonical pocket and you want to keep it in the catalog as a teaching "
            "example of the limitation, add it to OUTSIDE_POCKET_EXEMPTIONS in this script "
            "with a documented biological reason."
        )
        return 1
    print(f"PASS: {n_checked} targets verified, every promoted mutation either reachable or exempted.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
