-- 020_fep_perturbation_stage.sql
--
-- (J12) Add per-edge live progress fields so the frontend can show
-- sub-stage progress while a single FEP edge is running, instead of
-- just a binary running/done. Populated by the new async polling
-- pattern: fep_runner polls /fep_edge_status/{job_id} every 30s and
-- writes the latest `stage` (e.g. "running_complex_leg") plus
-- `progress_pct` (0-100, currently set by stage-level milestones
-- since openmm reporter integration is J14).
--
-- We also store `pod_job_id` so a backend restart mid-edge can
-- resume polling the same worker rather than firing a duplicate edge.
--
-- All three are NULLABLE: old rows from before this migration didn't
-- have these fields, and short-protocol/mock edges may still skip
-- them. Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.fep_perturbation
    ADD COLUMN IF NOT EXISTS stage TEXT,
    ADD COLUMN IF NOT EXISTS progress_pct INTEGER,
    ADD COLUMN IF NOT EXISTS pod_job_id TEXT;
