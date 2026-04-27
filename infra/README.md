# Infra

## Local development

```bash
docker compose -f infra/docker-compose.dev.yml up -d
```

Brings up:
- **Postgres 16** on `localhost:5432` (user/pass/db all `deltadock`)
- **Redis 7** on `localhost:6379`

Connection strings for `.env`:

```
DATABASE_URL=postgresql+psycopg://deltadock:deltadock@localhost:5432/deltadock
REDIS_URL=redis://localhost:6379/0
CELERY_BROKER_URL=redis://localhost:6379/1
CELERY_RESULT_BACKEND=redis://localhost:6379/2
```

For Phase 1 you can ignore both — the backend defaults to SQLite and runs jobs in-process.

## Production deploy targets (Phase 4)

| Layer       | Service              | Why |
|-------------|----------------------|-----|
| Frontend    | Vercel               | Free hobby tier, zero config for Vite |
| Backend API | Fly.io               | Cheap, supports always-on Celery workers |
| Workers     | Fly.io machine pool  | Auto-scale based on Redis queue depth |
| Compute     | RunPod CPU spot      | $0.10–0.20/hr — Vina is CPU-bound |
| Postgres    | Neon                 | Free tier, branching for staging |
| Redis       | Upstash              | Pay-per-request, Celery-compatible |
| Storage     | Cloudflare R2        | S3 API, no egress fees |
| Email       | Resend               | 3k/month free, simplest API |
| Billing     | Stripe               | Standard |
