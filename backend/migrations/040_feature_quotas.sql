-- 040_feature_quotas.sql
-- Per-feature usage allowances for approved users, mirroring the existing
-- lifetime job_quota (migration 033). Each column is a TOTAL allowance the
-- user spends down; when they hit it they can "Request more" and the operator
-- Grants +N on Telegram (webhook bumps the column). Admins bypass entirely.
--
-- Defaults chosen from the GPU-cost review (2026-08):
--   gnina_quota       25   — GNINA docks (heavier than Vina, still cheap)
--   boltz2_quota       5   — AI Resistance Prediction (Boltz-2), most expensive
--   resistance_quota   5   — Resistance Radar scans (each bundles ~8-16 docks)
--   screening_quota  300   — Virtual Screening COMPOUNDS (big batches add up)
--
-- Additive, idempotent, no backfill. NULL on old rows reads as the default in
-- code (COALESCE), so existing users transparently get the default allowance.

ALTER TABLE public.user_profile
    ADD COLUMN IF NOT EXISTS gnina_quota      INTEGER DEFAULT 25,
    ADD COLUMN IF NOT EXISTS boltz2_quota     INTEGER DEFAULT 5,
    ADD COLUMN IF NOT EXISTS resistance_quota INTEGER DEFAULT 5,
    ADD COLUMN IF NOT EXISTS screening_quota  INTEGER DEFAULT 300;
