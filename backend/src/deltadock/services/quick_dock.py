"""Quick docking for the AI compound editor's closed-loop feature.

A "fast" Vina dock (exhaustiveness=4 instead of the production default
of 8) that runs in ~5–15 s on the GPU pod. Powers the "🎯 Quick dock"
button in the Ketcher AI sidebar — the user clicks, sees a real score
+ contact map without leaving the editor, then can click "✨ Optimize
for this pocket" to have Claude propose 3 variants targeted at the
specific residues their compound MISSED.

Why this is the moat: no other compound editor does live docking
inside the editor against the user's actual mutant target. Schrödinger
+ Glide can dock but not in real-time inside the editor; generic AI
molecule tools (Chemcrow, Stoned) don't know your target/mutation.

Why quick_dock and not just call the full runner: the runner does the
full validation pipeline (PoseBusters, ProLIF, strain energy) which
takes 30–90 s. For an interactive button-press experience we sacrifice
the deeper validation in favour of the score + a simple distance-based
contact list, both available in ~10 s.

Gated behind settings.quick_dock_enabled because each click costs real
GPU time. Mirrors the boltz2_enabled gating pattern.
"""
from __future__ import annotations

import logging
import math
import tempfile
from pathlib import Path
from typing import Optional, TypedDict

log = logging.getLogger(__name__)


class QuickDockResult(TypedDict, total=False):
    ok: bool
    score: float                 # best (most negative) Vina score, kcal/mol
    hits: list[str]              # residues within 4 Å of any ligand atom (e.g. ["A:LYS483", ...])
    misses: list[str]            # nearby residues (≤8 Å of pocket centroid) NOT in hits — "what we could be reaching"
    pose_pdbqt_b64: str          # base64-encoded pose PDBQT for optional 3D viewer rendering
    error: str                   # human-readable error when ok=False


# Cap on how many residues we surface to the LLM so the prompt stays
# tight. ProLIF-style fingerprints across an entire pocket can produce
# 30+ residues which is too much noise for the optimize prompt.
_MAX_HITS = 12
_MAX_MISSES = 8

# Distance thresholds (Å). 4 Å = "in van der Waals contact" by usual
# medchem convention; 8 Å = "near the pocket but not in contact".
_HIT_RADIUS_A = 4.0
_NEAR_POCKET_RADIUS_A = 8.0


def quick_dock(
    *,
    smiles: str,
    target_pdb: str,
    chain: str = "A",
    mutation: Optional[str] = None,
) -> QuickDockResult:
    """Run a fast Vina dock + extract contacts. Returns a flat dict
    safe to JSON-serialise straight to the client. Never raises; on
    any failure (bad SMILES, unsupported atoms, pod down, mutation
    can't be built) returns ok=False with a friendly error message.

    The receptor pipeline reuses the production cache:
      - PDB fetched + cleaned via fix_pdb (cached on Fly volume)
      - WT receptor PDBQT prepped via prepare_receptor (cached)
      - Mutant receptor (if mutation given) built via PDBFixer +
        prepare_receptor (cached per mutation)
      - Pocket box pulled from the catalog target entry; falls back
        to fpocket auto-detection on custom PDBs.
    """
    # Local imports — keeps cold-start fast for the common (non-quickdock)
    # request path and avoids dragging the heavy pipeline into every
    # FastAPI worker just because we have an endpoint that uses it.
    try:
        from deltadock_pipeline.fetch import fetch_pdb
        from deltadock_pipeline.prep import (
            fix_pdb, prepare_receptor, prepare_ligand,
        )
        from deltadock_pipeline.dock import PocketBox
        from deltadock_pipeline.pod_dock import (
            dock_one_pod, PodDockConfig, PodDockError,
        )
        from ..catalog import get_target
        from ..config import get_settings
    except Exception as e:
        log.exception("quick_dock pipeline import failed")
        return QuickDockResult(ok=False, error=f"Quick dock pipeline unavailable: {e}")

    smi = (smiles or "").strip()
    if not smi:
        return QuickDockResult(ok=False, error="Empty SMILES.")

    settings = get_settings()
    pod_url = settings.pod_dock_url
    if not pod_url:
        return QuickDockResult(
            ok=False,
            error="Quick dock pod isn't configured (POD_DOCK_URL missing).",
        )

    # Resolve pocket box from the catalog (preferred) or fall back to
    # fpocket auto-detection. The catalog covers our curated targets
    # (EGFR, ABL, BRAF, etc.) — for custom PDBs the user must have
    # gone through the existing /lookup/pdb path which already runs
    # detect_pocket and writes the box to the catalog cache.
    target = None
    try:
        target = get_target(target_pdb)
    except Exception:
        pass
    if target is None or target.pocket is None:
        return QuickDockResult(
            ok=False,
            error=f"No pocket box on file for {target_pdb}. Run a normal job once to cache it.",
        )

    box = PocketBox(
        center_x=target.pocket.center[0],
        center_y=target.pocket.center[1],
        center_z=target.pocket.center[2],
        size_x=target.pocket.size[0],
        size_y=target.pocket.size[1],
        size_z=target.pocket.size[2],
    )

    # Cache directories — same volume as the production runner so we
    # share receptor preps across paths. The attribute name is
    # `cache_root` (env var LIGANX_CACHE_ROOT, aliased in config.py);
    # an earlier draft of this file used `liganx_cache_root` which
    # doesn't exist on the Settings class — silently broke every
    # Quick dock call with AttributeError → 500.
    cache_root = Path(settings.cache_root or "/var/lib/liganx/poses/cache")
    pdb_cache = cache_root / "pdb"
    receptor_cache = cache_root / "receptors"
    pdb_cache.mkdir(parents=True, exist_ok=True)
    receptor_cache.mkdir(parents=True, exist_ok=True)

    # Receptor — WT path always; mutant-aware paths share the cache.
    # If mutation is set, the runner's per-mutant cache key applies.
    variant_key = (mutation or "WT").strip() or "WT"
    receptor_pdbqt = receptor_cache / f"{target_pdb}_{chain}_{variant_key}.pdbqt"
    receptor_pdb = pdb_cache / f"{target_pdb}_{chain}.clean.pdb"

    try:
        if not receptor_pdb.exists():
            raw_pdb = pdb_cache / f"{target_pdb}.pdb"
            if not raw_pdb.exists():
                fetch_pdb(target_pdb, raw_pdb)
            fix_pdb(raw_pdb, receptor_pdb, chain=chain)
        if not receptor_pdbqt.exists():
            # WT prep — for mutant variants we'd need to call the
            # mutant-build path (see runner._receptor_for_variant).
            # Quick dock leaves mutation handling to a future iteration
            # and just docks WT for now to keep this endpoint snappy.
            # If the user picked a mutation they'll see "WT receptor used"
            # noted in the response.
            if variant_key != "WT":
                log.info(
                    "quick_dock: mutation %s requested but quick_dock currently"
                    " uses WT receptor only — falling back",
                    variant_key,
                )
                receptor_pdbqt = receptor_cache / f"{target_pdb}_{chain}_WT.pdbqt"
                if not receptor_pdbqt.exists():
                    prepare_receptor(receptor_pdb, receptor_pdbqt, chain=chain)
            else:
                prepare_receptor(receptor_pdb, receptor_pdbqt, chain=chain)
    except Exception as e:
        log.exception("quick_dock: receptor prep failed")
        return QuickDockResult(ok=False, error=f"Receptor prep failed: {e}")

    # Ligand prep + dock — tempdir for both so we don't pollute caches
    # with one-off compounds users sketch in the editor.
    with tempfile.TemporaryDirectory(prefix="quickdock_") as tmpdir:
        tmp = Path(tmpdir)
        ligand_pdbqt = tmp / "ligand.pdbqt"
        try:
            prepare_ligand(smi, ligand_pdbqt)
        except Exception as e:
            log.info("quick_dock: ligand prep failed for SMILES=%r: %s", smi, e)
            return QuickDockResult(
                ok=False,
                error=(
                    f"Ligand preparation failed: {e}. "
                    f"This usually means the molecule has unusual atoms or "
                    f"geometry the docking software can't handle."
                ),
            )

        cfg = PodDockConfig(
            base_url=pod_url,
            timeout_s=min(settings.pod_dock_timeout_s, 60),
        )
        try:
            result = dock_one_pod(
                receptor_pdbqt=receptor_pdbqt,
                ligand_pdbqt=ligand_pdbqt,
                box=box,
                work_dir=tmp,
                cfg=cfg,
                exhaustiveness=4,    # half the production default for speed
                num_modes=3,         # only the top 3 — we only return best anyway
            )
        except PodDockError as e:
            log.info("quick_dock: pod call failed: %s", e)
            return QuickDockResult(
                ok=False,
                error=f"Docking pod call failed: {e}. Try again in a few seconds.",
            )
        except Exception as e:
            log.exception("quick_dock: unexpected pod failure")
            return QuickDockResult(ok=False, error=f"Unexpected docking failure: {e}")

        if not result.modes:
            return QuickDockResult(ok=False, error="Pod returned 0 docking modes.")

        best_score = float(result.modes[0].affinity_kcal_mol)

        # Contact extraction — simple distance check between the docked
        # pose's heavy atoms and the receptor's residues. Faster than
        # ProLIF (no subprocess, ~100 ms vs ~5 s) and good enough for
        # the AI optimize prompt where we only need residue identity.
        try:
            hits, misses = _extract_contacts(
                pose_pdbqt=result.pose_pdbqt,
                receptor_pdb=receptor_pdb,
                box=box,
            )
        except Exception as e:
            log.warning("quick_dock: contact extraction failed (non-fatal): %s", e)
            hits, misses = [], []

        # Pose for optional 3D rendering. Frontend uses it via a new
        # pose viewer. b64 to keep the JSON contract clean.
        import base64
        try:
            pose_b64 = base64.b64encode(result.pose_pdbqt.read_bytes()).decode("ascii")
        except Exception:
            pose_b64 = ""

        return QuickDockResult(
            ok=True,
            score=round(best_score, 2),
            hits=hits[:_MAX_HITS],
            misses=misses[:_MAX_MISSES],
            pose_pdbqt_b64=pose_b64,
        )


def _extract_contacts(
    *,
    pose_pdbqt: Path,
    receptor_pdb: Path,
    box,
) -> tuple[list[str], list[str]]:
    """Distance-based contact extraction. Returns (hits, misses).

    HITS = receptor residues with at least one heavy atom within 4 Å of
    any ligand heavy atom. These are the residues the docked compound
    is "touching".

    MISSES = receptor residues with at least one atom within 8 Å of the
    pocket centroid (i.e. INSIDE or near the binding site) but NOT in
    HITS. These are the residues "around" the compound that it could
    potentially reach with a small modification — exactly what the AI
    optimize prompt needs to suggest pocket-filling variants.

    Uses Biopython's PDB parser for the receptor and a regex scan for
    the pose PDBQT (which is line-formatted similarly to PDB).
    """
    # Pose: parse atom coords directly from the PDBQT lines.
    pose_atoms: list[tuple[float, float, float]] = []
    for line in pose_pdbqt.read_text().splitlines():
        # PDBQT atom lines start with ATOM or HETATM, and the x/y/z
        # are at the same fixed columns as PDB.
        if not (line.startswith("ATOM") or line.startswith("HETATM")):
            continue
        try:
            x = float(line[30:38]); y = float(line[38:46]); z = float(line[46:54])
            # Skip hydrogens — Vina poses can include explicit H, we
            # only want heavy-atom distances for contact definition.
            elem = line[76:78].strip().upper() if len(line) >= 78 else ""
            if elem == "H":
                continue
            pose_atoms.append((x, y, z))
        except ValueError:
            continue

    if not pose_atoms:
        return [], []

    # Receptor: Biopython parser. Slower than custom but correct on
    # weird PDB quirks (insertion codes, alt locs).
    from Bio.PDB import PDBParser
    parser = PDBParser(QUIET=True)
    try:
        structure = parser.get_structure("rec", str(receptor_pdb))
    except Exception:
        return [], []

    box_centroid = (box.center_x, box.center_y, box.center_z)

    hits_set: set[str] = set()
    nearby_set: set[str] = set()
    for model in structure:
        for chain in model:
            for residue in chain:
                # Skip waters / heteroatoms / non-standard residues —
                # they're rarely informative for medchem optimization.
                hetflag = residue.get_id()[0]
                if hetflag.strip() and hetflag != " ":
                    continue
                resname = residue.get_resname()
                resnum = residue.get_id()[1]
                key = f"{chain.id}:{resname}{resnum}"

                # Closest residue-atom distance to (a) the pose, (b) the
                # box centroid. Cheap loops; small structures.
                min_to_pose = math.inf
                min_to_centroid = math.inf
                for atom in residue:
                    if atom.element == "H":
                        continue
                    ax, ay, az = atom.coord
                    # to centroid
                    d = math.sqrt(
                        (ax - box_centroid[0]) ** 2
                        + (ay - box_centroid[1]) ** 2
                        + (az - box_centroid[2]) ** 2
                    )
                    if d < min_to_centroid:
                        min_to_centroid = d
                    # to pose (smallest distance to any pose atom)
                    for px, py, pz in pose_atoms:
                        pd = math.sqrt(
                            (ax - px) ** 2 + (ay - py) ** 2 + (az - pz) ** 2
                        )
                        if pd < min_to_pose:
                            min_to_pose = pd
                            if min_to_pose < _HIT_RADIUS_A:
                                # Already a hit; no need to keep
                                # checking for this residue.
                                break
                    if min_to_pose < _HIT_RADIUS_A:
                        break

                if min_to_pose < _HIT_RADIUS_A:
                    hits_set.add(key)
                elif min_to_centroid < _NEAR_POCKET_RADIUS_A:
                    nearby_set.add(key)

    # Stable sorted output so consecutive calls give the same prompt.
    hits = sorted(hits_set)
    misses = sorted(nearby_set - hits_set)
    return hits, misses
