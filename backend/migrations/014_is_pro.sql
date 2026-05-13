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

ALTER TABLE public.user_profile
    ADD COLUMN IF NOT EXISTS is_pro BOOLEAN NOT NULL DEFAULT FALSE;
