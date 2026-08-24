-- CI-only Supabase auth stub.
--
-- The `requires_db` tests boot the FULL app (SQLModel.create_all +
-- _run_startup_migrations) against a plain throwaway Postgres. Supabase's
-- managed `auth` schema — the `auth.users` table our public tables reference,
-- and the `auth.uid()` helper the RLS policies call — does not exist there, so
-- the boot and any query that reads users used to fail with
-- `relation "auth.users" does not exist`. That reddened the job on every run.
--
-- This seeds JUST ENOUGH of that schema for the app to boot and the tests to
-- run: an `auth.users` table with the columns our migrations, the
-- raw_user_meta_data mirror trigger (migration 003), and the admin/user
-- queries touch, plus a no-op `auth.uid()` so the RLS policy definitions
-- compile. It is applied BEFORE pytest so create_all/migrations see it.
--
-- Not a migration and never shipped to Supabase — CI only.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email              text,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
    created_at         timestamptz DEFAULT now(),
    last_sign_in_at    timestamptz
);

-- Supabase's auth.uid() reads the request JWT; there is none in CI, so a stub
-- returning NULL is enough for the CREATE POLICY statements to compile.
CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
AS $$ SELECT NULL::uuid $$;
