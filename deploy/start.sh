#!/usr/bin/env bash
# Combined entrypoint: starts a Celery worker in the background and the
# uvicorn HTTP server in the foreground. Both run on the same Fly machine
# so they share the pose-cache volume (mounted at /var/lib/liganx/poses).
#
# Why same-machine? Fly volumes are local block storage — they can't be
# mounted across multiple process groups. The worker needs to write
# receptor PDBQTs and pose files; the API needs to read them when serving
# the 3D viewer. Same machine = same volume = no shared-storage layer.
#
# Deploy survival: this script restarts BOTH processes on every deploy.
# That's fine because:
#   1. The Celery broker is on a SEPARATE app (liganx-redis) that isn't
#      restarted by API deploys — so the queue itself is durable.
#   2. Celery's task_acks_late=True means a task isn't acked until it
#      completes. A worker killed mid-task → Redis re-delivers on next
#      worker startup. No orphan jobs.
#
# Behavior on SIGTERM (Fly's deploy signal):
#   - Worker is sent SIGTERM by trap; celery shuts down gracefully
#     (lets the current task finish if it's quick, then exits). The
#     task may still be re-delivered if it was past acks_late timing.
#   - Uvicorn drains in-flight requests and exits.
# Both exit independently; the wait at the end blocks until both done
# so Fly's stop sequence completes cleanly.

set -euo pipefail

CELERY_LOG_LEVEL="${CELERY_LOG_LEVEL:-info}"
CELERY_CONCURRENCY="${CELERY_CONCURRENCY:-2}"
UVICORN_HOST="${UVICORN_HOST:-0.0.0.0}"
UVICORN_PORT="${UVICORN_PORT:-8000}"

shutdown() {
  echo "[start.sh] SIGTERM received, shutting down children"
  if [ -n "${WORKER_PID:-}" ] && kill -0 "$WORKER_PID" 2>/dev/null; then
    kill -TERM "$WORKER_PID" || true
  fi
  if [ -n "${API_PID:-}" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill -TERM "$API_PID" || true
  fi
}
trap shutdown SIGTERM SIGINT

# Start Celery worker in the background. Only when USE_CELERY_DISPATCH
# is truthy — otherwise we'd start a worker no one's pushing tasks to,
# which is harmless but wastes RAM (~200 MB per worker process).
if [ "${USE_CELERY_DISPATCH:-false}" = "true" ]; then
  echo "[start.sh] starting celery worker (concurrency=$CELERY_CONCURRENCY)"
  celery -A deltadock.celery_app:celery_app worker \
    --concurrency "$CELERY_CONCURRENCY" \
    --loglevel "$CELERY_LOG_LEVEL" \
    &
  WORKER_PID=$!
  echo "[start.sh] worker PID=$WORKER_PID"
else
  echo "[start.sh] USE_CELERY_DISPATCH not 'true' — skipping worker startup"
fi

echo "[start.sh] starting uvicorn on $UVICORN_HOST:$UVICORN_PORT"
uvicorn deltadock.main:app --host "$UVICORN_HOST" --port "$UVICORN_PORT" &
API_PID=$!

# Wait for either child to exit. If uvicorn dies (Fly's primary process),
# we want the script to exit so Fly restarts the machine. If the worker
# dies on its own, we'll log it but keep uvicorn running — losing the
# worker isn't fatal to serving requests.
wait -n "$API_PID" "${WORKER_PID:-$API_PID}"
EXIT_CODE=$?

echo "[start.sh] one child exited with code $EXIT_CODE; cleaning up"
shutdown
wait || true
exit "$EXIT_CODE"
