# Liganx pre-VS-wiring backup — 2026-05-11

Snapshot taken before starting **#208 — mutation-aware virtual screening
execution wiring**. Use this folder as the source of truth for rolling
production back to the state recorded here.

## What's captured

| Artifact | File | Notes |
|---|---|---|
| Git SHA at backup time | `git_sha.txt` | `5e13803` — Liganx AI Beta hotfix landed |
| Frontend bundle hash | `frontend_bundle.txt` | `index-Bu2Oi-m1.js` (v1.13.2) |
| Backend /health response | `health.json` | confirms deployed SHA |
| Fly secret names + digests | `fly_secrets_list.txt` | 29 secrets — values stay in Fly Vault |
| Annotated git tag | (remote) | `backup-pre-VS-wiring-2026-05-11` pushed to origin |
| Logical DB dump | — | **NOT captured locally** — see below |

## Why there's no local pg_dump

The Liganx Supabase project (`szvvxaknmmterxliqjfz`) has Network
Restrictions enabled — only Fly's IP range can reach the Postgres
pooler. Both `pg_dump` (PG 17.9 client) and `psycopg2` were
silently rejected at TLS handshake from outside Fly. That's the
right security posture for production; it just means the backup
must run from a machine inside the allowlist.

**This is fine.** The Liganx DB is protected by Supabase's built-in
automatic backups, which run on every paid tier:

- **Daily snapshots** kept for 7 days (Free), 14 days (Pro), 30 days
  (Team). Restorable via the Supabase dashboard → Database → Backups.
- **Point-in-time recovery** to any second within the retention window
  (Pro tier and above) via the same UI.

If you absolutely need a local logical dump before any future change,
either (a) temporarily add your IP to Network Restrictions in the
Supabase dashboard, or (b) run the included `dump_via_psycopg2.py`
from a Fly machine after `flyctl ssh console -a liganx-api`.

## Rollback paths

### Frontend
```bash
# Revert via Vercel dashboard → Deployments → find the deploy tagged
# 5e13803 → Promote to Production. OR via CLI:
vercel rollback <deployment-id>
# OR via git:
git reset --hard backup-pre-VS-wiring-2026-05-11
git push --force origin main   # triggers a fresh Vercel build
```

### Backend (code)
```bash
git reset --hard backup-pre-VS-wiring-2026-05-11
git push --force origin main   # GitHub Actions auto-redeploys to Fly
# verify: curl -s https://api.liganx.com/health
```

If a single bad release is on Fly and you need to roll back the IMAGE
without re-pushing code:
```bash
flyctl releases list -a liganx-api
flyctl releases rollback <release-number> -a liganx-api
```

### Backend (Alembic migration)
After the VS-wiring branch runs `alembic upgrade head` on prod:
```bash
# Current head (record before changes — capture via /admin/db/version
# endpoint if it exists, otherwise via flyctl ssh):
#   alembic current
#
# Roll back one migration:
flyctl ssh console -a liganx-api -C "cd /app && alembic downgrade -1"
# Roll back to a specific revision:
flyctl ssh console -a liganx-api -C "cd /app && alembic downgrade <rev>"
```

### Database (point-in-time)
1. Supabase dashboard → Project → Database → Backups
2. Pick the timestamp just before the bad write
3. Restore — Supabase creates a new project; manually flip the
   `DATABASE_URL` secret on Fly to the restored project's URL
4. Verify: `curl -s https://api.liganx.com/health` then exercise a job
   list to confirm data integrity

### Pod (RunPod)
Current production pod ID is in Fly secret `RUNPOD_POD_ID` (digest
`b1d700101a1c2532`). If a deploy somehow misconfigures the pod, the
auto-resume watchdog brings it back; no manual rollback needed.

## Verification commands

```bash
# Code state matches this backup:
git log -1 backup-pre-VS-wiring-2026-05-11
# Production currently deployed:
curl -s https://api.liganx.com/health | jq .git_sha
# Frontend deployed:
curl -s https://liganx.com/ | grep -oE 'index-[A-Za-z0-9_-]+\.js'
# Fly secrets unchanged:
flyctl secrets list -a liganx-api
```

## What changes after this point

Implementation work begins on **#208 — Δ-vs-WT ranking + selectivity
score for mutation-aware virtual screening**. The likely surface area:

- `backend/src/deltadock/services/screening_runner.py` — new ranking
  pass after docks complete (compute selectivity_index per compound)
- `backend/src/deltadock/models.py` — possibly add a ranking column to
  `ScreeningResult` (would require an Alembic migration)
- `backend/src/deltadock/routers/screening.py` — new GET endpoint for
  ranked results
- Frontend additions for #209-#211 will follow

Anything that touches the schema will get its own Alembic revision so
rollback is single-command.
