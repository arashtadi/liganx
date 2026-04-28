-- Migration 001: User authentication foundation
-- Snapshot before this ran: pre-bigchange-2026-04-28 (commit e3a0414)
-- ~/Documents/Claude/Projects/DockingOnline-backups/2026-04-28-pre-bigchange/
--
-- What this does:
--   1. WIPES public.job, public.compound, public.dockingresult (test/dev data
--      only — confirmed with the user).
--   2. Adds user_id, title, tags columns to public.job for ownership + UX.
--   3. Creates public.compound_library — saved SMILES sets per user.
--   4. Enables RLS as defense-in-depth. Primary enforcement is in the FastAPI
--      backend (which connects as the privileged postgres role and bypasses
--      RLS). Frontend never queries Postgres directly — it goes through FastAPI
--      which validates the user's Supabase JWT and filters by user_id.
--   5. Public read on jobs is intentional — share-link URLs (/jobs/<share_id>)
--      must keep working for unauthenticated viewers. The list endpoint
--      (GET /jobs) filters by user_id in app code.

BEGIN;

-- 1) Wipe existing data ──────────────────────────────────────────────────
TRUNCATE TABLE public.dockingresult RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.compound RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.job RESTART IDENTITY CASCADE;

-- 2) Ownership + metadata columns on job ─────────────────────────────────
-- The legacy SQLModel had `user_id INTEGER` as a placeholder. Drop it first
-- so we can recreate as the correct UUID type. Wipe above already removed
-- any rows that referenced it, so this is non-destructive.
ALTER TABLE public.job DROP COLUMN IF EXISTS user_id;
ALTER TABLE public.job
  ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS tags  TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_job_user_id      ON public.job(user_id);
CREATE INDEX IF NOT EXISTS idx_job_user_created ON public.job(user_id, created_at DESC);

-- 3) Compound library ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.compound_library (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  -- [{name: string, smiles: string}, ...]
  compounds   JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_complib_user_created
  ON public.compound_library(user_id, created_at DESC);

-- 4) RLS on job ──────────────────────────────────────────────────────────
ALTER TABLE public.job ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_public_read"   ON public.job;
DROP POLICY IF EXISTS "job_owner_insert"  ON public.job;
DROP POLICY IF EXISTS "job_owner_update"  ON public.job;
DROP POLICY IF EXISTS "job_owner_delete"  ON public.job;

-- Anyone can SELECT — share-links must keep working for unauthenticated
-- viewers. The list endpoint filters by user_id in app code, not via RLS.
CREATE POLICY "job_public_read" ON public.job
  FOR SELECT USING (true);

CREATE POLICY "job_owner_insert" ON public.job
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "job_owner_update" ON public.job
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "job_owner_delete" ON public.job
  FOR DELETE USING (auth.uid() = user_id);

-- 5) RLS on compound + dockingresult (children of job) ──────────────────
ALTER TABLE public.compound        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dockingresult   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "compound_public_read" ON public.compound;
DROP POLICY IF EXISTS "compound_owner_write" ON public.compound;
DROP POLICY IF EXISTS "result_public_read"   ON public.dockingresult;
DROP POLICY IF EXISTS "result_owner_write"   ON public.dockingresult;

CREATE POLICY "compound_public_read" ON public.compound
  FOR SELECT USING (true);

CREATE POLICY "compound_owner_write" ON public.compound
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.job j
            WHERE j.id = compound.job_id AND j.user_id = auth.uid())
  );

CREATE POLICY "result_public_read" ON public.dockingresult
  FOR SELECT USING (true);

CREATE POLICY "result_owner_write" ON public.dockingresult
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.job j
            WHERE j.id = dockingresult.job_id AND j.user_id = auth.uid())
  );

-- 6) RLS on compound_library — strict per-user, no public read ──────────
ALTER TABLE public.compound_library ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "complib_select_own" ON public.compound_library;
DROP POLICY IF EXISTS "complib_insert_own" ON public.compound_library;
DROP POLICY IF EXISTS "complib_update_own" ON public.compound_library;
DROP POLICY IF EXISTS "complib_delete_own" ON public.compound_library;

CREATE POLICY "complib_select_own" ON public.compound_library
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "complib_insert_own" ON public.compound_library
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "complib_update_own" ON public.compound_library
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "complib_delete_own" ON public.compound_library
  FOR DELETE USING (auth.uid() = user_id);

-- 7) updated_at trigger for compound_library ─────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS complib_touch_updated ON public.compound_library;
CREATE TRIGGER complib_touch_updated
  BEFORE UPDATE ON public.compound_library
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMIT;

-- Sanity checks (run separately):
--   SELECT count(*) FROM public.job;             -- expect 0
--   SELECT count(*) FROM public.compound;        -- expect 0
--   SELECT count(*) FROM public.dockingresult;   -- expect 0
--   \d+ public.job                                -- user_id, title, tags present
--   SELECT relname, relrowsecurity FROM pg_class
--     WHERE relname IN ('job','compound','dockingresult','compound_library');
--   -- all four should show relrowsecurity = t
