-- Migration 006: add tags column to user_compound
--
-- Same shape as job.tags (TEXT[]) so the frontend's existing tag-strip
-- and color-coding helpers work on saved compounds with no new code path.
-- Default empty array so the column is non-NULL and clients can iterate
-- without null-checks.

BEGIN;

ALTER TABLE public.user_compound
    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

COMMIT;

-- Rollback (run manually if needed):
-- BEGIN;
--   ALTER TABLE public.user_compound DROP COLUMN IF EXISTS tags;
-- COMMIT;
