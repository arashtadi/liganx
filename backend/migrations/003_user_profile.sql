-- Migration 003: user_profile table + auto-mirror trigger
--
-- Adds a typed public.user_profile table that mirrors the JSON we already
-- store on auth.users.raw_user_meta_data. The benefit is SQL-queryable
-- analytics ("how many PIs?", "which companies are on the platform?")
-- without parsing JSON in every query. The trigger keeps the two stores
-- in sync transparently — frontend keeps writing to user_metadata via
-- the Supabase JS client, the trigger fires, and the typed columns
-- update automatically.
--
-- Why a trigger instead of just reading user_metadata directly:
--   • SQL aggregations against JSON are slow and ugly.
--   • Joins from job → user_profile are clean; from job → auth.users.json is not.
--   • Adding indexes on a JSON value (organization, role) is a pain.
--   • Backups, exports, and BI tools all assume typed columns.
--
-- The trigger fires on INSERT (sign-up) and on UPDATE OF raw_user_meta_data
-- (profile edits via the Settings page). It uses ON CONFLICT DO UPDATE so
-- partial-update payloads (e.g. user changing only their org) merge
-- cleanly with existing values rather than wiping them.

BEGIN;

-- 1) The typed mirror table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_profile (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    organization TEXT,
    -- Free-form text on the storage side so future role values added in
    -- the frontend dropdown don't require another migration. Validation
    -- (which roles are accepted) lives in the Pydantic schema and the
    -- frontend SIGNUP_ROLES constant.
    role TEXT,
    researchgate_url TEXT,
    marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
    -- Acquisition cohort metadata: which signup path produced this user
    -- (email vs google), and when they signed up. signup_at duplicates
    -- created_at on auth.users but we keep it here so this table is
    -- self-sufficient for analytics queries.
    signup_source TEXT,
    signup_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for the analytics queries we know we'll want — counts by org
-- and role, plus the inevitable "show me all my company's users" filter.
CREATE INDEX IF NOT EXISTS ix_user_profile_organization ON public.user_profile (organization);
CREATE INDEX IF NOT EXISTS ix_user_profile_role ON public.user_profile (role);

-- RLS as defense in depth. The FastAPI backend connects as postgres and
-- bypasses RLS, but if anyone ever points a Supabase JS client at this
-- table directly we want it locked down by default.
ALTER TABLE public.user_profile ENABLE ROW LEVEL SECURITY;

-- 2) Trigger function ───────────────────────────────────────────────────
-- Mirrors raw_user_meta_data into the typed columns. Uses COALESCE on
-- name fields to handle Google's `name` field as a fallback for our
-- canonical `full_name`. ON CONFLICT DO UPDATE merges so partial
-- updates don't blow away existing values.
CREATE OR REPLACE FUNCTION public.sync_user_profile_from_metadata()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profile (
        user_id, full_name, organization, role, researchgate_url,
        marketing_opt_in, signup_source, signup_at, updated_at
    )
    VALUES (
        NEW.id,
        COALESCE(
            NEW.raw_user_meta_data->>'full_name',
            NEW.raw_user_meta_data->>'name'  -- Google OAuth puts display name here
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
        full_name = COALESCE(EXCLUDED.full_name, public.user_profile.full_name),
        organization = COALESCE(EXCLUDED.organization, public.user_profile.organization),
        role = COALESCE(EXCLUDED.role, public.user_profile.role),
        researchgate_url = COALESCE(EXCLUDED.researchgate_url, public.user_profile.researchgate_url),
        -- marketing_opt_in is explicit boolean; preserve the new value
        -- including FALSE (don't fall back to old TRUE).
        marketing_opt_in = EXCLUDED.marketing_opt_in,
        updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3) Wire it up ────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS sync_user_profile ON auth.users;
CREATE TRIGGER sync_user_profile
    AFTER INSERT OR UPDATE OF raw_user_meta_data ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_user_profile_from_metadata();

-- 4) Backfill existing users ────────────────────────────────────────────
-- One-shot import of every user that already exists. After this runs,
-- the trigger handles all future writes. ON CONFLICT DO NOTHING so
-- re-running the migration is safe.
INSERT INTO public.user_profile (
    user_id, full_name, organization, role, researchgate_url,
    marketing_opt_in, signup_source, signup_at
)
SELECT
    id,
    COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name'),
    raw_user_meta_data->>'organization',
    raw_user_meta_data->>'role',
    raw_user_meta_data->>'researchgate_url',
    COALESCE((raw_user_meta_data->>'marketing_opt_in')::BOOLEAN, FALSE),
    COALESCE(raw_user_meta_data->>'signup_source', 'oauth'),
    COALESCE((raw_user_meta_data->>'signup_at')::TIMESTAMPTZ, created_at)
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

COMMIT;

-- Rollback (run manually if needed):
-- BEGIN;
--   DROP TRIGGER IF EXISTS sync_user_profile ON auth.users;
--   DROP FUNCTION IF EXISTS public.sync_user_profile_from_metadata();
--   DROP INDEX IF EXISTS public.ix_user_profile_organization;
--   DROP INDEX IF EXISTS public.ix_user_profile_role;
--   DROP TABLE IF EXISTS public.user_profile;
-- COMMIT;
