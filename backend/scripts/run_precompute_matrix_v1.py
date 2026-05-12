"""Orchestrate the v1.23 P1 pre-compute matrix.

Runs `precompute_library_screening.py` 9 times — one per (target,
mutation) pair — using the curated oncology kinase inhibitor library.
Idempotent: skips any cell whose output JSON already exists, so a
crash mid-run can resume with no work lost.

Why a single-purpose driver instead of a generic loop:
  - The catalog target IDs + PDB codes + mutation codes are fixed and
    matter for the URL slugs (which become public SEO landing pages).
    Encoding them once means we don't accidentally ship a typo'd slug.
  - Wall time is hours long; the driver gives a single command + a
    clean per-cell progress log so the operator can fire and forget.
  - Each invocation creates a real Job in the user's account. The
    driver makes that traceability easier to audit later.

Usage:
    LIGANX_API_TOKEN=<token>  # MUST be from an account whose email
                              # is in RATE_LIMIT_BYPASS_EMAILS (else
                              # job quota will trip after ~10 cells).
    python backend/scripts/run_precompute_matrix_v1.py

To re-run a specific cell, delete its output JSON first:
    rm backend/data/precomputed_screenings/oncology-kinase-vs-kras-g12c.json
    python backend/scripts/run_precompute_matrix_v1.py
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import time
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("matrix")

# Paths — anchored to the script's own location so `cd` doesn't matter.
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
LIBRARY = BACKEND_DIR / "data" / "libraries" / "oncology_kinase_inhibitors_v1.json"
OUT_DIR = BACKEND_DIR / "data" / "precomputed_screenings"
PRECOMPUTE_SCRIPT = SCRIPT_DIR / "precompute_library_screening.py"

# The matrix. (target_short_id, pdb, chain, mutation_code, slug).
# Slugs are URL-safe and SEO-friendly; they appear in the public URL
# /library/precomputed/<slug>. Don't change a slug after a run lands —
# you'd orphan the cached snapshot.
MATRIX: list[tuple[str, str, str, str, str]] = [
    # KRAS — 4OBE / chain A. G12C/D are the marquee G12 alleles
    # (sotorasib/adagrasib targets); Q61H is the switch-II case
    # we expect to fail cleanly (allosteric mutation, rigid Vina
    # can't capture conformational effects — important honesty signal).
    ("kras", "4OBE", "A", "G12C", "oncology-kinase-vs-kras-g12c"),
    ("kras", "4OBE", "A", "G12D", "oncology-kinase-vs-kras-g12d"),
    ("kras", "4OBE", "A", "Q61H", "oncology-kinase-vs-kras-q61h"),

    # EGFR — 2ITY / chain A. T790M is the textbook gatekeeper
    # (osimertinib's whole story); L858R is the activating;
    # C797S is the 3rd-gen-escape.
    ("egfr", "2ITY", "A", "T790M", "oncology-kinase-vs-egfr-t790m"),
    ("egfr", "2ITY", "A", "L858R", "oncology-kinase-vs-egfr-l858r"),
    ("egfr", "2ITY", "A", "C797S", "oncology-kinase-vs-egfr-c797s"),

    # BCR-ABL — 2HYY / chain A. T315I is the canonical gatekeeper
    # (ponatinib's reason for existing); E255K and Y253H are P-loop
    # imatinib-resistance mutations.
    ("abl", "2HYY", "A", "T315I", "oncology-kinase-vs-bcr-abl-t315i"),
    ("abl", "2HYY", "A", "E255K", "oncology-kinase-vs-bcr-abl-e255k"),
    ("abl", "2HYY", "A", "Y253H", "oncology-kinase-vs-bcr-abl-y253h"),
]


def main() -> int:
    if not os.environ.get("LIGANX_API_TOKEN"):
        log.error("LIGANX_API_TOKEN env var required.")
        log.error("Set it to a Bearer token from an account in RATE_LIMIT_BYPASS_EMAILS.")
        return 2
    if not LIBRARY.exists():
        log.error("Library file missing: %s", LIBRARY)
        return 2
    if not PRECOMPUTE_SCRIPT.exists():
        log.error("Pre-compute script missing: %s", PRECOMPUTE_SCRIPT)
        return 2
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    log.info("=" * 70)
    log.info("v1.23 P1.5 — pre-compute matrix run")
    log.info("matrix size: %d cells", len(MATRIX))
    log.info("library:     %s", LIBRARY.name)
    log.info("out dir:     %s", OUT_DIR)
    log.info("=" * 70)

    overall_start = time.time()
    done: list[str] = []
    skipped: list[str] = []
    failed: list[tuple[str, str]] = []

    for i, (target, pdb, chain, mutation, slug) in enumerate(MATRIX, start=1):
        out_path = OUT_DIR / f"{slug}.json"
        prefix = f"[{i}/{len(MATRIX)}] {target} {pdb}/{chain} {mutation}"
        if out_path.exists():
            log.info("%s — already cached at %s, skipping", prefix, out_path.name)
            skipped.append(slug)
            continue

        log.info("=" * 70)
        log.info("%s — starting", prefix)
        log.info("  slug:  %s", slug)
        log.info("  out:   %s", out_path)
        cell_start = time.time()
        rc = subprocess.call(
            [
                sys.executable,
                str(PRECOMPUTE_SCRIPT),
                "--library", str(LIBRARY),
                "--pdb", pdb,
                "--chain", chain,
                "--mutation", mutation,
                "--slug", slug,
                "--out", str(OUT_DIR),
            ],
            env=os.environ.copy(),
        )
        elapsed = time.time() - cell_start
        if rc == 0:
            log.info("%s — done in %.1f min", prefix, elapsed / 60)
            done.append(slug)
        else:
            log.error("%s — FAILED (rc=%d) after %.1f min", prefix, rc, elapsed / 60)
            failed.append((slug, f"rc={rc}"))

    log.info("=" * 70)
    log.info("matrix complete. total wall: %.1f min", (time.time() - overall_start) / 60)
    log.info("  done:    %d  %s", len(done), done if done else "")
    log.info("  skipped: %d  %s", len(skipped), skipped if skipped else "(none)")
    log.info("  failed:  %d  %s", len(failed), failed if failed else "(none)")
    log.info("=" * 70)
    if failed:
        log.error("re-run this script to retry failed cells (idempotent — successes are cached)")
        return 1
    log.info(
        "next: git add backend/data/precomputed_screenings/ && "
        "git commit -m 'v1.23 P1.5 — pre-computed library screenings' && git push"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
