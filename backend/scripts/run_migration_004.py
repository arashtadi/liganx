"""One-shot runner for migration 004 (add job.stage column).

Idempotent — safe to run multiple times. Adds the stage column if it
doesn't already exist, prints the column metadata afterwards so the
operator can confirm.

Usage on Fly.io after deploy:
    flyctl ssh console -a liganx-api -C "python3 /app/scripts/run_migration_004.py"
"""

import os
import sqlalchemy

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise SystemExit("DATABASE_URL not set in environment")

engine = sqlalchemy.create_engine(DATABASE_URL)
with engine.connect() as conn:
    conn.execute(sqlalchemy.text(
        "ALTER TABLE public.job ADD COLUMN IF NOT EXISTS stage TEXT NULL"
    ))
    conn.commit()
    rows = list(conn.execute(sqlalchemy.text(
        "SELECT column_name, data_type, is_nullable "
        "FROM information_schema.columns "
        "WHERE table_name='job' AND column_name='stage'"
    )))
    print("stage column:", rows)
    print("OK")
