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
    pdb_id: str                  # resolved RCSB PDB id (e.g. "4OBE") — frontend uses this to fetch receptor for the pose viewer
    chain: str                   # resolved chain id (e.g. "A") — same use as pdb_id
    error: str                   # human-readable error when ok=False
    # Mutation-aware-scoring fields (added 2026-05-04 with the
    # services/receptor_prep.py wiring). receptor_variant is "mutant" when
    # the dock actually used a PDBFixer-built mutant; "wt" when no mutation
    # was requested OR when the build fell back to WT. mutation_caveat is
    # populated only on fallback so the UI can render an honest warning
    # ("Mutant build failed; this score is WT").
    receptor_variant: str        # "mutant" | "wt"
    mutation_caveat: str         # populated only when fallback to WT happened despite a mutation request
    # Pose-pocket honesty fields (added 2026-05-04). Vina with a wide
    # pocket box (~22.5 Å cube on catalog targets) regularly finds
    # high-affinity poses on surface features that are NOT the canonical
    # binding site — the score looks great but the pose isn't where you
    # want it. These two fields let the UI render an honest "pose
    # drifted off-center" badge before the user pays for a Full Job.
    pose_offset_a: float         # Å — distance from docked pose centroid to pocket box center
    pose_in_pocket: bool         # offset <= POSE_DRIFT_THRESHOLD_A AND len(hits) > 0
    dock_attempts: int           # number of Vina re-rolls that ran (1 happy path, up to 3 if first was out of pocket)


# Cap on how many residues we surface to the LLM so the prompt stays
# tight. ProLIF-style fingerprints across an entire pocket can produce
# 30+ residues which is too much noise for the optimize prompt.
_MAX_HITS = 12
_MAX_MISSES = 8

# Distance thresholds (Å). 4 Å = "in van der Waals contact" by usual
# medchem convention; 8 Å = "near the pocket but not in contact".
_HIT_RADIUS_A = 4.0
_NEAR_POCKET_RADIUS_A = 8.0

# Pose-drift threshold (Å). The catalog box is ~22.5 Å on a side, so a
# pose centroid that's 6+ Å from the box center is sitting in a corner
# of the search volume — usually a non-canonical surface site, not the
# real binding pocket. Empirically tuned: the kinase ATP pocket has
# centroid offsets ≤ 4 Å in cross-docking sanity checks, while the
# wandering KRAS poses we caught had offsets of 8-12 Å.
_POSE_DRIFT_THRESHOLD_A = 6.0
def _humanize_pod_error(raw: str) -> str:
    """Translate a raw Pod/Vina error into a friendly user-facing message.

    The Pod's stderr passthrough leaks ugly internals straight to the
    UI: literal "\\n" escape sequences, the QuickVina author's email,
    HTTP 500 wrappers, JSON-detail framing. Users have no idea what to
    do with that. This pattern-matches the common cases and rewrites
    them to a chemist-friendly action.

    2026-05-04 user report: a MW=627.8 / logP=7.57 compound triggered
    'vina-gpu rc=1: ... Jiansheng Wu <jiansen@njupt.edu> ...' raw in
    the editor's error banner.
    """
    if not raw:
        return "Docking failed."
    s = str(raw)
    low = s.lower()
    # Compound-too-large for QuickVina2-GPU: rc=1 with the QuickVina
    # author email is the canonical signature. Vina-GPU has a fixed
    # ligand-flexibility cap and chokes on big peptide-like molecules.
    if "vina-gpu" in low and ("rc=1" in low or "rc=255" in low):
        return (
            "Compound too large or flexible for the GPU docker. "
            "Try a smaller scaffold (MW < 500), or use Promote to Full Job — "
            "the CPU path has no flexibility cap."
        )
    # HTTP 502 / pod offline.
    if "502" in s or "Bad Gateway" in s.lower():
        return "GPU pod isn't responding right now. Try again in a few seconds."
    # Generic HTTP 5xx: strip JSON detail framing.
    if "HTTP 5" in s:
        return "GPU pod returned an error. Try again in a few seconds."
    # Last resort: take the first line, strip literal escape sequences,
    # cap at 160 chars so the banner stays readable.
    cleaned = s.replace("\\n", " ").replace("\\t", " ")
    first = cleaned.split("\n")[0].strip()
    if len(first) > 160:
        first = first[:157] + "…"
    return first or "Docking failed."


# Up to N independent Vina re-rolls when the first pose is out of pocket.
# Vina is non-deterministic; re-rolling samples a different starting
# orientation. Cost: 1 dock = ~6s, 3 docks = ~18s. Cloudflare timeout
# is 100s so we have headroom. Most happy-path calls hit pocket on the
# first try and never trigger the retry.
_MAX_POCKET_RETRIES = 3


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

    # Resolve the actual RCSB PDB id + chain from the catalog. The caller
    # passes a CATALOG ID like 'kras' (matching catalog.py's Target.id),
    # not an RCSB PDB ID like '4OBE'. Earlier code used `target_pdb`
    # directly for fetch_pdb() and cache filenames, which made RCSB
    # return HTTP 404 ('kras' isn't a PDB ID) AND made the cache key
    # incompatible with the production runner's '{pdb_id}_{chain}'
    # convention — every Quick dock would either 404 or miss the
    # warm cache. Using target.pdb_id + target.chain fixes both.
    pdb_id = target.pdb_id
    chain = target.chain or chain  # respect the catalog's chain when set

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

    # Receptor — uses the shared services/receptor_prep.py helper which
    # handles cache → PDBFixer build → verify → WT fallback. This is
    # the SAME code path the production New Job runner uses, so:
    #  - First click on a new mutation pays ~30-60s build cost
    #  - Subsequent clicks hit cache
    #  - A warm cache from a prior full job's mutant build is reused for free
    # 2026-05-04: previously this endpoint silently docked WT regardless of
    # the requested mutation. The user saw "Quick dock vs T315I" but was
    # actually scoring against WT — meaningful for the relative Δ but not
    # for the absolute mutation-aware affinity.
    from .receptor_prep import prepare_receptor_for_target
    rec = prepare_receptor_for_target(
        pdb_id=pdb_id,
        chain=chain,
        mutation=mutation,
        pdb_cache=pdb_cache,
        receptor_cache=receptor_cache,
        minimize_mutant=getattr(target, "minimize_mutant", True) if target else True,
    )
    receptor_pdbqt = rec.receptor_pdbqt
    receptor_pdb = rec.receptor_pdb
    if not receptor_pdbqt.exists() or receptor_pdbqt.stat().st_size == 0:
        return QuickDockResult(
            ok=False,
            error=rec.fallback_reason or f"Receptor PDBQT missing for {pdb_id}_{chain}",
        )
    if rec.fallback_reason and not rec.is_mutant and mutation:
        # Loud log but still proceed — user will see the score and we
        # surface the caveat in the response (caller can render it).
        log.warning(
            "quick_dock: requested %s but fell back to WT (%s)",
            mutation, rec.fallback_reason,
        )

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

        # Vina-pod sanity gate — added 2026-05-03 after repeated
        # `vina-gpu rc=255` crashes from AI-generated Optimize variants.
        # `prepare_ligand` validates "can produce a PDBQT"; this checks
        # the molecule against vina-gpu's structural limits, which are
        # tighter than CPU vina:
        #   - >32 rotatable bonds: vina-gpu's flex parser overflows
        #     (we cap at 25 to leave headroom for the GPU implementation,
        #      which is even stricter than the upstream vina spec).
        #   - >100 heavy atoms: PDBQT array sizing assumptions break
        #     somewhere in the GPU kernel; cap at 80 to be safe.
        #   - MW >900 Da: vina's empirical scoring function was trained
        #     on drug-like molecules; predictions drift wildly above
        #     this threshold and the score is meaningless even when the
        #     dock "succeeds." Better to stop early than ship junk.
        # Failures here return ok=False with a clear reason — the
        # Optimize loop on the frontend then renders this as the
        # variant's error pill instead of a generic Pod 500.
        try:
            from rdkit import Chem
            from rdkit.Chem import Lipinski, Descriptors
            mol = Chem.MolFromSmiles(smi)
            if mol is None:
                return QuickDockResult(
                    ok=False,
                    error="RDKit can't parse this SMILES — skip.",
                )
            n_heavy = mol.GetNumHeavyAtoms()
            n_rot = Lipinski.NumRotatableBonds(mol)
            mw = Descriptors.MolWt(mol)
            if n_rot > 25:
                return QuickDockResult(
                    ok=False,
                    error=(
                        f"Too flexible for vina-gpu ({n_rot} rotatable bonds; "
                        f"limit 25). Try a more rigid analog."
                    ),
                )
            if n_heavy > 80:
                return QuickDockResult(
                    ok=False,
                    error=(
                        f"Too large for vina-gpu ({n_heavy} heavy atoms; "
                        f"limit 80). Simplify the scaffold."
                    ),
                )
            if mw > 900:
                return QuickDockResult(
                    ok=False,
                    error=(
                        f"MW {mw:.0f} Da exceeds vina's reliable range (~900 Da). "
                        f"Score would be unreliable; skipping."
                    ),
                )
            log.info(
                "quick_dock sanity gate ok: heavy=%d rot=%d mw=%.1f",
                n_heavy, n_rot, mw,
            )
        except Exception as e:
            # Sanity check itself failed — log + proceed. Better to attempt
            # the dock than block on a bad import.
            log.warning("quick_dock sanity gate skipped (error: %s)", e)

        cfg = PodDockConfig(
            base_url=pod_url,
            timeout_s=min(settings.pod_dock_timeout_s, 60),
        )
        # Pocket-best pose selection (2026-05-04). Vina with a wide
        # search box regularly finds high-affinity poses on non-canonical
        # surface sites that LOOK great by score but aren't actually in
        # the binding pocket. The Full Job runner re-rolls Vina and
        # often picks a different pose, so the Quick Dock score doesn't
        # match the Full Job result — user feedback: "after the full
        # docking job it's always mostly out of pocket".
        #
        # Strategy: dock once. If the pose centroid is within 6 Å of
        # the box center → return immediately (happy path, ~6s).
        # Otherwise, re-roll Vina up to 2 more times (different random
        # seeds each call) and pick the score-best pose whose centroid
        # is in pocket. If all rolls drift, return the score-best
        # overall but mark pose_in_pocket=False so the UI shows an
        # honest amber caveat. Worst case ~18s.
        box_center = (box.center_x, box.center_y, box.center_z)
        attempts: list[tuple[float, "DockingResult"]] = []
        last_error: Optional[str] = None
        for attempt_idx in range(_MAX_POCKET_RETRIES):
            try:
                roll = dock_one_pod(
                    receptor_pdbqt=receptor_pdbqt,
                    ligand_pdbqt=ligand_pdbqt,
                    box=box,
                    work_dir=tmp,
                    cfg=cfg,
                    # 2026-05-04: bumped from 4 to 8 to match the production
                    # runner AND the optimize_loop batch dock. Was at 4 for
                    # speed, but the resulting ~0.7 kcal/mol noise meant
                    # users saw the Optimize-suggested score and the
                    # Re-dock score disagreeing by more than the threshold
                    # we tell the AI to target (≥0.5 kcal/mol improvement
                    # to be reproducible). Bumping closes that gap.
                    # Cost: ~3s → ~6s per Quick Dock click. Negligible vs
                    # the network round-trip.
                    exhaustiveness=8,
                    num_modes=3,         # only the top 3 — we only return best anyway
                )
            except PodDockError as e:
                last_error = _humanize_pod_error(str(e))
                log.info("quick_dock: pod call failed (attempt %d): %s", attempt_idx + 1, e)
                # Don't retry on pod errors — likely systemic
                break
            except Exception as e:
                log.exception("quick_dock: unexpected pod failure (attempt %d)", attempt_idx + 1)
                last_error = _humanize_pod_error(str(e))
                break

            if not roll.modes:
                last_error = "Pod returned 0 docking modes"
                break

            offset = compute_pose_offset_a(
                pose_pdbqt=roll.pose_pdbqt,
                box_center=box_center,
            )
            attempts.append((offset, roll))
            log.info(
                "quick_dock attempt %d: score=%.2f offset=%.1f Å (threshold=%.1f)",
                attempt_idx + 1,
                roll.modes[0].affinity_kcal_mol,
                offset,
                _POSE_DRIFT_THRESHOLD_A,
            )
            # Happy path: first pose is in pocket → done. No retry.
            if offset <= _POSE_DRIFT_THRESHOLD_A:
                break

        if not attempts:
            # last_error already humanized via _humanize_pod_error above.
            # Don't append ". Try again" when the message itself already
            # includes guidance (compound-too-large message ends with a CTA).
            msg = last_error or "Docking failed."
            if "Try" not in msg:
                msg = msg + ". Try again in a few seconds."
            return QuickDockResult(ok=False, error=msg)

        # Pick the best pose: prefer in-pocket attempts (score-best of
        # those); fall back to score-best overall if all drifted. This
        # matches user intent — "show me the best pose that's actually
        # in the pocket". Score is more-negative-is-better.
        in_pocket_attempts = [a for a in attempts if a[0] <= _POSE_DRIFT_THRESHOLD_A]
        candidate_pool = in_pocket_attempts if in_pocket_attempts else attempts
        best_offset, result = min(
            candidate_pool, key=lambda a: a[1].modes[0].affinity_kcal_mol,
        )
        dock_attempts_used = len(attempts)
        pose_in_pocket = bool(in_pocket_attempts) and best_offset <= _POSE_DRIFT_THRESHOLD_A

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

        # In-pocket flag also requires at least one hit residue. A pose
        # with offset within 6 Å but zero hits is sitting in empty space
        # near the box center (rare but possible after an OpenMM
        # minimisation pulled the pocket sidechains away).
        pose_in_pocket_final = pose_in_pocket and len(hits) > 0
        out = QuickDockResult(
            ok=True,
            score=round(best_score, 2),
            hits=hits[:_MAX_HITS],
            misses=misses[:_MAX_MISSES],
            pose_pdbqt_b64=pose_b64,
            # Surface the resolved RCSB PDB id + chain so the frontend
            # can fetch the cleaned receptor for the docked-pose 3D
            # viewer (the editor only knows the catalog id like 'kras',
            # not the underlying '4OBE'). Both are already cached on
            # the same Fly volume the receptor came from.
            pdb_id=pdb_id,
            chain=chain,
            # Mutation-aware-scoring transparency. UI can render a green
            # "Mutant T315I" badge when receptor_variant=="mutant" or an
            # amber "WT only — mutant build failed" caveat when "wt" but
            # the user requested a mutation.
            receptor_variant="mutant" if rec.is_mutant else "wt",
            # Pose-pocket honesty. UI renders an amber "Pose drifted
            # off-center" badge when pose_in_pocket=False so the user
            # knows the score isn't reliable for the canonical site
            # before paying for a Full Job.
            pose_offset_a=round(best_offset, 1),
            pose_in_pocket=pose_in_pocket_final,
            dock_attempts=dock_attempts_used,
        )
        if not rec.is_mutant and mutation and rec.fallback_reason:
            out["mutation_caveat"] = rec.fallback_reason
        return out


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


def compute_pose_offset_a(
    *,
    pose_pdbqt: Path,
    box_center: tuple[float, float, float],
) -> float:
    """Distance (Å) from the docked-pose heavy-atom centroid to the
    pocket box center. Used by the pose-drift badge in the editor and
    by the pocket-best-pose retry loop.

    Returns 0.0 if the PDBQT can't be parsed (treated as "no drift" so
    we don't false-alarm; the caller can treat 0.0 as "unknown" via
    the pose_in_pocket bool which goes False when len(hits)==0).
    """
    sx = sy = sz = 0.0
    n = 0
    try:
        for line in pose_pdbqt.read_text().splitlines():
            if not (line.startswith("ATOM") or line.startswith("HETATM")):
                continue
            try:
                x = float(line[30:38]); y = float(line[38:46]); z = float(line[46:54])
                elem = line[76:78].strip().upper() if len(line) >= 78 else ""
                if elem == "H":
                    continue
                sx += x; sy += y; sz += z; n += 1
            except ValueError:
                continue
    except Exception:
        return 0.0
    if n == 0:
        return 0.0
    cx, cy, cz = sx / n, sy / n, sz / n
    bx, by, bz = box_center
    import math
    return math.sqrt((cx - bx) ** 2 + (cy - by) ** 2 + (cz - bz) ** 2)
