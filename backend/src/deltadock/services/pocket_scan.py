"""(N4.1) Pocket residue scanning for the resistance-mapping feature.

Identifies all protein residues with any heavy atom within a distance
cutoff of any ligand heavy atom. The output is the candidate-mutation
set for N4's resistance scan — every residue returned here is a
candidate to feed into the ΔΔG predictor (services/ddg_predictor.py)
to estimate whether mutating it would affect binding.

WHY 6 Å DEFAULT CUTOFF:
  • <4 Å picks up only direct contacts (H-bonds, salt bridges,
    π-stacking). Misses second-shell residues whose mutation
    rearranges the pocket without contacting the ligand.
  • 5–6 Å is the standard "binding-site" definition in the FoldX
    / MutateX / Rosetta ddG literature. Captures both direct
    contacts and the residues immediately lining the cleft.
  • >8 Å becomes noisy — picks up residues whose mutation has
    only a marginal effect on the pocket geometry.

WHY HEAVY ATOMS ONLY:
  Hydrogen positions depend on protonation-state assignment
  (PROPKA, PDBFixer, Reduce) and the conformer-embed routine
  used to place the ligand. Including hydrogens makes the scan
  sensitive to upstream tooling choices that aren't load-bearing
  for "is this residue near the ligand." Heavy-atom-only matches
  the convention in MutateX (Tiberti et al, 2022) and FoldX
  Suite (Delgado et al, 2019).

WHY POSE-DEPENDENT:
  Pocket scanning without a docked pose is meaningless — you'd
  just be measuring distances to some arbitrary embed of the
  ligand floating in space. The caller MUST supply a real docked
  pose (the pose from a parent GNINA / QuickVina job, or the
  starting pose from a completed FEP study).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable, Optional, Union

log = logging.getLogger(__name__)


# Backbone-atom names per the PDB standard. Used to detect
# "backbone-only" contacts — these are less informative for
# resistance prediction because mutation preserves the backbone
# atoms; only side-chain identity changes.
_BACKBONE_ATOMS = frozenset({"N", "CA", "C", "O", "OXT"})

# Standard 20 amino-acid 3-letter codes. Anything outside this set
# (HETATM ligands, modified residues, waters, ions) is dropped from
# the scan. Resistance mutation only makes sense for standard residues.
_STANDARD_AAS = frozenset({
    "ALA", "ARG", "ASN", "ASP", "CYS",
    "GLN", "GLU", "GLY", "HIS", "ILE",
    "LEU", "LYS", "MET", "PHE", "PRO",
    "SER", "THR", "TRP", "TYR", "VAL",
})


@dataclass
class PocketResidue:
    """A protein residue identified as being in the ligand's binding
    pocket. Carries enough information for the downstream ΔΔG
    predictor to construct a mutation request, plus UI-confidence
    hints so the resistance heatmap can render backbone-only / loop
    residues with a "low-confidence" badge.

    Fields:
        chain: PDB chain identifier (typically "A"). Stripped of
            whitespace.
        resnum: PDB-numbered residue number (1-indexed, not array
            index). Includes the original numbering from the PDB
            file so it matches what the chemist sees in PyMOL /
            ChimeraX.
        resname: 3-letter amino-acid code (e.g. "LEU", "PHE").
        min_dist: Minimum distance in Å from any heavy atom of this
            residue to any heavy atom of the ligand. Rounded to 3
            decimal places — sub-mÅ precision is meaningless given
            crystallographic uncertainty.
        closest_atom: Atom name of the residue atom that achieves
            min_dist (e.g. "CA", "CD2", "NZ"). Used by UI tooltips.
        is_backbone_only: True if the closest contact is on the
            backbone (N/CA/C/O/OXT) rather than the side chain.
            Resistance prediction is less informative here because
            mutation preserves backbone identity; side-chain
            contacts are the load-bearing ones. UI should render
            these with reduced opacity.
    """
    chain: str
    resnum: int
    resname: str
    min_dist: float
    closest_atom: str
    is_backbone_only: bool

    def to_dict(self) -> dict:
        """JSON-serialisable form for API responses."""
        return asdict(self)

    def to_mutation_label(self, new_residue: str) -> str:
        """Format as a single-residue mutation label (e.g. 'T790M'
        for THR-790 → MET). Used to build mutation strings for the
        ΔΔG predictor downstream. Caller supplies the new residue
        as a 1-letter code."""
        three_to_one = {
            "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C",
            "GLN": "Q", "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I",
            "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P",
            "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V",
        }
        wt_one = three_to_one.get(self.resname.upper(), "X")
        return f"{wt_one}{self.resnum}{new_residue.upper()}"


def scan_pocket_residues(
    receptor_pdb: Union[Path, str],
    ligand_sdf: Union[Path, str],
    *,
    distance_cutoff_angstroms: float = 6.0,
    chain_filter: Optional[str] = None,
    exclude_residues: Iterable[str] = ("HOH", "WAT", "DOD"),
) -> list[PocketResidue]:
    """Return all protein residues with any heavy atom within
    ``distance_cutoff_angstroms`` of any ligand heavy atom.

    Sorted by ``min_dist`` ascending (closest first).

    Args:
        receptor_pdb: Path to a PDB file containing the protein
            structure. Can be either the cleaned WT structure or
            the mutant structure — distances are computed from
            whichever is provided.
        ligand_sdf: Path to an SDF file containing the docked
            ligand. Must have 3D coordinates (Conformer object).
            First conformer is used; multi-conformer SDFs should
            be filtered upstream.
        distance_cutoff_angstroms: Heavy-atom cutoff for "in pocket"
            classification. See module docstring for rationale.
        chain_filter: If set, only consider residues from this chain.
            Useful when the PDB has multiple chains and the ligand
            only binds one (e.g. ABL1 dimer crystals).
        exclude_residues: 3-letter residue codes to skip. Default
            excludes waters; can be extended for cofactors / metals
            the caller doesn't want to flag.

    Returns:
        List of PocketResidue dataclasses, sorted by distance
        ascending. Empty list if no residues are within cutoff
        (likely indicates a bad pose or mismatched coordinate
        systems).

    Raises:
        ValueError: ligand SDF is empty / unparseable, or receptor
            PDB has no atoms.
        FileNotFoundError: either input path doesn't exist.

    Performance note: O(N_protein_atoms × N_ligand_atoms). For a
    typical 300-residue domain × 30 ligand heavy atoms that's
    ~70k distance computations — runs in <100 ms on a single core.
    No need for kd-trees / spatial indexing at this scale.
    """
    receptor_pdb = Path(receptor_pdb)
    ligand_sdf = Path(ligand_sdf)
    if not receptor_pdb.exists():
        raise FileNotFoundError(f"Receptor PDB not found: {receptor_pdb}")
    if not ligand_sdf.exists():
        raise FileNotFoundError(f"Ligand SDF not found: {ligand_sdf}")

    # ── Parse ligand: first conformer, heavy atoms only. ──
    from rdkit import Chem
    suppl = Chem.SDMolSupplier(str(ligand_sdf), removeHs=True, sanitize=True)
    mol = next((m for m in suppl if m is not None), None)
    if mol is None:
        raise ValueError(
            f"No valid molecule in {ligand_sdf} (RDKit returned None "
            "for all entries — file may be empty or malformed)"
        )
    if mol.GetNumConformers() == 0:
        raise ValueError(
            f"Ligand {ligand_sdf} has no 3D conformer. Resistance "
            "scanning requires a docked pose, not a SMILES embed."
        )
    conf = mol.GetConformer(0)
    ligand_coords: list[tuple[float, float, float]] = []
    for i in range(mol.GetNumAtoms()):
        if mol.GetAtomWithIdx(i).GetAtomicNum() == 1:
            continue                                # skip hydrogens
        p = conf.GetAtomPosition(i)
        ligand_coords.append((p.x, p.y, p.z))
    if not ligand_coords:
        raise ValueError(
            f"Ligand {ligand_sdf} has no heavy atoms after H-removal"
        )

    # ── Parse receptor. ──
    from Bio.PDB import PDBParser
    parser = PDBParser(QUIET=True)
    structure = parser.get_structure("receptor", str(receptor_pdb))
    excluded = {r.upper() for r in exclude_residues}
    cutoff_sq = distance_cutoff_angstroms ** 2

    # ── Distance scan. ──
    # Per-(chain, resnum) we track the closest atom and its distance.
    # We iterate residues, then atoms in residue, then ligand heavy
    # atoms — keeping the min throughout. Sorting + dedup at the end.
    by_residue: dict[tuple[str, int], PocketResidue] = {}

    for model in structure:
        for chain in model:
            chain_id = chain.id.strip() or " "
            if chain_filter is not None and chain_id != chain_filter:
                continue
            for residue in chain:
                resname = residue.get_resname().strip().upper()
                # Skip hetatms (water, ions, ligands) and non-standard residues.
                # residue.id[0] is " " for standard ATOM records,
                # "H_<HET>" for HETATM, "W" for waters.
                het_flag = residue.id[0]
                if het_flag != " ":
                    continue
                if resname in excluded:
                    continue
                if resname not in _STANDARD_AAS:
                    continue                        # modified residues — skip for v1

                resnum = residue.id[1]
                min_dist_sq = float("inf")
                min_atom_name = ""

                for atom in residue.get_atoms():
                    # Skip hydrogens — see WHY HEAVY ATOMS ONLY in module docstring.
                    # element may be None on some old PDB files; fall back to name.
                    el = (atom.element or "").strip().upper()
                    if el == "H":
                        continue
                    if not el and atom.get_name().startswith("H"):
                        continue
                    ax, ay, az = atom.coord
                    for lx, ly, lz in ligand_coords:
                        dx = ax - lx
                        dy = ay - ly
                        dz = az - lz
                        d_sq = dx * dx + dy * dy + dz * dz
                        if d_sq < min_dist_sq:
                            min_dist_sq = d_sq
                            min_atom_name = atom.get_name().strip()

                if min_dist_sq <= cutoff_sq:
                    key = (chain_id, resnum)
                    record = PocketResidue(
                        chain=chain_id,
                        resnum=resnum,
                        resname=resname,
                        min_dist=round(min_dist_sq ** 0.5, 3),
                        closest_atom=min_atom_name,
                        is_backbone_only=(min_atom_name in _BACKBONE_ATOMS),
                    )
                    # If we somehow see the same residue twice (e.g.
                    # alt-loc duplicates), keep the closest.
                    if key not in by_residue or by_residue[key].min_dist > record.min_dist:
                        by_residue[key] = record
        # Only process the first MODEL — NMR multi-model files default
        # to model 0; the rest are alternative conformers and would
        # multiply the count artificially.
        break

    results = sorted(by_residue.values(), key=lambda r: (r.min_dist, r.chain, r.resnum))
    log.info(
        "scan_pocket_residues: %d residues within %.1f Å of ligand "
        "(receptor=%s, ligand=%s)",
        len(results),
        distance_cutoff_angstroms,
        receptor_pdb.name,
        ligand_sdf.name,
    )
    return results
