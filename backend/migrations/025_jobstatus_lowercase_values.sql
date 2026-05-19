-- 025_jobstatus_lowercase_values.sql
--
-- (U18) Add lowercase counterparts of every jobstatus enum value so
-- SQLAlchemy can be configured to use Python enum VALUES (lowercase)
-- instead of NAMES (uppercase) when serialising Job.status.
--
-- Why: the JobStatus model declared `CANCELLED = "cancelled"` (Python
-- value lowercase). The legacy SQLAlchemy mapping uses enum NAMES
-- (uppercase), so the PG enum was created with PENDING, RUNNING,
-- COMPLETED, FAILED. Migration 024 then added 'cancelled' (lowercase)
-- because the U11 cancel handler writes that value via raw SQL. Now
-- every list_jobs() call blows up on a cancelled row with
-- `LookupError: 'cancelled' is not among the defined enum values`.
--
-- The fix is to switch SQLAlchemy to a `values_callable` mapping so
-- it reads/writes the lowercase values. That requires every existing
-- enum member to also have a lowercase variant in PG. This migration
-- adds them. The data migration to UPDATE existing rows runs in 026 —
-- PG won't let us use a newly-added enum value within the same
-- transaction it was added, so we split the work across two files.
--
-- IDEMPOTENT: every ADD VALUE has IF NOT EXISTS, safe to re-run.
-- WHAT THIS DOES NOT DO: no row changes, no model changes. The
-- column still works with the old uppercase values; we're just
-- adding more accepted values.

ALTER TYPE jobstatus ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE jobstatus ADD VALUE IF NOT EXISTS 'running';
ALTER TYPE jobstatus ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE jobstatus ADD VALUE IF NOT EXISTS 'failed';
-- 'cancelled' was already added by migration 024 — kept here for
-- discoverability but the IF NOT EXISTS makes it a no-op.
ALTER TYPE jobstatus ADD VALUE IF NOT EXISTS 'cancelled';
