-- Migration 005: user_compound table — per-user library of named compound
-- structures.
--
-- Why this exists: users were building up the same compound list from scratch
-- on every job. The intent is "give a compound a name, get it back next time".
-- Auto-save in the New-job form fires whenever a row has BOTH a name AND a
-- valid SMILES, so users don't have to remember a separate Save action.
--
-- The library is read into the New-job form as a quick-add chip row so users
-- can re-use any saved compound in one click. Editing or removing a saved
-- compound happens inline (X on the chip).
--
-- Auth model: row-level security via the FastAPI postgres role bypassing RLS
-- (same pattern as user_profile). FK ON DELETE CASCADE so deleting a user
-- also wipes their library.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_compound (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Name is what the user types; (user_id, lower(name)) is unique so
    -- re-saving with the same name updates rather than inserts a duplicate.
    -- That is what makes auto-save idempotent — the form re-fires the POST
    -- on every keystroke once both fields are filled, and we want at most
    -- one row per (user, name).
    name TEXT NOT NULL,
    smiles TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Per-user uniqueness on lowercased name. The lowercase prevents
    -- "Aspirin" and "aspirin" from being two separate library entries
    -- which would feel buggy to the user.
    CONSTRAINT user_compound_unique_per_user UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS ix_user_compound_user_id ON public.user_compound (user_id);

-- RLS as defense in depth. The FastAPI backend connects as postgres and
-- bypasses RLS, but if anyone ever points a Supabase JS client at this
-- table directly we want it locked down by default.
ALTER TABLE public.user_compound ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Rollback (run manually if needed):
-- BEGIN;
--   DROP INDEX IF EXISTS public.ix_user_compound_user_id;
--   DROP TABLE IF EXISTS public.user_compound;
-- COMMIT;
