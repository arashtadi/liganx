-- Migration 004: Add stage column to job table
--
-- Replaces the timing-driven progress stages on the JobPage with
-- exact stage strings written by the runner as it advances. The
-- frontend used to guess the active stage from elapsed time + engine
-- + cell count — close enough to feel less stuck, but visibly wrong
-- when the runner hit a slow path (cold receptor cache, FoldX retry).
--
-- Free-form TEXT, not an enum, for the same reason `engine` is text:
--   we expect to add more stage labels (water analysis pass, MM-GBSA
--   rescore, Boltz-2 ensemble) without forcing a migration each time.
-- The runner writes a short slug like "fetching_pdb" or
--   "docking_3_of_8" and the frontend renders a friendly label on top.
--
-- NULL is the rest state — set when the job hasn't started yet
-- (PENDING) or when it's terminal (COMPLETED / FAILED / CANCELLED).
-- We don't bother indexing because the column is read with a
-- single-row primary-key fetch, never as a filter predicate.

BEGIN;

ALTER TABLE public.job
    ADD COLUMN IF NOT EXISTS stage TEXT NULL;

COMMIT;

-- Rollback (manual; not run automatically):
-- BEGIN;
--   ALTER TABLE public.job DROP COLUMN IF EXISTS stage;
-- COMMIT;
