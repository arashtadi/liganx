-- Migration 003b: fix the trigger function from migration 003.
--
-- The original CREATE FUNCTION listed 9 columns
-- (user_id, full_name, organization, role, researchgate_url,
--  marketing_opt_in, signup_source, signup_at, updated_at)
-- but only supplied 8 values. Postgres errored with SQLSTATE 42601
-- ("INSERT has more target columns than expressions") on every Google
-- OAuth signup, which Supabase then surfaced to the user as a
-- "Link expired" verify-email error page.
--
-- Fix: drop updated_at from the column list — it has a DEFAULT NOW()
-- on the table so omitting it gets the correct value automatically.
-- Same shape on the ON CONFLICT branch where we explicitly set
-- updated_at = NOW().

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_user_profile_from_metadata()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profile (
        user_id, full_name, organization, role, researchgate_url,
        marketing_opt_in, signup_source, signup_at
    )
    VALUES (
        NEW.id,
        COALESCE(
            NEW.raw_user_meta_data->>'full_name',
            NEW.raw_user_meta_data->>'name'  -- Google OAuth display name
        ),
        NEW.raw_user_meta_data->>'organization',
        NEW.raw_user_meta_data->>'role',
        NEW.raw_user_meta_data->>'researchgate_url',
        COALESCE((NEW.raw_user_meta_data->>'marketing_opt_in')::BOOLEAN, FALSE),
        COALESCE(NEW.raw_user_meta_data->>'signup_source', 'oauth'),
        COALESCE(
            (NEW.raw_user_meta_data->>'signup_at')::TIMESTAMPTZ,
            NEW.created_at,
            NOW()
        )
    )
    ON CONFLICT (user_id) DO UPDATE SET
        full_name        = COALESCE(EXCLUDED.full_name,        public.user_profile.full_name),
        organization     = COALESCE(EXCLUDED.organization,     public.user_profile.organization),
        role             = COALESCE(EXCLUDED.role,             public.user_profile.role),
        researchgate_url = COALESCE(EXCLUDED.researchgate_url, public.user_profile.researchgate_url),
        marketing_opt_in = EXCLUDED.marketing_opt_in,
        updated_at       = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
