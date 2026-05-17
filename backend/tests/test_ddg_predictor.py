"""(N4.2) Unit tests for the ΔΔG predictor service.

Mock backend is fully unit-tested; ESM2 backend is exercised via
monkeypatched `fetch_pod_fitness` so the tests don't hit the GPU pod.
"""
from __future__ import annotations

import pytest


# ─── Mock backend ─────────────────────────────────────────────────────────


def test_mock_is_deterministic_across_calls():
    """Same mutation label → same answer across separate calls.
    Guards against accidental RNG state leakage."""
    from deltadock.services.ddg_predictor import (
        DDGRequest,
        MockDDGPredictor,
    )

    req = DDGRequest(gene="EGFR", wt_aa="T", position=790, mut_aa="M")
    pred1 = MockDDGPredictor().predict_one(req)
    pred2 = MockDDGPredictor().predict_one(req)
    assert pred1.ddg_kcal_per_mol == pred2.ddg_kcal_per_mol
    assert pred1.mutation == "T790M"
    assert pred1.backend == "mock"


def test_mock_clips_to_sane_range():
    """Synthetic values must not exceed ±10 kcal/mol or the heatmap
    colour scale gets blown out by a single outlier."""
    from deltadock.services.ddg_predictor import (
        DDGRequest,
        MockDDGPredictor,
    )

    predictor = MockDDGPredictor()
    # Score a bunch of mutations; none should exceed the clip band.
    requests = [
        DDGRequest(gene="EGFR", wt_aa="A", position=p, mut_aa="W")
        for p in range(1, 200)
    ]
    preds = predictor.predict_batch(requests)
    for p in preds:
        assert -3.0 <= p.ddg_kcal_per_mol <= 8.0, (
            f"mock value {p.ddg_kcal_per_mol} for {p.mutation} outside "
            "expected [-3, 8] band"
        )


def test_mock_batch_preserves_order():
    """Caller relies on predict_batch returning predictions in the
    same order as the input. Easy to break by accidentally using
    a dict."""
    from deltadock.services.ddg_predictor import (
        DDGRequest,
        MockDDGPredictor,
    )

    labels = ["T790M", "L858R", "C797S", "G719A"]
    requests = [
        DDGRequest(
            gene="EGFR",
            wt_aa=lab[0],
            position=int(lab[1:-1]),
            mut_aa=lab[-1],
        )
        for lab in labels
    ]
    preds = MockDDGPredictor().predict_batch(requests)
    assert [p.mutation for p in preds] == labels


# ─── ESM2 backend (monkeypatched pod) ─────────────────────────────────────


def test_esm2_destabilising_mutation_gives_positive_ddg(monkeypatch):
    """Sign convention check: log_p_wt > log_p_mut → mutation is
    destabilising → ΔΔG > 0."""
    from deltadock.services import ddg_predictor as ddg_mod
    from deltadock.services.ddg_predictor import (
        DDGRequest,
        ESM2ZeroShotPredictor,
    )

    def _fake_fetch(gene, position, wt, mut, timeout_s=30.0):
        # WT residue is much more likely than the mutant → strongly
        # destabilising substitution.
        return {
            "fitness": None,
            "log_p_wt": -1.0,
            "log_p_mut": -4.0,
            "seq_len": 1210,
        }

    monkeypatch.setattr(
        "deltadock.services.esm2_pod_client.fetch_pod_fitness", _fake_fetch
    )
    pred = ESM2ZeroShotPredictor(fitness_to_kcal=1.5).predict_one(
        DDGRequest(gene="EGFR", wt_aa="T", position=790, mut_aa="M")
    )
    # log_p_wt - log_p_mut = -1.0 - (-4.0) = +3.0 → ΔΔG = 1.5 × 3.0 = 4.5
    assert pred.ddg_kcal_per_mol == pytest.approx(4.5, abs=0.01)
    assert pred.confidence == "high"  # raw |lr| = 3.0, in the high band
    assert pred.backend == "esm2_zero_shot"


def test_esm2_stabilising_mutation_gives_negative_ddg(monkeypatch):
    """Opposite case — mutation is MORE likely than WT → stabilising →
    ΔΔG < 0."""
    from deltadock.services.ddg_predictor import (
        DDGRequest,
        ESM2ZeroShotPredictor,
    )

    def _fake_fetch(gene, position, wt, mut, timeout_s=30.0):
        return {
            "fitness": None,
            "log_p_wt": -3.0,
            "log_p_mut": -1.5,
            "seq_len": 1210,
        }

    monkeypatch.setattr(
        "deltadock.services.esm2_pod_client.fetch_pod_fitness", _fake_fetch
    )
    pred = ESM2ZeroShotPredictor(fitness_to_kcal=1.5).predict_one(
        DDGRequest(gene="EGFR", wt_aa="T", position=790, mut_aa="M")
    )
    # log_p_wt - log_p_mut = -3.0 - (-1.5) = -1.5 → ΔΔG = 1.5 × -1.5 = -2.25
    assert pred.ddg_kcal_per_mol == pytest.approx(-2.25, abs=0.01)


def test_esm2_pod_unreachable_returns_low_confidence(monkeypatch):
    """When the pod returns None (offline / unreachable / 5xx), we
    must NOT crash — we return a low-confidence ΔΔG=0 row so the
    heatmap can still render with a 'no data' cell."""
    from deltadock.services.ddg_predictor import (
        DDGRequest,
        ESM2ZeroShotPredictor,
    )

    monkeypatch.setattr(
        "deltadock.services.esm2_pod_client.fetch_pod_fitness",
        lambda *args, **kwargs: None,
    )
    pred = ESM2ZeroShotPredictor().predict_one(
        DDGRequest(gene="EGFR", wt_aa="T", position=790, mut_aa="M")
    )
    assert pred.confidence == "low"
    assert pred.ddg_kcal_per_mol == 0.0
    assert "pod unreachable" in pred.notes


def test_esm2_uses_fitness_field_when_log_p_missing(monkeypatch):
    """Some windowed pod responses return only `fitness`, not the
    pair of log-probabilities. The predictor must fall back to
    `-slope × fitness` (matching ESM2's fitness sign convention).
    """
    from deltadock.services.ddg_predictor import (
        DDGRequest,
        ESM2ZeroShotPredictor,
    )

    def _fake_fetch(gene, position, wt, mut, timeout_s=30.0):
        # fitness = log_p_mut - log_p_wt = -3.0 (strongly destabilising)
        return {"fitness": -3.0, "log_p_wt": None, "log_p_mut": None}

    monkeypatch.setattr(
        "deltadock.services.esm2_pod_client.fetch_pod_fitness", _fake_fetch
    )
    pred = ESM2ZeroShotPredictor(fitness_to_kcal=1.5).predict_one(
        DDGRequest(gene="EGFR", wt_aa="T", position=790, mut_aa="M")
    )
    # ΔΔG = -1.5 × -3.0 = +4.5 (destabilising → positive)
    assert pred.ddg_kcal_per_mol == pytest.approx(4.5, abs=0.01)


def test_esm2_clips_extreme_outliers(monkeypatch):
    """Log-LR magnitudes >10 are usually pod artefacts (windowing,
    weird sequences). They get clipped to ±15 kcal/mol so the
    colour scale stays stable."""
    from deltadock.services.ddg_predictor import (
        DDGRequest,
        ESM2ZeroShotPredictor,
    )

    monkeypatch.setattr(
        "deltadock.services.esm2_pod_client.fetch_pod_fitness",
        lambda *args, **kwargs: {
            "fitness": None,
            "log_p_wt": -0.5,
            "log_p_mut": -50.0,           # absurdly destabilising
        },
    )
    pred = ESM2ZeroShotPredictor(fitness_to_kcal=1.5).predict_one(
        DDGRequest(gene="EGFR", wt_aa="T", position=790, mut_aa="M")
    )
    assert pred.ddg_kcal_per_mol == 15.0
    assert "clipped" in pred.notes


# ─── Factory ──────────────────────────────────────────────────────────────


def test_factory_dispatch():
    from deltadock.services.ddg_predictor import (
        ESM2ZeroShotPredictor,
        MockDDGPredictor,
        get_predictor,
    )

    assert isinstance(get_predictor("mock"), MockDDGPredictor)
    assert isinstance(get_predictor("esm2"), ESM2ZeroShotPredictor)
    assert isinstance(get_predictor("esm2_zero_shot"), ESM2ZeroShotPredictor)


def test_factory_unknown_backend_raises():
    from deltadock.services.ddg_predictor import get_predictor

    with pytest.raises(ValueError, match="unknown"):
        get_predictor("foldx")          # not yet implemented


def test_factory_passes_kwargs():
    """fitness_to_kcal should round-trip through the factory."""
    from deltadock.services.ddg_predictor import get_predictor

    pred = get_predictor("esm2", fitness_to_kcal=0.8)
    assert pred._slope == 0.8         # type: ignore[attr-defined]


def test_factory_rejects_invalid_slope():
    """Negative slope flips the sign convention silently — guard at
    the constructor."""
    from deltadock.services.ddg_predictor import ESM2ZeroShotPredictor

    with pytest.raises(ValueError):
        ESM2ZeroShotPredictor(fitness_to_kcal=-1.0)


# ─── Cross-module integration ─────────────────────────────────────────────


def test_can_drive_predictor_from_pocket_residues():
    """Wire test: a pocket-scan output should feed cleanly into a
    predictor batch call. This is the chain N4 builds on."""
    from deltadock.services.ddg_predictor import (
        DDGRequest,
        MockDDGPredictor,
    )
    from deltadock.services.pocket_scan import PocketResidue

    # Simulate two PocketResidue results from a scan, with the
    # caller picking ALA → VAL as the candidate substitution for
    # both. (In production the substitution set comes from a
    # canonical clinical-mutation catalog, not a fixed pick.)
    pocket_residues = [
        PocketResidue(
            chain="A", resnum=790, resname="THR",
            min_dist=3.4, closest_atom="OG1", is_backbone_only=False,
        ),
        PocketResidue(
            chain="A", resnum=797, resname="CYS",
            min_dist=4.1, closest_atom="SG", is_backbone_only=False,
        ),
    ]
    three_to_one = {"THR": "T", "CYS": "C"}
    requests = [
        DDGRequest(
            gene="EGFR",
            wt_aa=three_to_one[pr.resname],
            position=pr.resnum,
            mut_aa="V",
            chain=pr.chain,
        )
        for pr in pocket_residues
    ]
    preds = MockDDGPredictor().predict_batch(requests)
    assert len(preds) == 2
    assert preds[0].mutation == "T790V"
    assert preds[1].mutation == "C797V"
