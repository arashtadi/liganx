-- 017_fep_access.sql
--
-- Adds a per-user `fep_enabled` feature-access flag to user_profile.
--
-- Unlike ensemble_enabled (16) which is ungated-by-default, FEP+ is
-- GATED BY DEFAULT — the column DEFAULTs FALSE. FEP studies cost ~$100
-- of pod GPU each ($1.50/hr × ~70 GPU-hours per 10-analog star network);
-- we don't want a fresh signup to be able to burn that with one click.
--
-- Access flow:
--   1. User signs up → user_profile row created with fep_enabled = FALSE
--      (or no row at all; COALESCE handles both as FALSE = blocked).
--   2. User contacts us / upgrades / has admin grant access.
--   3. Admin flips fep_enabled = TRUE via PATCH /admin/users/{id}/fep.
--   4. FEP endpoints check fep_access_allowed() before any pod call.
--
-- The admin email is unconditionally allowed (same pattern as
-- is_pro_user / ensemble_access_allowed in auth.py).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to run on every boot.

-- Bootstrap: no-op on prod, creates the minimal user_profile on fresh
-- CI databases. Same shape as 016.
CREATE TABLE IF NOT EXISTS public.user_profile (user_id UUID PRIMARY KEY);

-- Gated-by-default — note the FALSE default, opposite of ensemble.
ALTER TABLE public.user_profile
    ADD COLUMN IF NOT EXISTS fep_enabled BOOLEAN NOT NULL DEFAULT FALSE;
