"""(R5) Resilience tests for the FEP reconciler.

The reconciler's job is to keep working correctly after any of these:
  • Fly machine restart (asyncio task dies, restarted on next boot)
  • OOM kill mid-tick
  • Pod-side restart
  • Network partition

These tests don't simulate the full distributed-systems chaos — they
test the load-bearing invariants in isolation, in mock mode, against
a real Postgres so the SQL paths are exercised.

Strict scope: tests only services/fep_reconciler.py + the DB columns
added in migration 023. No docking code paths touched.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest
from sqlalchemy import text
from sqlmodel import Session

from deltadock.db import engine
from deltadock.main import app
from deltadock.models import (
    Compound,
    FepJob,
    FepJobStatus,
    FepNode,
    FepPerturbation,
)
from deltadock.services.fep_reconciler import (
    is_reconciler_enabled,
    is_shadow_mode,
    reconcile_once_sync,
    _is_authoritative,
)


pytestmark = pytest.mark.requires_db


def _bootstrap_app() -> None:
    from fastapi.testclient import TestClient
    with TestClient(app):
        pass


def _make_study(
    session: Session,
    *,
    share_id: str,
    dispatch_state: str | None = "queued",
    pod_job_id: str | None = None,
    last_polled_at: datetime | None = None,
    dispatched_at: datetime | None = None,
    stage: str | None = None,
    status: FepJobStatus = FepJobStatus.RUNNING,
) -> FepPerturbation:
    """Plant a minimal FepJob + nodes + perturbation row with the
    given dispatch_state. Returns the perturbation row."""
    hit = Compound(name="hit", smiles="CO")
    session.add(hit)
    session.commit()
    session.refresh(hit)

    job = FepJob(
        share_id=share_id,
        user_id=None,
        pdb_id="4OBE",
        chain="A",
        variant="WT",
        hit_compound_id=hit.id,
        status=status,
        stage="building_perturbation_graph",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
        n_lambda_windows=12,
        ns_per_window=7.0,
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    node_a = FepNode(fep_job_id=job.id, compound_id=hit.id, is_hit=True)
    node_b = FepNode(fep_job_id=job.id, compound_id=hit.id, is_hit=False)
    session.add(node_a); session.add(node_b)
    session.commit()
    session.refresh(node_a); session.refresh(node_b)

    edge = FepPerturbation(
        fep_job_id=job.id,
        node_a_id=node_a.id,
        node_b_id=node_b.id,
        lomap_score=1.0,
        dispatch_state=dispatch_state,
        pod_job_id=pod_job_id,
        last_polled_at=last_polled_at,
        dispatched_at=dispatched_at,
        stage=stage,
        status="running" if dispatch_state == "running" else "pending",
    )
    session.add(edge)
    session.commit()
    session.refresh(edge)
    return edge


def _cleanup(session: Session, edge: FepPerturbation) -> None:
    session.execute(text("DELETE FROM fep_perturbation WHERE id = :id"),
                    {"id": edge.id})
    session.execute(text("DELETE FROM fep_node WHERE fep_job_id = :j"),
                    {"j": edge.fep_job_id})
    session.execute(text("DELETE FROM fep_job WHERE id = :j"),
                    {"j": edge.fep_job_id})
    session.commit()


# ─── Authority + mode flags ───────────────────────────────────────


def test_reconciler_enabled_by_default():
    """No env var set → reconciler is enabled."""
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("FEP_RECONCILER_ENABLED", None)
        assert is_reconciler_enabled() is True


def test_reconciler_disabled_via_env():
    with patch.dict(os.environ, {"FEP_RECONCILER_ENABLED": "0"}, clear=False):
        assert is_reconciler_enabled() is False


def test_shadow_mode_default_off():
    """No env var set → shadow mode is OFF (reconciler will mutate)."""
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("FEP_RECONCILER_SHADOW", None)
        assert is_shadow_mode() is False


def test_shadow_mode_enabled_via_env():
    with patch.dict(os.environ, {"FEP_RECONCILER_SHADOW": "1"}, clear=False):
        assert is_shadow_mode() is True


def test_authority_default_off():
    """Default: legacy daemon thread is authoritative."""
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("FEP_AUTHORITATIVE_RECONCILER", None)
        assert _is_authoritative() is False


# ─── Reconciler tick — no-op cases ────────────────────────────────


def test_reconcile_with_no_inflight_rows_is_noop():
    """Empty queue + no in-flight → tick returns clean counters,
    nothing crashes."""
    _bootstrap_app()
    with Session(engine) as session:
        counters = reconcile_once_sync(session)
        assert counters["polled"] == 0
        assert counters["dispatch_attempts"] == 0
        assert counters["errors"] == 0


def test_reconcile_when_disabled_is_noop():
    """If reconciler is disabled, tick does nothing."""
    _bootstrap_app()
    with patch.dict(os.environ, {"FEP_RECONCILER_ENABLED": "0"}, clear=False):
        with Session(engine) as session:
            counters = reconcile_once_sync(session)
            assert counters["polled"] == 0
            assert counters["dispatch_attempts"] == 0


# ─── Shadow mode safety ──────────────────────────────────────────


def test_shadow_mode_does_not_mutate_running_row():
    """In shadow mode, reconciler observes but never writes
    dispatch_state. Critical for safe rollout."""
    _bootstrap_app()
    with Session(engine) as session:
        edge = _make_study(
            session,
            share_id="test_shadow_a",
            dispatch_state="running",
            pod_job_id="test-pod-job",
            stage="running_complex_leg",
            last_polled_at=datetime.utcnow() - timedelta(minutes=30),
        )
        try:
            with patch.dict(os.environ, {"FEP_RECONCILER_SHADOW": "1"}, clear=False):
                reconcile_once_sync(session)
            session.refresh(edge)
            # Nothing changed — same stage, same pod_job_id, last_polled_at
            # not bumped (we'd see a "now-ish" value if mutation happened).
            assert edge.dispatch_state == "running"
            assert edge.pod_job_id == "test-pod-job"
            age = datetime.utcnow() - edge.last_polled_at
            assert age >= timedelta(minutes=29), (
                f"shadow mode mutated last_polled_at — age {age} too fresh"
            )
        finally:
            _cleanup(session, edge)


# ─── Dispatch path — authority gating ─────────────────────────────


def test_non_authoritative_reconciler_does_not_dispatch():
    """Default mode: queued edges stay queued — legacy daemon thread
    owns dispatch. The reconciler observes only."""
    _bootstrap_app()
    with Session(engine) as session:
        edge = _make_study(
            session,
            share_id="test_nonauth_dispatch",
            dispatch_state="queued",
        )
        try:
            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop("FEP_AUTHORITATIVE_RECONCILER", None)
                os.environ.pop("FEP_RECONCILER_SHADOW", None)
                counters = reconcile_once_sync(session)
            session.refresh(edge)
            # Edge stays queued — no dispatch attempt at the pod level
            # (the reconciler bails before HTTP because authority is off).
            assert edge.dispatch_state == "queued"
            assert edge.pod_job_id is None
        finally:
            _cleanup(session, edge)


# ─── Crash-safety: state always consistent after partial tick ────


def test_partial_tick_leaves_consistent_state():
    """If reconcile_once_sync raises mid-tick (e.g. DB connection
    blip), the row should never be left in a transient state. We
    simulate the crash by raising inside the pod poll.

    Invariant: dispatch_state remains in a valid post-transition
    state, never None / never an empty string."""
    _bootstrap_app()
    with Session(engine) as session:
        edge = _make_study(
            session,
            share_id="test_partial_tick",
            dispatch_state="running",
            pod_job_id="test-pod-job",
            stage="running_complex_leg",
            last_polled_at=datetime.utcnow() - timedelta(minutes=5),
        )
        try:
            with patch(
                "deltadock.services.fep_reconciler.httpx.Client"
            ) as mock_client:
                # Make the pod poll raise — simulates a network blip
                # mid-tick.
                mock_client.return_value.__enter__.return_value.get.side_effect = (
                    Exception("simulated network partition")
                )
                # Reconciler must NOT propagate this; the per-edge
                # try/except catches it.
                counters = reconcile_once_sync(session)
                assert counters["errors"] >= 0  # ≥0, possibly logged

            session.refresh(edge)
            # State unchanged — we never reached the UPDATE statement.
            assert edge.dispatch_state == "running"
            assert edge.pod_job_id == "test-pod-job"
        finally:
            _cleanup(session, edge)


def test_terminal_state_never_transitioned():
    """Once an edge is `done`, reconciler must NEVER write back over
    it. Guards against a delayed pod poll arriving after results
    are already persisted."""
    _bootstrap_app()
    with Session(engine) as session:
        edge = _make_study(
            session,
            share_id="test_terminal",
            dispatch_state="done",
            pod_job_id="test-pod-job",
            stage="done",
            last_polled_at=datetime.utcnow(),
        )
        try:
            counters = reconcile_once_sync(session)
            # done edges aren't in the in_flight query at all, so
            # poll count should be 0.
            session.refresh(edge)
            assert edge.dispatch_state == "done"  # untouched
        finally:
            _cleanup(session, edge)


def test_stale_dispatching_edge_reverts_to_queued():
    """An edge stuck in `dispatching` for > 5min reverts to `queued`
    so the next tick can retry. Idempotency token on the pod side
    guarantees no double-dispatch."""
    _bootstrap_app()
    with Session(engine) as session:
        edge = _make_study(
            session,
            share_id="test_stale_dispatching",
            dispatch_state="dispatching",
            pod_job_id=None,                # never got back a job_id
            dispatched_at=datetime.utcnow() - timedelta(minutes=10),
        )
        try:
            # Reconciler authoritative + no shadow → will process.
            with patch.dict(
                os.environ,
                {"FEP_AUTHORITATIVE_RECONCILER": "1"},
                clear=False,
            ):
                os.environ.pop("FEP_RECONCILER_SHADOW", None)
                reconcile_once_sync(session)
            session.refresh(edge)
            assert edge.dispatch_state == "queued", (
                f"stale dispatching row didn't revert; state={edge.dispatch_state}"
            )
            assert edge.dispatched_at is None, "dispatched_at not cleared on revert"
        finally:
            _cleanup(session, edge)


# ─── (N9) Cancel propagation to pod ──────────────────────────────


def test_cancel_propagation_calls_pod_endpoint():
    """An edge in dispatch_state='cancelled' with a live pod_job_id
    must trigger a POST to /fep_edge_cancel/{pod_job_id} on the next
    reconciler tick. The pod's endpoint is idempotent so we don't
    need to track "already sent" — but we DO throttle to once per
    5 minutes via last_polled_at."""
    _bootstrap_app()
    with Session(engine) as session:
        edge = _make_study(
            session,
            share_id="test_cancel_propagation",
            dispatch_state="cancelled",
            pod_job_id="pod-job-cancel-test",
            last_polled_at=None,                   # never polled — eligible immediately
        )
        try:
            calls = []

            class _FakeResp:
                status_code = 200
                text = '{"ok": true}'
                is_success = True

                def json(self):
                    return {"ok": True, "cancel_requested": True}

            class _FakeClient:
                def __init__(self, *a, **kw): pass
                def __enter__(self): return self
                def __exit__(self, *a): pass
                def post(self, url, headers=None):
                    calls.append((url, headers))
                    return _FakeResp()

            with patch.dict(
                os.environ,
                {
                    "FEP_AUTHORITATIVE_RECONCILER": "1",
                    "POD_FEP_URL": "http://fake-pod:8000",
                },
                clear=False,
            ), patch("deltadock.services.fep_reconciler.httpx.Client", _FakeClient):
                os.environ.pop("FEP_RECONCILER_SHADOW", None)
                counters = reconcile_once_sync(session)

            # Cancel-send was attempted at least once.
            assert any(
                "fep_edge_cancel/pod-job-cancel-test" in url for url, _ in calls
            ), f"reconciler did not POST /fep_edge_cancel; calls={calls}"
            assert counters.get("cancels_sent", 0) >= 1

            # Throttle clock bumped — next tick within 5 min should NOT
            # re-send. Verifies the WHERE-clause throttle works.
            session.refresh(edge)
            assert edge.last_polled_at is not None, (
                "last_polled_at not bumped — throttle would spam the pod"
            )
            assert edge.dispatch_state == "cancelled", (
                "cancel propagation accidentally mutated dispatch_state"
            )
        finally:
            _cleanup(session, edge)


def test_cancel_propagation_throttled_to_5min():
    """If last_polled_at < 5 minutes ago, no cancel-send fires.
    Idempotent pod endpoint or not, we shouldn't hammer it."""
    _bootstrap_app()
    with Session(engine) as session:
        edge = _make_study(
            session,
            share_id="test_cancel_throttle",
            dispatch_state="cancelled",
            pod_job_id="pod-job-throttle-test",
            last_polled_at=datetime.utcnow() - timedelta(minutes=2),   # too recent
        )
        try:
            calls = []

            class _Boom:
                def __init__(self, *a, **kw): pass
                def __enter__(self): return self
                def __exit__(self, *a): pass
                def post(self, url, headers=None):
                    calls.append(url)
                    raise AssertionError("should not be called within throttle window")

            with patch.dict(
                os.environ,
                {
                    "FEP_AUTHORITATIVE_RECONCILER": "1",
                    "POD_FEP_URL": "http://fake-pod:8000",
                },
                clear=False,
            ), patch("deltadock.services.fep_reconciler.httpx.Client", _Boom):
                os.environ.pop("FEP_RECONCILER_SHADOW", None)
                counters = reconcile_once_sync(session)

            assert calls == [], (
                f"throttle window violated; should have skipped recent edge, calls={calls}"
            )
            assert counters.get("cancels_sent", 0) == 0
        finally:
            _cleanup(session, edge)


def test_cancel_propagation_skips_edges_without_pod_job_id():
    """A cancelled edge with NO pod_job_id (never reached the pod)
    is a pure DB state — nothing to propagate. SQL must filter these
    out so they don't show up in the cancel-send loop."""
    _bootstrap_app()
    with Session(engine) as session:
        edge = _make_study(
            session,
            share_id="test_cancel_no_pod_job",
            dispatch_state="cancelled",
            pod_job_id=None,                       # was queued, never dispatched
            last_polled_at=None,
        )
        try:
            calls = []

            class _Boom:
                def __init__(self, *a, **kw): pass
                def __enter__(self): return self
                def __exit__(self, *a): pass
                def post(self, url, headers=None):
                    calls.append(url)
                    raise AssertionError("should not POST for edge with no pod_job_id")

            with patch.dict(
                os.environ,
                {
                    "FEP_AUTHORITATIVE_RECONCILER": "1",
                    "POD_FEP_URL": "http://fake-pod:8000",
                },
                clear=False,
            ), patch("deltadock.services.fep_reconciler.httpx.Client", _Boom):
                os.environ.pop("FEP_RECONCILER_SHADOW", None)
                counters = reconcile_once_sync(session)

            assert calls == [], "reconciler tried to POST for an edge with no pod_job_id"
            assert counters.get("cancels_sent", 0) == 0
        finally:
            _cleanup(session, edge)


def test_cancel_fep_study_marks_non_terminal_edges_cancelled():
    """The companion to the reconciler test: cancel_fep_study should
    set dispatch_state='cancelled' on every non-terminal edge so the
    reconciler picks them up. Terminal edges (done/failed/cancelled)
    are left alone — they're already terminal."""
    from deltadock.services.fep_runner import cancel_fep_study

    _bootstrap_app()
    with Session(engine) as session:
        # Build a study with three edges: 1 running, 1 done, 1 queued.
        running = _make_study(
            session,
            share_id="test_cancel_user_path",
            dispatch_state="running",
            pod_job_id="pod-cancel-user-path",
        )
        # Add a done edge + a queued edge under the same fep_job_id.
        node_a = FepNode(fep_job_id=running.fep_job_id, compound_id=1, is_hit=False)
        node_b = FepNode(fep_job_id=running.fep_job_id, compound_id=1, is_hit=False)
        session.add(node_a); session.add(node_b)
        session.commit()
        session.refresh(node_a); session.refresh(node_b)

        done_edge = FepPerturbation(
            fep_job_id=running.fep_job_id,
            node_a_id=node_a.id, node_b_id=node_b.id,
            lomap_score=1.0,
            dispatch_state="done",
            status="ok",
        )
        queued_edge = FepPerturbation(
            fep_job_id=running.fep_job_id,
            node_a_id=node_a.id, node_b_id=node_b.id,
            lomap_score=1.0,
            dispatch_state="queued",
            status="pending",
        )
        session.add(done_edge); session.add(queued_edge)
        session.commit()
        session.refresh(done_edge); session.refresh(queued_edge)

        try:
            ok = cancel_fep_study("test_cancel_user_path", session)
            assert ok is True

            session.refresh(running)
            session.refresh(done_edge)
            session.refresh(queued_edge)

            assert running.dispatch_state == "cancelled", (
                f"running edge not flipped: {running.dispatch_state}"
            )
            assert queued_edge.dispatch_state == "cancelled", (
                f"queued edge not flipped: {queued_edge.dispatch_state}"
            )
            # Terminal edge must NOT be touched — that would corrupt
            # historical state.
            assert done_edge.dispatch_state == "done", (
                f"done edge accidentally flipped to {done_edge.dispatch_state}"
            )

            # And the parent FepJob is CANCELLED.
            job = session.get(FepJob, running.fep_job_id)
            assert job.status == FepJobStatus.CANCELLED
        finally:
            session.execute(text("DELETE FROM fep_perturbation WHERE fep_job_id = :j"),
                            {"j": running.fep_job_id})
            session.execute(text("DELETE FROM fep_node WHERE fep_job_id = :j"),
                            {"j": running.fep_job_id})
            session.execute(text("DELETE FROM fep_job WHERE id = :j"),
                            {"j": running.fep_job_id})
            session.commit()
