"""Unit tests for the Vina log parser — runs without Vina installed."""

from deltadock_pipeline.dock import parse_vina_log


SAMPLE_LOG = """\
Reading input ... done.
Setting up the scoring function ... done.
Analyzing the binding site ... done.
Using random seed: 42

mode |   affinity | dist from best mode
     | (kcal/mol) | rmsd l.b.| rmsd u.b.
-----+------------+----------+----------
   1       -10.51      0.000      0.000
   2        -9.87      1.245      3.418
   3        -9.42      2.103      4.217
   4        -8.91      1.892      6.005
"""


def test_parse_three_modes():
    modes = parse_vina_log(SAMPLE_LOG)
    assert len(modes) == 4
    assert modes[0].rank == 1
    assert modes[0].affinity_kcal_mol == -10.51
    assert modes[3].affinity_kcal_mol == -8.91


def test_parse_empty():
    assert parse_vina_log("") == []
    assert parse_vina_log("just header lines\nno data") == []


def test_best_mode_is_first():
    modes = parse_vina_log(SAMPLE_LOG)
    best = min(m.affinity_kcal_mol for m in modes)
    assert best == -10.51
