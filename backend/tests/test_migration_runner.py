"""Tests for the startup migration runner's SQL splitter.

`main._split_sql_statements` is the Batch-1 hardening's load-bearing
helper: it splits a migration .sql file into individual statements while
respecting `$$`-quoted PL/pgSQL bodies. The OLD splitter split naively on
every `;` — which silently shredded any function-body migration into
invalid fragments (003 / 003b have `CREATE FUNCTION ... $$ ... ; ... $$`).
A regression here would re-introduce that class of broken migration.

These are pure-function tests — no DB, no network — but the import pulls
in the full FastAPI app (same as backend/tests/test_health.py), so they
run in CI with the deps installed. The splitter logic was also verified
standalone against every backend/migrations/*.sql file during Batch 1.
"""
from pathlib import Path

import pytest

from deltadock.main import _split_sql_statements

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"


def test_empty_input():
    assert _split_sql_statements("") == []
    assert _split_sql_statements("\n\n   \n") == []


def test_strips_begin_commit_wrappers_and_comments():
    sql = """-- a leading comment
BEGIN;
ALTER TABLE job ADD COLUMN IF NOT EXISTS x INT;
-- a mid-file comment
ALTER TABLE job ADD COLUMN IF NOT EXISTS y INT;
COMMIT;
"""
    stmts = _split_sql_statements(sql)
    assert stmts == [
        "ALTER TABLE job ADD COLUMN IF NOT EXISTS x INT",
        "ALTER TABLE job ADD COLUMN IF NOT EXISTS y INT",
    ]


def test_strips_inline_comment_after_code():
    stmts = _split_sql_statements(
        "ALTER TABLE x ADD COLUMN y INT;  -- inline note\n"
        "ALTER TABLE x ADD COLUMN z INT;"
    )
    assert stmts == [
        "ALTER TABLE x ADD COLUMN y INT",
        "ALTER TABLE x ADD COLUMN z INT",
    ]


def test_dollar_quoted_function_body_is_not_shredded():
    """The critical regression guard: a `;` INSIDE a `$$ ... $$` body must
    NOT split the statement. The naive split-on-`;` splitter corrupted
    exactly this — migration 003's touch_updated_at() trigger function."""
    sql = """BEGIN;
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS t ON x;
CREATE TRIGGER t BEFORE UPDATE ON x
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
COMMIT;"""
    stmts = _split_sql_statements(sql)
    # Exactly 3 statements: the function, the DROP TRIGGER, the CREATE TRIGGER.
    assert len(stmts) == 3
    # The function body's inner `;`-terminated lines stayed inside statement 1.
    assert "RETURN NEW;" in stmts[0]
    assert "NEW.updated_at := now();" in stmts[0]
    assert stmts[1].startswith("DROP TRIGGER")
    assert stmts[2].startswith("CREATE TRIGGER")


def test_every_real_migration_file_splits_to_a_sane_count():
    """Smoke-check the splitter against every committed migration. Each
    file must produce at least one statement and none should be empty —
    a zero-statement result would mean the runner silently no-ops a
    migration the operator believes ran."""
    sql_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    assert sql_files, f"no migration files found in {MIGRATIONS_DIR}"
    for f in sql_files:
        stmts = _split_sql_statements(f.read_text())
        assert len(stmts) >= 1, f"{f.name}: splitter produced 0 statements"
        assert all(s.strip() for s in stmts), f"{f.name}: produced an empty statement"


@pytest.mark.parametrize(
    "filename,expected_min",
    [
        ("004_job_stage.sql", 1),
        ("015_job_ensemble.sql", 1),
        ("016_ensemble_access.sql", 1),
        ("011_screening_selectivity.sql", 10),  # many CREATE/ALTER statements
    ],
)
def test_wired_migrations_have_expected_statement_counts(filename, expected_min):
    """The migrations wired into _STARTUP_MIGRATIONS must parse to a
    plausible statement count — guards against a file being emptied or
    the splitter regressing on the specific files that run on every boot."""
    path = MIGRATIONS_DIR / filename
    if not path.exists():
        pytest.skip(f"{filename} not present")
    stmts = _split_sql_statements(path.read_text())
    assert len(stmts) >= expected_min
