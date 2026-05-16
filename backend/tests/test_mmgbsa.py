"""Tests for the MM-GBSA backend service (F1/F2).

The pod-side OpenMM run is mocked here — running it for real needs
openff-toolkit + a Blackwell GPU. What we DO test:

  • MmgbsaResult dataclass round-trips through the pipe-delimited
    extra-string format (the on-disk format the matrix UI parses).
  • merge_into_extra preserves non-MM-GBSA segments and overwrites
    prior MM-GBSA segments (idempotency — re-rescoring shouldn't
    duplicate keys).
  • rescore_pose maps pod responses correctly:
      - ok=True → MmgbsaResult dataclass
      - ok=False with "openff-toolkit missing" → MmgbsaError("missing_deps")
      - ok=False with "parameterise" message → MmgbsaError("parameterisation")
      - other ok=False → MmgbsaError("runtime")
      - HTTP transport errors → MmgbsaError("transport")
  • _summarize_extra parses the mmgbsa_* keys (the matrix UI consumer).
"""
from __future__ import annotations

import pytest

from deltadock.services.ask_ai import _summarize_extra
from deltadock.services.mmgbsa import (
    MmgbsaError,
    MmgbsaResult,
    merge_into_extra,
    rescore_pose,
)


# ────────────────────── MmgbsaResult round-trip ─────────────────────


def test_result_to_extra_segment_includes_all_fields():
    r = MmgbsaResult(
        dg_bind_kcal_mol=-42.1,
        e_complex_kcal_mol=-8421.3,
        e_protein_kcal_mol=-8350.9,
        e_ligand_kcal_mol=-28.3,
        method="openmm-obc2 / amber14sb+openff-2.2",
        wall_seconds=47.2,
        receptor_rmsd_a=0.35,
    )
    seg = r.to_extra_segment()
    for needle in ("mmgbsa_dg=-42.10", "mmgbsa_e_complex=-8421.30",
                   "mmgbsa_e_protein=-8350.90", "mmgbsa_e_ligand=-28.30",
                   "mmgbsa_method=openmm-obc2 / amber14sb+openff-2.2",
                   "mmgbsa_seconds=47.2", "mmgbsa_rmsd=0.35"):
        assert needle in seg, f"missing {needle!r} in {seg!r}"


def test_extra_segment_round_trips_through_parser():
    """The matrix UI parser MUST be able to read what the backend
    writes. This is the load-bearing contract between services/mmgbsa.py
    and services/ask_ai.py._summarize_extra."""
    r = MmgbsaResult(-42.1, -8421.3, -8350.9, -28.3, "method", 47.2, 0.35)
    parsed = _summarize_extra(r.to_extra_segment())
    assert parsed["mmgbsaDg"] == pytest.approx(-42.1)
    assert parsed["mmgbsaEComplex"] == pytest.approx(-8421.3)
    assert parsed["mmgbsaEProtein"] == pytest.approx(-8350.9)
    assert parsed["mmgbsaELigand"] == pytest.approx(-28.3)
    assert parsed["mmgbsaMethod"] == "method"
    assert parsed["mmgbsaSeconds"] == pytest.approx(47.2)
    assert parsed["mmgbsaRmsd"] == pytest.approx(0.35)


# ────────────────────── merge_into_extra ─────────────────────


def test_merge_appends_to_empty_extra():
    r = MmgbsaResult(-42.1, -8421.3, -8350.9, -28.3, "m", 47.2, 0.5)
    merged = merge_into_extra(None, r)
    assert "mmgbsa_dg=-42.10" in merged
    assert "mmgbsa_method=m" in merged


def test_merge_preserves_non_mmgbsa_segments():
    existing = "engine=pod_gpu|vinardo=-8.42|contacts=foo|posebusters=passed"
    r = MmgbsaResult(-42.1, -8421.3, -8350.9, -28.3, "m", 47.2, 0.5)
    merged = merge_into_extra(existing, r)
    for kept in ("engine=pod_gpu", "vinardo=-8.42",
                 "contacts=foo", "posebusters=passed"):
        assert kept in merged, f"{kept!r} dropped during merge"
    assert "mmgbsa_dg=-42.10" in merged


def test_merge_is_idempotent_overwrites_prior_mmgbsa():
    """Re-rescoring the same pose must REPLACE the old MM-GBSA
    segment, not duplicate it. Without this guarantee, every re-run
    grows the extra string unbounded."""
    existing = (
        "engine=pod_gpu|"
        "mmgbsa_dg=-9.9|mmgbsa_e_complex=-100|mmgbsa_e_protein=-90|"
        "mmgbsa_e_ligand=-1|mmgbsa_method=old|mmgbsa_seconds=10|"
        "vinardo=-8.42"
    )
    r = MmgbsaResult(-42.1, -8421.3, -8350.9, -28.3, "new", 47.2, 0.5)
    merged = merge_into_extra(existing, r)
    # Old MM-GBSA values gone.
    assert "mmgbsa_dg=-9.9" not in merged
    assert "mmgbsa_method=old" not in merged
    # New values present.
    assert "mmgbsa_dg=-42.10" in merged
    assert "mmgbsa_method=new" in merged
    # Only ONE mmgbsa_dg key — no duplicates.
    assert merged.count("mmgbsa_dg=") == 1
    # Non-MM-GBSA preserved.
    assert "engine=pod_gpu" in merged
    assert "vinardo=-8.42" in merged


# ────────────────────── rescore_pose error mapping ─────────────────────


class _FakeResponse:
    """Minimal httpx-Response mock — just status_code + .json() + .text."""
    def __init__(self, status_code: int, payload: dict | None = None,
                 text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self.text = text
        self.is_success = 200 <= status_code < 300

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


class _FakeClient:
    def __init__(self, response: _FakeResponse):
        self.response = response

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def post(self, *a, **kw):
        return self.response


def _patch_httpx(monkeypatch, response):
    """Patch httpx.Client to return our fake. Must patch the import
    that mmgbsa.py uses (httpx imported inside the function)."""
    import httpx
    monkeypatch.setattr(httpx, "Client", lambda *a, **kw: _FakeClient(response))


def _patch_settings(monkeypatch, url="https://pod.example/"):
    """Patch get_settings + pod_auth_headers — the service reads these
    at call time. We only need pod_dock_url to be non-empty + the
    headers helper to not blow up."""
    from deltadock import config

    class _S:
        pod_dock_url = url
    monkeypatch.setattr(config, "get_settings", lambda: _S())
    monkeypatch.setattr(config, "pod_auth_headers", lambda: {})


def test_rescore_pose_ok_response_maps_to_result(monkeypatch):
    _patch_settings(monkeypatch)
    _patch_httpx(monkeypatch, _FakeResponse(200, {
        "ok": True,
        "dg_bind_kcal_mol": -42.1,
        "e_complex_kcal_mol": -8421.3,
        "e_protein_kcal_mol": -8350.9,
        "e_ligand_kcal_mol": -28.3,
        "method": "openmm-obc2",
        "wall_seconds": 47.2,
        "receptor_rmsd_a": 0.35,
    }))
    result = rescore_pose("pdb", "sdf")
    assert isinstance(result, MmgbsaResult)
    assert result.dg_bind_kcal_mol == pytest.approx(-42.1)
    assert result.receptor_rmsd_a == pytest.approx(0.35)


def test_rescore_pose_missing_deps_maps_to_missing_deps_kind(monkeypatch):
    """The most likely failure mode in Phase A — pod doesn't have
    openff-toolkit installed. Must surface as kind='missing_deps' so
    the backend can return HTTP 503 and the UI can tell the operator
    to pip-install on the pod."""
    _patch_settings(monkeypatch)
    _patch_httpx(monkeypatch, _FakeResponse(200, {
        "ok": False,
        "error": "MM-GBSA dependencies missing on this pod: No module named 'openff-toolkit'. ...",
    }))
    with pytest.raises(MmgbsaError) as exc:
        rescore_pose("pdb", "sdf")
    assert exc.value.kind == "missing_deps"


def test_rescore_pose_parameterisation_failure(monkeypatch):
    _patch_settings(monkeypatch)
    _patch_httpx(monkeypatch, _FakeResponse(200, {
        "ok": False,
        "error": "Failed to parameterise ligand: unknown SMARTS atom type",
    }))
    with pytest.raises(MmgbsaError) as exc:
        rescore_pose("pdb", "sdf")
    assert exc.value.kind == "parameterisation"


def test_rescore_pose_clash_detected_runtime(monkeypatch):
    """(Audit fix #10) The pod's pre-min clash detector returns
    ok=False with a 'steric clash' message. This should surface as
    a runtime error so the UI can render a useful chemist-facing
    message ('check your pose')."""
    _patch_settings(monkeypatch)
    _patch_httpx(monkeypatch, _FakeResponse(200, {
        "ok": False,
        "error": "Steric clash in input pose — pre-minimisation energy 1.5e6 kcal/mol is non-physical.",
    }))
    with pytest.raises(MmgbsaError) as exc:
        rescore_pose("pdb", "sdf")
    assert exc.value.kind == "runtime"
    assert "clash" in str(exc.value).lower()


def test_rescore_pose_pod_5xx_maps_to_transport(monkeypatch):
    _patch_settings(monkeypatch)
    _patch_httpx(monkeypatch, _FakeResponse(503, text="pod overloaded"))
    with pytest.raises(MmgbsaError) as exc:
        rescore_pose("pdb", "sdf")
    assert exc.value.kind == "transport"


def test_rescore_pose_pod_401_maps_to_transport(monkeypatch):
    _patch_settings(monkeypatch)
    _patch_httpx(monkeypatch, _FakeResponse(401, text="bad X-Pod-Secret"))
    with pytest.raises(MmgbsaError) as exc:
        rescore_pose("pdb", "sdf")
    assert exc.value.kind == "transport"
    assert "auth" in str(exc.value).lower()


def test_rescore_pose_no_pod_url_raises_transport(monkeypatch):
    _patch_settings(monkeypatch, url="")
    with pytest.raises(MmgbsaError) as exc:
        rescore_pose("pdb", "sdf")
    assert exc.value.kind == "transport"
    assert "pod_dock_url" in str(exc.value)


def test_rescore_pose_malformed_payload_raises_runtime(monkeypatch):
    """Pod said ok=True but the energies are missing — defensive
    handling so a partially-broken pod doesn't 500 the backend."""
    _patch_settings(monkeypatch)
    _patch_httpx(monkeypatch, _FakeResponse(200, {
        "ok": True,
        "method": "x",
        # Missing all the numeric fields
    }))
    with pytest.raises(MmgbsaError) as exc:
        rescore_pose("pdb", "sdf")
    assert exc.value.kind == "runtime"
