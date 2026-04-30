-- Migration 002: Add engine column to job table
--
-- Backs the GNINA dispatch work — see pod/GNINA_INSTALL.md for the
-- companion Pod-side install steps and the GNINA_ENABLED Fly secret
-- that gates whether non-default engines actually dispatch.
--
-- Why a free-form text column (not an enum):
--   We expect to add more engines (autodock_gpu, vanilla vina, smina_ad4,
--   diffdock) over the next few months. A Postgres ENUM would force a
--   migration every time we add one; TEXT lets us ship engines incrementally
--   and validate values in the FastAPI schema layer (Pydantic) instead of
--   the database. Trade-off accepted: malformed engine strings would only
--   show up at runner-dispatch time, not insert time. Mitigation: the
--   Pydantic schema rejects unknown values before they ever hit the DB.
--
-- Default 'quickvina2_gpu' preserves existing behaviour: any row created
-- before this migration ran (or any new row that doesn't set the column)
-- gets the current production engine. No data loss, no surprises.

BEGIN;

ALTER TABLE public.job
    ADD COLUMN IF NOT EXISTS engine TEXT NOT NULL DEFAULT 'quickvina2_gpu';

-- Backfill any historical rows that existed before this column did. The
-- default takes care of new inserts; this brings legacy rows in line so
-- the matrix UI's "ran with engine=X" badge has a value to render.
UPDATE public.job SET engine = 'quickvina2_gpu' WHERE engine IS NULL;

-- Index because the History page will eventually grow an "Engine" filter
-- (alongside the existing tag filter); a btree on a low-cardinality TEXT
-- column is cheap and the planner picks it up for `WHERE engine = ?`.
CREATE INDEX IF NOT EXISTS ix_job_engine ON public.job (engine);

COMMIT;

-- Rollback (manual; not run automatically):
-- BEGIN;
--   DROP INDEX IF EXISTS public.ix_job_engine;
--   ALTER TABLE public.job DROP COLUMN IF EXISTS engine;
-- COMMIT;
