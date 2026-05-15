-- 014_is_pro.sql
--
-- Adds an is_pro flag to user_profile. Defaults to FALSE — everyone is
-- free tier on signup. Admin toggles this per-user via the /admin UI
-- (PATCH /admin/users/{id}/pro).
--
-- Why a boolean column instead of an env-var allowlist (like
-- RATE_LIMIT_BYPASS_EMAILS):
--   - Operator can flip a user paid/free without a redeploy
--   - Survives across Fly secret rotations
--   - Admin UI can list/filter pro users without parsing env vars
--   - Future Stripe webhook can write to this column directly
--
-- Free vs Pro behaviour:
--   - GNINA docking engine: Pro only
--   - Virtual Screening (/screening): Pro only
--   - Vina docking: everyone
--   - ADMET: everyone
--   - ESM2 fitness: everyone
-- Backend enforces in routers/jobs.py (engine=gnina) and screening.py
-- (POST gates), frontend gates the UI buttons with a "contact us" modal.

-- Bootstrap for fresh databases that haven't run the historical migration
-- 003 (which lives in the HISTORICAL_ALLOWLIST and is not wired into the
-- startup runner). On prod where 003 already created public.user_profile
-- with the full schema + the auth.users sync trigger, this CREATE is a
-- no-op. On a fresh CI Postgres it creates a minimal table so the ALTER
-- below has something to attach to. The trigger + auth.users FK aren't
-- recreated here because they reference the Supabase-managed auth schema
-- that doesn't exist in a vanilla Postgres container — tests that need
-- real user rows would have to seed them directly.
CREATE TABLE IF NOT EXISTS public.user_profile (user_id UUID PRIMARY KEY);

ALTER TABLE public.user_profile
    ADD COLUMN IF NOT EXISTS is_pro BOOLEAN NOT NULL DEFAULT FALSE;
