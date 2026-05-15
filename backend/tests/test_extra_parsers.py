"""Parity + coverage tests for the Python `extra`-string parser.

The runner writes every DockingResult.extra as a pipe-delimited
key=value string (plus bare failure prefixes). TWO parsers consume it:

  * frontend/src/lib/parseExtra.ts        — drives the matrix / PoseDetail UI
  * backend ask_ai._summarize_extra       — feeds the Liganx AI job snapshot

If those two drift, the AI confidently describes a different result than
the one the user sees on screen. The audit called this out as a P0 test
gap. The FIXTURES here are deliberately the SAME strings asserted in
frontend/src/__tests__/parseExtra.test.ts — keep the two in sync. Adding
a key to the runner's extra format means updating BOTH tests.

This file only touches deltadock.services.ask_ai, which imports httpx +
pydantic + stdlib (no DB, no FastAPI app, no RDKit) — so it runs on a
light dependency set.
"""
from deltadock.services.ask_ai import _summarize_extra


def test_empty_input_returns_empty_dict():
    assert _summarize_extra(None) == {}
    assert _summarize_extra("") == {}


def test_unknown_keys_and_junk_fragments_are_ignored():
    out = _summarize_extra("totally_unknown=42|no_equals_here|engine=local")
    assert out["engine"] == "local"
    assert "totally_unknown" not in out


def test_failure_prefix_ligand_prep_bails_early():
    out = _summarize_extra("ligand_prep_failed: RDKit could not embed SMILES")
    assert out["failure"] == {
        "kind": "ligand_prep",
        "reason": "RDKit could not embed SMILES",
    }
    # ligand_prep bails — nothing else parsed.
    assert set(out.keys()) == {"failure"}


def test_failure_prefix_docking():
    out = _summarize_extra("docking_failed: Vina exited 1")
    assert out["failure"]["kind"] == "docking"


def test_failure_prefix_mutant_build_keeps_parsing_trailing_fields():
    out = _summarize_extra(
        "mutant_build_failed:residue not modeled|engine=local|vinardo=-5.10"
    )
    assert out["failure"]["kind"] == "mutant_build"
    # mutant_build does NOT bail — trailing engine/vinardo still parse.
    assert out["engine"] == "local"
    assert out["vinardo"] == -5.10


def test_individual_scalar_keys():
    out = _summarize_extra(
        "confidence=high|vinardo=-4.62|foldx_ddg=-0.66|iface_bsa=712.4|iface_hb=3"
    )
    assert out["confidence"] == "high"
    assert out["vinardo"] == -4.62
    assert out["foldxDDG"] == -0.66
    assert out["interfaceBsa"] == 712.4
    assert out["interfaceHbonds"] == 3


def test_confidence_rejects_invalid_value():
    assert "confidence" not in _summarize_extra("confidence=garbage")


def test_strain_and_water():
    out = _summarize_extra("strain=mild:5.40|water=6/9")
    assert out["strain"] == {"verdict": "mild", "kcal": 5.40}
    assert out["water"] == {"displaced": 6, "pocket_count": 9}


def test_boltz2_fields():
    out = _summarize_extra(
        "aff_value=-1.8|aff_prob=0.83|pocket_residues=14|boltz2_aligned_to_wt=1.2A"
    )
    assert out["affValue"] == -1.8
    assert out["affProb"] == 0.83
    assert out["pocketResidues"] == 14
    assert out["boltz2AlignedRmsd"] == 1.2


def test_vina_terms_decomposition():
    out = _summarize_extra(
        "vina_terms=g1:-42.04,g2:-1115.74,rep:4.46,hyd:-19.39,hb:-2.07,total:-8.42"
    )
    assert out["vinaTerms"] == {
        "g1": -42.04, "g2": -1115.74, "rep": 4.46,
        "hyd": -19.39, "hb": -2.07, "total": -8.42,
    }


def test_mutation_outside_pocket():
    assert _summarize_extra("mutation_outside_pocket=19.2A")["outsidePocketA"] == 19.2


def test_contacts_count_and_sample():
    out = _summarize_extra(
        "contacts=LYS745:HBAcceptor:2.6,MET793:Hydrophobic:3.1,ASP855:Ionic"
    )
    assert out["contacts_count"] == 3
    assert out["contacts_sample"] == ["LYS745", "MET793", "ASP855"]


# ── Ensemble docking (shipped 2026-05-15) ──────────────────────────────

def test_ensemble_keys_parse_into_ensemble_object():
    out = _summarize_extra("ensemble=3/4|ens_spread=0.74|ens_best=conf2")
    assert out["ensemble"] == {"docked": 3, "total": 4, "spread": 0.74, "best": "conf2"}


def test_ensemble_segment_order_does_not_matter():
    out = _summarize_extra("ens_best=input|ensemble=1/1|ens_spread=0.00")
    assert out["ensemble"] == {"docked": 1, "total": 1, "spread": 0.0, "best": "input"}


def test_ensemble_malformed_ratio_is_ignored_not_crashing():
    out = _summarize_extra("ensemble=notaratio|ens_spread=0.5")
    # the bad N/M just doesn't set docked/total; spread still merges
    assert out["ensemble"] == {"spread": 0.5}


def test_posebusters_check_skipped_promotes_confidence():
    out = _summarize_extra("posebusters=check_skipped: timeout")
    assert out["confidence"] == "skipped"


def test_explicit_confidence_not_overridden_by_skipped_posebusters():
    out = _summarize_extra("confidence=high|posebusters=check_skipped: timeout")
    assert out["confidence"] == "high"


def test_realistic_full_ensemble_cell_end_to_end():
    out = _summarize_extra(
        "pocket=catalog|engine=pod_gpu_ensemble|ensemble=4/4|ens_spread=0.91"
        "|ens_best=conf1|vinardo=-7.21|strain=ok:1.10|confidence=high"
        "|posebusters=passed all 18 checks"
        "|contacts=LYS745:HBAcceptor:2.6,MET793:Hydrophobic:3.1|water=2/5"
    )
    assert out["engine"] == "pod_gpu_ensemble"
    assert out["ensemble"] == {"docked": 4, "total": 4, "spread": 0.91, "best": "conf1"}
    assert out["vinardo"] == -7.21
    assert out["strain"] == {"verdict": "ok", "kcal": 1.10}
    assert out["confidence"] == "high"
    assert out["contacts_count"] == 2
    assert out["water"] == {"displaced": 2, "pocket_count": 5}
    assert "failure" not in out
