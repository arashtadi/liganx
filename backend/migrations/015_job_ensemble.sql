-- 015_job_ensemble.sql
--
-- Adds an `ensemble` flag to the job table. Default FALSE — every existing
-- job, and every job submitted without opting in, keeps exactly today's
-- single-conformation docking behaviour.
--
-- When TRUE, the runner docks each ligand against several short-MD-relaxed
-- receptor conformers (generated on the GPU pod's /relax_ensemble endpoint)
-- and keeps the best score + pose per cell. This retires the "single-
-- conformation docking can't see protein flexibility" caveat the UI shows
-- on so many results.
--
-- Scope:
--   - Full Jobs only. Quick Dock never sets this column.
--   - Opt-in from the Studio Full Job setup (next to engine/exhaustiveness).
--   - Admin can gate access per-user via user_profile.ensemble_enabled
--     (migration 016) — but the feature is ungated by default.
--
-- Why a real column and not a pipe-delimited flag somewhere: the runner
-- branches on it on the production docking path, and the API echoes it
-- back so the matrix UI can label "docked against an MD ensemble". The
-- per-cell conformer spread, by contrast, lives pipe-delimited in
-- docking_result.extra (ens=... ) — that's per-result telemetry, not a
-- job-level setting.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to run on every boot.

ALTER TABLE public.job
    ADD COLUMN IF NOT EXISTS ensemble BOOLEAN NOT NULL DEFAULT FALSE;
