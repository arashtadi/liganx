# DeltaDock backend

FastAPI + SQLModel + Celery (Phase 2). Phase 1 runs jobs in-process with a placeholder scorer so the frontend can be built end-to-end before the real Vina pipeline lands.

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e .[dev]
uvicorn deltadock.main:app --reload --port 8000
```

Then open http://localhost:8000/docs for the auto-generated API docs.

## Endpoints (Phase 1)

- `GET  /health` — version + env
- `POST /jobs`   — submit a docking job
- `GET  /jobs`   — list recent jobs
- `GET  /jobs/{id}` — get job + results

## Layout

```
src/deltadock/
├── main.py              # FastAPI app + lifespan
├── config.py            # Pydantic Settings
├── db.py                # SQLModel engine + session
├── models.py            # Job, Compound, DockingResult
├── schemas.py           # API request/response models
├── routers/
│   └── jobs.py          # /jobs endpoints
└── services/
    └── runner.py        # Background job runner (placeholder for Phase 1)
```

## Tests

```bash
pytest
```
