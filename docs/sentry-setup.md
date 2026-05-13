# Sentry setup — wake-up checklist

The SDK is wired on both frontend and backend. It's a no-op until you set
DSN env vars. ~5 minutes once you have a Sentry account.

## 1. Create the Sentry project

1. Sign up / log in at https://sentry.io (free tier covers ~5k events/month).
2. Create an organization (e.g. `liganx`).
3. Create **two** projects:
   - **liganx-frontend** — platform: React
   - **liganx-backend** — platform: Python / FastAPI
4. Copy each project's DSN. Format: `https://abc123@o456.ingest.sentry.io/789`.

## 2. Frontend (Vercel)

```bash
# From the repo root:
cd frontend
# Set the env var in Vercel. Either via the dashboard
# (Project → Settings → Environment Variables) or:
vercel env add VITE_SENTRY_DSN production
# Paste the liganx-frontend DSN when prompted.

# Trigger a re-deploy to bake it in:
bash ../deploy-frontend.sh
```

That's it for the frontend. Errors caught by `<ErrorBoundary>`,
unhandled exceptions, and unhandled promise rejections all flow to
Sentry, tagged with the route name from `withBoundary()` in
`src/App.tsx`.

## 3. Backend (Fly.io)

```bash
# From the repo root:
flyctl secrets set SENTRY_DSN='https://...@o....ingest.sentry.io/...' \
  --app liganx-backend

# Fly will roll out a new deploy with the secret. No code change.
```

The backend SDK is initialized in `backend/src/deltadock/main.py` with
both the FastAPI and SQLAlchemy integrations enabled, so 500-class
errors, slow queries, and unhandled exceptions in route handlers all
get reported.

## 4. Smoke-test

Frontend: open the browser console on the deployed site and run:

```js
throw new Error("sentry smoke test");
```

You should see the event arrive in Sentry within ~30 seconds.

Backend: hit a deliberately broken endpoint (or curl `/_debug/error`
if it exists). Same — should appear in the backend project.

## What gets captured

**Frontend:**
- Render exceptions caught by `<ErrorBoundary>` (per route, tagged)
- Unhandled JavaScript errors (window.onerror)
- Unhandled promise rejections
- 10% sample of performance traces

**Backend:**
- HTTP 5xx responses
- Unhandled exceptions in route handlers
- Slow SQLAlchemy queries (over the default threshold)
- 10% sample of performance traces

**Not captured (by design):**
- HTTP 4xx (these are user errors, not bugs)
- Session replays (PII review pending)
- Frontend network errors that don't throw

## Cost expectations

Free tier: 5,000 errors/month, 10,000 performance events/month.
At Liganx's current traffic, this is plenty. If you hit limits, the
biggest knobs are:
- Drop `tracesSampleRate` from 0.1 to 0.01 in `main.py` and `main.tsx`
- Set up inbound filters in the Sentry UI for noisy errors
