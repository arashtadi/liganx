"""Post-dock extras: interface KPIs (BSA, H-bond count) and Vina score
decomposition (gauss1/gauss2/repulsion/hydrophobic/hbond/torsion).

Why a separate module rather than folding into validate.py: the
validation pass can be deferred to a worker thread (see runner's
defer_val path), but the interface KPIs are cheap (sub-second) and
useful as an at-a-glance signal in the matrix UI. Keeping them in
their own module lets the runner call them inline regardless of which
validation mode is active.

All public functions are fail-soft: any computation failure returns
None or an empty dict so a docking run never crashes because the
ancillary metric exploded.

Output convention: the runner serialises the dict into the existing
`extra` text field on DockingResult as pipe-separated key=value pairs.
Frontend parser (frontend/src/lib/parseExtra.ts) deserialises them
back. Keys used here:

  iface_bsa     — buried surface area in Å² (positive number)
  iface_hb      — number of H-bonds across the interface (integer)
  vina_terms    — six comma-separated Vina terms: g1,g2,rep,hyd,hb,tor
                   (units: kcal/mol contributions before weighting)
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
from pathlib import Path
from typing import Iterable, Optional

log = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────
# Interface KPIs
# ──────────────────────────────────────────────────────────────────────


def compute_bsa(receptor_pdb: Path, ligand_pdb: Path) -> Optional[float]:
    """Buried surface area in Å²:  SASA(complex) − SASA(receptor) − SASA(ligand).

    Uses the freesasa Python module. freesasa is a small C library wrapped in
    Python — sub-second for a typical kinase + ligand. Returns the bound
    fraction (positive number, larger = bigger interface). None on any
    failure (missing freesasa dep, unparseable PDB, etc.).
    """
    try:
        import freesasa  # type: ignore
    except Exception as e:
        log.debug("freesasa unavailable, skipping BSA: %s", e)
        return None
    try:
        # Make the C library quiet — by default it prints WARNING noise to
        # stderr on every HETATM record, which floods our logs.
        freesasa.setVerbosity(freesasa.silent)
        # Build the complex by concatenating receptor + ligand PDBs in
        # memory. freesasa parses PDB strings directly via the Structure
        # constructor with a temp file path; cheapest path is to write a
        # combined PDB to a tempfile.
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".pdb", delete=False) as fh:
            combined_path = fh.name
            with open(receptor_pdb) as rec:
                for line in rec:
                    if line.startswith(("ATOM", "HETATM", "TER")):
                        fh.write(line)
            fh.write("TER\n")
            with open(ligand_pdb) as lig:
                for line in lig:
                    if line.startswith(("ATOM", "HETATM")):
                        fh.write(line)
            fh.write("END\n")

        sasa_complex = _sasa_total(combined_path)
        sasa_rec = _sasa_total(str(receptor_pdb))
        sasa_lig = _sasa_total(str(ligand_pdb))
        Path(combined_path).unlink(missing_ok=True)
        if sasa_complex is None or sasa_rec is None or sasa_lig is None:
            return None
        # BSA = (SASA_rec + SASA_lig − SASA_complex). Divide by 2 if you
        # want per-partner. We report total (matches PyMOL convention).
        bsa = sasa_rec + sasa_lig - sasa_complex
        # Sanity: negative BSA means the SASA calc got confused (often a
        # malformed PDB). Don't surface garbage.
        if bsa < 0 or bsa > 5000:
            return None
        return round(bsa, 1)
    except Exception as e:
        log.info("BSA computation failed: %s", e)
        return None


def _sasa_total(pdb_path: str) -> Optional[float]:
    """Run freesasa on a single PDB and return total SASA in Å²."""
    import freesasa  # type: ignore
    try:
        structure = freesasa.Structure(pdb_path)
        result = freesasa.Calc().calculate(structure)
        return float(result.totalArea())
    except Exception:
        return None


def count_hbonds_from_interactions(interactions: Iterable[dict]) -> int:
    """Count H-bonds across the interface from ProLIF's interactions list.

    ProLIF returns interactions as a list of {residue, type, distance?}
    dicts. The 'type' field is the human-readable category — we look for
    HBDonor / HBAcceptor (both directions count as one bond), plus older
    short labels 'HBDo' and 'HBAc' that earlier validate.py revisions
    emit. Defensive: returns 0 if the input is missing/malformed."""
    if not interactions:
        return 0
    n = 0
    try:
        for it in interactions:
            t = (it.get("type") or "").lower() if isinstance(it, dict) else ""
            if t.startswith("hbond") or t.startswith("hbdo") or t.startswith("hbac"):
                n += 1
    except Exception:
        return 0
    return n


# ──────────────────────────────────────────────────────────────────────
# Vina score decomposition
# ──────────────────────────────────────────────────────────────────────

# smina --score_only's "Intermolecular contributions" block looks like:
#
#   Intermolecular contributions to the terms, before weighting:
#       gauss 1     :  -42.04
#       gauss 2     : -1115.74
#       repulsion   :    4.46
#       hydrophobic :  -19.39
#       Hydrogen    :   -2.07
#
# torsion isn't in the intermolecular block — it's the Vina-style
# torsion penalty applied at the end (1 + Ntors-related). We extract
# the "Affinity" line as the WEIGHTED total and reconstruct torsion
# from (weighted total) − (sum of weighted intermolecular terms) when
# available. Easier path: just expose the five intermolecular terms,
# users care about the relative magnitudes.
_TERM_LINE_RE = re.compile(
    r"^\s*(gauss\s*1|gauss\s*2|repulsion|hydrophobic|Hydrogen|hbond)\s*:\s*(-?\d+\.\d+)",
    re.IGNORECASE | re.MULTILINE,
)

# Match smina's "Affinity:  -8.42 (kcal/mol)" line so we can report the
# weighted total alongside the per-term raw contributions. The runner
# already has best_score from Vina; this is a sanity-check anchor.
_AFFINITY_LINE_RE = re.compile(r"Affinity\s*:\s*(-?\d+\.\d+)")


def vina_score_terms(
    receptor_pdbqt: Path,
    ligand_pdbqt: Path,
    *,
    smina_bin: str = "smina",
    timeout: float = 20.0,
) -> Optional[dict]:
    """Re-score the docked pose with smina --score_only and parse the
    per-term breakdown. Returns a dict with the five Vina intermolecular
    contributions (and the weighted Affinity as a sanity check), or None
    on any failure.

    We use smina rather than Vina directly because smina is already
    available on the pipeline image (validated by rescore.smina_rescore)
    and its --score_only output prints the terms explicitly. Vina-only
    builds don't always print the term breakdown without -p flags.

    Why a separate call from rescore.smina_rescore: that function uses
    `--scoring vinardo` to get a refined score with a tuned function.
    Here we want the raw Vina terms, so we run with `--scoring vina`.
    """
    if not shutil.which(smina_bin):
        log.debug("smina binary not on PATH, skipping vina_score_terms")
        return None
    # smina chokes on multi-MODEL pose files; extract MODEL 1 if needed.
    pose_path = _ensure_single_model(ligand_pdbqt)
    if pose_path is None:
        return None
    cmd = [
        smina_bin,
        "--receptor", str(receptor_pdbqt),
        "--ligand", str(pose_path),
        "--score_only",
        "--scoring", "vina",
    ]
    try:
        res = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=timeout, check=False,
        )
    except subprocess.TimeoutExpired:
        log.info("vina_score_terms: smina timed out after %ss", timeout)
        return None
    except Exception as e:
        log.info("vina_score_terms: smina invocation failed: %s", e)
        return None
    if res.returncode != 0:
        log.info("vina_score_terms: smina exit %d (stderr: %s)",
                 res.returncode, (res.stderr or "")[:200])
        return None

    out = res.stdout or ""
    terms: dict = {}
    for m in _TERM_LINE_RE.finditer(out):
        label = m.group(1).lower().replace(" ", "")
        val = float(m.group(2))
        # Canonicalise the keys.
        if label == "gauss1":
            terms["g1"] = val
        elif label == "gauss2":
            terms["g2"] = val
        elif label == "repulsion":
            terms["rep"] = val
        elif label == "hydrophobic":
            terms["hyd"] = val
        elif label in ("hydrogen", "hbond"):
            terms["hb"] = val
    if not terms:
        log.info("vina_score_terms: no recognisable terms in smina stdout")
        return None
    am = _AFFINITY_LINE_RE.search(out)
    if am:
        try:
            terms["total"] = float(am.group(1))
        except ValueError:
            pass
    return terms


def _ensure_single_model(pose_pdbqt: Path) -> Optional[Path]:
    """smina --score_only crashes on multi-MODEL pdbqt files. If the
    pose file contains MODEL records, write a stripped copy with just
    MODEL 1 and return its path. Otherwise return the original path."""
    try:
        text = Path(pose_pdbqt).read_text()
    except Exception:
        return None
    if "MODEL " not in text:
        return Path(pose_pdbqt)
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".pdbqt", delete=False) as fh:
        out_path = Path(fh.name)
        in_model = False
        for line in text.splitlines():
            if line.startswith("MODEL "):
                # Capture MODEL 1, skip later ones.
                if line.strip().endswith("1"):
                    in_model = True
                else:
                    break
                continue
            if line.startswith("ENDMDL"):
                if in_model:
                    break
                continue
            if in_model or line.startswith(("ATOM", "HETATM", "REMARK", "TORSDOF", "ROOT", "BRANCH", "ENDBRANCH", "ENDROOT")):
                fh.write(line + "\n")
    return out_path


def format_for_extra(
    *,
    bsa: Optional[float] = None,
    hbonds: Optional[int] = None,
    vina_terms: Optional[dict] = None,
) -> list[str]:
    """Serialise the computed metrics into pipe-segment strings ready to
    be joined into the DockingResult.extra field. Drops anything that's
    None so the extra string stays compact."""
    parts: list[str] = []
    if bsa is not None:
        parts.append(f"iface_bsa={bsa:.1f}")
    if hbonds is not None:
        parts.append(f"iface_hb={int(hbonds)}")
    if vina_terms:
        # Emit `vina_terms=g1:-42.04,g2:-1115.74,rep:4.46,hyd:-19.39,hb:-2.07,total:-8.42`
        keys = ["g1", "g2", "rep", "hyd", "hb", "total"]
        chunks = [f"{k}:{vina_terms[k]:.2f}" for k in keys if k in vina_terms]
        if chunks:
            parts.append("vina_terms=" + ",".join(chunks))
    return parts


# ──────────────────────────────────────────────────────────────────────
# PDBQT → PDB-ish helper
# ──────────────────────────────────────────────────────────────────────


def pdbqt_to_pdb(pdbqt_path: Path, out_pdb: Path) -> Optional[Path]:
    """Strip PDBQT-specific columns (AutoDock atom type + Gasteiger
    charge in columns 67-80) so freesasa can parse the file. PDBQT
    is PDB-compatible up to column 66 — we just truncate. Multi-model
    PDBQTs are flattened to MODEL 1 only.

    Returns the output path on success, None on any failure."""
    try:
        text = Path(pdbqt_path).read_text()
    except Exception as e:
        log.debug("pdbqt_to_pdb: read failed %s: %s", pdbqt_path, e)
        return None
    try:
        keep_model = True  # write the first MODEL only
        with open(out_pdb, "w") as fh:
            for line in text.splitlines():
                if line.startswith("MODEL "):
                    # Only keep model 1; stop writing on any subsequent MODEL.
                    if not line.strip().endswith("1"):
                        keep_model = False
                    continue
                if line.startswith("ENDMDL"):
                    keep_model = False
                    continue
                if not keep_model:
                    continue
                if line.startswith(("ATOM", "HETATM")):
                    fh.write(line[:66].rstrip() + "\n")
                # Drop ROOT/BRANCH/ENDBRANCH/TORSDOF — they're PDBQT
                # tree-structure records that freesasa will reject.
            fh.write("END\n")
        return out_pdb
    except Exception as e:
        log.debug("pdbqt_to_pdb: write failed: %s", e)
        return None
