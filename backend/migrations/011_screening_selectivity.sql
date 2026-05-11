-- Migration 011: screening tables + Δ-vs-WT ranking columns
--
-- Why this exists:
--   The ScreeningJob / ScreeningResult SQLModel classes have been in the
--   codebase since #207 (mini virtual screening foundation) but no SQL
--   migration was ever committed for them — they relied on
--   SQLModel.metadata.create_all() at app startup to create tables on
--   fresh databases. That works for dev, but in prod where the tables
--   already exist via create_all from earlier deploys, adding NEW
--   columns to the model never reaches Postgres without an explicit
--   ALTER TABLE.
--
--   #208 adds three computed-on-write columns to ScreeningResult:
--     - wt_score:        the paired WT cell's best_score, denormalized
--                        onto the mutant row so the results page can
--                        sort without a self-join.
--     - delta_score:     mutant_score - wt_score. Negative = mutant
--                        binds tighter than WT (selectivity gain).
--     - selectivity_index: composite ranking metric, see
--                        screening_runner._selectivity_index for the
--                        formula. NULL when WT-only or wt_score missing.
--
--   And an `extra` column to carry the same pipe-delimited extras
--   payload the DockingResult uses (outside_pocket_angstroms, vinardo,
--   strain, etc.). Same parser shape, same UI treatment downstream.
--
-- This migration is idempotent — every statement uses IF NOT EXISTS so
-- it's safe to re-run.

BEGIN;

-- screening_job: the parent row for a screen (one target × mutations
-- tuple, N compounds, common engine/exhaustiveness settings).
CREATE TABLE IF NOT EXISTS screening_job (
    id SERIAL PRIMARY KEY,
    share_id VARCHAR(32) UNIQUE NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    pdb_id TEXT NOT NULL,
    chain TEXT NOT NULL DEFAULT 'A',
    mutations TEXT NOT NULL DEFAULT '',
    engine TEXT DEFAULT 'quickvina2_gpu',
    exhaustiveness INT NOT NULL DEFAULT 4,
    n_total INT NOT NULL DEFAULT 0,
    n_completed INT NOT NULL DEFAULT 0,
    n_failed INT NOT NULL DEFAULT 0,
    title TEXT,
    tags TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    user_id UUID
);

CREATE INDEX IF NOT EXISTS ix_screening_job_share_id ON screening_job(share_id);
CREATE INDEX IF NOT EXISTS ix_screening_job_pdb_id ON screening_job(pdb_id);
CREATE INDEX IF NOT EXISTS ix_screening_job_engine ON screening_job(engine);
CREATE INDEX IF NOT EXISTS ix_screening_job_status ON screening_job(status);
CREATE INDEX IF NOT EXISTS ix_screening_job_user_id ON screening_job(user_id);
CREATE INDEX IF NOT EXISTS ix_screening_job_created_at ON screening_job(created_at);

-- screening_result: one row per (job, compound, variant). Pre-staged at
-- submit time so the progress bar has its denominator instantly; the
-- runner writes scores into existing rows rather than INSERT-as-it-goes.
CREATE TABLE IF NOT EXISTS screening_result (
    id SERIAL PRIMARY KEY,
    screening_job_id INT NOT NULL REFERENCES screening_job(id),
    compound_id INT NOT NULL REFERENCES compound(id),
    variant TEXT NOT NULL,
    best_score DOUBLE PRECISION,
    pose_uri TEXT,
    admet_extended_json TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_screening_result_screening_job_id ON screening_result(screening_job_id);
CREATE INDEX IF NOT EXISTS ix_screening_result_compound_id ON screening_result(compound_id);
CREATE INDEX IF NOT EXISTS ix_screening_result_variant ON screening_result(variant);
CREATE INDEX IF NOT EXISTS ix_screening_result_best_score ON screening_result(best_score);
CREATE INDEX IF NOT EXISTS ix_screening_result_status ON screening_result(status);

-- #208 ranking columns. ADD COLUMN IF NOT EXISTS is a PG 9.6+ feature
-- so it's safe on every supported Postgres.
ALTER TABLE screening_result ADD COLUMN IF NOT EXISTS wt_score DOUBLE PRECISION;
ALTER TABLE screening_result ADD COLUMN IF NOT EXISTS delta_score DOUBLE PRECISION;
ALTER TABLE screening_result ADD COLUMN IF NOT EXISTS selectivity_index DOUBLE PRECISION;
ALTER TABLE screening_result ADD COLUMN IF NOT EXISTS extra TEXT;

-- Index on selectivity_index for the results-page ORDER BY. NULLS LAST
-- is the natural ordering for sort-by-selectivity (WT-only or failed
-- cells without an index go to the bottom). PG's default for DESC is
-- NULLS FIRST so we have to spell out NULLS LAST.
CREATE INDEX IF NOT EXISTS ix_screening_result_selectivity_index
    ON screening_result(selectivity_index DESC NULLS LAST);

COMMIT;
