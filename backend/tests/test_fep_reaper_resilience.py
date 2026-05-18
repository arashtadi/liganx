"""(N4.0a + N4.0b) Tests for the post-restart timestamp bump + the
two-tier reaper threshold.

These tests use the same `requires_db` marker as test_health and the
M21 CI test — they need a real Postgres because they exercise raw
SQL paths (UPDATE … RETURNING with EXISTS clauses) that aren't
mocked.

The motivating bug: FEP #19 was killed by the reaper after a Fly
redeploy mid-edge, even though the pod was still happily running
the edge. Two regressions guard against ever repeating that:

  1. _bump_inflight_fep_timestamps must reset updated_at on every
     in-flight study before the reaper looks at it.
  2. The reaper must use a 6-hour threshold (not 90 min) for studies
     that have at least one edge with pod_job_id set.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from sqlalchemy import text

from deltadock.db import engine
from deltadock.main import (
    _bump_inflight_fep_timestamps,
    _reap_orphan_fep_studies,
    app,
)
from deltadock.models import (
    Compound,
    FepJob,
    FepJobStatus,
    FepNode,
    FepPerturbation,
)


pytestmark = pytest.mark.requires_db


# ─── Fixtures ─────────────────────────────────────────────────────────────


def _bootstrap_app() -> None:
    """Boot the FastAPI app once so the migrations + ORM init run."""
    with TestClient(app):
        pass


def _make_fep_job(
    session: Session,
    *,
    status: FepJobStatus,
    updated_at: datetime,
    share_id: str,
    with_pod_job_id: bool = False,
    with_stage: bool = False,
) -> FepJob:
    """Create a minimal FepJob (+ optional perturbation) directly via
    the ORM. Bypasses the API so tests can plant rows with arbitrary
    updated_at values."""
    # Need a Compound row for hit_compound_id NOT NULL constraint.
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
        created_at=updated_at,
        updated_at=updated_at,
        n_lambda_windows=12,
        ns_per_window=7.0,
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    if with_pod_job_id or with_stage:
        # Need a node + perturbation to attach the in-flight signal.
        # Use the same hit as both ends — geometrically meaningless
        # but enough to satisfy FK + reaper checks.
        node_a = FepNode(fep_job_id=job.id, compound_id=hit.id, is_hit=True)
        node_b = FepNode(fep_job_id=job.id, compound_id=hit.id, is_hit=False)
        session.add(node_a)
        session.add(node_b)
        session.commit()
        session.refresh(node_a)
        session.refresh(node_b)

        edge = FepPerturbation(
            fep_job_id=job.id,
            node_a_id=node_a.id,
            node_b_id=node_b.id,
            lomap_score=1.0,                # NOT NULL per schema
            status="running",
            # Either pod_job_id (legacy signal) or stage (N5.2b
            # fallback signal) marks this row as "dispatched".
            pod_job_id="test-pod-job-id" if with_pod_job_id else None,
            stage="running_complex_leg" if with_stage else None,
        )
        session.add(edge)
        session.commit()

    return job


def _delete_fep_job(session: Session, job_id: int) -> None:
    """Tidy up — FK cascade order matters with our schema."""
    session.execute(
        text("DELETE FROM fep_perturbation WHERE fep_job_id = :j"),
        {"j": job_id},
    )
    session.execute(
        text("DELETE FROM fep_node WHERE fep_job_id = :j"),
        {"j": job_id},
    )
    session.execute(
        text("DELETE FROM fep_job WHERE id = :j"),
        {"j": job_id},
    )
    session.commit()


# ─── N4.0a tests — timestamp bump ─────────────────────────────────────────


def test_bump_inflight_resets_updated_at_to_now():
    """A study whose updated_at is 80 min old must have it reset to
    'now-ish' after the bump runs. Without this, the immediately-
    following reaper would still see a stale row."""
    _bootstrap_app()
    with Session(engine) as session:
        old = datetime.utcnow() - timedelta(minutes=80)
        job = _make_fep_job(
            session,
            status=FepJobStatus.RUNNING,
            updated_at=old,
            share_id="test_bump_a",
        )
        try:
            _bump_inflight_fep_timestamps()
            session.refresh(job)
            # updated_at should now be within the last few seconds.
            age = datetime.utcnow() - job.updated_at
            assert age < timedelta(minutes=1), (
                f"updated_at age {age} suggests bump didn't fire"
            )
        finally:
            _delete_fep_job(session, job.id)


def test_bump_skips_terminal_statuses():
    """A FAILED or COMPLETED row's updated_at must NOT be bumped — they
    are terminal, the timestamp is meaningful as 'when it ended'."""
    _bootstrap_app()
    with Session(engine) as session:
        old = datetime.utcnow() - timedelta(hours=24)
        job = _make_fep_job(
            session,
            status=FepJobStatus.FAILED,
            updated_at=old,
            share_id="test_bump_b",
        )
        try:
            _bump_inflight_fep_timestamps()
            session.refresh(job)
            # Terminal rows must be left alone — age preserved.
            age = datetime.utcnow() - job.updated_at
            assert age > timedelta(hours=23), (
                f"updated_at age {age} suggests bump touched a terminal row"
            )
        finally:
            _delete_fep_job(session, job.id)


# ─── N4.0b tests — two-tier reaper threshold ──────────────────────────────


def test_reaper_respects_6h_threshold_when_only_stage_is_set():
    """(N5.2b) FEP #19's actual failure mode: edges had stage=
    'running_solvent_leg' / progress_pct=80, but pod_job_id stayed
    null due to a separate runtime bug. The reaper must still treat
    these rows as 'dispatched' (6h threshold) so they don't get
    killed at 90 min.

    This is the load-bearing regression test for the N5.2b fix —
    if pod_job_id alone gates the long threshold, FEP #19 reproduces
    and the row dies on the very next redeploy."""
    _bootstrap_app()
    with Session(engine) as session:
        old = datetime.utcnow() - timedelta(minutes=100)
        job = _make_fep_job(
            session,
            status=FepJobStatus.RUNNING,
            updated_at=old,
            share_id="test_reaper_stage_only",
            with_pod_job_id=False,
            with_stage=True,        # the FEP #19 condition
        )
        try:
            _reap_orphan_fep_studies()
            session.refresh(job)
            assert job.status == FepJobStatus.RUNNING, (
                f"reaper killed a mid-dispatch study identified by "
                f"stage-only signal at 100 min — N5.2b regression"
            )
        finally:
            _delete_fep_job(session, job.id)


def test_reaper_does_not_kill_pod_dispatched_study_at_90_min():
    """A study with an edge that has pod_job_id set should NOT be
    reaped at the 90-min mark — that's the FEP #19 bug. It should
    survive to the 6-hour threshold."""
    _bootstrap_app()
    with Session(engine) as session:
        # 100-minute-old study with an in-flight pod_job_id — under
        # the OLD logic, this would be reaped. Under N4.0b, it survives.
        old = datetime.utcnow() - timedelta(minutes=100)
        job = _make_fep_job(
            session,
            status=FepJobStatus.RUNNING,
            updated_at=old,
            share_id="test_reaper_a",
            with_pod_job_id=True,
        )
        try:
            _reap_orphan_fep_studies()
            session.refresh(job)
            assert job.status == FepJobStatus.RUNNING, (
                f"reaper killed a mid-dispatch study at 100 min — should "
                f"have waited for 6h threshold. status={job.status}"
            )
        finally:
            _delete_fep_job(session, job.id)


def test_reaper_kills_pod_dispatched_study_after_6_hours():
    """Studies with in-flight pod_job_id DO get reaped past the 6-hour
    bar — guards against a genuinely-dead pod stranding the row
    indefinitely."""
    _bootstrap_app()
    with Session(engine) as session:
        old = datetime.utcnow() - timedelta(hours=7)
        job = _make_fep_job(
            session,
            status=FepJobStatus.RUNNING,
            updated_at=old,
            share_id="test_reaper_b",
            with_pod_job_id=True,
        )
        try:
            _reap_orphan_fep_studies()
            session.refresh(job)
            assert job.status == FepJobStatus.FAILED, (
                f"reaper missed a 7-hour-stale pod-dispatched study; "
                f"status={job.status}"
            )
            assert "Interrupted by a backend restart" in (job.error_message or "")
        finally:
            _delete_fep_job(session, job.id)


def test_reaper_still_kills_pre_dispatch_study_at_90_min():
    """Pre-dispatch studies (no pod_job_id anywhere) keep the old
    90-min threshold — the resilience extension applies only to
    studies that have actually reached the pod."""
    _bootstrap_app()
    with Session(engine) as session:
        old = datetime.utcnow() - timedelta(minutes=95)
        job = _make_fep_job(
            session,
            status=FepJobStatus.PREPARING,
            updated_at=old,
            share_id="test_reaper_c",
            with_pod_job_id=False,
        )
        try:
            _reap_orphan_fep_studies()
            session.refresh(job)
            assert job.status == FepJobStatus.FAILED, (
                f"reaper failed to kill a pre-dispatch stale row; "
                f"status={job.status}"
            )
        finally:
            _delete_fep_job(session, job.id)


def test_reaper_leaves_fresh_pre_dispatch_alone():
    """Pre-dispatch row that's only 30 min old should survive — the
    reaper hasn't earned the right to kill it yet."""
    _bootstrap_app()
    with Session(engine) as session:
        old = datetime.utcnow() - timedelta(minutes=30)
        job = _make_fep_job(
            session,
            status=FepJobStatus.PREPARING,
            updated_at=old,
            share_id="test_reaper_d",
            with_pod_job_id=False,
        )
        try:
            _reap_orphan_fep_studies()
            session.refresh(job)
            assert job.status == FepJobStatus.PREPARING
        finally:
            _delete_fep_job(session, job.id)
