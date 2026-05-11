-- Migration 013: make compound.job_id nullable
--
-- Why this exists: as of #207 (mini virtual screening), the Compound
-- table is shared between two callers — Job (via job_id FK) and
-- ScreeningResult (via compound_id FK). Screening submissions create
-- Compound rows that are NOT attached to any Job, so job_id is NULL.
--
-- The existing constraint `compound.job_id NOT NULL` was a holdover from
-- when only Job created compounds. It blocks every screening
-- submission with:
--   psycopg2.errors.NotNullViolation: null value in column "job_id" of
--   relation "compound" violates not-null constraint
--
-- This migration relaxes that constraint. Job submissions still pass a
-- real job_id, so existing rows are unaffected; only orphan-style
-- screening compounds will land with NULL. The FK relationship
-- (when present) is unchanged.
--
-- Idempotent — DROP NOT NULL is a no-op if the column is already
-- nullable.

BEGIN;

ALTER TABLE compound ALTER COLUMN job_id DROP NOT NULL;

COMMIT;
