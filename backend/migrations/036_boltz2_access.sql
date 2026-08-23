-- 036_boltz2_access.sql
-- Per-feature access flag for AI Resistance Prediction (Boltz-2).
--
-- Mirrors the account-level access_status flow (migration 029) but scoped to
-- one feature. Unlike account access (which now auto-approves on signup), the
-- Boltz-2 engine stays request-and-approve: a user taps "Request access" in the
-- Studio, which fires the operator's Telegram Approve/Deny ping + admin email;
-- tapping Approve (routers/telegram_webhook.py, approve_bz2 callback) flips this
-- column. Admins (ADMIN_EMAIL) always pass without a row.
--
-- boltz2_access values:
--   NULL        — never requested (default). Studio shows "Request access".
--   'requested' — awaiting operator decision. Studio shows "Pending".
--   'approved'  — engine=boltz2 allowed on POST /jobs. Studio shows the button.
--   'denied'    — request declined. Studio shows a contact link.
--
-- Additive, idempotent, no backfill — existing users are untouched (NULL) and
-- simply see the request CTA the first time they open the feature.

ALTER TABLE public.user_profile
    ADD COLUMN IF NOT EXISTS boltz2_access        TEXT,
    ADD COLUMN IF NOT EXISTS boltz2_requested_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS boltz2_decided_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS boltz2_decided_by    TEXT;
