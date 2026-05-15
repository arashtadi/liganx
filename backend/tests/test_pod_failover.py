"""Tests for the S3 pod auto-failover decision logic.

The watchdog itself is an asyncio task that polls the network and the
RunPod API; we don't exercise it end-to-end. What we DO test exhaustively
is `decide()` — the pure function that takes (pod_reachable,
pod_desired_status, four timers) and returns an action. Every branch of
that function is the real decision: get it wrong and we either miss a
real outage or spam the RunPod API. Tests pin down every case.
"""
from deltadock.services.pod_failover import FailoverDecision, decide


# Defaults from the production decide() signature — duplicated here so a
# config-knob bump can't silently invalidate the tests' assumptions.
_UNREACHABLE = 300.0
_RECENT = 1800.0
_COOLDOWN = 900.0


def _call(**kw) -> FailoverDecision:
    """Helper that fills in safe defaults so each test sets only what
    it's actually testing. By default: pod is reachable (no action)."""
    base = dict(
        pod_reachable=True,
        pod_desired_status="RUNNING",
        seconds_since_last_health_ok=0.0,
        seconds_since_last_activity=10.0,
        seconds_since_last_recovery_attempt=None,
    )
    base.update(kw)
    return decide(**base)


# ────────────────────── happy path ─────────────────────


def test_reachable_pod_always_none():
    d = _call(pod_reachable=True)
    assert d.action == "none"
    assert "reachable" in d.reason


# ────────────────────── transient blips ─────────────────────


def test_unreachable_briefly_does_nothing():
    """Single missed ping → wait. The whole point of the threshold."""
    d = _call(
        pod_reachable=False,
        seconds_since_last_health_ok=120.0,   # 2 min, below 5-min threshold
        pod_desired_status="EXITED",          # would otherwise trigger
        seconds_since_last_activity=10.0,
    )
    assert d.action == "none"
    assert "waiting" in d.reason


def test_unreachable_at_exactly_threshold_can_trigger():
    """Boundary check: at the threshold, the gate clears and the next
    rules apply (in this case, recent activity + stopped pod → start)."""
    d = _call(
        pod_reachable=False,
        seconds_since_last_health_ok=_UNREACHABLE,
        pod_desired_status="EXITED",
        seconds_since_last_activity=60.0,
    )
    assert d.action == "start_pod"


# ────────────────────── idle window ─────────────────────


def test_no_recent_activity_means_pod_can_stay_down():
    """If nobody's docked in 30+ minutes, the cost watchdog probably
    stopped the pod on purpose. Don't fight it."""
    d = _call(
        pod_reachable=False,
        seconds_since_last_health_ok=600.0,
        seconds_since_last_activity=_RECENT + 1,
        pod_desired_status="EXITED",
    )
    assert d.action == "none"
    assert "pod-down is acceptable" in d.reason


def test_recent_activity_within_window_can_trigger():
    """20-minute-old activity + 6-min unreachable + stopped → start."""
    d = _call(
        pod_reachable=False,
        seconds_since_last_health_ok=360.0,
        seconds_since_last_activity=1200.0,
        pod_desired_status="EXITED",
    )
    assert d.action == "start_pod"


# ────────────────────── cooldown ─────────────────────


def test_cooldown_blocks_repeat_recovery():
    """Even if everything else says 'start_pod', a recent recovery
    attempt should silence the watchdog for the cooldown duration —
    pod resumes take 3-5 min and we don't want to retrigger mid-resume."""
    d = _call(
        pod_reachable=False,
        seconds_since_last_health_ok=600.0,
        seconds_since_last_activity=60.0,
        pod_desired_status="EXITED",
        seconds_since_last_recovery_attempt=120.0,    # 2 min ago
    )
    assert d.action == "none"
    assert "cooldown" in d.reason


def test_cooldown_clears_after_threshold():
    d = _call(
        pod_reachable=False,
        seconds_since_last_health_ok=600.0,
        seconds_since_last_activity=60.0,
        pod_desired_status="EXITED",
        seconds_since_last_recovery_attempt=_COOLDOWN + 1,
    )
    assert d.action == "start_pod"


# ────────────────────── status branches ─────────────────────


def test_status_running_but_unreachable_is_alert_only():
    """The container is up but uvicorn isn't responding. We can't fix
    this from outside the pod (no SSH); humans need to look. The boot
    hook from R1 handles container-restart cases, but if uvicorn died
    *inside* a still-up container, this is what catches it."""
    d = _call(
        pod_reachable=False,
        seconds_since_last_health_ok=600.0,
        seconds_since_last_activity=60.0,
        pod_desired_status="RUNNING",
    )
    assert d.action == "alert_only"
    assert "RUNNING" in d.reason


def test_status_stopped_triggers_start():
    for stopped_state in ("EXITED", "STOPPED", "TERMINATED"):
        d = _call(
            pod_reachable=False,
            seconds_since_last_health_ok=600.0,
            seconds_since_last_activity=60.0,
            pod_desired_status=stopped_state,
        )
        assert d.action == "start_pod", f"state={stopped_state}: {d}"
        assert stopped_state in d.reason


def test_status_none_or_weird_is_alert_only():
    """If we can't get a status from the RunPod API, or it returns
    something we don't recognise, fall back to alerting rather than
    making things worse."""
    for weird in (None, "PROVISIONING", "UNKNOWN", ""):
        d = _call(
            pod_reachable=False,
            seconds_since_last_health_ok=600.0,
            seconds_since_last_activity=60.0,
            pod_desired_status=weird,
        )
        assert d.action == "alert_only", f"state={weird!r}: {d}"


# ────────────────────── compound: realistic scenarios ─────────────────────


def test_scenario_user_docks_pod_dies_failover_fires():
    """User docked 5 minutes ago, pod /health has been failing for 6 min,
    RunPod API says the pod EXITED (RunPod host failure / crash / whatever).
    Expected: failover fires."""
    d = decide(
        pod_reachable=False,
        pod_desired_status="EXITED",
        seconds_since_last_health_ok=360.0,
        seconds_since_last_activity=300.0,
        seconds_since_last_recovery_attempt=None,
    )
    assert d.action == "start_pod"


def test_scenario_pod_intentionally_off_overnight():
    """Cost watchdog stopped the pod at 11pm. It's 8am, no docks since
    yesterday evening. /health is failing (because pod is off). We
    should NOT fail over — this is the intentional, cost-saving state."""
    d = decide(
        pod_reachable=False,
        pod_desired_status="EXITED",
        seconds_since_last_health_ok=8 * 3600,
        seconds_since_last_activity=11 * 3600,    # ~no traffic for half a day
        seconds_since_last_recovery_attempt=None,
    )
    assert d.action == "none"


def test_scenario_resume_in_progress():
    """We triggered a resume 2 minutes ago. Pod is still cold-starting
    (3-5 min). /health still failing. Watchdog should NOT fire a second
    resume — cooldown blocks it."""
    d = decide(
        pod_reachable=False,
        pod_desired_status="RUNNING",  # already RUNNING (resume in progress)
        seconds_since_last_health_ok=360.0,
        seconds_since_last_activity=60.0,
        seconds_since_last_recovery_attempt=120.0,
    )
    assert d.action == "none"   # cooldown wins
