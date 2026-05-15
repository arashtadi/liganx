#!/usr/bin/env python3
"""CI gate: backend migration wiring is complete.

Stdlib-only (matches verify_catalog.py / verify_prep_symmetry.py — runs on
the bare CI interpreter, no pip install). Catches the bug class behind the
2026-05-15 production outage: a migration .sql file exists in
backend/migrations/ but is never wired into main.py's startup runner, so
its schema change never reaches the database — while the SQLModel class
that depends on the new column 500s every query against that table.

Checks
------
1. Every backend/migrations/NNN_*.sql file is either:
     (a) wired into main.py (its filename appears in the source — in
         practice, in the _STARTUP_MIGRATIONS list), OR
     (b) on the frozen HISTORICAL_ALLOWLIST — migrations 001-010, which
         predate the startup runner and were hand-applied to production
         (001 has a destructive TRUNCATE and must never be re-run).
2. Every .sql filename referenced in main.py points to a real file in
   backend/migrations/ (no dangling wiring).

The definitive column-level check — every SQLModel column actually exists
in the live database — runs at boot in main._verify_schema_matches_models,
which fails the deploy on any drift. This script is the fast, no-DB,
PR-time gate that catches the common mistake (added a migration file,
forgot to wire it) before it can ever reach a deploy.

Exit codes: 0 = ok, 1 = wiring drift detected, 2 = script/setup error.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO_ROOT / "backend" / "migrations"
MAIN_PY = REPO_ROOT / "backend" / "src" / "deltadock" / "main.py"

# Migrations 001-010 predate the startup-migration runner and were
# hand-applied to production. They are intentionally NOT wired: 001 has a
# destructive TRUNCATE, and several use non-idempotent DDL that would fail
# or do damage if re-run on every boot. Their columns are covered at
# runtime by main._verify_schema_matches_models() against the live DB.
#
# This list is FROZEN. A brand-new migration (011+) must be WIRED, not
# added here — that is the entire point of this gate.
HISTORICAL_ALLOWLIST = {
    "001_user_auth.sql",
    "002_engine_column.sql",
    "003_user_profile.sql",
    "003b_fix_trigger.sql",
    "005_user_compound.sql",
    "006_user_compound_tags.sql",
    "007_user_job_quota.sql",
    "008_role_other.sql",
    "009_ai_history.sql",
    "010_optimize_attempt.sql",
}

_SQL_NAME_RE = re.compile(r"['\"]([0-9A-Za-z_]+\.sql)['\"]")


def main() -> int:
    if not MIGRATIONS_DIR.is_dir():
        print(f"ERROR: migrations dir not found: {MIGRATIONS_DIR}", file=sys.stderr)
        return 2
    if not MAIN_PY.is_file():
        print(f"ERROR: main.py not found: {MAIN_PY}", file=sys.stderr)
        return 2

    migration_files = sorted(p.name for p in MIGRATIONS_DIR.glob("*.sql"))
    if not migration_files:
        print(f"ERROR: no .sql files in {MIGRATIONS_DIR}", file=sys.stderr)
        return 2

    main_src = MAIN_PY.read_text()
    # Every .sql filename mentioned as a string literal in main.py. In
    # practice these come from the _STARTUP_MIGRATIONS list; matching any
    # string literal keeps the check robust to that list being renamed.
    wired = set(_SQL_NAME_RE.findall(main_src))

    errors: list[str] = []

    # Check 1: every migration file is wired or allowlisted.
    for fname in migration_files:
        if fname in wired or fname in HISTORICAL_ALLOWLIST:
            continue
        errors.append(
            f"  - {fname}: NOT wired into main.py and NOT on the historical "
            f"allowlist. Add it to main._STARTUP_MIGRATIONS (it must be "
            f"idempotent), or — only if it was hand-applied before the "
            f"startup runner existed — to HISTORICAL_ALLOWLIST in this script."
        )

    # Check 2: every .sql name referenced in main.py actually exists.
    existing = set(migration_files)
    for fname in sorted(wired):
        if fname not in existing:
            errors.append(
                f"  - {fname}: referenced in main.py but no such file in "
                f"backend/migrations/. Dangling migration wiring."
            )

    wired_real = sorted(f for f in wired if f in existing)
    allowlisted = sorted(f for f in migration_files if f in HISTORICAL_ALLOWLIST)
    print(f"Migration files found:      {len(migration_files)}")
    print(f"Wired into startup runner:  {len(wired_real)} -> {wired_real}")
    print(f"Historical (not wired):     {len(allowlisted)} -> {allowlisted}")

    if errors:
        print()
        print("SCHEMA-MIGRATION WIRING DRIFT:", file=sys.stderr)
        for e in errors:
            print(e, file=sys.stderr)
        print(
            "\nThis is the 2026-05-15 outage class. A migration that isn't "
            "wired never runs; a SQLModel column that depends on it 500s "
            "every query. Fix the wiring above.",
            file=sys.stderr,
        )
        return 1

    print("\nOK — every migration is wired or explicitly historical.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
