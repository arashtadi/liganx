# Liganx pre-bigchange snapshot — 2026-04-28

Snapshot taken right before a "big change" experiment. Everything below is
the state of liganx.com at this moment in time. Each artifact below is
self-contained and can be restored independently.

## What's in this folder

```
source.tar.gz       3.5 MB    Full repo working tree (incl. untracked files)
postgres.sql        316 KB    pg_dump of Supabase Postgres (schema + data)
poses.tar.gz        1.3 MB    Fly volume /var/lib/liganx/poses (300 PDBQT files)
RESTORE.md          this file
```

## Production state at snapshot time

| Layer | Pointer |
|---|---|
| Git tag | `pre-bigchange-2026-04-28` (on commit `e3a0414`) |
| Backend on Fly | `git_sha=e3a0414`, app `liganx-api`, `performance-2x` 4 GB iad |
| Frontend on Vercel | aliased to `liganx.com`, deployment `dpl_*` immutable |
| RunPod | always-on Pod, QuickVina2-GPU at `POD_DOCK_URL` (Fly secret) |
| Postgres | Supabase pooler — tables: `job`, `compound`, `dockingresult` |
| Pose storage | Local Fly volume (NOT R2 — code path exists, pose_uris are filesystem) |
| Fly secret names | DATABASE_URL, POD_DOCK_TIMEOUT_S, POD_DOCK_URL, CORS_ORIGINS |

## Rollback procedures

### 1. Code rollback (most common, non-destructive to data)

```bash
cd ~/Documents/Claude/Projects/DockingOnline
git fetch origin --tags
git checkout main
git reset --hard pre-bigchange-2026-04-28
git push --force origin main
```

GitHub Actions will redeploy the backend automatically. For frontend:
```bash
cd frontend && vercel deploy --prod
# Then re-alias to liganx.com via the Vercel API (cross-project pattern)
```

### 2. Code rollback WITHOUT touching git history

The previous immutable production deployments are still alive on Fly and
Vercel — you can re-point the alias without rewriting history.

- **Fly:** `fly releases -a liganx-api` → find the release with `git_sha=e3a0414`, then deploy that exact image.
- **Vercel:** the previous production deployment URL stays active forever. Get its ID with `vercel list` (or from the Vercel dashboard) and re-alias:
  ```bash
  curl -X POST -H "Authorization: Bearer $VERCEL_TOKEN" \
       -H "Content-Type: application/json" \
       -d '{"alias":"liganx.com"}' \
       "https://api.vercel.com/v2/deployments/<DEPLOY_ID>/aliases"
  ```

### 3. Restore the Postgres database

⚠️ Wipes the current production DB and replaces with the snapshot. Only do
this if data has been corrupted; routine code rollbacks shouldn't need this.

```bash
# Strip the SQLAlchemy "+psycopg2" driver suffix that pg_dump/psql don't understand
PG_URL=$(grep ^DATABASE_URL backend/.env | cut -d= -f2- | \
         sed 's/postgresql+psycopg2/postgresql/')

# Restore (dump uses --quote-all-identifiers + --no-owner --no-acl)
psql "$PG_URL" < postgres.sql
```

### 4. Restore pose files (rarely needed — they're derivative)

Re-running affected jobs regenerates poses. Only restore for byte-exact
reproducibility of these specific docked geometries.

```bash
# Push tarball to Fly machine via sftp shell
echo "put poses.tar.gz /tmp/poses.tar.gz" | fly ssh sftp shell -a liganx-api
fly ssh console -a liganx-api -C \
  'sh -c "cd /var/lib/liganx && rm -rf poses && tar -xzf /tmp/poses.tar.gz"'
```

### 5. Restore working directory from tarball

If the local repo gets wedged unrecoverably:
```bash
mkdir -p ~/restore && cd ~/restore
tar -xzf source.tar.gz
diff -r DockingOnline ~/Documents/Claude/Projects/DockingOnline | head
```

The tarball includes untracked files (`vercel.json`, `.env.production`,
`KetcherModal.tsx`, etc.) that aren't on GitHub.

## What is NOT backed up

- **RunPod Pod state.** Stateless container; spin up new from same image and update `POD_DOCK_URL` Fly secret.
- **Fly secret values.** Only their names are recorded above — actual values are managed-by-Fly. If the app is deleted, re-set each secret.
- **DNS records.** GoDaddy A/CNAME for liganx.com → Vercel, api.liganx.com → Fly. Not lost in any normal failure mode.
- **Cloudflare R2 bucket.** Bucket exists but isn't actively serving traffic; pose_uris in DB are filesystem paths.

## Verification checklist (run before declaring rollback successful)

```bash
# Backend
curl -s https://api.liganx.com/health | python3 -m json.tool
# expect: {"status":"ok", "git_sha":"e3a0414", ...}

# Frontend
curl -s https://liganx.com/ | grep -oE 'index-[A-Za-z0-9_-]+\.js'
# bundle hash should match the deployment that includes commit e3a0414

# DB
psql "$PG_URL" -c "SELECT count(*) FROM public.job;"
# row count at snapshot — record now and compare after restore

# RunPod
curl -s -X POST $POD_DOCK_URL/health | head
# expect 200 OK
```
