#!/bin/bash
# Liganx infrastructure smoke test.
# Verifies API is live and all critical dependencies are up.
# Designed to run in cron or CI/CD pipelines.
# Exit codes: 0 = all healthy, non-zero = failure (cron-able).

set -e

API_URL="${API_URL:-https://api.liganx.com}"
TIMEOUT=10

echo "=== Liganx Smoke Test ==="
echo "Target: $API_URL"
echo

# Step 1: Check basic health + capture git_sha
echo "[1/2] Checking /health endpoint..."
HEALTH=$(curl -s --max-time "$TIMEOUT" "$API_URL/health" 2>/dev/null)
if [ -z "$HEALTH" ]; then
    echo "FAIL: No response from /health"
    exit 1
fi

GIT_SHA=$(echo "$HEALTH" | grep -o '"git_sha":"[^"]*"' | cut -d'"' -f4)
echo "  git_sha: $GIT_SHA"

# Step 2: Check full health probe
echo "[2/2] Checking /health/full endpoint..."
FULL_HEALTH=$(curl -s --max-time "$TIMEOUT" "$API_URL/health/full" 2>/dev/null)
if [ -z "$FULL_HEALTH" ]; then
    echo "FAIL: No response from /health/full"
    exit 1
fi

# Parse and validate all *_status fields
POD_DOCK_STATUS=$(echo "$FULL_HEALTH" | grep -o '"pod_dock_status":"[^"]*"' | cut -d'"' -f4)
BOLTZ2_STATUS=$(echo "$FULL_HEALTH" | grep -o '"boltz2_status":"[^"]*"' | cut -d'"' -f4)
RUNPOD_KEY=$(echo "$FULL_HEALTH" | grep -o '"runpod_api_key":"[^"]*"' | cut -d'"' -f4)

echo "  pod_dock_status: $POD_DOCK_STATUS"
echo "  boltz2_status: $BOLTZ2_STATUS"
echo "  runpod_api_key: $RUNPOD_KEY"

# Validate critical status fields
if [ "$POD_DOCK_STATUS" != "ok" ] && [ "$POD_DOCK_STATUS" != "not_configured" ]; then
    echo "FAIL: pod_dock_status is '$POD_DOCK_STATUS' (expected 'ok' or 'not_configured')"
    exit 1
fi

if [ "$BOLTZ2_STATUS" != "ok" ] && [ "$BOLTZ2_STATUS" != "not_configured" ]; then
    echo "FAIL: boltz2_status is '$BOLTZ2_STATUS' (expected 'ok' or 'not_configured')"
    exit 1
fi

echo
echo "✓ All checks passed"
exit 0
