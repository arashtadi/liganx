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
