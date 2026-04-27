# DeltaDock build status

## Phase 1 — Scaffold + first end-to-end docking

| Item | Status | Notes |
|---|---|---|
| Repo scaffolding | ✅ done | Monorepo with `/frontend`, `/backend`, `/pipeline`, `/infra` |
| README + phased plan | ✅ done | See `README.md` |
| `.env.example`, `.gitignore` | ✅ done | All env vars documented |
| FastAPI backend skeleton | ✅ done | Boots, runs jobs in-process with placeholder scorer; smoke-tested |
| Frontend skeleton | ✅ done | React + Vite + Tailwind builds clean (~70 KB gzipped) |
| Selectivity matrix component | ✅ done | Sortable, color-coded by Δ-score, CSV export |
| Pipeline package | ✅ done | `fetch_pdb` (verified against RCSB), `parse_vina_log` (tested), `dock_one` (needs Vina binary) |
| Docker Compose dev infra | ✅ done | Postgres 16 + Redis 7 |
| **Wire pipeline into backend runner** | ⏳ next | Replace placeholder in `services/runner.py` with real `dock_one` call |
| **Pre-curated mutation library** | ⏳ next | EGFR / KRAS / BRAF / IDH1 / ABL — pocket boxes + canonical SMILES |

## Phase 2 — RunPod + selectivity matrix at scale

Not started. Blocked on:
- RunPod API key
- Neon Postgres URL
- Cloudflare R2 credentials
- Upstash Redis URL

## Phase 3 — Mutation pipeline

Not started. Blocked on:
- FoldX academic license (apply at [foldxsuite.crg.eu](https://foldxsuite.crg.eu/))

## Phase 4 — Auth, billing, deploy

Not started. Blocked on:
- Domain registered (deltadock.bio or .io)
- GitHub repo location
- Resend + Stripe accounts

## How to verify locally

```bash
# Backend
cd backend
pip install -e .[dev]
uvicorn deltadock.main:app --reload --port 8000
# → http://localhost:8000/docs

# Frontend (new terminal)
cd frontend
npm install
npm run dev
# → http://localhost:5173

# Submit a job from the UI:
# 1. Click "New job"
# 2. Defaults are EGFR (1M17) + T790M, L858R, C797S + 3 known compounds
# 3. Click "Run docking" → redirected to job page
# 4. Selectivity matrix populates within ~1s (placeholder scorer for now)
```

## Tested

- ✅ Backend `/health` returns 200 with version
- ✅ `POST /jobs` creates a job, persists compounds, runs the background task
- ✅ `GET /jobs/{id}` returns the job with WT + mutant results once the runner finishes
- ✅ Frontend builds without TypeScript errors
- ✅ Pipeline `fetch_pdb` downloads 1M17 from RCSB (252 KB)
- ✅ Pipeline `parse_vina_log` extracts modes from sample log
