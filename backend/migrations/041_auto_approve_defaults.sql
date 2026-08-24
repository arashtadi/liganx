-- 041_auto_approve_defaults.sql
--
-- Auto-approve new sign-ups. Product decision (2026-08-24): the manual
-- approval wall was silently losing sign-ups — users hit the "awaiting
-- approval" screen and left before the operator ever saw the Telegram
-- ping (Ziyuan, Linda, Karim all bounced this way).
--
-- Now that the expensive engines are each gated per-feature AND capped
-- by per-user quotas (migrations 036/037/039/040), a fresh account can
-- safely default to approved with all self-serve features on:
--   access_status      -> 'approved'   (unlocks the app / basic docking)
--   gnina_access       -> 'approved'   (quota: gnina_quota, default 25)
--   boltz2_access      -> 'approved'   (quota: boltz2_quota, default 5)
--   screening_access   -> 'approved'   (quota: screening_quota, default 300)
--   resistance_access  -> 'approved'   (quota: resistance_quota, default 5)
--
-- FEP+ stays LOCKED. It is gated separately via fep_enabled /
-- _require_fep_access (migration 017) — deliberately NOT touched here,
-- because each FEP edge costs ~$100 of pod GPU.
--
-- This only changes column DEFAULTs, so:
--   • every new user_profile row (created by the migration-003 trigger
--     on sign-up, or by the app INSERT paths) is approved with the four
--     features on.
--   • existing rows are left exactly as they are.
--
-- The operator still gets the Telegram sign-up ping (now with a Deny
-- button to revoke, since Approve is automatic). To revert to
-- invite-only, set these DEFAULTs back to 'pending' / NULL.

BEGIN;

ALTER TABLE public.user_profile ALTER COLUMN access_status     SET DEFAULT 'approved';
ALTER TABLE public.user_profile ALTER COLUMN gnina_access      SET DEFAULT 'approved';
ALTER TABLE public.user_profile ALTER COLUMN boltz2_access     SET DEFAULT 'approved';
ALTER TABLE public.user_profile ALTER COLUMN screening_access  SET DEFAULT 'approved';
ALTER TABLE public.user_profile ALTER COLUMN resistance_access SET DEFAULT 'approved';

COMMIT;
