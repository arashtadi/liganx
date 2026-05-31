-- 029_user_approval_status.sql
-- Per-user approval gate. New sign-ups land as `pending` and cannot submit
-- docking / FEP / compute jobs until an admin approves them. This is the
-- prerequisite for safely auto-stopping the GPU pod when idle: without it,
-- any random sign-up could wake an expensive pod by clicking Run Dock.
--
-- Status values:
--   pending  — default for NEW rows from this migration onward; cannot dock.
--   approved — admin granted access; full normal behavior.
--   denied   — admin rejected; same gate as pending, just labelled distinctly
--              so we don't re-notify on next login attempt.
--
-- Grandfathering: every existing user_profile row is set to `approved` so
-- this migration is non-disruptive — current users keep working without
-- intervention. Only NEW sign-ups go through the gate.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + the backfill is a no-op when run
-- again (every row already non-null after the first run).

ALTER TABLE public.user_profile
    ADD COLUMN IF NOT EXISTS access_status   TEXT,
    ADD COLUMN IF NOT EXISTS access_decided_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS access_decided_by TEXT;

-- Backfill: existing rows are grandfathered to `approved` so this migration
-- doesn't lock out current users. NEW rows from sign-up code paths will be
-- inserted with `pending` explicitly (see services/notifications + the
-- user-profile bootstrap path).
UPDATE public.user_profile
   SET access_status = 'approved'
 WHERE access_status IS NULL;

-- Defensive default for any future inserts that don't set the column.
-- We pick `pending` as the DEFAULT so a buggy insert path can never
-- accidentally grant access.
ALTER TABLE public.user_profile
    ALTER COLUMN access_status SET DEFAULT 'pending';

-- Tight CHECK so an out-of-band write can't slip an unknown value in.
-- Idempotent via DROP-IF-EXISTS + ADD instead of a DO/IF NOT EXISTS PL/pgSQL
-- block, because the startup-migration SQL splitter doesn't understand
-- $$-quoted dollar-blocks and would shred the DO statement (the previous
-- attempt boot-failed with `syntax error at or near "IF"` because the
-- splitter treated `IF NOT EXISTS` as its own top-level statement).
ALTER TABLE public.user_profile
    DROP CONSTRAINT IF EXISTS user_profile_access_status_chk;
ALTER TABLE public.user_profile
    ADD CONSTRAINT user_profile_access_status_chk
    CHECK (access_status IN ('pending','approved','denied'));

-- Index for the admin "pending users" list (typically small, but cheap
-- and lets the WHERE clause be plan-stable).
CREATE INDEX IF NOT EXISTS ix_user_profile_access_status
    ON public.user_profile (access_status)
    WHERE access_status <> 'approved';
