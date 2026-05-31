-- 030_repend_zombie_approvals.sql
-- Tighten the over-grandfathering from migration 029.
--
-- The 029 backfill set access_status='approved' for every existing user_profile
-- row. That swept in anyone who had ever OAuth-touched the site (which auto-
-- creates a user_profile row via the migration-003 trigger) — including
-- dormant/abandoned accounts that never actually used the system. So a user
-- who "signed up via Google today" was actually re-authenticating a row that
-- predated 029 and got grandfathered.
--
-- This migration re-pends ANY approved row that has zero submitted jobs AND
-- was never explicitly admin-decided. Anyone with real activity (≥1 job in
-- public.job) stays approved — they're a real user we don't want to lock out.
--
-- After this migration:
--   * Users with ≥1 job → still 'approved' (grandfathered correctly).
--   * Users admin-approved via /admin/users/{id}/access or Telegram (have
--     non-null access_decided_at) → still 'approved' (intentional grant).
--   * Everyone else (zombie sign-ups) → 'pending' — they have to be approved
--     before they can submit work.
--
-- Idempotent: re-running this only flips zombies that were re-approved
-- between runs (almost never). The clauses are conservative: never demotes
-- a row that has activity or an explicit decision stamp.

UPDATE public.user_profile p
   SET access_status = 'pending',
       access_decided_at = NULL,
       access_decided_by = NULL
 WHERE access_status = 'approved'
   AND access_decided_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.job j WHERE j.user_id = p.user_id);

-- Belt-and-braces: explicitly approve the admin email so the operator
-- doesn't lock themselves out on the very first deploy. ADMIN_EMAIL is
-- environment-configured at the API layer; the SQL just hardcodes a
-- reasonable allowlist for safety. Anyone else admin can be approved by
-- tapping Approve in Telegram or the upcoming /admin/users page.
--
-- We DON'T set access_decided_by to a real name because this is a
-- migration-time bootstrap; the audit trail starts when an admin decides.
UPDATE public.user_profile p
   SET access_status = 'approved',
       access_decided_at = NOW(),
       access_decided_by = 'migration_030_bootstrap'
  FROM auth.users u
 WHERE p.user_id = u.id
   AND LOWER(u.email) = 'arashtadi83@gmail.com'
   AND p.access_status <> 'approved';
