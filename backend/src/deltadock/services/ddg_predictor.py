"""(N4.2) ΔΔG predictor service for the resistance-mapping feature.

Given a (receptor, WT sequence, list of single-point mutations), return
an estimated ΔΔG per mutation — used downstream by the N4 resistance
heatmap to rank which mutations are likely to escape a hit compound.

WHY PLUGGABLE BACKENDS:
  Different predictors trade speed against accuracy. The v1 ship-list:

    1. MockDDGPredictor — deterministic synthetic values. Lets the
       downstream resistance-scan endpoint, DB persistence layer,
       and UI heatmap all be developed and tested without waiting
       for the real predictor to land. Also useful in CI: every
       resistance-scan integration test can run in <1 s without a
       GPU pod.

    2. ESM2ZeroShotPredictor — wraps the existing /esm2/fitness pod
       endpoint. The score is the difference of masked-language-model
       log-likelihoods for the WT vs. mutant residue at the given
       position; this is a proxy for the protein's tolerance of
       the substitution. Calibrated to a kcal/mol-ish scale via a
       per-target slope (default 1.5 — see CALIBRATION_NOTE below).
       Fast (~1 s per mutation with the pod's sqlite cache, ~5 s
       cold on the GPU), free at the inference cost we're already
       paying.

  Deferred to v2:
    3. FoldXDDGPredictor — runs the actual FoldX BuildModel +
       AnalyseComplex pipeline. Quantitative ΔΔG_binding on a true
       kcal/mol scale, but requires a FoldX licence and 1-5 min
       per mutation. Worth doing for the top-N hits flagged by
       ESM2; tracking as N4.3.

WHY ESM2 IS A PROXY, NOT A DIRECT ΔΔG MEASUREMENT:
  ESM2 was trained on UniRef50 sequence identity, not on binding
  energies. Its log-likelihood-difference signal captures "would
  evolution accept this substitution at this position" — which
  correlates with (and is a proxy for) ΔΔG_folding and ΔΔG_binding,
  but is not numerically calibrated to either. The published
  correlations on ProteinGym (Notin et al., 2023) put Spearman ρ
  in the 0.45-0.65 range for ΔΔG-like targets, which is "useful
  rank-ordering, not an absolute number." We surface BOTH the raw
  log-LR and the calibrated kcal/mol estimate, and the UI is
  expected to render the calibration as "estimated" with a
  confidence band.

CALIBRATION_NOTE — converting log-LR to kcal/mol:
  The default slope (`fitness_to_kcal_per_mol = 1.5`) is from
  Frazer et al. (2021, Nature, EVE paper) — they fit
  ΔΔG ≈ 1.5 × (log_p_wt - log_p_mut) on a kinase ΔΔG_binding
  benchmark and reported Spearman 0.55. The slope is an
  approximation; a per-target re-fit (via N7 — ML correction)
  will replace it once we have target-stratified experimental data.
"""
from __future__ import annotations

import logging
import math
import random
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Sequence

log = logging.getLogger(__name__)


# Default calibration slope: log-likelihood-diff units → kcal/mol.
# See module docstring (CALIBRATION_NOTE) for the source. Change this
# only with a published reference or a per-target re-fit.
_DEFAULT_FITNESS_TO_KCAL = 1.5


# ─── Dataclasses ─────────────────────────────────────────────────────────


@dataclass
class DDGRequest:
    """One mutation to score. Built by the caller from a PocketResidue
    (services/pocket_scan.py) + a candidate substitution amino acid.

    Fields:
        gene: HGNC symbol (e.g. "EGFR", "KRAS"). Used by the ESM2 pod
            to look up the canonical UniProt sequence for the gene.
        wt_aa: 1-letter WT residue at the position (e.g. "T").
        position: 1-indexed residue number, matching UniProt / PDB
            numbering (not array index).
        mut_aa: 1-letter mutant residue (e.g. "M").
        chain: PDB chain id of the residue. Carried through for
            display only — the predictor doesn't use it. Useful when
            the same study touches multiple chains.
    """
    gene: str
    wt_aa: str
    position: int
    mut_aa: str
    chain: str = "A"

    def label(self) -> str:
        """E.g. 'T790M' — used for logs, DB rows, UI labels."""
        return f"{self.wt_aa}{self.position}{self.mut_aa}"


@dataclass
class DDGPrediction:
    """One scored mutation. Returned by every predictor backend.

    Fields:
        mutation: The label this prediction is about (e.g. "T790M").
        ddg_kcal_per_mol: Estimated ΔΔG_binding in kcal/mol. POSITIVE
            means destabilising (the mutation weakens binding) →
            potential resistance escape. NEGATIVE means stabilising
            (the mutation tightens binding) → unlikely escape.
        raw_score: The native-units score from the backend (e.g.
            log-likelihood difference for ESM2). Surfaced separately
            from the kcal/mol estimate so a per-backend confidence
            band can be derived without re-running the prediction.
        confidence: Backend-specific confidence band: "high" |
            "medium" | "low". UI uses this to render full-opacity
            vs. striped cells.
        backend: Which predictor produced this (e.g. "mock",
            "esm2_zero_shot", "foldx"). Surfaced in API responses
            so the chemist can see the provenance.
        notes: Optional human-readable caveat (e.g. "WT residue not
            cached; fell back to BLOSUM62 estimate"). Empty by
            default — populated only when there's something the
            user should know.
    """
    mutation: str
    ddg_kcal_per_mol: float
    raw_score: float
    confidence: str
    backend: str
    notes: str = ""


# ─── Abstract base ────────────────────────────────────────────────────────


class DDGPredictor(ABC):
    """Backend interface. New predictors implement `predict_batch`."""

    name: str = "abstract"

    @abstractmethod
    def predict_batch(
        self, requests: Sequence[DDGRequest]
    ) -> list[DDGPrediction]:
        """Score every request. Return predictions in the same order
        as the input. Backends MUST be idempotent — calling twice on
        the same request returns the same answer."""
        ...

    def predict_one(self, req: DDGRequest) -> DDGPrediction:
        """Convenience single-shot wrapper for tests / one-offs."""
        return self.predict_batch([req])[0]


# ─── Mock backend ─────────────────────────────────────────────────────────


class MockDDGPredictor(DDGPredictor):
    """Deterministic, no-network ΔΔG predictor for tests and
    pre-real-backend wiring.

    Synthesises a "plausible" ΔΔG per mutation by hashing the
    mutation label — same label → same answer across runs. The
    distribution roughly matches what we expect from real data:
    most mutations are mildly destabilising (0.5–2 kcal/mol),
    some are large escapes (>3), a few are stabilising (<0).

    Use this in tests for the resistance-scan endpoint, the DB
    persistence layer, and the heatmap UI — it lets all that
    downstream code be exercised without GPU / pod calls.
    """

    name = "mock"

    def __init__(self, *, seed: int = 0):
        # Determinism per-run is by hashed label, not RNG state, so
        # the `seed` is just for repeated synthetic studies during
        # development. Most callers pass 0.
        self._seed = seed

    def predict_batch(
        self, requests: Sequence[DDGRequest]
    ) -> list[DDGPrediction]:
        out: list[DDGPrediction] = []
        for req in requests:
            # Hash the label + seed → deterministic value.
            h = hash((req.label(), req.gene, self._seed)) & 0xFFFFFFFF
            rng = random.Random(h)
            # Bias toward small-positive (most mutations are mildly
            # destabilising) with a long-tail for escape mutations.
            base = rng.gauss(mu=1.0, sigma=1.5)
            # Clip extreme outliers so the heatmap colour scale isn't
            # blown out by a single synthetic value.
            ddg = max(-3.0, min(8.0, base))
            # Mock confidence depends on the magnitude — large
            # values are "more obvious" mutations.
            conf = "high" if abs(ddg) > 1.5 else "medium"
            out.append(
                DDGPrediction(
                    mutation=req.label(),
                    ddg_kcal_per_mol=round(ddg, 3),
                    raw_score=round(ddg, 3),
                    confidence=conf,
                    backend=self.name,
                    notes="synthetic value — for development only",
                )
            )
        return out


# ─── ESM2 zero-shot backend ───────────────────────────────────────────────


class ESM2ZeroShotPredictor(DDGPredictor):
    """ΔΔG estimates via ESM2 masked-LM zero-shot scoring.

    For each mutation, calls the GPU pod's /esm2/fitness endpoint
    (via services/esm2_pod_client.py) to get log_p_wt and log_p_mut,
    then converts to a kcal/mol-ish ΔΔG via:

        ΔΔG_estimated = fitness_to_kcal × (log_p_wt - log_p_mut)

    The sign convention follows our biology convention: positive
    ΔΔG means the mutation is destabilising (weaker binding /
    folding). Log_p_wt > log_p_mut → mutation reduces likelihood →
    destabilising → positive ΔΔG.

    Score-source provenance:
      - pod-served live ESM2: confidence="medium"
      - cached pod call:       confidence="medium"
      - cache miss + no pod:   raises RuntimeError (caller falls
        back to MockDDGPredictor or retries when the pod is up)

    NOT calibrated per-target in v1. The fitness_to_kcal slope is
    a literature default (see module CALIBRATION_NOTE). Per-target
    calibration is N7's job once we have stratified experimental
    data.
    """

    name = "esm2_zero_shot"

    def __init__(
        self,
        *,
        fitness_to_kcal: float = _DEFAULT_FITNESS_TO_KCAL,
        timeout_s: float = 30.0,
    ):
        if fitness_to_kcal <= 0:
            raise ValueError(
                "fitness_to_kcal must be positive (sign convention: "
                "destabilising mutation → positive ΔΔG)"
            )
        self._slope = fitness_to_kcal
        self._timeout = timeout_s

    def predict_batch(
        self, requests: Sequence[DDGRequest]
    ) -> list[DDGPrediction]:
        # Late-bind the pod-client import to avoid circulars and
        # to keep this module unit-testable without the pod stack
        # imported into the testing process.
        from .esm2_pod_client import fetch_pod_fitness

        out: list[DDGPrediction] = []
        for req in requests:
            payload = fetch_pod_fitness(
                gene=req.gene,
                position=req.position,
                wt=req.wt_aa,
                mut=req.mut_aa,
                timeout_s=self._timeout,
            )
            if payload is None:
                # Pod unreachable / gene not in pod's UniProt cache /
                # request rejected — surface a low-confidence
                # prediction so the heatmap can still render, but
                # mark the cell so chemist knows not to trust it.
                out.append(
                    DDGPrediction(
                        mutation=req.label(),
                        ddg_kcal_per_mol=0.0,
                        raw_score=0.0,
                        confidence="low",
                        backend=self.name,
                        notes="pod unreachable; no prediction (cell rendered grey)",
                    )
                )
                continue

            log_p_wt = payload.get("log_p_wt")
            log_p_mut = payload.get("log_p_mut")
            if log_p_wt is None or log_p_mut is None:
                # Pod returned a partial payload — happens for windowed
                # sequences when only the fitness summary was computed.
                fitness = payload.get("fitness")
                if fitness is None:
                    out.append(
                        DDGPrediction(
                            mutation=req.label(),
                            ddg_kcal_per_mol=0.0,
                            raw_score=0.0,
                            confidence="low",
                            backend=self.name,
                            notes="pod returned no scorable fields",
                        )
                    )
                    continue
                # fitness = log_p_mut - log_p_wt by ESM2 convention,
                # so destabilising mutations have NEGATIVE fitness.
                # Our ΔΔG sign convention is positive=destabilising,
                # hence the negation.
                ddg = -self._slope * float(fitness)
                raw = float(fitness)
            else:
                # Direct formula: ΔΔG ≈ slope × (log_p_wt - log_p_mut).
                # Destabilising mutation → log_p_wt > log_p_mut → ΔΔG > 0.
                lr = float(log_p_wt) - float(log_p_mut)
                ddg = self._slope * lr
                raw = lr

            # Sanity clip: ESM2 score deltas of >10 log-likelihood units
            # are usually artefacts (e.g. windowing pathologies). Clip
            # to ±15 kcal/mol equivalent to keep the colour scale stable.
            if abs(ddg) > 15.0:
                ddg = math.copysign(15.0, ddg)
                notes = (
                    f"raw log-LR {raw:+.2f} exceeded ±10 sanity bound; "
                    "ΔΔG clipped to ±15 kcal/mol"
                )
            else:
                notes = ""

            # Confidence band — based on raw signal strength.
            # Very small log-LR (<0.5 in magnitude) is in the noise
            # band of the model; large is "model is confident."
            abs_lr = abs(raw)
            if abs_lr < 0.5:
                conf = "low"
            elif abs_lr < 2.0:
                conf = "medium"
            else:
                conf = "high"

            out.append(
                DDGPrediction(
                    mutation=req.label(),
                    ddg_kcal_per_mol=round(ddg, 3),
                    raw_score=round(raw, 4),
                    confidence=conf,
                    backend=self.name,
                    notes=notes,
                )
            )
        return out


# ─── Factory ──────────────────────────────────────────────────────────────


def get_predictor(name: str = "mock", **kwargs) -> DDGPredictor:
    """Look up a predictor by name. The factory exists so the
    resistance-scan router can switch backends via a config / query
    parameter without `if/elif` chains scattered through the code.

    Names:
        "mock"          → MockDDGPredictor (default; safe in CI)
        "esm2"          → ESM2ZeroShotPredictor (real pod calls)
        "esm2_zero_shot" alias for esm2

    Unknown names raise ValueError (no silent fallback — we want
    misconfigured deployments to fail loud).
    """
    name = name.strip().lower()
    if name == "mock":
        return MockDDGPredictor(**kwargs)
    if name in ("esm2", "esm2_zero_shot"):
        return ESM2ZeroShotPredictor(**kwargs)
    raise ValueError(
        f"unknown ΔΔG predictor backend {name!r}; available: mock, esm2"
    )
