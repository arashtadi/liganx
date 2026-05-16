"""Tests for the T4 class-fit / druggability pre-flight check.

The check is the layer ABOVE dockability — it asks 'is this the right
KIND of molecule for THIS target?' rather than 'can Vina parameterise
this molecule at all?'. Designed to catch the job #307 failure mode
where a steroid (Cenestil) was docked against KRAS G13D and returned a
noise-floor score that looked like a real result on the matrix.

All checks are NON-blocking — they surface warnings only, the user can
still submit. Tests verify:
  1. Warnings fire on the right inputs (steroid+KRAS, hexane+kinase, etc.)
  2. Warnings do NOT fire on real approved drugs (Gefitinib+EGFR clean)
  3. Helpers (_is_likely_steroid, _is_kinase_target) are precise — no
     false positives on lookalike inputs (Gefitinib not a steroid,
     KRAS not a kinase).
"""
from deltadock.services.properties import (
    _is_kinase_target,
    _is_likely_steroid,
    check_target_fit,
)
from rdkit import Chem


# ────────────────────── _is_likely_steroid ─────────────────────


def test_cholesterol_is_steroid():
    chol = Chem.MolFromSmiles("CC(C)CCCC(C)C1CCC2C1(CCC3C2CC=C4C3(CCC(C4)O)C)C")
    assert _is_likely_steroid(chol)


def test_estradiol_aromatic_a_ring_is_steroid():
    """Aromatic A-ring oestrogens must still be detected — the SMARTS is
    permissive on aromaticity so this isn't missed."""
    est = Chem.MolFromSmiles("CC12CCC3c4ccc(O)cc4CCC3C1CCC2O")
    assert _is_likely_steroid(est)


def test_testosterone_is_steroid():
    test_sm = Chem.MolFromSmiles("CC12CCC3C(C1CCC2O)CCC4=CC(=O)CCC34C")
    assert _is_likely_steroid(test_sm)


def test_gefitinib_is_not_steroid():
    """A drug-like aromatic kinase inhibitor must NOT trip the steroid
    check — the most important false-positive guard."""
    gef = Chem.MolFromSmiles("COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1")
    assert not _is_likely_steroid(gef)


def test_caffeine_is_not_steroid():
    caf = Chem.MolFromSmiles("CN1C=NC2=C1C(=O)N(C(=O)N2C)C")
    assert not _is_likely_steroid(caf)


def test_benzene_is_not_steroid():
    bz = Chem.MolFromSmiles("c1ccccc1")
    assert not _is_likely_steroid(bz)


# ────────────────────── _is_kinase_target ─────────────────────


def test_egfr_is_kinase():
    assert _is_kinase_target("egfr", "EGFR kinase domain")


def test_braf_is_kinase():
    assert _is_kinase_target("braf", "BRAF kinase")


def test_kras_is_not_kinase():
    """KRAS is a GTPase, not a kinase. The earlier substring-on-
    description heuristic falsely classified KRAS as kinase because the
    description contained 'undruggable' (which contains 'abl'). The
    explicit ID allowlist fixes that."""
    assert not _is_kinase_target("kras", "KRAS GTPase")


def test_idh1_is_not_kinase():
    """IDH1 is a dehydrogenase."""
    assert not _is_kinase_target("idh1", "IDH1 (isocitrate dehydrogenase 1)")


def test_off_catalog_target_caught_by_name_word_boundary():
    """Off-catalog targets (resolved by PDB id, not catalog slug) still
    get the kinase classification via word-boundary search."""
    assert _is_kinase_target("some-other", "JAK2 kinase domain")
    # Word-boundary: 'kinase' inside random text should NOT match.
    assert not _is_kinase_target("nope", "kinaserelated thing")


# ────────────────────── check_target_fit — job-307 scenarios ─────────────────────


def test_job307_steroid_against_kras_fires_class_mismatch():
    """The headline failure mode the user demanded we catch:
    cholesterol-like steroid against KRAS. Must produce a 'high'-level
    steroid_class_mismatch warning."""
    r = check_target_fit(
        "CC(C)CCCC(C)C1CCC2C1(CCC3C2CC=C4C3(CCC(C4)O)C)C",
        target_id="kras",
    )
    kinds = {w["kind"] for w in r["warnings"]}
    assert "steroid_class_mismatch" in kinds
    # And the level must be 'high', not info or warn — chemist needs
    # to see this loud.
    steroid_warning = next(w for w in r["warnings"] if w["kind"] == "steroid_class_mismatch")
    assert steroid_warning["level"] == "high"


def test_kras_target_recent_info_surfaces():
    """KRAS is in the 'recent' druggability tier — info-level note
    must fire."""
    r = check_target_fit("c1ccc(cc1)c2ccccc2", target_id="kras")    # biphenyl, generic
    kinds = {w["kind"] for w in r["warnings"]}
    assert "target_recent" in kinds


def test_idh1_experimental_target_fires_warning():
    """IDH1 is in the 'experimental' tier (approved drugs are
    allosteric, NOT at the cofactor pocket this catalog boxes).
    Must produce a 'warn' on experimental druggability."""
    r = check_target_fit("c1ccc(cc1)C(=O)N", target_id="idh1")
    kinds = {w["kind"] for w in r["warnings"]}
    assert "target_experimental" in kinds


def test_kinase_with_aromatic_drug_is_clean():
    """A real approved EGFR drug (Gefitinib) against EGFR must produce
    ZERO warnings — this is the false-positive guard."""
    r = check_target_fit(
        "COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1",
        target_id="egfr",
    )
    assert r["warnings"] == []


# ────────────────────── compound-only warnings (no target) ─────────────────────


def test_fragment_sized_compound_fires():
    """MW < 200 OR heavy < 12 — fragment-sized warning."""
    r = check_target_fit("CCO", target_id=None)                   # ethanol, MW 46
    kinds = {w["kind"] for w in r["warnings"]}
    assert "fragment_sized" in kinds


def test_pure_hydrocarbon_fires_no_hbond_warning():
    """A purely hydrocarbon compound (no H-bond donors/acceptors)
    can't form specific contacts. Must produce the no_hbond_groups
    warning."""
    r = check_target_fit("CCCCCCCCCC", target_id=None)            # decane
    kinds = {w["kind"] for w in r["warnings"]}
    assert "no_hbond_groups" in kinds


def test_no_target_id_still_produces_compound_only_warnings():
    """Without a target_id, target-aware checks are skipped — but
    compound-only checks (fragment-sized, no-Hbond-groups) still run."""
    r = check_target_fit("CCO")                                   # no target
    # MW=46 → fragment_sized fires
    kinds = {w["kind"] for w in r["warnings"]}
    assert "fragment_sized" in kinds
    # No target-dependent warnings
    assert "steroid_class_mismatch" not in kinds
    assert "target_experimental" not in kinds
    assert "target_recent" not in kinds


# ────────────────────── kinase + no aromatic ─────────────────────


def test_kinase_target_with_no_aromatic_compound_fires():
    """Hexane (no aromatic rings) docked against EGFR — the
    kinase_needs_aromatic warning must fire."""
    r = check_target_fit("CCCCCCCCCC", target_id="egfr")
    kinds = {w["kind"] for w in r["warnings"]}
    assert "kinase_needs_aromatic" in kinds


def test_non_kinase_target_does_not_fire_aromatic_warning():
    """The aromatic-ring rule is kinase-specific. Docking a non-aromatic
    compound against KRAS (a GTPase) must NOT produce the kinase
    warning."""
    r = check_target_fit("CCCCCCCCCC", target_id="kras")
    kinds = {w["kind"] for w in r["warnings"]}
    assert "kinase_needs_aromatic" not in kinds


# ────────────────────── input edge cases ─────────────────────


def test_empty_smiles_returns_empty_warnings():
    r = check_target_fit("", target_id="egfr")
    assert r["warnings"] == []


def test_invalid_smiles_returns_empty_warnings():
    """Invalid SMILES is handled by check_dockability; this layer
    silently returns no warnings rather than crashing."""
    r = check_target_fit("not a real SMILES", target_id="egfr")
    assert r["warnings"] == []


def test_unknown_target_id_falls_through_to_compound_only():
    """An unknown target_id silently skips target-aware checks (the
    caller may be passing a custom PDB)."""
    r = check_target_fit("CCO", target_id="not-in-catalog")
    kinds = {w["kind"] for w in r["warnings"]}
    # Compound-only checks still ran.
    assert "fragment_sized" in kinds
    # Target-dependent checks skipped.
    assert "target_experimental" not in kinds
    assert "kinase_needs_aromatic" not in kinds


def test_warnings_are_serializable():
    """The endpoint depends on each warning being a plain dict with
    string keys/values — pin the schema."""
    r = check_target_fit(
        "CC(C)CCCC(C)C1CCC2C1(CCC3C2CC=C4C3(CCC(C4)O)C)C",
        target_id="kras",
    )
    for w in r["warnings"]:
        assert set(w.keys()) >= {"kind", "level", "message"}
        assert w["level"] in {"info", "warn", "high"}
        assert isinstance(w["kind"], str) and w["kind"]
        assert isinstance(w["message"], str) and w["message"]
