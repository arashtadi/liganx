-- 034_bump_free_quota_50.sql
-- Raise the free-tier lifetime job quota from 20 -> 50 so an evaluating
-- user (a new PI trialling the platform) can explore without hitting a
-- wall mid-evaluation. Docking runs on a cheap CPU serverless worker, so
-- the extra headroom costs almost nothing. Mirrors migration 033.
--
-- Idempotent: SET DEFAULT is always safe to re-run; the UPDATE only
-- touches rows still sitting at the previous default of 20, leaving any
-- admin-customised quota (higher OR lower) untouched.

ALTER TABLE public.user_profile
    ALTER COLUMN job_quota SET DEFAULT 50;

UPDATE public.user_profile
    SET job_quota = 50
    WHERE job_quota = 20;
