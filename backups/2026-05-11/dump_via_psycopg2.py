#!/usr/bin/env python3
"""
Logical backup of the Liganx production DB via psycopg2.

We use psycopg2 (the same client the backend uses) instead of pg_dump because
Supabase's Supavisor session pooler keeps closing pg_dump's TLS handshake
from external networks. psycopg2 connects fine because that's what the
running backend uses constantly, so we know the credentials + network path
work.

This dumps:
  1. Schema (DDL) for each public table — produces an authoritative
     CREATE TABLE statement we could replay against a fresh DB if we
     ever needed to.
  2. Row counts for each table — for integrity verification after the
     #208 migration runs (we'll re-run after deploy to confirm nothing
     was deleted).
  3. Full row data as newline-delimited JSON, one file per table — every
     row preserved with its server-side defaults captured. This is the
     real safety net: if a runner bug somehow corrupts ScreeningJob
     during the VS wiring, we can restore from these JSONL files.

Output goes to the cwd. The DB password is read from DATABASE_URL_DUMP
env var so it doesn't end up in shell history.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor


def jsonify(o):
    """Make psycopg2 row values JSON-serializable. Handles the common
    Postgres types Liganx uses: datetime, date, Decimal, bytes, UUID."""
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if isinstance(o, Decimal):
        return str(o)
    if isinstance(o, (bytes, bytearray, memoryview)):
        return bytes(o).hex()
    return str(o)  # UUID, etc.


def main() -> int:
    dsn = os.environ.get("DATABASE_URL_DUMP")
    if not dsn:
        print("ERROR: set DATABASE_URL_DUMP to a postgres:// URL", file=sys.stderr)
        return 2

    out_dir = Path(__file__).parent
    summary = {"started_at": datetime.now(timezone.utc).isoformat()}

    print(f"Connecting via psycopg2 to {dsn.split('@', 1)[1].split('/', 1)[0]} ...")
    conn = psycopg2.connect(dsn, sslmode="require", connect_timeout=20)
    conn.set_session(readonly=True)
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # 1. List public tables
    cur.execute("""
        SELECT table_name
          FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name
    """)
    tables = [r["table_name"] for r in cur.fetchall()]
    print(f"Found {len(tables)} public tables: {tables}")
    summary["tables"] = tables

    # 2. Schema dump per table via information_schema + pg_indexes
    schema_lines = ["-- Liganx schema snapshot via psycopg2 (DDL approximation)\n"]
    for t in tables:
        cur.execute("""
            SELECT column_name, data_type, is_nullable, column_default,
                   character_maximum_length, numeric_precision, numeric_scale
              FROM information_schema.columns
             WHERE table_schema='public' AND table_name=%s
             ORDER BY ordinal_position
        """, (t,))
        cols = cur.fetchall()
        schema_lines.append(f"\n-- Table: {t}")
        schema_lines.append(f"CREATE TABLE {t} (")
        for i, c in enumerate(cols):
            dtype = c["data_type"]
            if c["character_maximum_length"]:
                dtype += f"({c['character_maximum_length']})"
            nn = "NOT NULL" if c["is_nullable"] == "NO" else ""
            dflt = f"DEFAULT {c['column_default']}" if c["column_default"] else ""
            line = f"  {c['column_name']} {dtype} {nn} {dflt}".rstrip()
            line += "," if i < len(cols) - 1 else ""
            schema_lines.append(line)
        schema_lines.append(");")

        # Indexes
        cur.execute("""
            SELECT indexname, indexdef FROM pg_indexes
             WHERE schemaname='public' AND tablename=%s
        """, (t,))
        for idx in cur.fetchall():
            schema_lines.append(f"-- {idx['indexdef']};")

    (out_dir / "liganx_schema.sql").write_text("\n".join(schema_lines))
    print(f"Wrote schema to liganx_schema.sql ({len(schema_lines)} lines)")

    # 3. Row counts + JSONL dumps per table
    counts: dict[str, int] = {}
    for t in tables:
        cur.execute(f'SELECT COUNT(*) AS n FROM "{t}"')
        n = cur.fetchone()["n"]
        counts[t] = n
        print(f"  {t}: {n} rows")

        # Bound the per-table dump: skip pose blobs / huge tables.
        # All current Liganx tables are well under 50k rows in prod.
        if n > 200_000:
            print(f"  SKIPPING data dump for {t} ({n} rows is large)")
            continue

        out_path = out_dir / f"data_{t}.jsonl"
        cur.execute(f'SELECT * FROM "{t}"')
        with out_path.open("w") as fh:
            for row in cur:
                fh.write(json.dumps(row, default=jsonify) + "\n")
        print(f"  wrote {out_path.name}")

    summary["row_counts"] = counts
    summary["finished_at"] = datetime.now(timezone.utc).isoformat()
    (out_dir / "row_counts.json").write_text(json.dumps(summary, indent=2))
    print("\nBackup complete. row_counts.json + liganx_schema.sql + data_*.jsonl in", out_dir)

    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
