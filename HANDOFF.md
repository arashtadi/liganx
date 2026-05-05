# Liganx — Project Handoff

> **Read this first if you are picking up this project on a new machine or under a new account.**
>
> Last updated: 2026-05-04 by Arash + Claude (Cowork mode).
> Latest commit on main: `534d4b5` — "Fix: Promote to Full Job button silently no-ops on JobPage editor"
> Production: backend deployed to Fly (`api.liganx.com` git_sha=534d4b5), frontend deployed to Vercel (`liganx.com` bundle `index-DzASYkzG.js`).

---

## 1. What this product is

**Liganx (formerly DeltaDock)** — a web platform where biologists / med-chemists pick a target protein + clinical mutation + a list of compounds, and the platform runs Vina/QuickVina-GPU/GNINA/Boltz-2 docking against both wild-type and mutant receptors, then returns a colour-coded selectivity matrix with PoseBusters validation, ProLIF interaction fingerprints, ΔΔ-score interpretation, and a Maestro-style 3D viewer.

**The wedge:** nobody else does mutation-aware docking + WT-vs-mutant selectivity matrix + plain-English interpretation in one product. Schrödinger's FEP+ Residue Mutation does it for $100k+/year. We are the $0–500/year version.

**Live URLs:**
- Public site: https://liganx.com
- Backend API: https://api.liganx.com (`/health` returns `{status, version, env, git_sha}`)
- Repo: https://github.com/arashtadi/liganx (private, owner: arashtadi)

**Major recent additions** (in roughly reverse chronological order):
- AI compound editor inside Ketcher with Quick Dock + Optimize loop (Claude Haiku 4.5 + parallel sampling, Tier-1 generate-score-filter loop)
- Boltz-2 ML scoring engine (currently paused for cost — see §10)
- GNINA second docking engine (alongside QuickVina2-GPU)
- Per-user free-tier caps + per-user job quota + admin panel
- Validation suite at `/validation` (5/8 PASS positive controls — ABL T315I, EGFR T790M+Gefitinib, BRAF V600E, KIT D816V+Imatinib, BTK C481S+Ibrutinib)
- Public share-links + Library page + Compounds page + History page
- Ketcher-based 2D editor with AI improve/optimize and pose-aware docking

---

## 2. Current state — what's working, what's pending

**Working:**
- End-to-end docking via QuickVina2-GPU on the running RunPod (`final_cyan_leopon-migration`, pod id `4cli33cxvf58lb`) — port 7861
- GNINA on same pod
- Multi-target selectivity matrix (kinome-style)
- Mutation-aware receptor build via PDBFixer.applyMutations()
- ProLIF interaction fingerprints, PoseBusters validation, Vinardo refined scores, OpenMM mutant minimisation
- AI editor: properties + 3D preview + Quick Dock + Optimize loop (3 variants, parallel AI sampling, mutation-targeting)
- Pocket-best 3× retry on every dock (parity between Quick Dock and full jobs)
- Multi-mutation jobs accept "G12R, G12V" syntax — Quick Dock and Optimize both extract first mutation only (PDBFixer chokes on combined applyMutations)
- Promote-to-Full-Job from editor reseeds /new with target+mutations+SMILES

**Paused / gated:**
- Boltz-2 — pod stopped to save ~$497/mo; UI shows "By request" badge. See §10 to re-enable per paid customer.
- FoldX — code path exists (`backend/vendor/foldx/`) but binary not in image; we use PDBFixer.applyMutations() for mutant builds (loses ΔΔG annotation, gains prod-runnable build).

**Pending tasks** (open items):
- `#157` — Privacy policy update for user accounts
- `#282` — Boltz-2 perf: persistent worker with model resident (vs subprocess-per-request, would drop 130s → 20s per cell)
- `#362` — JobPage: WT-vs-mutant selectivity scatter view
- `#363` — R-group decomposition / SAR analysis on JobPage
- `#364` — On-demand property columns on the matrix
- `#365` — Cross-job comparison view

**Latest 4 commits** (all shipped today, 2026-05-04):
```
534d4b5  Fix: Promote to Full Job button silently no-ops on JobPage editor
6369961  Fix Optimize multi-mutation crash: split mutations and use first only
ff14d8d  Quick Dock: handle multi-mutation context (use first mutation)
14136bc  Out-of-pocket fix: bring full-job docking up to Quick Dock parity
```

---

## 3. Architecture & deployment topology

```
                                            ┌─────────────────────────┐
                                            │   liganx.com (Vercel)   │
                                            │   React/Vite frontend   │
                                            └──────────┬──────────────┘
                                                       │ HTTPS
                                                       ▼
                                            ┌─────────────────────────┐
                                            │  api.liganx.com (Fly)   │
                                            │  FastAPI + SQLModel     │
                                            │  app: liganx-api (iad)  │
                                            └─┬───────────┬───────────┘
                                              │           │
                                ┌─────────────▼─┐    ┌────▼─────────────┐
                                │  Supabase     │    │  RunPod GPU pod  │
                                │  (Postgres +  │    │  port 7861       │
                                │   Auth + RLS) │    │  QuickVina2-GPU  │
                                │ szvvxaknmm... │    │  + GNINA         │
                                └───────────────┘    └────┬─────────────┘
                                                          │
                                            ┌─────────────▼─────────────┐
                                            │  Cloudflare R2 (poses,    │
                                            │  receptor caches via Fly  │
                                            │  volume mount)            │
                                            └───────────────────────────┘

                                            ┌─────────────────────────┐
                                            │  Boltz-2 pod (PAUSED)   │
                                            │  port 7862, RTX 4090    │
                                            │  pod yvdrklbbg9qlwa     │
                                            └─────────────────────────┘
```

**Frontend** — `frontend/` — React 18 + Vite 5 + TypeScript + Tailwind v3 + React Router v6 + TanStack Query. Auto-deployed by Vercel on every push to `main`. Project domain `liganx.com`.

**Backend** — `backend/` — FastAPI + SQLModel + Celery + Redis (Redis is Fly app `liganx-redis`). Docker image baked from `Dockerfile` in repo root. Auto-deployed by GitHub Actions (`.github/workflows/fly-deploy.yml`) on every push to `main` that touches `backend/**`, `pipeline/**`, `Dockerfile`, or `fly.toml`.

**Pipeline** — `pipeline/deltadock_pipeline/` — pure-Python wrapper around AutoDock Vina, QuickVina2-GPU, GNINA, Boltz-2, PDBFixer, OpenMM, ProLIF, PoseBusters, Meeko, Vinardo. Imported by both backend (`runner.py`) and pod scripts.

**Pod** — `pod/` — server scripts that run on RunPod:
- `pod/dock_server.py` — HTTP server on port 7861 wrapping QuickVina2-GPU `/dock` and `/dock_batch`
- `pod/gnina_dock_server.py` — GNINA on the same pod
- `runpod/boltz2_server_async.py` — Boltz-2 async server on port 7862

**Database** — Supabase project `szvvxaknmmterxliqjfz` (PostgreSQL + Auth + RLS). Migrations in `backend/migrations/001_*.sql` through `010_optimize_attempt.sql` — apply via `python3 backend/scripts/run_migration_NNN.py` after setting `DATABASE_URL`.

**Storage** — Cloudflare R2 for pose files and shared structures; receptor caches live on Fly volume `/var/lib/liganx/poses/cache/receptors/`.

---

## 4. Required credentials & secrets

To take this project over you will need access to (rotate or transfer):

### GitHub
- Repo: `github.com/arashtadi/liganx` (transfer ownership or invite collaborator)
- **Personal Access Token (PAT)** — fine-grained, Contents:write on the repo. Currently stored at `$HOME/.git-credentials` on the dev machine. Used by both git push from sandbox and `deploy-frontend.sh`.
- A separate PAT with `workflows` scope would be needed to edit `.github/workflows/*.yml` — currently we don't have one.
- **GitHub Actions secrets** (in repo settings → Secrets → Actions):
  - `FLY_API_TOKEN` — used by `.github/workflows/fly-deploy.yml`

### Fly.io
- Account owns two apps: `liganx-api` and `liganx-redis`
- CLI: `flyctl` — auth token via `flyctl auth login`
- **Fly secrets to know about** (`flyctl secrets list -a liganx-api`):
  - `DATABASE_URL` — Supabase Postgres connection string
  - `SUPABASE_URL`, `SUPABASE_JWKS_URL` — for JWT verification
  - `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT` — Cloudflare R2
  - `POD_GPU_URL` — `https://4cli33cxvf58lb-7861.proxy.runpod.net`
  - `BOLTZ2_POD_URL` — `https://yvdrklbbg9qlwa-7862.proxy.runpod.net` (only relevant when Boltz-2 is on)
  - `BOLTZ2_ENABLED` — `false` (currently)
  - `QUICK_DOCK_ENABLED` — `true`
  - `ANTHROPIC_API_KEY` — for AI editor (Claude Haiku 4.5)
  - `ADMIN_EMAIL` — `arashtadi@gmail.com` (gates `/admin`)
  - `RUNPOD_API_KEY` — for serverless burst worker
  - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — contact form + failed-job alerts
  - `TURNSTILE_SECRET` — Cloudflare Turnstile CAPTCHA on contact form
  - `GIT_SHA` — injected at build time, exposed at `/health`

### Vercel
- Project that auto-deploys on push to `main`
- Domain alias `liganx.com` is on this project
- Vercel env vars (in dashboard):
  - `VITE_API_BASE_URL` = `https://api.liganx.com`
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_TURNSTILE_SITE_KEY`
- **VERCEL_TOKEN** for CLI deploys is NOT cached on the Mac — see `feedback_use_desktop_commander.md` for the runbook to mint a fresh one through Chrome MCP when needed. Or just rely on the auto-deploy.

### Supabase
- Project: `szvvxaknmmterxliqjfz`
- Auth providers configured: email/password (working), Google OAuth (working with `prompt=select_account` for forced chooser)
- **Site URL must be `https://liganx.com`** in Supabase dashboard (otherwise OAuth callbacks 404)
- Email templates customized via dashboard (see `email-templates/` for canonical copies)

### RunPod
- Account owns two pods:
  - `final_cyan_leopon-migration` (id `4cli33cxvf58lb`, RTX PRO 4500, $0.65/hr) — **PRODUCTION, running**
  - `fine_brown_toad` (id `yvdrklbbg9qlwa`, RTX 4090, $0.70/hr) — **PAUSED**, idle storage cost ~$0.006/hr
- API key in Fly secret `RUNPOD_API_KEY`
- Pod auto-start: `dockerStartCmd` is set on the production pod so dock_server launches on container boot (commit history task #483)

### Cloudflare R2
- Bucket name in Fly secret `R2_BUCKET`
- Account / API tokens in 1Password (or wherever Arash keeps them)

### Anthropic
- API key in Fly secret `ANTHROPIC_API_KEY`
- Used by AI editor (Improve, Diagnose, Optimize) — Claude Haiku 4.5

### Domain (GoDaddy)
- `liganx.com` DNS:
  - A/AAAA → Vercel
  - `api` → Fly (`liganx-api.fly.dev`)
- Account at GoDaddy

### Telegram
- Bot for contact-form forwarding + failed-job alerts
- Bot token + chat id in Fly secrets

---

## 5. Repo layout (key directories)

```
DockingOnline/
├── README.md                    # Original product concept
├── STATUS.md                    # Older status doc
├── HANDOFF.md                   # ← THIS FILE
├── Dockerfile                   # Backend image (mamba + bio tools)
├── fly.toml                     # Fly app config
├── vercel.json                  # Frontend deploy config
├── deploy-frontend.sh           # Vercel CLI deploy wrapper (needs VERCEL_TOKEN)
│
├── frontend/
│   ├── src/
│   │   ├── pages/               # NewJobPage, JobPage, HistoryPage,
│   │   │                        # CompoundsPage, AdminPage, SettingsPage,
│   │   │                        # SuitePage, ContactPage, ValidationPage,
│   │   │                        # SignInPage, SignUpPage, WelcomePage, etc.
│   │   ├── components/          # KetcherModal (AI editor), SelectivityMatrix,
│   │   │                        # PoseDetail, HeroBanner, RenamePrompt,
│   │   │                        # AiSidebar, DockedPoseViewer, Mol3DPreview,
│   │   │                        # StreamingBanner, etc.
│   │   ├── lib/                 # api client, parseExtra, supabase
│   │   └── App.tsx
│   ├── public/ketcher/          # self-hosted EPAM Ketcher
│   └── README.md
│
├── backend/
│   ├── src/deltadock/
│   │   ├── main.py              # FastAPI app
│   │   ├── auth.py              # JWT verification, current_user, admin_user, verified_user
│   │   ├── catalog.py           # Hard-coded target catalog (KRAS, BRAF, EGFR, etc.) + pocket coords
│   │   ├── models.py            # SQLModel Job, Result, Compound, OptimizeAttempt, etc.
│   │   ├── routers/
│   │   │   ├── jobs.py          # POST /jobs, GET /jobs/{id}, share-link reads
│   │   │   ├── assist.py        # /assist/compound, /quick_dock, /optimize, /properties
│   │   │   ├── admin.py         # /admin/users, /admin/stats
│   │   │   ├── me.py            # /me/profile, /me/compounds (saved library)
│   │   │   ├── lookup.py        # PDB autocomplete, mutation autocomplete, embed-smiles
│   │   │   └── contact.py       # contact-form → Telegram
│   │   └── services/
│   │       ├── runner.py        # Job orchestration (async)
│   │       ├── quick_dock.py    # 3× pocket-best Quick Dock
│   │       ├── pocket_filter.py # Shared 3× retry primitive (used by full jobs too)
│   │       ├── optimize_loop.py # Generate-Score-Filter Optimize loop
│   │       ├── ai_assistant.py  # Anthropic prompt construction
│   │       └── boltz2_*.py      # Boltz-2 client
│   ├── migrations/              # 001 → 010 SQL migrations
│   ├── scripts/
│   │   ├── run_migration_NNN.py # One-shot migration runners
│   │   ├── verify_catalog.py    # CI gate — pocket coords sanity
│   │   └── verify_prep_symmetry.py # CI gate — prevents v5 regression (see §8)
│   └── README.md
│
├── pipeline/
│   ├── deltadock_pipeline/
│   │   ├── prep.py              # PDBFixer fix_pdb, prepare_receptor, verify_mutation_applied
│   │   ├── mutate.py            # build_mutant_pdbfixer (with OpenMM minimisation)
│   │   ├── docking.py           # dock_one (local Vina), dock_one_pod (RunPod)
│   │   ├── docking_gnina.py     # GNINA equivalents
│   │   ├── docking_runpod.py    # Serverless RunPod overflow
│   │   ├── boltz2_*.py          # Boltz-2 dispatch + sequence extraction + pocket-residues
│   │   ├── prolif_runner.py     # ProLIF subprocess (RDKit segfault isolation)
│   │   ├── posebusters_runner.py
│   │   ├── water.py             # Crystallographic water displacement (Phase 0)
│   │   └── strain.py            # Pose strain energy
│   └── README.md
│
├── pod/                         # Scripts running on the GPU pod
│   ├── dock_server.py           # QuickVina2-GPU server (port 7861)
│   ├── gnina_dock_server.py
│   └── GNINA_INSTALL.md
│
├── runpod/                      # Boltz-2 pod scripts
│   ├── boltz2_server_async.py
│   ├── BOLTZ2_INSTALL.md
│   └── README.md
│
├── infra/                       # docker-compose for local dev, etc.
├── docs/                        # Design docs (foldx, water, boltz2, celery, v5 postmortem)
├── case_studies/                # BRAF V600E + Vemurafenib writeup, etc.
├── competitor_research/         # Survey docs from initial research
├── email-templates/             # Supabase email customizations
├── skills/                      # Cowork skills (medchem-phd, liganx-site-monitor)
└── .github/workflows/           # fly-deploy.yml, refresh-validation.yml, etc.
```

---

## 6. Local development setup (new machine)

```bash
# 1. Clone
git clone https://github.com/arashtadi/liganx.git DockingOnline
cd DockingOnline

# 2. Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
# Set up .env with DATABASE_URL pointing to a dev Postgres or Supabase
cp .env.example .env  # then edit
uvicorn deltadock.main:app --reload --port 8000

# 3. Frontend (in a separate terminal)
cd frontend
npm install
cp .env.example .env  # edit VITE_API_BASE_URL, VITE_SUPABASE_*
npm run dev  # http://localhost:5173

# 4. Pipeline (used by backend tests)
cd pipeline
pip install -e .
# AutoDock Vina must be installed locally for dev docking — see README
```

For prod-like local docking you can point `POD_GPU_URL` at the live RunPod proxy URL (it's safe — auth is via JWT). For full local stack including Vina, OpenMM, PDBFixer, Meeko, ProLIF, PoseBusters: build the Dockerfile locally — `docker build -t liganx-api .` then `docker run -p 8000:8000 liganx-api`.

---

## 7. How to deploy

**Backend (any change under `backend/**`, `pipeline/**`, `Dockerfile`, `fly.toml`):**
```bash
git add . && git commit -m "..." && git push origin main
# GitHub Actions auto-runs fly-deploy.yml; takes 1-2 min
# Verify: curl https://api.liganx.com/health  (git_sha should match git rev-parse --short HEAD)
```

**Frontend (any change under `frontend/**`):**
- Auto-deployed by Vercel on push to `main`
- Manual: `./deploy-frontend.sh` (needs `VERCEL_TOKEN` env var)
- Verify: `curl -sL https://liganx.com | grep -oE "/assets/index-[^.]+\.js"` — bundle hash should change

**Pod (rare — only when changing `pod/dock_server.py`):**
- SSH into the running pod via RunPod console
- Update the file (or `gh api repos/arashtadi/liganx/contents/pod/dock_server.py --jq .download_url` then curl with token, since the repo is private)
- Restart: `kill -9 $(pgrep -f dock_server); cd /workspace && nohup python3 dock_server.py > server.log 2>&1 &`
- The `dockerStartCmd` is baked in so a full pod restart from RunPod console also works

**Database migration (new SQL file in `backend/migrations/`):**
```bash
flyctl ssh console -a liganx-api -C "python3 /app/scripts/run_migration_NNN.py"
```

---

## 8. Critical "do not break this" knowledge

These are non-obvious gotchas the next operator MUST know. Reproducing them by accident would re-cause production incidents that took hours to debug.

### 8.1 PDBFixer must NOT renumber residues
`prep.py::fix_pdb` strips HETATM records BEFORE PDBFixer runs, and explicitly sets `missingResidues={}` so `addMissingAtoms` can never insert gap-filler residues. Without this, "D835V" stops pointing to FLT3 Asp 835 and FoldX/applyMutations silently mutates the wrong residue → identical WT/mutant scores → user thinks platform is broken.

The trap: **obabel ALSO renumbers residues** when converting PDB→PDBQT. Vina/GNINA don't care (they read coordinates), but our verifier MUST read the `.clean.pdb` file (preserved numbering), NEVER the `.pdbqt`.

### 8.2 WT receptor must NOT be minimised
We tried symmetric WT+mutant minimisation (v5 experiment, 2026-05-01) and it regressed validation 5/8 → 2/8 PASS. Reverted same day. WT comes from a crystal structure (already a low-energy minimum); mutant comes from `applyMutations` (needs minimisation to fix bond-length errors and side-chain clashes). The asymmetry is intentional and load-bearing.

CI gate at `backend/scripts/verify_prep_symmetry.py` will fail the build if symmetric prep is reintroduced. Full postmortem at `docs/v5_postmortem.md`.

If a future audit suggests this should be made symmetric: don't do it. The right answer is per-target opt-outs (`Target.minimize_mutant=False`, currently set only for BRAF V600E because its activation-loop biology was unstable under minimisation).

### 8.3 Multi-mutation jobs need first-mutation extraction
Jobs with `mutations="G12R, G12V"` cannot be passed to PDBFixer.applyMutations as `['GLY-12-ARG', 'GLY-12-VAL']` — same residue can't be mutated to two things at once, PDBFixer segfaults (exit 139), worker dies, Fly returns "hyper error", UI shows error.

Fix is in three places — keep them in sync:
- Frontend `KetcherModal.tsx` — `firstMutation` derivation, used in 4 call sites
- Backend `assist.py::quick_dock_endpoint` — `safe_mutation` split
- Backend `assist.py::optimize_endpoint` — `safe_mutations` split

### 8.4 PDBQT cache integrity check
`prep.py::prepare_receptor` validates every line of obabel output against allowed PDBQT record-type prefixes. If obabel emits a malformed line, `.prep_version` is NOT stamped and the file is unlinked — otherwise the broken file gets cached forever. 2026-04-30 prod outage was caused by exactly this; commit `01cd66d` is the fix.

### 8.5 Catalog pocket coordinates must match co-crystal ligand centroid
6 catalog entries had wrong pocket coords (IDH1 was 50 Å off, ABL 34 Å off). Fixed 2026-04-28 in commit `c9bd143`. CI gate `backend/scripts/verify_catalog.py` enforces this — it downloads each catalog PDB, finds the biggest non-noise HETATM, computes its centroid, and fails if the catalog `pocket.center` doesn't match.

When adding a new target: run `verify_catalog.py` locally first. It WILL catch a wrong pocket.

### 8.6 Raw SQL in routers — three Liganx-specific gotchas
1. **`jobstatus` enum is UPPERCASE** in Postgres. `j.status IN ('pending','running')` fails. Use UPPERCASE literals or use the ORM.
2. **`auth.users.id` and `job.user_id` are UUID**, not text. Don't `::text`-cast either side in column-to-column comparisons. Bound parameters auto-coerce string→uuid (so `WHERE j.user_id = :uid` with a Python string works).
3. **`text` must be imported from `sqlalchemy`**, not sqlmodel. NameError manifests at request time, not import time.

### 8.7 OpenMM mutant minimisation is per-target opt-outable
`Target.minimize_mutant: bool = True` in `backend/src/deltadock/catalog.py`. Currently `False` only for BRAF V600E. If a new target produces nonsense mutant scores, suspect activation-loop biology and try opt-out before assuming Vina is broken.

### 8.8 Optimize loop SA score calibration
Claude Haiku over-predicts SA score by ~2.5–3 units on Imatinib-class kinase scaffolds (predicts 3.8–4.9, actual 1.4–1.5). Don't tighten `MAX_PREDICTED_SA_SCORE` below 6.0 — it would reject too many valid designs.

### 8.9 Cloudflare 100s edge timeout on RunPod proxy
Any sync request to a RunPod pod via `*.proxy.runpod.net` that takes >100s gets a 524. This is why Boltz-2 had to switch to async polling (`/predict_boltz2_async` returns 202 + job_id; client polls every 5s). Don't introduce new sync endpoints that can take >90s.

### 8.10 RunPod bot detection on Python User-Agent
`Python-urllib/3.x` UA gets blocked with Cloudflare 1010. Set `User-Agent: Liganx/1.0` on every urllib call to RunPod.

---

## 9. Memory files — separate but important

This project relies on **Claude's per-space memory files**, which live OUTSIDE the repo at:

```
/Users/arash/Library/Application Support/Claude/local-agent-mode-sessions/
  7763ef6a-1e56-4080-98c7-5e6a920b0468/
  600f54aa-9363-4ae5-a60b-51e4b1a118ef/
  spaces/63ae16c8-19ce-47ca-8e17-51f398ef8a21/
  memory/
```

There are **15 files** in there (1 index + 14 individual memories) covering:
- CI/CD setup details
- Phase-1 auth shipped state
- Sandbox git limitations + Desktop Commander preference
- Pipeline correctness invariants
- PDBFixer renumbering bug postmortem
- Validation page state
- Boltz-2 wiring + cost gating
- PDBQT cache integrity
- Admin panel + quotas
- Raw SQL pitfalls
- WT-minimisation reversal lesson
- Optimize SA calibration drift

**To migrate to a new account/machine:**
1. Copy the entire `memory/` directory above to the equivalent path on the new machine. Cowork will pick it up automatically when the new account opens this project folder.
2. **OR** copy just the contents of those 15 memory files into the new account's MEMORY.md and adjacent files. Most of the content is already paraphrased into §8 above; the memory files have more detail and richer "why" explanations.

If the new operator is a human (not Claude), §8 covers the load-bearing knowledge from those memories. The full files have more nuance about historical incidents and postmortems.

---

## 10. Cost & infrastructure notes

**Monthly burn (approximate, 2026-05-04):**
- RunPod production pod (`final_cyan_leopon-migration`, RTX PRO 4500, always-on): **~$470/mo** at $0.65/hr
- Boltz-2 pod (`fine_brown_toad`, paused): **~$4/mo** idle storage only (was $497/mo when on)
- Fly.io (liganx-api + liganx-redis): **~$15-30/mo** depending on traffic
- Vercel Hobby tier: **$0/mo**
- Supabase Free tier: **$0/mo** (will need Pro at ~$25/mo when traffic scales)
- Cloudflare R2: **<$1/mo** at current pose volume
- Anthropic API: **<$5/mo** at current AI editor traffic
- Domain (GoDaddy): **~$15/year**

**Total: ~$500/mo currently, mostly the production GPU pod.**

**Cost-cutting options:**
- Switch production pod to RunPod serverless (pay-per-second). The serverless burst worker image already exists at `ghcr.io/arashtadi/liganx-runpod-worker`. Cold start is ~30s. Would eliminate ~$470/mo always-on cost but adds ~30s to every quiet-period request.
- Keep Boltz-2 paused unless a paying customer asks.

**Re-enabling Boltz-2 for a paying customer:**
1. `flyctl secrets set BOLTZ2_ENABLED=true --app liganx-api`
2. Wake `fine_brown_toad` from RunPod console (Start button)
3. Wait ~3-4 min (30s pod boot + 2-3 min Boltz-2 model load)
4. Verify: `curl https://yvdrklbbg9qlwa-7862.proxy.runpod.net/health` returns 200 with `model_loaded:true`
5. Optionally flip the engine-card badge in `NewJobPage` from "By request" back to "Beta"

---

## 11. Backups & rollback

Multiple snapshot tarballs and SQL dumps exist in `~/Documents/Claude/Projects/DockingOnline-backups/`:
- `2026-04-28-pre-bigchange/` — before Phase-1 auth migration
- `pre-mascot/` — before mascot/branding work
- `pre-burst/` — before serverless burst worker
- `pre-aiassist/` — before AI editor work
- `pre-symmin/` — before v5 minimisation experiment
- `pre-dockaware/` — before docking-aware AI

Each has: `source.tar.gz`, `postgres.sql`, `poses.tar.gz` (or R2 inventory), and `RESTORE.md` with step-by-step rollback.

Git tags also mark each snapshot point — `git tag | grep pre-` to list.

---

## 12. Where to look for things

| Topic | File / location |
|---|---|
| AI editor (Quick Dock, Optimize, Improve) | `frontend/src/components/KetcherModal.tsx`, `backend/src/deltadock/routers/assist.py`, `backend/src/deltadock/services/optimize_loop.py` |
| Job orchestration | `backend/src/deltadock/services/runner.py` |
| Pocket-best 3× retry | `backend/src/deltadock/services/pocket_filter.py` |
| Mutant receptor build | `pipeline/deltadock_pipeline/mutate.py`, `prep.py` |
| Selectivity matrix UI | `frontend/src/components/SelectivityMatrix.tsx` |
| 3D viewer | `frontend/src/components/HeroBanner.tsx`, `DockedPoseViewer.tsx` |
| Pose detail panel | `frontend/src/components/PoseDetail.tsx` |
| Catalog (targets + pockets + mutations) | `backend/src/deltadock/catalog.py` |
| Auth + JWT verification | `backend/src/deltadock/auth.py` |
| Validation suite | `backend/scripts/run_validation.py`, `frontend/src/pages/ValidationPage.tsx`, `.github/workflows/refresh-validation.yml` |
| Pod servers | `pod/dock_server.py`, `pod/gnina_dock_server.py`, `runpod/boltz2_server_async.py` |
| Migrations | `backend/migrations/001_*.sql` through `010_*.sql` |
| Skills (medchem-phd, site-monitor) | `skills/` |
| Site monitor reports | `site-monitor-reports/YYYY-MM-DD.md` |

---

## 13. How to keep building

If the next operator is a Claude agent in Cowork mode, the simplest path is:

1. Open this project folder (`/Users/arash/Documents/Claude/Projects/DockingOnline` or wherever it lands on the new machine).
2. Copy the memory files (§9) into the new account's memory directory.
3. Read this HANDOFF.md, then `STATUS.md`, then the per-area `README.md` files.
4. Test locally that you can `git pull` + push (need PAT in `~/.git-credentials`).
5. Test that the live site works (open `https://liganx.com`, sign in, run a Quick Dock).

If the next operator is a human:
1. Read this HANDOFF.md end-to-end.
2. Get the credentials transferred (GitHub repo ownership, Fly account, Vercel account, Supabase project, RunPod account, Cloudflare R2, Anthropic API key, GoDaddy domain).
3. Try a Quick Dock on the live site. Then try the AI Optimize loop. Then try a full job.
4. Read `docs/v5_postmortem.md` and `project_pdbfixer_renumbering_bug.md` (in memory dir) — those two are the highest-stakes "do not redo this mistake" lessons.

**Suggested first improvements** (based on user feedback during the last session):
- Ship the Boltz-2 perf improvement (#282) so it can be re-enabled cheaply
- Add the WT-vs-mutant scatter view (#362) — visually clearer than the matrix for some workflows
- Investigate moving the production pod to serverless for cost reasons (~$470/mo savings)
- Privacy policy update (#157) — was deferred but should ship before any paid customer

---

## 14. Contact

Owner: **Arash Tadi** — arashtadi@gmail.com
GitHub: **arashtadi**

If you're taking this over and need context on anything not covered here, the conversation transcripts in `~/Library/Application Support/Claude/local-agent-mode-sessions/.../projects/.../*.jsonl` have the full reasoning behind every commit.

Good luck. The pipeline works, the site is live, the science is honest. Don't ship symmetric WT minimisation. Don't break the catalog pocket coords. Use Desktop Commander for git ops.
