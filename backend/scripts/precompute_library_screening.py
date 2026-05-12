"""Pre-compute a library × target × mutation screening matrix.

Drives a series of regular /screening submissions through the production
API (bypassing the 10-compound cap by batching), polls until each
completes, then snapshots the combined result as a single JSON file
served by GET /library/precomputed/{slug}.

Why this design: the screening engine already knows how to dock + score
+ materialize selectivity + persist poses. We don't re-implement any of
that here — we just orchestrate a series of calls and snapshot the
output. Future bigger libraries (500-5000 compounds) just need bigger
batches; the script doesn't change.

The output JSON is a slimmed-down ScreeningOut (we strip user_id, share_id,
and internal IDs, and re-key compound_ids to 0..N-1 so we don't leak the
production database's auto-increment state through public URLs).

Pose URIs are kept as-is; the precomputed endpoint resolves them via the
same pose_store as live screenings, so the JobPage 3D viewer works
without modification when a user lands on a precomputed screening page.

Usage:
    LIGANX_API_TOKEN=<token> \\
    python backend/scripts/precompute_library_screening.py \\
        --library backend/data/libraries/oncology_kinase_inhibitors_v1.json \\
        --pdb 4OBE --chain A --mutation G12C \\
        --slug oncology-kinase-vs-kras-g12c \\
        --api-base https://liganx-api.fly.dev \\
        --out backend/data/precomputed_screenings/

The token must be from an account whose email is in RATE_LIMIT_BYPASS_EMAILS
(otherwise the script will hit the per-user job quota after a few runs).

Idempotency: if --out/<slug>.json already exists, the script bails unless
--force is given. Lets you re-run the precompute batch without
accidentally clobbering 90 minutes of pod work.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("precompute")

# The /screening endpoint caps real-dock submissions at 10 compounds
# (services.screening_runner._REAL_DOCK_COMPOUND_CAP). Keep this in sync
# if that constant moves; bigger batches just get truncated.
BATCH_SIZE = 10
POLL_INTERVAL_S = 10
POLL_TIMEOUT_S = 60 * 60  # 1 hour per batch


def load_library(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text())
    if not data.get("compounds"):
        raise ValueError(f"library {path} has no compounds")
    return data


def post_screening(
    client: httpx.Client,
    api_base: str,
    token: str,
    pdb: str,
    chain: str,
    mutation: str,
    compounds: list[dict[str, str]],
    title: str,
) -> dict[str, Any]:
    """Submit one screening batch (≤10 compounds). Returns the
    ScreeningOut payload (status=pending at this point)."""
    r = client.post(
        f"{api_base}/screening",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "pdb_id": pdb,
            "chain": chain,
            "mutations": [mutation],
            "exhaustiveness": 4,
            "engine": "quickvina2_gpu",
            "compounds": [{"name": c["name"], "smiles": c["smiles"]} for c in compounds],
            "title": title,
            "tags": ["precompute"],
        },
        timeout=30,
    )
    if r.status_code != 201:
        raise RuntimeError(f"POST /screening failed {r.status_code}: {r.text}")
    return r.json()


def poll_until_done(
    client: httpx.Client, api_base: str, share_id: str
) -> dict[str, Any]:
    """Block until the screening reaches a terminal status."""
    started = time.time()
    last_pct = -1
    while True:
        if time.time() - started > POLL_TIMEOUT_S:
            raise TimeoutError(f"screening {share_id} did not complete in {POLL_TIMEOUT_S}s")
        r = client.get(f"{api_base}/screening/{share_id}", timeout=30)
        if r.status_code != 200:
            raise RuntimeError(f"GET /screening/{share_id} failed: {r.status_code} {r.text}")
        body = r.json()
        status = body["status"]
        pct = (
            int(100 * body["n_completed"] / body["n_total"])
            if body["n_total"] > 0
            else 0
        )
        if pct != last_pct:
            log.info(
                "  %s: %s — %d/%d cells (%d%%)",
                share_id, status, body["n_completed"], body["n_total"], pct,
            )
            last_pct = pct
        if status in ("completed", "failed", "cancelled"):
            return body
        time.sleep(POLL_INTERVAL_S)


def merge_screenings(library: dict[str, Any], partial_jsons: list[dict[str, Any]]) -> dict[str, Any]:
    """Combine N batched screenings into one precomputed-screening JSON.

    Re-keys compound_ids to 0..N-1 (per library order) so the public
    output doesn't leak the production DB's primary keys. Sort order is
    preserved from the inputs (server already returns rows sorted by
    selectivity_index DESC)."""
    if not partial_jsons:
        raise ValueError("no partial screenings to merge")
    first = partial_jsons[0]

    # Build a SMILES → library-order-index lookup so we can renumber.
    smiles_to_idx: dict[str, int] = {}
    name_to_idx: dict[str, int] = {}
    for i, c in enumerate(library["compounds"]):
        smiles_to_idx[c["smiles"].strip()] = i
        if c.get("name"):
            name_to_idx[c["name"].lower()] = i

    def renumber(row: dict[str, Any]) -> dict[str, Any]:
        out = dict(row)
        smi = (row.get("compound_smiles") or "").strip()
        nm = (row.get("compound_name") or "").lower()
        idx = smiles_to_idx.get(smi)
        if idx is None and nm:
            idx = name_to_idx.get(nm)
        if idx is None:
            # Unmatched row — shouldn't happen, but keep with a high id
            # so it sorts to the end deterministically.
            idx = 10_000 + (out.get("compound_id") or 0)
        out["compound_id"] = idx
        return out

    all_rows: list[dict[str, Any]] = []
    for p in partial_jsons:
        for row in p.get("results", []):
            all_rows.append(renumber(row))

    # Sort: selectivity_index DESC NULLS LAST, then best_score ASC.
    # Mirrors the server's sort so the public JSON arrives ranked.
    def sort_key(r: dict[str, Any]) -> tuple:
        return (
            r.get("best_score") is None,
            r.get("selectivity_index") is None,
            -(r.get("selectivity_index") or 0.0),
            r.get("best_score") if r.get("best_score") is not None else 999.0,
            r.get("compound_id"),
        )
    all_rows.sort(key=sort_key)

    merged = {
        "library_id": library["id"],
        "library_name": library["name"],
        "library_compound_count": len(library["compounds"]),
        "pdb_id": first["pdb_id"],
        "chain": first["chain"],
        "mutations": first["mutations"],
        "engine": first["engine"],
        "exhaustiveness": first["exhaustiveness"],
        "status": "completed",
        "n_total": sum(p["n_total"] for p in partial_jsons),
        "n_completed": sum(p["n_completed"] for p in partial_jsons),
        "n_failed": sum(p["n_failed"] for p in partial_jsons),
        "results": all_rows,
        "computed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        # Source share_ids retained for debugging — if a public user
        # somehow inspects the JSON they see strings, no live screening
        # is reachable since this is a snapshot.
        "source_screening_share_ids": [p["share_id"] for p in partial_jsons],
    }
    return merged


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--library", required=True, type=Path)
    ap.add_argument("--pdb", required=True)
    ap.add_argument("--chain", default="A")
    ap.add_argument("--mutation", required=True, help="Single mutation code (e.g. G12C). One file per mutation.")
    ap.add_argument("--slug", required=True, help="Output filename (without .json). Should be URL-safe.")
    ap.add_argument("--api-base", default=os.environ.get("LIGANX_API_BASE", "https://liganx-api.fly.dev"))
    ap.add_argument("--out", default=Path("backend/data/precomputed_screenings/"), type=Path)
    ap.add_argument("--force", action="store_true", help="Overwrite existing output JSON.")
    ap.add_argument("--dry-run", action="store_true", help="Submit only 1 compound, useful for smoke-testing the pipeline.")
    args = ap.parse_args()

    token = os.environ.get("LIGANX_API_TOKEN")
    if not token:
        log.error("LIGANX_API_TOKEN env var required (Bearer token from an account in RATE_LIMIT_BYPASS_EMAILS)")
        return 2

    out_path = args.out / f"{args.slug}.json"
    if out_path.exists() and not args.force:
        log.error("%s already exists. Pass --force to overwrite.", out_path)
        return 2

    library = load_library(args.library)
    all_compounds = library["compounds"]
    if args.dry_run:
        all_compounds = all_compounds[:1]
        log.info("dry-run: only submitting first compound (%s)", all_compounds[0]["name"])

    batches = [all_compounds[i : i + BATCH_SIZE] for i in range(0, len(all_compounds), BATCH_SIZE)]
    log.info(
        "precompute %s: %d compounds → %d batch(es) of ≤%d × %s/%s × %s",
        args.slug, len(all_compounds), len(batches), BATCH_SIZE, args.pdb, args.chain, args.mutation,
    )

    partial_jsons: list[dict[str, Any]] = []
    with httpx.Client(http2=False) as client:
        for i, batch in enumerate(batches, start=1):
            title = f"[precompute {args.slug}] batch {i}/{len(batches)}"
            log.info("→ submitting batch %d/%d (%d compounds)...", i, len(batches), len(batch))
            posted = post_screening(client, args.api_base, token, args.pdb, args.chain, args.mutation, batch, title)
            share = posted["share_id"]
            log.info("  share_id=%s — polling...", share)
            done = poll_until_done(client, args.api_base, share)
            if done["status"] != "completed":
                log.error("  batch %d ended in status=%s, error=%s", i, done["status"], done.get("error_message"))
                # Snapshot what we have anyway — partial results are
                # often useful (e.g., 8 of 10 cmpds docked, 2 failed).
            partial_jsons.append(done)

    merged = merge_screenings(library, partial_jsons)
    args.out.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(merged, indent=2))
    log.info("✓ wrote %s (%d rows)", out_path, len(merged["results"]))

    # Quick summary of top hits so the operator can eyeball quality
    # before chaining into the next precompute.
    top = [r for r in merged["results"] if r.get("selectivity_index") is not None][:5]
    if top:
        log.info("top 5 selectivity hits:")
        for j, r in enumerate(top, start=1):
            log.info(
                "  %d. %-20s mut=%.2f wt=%.2f Δ=%+.2f sel=%.2f",
                j,
                r.get("compound_name") or "?",
                r.get("best_score") or 0.0,
                r.get("wt_score") or 0.0,
                r.get("delta_score") or 0.0,
                r.get("selectivity_index") or 0.0,
            )
    else:
        log.info("(no selectivity_index hits in result — likely all cells failed or screening had no mutation)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
