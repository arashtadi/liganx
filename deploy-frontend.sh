#!/usr/bin/env bash
# One-shot frontend deploy. Run from repo root.
#
# Why this exists: the Vercel project "liganx" lacks GitHub auto-deploy
# integration, AND new vercel deploy creates a new "frontend" project
# instead of using the existing "liganx" project. So we deploy → grab the
# deployment ID → cross-project alias to liganx.com via the Vercel API.
#
# Prereq: VERCEL_TOKEN in env. Generate one at:
#   https://vercel.com/account/tokens
# Then:  export VERCEL_TOKEN=vcp_...   ./deploy-frontend.sh
#
# After it finishes, liganx.com points at the new deployment. The previous
# production deployment stays alive forever — re-alias if you need to roll
# back.

set -euo pipefail

if [ -z "${VERCEL_TOKEN:-}" ]; then
  echo "ERROR: set VERCEL_TOKEN. Generate at https://vercel.com/account/tokens"
  exit 1
fi

cd "$(dirname "$0")/frontend"

echo "==> Building + deploying to Vercel..."
DEPLOY_URL=$(vercel deploy --prod --yes --token="$VERCEL_TOKEN" 2>&1 \
  | grep -oE 'https://frontend-[a-z0-9-]+\.vercel\.app' \
  | head -1)

if [ -z "$DEPLOY_URL" ]; then
  echo "ERROR: Couldn't extract deployment URL from vercel output"
  exit 1
fi

echo "==> Deployment: $DEPLOY_URL"
DEPLOY_HOST=${DEPLOY_URL#https://}

echo "==> Resolving deployment ID..."
DEPLOY_ID=$(curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v13/deployments/$DEPLOY_HOST" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "    id: $DEPLOY_ID"

echo "==> Aliasing to liganx.com..."
curl -s -X POST -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"alias":"liganx.com"}' \
  "https://api.vercel.com/v2/deployments/$DEPLOY_ID/aliases" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("    alias:", d.get("alias","?"))'

echo "==> Verifying live..."
sleep 3
LIVE_BUNDLE=$(curl -s 'https://liganx.com/' | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
echo "    live bundle: $LIVE_BUNDLE"

echo
echo "Done. Visit https://liganx.com/"
