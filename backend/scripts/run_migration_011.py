"""One-shot runner for migration 011 (screening tables + Δ-vs-WT columns).

Idempotent — safe to run multiple times. Creates screening_job +
screening_result if missing (they currently exist via SQLModel
create_all from earlier deploys, but ADD COLUMN IF NOT EXISTS doesn't
work on a table that was never created via this migration on a fresh
DB), and adds the four new #208 columns:

  - wt_score             paired WT cell's best_score, denormalized
  - delta_score          mutant_score - wt_score
  - selectivity_index    composite ranking metric
  - extra                pipe-delimited extras matching DockingResult

Usage on Fly.io after deploy:
    flyctl ssh console -a liganx-api -C "python3 /app/scripts/run_migration_011.py"
"""

from pathlib import Path

import os
import sqlalchemy

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise SystemExit("DATABASE_URL not set in environment")

sql_path = Path(__file__).resolve().parent.parent / "migrations" / "011_screening_selectivity.sql"
sql_text = sql_path.read_text()

engine = sqlalchemy.create_engine(DATABASE_URL)
with engine.connect() as conn:
    # Same strip-BEGIN/COMMIT pattern as run_migration_010 — SQLAlchemy
    # manages the outer transaction and an embedded BEGIN inside a
    # transaction is an error on Postgres.
    stripped = sql_text.replace("BEGIN;", "").replace("COMMIT;", "")
    raw = conn.connection.dbapi_connection
    cur = raw.cursor()
    cur.execute(stripped)
    cur.close()
    conn.commit()

    # Verify the four new columns landed.
    rows = list(conn.execute(sqlalchemy.text(
        "SELECT column_name, data_type, is_nullable "
        "FROM information_schema.columns "
        "WHERE table_name='screening_result' "
        "ORDER BY ordinal_position"
    )))
    print(f"screening_result has {len(rows)} columns:")
    for r in rows:
        print(f"  - {r[0]}: {r[1]} (nullable={r[2]})")

    expected = {"wt_score", "delta_score", "selectivity_index", "extra"}
    present = {r[0] for r in rows}
    missing = expected - present
    if missing:
        print(f"WARNING: expected columns missing: {missing}")
    else:
        print("All #208 columns present.")

    idx_rows = list(conn.execute(sqlalchemy.text(
        "SELECT indexname FROM pg_indexes "
        "WHERE tablename='screening_result'"
    )))
    print(f"screening_result indexes: {[r[0] for r in idx_rows]}")
    print("OK")
