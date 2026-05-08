"""RunPod GraphQL client for cost control.

Wraps the three operations Liganx needs against the RunPod API:
  - status:  current pod state (RUNNING / STOPPED / etc.) + uptime
  - stop:    pause the pod (preserves /workspace volume)
  - start:   resume the pod (best-effort same GPU SKU)

Why GraphQL instead of runpodctl: runpodctl is a CLI binary, awkward to
ship inside the Fly image. GraphQL is one HTTP call with httpx, no
extra dependencies. Auth is a Bearer token in the header — same key
the runpodctl CLI uses (`runpodctl config --apiKey`).

Endpoint: https://api.runpod.io/graphql
Auth: Authorization: Bearer <RUNPOD_API_KEY>

These calls are idempotent at the API level (calling stop on an
already-stopped pod is a no-op that returns the current state) so
the watchdog can fire-and-forget without coordinating with manual
admin actions.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ..config import settings

log = logging.getLogger(__name__)

GRAPHQL_URL = "https://api.runpod.io/graphql"


class RunpodConfigError(RuntimeError):
    """Raised when RUNPOD_API_KEY or RUNPOD_POD_ID is unset. Caller
    should treat this as 'feature disabled' rather than 500ing."""


def _is_configured() -> bool:
    return bool(settings.runpod_api_key and settings.runpod_pod_id)


async def _post(query: str, variables: dict[str, Any]) -> dict[str, Any]:
    if not _is_configured():
        raise RunpodConfigError("RUNPOD_API_KEY and RUNPOD_POD_ID must be set")
    headers = {
        "Authorization": f"Bearer {settings.runpod_api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            GRAPHQL_URL,
            headers=headers,
            json={"query": query, "variables": variables},
        )
        r.raise_for_status()
        data = r.json()
        if "errors" in data and data["errors"]:
            log.warning("RunPod GraphQL error: %s", data["errors"])
            raise RuntimeError(f"RunPod GraphQL: {data['errors'][0].get('message','?')}")
        return data.get("data") or {}


async def get_pod_status() -> dict[str, Any]:
    """Return {id, name, desiredStatus, uptimeInSeconds | None}.

    desiredStatus is RunPod's source-of-truth for "is the user paying
    GPU rates right now": RUNNING means yes, EXITED / STOPPED means no.
    """
    query = """
    query Pod($input: PodFilter!) {
      pod(input: $input) {
        id
        name
        desiredStatus
        runtime {
          uptimeInSeconds
        }
      }
    }
    """
    data = await _post(query, {"input": {"podId": settings.runpod_pod_id}})
    pod = data.get("pod") or {}
    runtime = pod.get("runtime") or {}
    return {
        "id": pod.get("id"),
        "name": pod.get("name"),
        "desiredStatus": pod.get("desiredStatus"),
        "uptimeSeconds": runtime.get("uptimeInSeconds"),
    }


async def stop_pod() -> dict[str, Any]:
    """Stop the pod. /workspace volume persists. Cold-start cost on
    resume is ~3-5 min (container provision + start_dock_server.sh)."""
    query = """
    mutation StopPod($input: PodStopInput!) {
      podStop(input: $input) {
        id
        desiredStatus
      }
    }
    """
    data = await _post(query, {"input": {"podId": settings.runpod_pod_id}})
    log.info("RunPod stop_pod result: %s", data)
    return data.get("podStop") or {}


async def start_pod(gpu_count: int = 1) -> dict[str, Any]:
    """Resume the pod. Returns immediately with desiredStatus=RUNNING;
    actual readiness (uvicorn listening on 7861) takes ~3-5 min more —
    callers should poll /health on the pod or just let user click Run
    Dock and see the dock-pending state."""
    query = """
    mutation ResumePod($input: PodResumeInput!) {
      podResume(input: $input) {
        id
        desiredStatus
      }
    }
    """
    data = await _post(
        query,
        {"input": {"podId": settings.runpod_pod_id, "gpuCount": gpu_count}},
    )
    log.info("RunPod start_pod result: %s", data)
    return data.get("podResume") or {}


def is_configured() -> bool:
    """Public guard so admin endpoints / watchdog can no-op gracefully
    when the feature isn't wired up (dev environments, etc.)."""
    return _is_configured()
