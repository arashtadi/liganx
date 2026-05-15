-- 016_ensemble_access.sql
--
-- Adds a per-user `ensemble_enabled` feature-access flag to user_profile.
--
-- Ensemble docking is UNGATED BY DEFAULT — the column DEFAULTs TRUE, so
-- every existing user and every new signup can opt into ensemble docking
-- from the Studio Full Job setup. This flag exists so an admin can REVOKE
-- access per-user (PATCH /admin/users/{id}/ensemble) if the feature ever
-- needs throttling — it is NOT a Stripe Pro-tier paywall like is_pro.
--
-- Why a separate column from is_pro:
--   - is_pro is the billing tier (GNINA + Virtual Screening). Ensemble is
--     deliberately NOT behind billing — it's a methodology improvement we
--     want broadly used, with an admin kill-switch as a safety valve.
--   - This column is intended to be reused by the planned MM-GBSA / FEP-
--     lite phase-2 "advanced physics" feature, which shares the same
--     OpenMM-on-pod foundation. Keeping it independent of is_pro means we
--     can gate the advanced-physics features as a group without touching
--     the billing flag.
--
-- Gate semantics: COALESCE(ensemble_enabled, TRUE) — a NULL (profile row
-- predates this migration, or no profile row exists yet for a fresh OAuth
-- user) resolves to TRUE = access. Only an explicit FALSE blocks.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to run on every boot.

ALTER TABLE public.user_profile
    ADD COLUMN IF NOT EXISTS ensemble_enabled BOOLEAN NOT NULL DEFAULT TRUE;
