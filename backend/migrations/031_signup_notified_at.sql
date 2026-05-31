-- 031_signup_notified_at.sql
-- Track whether the operator has already been notified about a sign-up.
--
-- Why: notify_new_user used to fire only from POST /me/profile (the welcome-form
-- submit), so a Google-OAuth user — whose user_profile row is auto-created by
-- the migration-003 trigger AND who hits /pending before ever reaching /welcome
-- — never tripped a notification. Admin had no idea they had a new sign-up.
--
-- Fix: add a dedicated nullable timestamp. On every first `/me/access_status`
-- call (the very first request the frontend makes for any signed-in user) we
-- atomically `UPDATE … SET signup_notified_at = NOW() WHERE signup_notified_at
-- IS NULL`; if the UPDATE returns rowcount=1 we won the race and fire the
-- Telegram + email. Idempotent and works for every sign-up path (email/password,
-- Google OAuth, magic-link, future SSO providers) because they all eventually
-- call `/me/access_status` to know whether to render the pending lock screen.
--
-- Backfill: every existing row is stamped NOW() so we don't re-notify for users
-- already in the system on this deploy.

ALTER TABLE public.user_profile
    ADD COLUMN IF NOT EXISTS signup_notified_at TIMESTAMPTZ;

UPDATE public.user_profile
   SET signup_notified_at = NOW()
 WHERE signup_notified_at IS NULL;
