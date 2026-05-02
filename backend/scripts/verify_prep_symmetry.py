#!/usr/bin/env python3
"""WT/mutant prep-asymmetry CI gate.

Counter-intuitive but **correct** invariant: WT and mutant prep are
intentionally ASYMMETRIC because the two receptors start from physically
different states.

  - WT comes from a crystal structure → already in a low-energy
    conformation → minimising it just collapses the discriminating
    pocket geometry and flattens every selectivity Δ. Don't.

  - Mutant comes from PDBFixer.applyMutations() → a synthetic side-chain
    swap that places new-residue atoms at WT positions → 0.1-0.3 Å
    bond-length errors and 0.5-1.0 Å clashes → DOES need a 200-step
    amber99sb-ildn vacuum minimisation to relax. Per-target opt-out
    via Target.minimize_mutant=False (currently only BRAF — see the
    catalog.py docstring for that field).

Background: 2026-05-01 PhD audit flagged the asymmetry as a bug. We
implemented "symmetric" prep as v5-symmetric-min (commit 23fd315),
re-ran the validation suite, and watched 5/8 PASS collapse to 2/8 PASS
+ 1 FAIL. Reverted same day (commit fe4f75f). Full postmortem in
docs/v5_postmortem.md. This CI gate exists so the same well-meaning
mistake can't be reintroduced silently.

What this script asserts:

  1. runner.py's WT-prep block does NOT call minimize_pdb() / does NOT
     run any OpenMM minimisation on the WT receptor.

  2. mutate.py keeps `_minimize_with_openmm` (used internally by
     build_mutant_pdbfixer for mutants — needed, do not remove).

  3. mutate.py does NOT export a public `minimize_pdb` helper.
     Exporting it invites a future maintainer to call it on the WT
     side. If you need to expose it for some other purpose (e.g.
     custom-PDB user opt-in), update this check AND add a comment
     on the WT-prep block explaining the new semantics.

  4. Both mutant-prep call sites in runner.py pass
     `minimize=catalog_target.minimize_mutant if catalog_target else True`
     — symmetry of the GATE between the two mutant call sites
     (precache fallback + PDBFixer primary), so per-target opt-out
     applies consistently to all mutant-build paths.

Exit codes:
   0  invariant holds — WT not minimised, mutant minimised per-target
   1  invariant violated — see the FAIL message for what to fix

Run locally:
   python backend/scripts/verify_prep_symmetry.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "backend" / "src" / "deltadock" / "services" / "runner.py"
MUTATE = ROOT / "pipeline" / "deltadock_pipeline" / "mutate.py"


def _fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def _ok(msg: str) -> None:
    print(f"OK:   {msg}")


def check_minimize_with_openmm_kept() -> None:
    """The internal mutant-side minimisation helper must stay — mutants
    NEED minimisation to relieve PDBFixer's substitution clashes."""
    src = MUTATE.read_text()
    if not re.search(r"^def _minimize_with_openmm\s*\(", src, re.MULTILINE):
        _fail(
            f"`def _minimize_with_openmm(...)` missing from {MUTATE.relative_to(ROOT)}. "
            "This is the mutant-side relaxation helper; without it "
            "build_mutant_pdbfixer would write structures with V→E or G→V "
            "clashes that drift the score by ~0.5-2 kcal/mol per case."
        )
    _ok("mutate.py keeps internal `_minimize_with_openmm` (mutant relaxation)")


def check_no_public_minimize_pdb() -> None:
    """We deliberately do NOT export a public `minimize_pdb` helper. If
    a future audit re-introduces one and wires it into WT prep, the v5
    regression comes back."""
    src = MUTATE.read_text()
    if re.search(r"^def minimize_pdb\s*\(", src, re.MULTILINE):
        _fail(
            "Found `def minimize_pdb(...)` at module level in mutate.py. "
            "This was deliberately removed after the v5-symmetric-min "
            "experiment regressed validation from 5/8 PASS to 2/8 PASS. "
            "If you need to expose minimisation for a NON-WT purpose "
            "(e.g. user-uploaded custom PDB opt-in), update this check "
            "to allow it AND verify the WT-prep block in runner.py still "
            "skips it. See docs/v5_postmortem.md for the full reasoning."
        )
    _ok("mutate.py has no public `minimize_pdb` (asymmetric WT-not-minimised invariant intact)")


def check_wt_prep_does_not_minimise() -> None:
    """The WT-prep block in runner.py must call prepare_receptor on the
    cleaned_pdb directly, with no minimisation step in between."""
    src = RUNNER.read_text()
    if "from deltadock_pipeline.mutate import minimize_pdb" in src:
        _fail(
            f"{RUNNER.relative_to(ROOT)} imports `minimize_pdb`. "
            "After the v5 revert this import should be gone — the WT "
            "side intentionally does NOT minimise. If you re-added it "
            "for a different reason, update this check and explain in "
            "the runner.py PREP_VERSION comment block."
        )
    wt_section_match = re.search(
        r"# Step 2: prep WT receptor.*?_stamp\(wt_receptor\)",
        src,
        re.DOTALL,
    )
    if not wt_section_match:
        _fail(
            "Could not locate the WT-prep section in runner.py. "
            "Either the section was removed (would break docking entirely) "
            "or its leading comment was rewritten — update this regex."
        )
    wt_section = wt_section_match.group(0)
    forbidden_calls = ("minimize_pdb(", "minimize_with_openmm(", "MinimizeEnergy(")
    for forbidden in forbidden_calls:
        if forbidden in wt_section:
            _fail(
                f"WT-prep section contains `{forbidden}`. WT MUST NOT be "
                "minimised — it comes from a crystal structure that's "
                "already a low-energy minimum, and minimising it collapses "
                "the discriminating pocket geometry. The v5 experiment "
                "demonstrated this exact regression. See docs/v5_postmortem.md."
            )
    _ok("runner.py WT-prep section does not call any minimisation function")


def check_mutant_uses_minimize_mutant_flag() -> None:
    """The two mutant-prep call sites (precache fallback + PDBFixer
    primary) both pass minimize=catalog_target.minimize_mutant. Both
    sites must agree so per-target opt-out (BRAF) is consistent."""
    src = RUNNER.read_text()
    pattern = re.compile(
        r"minimize\s*=\s*catalog_target\.minimize_mutant\s+if\s+catalog_target\s+else\s+True"
    )
    matches = pattern.findall(src)
    if len(matches) < 2:
        _fail(
            f"Found {len(matches)} mutant-prep call site(s) gating on "
            "`catalog_target.minimize_mutant if catalog_target else True`; "
            "expected at least 2 (precache-fallback + PDBFixer primary). "
            "If both don't honor the same flag, BRAF's per-target opt-out "
            "won't apply consistently."
        )
    _ok(f"mutant-prep call sites ({len(matches)}) gate on `catalog_target.minimize_mutant`")


def main() -> int:
    print("Liganx WT/mutant prep-asymmetry check")
    print("=====================================")
    check_minimize_with_openmm_kept()
    check_no_public_minimize_pdb()
    check_wt_prep_does_not_minimise()
    check_mutant_uses_minimize_mutant_flag()
    print(
        "\nAll checks passed — WT skips minimisation (crystal-quality), "
        "mutant minimises per-target (relaxes PDBFixer substitution clashes)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
