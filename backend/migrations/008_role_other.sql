-- Migration 008: user_profile.role_other
--
-- When a user picks "Other" in the role dropdown on the welcome / settings
-- forms, we want to capture WHAT their actual role is — "Drug discovery
-- scientist", "Computational toxicologist", "Patent attorney", whatever.
-- Without this we just see "other" in analytics and lose the signal.
--
-- Free-form TEXT, NULL when role != 'other'. Frontend prompts for it
-- conditionally; backend Pydantic accepts it as an optional string.
-- The auto-mirror trigger from 003 isn't extended for this column —
-- role_other only flows in via the typed PUT /me/profile path (the
-- sign-up form doesn't ask for it because the welcome page is where
-- the user first encounters the choice).

BEGIN;

ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS role_other TEXT;

COMMENT ON COLUMN public.user_profile.role_other IS
  'Free-form description of the user''s role when role = ''other''. NULL otherwise.';

COMMIT;
