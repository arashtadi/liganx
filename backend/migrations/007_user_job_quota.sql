-- 007_user_job_quota.sql
--
-- Adds a per-user lifetime job quota. Existing users default to 10 (the
-- system-wide default for the free tier). Admin can raise this per user
-- via PATCH /admin/users/{id} for power users / friends-and-family /
-- collaborators who need more headroom.
--
-- Why a column on user_profile instead of a separate table:
--   - Tightly coupled to the user identity. No 1-many relationship.
--   - Reads happen on every job submission; keeping it on the same row
--     as full_name/role means one query at job-create time, not two.
--   - The user_profile row is auto-created by the existing on-signup
--     trigger (see migration 003), so we don't need a backfill — the
--     column DEFAULT handles new and existing rows alike.
--
-- Quota counting (enforced in routers/jobs.py create_job):
--   Failed and cancelled jobs do NOT count. The user shouldn't be
--   penalized for a Pod failure or for cancelling a job they didn't
--   mean to start. Counted statuses: pending, running, completed.
--
-- To grant a user more dockings:
--   UPDATE public.user_profile SET job_quota = 50 WHERE user_id = '...';
-- Or via the /admin UI.

ALTER TABLE public.user_profile
    ADD COLUMN IF NOT EXISTS job_quota INT NOT NULL DEFAULT 10;

-- Sanity check: nobody should ever have a negative quota. Setting to 0
-- effectively bans new submissions (existing jobs continue), which is a
-- valid moderation action — that's why we don't enforce > 0.
ALTER TABLE public.user_profile
    DROP CONSTRAINT IF EXISTS user_profile_job_quota_nonneg;
ALTER TABLE public.user_profile
    ADD CONSTRAINT user_profile_job_quota_nonneg CHECK (job_quota >= 0);
