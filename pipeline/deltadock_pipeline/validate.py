"""Pose validation: PoseBusters confidence checks + ProLIF interaction fingerprint.

Run after docking on each pose. Produces:

  - confidence: "high" / "medium" / "low" — the green/yellow/red ribbon shown in the UI
  - bust_summary: one-line list of which PoseBusters checks failed
  - interactions: list of {residue, type} pairs the ligand makes with the receptor
  - sentence: a single plain-English sentence describing the contacts

Both PoseBusters and ProLIF are heavy imports — we lazy-load them inside the
function so the rest of the pipeline imports cleanly even when these aren't
installed (and so the backend startup stays fast).
"""

from __future__ import annotations

import logging
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)


@dataclass
class Validation:
    confidence: str = "unknown"           # "high" | "medium" | "low" | "unknown"
    bust_passed: int = 0
    bust_failed: int = 0
    bust_summary: str = ""                # "passed all 8 checks" or "failed: clash, chirality"
    interactions: list[dict] = field(default_factory=list)  # [{"residue": "MET790", "type": "Hydrophobic"}, ...]
    sentence: str = ""                    # auto-generated plain-English summary
    error: str | None = None              # populated if validation crashed entirely
    # ProLIF can fail or return empty without taking down the whole validation.
    # We track that separately so PoseBusters results still show through.
    prolif_status: str = "ok"             # "ok" | "empty" | "err:<reason>"
    # Conformational strain of the docked ligand (MMFF94s pose energy minus
    # MMFF94s energy of the lowest-energy ETKDG conformer of the same SMILES).
    # Empty dict when not computed (e.g. SDF missing) or when RDKit failed.
    # Shape: {pose_kcal, relaxed_kcal, strain_kcal, verdict in {ok,mild,high}}
    strain: dict = field(default_factory=dict)
    # (U20.4) Fraction of the target's canonical binding-pocket residues
    # that the docked pose actually contacts (0.0-1.0). Set by the runner
    # after validation completes, using the target's
    # canonical_pocket_residues catalog field. None when we can't compute
    # (no catalog entry / no observed contacts). Triggers the
    # "alt site" badge in the matrix UI when below 0.20 — surfaced so
    # chemists immediately spot poses that landed in the wrong pocket
    # (e.g. a switch-II inhibitor like Adagrasib docking into the
    # nucleotide pocket of a switch-II-closed KRAS structure).
    pocket_overlap_frac: float | None = None
    alt_site: bool = False

    def to_extra_string(self) -> str:
        """Pack the validation into the existing `extra` text field on DockingResult.
        Phase B will give validation its own database columns."""
        parts = [f"confidence={self.confidence}"]
        if self.strain:
            # Compact: `strain=ok:1.2` / `strain=mild:5.4` / `strain=high:9.1`.
            # The verdict drives the matrix chip color; the kcal goes in the tooltip.
            parts.append(f"strain={self.strain['verdict']}:{self.strain['strain_kcal']}")
        if self.bust_summary:
            parts.append(f"posebusters={self.bust_summary}")
        if self.interactions:
            # Format per contact: RES:Type[:Å]
            #   RES   = short residue name like "MET793"
            #   Type  = first 4 chars of the interaction class (Hydr, HBDo, ...)
            #   Å     = optional, single decimal place. Omitted when ProLIF
            #           didn't return a distance for this interaction (older
            #           versions, or interaction types where distance is N/A).
            top_parts = []
            for i in self.interactions[:5]:
                base = f"{i['residue']}:{i['type'][:4]}"
                d = i.get("distance")
                if d is not None:
                    base += f":{d:.1f}"
                top_parts.append(base)
            parts.append(f"contacts={','.join(top_parts)}")
        elif self.prolif_status != "ok":
            # Surface the reason there are no contacts so the UI can show a hint
            # instead of just suppressing the contacts panel silently.
            parts.append(f"prolif={self.prolif_status}")
        if self.sentence:
            parts.append(f"summary={self.sentence}")
        if self.error:
            parts.append(f"err={self.error[:80]}")
        # (U20.4) Canonical-pocket overlap and alt-site flag. Encoded
        # compactly so the existing pipe-delimited extra parser picks
        # them up alongside everything else.
        if self.pocket_overlap_frac is not None:
            parts.append(f"pocket_overlap={self.pocket_overlap_frac:.2f}")
        if self.alt_site:
            parts.append("alt_site=true")
        return "|".join(parts)


def compute_pocket_overlap(
    interactions: list[dict],
    canonical_residues: list[str],
) -> float | None:
    """(U20.4) Fraction of canonical pocket residues actually contacted
    by the docked pose.

    `interactions` is the shape ProLIF emits — each item has a "residue"
    string like 'MET793' (three-letter code + sequence number). The
    catalog stores canonical residues as 'Y32', 'M793' (one-letter +
    number). We compare by sequence number only, which is robust to
    coding-style differences and is what a chemist eyeballs anyway.

    Returns 0.0-1.0 (fraction of canonical residues hit) or None if
    we can't tell (no canonical list, no observed interactions).

    Caller treats a fraction below ~0.20 as "alt site found" and
    surfaces it as a badge on the cell.
    """
    if not canonical_residues:
        return None
    if not interactions:
        return None

    def _seq_num(s: str) -> str | None:
        digits = "".join(c for c in s if c.isdigit())
        return digits or None

    canonical_nums = {n for n in (_seq_num(r) for r in canonical_residues) if n}
    if not canonical_nums:
        return None
    observed_nums = {
        n for n in (_seq_num(str(i.get("residue", ""))) for i in interactions) if n
    }
    if not observed_nums:
        return 0.0
    hit = canonical_nums & observed_nums
    return len(hit) / len(canonical_nums)


def validate_pose(
    receptor_pdbqt: Path | str,
    pose_pdbqt: Path | str,
    *,
    receptor_pdb: Path | str | None = None,
    work_dir: Path | str | None = None,
    ligand_smiles: str | None = None,
) -> Validation:
    """Run PoseBusters + ProLIF on a single docked pose. Best-effort: any failure
    gracefully degrades to an "unknown" confidence rather than blowing up the job.

    `ligand_smiles` is the user-provided SMILES that was originally docked. When
    supplied, ProLIF uses it as a bond-order template via
    Chem.AssignBondOrdersFromTemplate, which recovers the aromatic / multiple
    bonds that get lost in the obabel PDBQT→PDB round-trip. Without this,
    ProLIF often returns "no interactions" on aromatic-rich ligands because
    every bond looks single to RDKit and H-bonds via aromatic N are missed.

    Pass the *original* cleaned PDB (from PDBFixer) as `receptor_pdb` if you have
    it — ProLIF/MDAnalysis fails on receptors back-converted from PDBQT because
    PDBQT's atom typing trips RDKit's valence sanitizer.
    """
    receptor_pdbqt = Path(receptor_pdbqt)
    pose_pdbqt = Path(pose_pdbqt)
    work = Path(work_dir) if work_dir else pose_pdbqt.parent
    work.mkdir(parents=True, exist_ok=True)

    v = Validation()

    # Vina output PDBQT contains all 9 modes concatenated — extract the best (mode 1)
    # so downstream tools see a single-pose file, not a multi-frame trajectory.
    best_pdbqt = work / (pose_pdbqt.stem + ".best.pdbqt")
    try:
        _extract_best_mode(pose_pdbqt, best_pdbqt)
    except Exception as e:
        v.error = f"extract_best_failed: {e}"
        return v

    # Use the supplied PDBFixer PDB if available; only fall back to converting
    # the PDBQT (which is fine for PoseBusters but breaks ProLIF).
    if receptor_pdb is not None:
        receptor_pdb_path = Path(receptor_pdb)
    else:
        receptor_pdb_path = work / (receptor_pdbqt.stem + ".pdb")
        try:
            _convert(receptor_pdbqt, receptor_pdb_path)
        except Exception as e:
            v.error = f"receptor_convert_failed: {e}"
            return v

    pose_pdb = work / (pose_pdbqt.stem + ".pose.pdb")
    pose_sdf = work / (pose_pdbqt.stem + ".pose.sdf")
    try:
        _convert(best_pdbqt, pose_pdb)
        _convert(best_pdbqt, pose_sdf)  # PoseBusters wants SDF for the ligand
    except Exception as e:
        v.error = f"pose_convert_failed: {e}"
        return v

    # PoseBusters: physics sanity checks.
    #
    # CRITICAL: PoseBusters calls Chem.GetMolFrags(asMols=True) internally to
    # split multi-fragment poses, which trips a known SIGSEGV in
    # RDKit::RWMol::batchRemoveAtoms() on certain receptor+pose combos. Like
    # ProLIF, this is a C-level crash that Python try/except CANNOT catch —
    # it kills the entire uvicorn worker mid-job.
    #
    # Mitigation: same pattern as _run_prolif_safe. Run PoseBusters in a
    # subprocess; if it segfaults, parent records "check_skipped" and the
    # backend stays up.
    try:
        bust_passed, bust_failed, summary = _run_posebusters_safe(pose_sdf, receptor_pdb_path)
        v.bust_passed = bust_passed
        v.bust_failed = bust_failed
        v.bust_summary = summary
        v.confidence = _confidence_from_bust(bust_passed, bust_failed)
    except Exception as e:
        log.warning("PoseBusters failed: %s", e)
        v.bust_summary = f"check_skipped: {e}"

    # ProLIF: interaction fingerprint.
    #
    # CRITICAL: ProLIF goes through RDKit/MDAnalysis for receptor parsing, and
    # RDKit's batchRemoveAtoms() segfaults on certain large/messy receptors —
    # a known C-level crash that Python try/except CANNOT catch. A SIGSEGV
    # here would kill the entire uvicorn worker mid-job.
    #
    # Mitigation: run ProLIF in a subprocess. If it segfaults, the parent
    # process sees a non-zero exit code and just records "validation skipped"
    # on this pose. Backend stays up.
    #
    # Empty result (returns []) can mean either: ProLIF ran but found no
    # interactions (rare — usually means RDKit couldn't infer ligand bonds,
    # e.g. on covalent warheads), or the subprocess returned nothing. We mark
    # both with prolif_status="empty" so the UI can show a hint instead of
    # just suppressing the contacts panel silently.
    try:
        v.interactions = _run_prolif_safe(pose_pdb, receptor_pdb_path, ligand_smiles=ligand_smiles)
        if not v.interactions:
            v.prolif_status = "empty"
    except Exception as e:
        log.warning("ProLIF failed: %s", e)
        v.prolif_status = f"err:{str(e)[:40]}"

    # Conformational strain: compares the docked geometry's MMFF energy to
    # the relaxed conformer ensemble for the same SMILES. Cheap (~1-3s) and
    # filters Vina poses where the ligand is bent into an unphysical shape
    # to fit a pocket. Only runs when we have the SMILES — without it there's
    # no template to generate the relaxed reference from.
    if ligand_smiles:
        try:
            from .strain import compute_strain
            s = compute_strain(pose_sdf, ligand_smiles)
            if s:
                v.strain = s
        except Exception as e:
            log.warning("Strain calc failed: %s", e)

    v.sentence = _make_sentence(v)
    return v


def _convert(src: Path, dst: Path) -> None:
    """Open Babel format conversion (PDBQT → PDB / SDF). Idempotent."""
    if dst.exists() and dst.stat().st_size > 0:
        return
    if not shutil.which("obabel"):
        raise RuntimeError("obabel not on PATH")
    res = subprocess.run(
        ["obabel", str(src), "-O", str(dst)],
        capture_output=True, text=True, check=False,
    )
    if res.returncode != 0 or not dst.exists():
        raise RuntimeError(f"obabel {src} → {dst} failed: {res.stderr.strip()[:200]}")


def _extract_best_mode(vina_pdbqt: Path, out_pdbqt: Path) -> None:
    """Vina output PDBQT concatenates all modes with MODEL/ENDMDL markers.
    Pull just MODEL 1 (the best-scoring pose) into a single-mode PDBQT."""
    if out_pdbqt.exists() and out_pdbqt.stat().st_size > 0:
        return
    keep = []
    in_first = False
    with vina_pdbqt.open() as f:
        for line in f:
            if line.startswith("MODEL"):
                if in_first:
                    break  # second MODEL — stop
                in_first = True
                continue
            if line.startswith("ENDMDL"):
                if in_first:
                    break
                continue
            if in_first:
                keep.append(line)
    if not keep:
        # File doesn't use MODEL markers — assume single pose, copy as-is.
        keep = vina_pdbqt.read_text().splitlines(keepends=True)
    out_pdbqt.write_text("".join(keep))


# ────────────────────── PoseBusters ──────────────────────

def _run_posebusters_safe(
    pose_sdf: Path, receptor_pdb: Path, timeout: float = 60.0,
) -> tuple[int, int, str]:
    """Run PoseBusters in a SUBPROCESS so a SIGSEGV (RDKit GetMolFrags crash on
    certain pose+receptor combos) doesn't kill the parent uvicorn worker.

    Returns the same tuple shape as `_run_posebusters`: (passed, failed, summary).
    On any failure (segfault, timeout, JSON garbage), returns (0, 0, "check_skipped: <reason>")
    so the caller still gets a usable Validation object.
    """
    import json as _json
    import subprocess as _subprocess
    import sys as _sys
    import os as _os

    # Inline runner: import + call _run_posebusters + dump tuple as JSON.
    # Same pattern as _run_prolif_safe.
    runner_code = "\n".join([
        "import sys, json, logging, traceback",
        "logging.disable(logging.CRITICAL)",
        "from pathlib import Path",
        "from deltadock_pipeline.validate import _run_posebusters",
        "pose, rec = Path(sys.argv[1]), Path(sys.argv[2])",
        "try:",
        "    passed, failed, summary = _run_posebusters(pose, rec)",
        "    print('@@JSON@@' + json.dumps([passed, failed, summary]))",
        "except Exception as e:",
        "    sys.stderr.write('PB_ERR: ' + repr(e) + chr(10))",
        "    traceback.print_exc(file=sys.stderr)",
        "    sys.exit(2)",
    ])

    env = _os.environ.copy()
    pipeline_dir = str(Path(__file__).parent.parent)
    env["PYTHONPATH"] = pipeline_dir + _os.pathsep + env.get("PYTHONPATH", "")

    try:
        result = _subprocess.run(
            [_sys.executable, "-c", runner_code, str(pose_sdf), str(receptor_pdb)],
            capture_output=True, text=True, env=env,
            timeout=timeout, check=False,
        )
    except _subprocess.TimeoutExpired:
        log.warning("PoseBusters subprocess timed out after %ss", timeout)
        return 0, 0, "check_skipped: timeout"

    if result.returncode != 0:
        # Distinguish reasons just like _run_prolif_safe so logs are useful.
        if result.returncode == 2:
            err_tail = (result.stderr or "").strip().splitlines()[-3:]
            log.warning("PoseBusters Python error: %s", " | ".join(err_tail))
            reason = "python_err"
        elif result.returncode < 0:
            sig = -result.returncode
            log.warning("PoseBusters subprocess killed by signal %s (likely RDKit segfault)", sig)
            reason = f"signal_{sig}"
        else:
            log.warning("PoseBusters subprocess exited %s; stderr: %s",
                        result.returncode, (result.stderr or "")[-200:])
            reason = f"exit_{result.returncode}"
        return 0, 0, f"check_skipped: {reason}"

    for line in result.stdout.splitlines():
        if line.startswith("@@JSON@@"):
            try:
                data = _json.loads(line[len("@@JSON@@"):])
                # Defensive: validate shape before unpacking
                if isinstance(data, list) and len(data) == 3:
                    return int(data[0]), int(data[1]), str(data[2])
            except (_json.JSONDecodeError, ValueError, TypeError):
                pass
    return 0, 0, "check_skipped: no_output"


def _run_posebusters(pose_sdf: Path, receptor_pdb: Path) -> tuple[int, int, str]:
    """Run PoseBusters on a single pose. Returns (passed, failed, one-line summary).

    Called inside the subprocess in `_run_posebusters_safe` — never call this
    directly from the backend, or a SIGSEGV in RDKit's GetMolFrags will take
    down uvicorn.

    PoseBusters API across versions:
      - <=0.5: pb.bust([sdf], cond_file=...)
      - >=0.6: pb.bust(mol_pred=[sdf], mol_cond=pdb)
    We try the modern signature first, fall back if needed.
    """
    from posebusters import PoseBusters

    pb = PoseBusters(config="dock")
    df = None
    last_err = None
    for kwargs in [
        {"mol_pred": [str(pose_sdf)], "mol_cond": str(receptor_pdb)},
        {"mol_pred": [str(pose_sdf)]},
    ]:
        try:
            df = pb.bust(**kwargs)
            break
        except TypeError as e:
            last_err = e
            continue
    if df is None:
        # Last-ditch: positional args
        try:
            df = pb.bust([str(pose_sdf)])
        except Exception as e:
            raise RuntimeError(f"posebusters API mismatch: {last_err or e}") from e

    if df is None or len(df) == 0:
        return 0, 0, "no_results"

    row = df.iloc[0]
    passed, failed_checks = 0, []
    # (U20.3) BUGFIX. The previous check `isinstance(val, bool)` missed
    # every column when pandas returned numpy.bool_ (the default for
    # boolean columns in pandas >= 2.0). With numpy.bool_, isinstance
    # returns False AND `val is True` returns False too because
    # numpy.bool_(True) is a different singleton. Result: passed=0,
    # failed=0, summary="passed all 0 checks" on every pose, which the
    # confidence ribbon then rendered as `unknown` (see
    # _confidence_from_bust). Users had no idea PoseBusters wasn't
    # actually running. Fix: explicitly accept numpy.bool_ via numpy
    # itself, with a defensive lazy import so the pipeline still works
    # if numpy is somehow missing (unlikely; PoseBusters depends on it).
    try:
        import numpy as _np
        _bool_types: tuple = (bool, _np.bool_)
    except ImportError:
        _bool_types = (bool,)
    # Skip path/string columns explicitly — PoseBusters returns
    # 'mol_pred' / 'mol_cond' as strings; iterating those would never
    # match the bool check but the explicit skip makes intent clear.
    _PATH_COLS = {"mol_pred", "mol_cond", "name", "file", "molecule_name"}
    for col, val in row.items():
        if str(col) in _PATH_COLS:
            continue
        if isinstance(val, _bool_types):
            if bool(val):
                passed += 1
            else:
                failed_checks.append(str(col))

    if failed_checks:
        summary = f"failed: {','.join(failed_checks[:5])}"
    else:
        summary = f"passed all {passed} checks"
    return passed, len(failed_checks), summary


def _confidence_from_bust(passed: int, failed: int) -> str:
    if passed + failed == 0:
        return "unknown"
    if failed == 0:
        return "high"
    if failed <= 2:
        return "medium"
    return "low"


# ────────────────────── ProLIF ──────────────────────

def _run_prolif_safe(
    pose_pdb: Path,
    receptor_pdb: Path,
    timeout: float = 60.0,
    ligand_smiles: str | None = None,
) -> list[dict]:
    """Run ProLIF in a SUBPROCESS so a SIGSEGV (RDKit batchRemoveAtoms crash on
    certain receptors) doesn't kill the parent uvicorn worker.

    Returns the same shape as `_run_prolif`. Empty list on any failure.
    `ligand_smiles` (when provided) is forwarded as argv[3] to the inline
    runner so the subprocess can use it as a bond-order template.
    """
    import json as _json
    import subprocess as _subprocess
    import sys as _sys
    import os as _os

    # Inline runner: import + run + dump JSON to stdout. Lives here as a string
    # so we don't have to ship a separate file. Uses real newlines because
    # try/except can't be expressed in a one-liner with semicolons.
    # argv shape: [pose_pdb, receptor_pdb, ligand_smiles?]. The third is
    # optional — empty string means "no template, infer from geometry".
    runner_code = "\n".join([
        "import sys, json, logging, traceback",
        "logging.disable(logging.CRITICAL)",
        "from pathlib import Path",
        "from deltadock_pipeline.validate import _run_prolif",
        "pose, rec = Path(sys.argv[1]), Path(sys.argv[2])",
        "smi = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None",
        "try:",
        "    out = _run_prolif(pose, rec, ligand_smiles=smi)",
        "    print('@@JSON@@' + json.dumps(out))",
        "except Exception as e:",
        "    sys.stderr.write('PROLIF_ERR: ' + repr(e) + chr(10))",
        "    traceback.print_exc(file=sys.stderr)",
        "    sys.exit(2)",
    ])

    env = _os.environ.copy()
    # Make sure the subprocess can find our pipeline module
    pipeline_dir = str(Path(__file__).parent.parent)
    env["PYTHONPATH"] = pipeline_dir + _os.pathsep + env.get("PYTHONPATH", "")

    argv = [_sys.executable, "-c", runner_code, str(pose_pdb), str(receptor_pdb)]
    if ligand_smiles:
        argv.append(ligand_smiles)

    try:
        result = _subprocess.run(
            argv,
            capture_output=True, text=True, env=env,
            timeout=timeout, check=False,
        )
    except _subprocess.TimeoutExpired:
        log.warning("ProLIF subprocess timed out after %ss", timeout)
        return []

    if result.returncode != 0:
        # Distinguish: 2 = our own error path (with traceback in stderr),
        # negative = signal (SIGSEGV is -11), other = unexpected.
        if result.returncode == 2:
            err_tail = (result.stderr or "").strip().splitlines()[-3:]
            log.warning("ProLIF Python error: %s", " | ".join(err_tail))
        elif result.returncode < 0:
            log.warning("ProLIF subprocess killed by signal %s (likely RDKit segfault)", -result.returncode)
        else:
            log.warning("ProLIF subprocess exited %s; stderr: %s", result.returncode, (result.stderr or "")[-200:])
        return []

    # Find our JSON marker in stdout
    for line in result.stdout.splitlines():
        if line.startswith("@@JSON@@"):
            try:
                contacts = _json.loads(line[len("@@JSON@@"):])
            except _json.JSONDecodeError:
                log.warning("ProLIF returned malformed JSON for %s", pose_pdb.name)
                return []
            # Log empty results too — useful to distinguish "ran cleanly, no
            # interactions" from "subprocess produced no output". The former is
            # rare but happens with unusual ligands (e.g. covalent warheads
            # that ProLIF's bond-order inference handles poorly).
            if not contacts:
                stderr_tail = (result.stderr or "").strip().splitlines()[-3:]
                log.info(
                    "ProLIF found 0 contacts for %s; stderr tail: %s",
                    pose_pdb.name, " | ".join(stderr_tail) or "(empty)",
                )
            return contacts
    log.warning("ProLIF subprocess returned no JSON marker for %s", pose_pdb.name)
    return []


def _run_prolif(pose_pdb: Path, receptor_pdb: Path, *, ligand_smiles: str | None = None) -> list[dict]:
    """Compute the protein–ligand interaction fingerprint and return the contacts.

    Called inside the subprocess in `_run_prolif_safe` — never call this directly
    from the backend, or a SIGSEGV will take down uvicorn.

    ProLIF needs explicit hydrogens. Our PDBFixer pipeline omits them (because
    Meeko adds them itself for receptor prep), so we add them here on the fly
    with obabel and pass `force=True` to skip MDAnalysis' inferrer.

    `ligand_smiles` is the original input SMILES. When supplied, we build a
    template molecule from it and use Chem.AssignBondOrdersFromTemplate to
    overwrite the ligand-pose bond orders that obabel mangles in the
    PDBQT→PDB→SDF round-trip. Without this, aromatic rings come back as
    Kekulé singles and ProLIF misses every π-stacking + aromatic-N H-bond.
    """
    import prolif as plf
    import MDAnalysis as mda

    # Add hydrogens to the receptor for ProLIF (does not need to match the
    # docked receptor). Cache the H-added PDB next to the source.
    #
    # FoldX-generated PDBs start with non-standard header lines like
    # "FoldX generated pdb file" which obabel can fail on silently (returncode 0,
    # 0-byte output). Strip any non-PDB junk before passing to obabel.
    receptor_h = receptor_pdb.with_suffix(".H.pdb")
    if not receptor_h.exists() or receptor_h.stat().st_size == 0:
        # Pre-clean: keep only canonical PDB record lines so obabel doesn't choke
        cleaned_for_obabel = receptor_pdb.with_suffix(".clean4obabel.pdb")
        VALID_RECORDS = ("ATOM  ", "HETATM", "TER   ", "END   ", "CRYST1",
                         "REMARK", "HEADER", "TITLE ", "SEQRES", "MODEL ", "ENDMDL")
        with receptor_pdb.open() as fin, cleaned_for_obabel.open("w") as fout:
            for line in fin:
                if any(line.startswith(p[:6]) for p in VALID_RECORDS):
                    fout.write(line)

        res = subprocess.run(
            ["obabel", str(cleaned_for_obabel), "-O", str(receptor_h), "-h", "-p", "7.4"],
            capture_output=True, text=True, check=False,
        )
        if res.returncode != 0:
            raise RuntimeError(f"H-add failed (rc={res.returncode}): {res.stderr.strip()[:200]}")
        if not receptor_h.exists() or receptor_h.stat().st_size == 0:
            # obabel sometimes returns 0 but writes nothing on weird input
            raise RuntimeError(
                f"H-add wrote empty file. obabel stderr: {res.stderr.strip()[:200]}"
            )

    u_rec = mda.Universe(str(receptor_h))

    # force=True bypasses RDKit's strict bond-order inference for the *receptor*,
    # which is fragile on protein PDBs and unnecessary for interaction
    # fingerprinting (we only care about residue-level contacts).
    try:
        rec = plf.Molecule.from_mda(u_rec, force=True)
    except TypeError:
        rec = plf.Molecule.from_mda(u_rec)

    # Ligand load order, best-quality first:
    #   1. SDF (carries explicit bond orders from meeko) → re-template with
    #      SMILES if available (catches the ~10% of cases where obabel still
    #      drops aromaticity even from SDF).
    #   2. PDB → re-template with SMILES (the heavy lift — PDB has zero
    #      bond-order info, every bond comes back single).
    #   3. PDB via MDAnalysis with force=True (final fallback; no template).
    pose_sdf = pose_pdb.with_suffix(".sdf")
    lig = None

    from rdkit import Chem as _Chem
    from rdkit.Chem import AllChem as _AllChem

    template_mol = None
    if ligand_smiles:
        try:
            template_mol = _Chem.MolFromSmiles(ligand_smiles)
            if template_mol is None:
                log.warning("Could not build template from SMILES: %s", ligand_smiles[:40])
        except Exception as e:
            log.warning("SMILES template build failed (%s); proceeding without", e)

    def _retemplate(pose_mol: "_Chem.Mol") -> "_Chem.Mol":
        """Copy bond orders from template_mol onto pose_mol if both are valid.
        AssignBondOrdersFromTemplate requires identical atom sets — meeko's PDBQT
        export usually preserves heavy-atom counts so this matches the docked
        pose. Falls through silently to the un-templated mol on mismatch."""
        if template_mol is None:
            return pose_mol
        try:
            return _AllChem.AssignBondOrdersFromTemplate(template_mol, pose_mol)
        except Exception as e:
            log.info("AssignBondOrdersFromTemplate failed (%s); using inferred bonds", str(e)[:80])
            return pose_mol

    # Track which load path succeeded for the diagnostic-when-empty log below
    load_path = "none"
    if pose_sdf.exists() and pose_sdf.stat().st_size > 0:
        # Path 1: strict SDF + retemplate. The default path; works for most
        # ligands with clean meeko-generated SDFs.
        try:
            suppl = _Chem.SDMolSupplier(str(pose_sdf), removeHs=False, sanitize=True)
            mol = next((m for m in suppl if m is not None), None)
            if mol is not None:
                mol = _retemplate(mol)
                lig = plf.Molecule(mol)
                load_path = "sdf_strict"
        except Exception as e:
            log.warning("SDF→ProLIF strict load failed (%s); trying lenient SDF", e)

    if lig is None and pose_sdf.exists() and pose_sdf.stat().st_size > 0:
        # Path 2: lenient SDF — disable RDKit sanitization, which is what
        # rejects unusual valence states meeko sometimes emits for kinase
        # inhibitors with N-aromatic rings, S=O sulfonamides, etc. We then
        # apply MIN_PROPS sanitize manually so ProLIF still gets a usable
        # molecule. This is the path that catches Afatinib/Osimertinib
        # /Erlotinib/Gefitinib + MET (2WGJ) where strict mode rejected
        # everything.
        try:
            suppl = _Chem.SDMolSupplier(str(pose_sdf), removeHs=False, sanitize=False)
            mol = next((m for m in suppl if m is not None), None)
            if mol is not None:
                # Manual partial sanitization — skip kekulization/aromaticity
                # if they fail, but make sure ring info + valences are set.
                try:
                    _Chem.SanitizeMol(
                        mol,
                        sanitizeOps=_Chem.SanitizeFlags.SANITIZE_ALL
                        ^ _Chem.SanitizeFlags.SANITIZE_KEKULIZE
                        ^ _Chem.SanitizeFlags.SANITIZE_SETAROMATICITY,
                    )
                except Exception:
                    pass
                mol = _retemplate(mol)
                lig = plf.Molecule(mol)
                load_path = "sdf_lenient"
        except Exception as e:
            log.warning("SDF→ProLIF lenient load also failed (%s); trying PDB+template", e)

    if lig is None:
        # Path 3: load the pose PDB with RDKit and re-template. Historically
        # SIGSEGV-prone, but we're already in a subprocess so a crash just
        # kills this one job and the parent recovers cleanly.
        try:
            mol_pdb = _Chem.MolFromPDBFile(str(pose_pdb), removeHs=False, sanitize=False)
            if mol_pdb is not None:
                try:
                    _Chem.SanitizeMol(
                        mol_pdb,
                        sanitizeOps=_Chem.SanitizeFlags.SANITIZE_ALL
                        ^ _Chem.SanitizeFlags.SANITIZE_KEKULIZE
                        ^ _Chem.SanitizeFlags.SANITIZE_SETAROMATICITY,
                    )
                except Exception:
                    pass
                mol_pdb = _retemplate(mol_pdb)
                lig = plf.Molecule(mol_pdb)
                load_path = "pdb_template"
        except Exception as e:
            log.warning("PDB+template load failed (%s); falling back to MDAnalysis", e)

    if lig is None:
        # Path 4: MDAnalysis with bond inference. No bond orders, but at least
        # ProLIF gets atom positions + element types. Distance-based contacts
        # (hydrophobic, vdW) work; aromatic interactions don't.
        try:
            u_lig = mda.Universe(str(pose_pdb))
            try:
                lig = plf.Molecule.from_mda(u_lig, force=True)
            except TypeError:
                lig = plf.Molecule.from_mda(u_lig)
            load_path = "mda_fallback"
        except Exception as e:
            log.warning("All ligand-load paths failed: %s", e)
            return []

    fp = plf.Fingerprint()
    fp.run_from_iterable([lig], rec, progress=False)

    # ProLIF 2.x exposes per-interaction metadata (atom indices, distances) by
    # making each interaction's value a tuple of dicts — one per detected
    # instance of that interaction type for the same (lig, prot) pair. We use
    # the SHORTEST distance across instances as the canonical contact distance,
    # which matches how PyMOL/ChimeraX/PLIP report it (the closest contact
    # atom defines the interaction).
    #
    # Older ProLIF versions (1.x) used a plain bool; this code degrades to no
    # distance in that case rather than crashing.
    contacts: list[dict] = []
    seen: set[tuple[str, str]] = set()
    try:
        ifp = fp.ifp[0]   # first (only) ligand frame
        for (lig_id, prot_id), interactions in ifp.items():
            res = str(prot_id)  # e.g. "MET790.A"
            for itype, metadata in interactions.items():
                if not metadata:
                    continue
                if (res, itype) in seen:
                    continue
                seen.add((res, itype))
                distance = _extract_min_distance(metadata)
                contacts.append({
                    "residue": _short_residue(res),
                    "type": itype,
                    "distance": distance,  # Å, or None when ProLIF didn't report it
                })
    except Exception as e:
        log.warning("Could not extract ProLIF interactions: %s", e)

    # Diagnostic when zero contacts are found — helps triage user reports of
    # "ProLIF found no interactions". Logs the ligand atom count, residue
    # count near the ligand, and which load path was used. This information
    # appears in fly logs and helps distinguish: ligand atoms missing /
    # bond-order issue / pose actually outside the pocket / receptor missing
    # H atoms / other.
    if not contacts:
        try:
            lig_n_heavy = sum(1 for a in lig.GetAtoms() if a.GetAtomicNum() > 1)
            tmpl_n_heavy = (sum(1 for a in template_mol.GetAtoms() if a.GetAtomicNum() > 1)
                            if template_mol is not None else None)
            # Distance from ligand centroid to nearest receptor residue CA
            try:
                lig_coords = lig.GetConformer().GetPositions()
                lig_cx = float(lig_coords[:, 0].mean())
                lig_cy = float(lig_coords[:, 1].mean())
                lig_cz = float(lig_coords[:, 2].mean())
                rec_cas = u_rec.select_atoms("name CA")
                if len(rec_cas) > 0:
                    dx = rec_cas.positions[:, 0] - lig_cx
                    dy = rec_cas.positions[:, 1] - lig_cy
                    dz = rec_cas.positions[:, 2] - lig_cz
                    dists = (dx * dx + dy * dy + dz * dz) ** 0.5
                    min_ca_dist = float(dists.min())
                else:
                    min_ca_dist = -1.0
            except Exception:
                min_ca_dist = -2.0
            log.warning(
                "ProLIF zero contacts | path=%s | lig_heavy=%d tmpl_heavy=%s | nearest_CA=%.1fA",
                load_path, lig_n_heavy, str(tmpl_n_heavy), min_ca_dist,
            )
        except Exception as diag_e:
            log.warning("ProLIF zero contacts (and diagnostic failed: %s)", diag_e)

    return contacts


def _extract_min_distance(metadata) -> float | None:
    """Pull the shortest 'distance' value out of ProLIF 2.x interaction metadata.

    ProLIF 2.x: `metadata` is a tuple of dicts each with keys like
    'distance', 'indices', 'parent_indices'. Multiple dicts can exist when
    there are multiple atom-pairs satisfying the same interaction; we take
    the closest one.

    ProLIF 1.x / unknown shape: returns None silently.
    """
    try:
        if isinstance(metadata, (str, bool, int)):
            return None
        distances: list[float] = []
        for inst in metadata:
            if isinstance(inst, dict) and "distance" in inst:
                d = inst["distance"]
                if d is not None:
                    distances.append(float(d))
        if not distances:
            return None
        return round(min(distances), 2)
    except Exception:
        return None


def _short_residue(res: str) -> str:
    """Normalize ProLIF residue strings like "MET790.A" → "MET790"."""
    return res.split(".")[0] if res else res


# ────────────────────── Plain-English summary ──────────────────────

_INTERACTION_LABELS = {
    "HBDonor":     "H-bond donor",
    "HBAcceptor":  "H-bond acceptor",
    "Hydrophobic": "hydrophobic",
    "PiStacking":  "π-stacking",
    "PiCation":    "π-cation",
    "CationPi":    "cation-π",
    "Anionic":     "salt bridge",
    "Cationic":    "salt bridge",
    "VdWContact":  "van der Waals",
    "XBAcceptor":  "halogen bond",
    "XBDonor":     "halogen bond",
    "MetalDonor":  "metal coordination",
    "MetalAcceptor": "metal coordination",
}


def _make_sentence(v: Validation) -> str:
    """One readable English sentence describing the pose for the UI."""
    if v.error:
        return f"Validation skipped ({v.error})."

    bits = []
    if v.confidence != "unknown":
        conf_phrase = {
            "high":   "high-confidence pose (no PoseBusters checks failed)",
            "medium": "medium-confidence pose (a few PoseBusters checks failed)",
            "low":    "low-confidence pose — interpret with caution",
        }.get(v.confidence, f"{v.confidence} confidence")
        bits.append(conf_phrase.capitalize())

    if v.interactions:
        # Group by residue, summarize the dominant interaction type per residue.
        by_res: dict[str, list[str]] = {}
        for c in v.interactions:
            by_res.setdefault(c["residue"], []).append(c["type"])

        # Pick the most chemically interesting residues first: anything other
        # than VdWContact wins. Tiebreak by first occurrence.
        def rank(item):
            res, types = item
            non_vdw = [t for t in types if t != "VdWContact"]
            return (0 if non_vdw else 1, res)
        top = sorted(by_res.items(), key=rank)[:4]

        phrases = []
        for res, types in top:
            non_vdw = [t for t in types if t != "VdWContact"]
            label_set = sorted({_INTERACTION_LABELS.get(t, t.lower()) for t in (non_vdw or types)})
            label = " + ".join(label_set)
            phrases.append(f"{label} with {res}")

        bits.append("Key contacts: " + "; ".join(phrases) + ".")

    return " ".join(bits) if bits else "No interaction data."
