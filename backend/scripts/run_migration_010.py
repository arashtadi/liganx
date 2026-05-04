"""One-shot runner for migration 010 (optimize_attempt durable logging).

Idempotent — safe to run multiple times. Creates the table + indexes
if they don't already exist, prints the column metadata afterwards so
the operator can confirm.

Usage on Fly.io after deploy:
    flyctl ssh console -a liganx-api -C "python3 /app/scripts/run_migration_010.py"
"""

from pathlib import Path

import os
import sqlalchemy

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise SystemExit("DATABASE_URL not set in environment")

# Read the SQL from disk so the runner stays in sync with the
# canonical migration file. The Fly image bundles the migrations
# folder, so /app/migrations/010_optimize_attempt.sql is reachable.
sql_path = Path(__file__).resolve().parent.parent / "migrations" / "010_optimize_attempt.sql"
sql_text = sql_path.read_text()

engine = sqlalchemy.create_engine(DATABASE_URL)
with engine.connect() as conn:
    # Strip the BEGIN/COMMIT wrappers — SQLAlchemy manages the
    # transaction itself, and an embedded BEGIN inside a transaction
    # is an error on Postgres.
    stripped = sql_text.replace("BEGIN;", "").replace("COMMIT;", "")
    # exec_driver_sql lets us send the multi-statement DDL block
    # without SQLAlchemy parameter binding (which would choke on the
    # SQL comments and := operators). Each CREATE TABLE / CREATE INDEX
    # is its own statement; psycopg2's executemany-style split happens
    # inside the driver.
    raw = conn.connection.dbapi_connection
    cur = raw.cursor()
    cur.execute(stripped)
    cur.close()
    conn.commit()

    rows = list(conn.execute(sqlalchemy.text(
        "SELECT column_name, data_type, is_nullable "
        "FROM information_schema.columns "
        "WHERE table_name='optimize_attempt' "
        "ORDER BY ordinal_position"
    )))
    print(f"optimize_attempt has {len(rows)} columns:")
    for r in rows:
        print(f"  - {r[0]}: {r[1]} (nullable={r[2]})")

    idx_rows = list(conn.execute(sqlalchemy.text(
        "SELECT indexname FROM pg_indexes "
        "WHERE tablename='optimize_attempt'"
    )))
    print(f"indexes: {[r[0] for r in idx_rows]}")
    print("OK")
