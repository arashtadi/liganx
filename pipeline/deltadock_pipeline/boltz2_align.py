"""Cα-based superposition alignment for Boltz-2 WT/mutant complexes.

Boltz-2 predicts independent protein-ligand complexes for WT and mutant
sequences in different coordinate frames. This module aligns the mutant
complex onto the WT complex using their Cα atoms, enabling the 3D viewer
to overlay them meaningfully for the mutation-slider comparison.

Uses Bio.PDB Superimposer to compute the optimal rotation + translation
that minimizes Cα RMSD between the two protein backbones.
"""

from pathlib import Path
from typing import Tuple

try:
    from Bio.PDB import PDBParser, PDBIO, Superimposer, Select
except ImportError:
    PDBParser = PDBIO = Superimposer = Select = None


class CAOnlySelect(Select):
    """PDB selector that passes through only Cα atoms from a specific chain."""

    def __init__(self, chain_id: str = "A"):
        super().__init__()
        self.chain_id = chain_id

    def accept_model(self, model):
        return True

    def accept_chain(self, chain):
        return chain.id == self.chain_id

    def accept_residue(self, residue):
        return True

    def accept_atom(self, atom):
        return atom.name == "CA"


def align_complex_to(
    target_pdb: Path,
    source_pdb: Path,
    out_pdb: Path,
    chain_id: str = "A",
) -> Tuple[float, bool]:
    """Align source complex onto target complex by Cα atoms, write aligned PDB.

    Reads both PDB files, extracts Cα atoms from the protein chain (defaults
    to chain A), computes the optimal rotation + translation via Superimposer,
    applies it to the source structure, and writes the result to out_pdb.

    Args:
        target_pdb: Path to the reference (WT) complex PDB.
        source_pdb: Path to the structure to align (mutant) complex PDB.
        out_pdb: Path where the aligned mutant complex will be written.
        chain_id: Protein chain ID to use for alignment (default "A").

    Returns:
        Tuple (rmsd_angstroms, ok_flag) where:
          - rmsd_angstroms is the Cα RMSD after alignment, rounded to 1 decimal.
          - ok_flag is True iff rmsd < 3.0 Å (fold hasn't diverged significantly).
                    False if rmsd >= 3.0 or if alignment failed, indicating the
                    overlay would be misleading.

    Raises:
        ImportError: if Bio.PDB (biopython) is not installed.
        ValueError: if the PDB files can't be parsed or don't contain the
                   specified chain with at least one Cα atom.
    """
    if PDBParser is None:
        raise ImportError(
            "Bio.PDB not available — biopython >= 1.84 required for alignment"
        )

    parser = PDBParser(QUIET=True)

    # Parse both structures
    target_struct = parser.get_structure("target", str(target_pdb))
    source_struct = parser.get_structure("source", str(source_pdb))

    # Get the first model and the specified chain from each
    target_model = target_struct[0]
    source_model = source_struct[0]

    try:
        target_chain = target_model[chain_id]
        source_chain = source_model[chain_id]
    except KeyError as e:
        raise ValueError(
            f"Chain {chain_id} not found in structure"
        ) from e

    # Extract Cα atoms as lists of (atom, coordinates)
    target_ca = []
    source_ca = []

    for residue in target_chain:
        if "CA" in residue:
            target_ca.append(residue["CA"])

    for residue in source_chain:
        if "CA" in residue:
            source_ca.append(residue["CA"])

    if not target_ca or not source_ca:
        raise ValueError(
            "No Cα atoms found — cannot perform alignment"
        )

    if len(target_ca) != len(source_ca):
        raise ValueError(
            f"Cα count mismatch: target={len(target_ca)}, "
            f"source={len(source_ca)} — structures have different lengths"
        )

    # Compute rotation + translation using Superimposer
    sup = Superimposer()
    sup.set_atoms(target_ca, source_ca)
    rmsd = sup.rms

    # Apply rotation + translation to the entire source structure
    sup.apply(source_struct.get_atoms())

    # Write the aligned structure to out_pdb
    io = PDBIO()
    io.set_structure(source_struct)
    io.save(str(out_pdb))

    # Return RMSD (rounded to 1 decimal) and ok_flag (RMSD < 3.0 Å)
    ok_flag = rmsd < 3.0
    return round(rmsd, 1), ok_flag
