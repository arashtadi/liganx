# DeltaDock

A web platform where users pick a protein mutation and a set of compounds, and the system automatically generates the mutant structure, docks the compounds against both wild-type and mutant, and returns a clear visual comparison showing whether each compound prefers the mutant.

The wedge: nobody else does mutation-aware docking + WT-vs-mutant selectivity matrix + plain-English interpretation in one product. Schrödinger's FEP+ Residue Mutation does it for $100k+/year. We're building the $0–500/year version.

See [`mutation-docking-platform-concept.pdf`](./mutation-docking-platform-concept.pdf) for the full product concept and [`competitive-landscape-and-pain-points.md`](./competitive-landscape-and-pain-points.md) for the competitive research that informed the build plan.

---

## Repository layout

```
DockingOnline/
├── frontend/          # React + Vite + TypeScript + Tailwind
├── backend/           # FastAPI + SQLModel + Celery
├── pipeline/          # Python docking pipeline (Vina, FoldX, ProLIF)
├── infra/             # docker-compose, deployment configs
├── docs/              # (existing concept doc + research lives at repo root)
├── .env.example       # template for required environment variables
└── README.md
```

---

## Phased build plan

### Phase 1 — Scaffold + first end-to-end docking (weeks 1–2)
- [x] Repo scaffolding
- [ ] React shell with mutation picker, compound input, results placeholder
- [ ] FastAPI backend with `/jobs` endpoints (SQLite for dev)
- [ ] Local Vina pipeline: PDB ID + SMILES → docking score
- [ ] First happy path: EGFR T790M + osimertinib SMILES → real Vina score returned to frontend

### Phase 2 — RunPod integration + selectivity matrix (weeks 3–4)
- [ ] Celery + Redis job queue
- [ ] RunPod CPU-spot worker for docking jobs
- [ ] Postgres (Neon) replaces SQLite
- [ ] Cloudflare R2 for structures and pose files
- [ ] Selectivity matrix UI: N compounds × M mutants, sortable, color-coded by ΔΔ-score

### Phase 3 — Mutation pipeline + visualization (weeks 5–6)
- [ ] FoldX BuildModel for mutant structures (Tier 2 of the concept doc)
- [ ] PDBFixer for receptor cleanup
- [ ] Mol* synced 3D viewer (WT + mutant side-by-side)
- [ ] ProLIF interaction fingerprints
- [ ] Plain-English interpretation generator
- [ ] Pre-curated clinical mutation library (EGFR T790M/L858R/C797S, KRAS G12C/G12D, BRAF V600E, IDH1 R132H, ABL T315I)

### Phase 4 — Auth, billing, deploy (weeks 7–8)
- [ ] Magic-link email auth (Resend)
- [ ] Stripe billing (Free / Pro / Team tiers)
- [ ] Frontend deployed to Vercel
- [ ] Backend deployed to Fly.io
- [ ] Public landing page with pre-computed hero results
- [ ] Waitlist capture for inbound interest

### Phase 5+ — Differentiators
- [ ] Browser-only Vina (WebAssembly) for privacy-conscious biotechs
- [ ] Optional ML engine (Uni-Mol V2 or Boltz-2) as a "fast mode"
- [ ] PoseBusters confidence ribbon on every pose
- [ ] CSV export of selectivity matrix
- [ ] Public API for power users

---

## Stack

**Frontend**
- React 18 + Vite 5 + TypeScript
- Tailwind CSS v3
- React Router v6
- TanStack Query (server state)
- Mol* (3D protein viewer)
- Future: Ketcher or JSME for ligand drawing

**Backend**
- FastAPI + Uvicorn
- SQLModel (ORM, dev) → Postgres (Neon, prod)
- Celery + Redis for job queueing
- Pydantic v2 for schemas

**Pipeline**
- AutoDock Vina (default docking engine, CPU)
- Meeko (PDBQT prep)
- RDKit (SMILES → 3D conformer)
- PDBFixer (receptor cleanup)
- FoldX BuildModel (mutation building, Phase 3)
- ProLIF (interaction fingerprints, Phase 3)
- Open Babel (format conversion)

**Infra**
- RunPod CPU spot instances (compute)
- Cloudflare R2 (object storage, S3-compatible)
- Neon (managed Postgres)
- Upstash Redis (managed Redis)
- Vercel (frontend hosting)
- Fly.io (backend + Celery workers)
- Resend (transactional email)
- Stripe (billing)

---

## Local development

Prerequisites: Node 20+, Python 3.11+, Docker Desktop.

```bash
# 1. Bring up local Postgres + Redis
docker compose -f infra/docker-compose.dev.yml up -d

# 2. Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e .
uvicorn deltadock.main:app --reload --port 8000

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev   # http://localhost:5173

# 4. Optional: docking worker (new terminal)
cd backend
celery -A deltadock.worker worker --loglevel=info
```

Copy `.env.example` to `.env` and fill in any keys you have. For Phase 1, all you need is the defaults.

---

## What's still needed from Arash

| # | Item | When | How to provide |
|---|---|---|---|
| 1 | Domain registered | Phase 1 | Buy `deltadock.bio` or `.io` on Cloudflare/Porkbun |
| 2 | GitHub repo created | Phase 1 | Create empty repo, share URL |
| 3 | RunPod API key | Phase 2 | Sign up at runpod.io, paste into `.env` (don't share in chat) |
| 4 | Neon Postgres URL | Phase 2 | Create free project at neon.tech, paste `DATABASE_URL` into `.env` |
| 5 | Cloudflare R2 keys | Phase 2 | Create R2 bucket, paste `R2_*` keys into `.env` |
| 6 | Upstash Redis URL | Phase 2 | Create free DB at upstash.com, paste `REDIS_URL` into `.env` |
| 7 | FoldX academic license | Phase 3 | Apply at foldxsuite.crg.eu — 24h turnaround |
| 8 | Resend API key | Phase 4 | Sign up at resend.com, paste `RESEND_API_KEY` into `.env` |
| 9 | Stripe account + keys | Phase 4 | Activate Stripe, paste `STRIPE_*` keys into `.env` |

Status: see `STATUS.md` (created as we go).

---

## License

TBD — likely AGPL for the core platform with a commercial license for hosted deployment.
