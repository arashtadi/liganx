-- 035_profile_notified_at.sql
-- Track whether the operator has already been sent the RICH (affiliation-
-- carrying) sign-up notification for a user.
--
-- Why: OAuth users (Google) get their user_profile row auto-created on first
-- sign-in with NO organization/role. The first operator ping therefore fires
-- from /me/access_status (migration 031's signup_notified_at claim) carrying
-- only the email — "very minimum info, not their role/affiliation."
--
-- They fill in organization + role LATER, via POST /me/profile. But that path
-- hits the UPDATE branch (row already exists), so is_first_profile_write is
-- False and the rich notify_new_user never fired. Admin never learned who they
-- actually are.
--
-- Fix: a dedicated nullable timestamp claimed atomically in update_my_profile
-- the moment a still-pending user supplies organization/role. On the winning
-- claim we fire a second, richer Telegram ping (Approve/Deny + affiliation) so
-- the operator can decide with full context. Gated on access_status='pending'
-- so already-approved users editing their profile never re-notify.
--
-- No backfill: the column stays NULL for everyone. Combined with the
-- pending-only gate, that means only users currently awaiting approval can
-- ever trigger the affiliation ping — existing approved users are untouched.

ALTER TABLE public.user_profile
    ADD COLUMN IF NOT EXISTS profile_notified_at TIMESTAMPTZ;
