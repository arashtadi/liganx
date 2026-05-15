"""Correlation + scoring helpers for the retrospective validation.

We correlate Liganx's predicted Vina scores (more negative = stronger
binder) against ChEMBL's experimental pchembl_value = -log10(Ki [M])
(higher = stronger binder). A WORKING docking method produces
NEGATIVE Spearman correlation (more negative Vina → higher pchembl).

We report Spearman (rank) and Pearson (linear) correlations. Spearman
is the right primary number — Vina scores have a non-linear relationship
with binding affinity in general, and rank correlation is what matters
for virtual screening (which compounds rise to the top).

Interpretation rules of thumb for retrospective docking validation
(see Cleves & Jain 2008, Sieg et al. 2019 for the field standard):
  |ρ| < 0.2  →  uncalibrated  (effectively random ranking)
  0.2-0.4    →  weak           (better than random but not by much)
  0.4-0.6    →  moderate       (typical of standard docking pipelines)
  0.6-0.8    →  strong         (top published methods)
  > 0.8      →  exceptional    (rare, often dataset-specific)

We expect Liganx (QuickVina2-GPU) to land in the 0.3-0.5 range on most
human kinase targets — that's the published range for plain Vina without
target-specific tuning.
"""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class CorrelationResult:
    n: int
    spearman: float     # rank correlation; primary number
    pearson: float      # linear correlation
    # Sign-flipped Spearman for the "stronger predicted → stronger measured"
    # framing — easier to talk about as a positive R².
    aligned_spearman: float


def spearman(xs: list[float], ys: list[float]) -> float:
    """Spearman rank correlation between two equal-length sequences.

    Returns 0.0 for n<2 (undefined) and clamps near-zero variance to 0 to
    avoid divide-by-zero artefacts. Uses average ranks for ties.
    """
    if len(xs) != len(ys):
        raise ValueError(f"length mismatch: {len(xs)} vs {len(ys)}")
    if len(xs) < 2:
        return 0.0
    rx = _ranks(xs)
    ry = _ranks(ys)
    return pearson(rx, ry)


def pearson(xs: list[float], ys: list[float]) -> float:
    """Pearson (linear) correlation. 0.0 for n<2 or zero variance."""
    if len(xs) != len(ys):
        raise ValueError(f"length mismatch: {len(xs)} vs {len(ys)}")
    n = len(xs)
    if n < 2:
        return 0.0
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if dx < 1e-12 or dy < 1e-12:
        return 0.0
    return num / (dx * dy)


def _ranks(values: list[float]) -> list[float]:
    """Average-rank assignment for Spearman (handles ties)."""
    indexed = sorted(enumerate(values), key=lambda p: p[1])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(indexed):
        j = i
        # collect ties
        while j + 1 < len(indexed) and indexed[j + 1][1] == indexed[i][1]:
            j += 1
        avg_rank = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            # indexed[k] = (original_index, value) — write the rank back
            # at the ORIGINAL position so ranks lines up with values.
            ranks[indexed[k][0]] = avg_rank
        i = j + 1
    return ranks


def correlate_predictions(
    *,
    predicted_scores: list[float],
    experimental_pchembl: list[float],
) -> CorrelationResult:
    """Correlate Liganx's predicted Vina scores against ChEMBL's experimental
    affinities. Returns Spearman + Pearson plus an "aligned" Spearman that's
    sign-flipped so a working docking method produces a positive number
    (since stronger Vina is more negative but stronger pchembl is higher).
    """
    if len(predicted_scores) != len(experimental_pchembl):
        raise ValueError("predicted_scores and experimental_pchembl differ in length")
    sp = spearman(predicted_scores, experimental_pchembl)
    pe = pearson(predicted_scores, experimental_pchembl)
    return CorrelationResult(
        n=len(predicted_scores),
        spearman=sp,
        pearson=pe,
        aligned_spearman=-sp,   # sign-flipped — positive means "working"
    )


def interpret(aligned_spearman: float) -> str:
    """One-word verdict for the aligned (sign-corrected) Spearman."""
    a = abs(aligned_spearman)
    if a < 0.2:
        return "uncalibrated"
    if a < 0.4:
        return "weak"
    if a < 0.6:
        return "moderate"
    if a < 0.8:
        return "strong"
    return "exceptional"
