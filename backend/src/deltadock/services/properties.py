"""RDKit-only molecular property calculations.

Keeps the AI assistant snappy: properties (MW, logP, TPSA, QED, Lipinski,
Veber, PAINS) are derivable from a SMILES in milliseconds without an LLM
call. Used by /assist/properties so the user gets instant feedback as
they sketch, plus included in /assist/compound responses to ground the
LLM's rationale in real numbers.

PAINS detection uses the FilterCatalog with the PAINS A/B/C catalogs.
We deliberately surface PAINS hits without auto-blocking — they're
"this needs a chemist's eye" warnings, not hard rejections.
"""
from __future__ import annotations

from typing import Optional, TypedDict

from rdkit import Chem
from rdkit.Chem import AllChem, Crippen, Descriptors, Lipinski, QED
from rdkit.Chem.FilterCatalog import FilterCatalog, FilterCatalogParams


class PainsHit(TypedDict):
    name: str
    description: str


class PropertiesResult(TypedDict, total=False):
    valid: bool
    canonical_smiles: str
    mw: float            # g/mol
    logp: float          # Crippen wlogP
    tpsa: float          # Å²
    hba: int             # H-bond acceptors
    hbd: int             # H-bond donors
    rotatable_bonds: int
    heavy_atoms: int
    qed: float           # 0-1, higher = more drug-like
    lipinski_pass: bool  # all 4 of MW≤500, logP≤5, HBD≤5, HBA≤10
    veber_pass: bool     # rot_bonds≤10, TPSA≤140
    pains_hits: list[PainsHit]
    error: str


# Build PAINS filter once at import. RDKit's FilterCatalog construction
# is fast (~10ms) but doing it per-request would still add up under load.
_PAINS_PARAMS = FilterCatalogParams()
_PAINS_PARAMS.AddCatalog(FilterCatalogParams.FilterCatalogs.PAINS_A)
_PAINS_PARAMS.AddCatalog(FilterCatalogParams.FilterCatalogs.PAINS_B)
_PAINS_PARAMS.AddCatalog(FilterCatalogParams.FilterCatalogs.PAINS_C)
_PAINS_CATALOG = FilterCatalog(_PAINS_PARAMS)


def compute_properties(smiles: str) -> PropertiesResult:
    """Compute the full property panel for one SMILES string.

    Returns a TypedDict — never raises. On invalid SMILES returns
    {valid: False, error: <reason>}; on valid input every numeric field
    is filled. Numbers are rounded for display (the AI assistant pipes
    these straight into the chat panel)."""
    smi = (smiles or "").strip()
    if not smi:
        return PropertiesResult(valid=False, error="Empty SMILES")
    mol = Chem.MolFromSmiles(smi)
    if mol is None:
        return PropertiesResult(valid=False, error="RDKit could not parse this SMILES")

    try:
        canonical = Chem.MolToSmiles(mol)
        mw = Descriptors.MolWt(mol)
        logp = Crippen.MolLogP(mol)
        tpsa = Descriptors.TPSA(mol)
        hba = Lipinski.NumHAcceptors(mol)
        hbd = Lipinski.NumHDonors(mol)
        rotb = Lipinski.NumRotatableBonds(mol)
        heavy = mol.GetNumHeavyAtoms()
        qed = QED.qed(mol)

        # Lipinski rule-of-5: MW<=500, logP<=5, HBD<=5, HBA<=10. We
        # report it as a boolean pass; individual breakdowns are obvious
        # from the per-field numbers above.
        lipinski_pass = (mw <= 500.0 and logp <= 5.0 and hbd <= 5 and hba <= 10)
        # Veber: rotatable bonds <= 10 AND TPSA <= 140. Common
        # oral-bioavailability filter alongside Lipinski.
        veber_pass = (rotb <= 10 and tpsa <= 140.0)

        pains_hits: list[PainsHit] = []
        # FilterCatalog matches return the FIRST matching entry by
        # default; GetMatches returns all, useful for compounds that
        # trip multiple alerts.
        for entry in _PAINS_CATALOG.GetMatches(mol):
            pains_hits.append(
                PainsHit(
                    name=entry.GetDescription() or "PAINS hit",
                    description=entry.GetProp("Reference") if entry.HasProp("Reference") else "",
                )
            )

        return PropertiesResult(
            valid=True,
            canonical_smiles=canonical,
            mw=round(mw, 1),
            logp=round(logp, 2),
            tpsa=round(tpsa, 1),
            hba=int(hba),
            hbd=int(hbd),
            rotatable_bonds=int(rotb),
            heavy_atoms=int(heavy),
            qed=round(qed, 3),
            lipinski_pass=bool(lipinski_pass),
            veber_pass=bool(veber_pass),
            pains_hits=pains_hits,
        )
    except Exception as e:
        # Anything weird (e.g. a SMILES that parses but trips one of
        # the descriptor calculators on edge cases) — return a partial
        # error rather than 500.
        return PropertiesResult(
            valid=False,
            error=f"Property calculation failed: {type(e).__name__}: {e}",
        )


def validate_smiles(smiles: str) -> tuple[bool, Optional[str], Optional[str]]:
    """Lightweight wrapper for callers that just want to know "is this a
    valid molecule?" plus the canonicalised form. Used by the assistant
    endpoint to validate the LLM's output before shipping it back to
    the client. Returns (valid, canonical_smiles, error_message)."""
    smi = (smiles or "").strip()
    if not smi:
        return False, None, "Empty SMILES"
    mol = Chem.MolFromSmiles(smi)
    if mol is None:
        return False, None, "RDKit could not parse this SMILES"
    try:
        # Roundtrip to canonical form so two equivalent SMILES strings
        # (e.g. CCO vs OCC) compare equal downstream.
        return True, Chem.MolToSmiles(mol), None
    except Exception as e:
        return False, None, f"Canonicalisation failed: {e}"


# ──────────────────────────────────────────────────────────────────────
# Dockability check
# ──────────────────────────────────────────────────────────────────────
#
# Atoms AutoDock Vina + GNINA can actually parameterise.
#
# PhD audit (2026-05-01) corrected an earlier overclaim: Boron (B) and
# Silicon (Si) were in this set, but Vina/GNINA don't have proper atom
# types for either — they either silently fall back to a generic carbon
# type (giving meaningless scores) or trip Meeko's parameterisation.
# Removed from the allowlist; users sketching boron/silicon fragments
# now get an honest "engine can't do that" message instead of a misleading
# pass at the gate.
#
# The "experimental metals" set (Mg, Ca, Mn, Fe, Co, Cu) are technically
# supported by Vina's scoring function but only give meaningful scores
# in true metalloprotein pockets with metal-aware scoring tweaks. We
# allow them through the gate (so users *can* dock metalloprotein
# substrates) but the message flags them as experimental so users
# know not to over-trust the affinity number. Zn is the one well-
# validated case (zinc proteases, carbonic anhydrase) and is treated
# as standard.
_VINA_SUPPORTED_ELEMENTS: set[str] = {
    "H", "C", "N", "O", "F", "P", "S",
    "Cl", "Br", "I",
    "Mg", "Ca", "Mn", "Fe", "Co", "Cu", "Zn",
}

# Subset of the allowlist that gets an "experimental — affinity may be
# unreliable" badge in property responses. Zn is excluded because Vina's
# zinc handling has been validated against zinc-binding inhibitor
# benchmarks; the others have not.
_EXPERIMENTAL_METALS: set[str] = {"Mg", "Ca", "Mn", "Fe", "Co", "Cu"}

# Sensible bounds. Below 4 heavy atoms = not really a drug candidate
# (water, ammonia, etc.). Above 80 heavy atoms = Vina's flexibility model
# breaks down; macrocyclic peptides should go to Boltz-2.
_MIN_HEAVY_ATOMS = 4
_MAX_HEAVY_ATOMS = 80


class DockabilityResult(TypedDict, total=False):
    dockable: bool
    reason: str            # human-readable failure reason; empty when dockable
    suggestion: str        # actionable next-step the user can take
    canonical_smiles: str  # canonical form when dockable=True
    warnings: list[str]    # non-blocking caveats (e.g. experimental metals)


def check_dockability(smiles: str) -> DockabilityResult:
    """Pre-flight check: would this SMILES survive AutoDock Vina /
    GNINA's ligand-prep step?

    Layered cheap-to-expensive:
      1. RDKit parse (instant) — catches malformed SMILES.
      2. Atom allowlist (instant) — catches arsenic, lead, etc.
      3. Salt / disconnected-fragment check (instant) — catches
         '[Na+].CC(=O)C'-style salts where the active ingredient
         isn't isolated.
      4. Size bounds (instant) — too small isn't a drug, too large
         breaks Vina's flexibility model.

    Returns dockable=True with the canonical SMILES, or dockable=False
    with a specific human-readable reason + actionable suggestion the
    UI can show verbatim. Never raises.

    Deliberately omits the Meeko prepare_ligand dry-run (would catch
    Lorlatinib-style macrocycle prep failures) — Meeko's prep is heavy
    (~500ms per call) and sometimes false-rejects valid molecules. The
    runner has self-heal for those, and false-positives at the save
    gate would be a worse user experience than letting them slip
    through to the existing FAILED + Telegram-alert + Re-run UX.
    """
    smi = (smiles or "").strip()
    if not smi:
        return DockabilityResult(
            dockable=False,
            reason="No structure was provided.",
            suggestion="Draw or paste a molecule on the canvas first.",
        )

    mol = Chem.MolFromSmiles(smi)
    if mol is None:
        return DockabilityResult(
            dockable=False,
            reason="RDKit couldn't parse this SMILES — the structure isn't a valid molecule.",
            suggestion="Re-draw the structure in the editor, or check your SMILES for typos.",
        )

    # Atom allowlist — find the first unsupported element so the message
    # tells the user what specifically tripped the check, not just "some
    # atom is bad". Sorting by symbol gives stable output for tests.
    seen_unsupported: list[str] = []
    for atom in mol.GetAtoms():
        sym = atom.GetSymbol()
        if sym not in _VINA_SUPPORTED_ELEMENTS:
            if sym not in seen_unsupported:
                seen_unsupported.append(sym)
    if seen_unsupported:
        bad = sorted(seen_unsupported)
        bad_str = ", ".join(bad) if len(bad) > 1 else bad[0]
        # Special-case Boron and Silicon, since users sketching these
        # often expect them to "just work" (they're common in protecting
        # groups and silicon-isosteres). Tell them why explicitly.
        boron_silicon_note = ""
        bs_present = [s for s in bad if s in ("B", "Si")]
        if bs_present:
            bs_str = " and ".join(bs_present)
            boron_silicon_note = (
                f" {bs_str} in particular: AutoDock Vina and GNINA don't have "
                f"proper atom-type parameters for {bs_str}, so any score we'd "
                f"return would be misleading."
            )
        return DockabilityResult(
            dockable=False,
            reason=(
                f"This molecule contains {bad_str}, which AutoDock Vina and GNINA "
                f"can't reliably dock. These engines support C, H, N, O, F, P, S, "
                f"halogens (Cl, Br, I), and a handful of biological metals "
                f"(Zn validated; Mg, Ca, Mn, Fe, Co, Cu experimental).{boron_silicon_note}"
            ),
            suggestion=(
                "Try a different functional group, or contact us about Boltz-2 "
                "(our ML co-folding engine) which supports a broader chemical space."
            ),
        )

    # Salt / disconnected-fragment check. Multiple disconnected pieces
    # are almost always a salt form (e.g. [Na+].CC(=O)C). Vina can
    # only dock one molecule at a time — the user needs the active
    # ingredient on its own.
    fragments = Chem.GetMolFrags(mol, asMols=False)
    if len(fragments) > 1:
        return DockabilityResult(
            dockable=False,
            reason=(
                f"This compound has {len(fragments)} disconnected pieces — "
                f"it's probably a salt form (e.g. a sodium counter-ion plus the active drug)."
            ),
            suggestion=(
                "Remove the counter-ion in the editor and use just the active ingredient. "
                "Salts dissociate in solution anyway, so docking the free form is the right call."
            ),
        )

    # Size bounds.
    heavy = mol.GetNumHeavyAtoms()
    if heavy < _MIN_HEAVY_ATOMS:
        return DockabilityResult(
            dockable=False,
            reason=f"This molecule has only {heavy} heavy atom(s) — too small to be a meaningful ligand.",
            suggestion="Most drug candidates have at least 10-15 heavy atoms. Build out a larger scaffold.",
        )
    if heavy > _MAX_HEAVY_ATOMS:
        return DockabilityResult(
            dockable=False,
            reason=(
                f"This molecule has {heavy} heavy atoms — too large for Vina-style docking. "
                f"Vina's flexibility model breaks down past ~80 heavy atoms."
            ),
            suggestion=(
                "For very large or macrocyclic compounds, contact us about Boltz-2 "
                "(ML co-folding) which handles larger ligands."
            ),
        )

    # All checks passed — molecule is shape-OK for the Vina/GNINA
    # pipeline. Return the canonical SMILES so the caller can use it
    # downstream without re-parsing.
    try:
        canonical = Chem.MolToSmiles(mol)
    except Exception:
        canonical = smi

    # Non-blocking warnings: experimental metals are dockable in the
    # software sense but the affinity numbers should not be over-trusted.
    # PhD audit (2026-05-01): Zn is the well-validated case; the others
    # in _EXPERIMENTAL_METALS need a domain-aware reviewer to interpret.
    warnings: list[str] = []
    present_metals = sorted({a.GetSymbol() for a in mol.GetAtoms()
                             if a.GetSymbol() in _EXPERIMENTAL_METALS})
    if present_metals:
        metals_str = ", ".join(present_metals)
        warnings.append(
            f"Contains {metals_str} — Vina/GNINA can run on this molecule, "
            f"but their scoring functions are not specifically tuned for "
            f"non-zinc metals. Treat the affinity score as experimental."
        )
    if warnings:
        return DockabilityResult(
            dockable=True,
            canonical_smiles=canonical,
            warnings=warnings,
        )
    return DockabilityResult(dockable=True, canonical_smiles=canonical)
