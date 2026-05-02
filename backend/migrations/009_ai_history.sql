-- Migration 009: ai_history JSONB column on user_compound
--
-- Why this exists: when users iterate on a compound in the AI sidebar,
-- they get a stream of suggestions (each with rationale + warnings).
-- Today every new suggestion replaces the previous one in the UI, so
-- chemists who want to compare "the morpholine swap" against "the
-- alkyne linker" have to re-ask. This column persists the last 10
-- suggestions per saved compound so opening the compound days later
-- restores the full conversation.
--
-- Shape (each entry):
--   { "id":          "<ulid-or-uuid>",
--     "ts":          "<ISO 8601>",
--     "instruction": "<user's prompt>",
--     "smiles":      "<suggested SMILES>",
--     "rationale":   "<one-sentence explanation>",
--     "warnings":    ["<warning>", ...],
--     "flag":        null | "star" | "reject" }
--
-- Capacity: capped client-side at 10 entries per compound. Starred
-- entries are protected from auto-prune (the oldest unstarred entry
-- is dropped when the 11th lands). At ~500 bytes per entry this is
-- ~5 KB per compound — comfortably small.
--
-- Default '[]'::jsonb so existing rows don't need a backfill and the
-- frontend can treat the column as always-present.

BEGIN;

ALTER TABLE public.user_compound
    ADD COLUMN IF NOT EXISTS ai_history JSONB NOT NULL DEFAULT '[]'::jsonb;

-- We don't index this — queries are always "fetch one compound by id"
-- and the array is consumed wholesale in the UI. If we ever need to
-- search across all of a user's AI history (e.g. "find every time I
-- starred a Ponatinib-style suggestion"), we'd add a GIN index then.

COMMIT;

-- Rollback (run manually if needed):
-- BEGIN;
--   ALTER TABLE public.user_compound DROP COLUMN IF EXISTS ai_history;
-- COMMIT;
