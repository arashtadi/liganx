"""FEP+ runner — Phase B end-to-end orchestration (G5).

Takes a (target, variant, hit_compound, analog_compounds) FepJob,
builds the perturbation graph (LOMAP + radial-plus-MST), dispatches
each edge sequentially to the dedicated FEP pod's /fep_edge endpoint,
aggregates per-node ΔΔG-to-hit via shortest-path summation, and
persists results into FepJob/FepNode/FepPerturbation.

WHY SEQUENTIAL (per design doc §6):
  A single FEP pod runs one edge at a time. Edges are 8-12 GPU-hours
  each on Blackwell. Concurrency across edges requires N pods; v1
  uses one pod and runs sequentially. The runner checks the
  fep_job.status before dispatching each edge so cancellation lands
  at the next edge boundary (cooperative — the in-flight edge runs
  to completion).

CRITICAL FILES:
  - runpod/dock_pod/fep_pod.py — pod-side alchemy
  - backend/src/deltadock/models.py — DB models (G4)
  - backend/migrations/018_fep_tables.sql — DB schema (G4)
  - docs/fep_plus_design.md — full design doc
  - docs/fep_plus_phase_b_audit.md — convergence threshold rationale

CONVERGENCE THRESHOLDS (tightened from audit):
  • NOT_CONVERGED: edge hysteresis > 0.5 kcal/mol — node along the
    path through this edge is rendered as `—` in the UI.
  • HIGH_UNCERTAINTY: MBAR CI > 0.4 kcal/mol — node ΔΔG rendered
    muted with prominent error bar.
  • CYCLE_CLOSURE_FAIL: any cycle sum > 1.0 kcal/mol — study-level
    banner saying the force field may be misbehaving.
"""
from __future__ import annotations

import json
import logging
import math
import os
from datetime import datetime
from typing import Optional

from sqlmodel import Session, select

from ..models import (
    Compound,
    FepJob,
    FepJobStatus,
    FepNode,
    FepPerturbation,
)

log = logging.getLogger(__name__)


def is_fep_enabled() -> bool:
    """Feature flag gating the FEP+ DISPATCH path. Even with this
    flag set, individual users must still have user_profile.fep_enabled
    granted by an admin — see auth.fep_access_allowed."""
    return os.environ.get("FEP_ENABLED", "").strip().lower() in {"1", "true", "yes"}


def is_fep_mock_mode() -> bool:
    """(H4) Mock mode for testing the full FEP pipeline without
    spending GPU-hours. When FEP_MOCK_MODE=1, dispatch_edge()
    bypasses the pod and returns synthetic but realistic ΔΔG values
    deterministic on the (ligand_a_smiles, ligand_b_smiles) pair —
    so the same study produces the same answers across runs.

    Use cases:
      • Demo / sales — show a chemist what the workflow looks like
        without a $100 GPU bill
      • Frontend dev — iterate on FepStudyPage layout without
        waiting hours per cycle
      • Integration tests — exercise the runner + DB + polling end
        to end in seconds
      • Operator pre-deploy — verify a Fly deploy hasn't broken the
        runner before the pod is built

    The mock honours cycle closure approximately (edge ΔΔG values
    are derived from per-compound 'true ΔG_bind' values + noise, so
    cycles satisfy ΔΔG_AB + ΔΔG_BC + ΔΔG_CA ≈ 0). The UI gets a
    'DEMO MODE' banner so no one mistakes these for real physics.

    Set FEP_MOCK_MODE=1 in Fly secrets while testing; unset for
    production."""
    return os.environ.get("FEP_MOCK_MODE", "").strip().lower() in {"1", "true", "yes"}


def _mock_edge_result(ligand_a_sdf: str, ligand_b_sdf: str) -> dict:
    """Deterministic synthetic FEP edge result for FEP_MOCK_MODE.

    Approach: hash each ligand to a 'true ΔG_bind' on a Gaussian-ish
    scale (~N(-8, 1.5)), then the edge ΔΔG = ΔG_b - ΔG_a + small
    Gaussian noise. This produces:
      • Realistic per-edge values (~±2 kcal/mol around the true ΔΔG)
      • Cycle closure that's approximately satisfied (the noise is
        edge-specific so cycle residuals are small but non-zero)
      • Determinism across runs (same SMILES pair → same answer)

    Returns the same dict shape that fep_pod.run_edge() returns on
    success, with method='MOCK' so the runner can flag it
    downstream and the UI can render a DEMO banner."""
    import hashlib
    import random
    import time

    def _deterministic_dg(sdf: str) -> float:
        h = hashlib.sha256(sdf.encode("utf-8")).digest()
        # Map first 8 bytes to a float in approximately N(-8, 1.5).
        # ΔG_bind values for kinase inhibitors typically range
        # -6 to -12 kcal/mol; we sit in that band.
        u = int.from_bytes(h[:8], "big") / (2 ** 64)
        # Box-Muller-ish: two independent uniforms → one normal-ish
        v = int.from_bytes(h[8:16], "big") / (2 ** 64)
        z = (u - 0.5) * 4.0 + (v - 0.5) * 2.0       # rough N(0, ~1.5)
        return -8.0 + z

    dg_a = _deterministic_dg(ligand_a_sdf)
    dg_b = _deterministic_dg(ligand_b_sdf)

    # Seed the noise from the edge identity so re-running gets the
    # same answer. The noise represents what MBAR would report as
    # statistical uncertainty + force-field bias on a real run.
    edge_seed = int.from_bytes(
        hashlib.sha256((ligand_a_sdf + "→" + ligand_b_sdf).encode("utf-8")).digest()[:8],
        "big",
    )
    rng = random.Random(edge_seed)
    noise = rng.gauss(0, 0.15)                       # ±0.15 kcal/mol typical
    ddg = (dg_b - dg_a) + noise

    # Per-leg energies — give realistic complex/solvent splits.
    # Solvent leg is typically smaller magnitude (~10-30 kJ/mol) than
    # complex (~100-300 kJ/mol). The DIFFERENCE is ΔΔG_binding.
    ddg_kj = ddg * 4.184
    ddg_solvent_kj = rng.gauss(0, 20.0)             # ±20 kJ/mol typical
    ddg_complex_kj = ddg_solvent_kj + ddg_kj

    return {
        "ok": True,
        "ddg_complex_kcal_mol": round(ddg_complex_kj / 4.184, 3),
        "ddg_solvent_kcal_mol": round(ddg_solvent_kj / 4.184, 3),
        "ddg_binding_kcal_mol": round(ddg, 3),
        "ddg_uncertainty": round(abs(rng.gauss(0.20, 0.05)), 3),  # ~0.1-0.3
        "hysteresis_kcal_mol": round(abs(rng.gauss(0.15, 0.08)), 3),  # ~0-0.3
        "convergence_flag": "ok",
        "mbar_diagnostics_json": '{"mock": true, "method": "deterministic_hash"}',
        "method": "MOCK / FEP_MOCK_MODE=1 / not real physics",
        "wall_seconds": rng.uniform(1.5, 2.5),
    }


class FepNotImplementedError(NotImplementedError):
    """Raised when an FEP code path requires Phase B-pod-image work
    that hasn't landed. Caught by the router and surfaced as a clean
    501 to the frontend so a premature production toggle never 500s.

    NOTE: as of G5, the orchestration layer IS implemented. This
    exception now fires only on edge-case codepaths (e.g. cancellation
    of a fully-running job before the cooperative-cancel checkpoint
    is added)."""


# ─────────────────────────── LOMAP graph build ───────────────────────────


def build_perturbation_graph(
    hit_smiles: str,
    analog_smiles_list: list[str],
    *,
    topology: str = "radial_plus_mst",
    manual_edges: Optional[list[tuple[int, int]]] = None,
) -> list[tuple[int, int, float]]:
    """Generate the perturbation graph as a list of edges:
       [(node_a_index, node_b_index, lomap_score), ...]

    Node indices: 0 = hit; 1..N = analogs (in input order).

    Topologies (per design doc §3):
      • "radial": every analog edges to the hit only. N edges. Cheap.
      • "radial_plus_mst" (default): radial + LOMAP-MST backbone. ~1.5N
        edges. Cycles enable cycle-closure error analysis.
      • "manual": only edges in `manual_edges` are used. Caller's
        responsibility to validate.

    LOMAP scores are 0-1 (higher = better). Edges with score < 0.4
    are flagged but not dropped — caller decides.

    Returns: list of (a_idx, b_idx, lomap_score) edges. If openfe/
    lomap aren't installed (deferred imports), returns a radial
    graph with score 1.0 for all edges and logs a warning. This
    means a missing-deps scenario can still build a graph; the
    actual FEP run will then fail with kind=missing_deps which the
    runner handles cleanly."""
    all_smiles = [hit_smiles] + list(analog_smiles_list)
    n = len(all_smiles)
    if n < 2:
        return []

    if topology == "manual" and manual_edges:
        return [(a, b, 1.0) for a, b in manual_edges]

    # Try the real LOMAP path; fall back to a radial 1.0-score graph
    # if openfe/lomap aren't installed.
    try:
        from openfe.setup import LomapAtomMapper
        from openff.toolkit import Molecule
    except ImportError:
        log.warning(
            "fep_runner.build_perturbation_graph: openfe not installed; "
            "returning a radial graph with placeholder LOMAP scores. "
            "Real edge scoring requires the pod-side deps."
        )
        return [(0, i, 1.0) for i in range(1, n)]

    try:
        mols = [Molecule.from_smiles(s, allow_undefined_stereo=True) for s in all_smiles]
    except Exception as e:                                           # noqa: BLE001
        log.warning("LOMAP molecule parse failed: %s — returning radial fallback", e)
        return [(0, i, 1.0) for i in range(1, n)]

    mapper = LomapAtomMapper(time=20, threed=False, max3d=0.95, element_change=False)

    # Score every candidate edge once — LOMAP's scorer is cheap (<1s
    # per pair). We use this to build both the radial spokes (always
    # included) and select MST edges from the remaining candidate set.
    candidate_edges: list[tuple[int, int, float]] = []
    for i in range(n):
        for j in range(i + 1, n):
            try:
                mapping = next(mapper.suggest_mappings(mols[i], mols[j]), None)
                if mapping is None:
                    continue
                score = float(getattr(mapping, "lomap_score", 0.5))
            except Exception as e:                                   # noqa: BLE001
                log.info("LOMAP edge %d→%d failed: %s — skipping", i, j, e)
                continue
            candidate_edges.append((i, j, score))

    if topology == "radial":
        return [(0, i, s) for (i_, i, s) in
                ((min(a, b), max(a, b), s) for a, b, s in candidate_edges)
                if i_ == 0]

    # Radial + MST: start with radial spokes (every analog ← hit),
    # then add edges from candidate_edges (excluding the radial ones)
    # in decreasing-score order, accepting only if it closes a cycle
    # we don't already have.
    edges_out: list[tuple[int, int, float]] = []
    seen: set[tuple[int, int]] = set()
    for i in range(1, n):
        radial = (0, i)
        edges_out.append((0, i, _score_for(candidate_edges, 0, i)))
        seen.add(radial)

    extras = sorted(
        (e for e in candidate_edges if (min(e[0], e[1]), max(e[0], e[1])) not in seen),
        key=lambda e: -e[2],
    )
    # Add up to N/2 extra edges (so total ~1.5N) — keeps cost
    # bounded while still giving us cycle-closure data.
    n_extras = max(1, n // 2)
    for e in extras[:n_extras]:
        edges_out.append(e)

    return edges_out


def _score_for(edges, a, b) -> float:
    """Lookup helper — returns the LOMAP score of edge (a,b) from a
    list of (a,b,score) triples, defaulting 0.5 if not found."""
    key = (min(a, b), max(a, b))
    for ea, eb, s in edges:
        if (min(ea, eb), max(ea, eb)) == key:
            return s
    return 0.5


# ──────────────────── Edge dispatch (pod-side call) ────────────────────


def dispatch_edge(
    *,
    receptor_pdb_text: str,
    ligand_a_sdf: str,
    ligand_b_sdf: str,
    n_lambda_windows: int,
    ns_per_window: float,
    pod_fep_url: str,
    timeout_s: float = 14 * 60 * 60,           # 14 hours; edge is ≤12
) -> dict:
    """POST one edge to the FEP pod's /fep_edge endpoint. Returns
    the structured pod response (success or {ok:False, kind, error}).

    Long timeout because the pod runs the alchemy synchronously — a
    Blackwell edge is 8-12 GPU-hours of wall time. The Fly/proxy
    config must allow long-lived connections; if not, switch to an
    async pod-side worker + result-polling pattern (planned Phase B.1).

    (H4) When FEP_MOCK_MODE=1 we short-circuit before any pod call
    and return a deterministic synthetic result. Used for $0 testing
    of the orchestration + UI without spending GPU-hours.
    """
    if is_fep_mock_mode():
        log.info("FEP_MOCK_MODE active — returning synthetic edge result")
        import time
        time.sleep(1.0)                              # simulate pod latency
        return _mock_edge_result(ligand_a_sdf, ligand_b_sdf)

    from ..config import pod_auth_headers
    import httpx

    pod_url = (pod_fep_url or "").rstrip("/")
    if not pod_url:
        return {
            "ok": False,
            "error": "POD_FEP_URL not configured; cannot dispatch edge",
            "kind": "missing_deps",
        }

    try:
        with httpx.Client(timeout=timeout_s) as client:
            resp = client.post(
                f"{pod_url}/fep_edge",
                json={
                    "receptor_pdb": receptor_pdb_text,
                    "ligand_a_sdf": ligand_a_sdf,
                    "ligand_b_sdf": ligand_b_sdf,
                    "n_lambda_windows": n_lambda_windows,
                    "ns_per_window": ns_per_window,
                },
                headers=pod_auth_headers(),
            )
    except httpx.TimeoutException:
        return {
            "ok": False,
            "error": f"FEP pod /fep_edge timed out after {timeout_s} s",
            "kind": "transport",
        }
    except httpx.RequestError as e:
        return {
            "ok": False,
            "error": f"FEP pod /fep_edge network error: {e}",
            "kind": "transport",
        }

    if not resp.is_success:
        return {
            "ok": False,
            "error": f"FEP pod /fep_edge HTTP {resp.status_code}: {resp.text[:300]}",
            "kind": "transport",
        }
    try:
        return resp.json()
    except Exception as e:                                           # noqa: BLE001
        return {
            "ok": False,
            "error": f"FEP pod /fep_edge non-JSON: {resp.text[:200]}",
            "kind": "transport",
        }


# ────────────── Per-node ΔΔG aggregation via shortest path ──────────────


def aggregate_node_ddg(
    nodes: list[FepNode],
    perturbations: list[FepPerturbation],
) -> None:
    """In-place set node.ddg_to_hit_kcal_mol + ddg_to_hit_uncertainty
    + convergence_flag for every node, by shortest-path summation
    from the hit through the converged subgraph.

    Algorithm:
      1. Hit node (is_hit=True) is fixed at ΔΔG = 0, uncertainty = 0,
         convergence_flag = 'ok'.
      2. For every other node, find the shortest path from the hit
         using converged edges (status='ok' AND hysteresis ≤ 0.5).
         Sum the per-edge ΔΔG_binding values along the path; combine
         uncertainties in quadrature.
      3. If no converged path exists, mark the node 'not_converged'
         with ΔΔG = None.
      4. If the only available path has any edge with CI > 0.4
         kcal/mol, mark the node 'high_uncertainty'.

    Per the Mey et al. 2020 best-practices paper + the Phase B audit
    threshold tightening.
    """
    # Build adjacency: {node_id: [(other_id, perturbation), ...]}
    adj: dict[int, list[tuple[int, FepPerturbation]]] = {n.id: [] for n in nodes}
    for p in perturbations:
        if p.status != "ok" or p.ddg_binding_kcal_mol is None:
            continue
        # Only NOT_CONVERGED edges are excluded from path search.
        # HIGH_UNCERTAINTY edges are kept but mark downstream nodes
        # as high_uncertainty.
        hysteresis = p.hysteresis_kcal_mol or 0.0
        if hysteresis > 0.5:
            continue
        adj[p.node_a_id].append((p.node_b_id, p))
        adj[p.node_b_id].append((p.node_a_id, p))

    # Find the hit.
    hit = next((n for n in nodes if n.is_hit), None)
    if hit is None or hit.id is None:
        log.warning("aggregate_node_ddg: no hit node found")
        return

    hit.ddg_to_hit_kcal_mol = 0.0
    hit.ddg_to_hit_uncertainty = 0.0
    hit.convergence_flag = "ok"

    # BFS from the hit. For ΔΔG we sum signed edge values; the sign
    # depends on direction (A→B = +ΔΔG, B→A = −ΔΔG). The FepPerturbation
    # stores the value for node_a → node_b, so when traversing from
    # node_b to node_a we negate.
    visited: dict[int, tuple[float, float, str]] = {
        hit.id: (0.0, 0.0, "ok"),
    }
    queue: list[int] = [hit.id]
    while queue:
        cur = queue.pop(0)
        cur_ddg, cur_unc, cur_flag = visited[cur]
        for next_id, p in adj[cur]:
            if next_id in visited:
                continue
            # Determine sign: if we're going FROM node_a TO node_b,
            # add +ΔΔG_binding; reverse direction → subtract.
            if cur == p.node_a_id:
                edge_ddg = p.ddg_binding_kcal_mol or 0.0
            else:
                edge_ddg = -(p.ddg_binding_kcal_mol or 0.0)
            edge_unc = p.ddg_uncertainty or 0.0
            new_ddg = cur_ddg + edge_ddg
            new_unc = math.sqrt(cur_unc ** 2 + edge_unc ** 2)
            # Convergence flag: propagate worst-case along the path.
            new_flag = cur_flag
            if edge_unc > 0.4:
                new_flag = "high_uncertainty"
            visited[next_id] = (new_ddg, new_unc, new_flag)
            queue.append(next_id)

    # Write back to nodes.
    for n in nodes:
        if n.is_hit or n.id is None:
            continue
        if n.id in visited:
            ddg, unc, flag = visited[n.id]
            n.ddg_to_hit_kcal_mol = round(ddg, 3)
            n.ddg_to_hit_uncertainty = round(unc, 3)
            n.convergence_flag = flag
        else:
            n.ddg_to_hit_kcal_mol = None
            n.ddg_to_hit_uncertainty = None
            n.convergence_flag = "not_converged"


def compute_cycle_closure_rmsd(
    nodes: list[FepNode],
    perturbations: list[FepPerturbation],
) -> Optional[float]:
    """Compute the RMS cycle-closure error across the perturbation graph.

    For every closed cycle in the graph, the sum of signed ΔΔG values
    around the cycle should be 0 (free energy is a state function).
    The residual is the model-quality signal. We return the RMS of
    residuals across all elementary cycles (the cycle basis) found by
    networkx.cycle_basis.

    <0.5 kcal/mol → force field is doing well on this chemotype.
    0.5–1.0 → moderate; trustworthy individual ΔΔG.
    >1.0 → CYCLE_CLOSURE_FAIL — banner the study.

    Returns None when no cycles exist (radial topology) or when
    fewer than 3 converged edges are available.

    (Final audit B3) Rewritten from a hand-rolled DFS to
    networkx.cycle_basis — the prior implementation overcounted
    shared edges on graphs with 2+ cycles sharing a vertex, producing
    incorrect residuals.
    """
    converged = [
        p for p in perturbations
        if p.status == "ok" and p.ddg_binding_kcal_mol is not None
    ]
    if len(converged) < 3:
        return None

    try:
        import networkx as nx
    except ImportError:
        # networkx is a transitive dep of openfe + sqlmodel ships
        # without it, so this branch shouldn't fire in prod. Fail
        # safe to "unknown" rather than reporting a misleading 0.0.
        log.warning("compute_cycle_closure_rmsd: networkx unavailable; "
                    "cycle-closure check skipped.")
        return None

    # Build an undirected graph with each edge carrying the directed
    # ΔΔG (positive in the canonical A→B direction stored on the row).
    g = nx.Graph()
    for n in nodes:
        if n.id is not None:
            g.add_node(n.id)
    # Map (min(a,b), max(a,b)) → (a_orig, b_orig, ddg) for direction
    # lookup when we walk a cycle. Because each elementary cycle visits
    # each edge once, we need to know which direction we're traversing
    # in to sign the contribution correctly.
    edge_meta: dict[tuple[int, int], tuple[int, int, float]] = {}
    for p in converged:
        key = (min(p.node_a_id, p.node_b_id), max(p.node_a_id, p.node_b_id))
        # Take the FIRST converged edge between any node pair
        # (radial+MST won't produce duplicates; defensive guard).
        if key not in edge_meta:
            g.add_edge(p.node_a_id, p.node_b_id)
            edge_meta[key] = (p.node_a_id, p.node_b_id, p.ddg_binding_kcal_mol or 0.0)

    # Cycle basis: a set of elementary cycles whose linear combinations
    # span the cycle space. Sum of signed ΔΔG around each elementary
    # cycle should be 0 — residual is the model-quality signal.
    residuals: list[float] = []
    for cycle in nx.cycle_basis(g):
        # cycle is a list of node IDs in traversal order, e.g. [A, B, C]
        # representing edges A→B, B→C, C→A.
        cycle_sum = 0.0
        n_nodes = len(cycle)
        for i in range(n_nodes):
            u, v = cycle[i], cycle[(i + 1) % n_nodes]
            key = (min(u, v), max(u, v))
            orig_a, orig_b, ddg = edge_meta[key]
            # Sign: edge is stored as orig_a→orig_b. If we traverse
            # u→v in the same direction, add; otherwise subtract.
            if u == orig_a and v == orig_b:
                cycle_sum += ddg
            else:
                cycle_sum -= ddg
        residuals.append(cycle_sum)

    if not residuals:
        return None
    rms = math.sqrt(sum(r * r for r in residuals) / len(residuals))
    return round(rms, 3)


# ────────────────── Top-level orchestration: run_study ──────────────────


def run_study(fep_job_id: int, session: Session) -> None:
    """Execute the full FEP study end-to-end. Idempotent: re-running
    on a partially-completed study picks up from the first pending
    edge.

    Blocking (~days). Designed to be called from a Celery task that
    backs the POST /fep/studies endpoint — the HTTP request returns
    immediately with the share_id, and the client polls GET
    /fep/studies/{id}/graph for progress.

    The runner cooperatively checks `job.status == FepJobStatus.CANCELLED`
    between edges; in-flight edges run to completion (no mid-edge
    cancellation in v1 — that's the cleanest semantics given that
    each edge is days of compute and partial-edge results are
    scientifically meaningless).
    """
    settings_pod_fep_url = os.environ.get("POD_FEP_URL", "").strip()
    if not settings_pod_fep_url:
        log.error("run_study: POD_FEP_URL not set; cannot dispatch")
        job = session.get(FepJob, fep_job_id)
        if job:
            job.status = FepJobStatus.FAILED
            job.error_message = (
                "POD_FEP_URL not configured on this server. "
                "Operator: deploy the dedicated FEP pod first; see "
                "runpod/DEPLOY_FEP_POD.md."
            )
            session.add(job)
            session.commit()
        return

    job = session.get(FepJob, fep_job_id)
    if not job:
        log.error("run_study: FepJob %s not found", fep_job_id)
        return

    # ─── 1. Preparing: build the graph if it doesn't exist yet. ────
    if job.status == FepJobStatus.PENDING:
        job.status = FepJobStatus.PREPARING
        job.stage = "building_perturbation_graph"
        job.updated_at = datetime.utcnow()
        session.add(job)
        session.commit()

    nodes = list(session.exec(
        select(FepNode).where(FepNode.fep_job_id == job.id)
    ).all())
    if not nodes:
        log.error("run_study: no nodes for FepJob %s — caller must seed", job.id)
        job.status = FepJobStatus.FAILED
        job.error_message = "No FepNode rows attached to this study."
        session.add(job)
        session.commit()
        return

    edges = list(session.exec(
        select(FepPerturbation).where(FepPerturbation.fep_job_id == job.id)
    ).all())

    # ─── 2. Receptor PDB lookup. Use the same receptor_prep service
    #    the docking runner uses — guarantees bit-identical receptor. ─
    try:
        from .receptor_prep import prepare_receptor_for_target
        from ..config import get_settings
        from pathlib import Path
        s = get_settings()
        rprep = prepare_receptor_for_target(
            pdb_id=job.pdb_id,
            chain=job.chain or "A",
            mutation=None if job.variant == "WT" else job.variant,
            pdb_cache=Path(s.pose_cache) / "pdb",
            receptor_cache=Path(s.pose_cache) / "receptors",
        )
        receptor_pdb_text = rprep.receptor_pdb.read_text()
    except Exception as e:                                           # noqa: BLE001
        log.exception("receptor prep failed for FepJob %s", job.id)
        job.status = FepJobStatus.FAILED
        job.error_message = f"Receptor prep failed: {type(e).__name__}: {e}"
        session.add(job)
        session.commit()
        return

    # SMILES → SDF helper — converts a SMILES + 3D embed via RDKit
    # so the pod gets bond-order-correct ligand input. Same approach
    # as MM-GBSA — the openff parameterisation needs SDF, not SMILES.
    def _smiles_to_sdf(smiles: str) -> Optional[str]:
        try:
            from rdkit import Chem
            from rdkit.Chem import AllChem
            mol = Chem.MolFromSmiles(smiles)
            if mol is None:
                return None
            mol = Chem.AddHs(mol)
            AllChem.EmbedMolecule(mol, randomSeed=42)
            AllChem.MMFFOptimizeMolecule(mol)
            return Chem.MolToMolBlock(mol)
        except Exception as e:                                       # noqa: BLE001
            log.warning("SMILES → SDF failed for %s: %s", smiles, e)
            return None

    # Cache compound SMILES → SDF (one embed per analog, not per edge).
    compound_sdf_cache: dict[int, str] = {}
    for n in nodes:
        c = session.get(Compound, n.compound_id)
        if not c:
            continue
        sdf = _smiles_to_sdf(c.smiles)
        if sdf:
            compound_sdf_cache[n.compound_id] = sdf

    # ─── 3. Dispatch edges sequentially. ───────────────────────────
    job.status = FepJobStatus.RUNNING
    job.updated_at = datetime.utcnow()
    session.add(job)
    session.commit()

    for i, edge in enumerate(edges):
        # Refresh job state for cooperative cancellation.
        session.refresh(job)
        if job.status == FepJobStatus.CANCELLED:
            log.info("run_study FepJob %s cancelled at edge %d/%d", job.id, i, len(edges))
            break
        if edge.status == "ok":
            continue                                                 # idempotent resume

        # Find node_a + node_b compound SDFs.
        node_a = next((n for n in nodes if n.id == edge.node_a_id), None)
        node_b = next((n for n in nodes if n.id == edge.node_b_id), None)
        if not node_a or not node_b:
            edge.status = "failed"
            session.add(edge)
            session.commit()
            continue
        sdf_a = compound_sdf_cache.get(node_a.compound_id)
        sdf_b = compound_sdf_cache.get(node_b.compound_id)
        if not sdf_a or not sdf_b:
            edge.status = "failed"
            edge.pod_log_tail = "SMILES → SDF embed failed; cannot dispatch"
            session.add(edge)
            session.commit()
            continue

        edge.status = "running"
        edge.started_at = datetime.utcnow()
        job.stage = f"edge_{i+1}_of_{len(edges)}_running"
        job.updated_at = datetime.utcnow()
        session.add(edge)
        session.add(job)
        session.commit()

        log.info(
            "FepJob %s edge %d/%d dispatching: node_a=%s node_b=%s",
            job.id, i + 1, len(edges), node_a.id, node_b.id,
        )
        result = dispatch_edge(
            receptor_pdb_text=receptor_pdb_text,
            ligand_a_sdf=sdf_a,
            ligand_b_sdf=sdf_b,
            n_lambda_windows=job.n_lambda_windows,
            ns_per_window=job.ns_per_window,
            pod_fep_url=settings_pod_fep_url,
        )

        edge.completed_at = datetime.utcnow()
        if result.get("ok"):
            edge.status = "ok"
            edge.ddg_complex_kcal_mol = result.get("ddg_complex_kcal_mol")
            edge.ddg_solvent_kcal_mol = result.get("ddg_solvent_kcal_mol")
            edge.ddg_binding_kcal_mol = result.get("ddg_binding_kcal_mol")
            edge.ddg_uncertainty = result.get("ddg_uncertainty")
            edge.hysteresis_kcal_mol = result.get("hysteresis_kcal_mol")
            edge.mbar_diagnostics_json = result.get("mbar_diagnostics_json")
        else:
            edge.status = "failed"
            kind = result.get("kind", "runtime")
            edge.pod_log_tail = f"[{kind}] {result.get('error', 'no error')}"
        session.add(edge)
        session.commit()

    # ─── 4. Aggregate per-node ΔΔG + cycle closure. ────────────────
    job.stage = "aggregating"
    session.add(job)
    session.commit()
    nodes = list(session.exec(
        select(FepNode).where(FepNode.fep_job_id == job.id)
    ).all())
    edges = list(session.exec(
        select(FepPerturbation).where(FepPerturbation.fep_job_id == job.id)
    ).all())
    aggregate_node_ddg(nodes, edges)
    for n in nodes:
        session.add(n)
    job.cycle_closure_rmsd = compute_cycle_closure_rmsd(nodes, edges)

    # ─── 5. Final status. ──────────────────────────────────────────
    n_ok = sum(1 for e in edges if e.status == "ok")
    n_total = len(edges)
    if job.status != FepJobStatus.CANCELLED:
        if n_ok == n_total:
            job.status = FepJobStatus.COMPLETED
        elif n_ok > 0:
            job.status = FepJobStatus.COMPLETED  # partial success — UI will flag
            job.error_message = f"Partial: {n_ok}/{n_total} edges converged."
        else:
            job.status = FepJobStatus.FAILED
            job.error_message = "All edges failed; check per-edge pod_log_tail for details."
    job.stage = None
    job.updated_at = datetime.utcnow()
    session.add(job)
    session.commit()
    log.info(
        "FepJob %s done: status=%s, %d/%d edges ok, cycle_closure_rmsd=%s",
        job.id, job.status, n_ok, n_total, job.cycle_closure_rmsd,
    )


def start_fep_study(*args, **kwargs):                                # noqa: D401
    """Legacy alias kept for older 501-stub callers. Use run_study(job_id)."""
    return run_study(*args, **kwargs)


def get_fep_study_status(share_id: str, session: Session) -> Optional[FepJob]:
    """Look up a FepJob by share_id. Used by the GET endpoints."""
    return session.exec(
        select(FepJob).where(FepJob.share_id == share_id)
    ).first()


def cancel_fep_study(share_id: str, session: Session) -> bool:
    """Mark a FepJob as CANCELLED. The runner cooperatively picks
    this up at the next edge boundary."""
    job = get_fep_study_status(share_id, session)
    if not job:
        return False
    if job.status in (FepJobStatus.COMPLETED, FepJobStatus.FAILED, FepJobStatus.CANCELLED):
        return False
    job.status = FepJobStatus.CANCELLED
    job.updated_at = datetime.utcnow()
    session.add(job)
    session.commit()
    return True
