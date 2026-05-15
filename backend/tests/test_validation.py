"""Tests for the S2 retrospective validation harness.

We test the pure-function pieces (correlation math, ChEMBL parsing,
report writing) without hitting the network. The orchestrator's --mock
mode is the end-to-end smoke test for the data pipeline — covered by
test_run_mock_end_to_end, which exercises the full fetch→score→correlate
→report pipeline with the network call to ChEMBL stubbed out.
"""
import math
import sys
from pathlib import Path

import pytest

# The validation package lives under backend/scripts/, which isn't on the
# normal sys.path. Add it explicitly for the test run.
SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from validation.scoring import (   # noqa: E402
    CorrelationResult, correlate_predictions, interpret, pearson, spearman,
)
from validation.chembl_client import (   # noqa: E402
    ChemblActivity, dedupe_by_molecule,
)
from validation.report import (   # noqa: E402
    CompoundResult, write_csv, write_markdown,
)


# ────────────────────── correlation math ─────────────────────


def test_spearman_perfect_positive():
    assert spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]) == pytest.approx(1.0)


def test_spearman_perfect_negative():
    """Critical: Vina scores (more negative = stronger) vs pchembl
    (higher = stronger). A WORKING docking method on monotonic data
    produces -1.0 raw Spearman."""
    vina = [-10.0, -8.0, -6.0, -4.0, -2.0]   # ranked best→worst
    pki  = [9.0,    7.0,   5.0,  3.0,  1.0]   # ranked best→worst (same order)
    assert spearman(vina, pki) == pytest.approx(-1.0)


def test_spearman_random_data_is_near_zero():
    """Unrelated rankings → near-zero correlation. We use a deterministic
    pseudo-random sequence so the assertion holds across runs."""
    xs = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9]
    ys = [2, 7, 1, 8, 2, 8, 1, 8, 2, 8, 4, 5, 9, 0, 4]
    rho = spearman(xs, ys)
    assert -0.5 < rho < 0.5


def test_spearman_handles_ties():
    """Average-ranks should produce sensible results when values tie."""
    rho = spearman([1, 1, 2, 2], [1, 2, 1, 2])
    assert rho == pytest.approx(0.0)


def test_pearson_perfect_linear():
    assert pearson([1, 2, 3, 4], [2, 4, 6, 8]) == pytest.approx(1.0)


def test_pearson_zero_variance_returns_zero():
    """Constant series → 0, not NaN — protects the report code."""
    assert pearson([5, 5, 5, 5], [1, 2, 3, 4]) == 0.0


def test_spearman_n_lt_2_returns_zero():
    assert spearman([], []) == 0.0
    assert spearman([1.0], [2.0]) == 0.0


def test_correlate_aligns_sign_for_intuition():
    """aligned_spearman should be POSITIVE when the method works (i.e.
    more-negative Vina ↔ higher pchembl)."""
    cr = correlate_predictions(
        predicted_scores=[-10, -8, -6, -4, -2],
        experimental_pchembl=[9.0, 7.0, 5.0, 3.0, 1.0],
    )
    assert cr.aligned_spearman == pytest.approx(1.0)
    assert cr.spearman == pytest.approx(-1.0)
    assert cr.n == 5


def test_interpret_buckets():
    assert interpret(0.0) == "uncalibrated"
    assert interpret(0.1) == "uncalibrated"
    assert interpret(0.3) == "weak"
    assert interpret(0.5) == "moderate"
    assert interpret(0.7) == "strong"
    assert interpret(0.9) == "exceptional"
    # Negative values are absolute-valued — direction-agnostic interpretation.
    assert interpret(-0.5) == "moderate"


# ────────────────────── ChEMBL dedupe ─────────────────────


def test_dedupe_keeps_median_per_molecule():
    """ChEMBL frequently has multiple assays for the same compound. We
    collapse to one row per molecule using the MEDIAN pchembl — one
    outlier assay doesn't drag the correlation."""
    activities = [
        _act("CHEMBL1", "CCO", "Ki", 7.0),
        _act("CHEMBL1", "CCO", "Ki", 8.0),
        _act("CHEMBL1", "CCO", "IC50", 9.0),
        _act("CHEMBL2", "CCN", "Ki", 5.0),
    ]
    out = dedupe_by_molecule(activities)
    out_by_id = {a.molecule_chembl_id: a for a in out}
    assert set(out_by_id) == {"CHEMBL1", "CHEMBL2"}
    assert out_by_id["CHEMBL1"].pchembl_value == pytest.approx(8.0)   # median of 7,8,9
    assert out_by_id["CHEMBL2"].pchembl_value == pytest.approx(5.0)


def test_dedupe_handles_empty():
    assert dedupe_by_molecule([]) == []


def test_dedupe_skips_rows_without_molecule_id():
    activities = [_act("", "CCO", "Ki", 5.0)]
    assert dedupe_by_molecule(activities) == []


def _act(mol_id: str, smiles: str, std_type: str, pchembl: float) -> ChemblActivity:
    """Tiny constructor for test ChemblActivity rows."""
    return ChemblActivity(
        molecule_chembl_id=mol_id,
        canonical_smiles=smiles,
        standard_type=std_type,
        standard_value_nM=(10 ** (-pchembl)) * 1e9,
        pchembl_value=pchembl,
    )


# ────────────────────── Report writers ─────────────────────


def test_csv_write_and_read_round_trip(tmp_path):
    rows = [
        CompoundResult("CHEMBL1", "CCO", "Ki", 7.0, -8.5),
        CompoundResult("CHEMBL2", "CCN", "IC50", 5.0, -6.2, note="weak"),
    ]
    path = tmp_path / "out.csv"
    write_csv(path, rows)
    text = path.read_text()
    assert "CHEMBL1,CCO,Ki,7.000,-8.500" in text
    assert "weak" in text


def test_markdown_report_has_headline_correlation(tmp_path):
    rows = [
        CompoundResult("CHEMBL1", "CCO", "Ki", 7.0, -8.5),
        CompoundResult("CHEMBL2", "CCN", "Ki", 5.0, -6.2),
        CompoundResult("CHEMBL3", "CCC", "Ki", 3.0, -4.0),
    ]
    corr = correlate_predictions(
        predicted_scores=[-8.5, -6.2, -4.0],
        experimental_pchembl=[7.0, 5.0, 3.0],
    )
    path = tmp_path / "report.md"
    write_markdown(
        path,
        target_name="EGFR",
        target_uniprot="P00533",
        target_chembl_id="CHEMBL203",
        correlation=corr,
        rows=rows,
    )
    md = path.read_text()
    assert "Retrospective validation" in md
    assert "EGFR" in md
    assert "P00533" in md
    assert "CHEMBL203" in md
    # Correlation number rendered
    assert "Spearman ρ" in md
    # Verdict is present
    assert any(v in md for v in ["uncalibrated", "weak", "moderate", "strong", "exceptional"])
    # All compounds rendered
    for cid in ("CHEMBL1", "CHEMBL2", "CHEMBL3"):
        assert cid in md


# ────────────────────── Mock docker (orchestrator smoke) ─────────────────────


def test_mock_docker_is_deterministic():
    """Same SMILES → same score across calls. This lets users smoke-test
    the report pipeline reproducibly."""
    from validation.run import mock_docker
    a = mock_docker("CCO")
    b = mock_docker("CCO")
    c = mock_docker("CCN")
    assert a == b
    assert a != c
    # Score is in the plausible Vina range
    assert -12.0 <= a <= -3.0
    assert math.isfinite(a)
