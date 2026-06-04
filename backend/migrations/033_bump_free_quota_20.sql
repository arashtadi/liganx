-- 033_bump_free_quota_20.sql
-- Raise the free-tier docking quota from 10 to 20.
--
-- Background: migration 007 created user_profile.job_quota with
-- DEFAULT 10. The jobs.py enforcement uses COALESCE(job_quota, 20),
-- but since every row stores a non-null 10 (the column default), the
-- COALESCE fallback never applied and free users were still capped at
-- 10. This migration makes the intended "free = 20" policy real by
-- (a) changing the column default for future signups and (b) bumping
-- existing rows that are still sitting at the old default of 10.
--
-- Idempotent: re-running re-asserts the default and only touches rows
-- that are still exactly 10, so custom per-user quotas (e.g. a user
-- intentionally set to 5 or 50) are never clobbered.

ALTER TABLE public.user_profile
    ALTER COLUMN job_quota SET DEFAULT 20;

UPDATE public.user_profile
    SET job_quota = 20
    WHERE job_quota = 10;
