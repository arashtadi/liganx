-- 039_resistance_access.sql
-- Per-feature request/approve access for Resistance Radar, mirroring
-- boltz2_access (migration 036) and gnina/screening_access (migration 037).
-- Lets the Studio's Resistance Radar button use the same in-app
-- "Request access -> operator Approve/Deny in Telegram" flow instead of
-- staying admin-only.
--
-- Values (same convention as boltz2_access):
--   NULL/''     -> never requested
--   'requested' -> awaiting operator decision
--   'approved'  -> feature unlocked for this account
--   'denied'    -> request declined
--
-- Gating stays ADDITIVE: admins keep access unconditionally; this column
-- only ADDS a request path for everyone else. Additive, idempotent, no backfill.

ALTER TABLE public.user_profile
    ADD COLUMN IF NOT EXISTS resistance_access TEXT;
