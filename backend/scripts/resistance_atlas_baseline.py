"""Resistance Atlas spike #2 — baseline runner.

Drives every event in backend/data/clinical_resistance_events.json through
Liganx's existing /screening API, captures wt_score / mut_score / Δ, and
persists results to backend/data/resistance_atlas/baseline_results.json
for downstream ROC analysis (spike #3).

WHY this exists:
    The Resistance Atlas concept rests on a triangulation: docking Δ +
    ESM2 fitness + codon accessibility. Before investing in ESM2 +
    accessibility infrastructure, we want to know what fraction of the
    clinical-resistance set the existing rigid-receptor docking pipeline
    already recovers. That's the baseline this script measures.

    If Δ alone recovers >60% of resistance events at a meaningful
    threshold (ROC-AUC > 0.65), the multi-signal lift to 0.85 is in
    reach and the full atlas build is green-lit. If Δ alone is at
    chance, we've found a dead end early.

USAGE:
    Set LIGANX_API_TOKEN (Supabase access token for a logged-in user
    with admin or rate-limit-bypass privileges) and run:

        python backend/scripts/resistance_atlas_baseline.py

    Output lands in backend/data/resistance_atlas/baseline_results.json
    with one row per scoreable event:

        {
          "event_id": "abl-t315i-imatinib",
          "wt_score": -10.0,
          "mut_score": -8.8,
          "delta_kcal": 1.2,
          "share_id": "abc123...",
          "elapsed_s": 28.4,
          "status": "ok" | "skipped" | "failed",
          "skip_reason": null | "codon_distance=null" | "..."
        }

DESIGN NOTES:
  - One screening submission per (event) so each Δ is independent. A
    smarter batch (group by target + mutation) would save GPU time
    but complicate the result accounting; spike priorities favour
    clarity over throughput.
  - We submit ONE compound per screening, with mutations=[mut_code].
    The runner uses real-Vina docking (env LIGANX_SCREENING_DRY_RUN=0
    must be set on the API for actual scores; otherwise the runner
    returns placeholder zeros — script logs a warning if it detects
    this).
  - Polling interval: 5 s. Per-event timeout: 5 min (most cells finish
    in 30-90s on the 4090 pod).
  - The script is idempotent: re-running skips events that already
    have a recorded result with status=ok.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import urllib.error
import urllib.request


REPO_ROOT = Path(__file__).resolve().parent.parent.parent
EVENTS_PATH = REPO_ROOT / "backend" / "data" / "clinical_resistance_events.json"
OUTPUT_DIR = REPO_ROOT / "backend" / "data" / "resistance_atlas"
OUTPUT_PATH = OUTPUT_DIR / "baseline_results.json"

DEFAULT_API = "https://api.liganx.com"
POLL_INTERVAL_S = 5.0
PER_EVENT_TIMEOUT_S = 5 * 60


def _http(method: str, url: str, token: str, body: dict | None = None) -> Any:
    """Tiny stdlib HTTP wrapper. Avoids adding requests as a script dep."""
    data = None
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # Surface the FastAPI detail for actionable debugging.
        try:
            payload = json.loads(e.read().decode("utf-8"))
        except Exception:
            payload = {"raw": str(e)}
        raise RuntimeError(f"HTTP {e.code} {method} {url}: {payload}") from e


def _submit_screening(api: str, token: str, event: dict) -> str:
    """POST one (drug, mutation) pair as a screening. Returns share_id."""
    body = {
        "pdb_id": event["pdb_id"],
        "chain": event["chain"],
        "uniprot_id": event.get("uniprot_id"),
        "mutations": [event["mutation_code"]],
        "engine": "quickvina2_gpu",
        "exhaustiveness": 8,
        "compounds": [
            {"name": event["drug_name"], "smiles": event["drug_smiles"]},
        ],
        "title": f"RA-baseline · {event['id']}",
        "tags": ["resistance_atlas_baseline"],
    }
    resp = _http("POST", f"{api}/screening", token, body)
    return resp["share_id"]


def _wait_for_completion(api: str, token: str, share_id: str) -> dict:
    """Poll until status is terminal. Returns the final ScreeningOut."""
    deadline = time.time() + PER_EVENT_TIMEOUT_S
    last_progress = (-1, -1)  # (n_completed, n_failed) for change-detect logging
    while time.time() < deadline:
        snap = _http("GET", f"{api}/screening/{share_id}", token)
        status = snap.get("status", "")
        progress = (snap.get("n_completed", 0), snap.get("n_failed", 0))
        if progress != last_progress:
            sys.stderr.write(
                f"    {share_id} status={status} "
                f"completed={progress[0]} failed={progress[1]} of {snap.get('n_total')}\n"
            )
            last_progress = progress
        if status in ("completed", "failed", "cancelled"):
            return snap
        time.sleep(POLL_INTERVAL_S)
    raise TimeoutError(f"Screening {share_id} did not finish within {PER_EVENT_TIMEOUT_S}s")


def _extract_scores(snap: dict, mut_code: str) -> tuple[float | None, float | None]:
    """Pull (wt_score, mut_score) from a finished ScreeningOut. The runner
    denormalises wt_score onto the mutant row, so we just read the
    mutant variant row directly."""
    rows = snap.get("results", [])
    wt_row = next((r for r in rows if r.get("variant") == "WT"), None)
    mut_row = next((r for r in rows if r.get("variant") == mut_code), None)
    wt_score = wt_row.get("best_score") if wt_row else None
    mut_score = mut_row.get("best_score") if mut_row else None
    return wt_score, mut_score


def _load_existing_results() -> dict[str, dict]:
    if not OUTPUT_PATH.exists():
        return {}
    try:
        snap = json.loads(OUTPUT_PATH.read_text())
    except Exception:
        return {}
    return {r["event_id"]: r for r in snap.get("results", []) if "event_id" in r}


def _persist(results: list[dict]) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    snap = {
        "schema_version": 1,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total": len(results),
        "ok": sum(1 for r in results if r["status"] == "ok"),
        "skipped": sum(1 for r in results if r["status"] == "skipped"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
        "results": results,
    }
    OUTPUT_PATH.write_text(json.dumps(snap, indent=2))


def main() -> int:
    token = os.environ.get("LIGANX_API_TOKEN", "").strip()
    if not token:
        sys.stderr.write(
            "ERROR: LIGANX_API_TOKEN env var not set.\n"
            "  Get one by signing in to liganx.com and running in browser DevTools:\n"
            "    JSON.parse(localStorage['sb-<project>-auth-token']).access_token\n"
            "  Then: export LIGANX_API_TOKEN=<paste>\n"
        )
        return 2
    api = os.environ.get("LIGANX_API_BASE", DEFAULT_API).rstrip("/")

    events = json.loads(EVENTS_PATH.read_text())["events"]
    existing = _load_existing_results()
    sys.stderr.write(
        f"Loaded {len(events)} events; {len(existing)} previously processed "
        f"(will skip ones with status=ok).\n"
    )

    results: list[dict] = []
    for i, event in enumerate(events, 1):
        eid = event["id"]
        prior = existing.get(eid)
        if prior and prior.get("status") == "ok":
            sys.stderr.write(f"[{i:2d}/{len(events)}] SKIP (cached ok) {eid}\n")
            results.append(prior)
            continue
        if event.get("codon_distance") is None:
            results.append({
                "event_id": eid,
                "status": "skipped",
                "skip_reason": "codon_distance=null (deletion/insertion — out of scope)",
            })
            sys.stderr.write(f"[{i:2d}/{len(events)}] SKIP (out of scope) {eid}\n")
            continue

        sys.stderr.write(f"[{i:2d}/{len(events)}] SUBMIT {eid}\n")
        started = time.time()
        row: dict[str, Any] = {"event_id": eid, "status": "failed"}
        try:
            share_id = _submit_screening(api, token, event)
            row["share_id"] = share_id
            snap = _wait_for_completion(api, token, share_id)
            wt, mut = _extract_scores(snap, event["mutation_code"])
            delta = (mut - wt) if (wt is not None and mut is not None) else None
            row.update({
                "status": "ok" if (wt is not None and mut is not None) else "failed",
                "wt_score": wt,
                "mut_score": mut,
                "delta_kcal": delta,
                "screening_status": snap.get("status"),
                "elapsed_s": round(time.time() - started, 1),
            })
            if (wt == 0.0 and mut == 0.0) or snap.get("status") == "completed" and wt is None:
                row["status"] = "failed"
                row["error"] = "scores missing — pod may be in dry-run mode"
        except Exception as e:
            row["error"] = str(e)[:300]
            row["elapsed_s"] = round(time.time() - started, 1)
            sys.stderr.write(f"    FAILED: {row['error']}\n")
        results.append(row)
        # Persist incrementally so a crash mid-run doesn't lose progress.
        _persist(results)

    ok = sum(1 for r in results if r["status"] == "ok")
    skipped = sum(1 for r in results if r["status"] == "skipped")
    failed = sum(1 for r in results if r["status"] == "failed")
    sys.stderr.write(
        f"\nDone. ok={ok} skipped={skipped} failed={failed} of {len(events)} events.\n"
        f"Results: {OUTPUT_PATH}\n"
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
