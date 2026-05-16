-- 022_fep_force_field_engine.sql
--
-- (K3) Records which force-field engine ran each FEP study so the UI
-- can display "Sage" vs "Espaloma" vs (future) "MACE-OFF" badges and
-- so we can analyse cost / accuracy per tier in the admin panel.
--
-- Why TEXT not enum: enums require ALTER TYPE for every new tier
-- (we have at least one more coming — MACE-OFF). TEXT with an
-- application-layer whitelist is cheaper and reversible.
--
-- Why nullable: pre-K3 rows have no engine recorded. NULL is read
-- by the UI as "Sage" (the only engine that existed when those rows
-- were created), so we preserve historical accuracy without a
-- destructive backfill. New rows always set the column explicitly.
--
-- NO behavioural change from this migration alone — fep_runner.py
-- (K4) still hardcodes the Sage pod URL. K3 only persists the user's
-- engine choice in the DB; K4 reads it to dispatch.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.fep_job
    ADD COLUMN IF NOT EXISTS force_field_engine TEXT;

-- Helpful when we add per-engine analytics in the admin panel.
CREATE INDEX IF NOT EXISTS idx_fep_job_force_field_engine
    ON public.fep_job (force_field_engine);
