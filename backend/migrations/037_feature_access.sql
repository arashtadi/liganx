-- 037_feature_access.sql
-- Per-feature request/approve access for GNINA docking and Virtual Screening,
-- mirroring boltz2_access (migration 036). Lets the Studio's locked GNINA / VS
-- buttons use the same in-app "Request access -> operator Approve/Deny in
-- Telegram" flow as AI Resistance Prediction, instead of routing to the
-- contact form.
--
-- Values (same convention as boltz2_access):
--   NULL/''     -> never requested
--   'requested' -> awaiting operator decision
--   'approved'  -> feature unlocked for this account
--   'denied'    -> request declined
--
-- Gating stays ADDITIVE: admins and (for VS) existing is_pro accounts keep
-- their access; these columns only ADD a request path for everyone else.
-- Additive, idempotent, no backfill.

ALTER TABLE public.user_profile
    ADD COLUMN IF NOT EXISTS gnina_access      TEXT,
    ADD COLUMN IF NOT EXISTS screening_access  TEXT;
