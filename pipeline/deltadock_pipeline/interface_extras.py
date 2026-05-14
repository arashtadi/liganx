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
        combined_path = None
        try:
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
        finally:
            # Always remove the combined tempfile — even if the PDB
            # concatenation or a _sasa_total call raised partway through.
            # NamedTemporaryFile(delete=False) won't clean itself up.
            if combined_path is not None:
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
    """Run freesasa on a single PDB and return total SASA in Å².

    Two bugs in the original version made BSA silently return None on every
    production job (the bare `except` swallowed both):

      1. SASA call. freesasa 2.x exposes a module-level ``calc()`` function
         — there is no ``freesasa.Calc`` class, so ``freesasa.Calc()`` raised
         AttributeError. We call ``freesasa.calc()`` and keep a getattr shim
         only as a defensive fallback for unusual builds.
      2. HETATM handling. ``freesasa.Structure`` skips HETATM records by
         default — and the docked-ligand PDB is *all* HETATM, so it parsed
         as "no atoms" and raised. ``options={'hetatm': True}`` includes
         them; verified every ligand atom is then scored.
    """
    import freesasa  # type: ignore
    try:
        structure = freesasa.Structure(pdb_path, options={"hetatm": True})
        calc = getattr(freesasa, "calc", None)
        if calc is not None:
            result = calc(structure)
        else:  # pragma: no cover — defensive fallback for very old bindings
            result = freesasa.Calc().calculate(structure)  # type: ignore[attr-defined]
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


def count_hbonds_from_extra(extra: str) -> Optional[int]:
    """Count interface H-bonds from the ``contacts=`` segment of a serialised
    ``DockingResult.extra`` string.

    Returns the count, or ``None`` when there is no ``contacts=`` segment at
    all — so callers can tell "zero H-bonds" apart from "no contact data yet".

    Why this exists separately from ``count_hbonds_from_interactions``: on the
    production (pod-batched) path ProLIF validation runs in a *deferred*
    background pass, so ``contacts=`` is not in ``extra`` when the cell is
    first finalised. The interface-extras drainer runs *after* validation, so
    by then the segment is present — that's the right place to derive the
    H-bond count from. ``contacts=`` items look like ``RES:Type[:dist]`` with
    Type in ProLIF's short codes (HBAc, HBDo, Hydr, VdWC, …)."""
    if not extra:
        return None
    for seg in extra.split("|"):
        if not seg.startswith("contacts="):
            continue
        body = seg[len("contacts="):]
        if not body:
            return 0
        n = 0
        for tok in body.split(","):
            bits = tok.split(":")
            t = bits[1].lower() if len(bits) > 1 else ""
            if t.startswith("hbond") or t.startswith("hbdo") or t.startswith("hbac"):
                n += 1
        return n
    return None


# ──────────────────────────────────────────────────────────────────────
# Vina score decomposition
# ──────────────────────────────────────────────────────────────────────

# smina --score_only --scoring vina emits two shapes of output across
# versions. The current build prints a *tabular* form:
#
#   ## Name gauss(o=0,_w=0.5,_c=8)  gauss(o=3,_w=2,_c=8)  repulsion(o=0,_c=8) \
#           hydrophobic(g=0.5,_b=1.5,_c=8) non_dir_h_bond(g=-0.7,_b=0,_c=8)
#   ##  -1115.7427  -42.0444  4.4612  -19.3949  -2.0769
#   Affinity:  -8.42114  (kcal/mol)
#
# Some older / debug builds emit per-line `gauss 1 : -42.04` etc. We
# accept *both* — table first (current production), then per-line as a
# fallback so the parser keeps working across smina version bumps.
_TERM_LINE_RE = re.compile(
    r"^\s*(gauss\s*1|gauss\s*2|repulsion|hydrophobic|Hydrogen|hbond|non_dir_h_bond)\s*:\s*(-?\d+\.\d+)",
    re.IGNORECASE | re.MULTILINE,
)

# Match smina's "Affinity:  -8.42 (kcal/mol)" line so we can report the
# weighted total alongside the per-term raw contributions. The runner
# already has best_score from Vina; this is a sanity-check anchor.
_AFFINITY_LINE_RE = re.compile(r"Affinity\s*:\s*(-?\d+\.\d+)")

# Canonical key per smina term-name token. We match by *substring* in
# the header to keep this robust across `gauss(o=0,_w=0.5,_c=8)` vs
# `gauss(o=3,_w=2,_c=8)` (both contain the substring "gauss"), and
# pair the right value column to the right canonical key.
def _canonical_term_key(header_token: str, gauss_seen: int) -> tuple[Optional[str], int]:
    """Map a smina term header token to our canonical key.

    Returns (key_or_None, new_gauss_seen_counter). gauss appears twice
    in smina's header (two different parameter sets) — we map the
    first to g1 and the second to g2 so the order matches Vina's
    canonical (g1, g2, repulsion, hydrophobic, hbond) ordering.
    """
    h = header_token.lower()
    if "gauss" in h:
        if gauss_seen == 0:
            return "g1", 1
        return "g2", 2
    if "repulsion" in h:
        return "rep", gauss_seen
    if "hydrophobic" in h:
        return "hyd", gauss_seen
    # smina's H-bond term has lots of aliases: non_dir_h_bond,
    # Hydrogen, hbond. Match any of them.
    if "h_bond" in h or "hbond" in h or "hydrogen" in h:
        return "hb", gauss_seen
    return None, gauss_seen


def _parse_smina_table(stdout: str) -> dict:
    """Parse the `## Name <terms>` + `## <values>` tabular block."""
    terms: dict = {}
    # Find the header line (starts with `## Name`) and the value line that
    # immediately follows or appears later in the block. smina prints the
    # values twice: once right after Name, once at the end of the
    # "Intermolecular contributions" section. Either is fine.
    lines = stdout.splitlines()
    name_idx = None
    for i, ln in enumerate(lines):
        s = ln.strip()
        if s.startswith("##") and "name" in s.lower():
            name_idx = i
            break
    if name_idx is None:
        return terms
    # Tokenise the header: drop the leading `##`, drop the literal
    # `Name`, keep the remaining whitespace-separated tokens.
    header_tokens = lines[name_idx].strip().split()
    if len(header_tokens) < 3:
        return terms
    # header_tokens[0] is "##", [1] is "Name"; the rest are term labels.
    term_tokens = header_tokens[2:]
    # Find the value line — first `## <numbers>` line after the header
    # with the matching number of value columns.
    val_tokens: list[str] = []
    for j in range(name_idx + 1, min(name_idx + 6, len(lines))):
        s = lines[j].strip()
        if not s.startswith("##"):
            continue
        candidate = s.split()
        # Drop the leading "##" token, the rest should be floats.
        if len(candidate) - 1 != len(term_tokens):
            continue
        try:
            [float(t) for t in candidate[1:]]
        except ValueError:
            continue
        val_tokens = candidate[1:]
        break
    if not val_tokens:
        return terms
    # Map header term names to canonical keys, pair with values.
    gauss_seen = 0
    for token, raw in zip(term_tokens, val_tokens):
        key, gauss_seen = _canonical_term_key(token, gauss_seen)
        if key is None:
            continue
        try:
            terms[key] = float(raw)
        except ValueError:
            continue
    return terms


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
    # _ensure_single_model writes a stripped tempfile for multi-MODEL
    # poses; when the pose is already single-model it returns the input
    # path untouched. Track whether we own a tempfile to clean up.
    pose_is_temp = pose_path != Path(ligand_pdbqt)
    try:
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
        # First try the *tabular* form (current production smina output);
        # fall back to per-line if the tabular parse comes up empty so that
        # older / debug builds still work.
        terms = _parse_smina_table(out)
        if not terms:
            gauss_seen = 0
            for m in _TERM_LINE_RE.finditer(out):
                label = m.group(1).lower().replace(" ", "").replace("_", "")
                val = float(m.group(2))
                if label == "gauss1":
                    terms["g1"] = val
                elif label == "gauss2":
                    terms["g2"] = val
                elif label == "repulsion":
                    terms["rep"] = val
                elif label == "hydrophobic":
                    terms["hyd"] = val
                elif label in ("hydrogen", "hbond", "nondirhbond"):
                    terms["hb"] = val
                # Heuristic gauss-counter just in case the lines come back
                # without explicit numbers (older smina output).
                if "gauss" in label and "g1" not in terms and "g2" not in terms:
                    key = "g1" if gauss_seen == 0 else "g2"
                    terms[key] = val
                    gauss_seen += 1
        if not terms:
            log.info("vina_score_terms: no recognisable terms in smina stdout (head: %s)", out[:300])
            return None
        am = _AFFINITY_LINE_RE.search(out)
        if am:
            try:
                terms["total"] = float(am.group(1))
            except ValueError:
                pass
        return terms
    finally:
        # Clean up the stripped-pose tempfile if _ensure_single_model
        # made one. Never unlink the caller's original pose file.
        if pose_is_temp:
            try:
                pose_path.unlink(missing_ok=True)
            except Exception:
                pass


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
