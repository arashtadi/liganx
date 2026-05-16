-- 019_fep_estimated_cost.sql
--
-- Add estimated_usd_cost to fep_job for the per-user monthly $ cap.
--
-- Why a stored column instead of recomputing on the fly: the cap
-- query is a hot path in create_fep_study (every submit re-checks
-- the user's last-30-days spend), so we'd rather SUM a column than
-- re-derive cost from FepNode counts + protocol knobs on every row.
-- The estimate is computed once at submit time and frozen — even if
-- we later adjust the per-edge GPU-hour estimate, historical jobs
-- keep their original price.
--
-- DEFAULT 0 so existing FepJob rows from before this migration land
-- with no cost. Means they don't count toward the cap. That's the
-- right call — those were created before the cap existed; we don't
-- want to retroactively charge them.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.fep_job
    ADD COLUMN IF NOT EXISTS estimated_usd_cost REAL NOT NULL DEFAULT 0;
