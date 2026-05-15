"""Retrospective validation orchestrator.

Usage:
    # Demo mode — synthetic scores, no docking required. End-to-end test
    # of the data pipeline + report generation:
    python -m validation.run --target P00533 --limit 20 --mock

    # Real run — calls the Liganx backend's quick-dock endpoint for each
    # ChEMBL compound. Requires a Supabase JWT (operator's auth token):
    python -m validation.run --target P00533 --limit 50 \\
        --backend-url https://api.liganx.com \\
        --auth-token $LIGANX_AUTH_TOKEN \\
        --pdb-id 1M17 --chain A

Outputs land in `backend/scripts/validation/results/`:
    <target>_<timestamp>.csv   — per-compound data points
    <target>_<timestamp>.md    — correlation summary + interpretation

The Spearman correlation between predicted Vina scores and experimental
pchembl_value is the headline number. See `scoring.interpret()` for the
rubric.
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

# Allow `python -m validation.run` AND `python backend/scripts/validation/run.py`
if __package__ is None or __package__ == "":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from validation.chembl_client import (
        ChemblActivity, dedupe_by_molecule,
        fetch_known_activities, target_chembl_id_for_uniprot,
    )
    from validation.report import CompoundResult, write_csv, write_markdown
    from validation.scoring import correlate_predictions
else:
    from .chembl_client import (
        ChemblActivity, dedupe_by_molecule,
        fetch_known_activities, target_chembl_id_for_uniprot,
    )
    from .report import CompoundResult, write_csv, write_markdown
    from .scoring import correlate_predictions


log = logging.getLogger("liganx.validation")
RESULTS_DIR = Path(__file__).resolve().parent / "results"


# A DockingFunction takes a SMILES string and returns a Vina score
# (kcal/mol; more negative = stronger). Returning None means "this
# compound failed to dock" — the orchestrator records it but excludes
# it from the correlation.
DockingFunction = Callable[[str], Optional[float]]


# ────────────────────── Docking-function options ─────────────────────


def mock_docker(smiles: str) -> Optional[float]:
    """Demo / smoke-test docker. Returns a deterministic pseudo-score
    derived from a hash of the SMILES so the pipeline can be validated
    end-to-end without burning real GPU time. The mock signal is
    *intentionally* NOT correlated with reality — running --mock should
    produce an "uncalibrated" verdict, confirming the math works."""
    import hashlib
    h = int(hashlib.md5(smiles.encode("utf-8")).hexdigest()[:8], 16)
    # Spread across [-12.0, -3.0] uniformly — plausible Vina range.
    return -3.0 - (h % 9000) / 1000.0


def make_backend_docker(backend_url: str, auth_token: str, pdb_id: str, chain: str) -> DockingFunction:
    """Real docker — submits one-compound jobs via the backend's POST /jobs
    endpoint and polls for completion.

    Slow (one HTTP round-trip per compound + the docking time itself), but
    it exercises the SAME path the live product uses — so any calibration
    issue we measure here is the same issue the user sees.

    Auth: the operator provides their own Supabase JWT via --auth-token.
    The validation script doesn't (and shouldn't) try to mint one.
    """
    import json
    import urllib.error
    import urllib.request

    def dock_one(smiles: str) -> Optional[float]:
        body = json.dumps({
            "pdb_id": pdb_id, "chain": chain,
            "mutations": [],
            "compounds": [{"name": "validation", "smiles": smiles}],
        }).encode("utf-8")
        req = urllib.request.Request(
            backend_url.rstrip("/") + "/jobs",
            data=body, method="POST",
            headers={
                "Authorization": f"Bearer {auth_token}",
                "Content-Type": "application/json",
                "User-Agent": "liganx-validation/0.1",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                job = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            log.warning("backend rejected job: %s %s", e.code, e.read()[:200])
            return None
        except urllib.error.URLError as e:
            log.warning("backend unreachable: %s", e)
            return None

        share_id = job.get("share_id")
        if not share_id:
            return None
        # Poll for completion — naive every-3s loop with a 5-minute cap.
        deadline = time.time() + 5 * 60
        while time.time() < deadline:
            time.sleep(3)
            try:
                with urllib.request.urlopen(
                    backend_url.rstrip("/") + f"/jobs/{share_id}",
                    timeout=15,
                ) as r:
                    status = json.loads(r.read().decode("utf-8"))
            except Exception:
                continue
            if status.get("status") == "completed":
                # Pull the docking result. JobOut may not include scores
                # directly — use the results endpoint instead.
                results = status.get("results") or []
                if results:
                    return _coerce_score(results[0].get("best_score"))
                return None
            if status.get("status") == "failed":
                return None
        return None  # timed out

    return dock_one


def _coerce_score(v) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    # 0.0 is the placeholder for failure rows — exclude from correlation.
    if f == 0.0:
        return None
    return f


# ────────────────────── Orchestrator ─────────────────────


@dataclass
class RunConfig:
    target_uniprot: str
    target_name: str       # human-readable, for the report
    pdb_id: str
    chain: str
    limit: int
    min_pchembl: Optional[float]
    docker: DockingFunction
    docker_label: str      # "mock" / "backend" / "pod-direct"
    output_dir: Path


def run(cfg: RunConfig) -> Path:
    """Run the validation. Returns the path to the markdown report."""
    log.info("Resolving %s on ChEMBL...", cfg.target_uniprot)
    target_chembl_id = target_chembl_id_for_uniprot(cfg.target_uniprot)
    if not target_chembl_id:
        raise SystemExit(f"ChEMBL has no target for UniProt {cfg.target_uniprot}")
    log.info("  → %s", target_chembl_id)

    log.info("Fetching activities (limit=%d, min_pchembl=%s)...", cfg.limit, cfg.min_pchembl)
    activities = fetch_known_activities(
        target_chembl_id,
        limit=cfg.limit * 3,                    # pull extra; dedupe by molecule
        min_pchembl=cfg.min_pchembl,
    )
    activities = dedupe_by_molecule(activities)[: cfg.limit]
    log.info("  → %d unique compounds with experimental pchembl_value", len(activities))

    rows: list[CompoundResult] = []
    predicted: list[float] = []
    experimental: list[float] = []
    skipped = 0
    failures = 0

    for i, act in enumerate(activities, start=1):
        log.info("[%d/%d] %s  pchembl=%.2f  ...", i, len(activities), act.molecule_chembl_id, act.pchembl_value)
        try:
            score = cfg.docker(act.canonical_smiles)
        except Exception as e:                  # noqa: BLE001
            log.warning("  docker raised: %s", e)
            score = None

        if score is None:
            failures += 1
            rows.append(CompoundResult(
                molecule_chembl_id=act.molecule_chembl_id,
                canonical_smiles=act.canonical_smiles,
                standard_type=act.standard_type,
                experimental_pchembl=act.pchembl_value,
                predicted_score=float("nan"),
                note="docking failed",
            ))
            continue

        rows.append(CompoundResult(
            molecule_chembl_id=act.molecule_chembl_id,
            canonical_smiles=act.canonical_smiles,
            standard_type=act.standard_type,
            experimental_pchembl=act.pchembl_value,
            predicted_score=score,
            note="",
        ))
        predicted.append(score)
        experimental.append(act.pchembl_value)

    correlation = correlate_predictions(
        predicted_scores=predicted,
        experimental_pchembl=experimental,
    )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    tag = (cfg.target_uniprot or "target").replace("/", "_")
    csv_path = cfg.output_dir / f"{tag}_{stamp}.csv"
    md_path = cfg.output_dir / f"{tag}_{stamp}.md"
    write_csv(csv_path, rows)
    write_markdown(
        md_path,
        target_name=cfg.target_name,
        target_uniprot=cfg.target_uniprot,
        target_chembl_id=target_chembl_id,
        correlation=correlation,
        rows=rows,
        skipped=skipped, failures=failures,
    )
    log.info("Wrote %s  (n=%d, aligned ρ=%+.3f)",
             md_path, correlation.n, correlation.aligned_spearman)
    log.info("Docker used: %s", cfg.docker_label)
    return md_path


# ────────────────────── CLI ─────────────────────


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Retrospective Liganx docking validation against ChEMBL.")
    p.add_argument("--target", required=True,
                   help="UniProt accession (e.g. P00533 for EGFR).")
    p.add_argument("--target-name", default=None,
                   help="Display name for the report (default: --target).")
    p.add_argument("--pdb-id", default="",
                   help="PDB structure to dock against (required for real runs).")
    p.add_argument("--chain", default="A",
                   help="Chain id (default: A).")
    p.add_argument("--limit", type=int, default=50,
                   help="Max compounds to validate (default: 50).")
    p.add_argument("--min-pchembl", type=float, default=4.0,
                   help="Drop compounds weaker than this pchembl_value (default: 4.0 = Ki>100µM).")
    p.add_argument("--mock", action="store_true",
                   help="Use the deterministic mock docker for an end-to-end smoke test (no GPU calls).")
    p.add_argument("--backend-url", default="https://api.liganx.com",
                   help="Backend base URL for the real docker.")
    p.add_argument("--auth-token", default="",
                   help="Supabase JWT for the backend (real-run only).")
    p.add_argument("--output-dir", default="",
                   help=f"Output directory (default: {RESULTS_DIR}).")
    return p


def main(argv: Optional[list[str]] = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = _build_parser().parse_args(argv)

    if args.mock:
        docker = mock_docker
        docker_label = "mock"
    else:
        if not args.pdb_id or not args.auth_token:
            print("Real run requires --pdb-id and --auth-token.", file=sys.stderr)
            return 2
        docker = make_backend_docker(args.backend_url, args.auth_token, args.pdb_id, args.chain)
        docker_label = f"backend @ {args.backend_url}"

    cfg = RunConfig(
        target_uniprot=args.target,
        target_name=args.target_name or args.target,
        pdb_id=args.pdb_id,
        chain=args.chain,
        limit=args.limit,
        min_pchembl=args.min_pchembl,
        docker=docker,
        docker_label=docker_label,
        output_dir=Path(args.output_dir) if args.output_dir else RESULTS_DIR,
    )
    run(cfg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
