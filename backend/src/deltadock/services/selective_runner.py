"""Mutant-Selective Binder Discovery — pipeline orchestrator.

This service is the brain of the standalone /selective feature (see
docs/mutant_selective_pipeline.md). It REUSES existing primitives — it never
forks or modifies them:

    • step B (build mutant structure)  → services.receptor_prep / runner
    • step C (conformer ensemble)      → pod /relax_ensemble (via runner)
    • step D.1 (differential docking)  → services.runner + dock_cache
    • step D.2 (FEP escalation, top 5) → services.fep_runner  [GATED OFF]
    • step E (analog expansion)        → services.analog_search

Build status (incremental):
    A  triage .......................... IMPLEMENTED (this file)
    B  pocket map ...................... TODO (task 5)
    C  ensemble ........................ TODO (task 5)
    D.1 differential docking ........... TODO (task 6)
    D.2 FEP escalation ................. TODO (task 7) — ships OFF
    E  analog expansion ................ TODO (task 8)

Nothing here imports from or touches the docking Job / Studio code paths, so
it cannot affect the docking critical path.
"""
from __future__ import annotations

import json
import logging
import urllib.request
import urllib.parse
from typing import Optional

log = logging.getLogger(__name__)

# UniProt REST. Public, no key. We keep the timeout tight so a slow lookup
# degrades to "unknown" (conservative: small-molecule-only) rather than
# hanging the request.
_UNIPROT_ENTRY = "https://rest.uniprot.org/uniprotkb/{acc}.json"
_UNIPROT_SEARCH = (
    "https://rest.uniprot.org/uniprotkb/search"
    "?query={q}&format=json&size=1&fields=accession,id,cc_subcellular_location,gene_names"
)
_HTTP_TIMEOUT = 8  # seconds


# ── Modality policy ───────────────────────────────────────────────────────
# Which binder modalities are physically allowed given where the target lives.
# Intracellular ⇒ the binder must cross the membrane ⇒ small-molecule only.
# Extracellular ⇒ anything (chemical / peptide / protein). Membrane targets
# are treated as extracellular-accessible for the part that faces outside,
# but flagged so the UI can caveat it.
_MODALITIES_BY_LOCALIZATION = {
    "extracellular": ["small_molecule", "peptide", "protein"],
    "membrane": ["small_molecule", "peptide", "protein"],
    "intracellular": ["small_molecule"],
    "unknown": ["small_molecule"],
}

# Substrings (lowercased) used to classify a UniProt subcellular-location
# string. Order matters: we check extracellular first (most permissive), then
# membrane, then fall through to intracellular.
_EXTRACELLULAR_HINTS = ("secreted", "extracellular")
_MEMBRANE_HINTS = ("cell membrane", "plasma membrane", "membrane")
_INTRACELLULAR_HINTS = (
    "cytoplasm", "cytosol", "nucleus", "nuclear", "mitochond", "endoplasmic",
    "golgi", "lysosome", "peroxisome", "ribosome", "cytoskeleton",
)


class SelectivityStepNotImplemented(NotImplementedError):
    """Raised by pipeline steps that are scaffolded but not yet built. The
    runner catches this and records a clear, honest stage/error so a partial
    build never silently looks 'done'."""


def _http_get_json(url: str) -> Optional[dict]:
    """GET a URL and parse JSON. Returns None on any failure (network, non-200,
    bad JSON) — callers degrade gracefully to 'unknown'."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Liganx/selective"})
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
            if resp.status != 200:
                return None
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001 — degrade, never propagate
        log.warning("selective.triage UniProt fetch failed for %s: %s", url, e)
        return None


def _extract_locations(entry: dict) -> list[str]:
    """Pull human-readable subcellular-location strings out of a UniProt
    entry JSON (the `comments[type=SUBCELLULAR LOCATION]` block)."""
    locs: list[str] = []
    for comment in entry.get("comments", []) or []:
        if comment.get("commentType") != "SUBCELLULAR LOCATION":
            continue
        for loc in comment.get("subcellularLocations", []) or []:
            value = (loc.get("location") or {}).get("value")
            if value:
                locs.append(value)
    return locs


def _classify(locations: list[str]) -> str:
    """Map a list of subcellular-location strings to one of
    intracellular | extracellular | membrane | unknown."""
    if not locations:
        return "unknown"
    blob = " ; ".join(locations).lower()
    if any(h in blob for h in _EXTRACELLULAR_HINTS):
        return "extracellular"
    if any(h in blob for h in _MEMBRANE_HINTS):
        return "membrane"
    if any(h in blob for h in _INTRACELLULAR_HINTS):
        return "intracellular"
    return "unknown"


def triage_target(
    *,
    uniprot_id: Optional[str] = None,
    gene: Optional[str] = None,
) -> dict:
    """Step A — decide where the target lives and which binder modalities are
    therefore allowed.

    Accepts a UniProt accession (preferred) or a gene symbol (resolved via the
    UniProt search API). Returns a dict ready to persist as triage_json:

        {
          "uniprot_id":  "P00533" | None,
          "localization": "intracellular" | "extracellular" | "membrane" | "unknown",
          "locations":   ["Cell membrane", ...],   # raw evidence
          "allowed_modalities": ["small_molecule", ...],
          "reasoning":   "human-readable one-liner",
          "source":      "uniprot" | "none",
        }

    Never raises — a lookup failure degrades to localization='unknown' and the
    conservative small-molecule-only policy.
    """
    entry: Optional[dict] = None
    resolved_acc = uniprot_id

    if uniprot_id:
        entry = _http_get_json(_UNIPROT_ENTRY.format(acc=urllib.parse.quote(uniprot_id)))
    elif gene:
        q = urllib.parse.quote(f"gene:{gene} AND reviewed:true")
        search = _http_get_json(_UNIPROT_SEARCH.format(q=q))
        results = (search or {}).get("results") or []
        if results:
            entry = results[0]
            resolved_acc = entry.get("primaryAccession") or entry.get("accession")

    if entry is None:
        return {
            "uniprot_id": resolved_acc,
            "localization": "unknown",
            "locations": [],
            "allowed_modalities": _MODALITIES_BY_LOCALIZATION["unknown"],
            "reasoning": (
                "Could not resolve subcellular location from UniProt — "
                "defaulting to the conservative small-molecule-only policy."
            ),
            "source": "none",
        }

    locations = _extract_locations(entry)
    localization = _classify(locations)
    modalities = _MODALITIES_BY_LOCALIZATION[localization]

    reasoning = {
        "extracellular": (
            "Target is secreted/extracellular — binders need not cross the "
            "membrane, so chemical, peptide, and protein modalities are all viable."
        ),
        "membrane": (
            "Target is membrane-associated — the extracellular-facing portion "
            "is reachable by chemical, peptide, and protein binders (verify the "
            "mutation sits on the outward face)."
        ),
        "intracellular": (
            "Target is intracellular — the binder must cross the cell membrane, "
            "which restricts the search to cell-permeable small molecules."
        ),
        "unknown": (
            "Subcellular location is unannotated/ambiguous — defaulting to the "
            "conservative small-molecule-only policy."
        ),
    }[localization]

    return {
        "uniprot_id": resolved_acc,
        "localization": localization,
        "locations": locations,
        "allowed_modalities": modalities,
        "reasoning": reasoning,
        "source": "uniprot",
    }


# ── Step D.1: differential docking + selectivity ranking ──────────────────
#
# Reuses the production quick_dock primitive, which already:
#   • builds + caches the WT receptor and the FoldX/PDBFixer mutant receptor
#     (that's step B's structural work — we get it for free), and
#   • docks a single SMILES with pocket-best pose selection, returning a
#     Vina score in kcal/mol.
#
# Differential binding = dock each candidate against BOTH the WT pocket
# (mutation=None) and the mutant pocket (mutation=<job.mutation>), then:
#       ΔΔG_sel = score_mutant − score_WT
# More-negative score = stronger binding, so a NEGATIVE ΔΔG_sel means the
# molecule binds the mutant MORE tightly than WT → mutant-selective. We rank
# most-negative first.
#
# NOTE (MVP limitation): quick_dock resolves the pocket box from the target
# catalog. Targets without a cached pocket box surface a clear per-candidate
# error ("run a normal job once to cache the pocket"). Wiring fresh pocket
# detection for arbitrary PDBs, plus true multi-conformer ensembles (step C)
# and FEP escalation (step D.2), are follow-ups.


# ── Step B: WT-vs-mutant pocket map (residue-property diff) ────────────────
#
# A point mutation reshapes the pocket by swapping one side chain for another.
# The first-order, structure-free way to characterise that change is the delta
# in the two residues' physicochemical properties: size (does it fill or open
# pocket space?), hydrophobicity (polar↔greasy?), charge (gain/lose an ionic
# contact?), and H-bonding (gain/lose a donor/acceptor?). This is the "two-blob
# WT vs mutant pocket" comparison — computed from the mutation code alone, so
# it works for ANY target instantly (no structure or pod needed).

# Per-residue properties. volume = residue volume in Å³ (Zamyatnin 1972);
# hydropathy = Kyte–Doolittle; charge at pH 7; hbond = side-chain H-bonding
# ("donor"/"acceptor"/"both"/None); aromatic flag; one-line character.
_AA = {
    "A": (88.6, 1.8, 0, None, False, "Ala — small, hydrophobic"),
    "R": (173.4, -4.5, 1, "donor", False, "Arg — large, positively charged"),
    "N": (114.1, -3.5, 0, "both", False, "Asn — polar amide"),
    "D": (111.1, -3.5, -1, "acceptor", False, "Asp — negatively charged"),
    "C": (108.5, 2.5, 0, "donor", False, "Cys — thiol, can form disulfides"),
    "Q": (143.8, -3.5, 0, "both", False, "Gln — polar amide"),
    "E": (138.4, -3.5, -1, "acceptor", False, "Glu — negatively charged"),
    "G": (60.1, -0.4, 0, None, False, "Gly — tiny, flexible (no side chain)"),
    "H": (153.2, -3.2, 0, "both", True, "His — aromatic, weakly basic"),
    "I": (166.7, 4.5, 0, None, False, "Ile — bulky, hydrophobic, β-branched"),
    "L": (166.7, 3.8, 0, None, False, "Leu — bulky, hydrophobic"),
    "K": (168.6, -3.9, 1, "donor", False, "Lys — large, positively charged"),
    "M": (162.9, 1.9, 0, None, False, "Met — bulky, hydrophobic, flexible"),
    "F": (189.9, 2.8, 0, None, True, "Phe — large aromatic, hydrophobic"),
    "P": (112.7, -1.6, 0, None, False, "Pro — rigid, kinks the backbone"),
    "S": (89.0, -0.8, 0, "both", False, "Ser — small, polar hydroxyl"),
    "T": (116.1, -0.7, 0, "both", False, "Thr — polar hydroxyl, β-branched"),
    "W": (227.8, -0.9, 0, "donor", True, "Trp — largest, aromatic"),
    "Y": (193.6, -1.3, 0, "both", True, "Tyr — large aromatic, polar hydroxyl"),
    "V": (140.0, 4.2, 0, None, False, "Val — hydrophobic, β-branched"),
}
_AA_NAME = {
    "A": "Ala", "R": "Arg", "N": "Asn", "D": "Asp", "C": "Cys", "Q": "Gln",
    "E": "Glu", "G": "Gly", "H": "His", "I": "Ile", "L": "Leu", "K": "Lys",
    "M": "Met", "F": "Phe", "P": "Pro", "S": "Ser", "T": "Thr", "W": "Trp",
    "Y": "Tyr", "V": "Val",
}


def _residue_props(aa: str) -> Optional[dict]:
    aa = (aa or "").upper()
    if aa not in _AA:
        return None
    v, h, c, hb, arom, desc = _AA[aa]
    return {"code": aa, "name": _AA_NAME[aa], "volume_a3": v, "hydropathy_kd": h,
            "charge": c, "hbond": hb, "aromatic": arom, "description": desc}


def _one_substitution_diff(wt: str, pos: int, mut: str) -> Optional[dict]:
    wp, mp = _residue_props(wt), _residue_props(mut)
    if wp is None or mp is None:
        return None
    dv = round(mp["volume_a3"] - wp["volume_a3"], 1)
    dh = round(mp["hydropathy_kd"] - wp["hydropathy_kd"], 1)
    dc = mp["charge"] - wp["charge"]
    notes: list[str] = []
    if dv >= 25:
        notes.append(f"bulkier side chain (+{dv:.0f} Å³) — fills pocket space; can sterically clash or add a new hydrophobic contact")
    elif dv <= -25:
        notes.append(f"smaller side chain ({dv:.0f} Å³) — opens a cavity the binder could exploit")
    if dh >= 2:
        notes.append("markedly more hydrophobic — favours greasy/aromatic groups, disfavours polar ones")
    elif dh <= -2:
        notes.append("markedly more polar — favours H-bonding/charged groups")
    if dc != 0:
        notes.append(f"net charge change ({'+' if dc > 0 else ''}{dc}) — gains/loses an ionic contact at the site")
    if wp["hbond"] and not mp["hbond"]:
        notes.append("loses a side-chain hydrogen-bonding group")
    elif mp["hbond"] and not wp["hbond"]:
        notes.append("gains a side-chain hydrogen-bonding group")
    if mp["aromatic"] and not wp["aromatic"]:
        notes.append("introduces an aromatic ring — enables π-stacking")
    elif wp["aromatic"] and not mp["aromatic"]:
        notes.append("removes an aromatic ring — loses π-stacking")
    if mut.upper() == "P":
        notes.append("introduces proline — rigidifies the backbone, may reshape the pocket")
    if mut.upper() == "G":
        notes.append("introduces glycine — adds backbone flexibility")
    if not notes:
        notes.append("a conservative substitution — modest change to the pocket")
    return {
        "position": pos, "wt_residue": wp, "mut_residue": mp,
        "delta_volume_a3": dv, "delta_hydropathy_kd": dh, "delta_charge": dc,
        "summary": f"{wp['name']}{pos}{mp['name']}: " + "; ".join(notes) + ".",
    }


def pocket_diff(mutation: str) -> Optional[dict]:
    """Step B — characterise how the mutation(s) reshape the pocket, from the
    mutation code alone (no structure needed). Handles one or more
    substitutions separated by '+' or '_'. Returns None if unparseable."""
    import re
    if not mutation:
        return None
    subs: list[dict] = []
    for tok in re.split(r"[+_]", mutation.strip()):
        m = re.fullmatch(r"([A-Za-z])(\d+)([A-Za-z])", tok.strip())
        if not m:
            continue
        d = _one_substitution_diff(m.group(1), int(m.group(2)), m.group(3))
        if d:
            subs.append(d)
    if not subs:
        return None
    return {
        "mutation": mutation,
        "substitutions": subs,
        "summary": subs[0]["summary"],
        "method": "residue-property delta (size, hydrophobicity, charge, H-bonding)",
    }


def _open_session():
    """Fresh DB session for the background task (request session is gone)."""
    from sqlmodel import Session
    from ..db import engine
    return Session(engine)


# ── Step C: multi-conformer ensemble docking ──────────────────────────────
def dock_candidate(
    *,
    smiles: str,
    target_pdb: str,
    chain: str,
    mutation: Optional[str],
    ensemble_size: int = 1,
) -> dict:
    """Dock one candidate against one variant, returning a quick_dock-shaped
    dict {ok, score, pose_in_pocket, mutation_caveat, ...}.

    Handles BOTH catalog targets and arbitrary PDBs: the pocket box comes from
    the catalog when available, otherwise it's auto-detected (co-crystal HETATM
    → fpocket), mirroring the Studio runner — so the demo user can pick any
    target, not just curated ones. ensemble_size<=1 docks a single snapshot;
    >1 docks an MD-relaxed conformer ensemble (step C) and keeps the best
    in-pocket pose.

    FAIL-SOFT: any problem transparently falls back to the single-snapshot
    quick_dock (catalog targets), so a run never hard-crashes.
    """
    try:
        result = _dock_candidate_impl(
            smiles=smiles, target_pdb=target_pdb, chain=chain,
            mutation=mutation, ensemble_size=ensemble_size,
        )
        if result is not None:
            return result
    except Exception as e:  # noqa: BLE001 — never let docking break a run
        log.warning("selective.dock: impl failed, falling back to quick_dock: %s", e)
    from .quick_dock import quick_dock
    return quick_dock(smiles=smiles, target_pdb=target_pdb, chain=chain, mutation=mutation)


def _dock_candidate_impl(
    *,
    smiles: str,
    target_pdb: str,
    chain: str,
    mutation: Optional[str],
    ensemble_size: int,
) -> Optional[dict]:
    """Dock one candidate against one variant. Resolves the pocket box from the
    catalog when possible, else auto-detects it (co-crystal HETATM → fpocket)
    so arbitrary PDBs work. Single snapshot when ensemble_size<=1, else an
    MD-relaxed conformer ensemble. Returns a quick_dock-shaped dict, or None to
    signal the caller should fall back to quick_dock."""
    import tempfile
    from pathlib import Path

    from deltadock_pipeline.prep import prepare_receptor, prepare_ligand
    from deltadock_pipeline.dock import PocketBox
    from deltadock_pipeline.pod_dock import (
        dock_one_pod, PodDockConfig, PodDockError, relax_ensemble_pod,
    )
    from ..catalog import get_target, CATALOG
    from ..config import get_settings
    from .receptor_prep import prepare_receptor_for_target
    from .pocket_filter import _POSE_DRIFT_THRESHOLD_A, compute_pose_offset_a
    from .pod_activity import bump_pod_activity

    settings = get_settings()
    pod_url = settings.pod_dock_url
    if not pod_url:
        return None  # no pod → fall back

    cache_root = Path(settings.cache_root or "/var/lib/liganx/poses/cache")
    pdb_cache = cache_root / "pdb"
    receptor_cache = cache_root / "receptors"
    pdb_cache.mkdir(parents=True, exist_ok=True)
    receptor_cache.mkdir(parents=True, exist_ok=True)

    # ── Resolve the pocket box ────────────────────────────────────────────
    # 1) Catalog by slug ('egfr') or by RCSB PDB id ('2ITY'). 2) Auto-detect
    #    (co-crystal HETATM → fpocket) for arbitrary PDBs / user uploads.
    target = None
    try:
        target = get_target(target_pdb)
    except Exception:  # noqa: BLE001
        target = None
    if target is None:
        try:
            target = next((t for t in CATALOG if t.pdb_id.upper() == target_pdb.upper()), None)
        except Exception:  # noqa: BLE001
            target = None

    bump_pod_activity()
    pocket_caveat = None
    minimize_mutant = True
    if target is not None and target.pocket is not None:
        pdb_id = target.pdb_id
        chain = target.chain or chain
        box = PocketBox(
            center_x=target.pocket.center[0], center_y=target.pocket.center[1], center_z=target.pocket.center[2],
            size_x=target.pocket.size[0], size_y=target.pocket.size[1], size_z=target.pocket.size[2],
        )
        minimize_mutant = getattr(target, "minimize_mutant", True)
    else:
        # Arbitrary PDB / user upload — fetch + auto-detect the pocket.
        pdb_id = target_pdb
        try:
            from deltadock_pipeline.fetch import fetch_pdb
            from deltadock_pipeline.pocket import detect_pocket
            raw_pdb = fetch_pdb(pdb_id, pdb_cache)
            detected = detect_pocket(raw_pdb, chain=chain)
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": f"Couldn't fetch/scan {pdb_id}: {e}"}
        if not detected:
            return {"ok": False, "error": (
                f"No binding pocket could be auto-detected in {pdb_id} "
                "(no co-crystal ligand found). Use a target with a known pocket "
                "or upload a structure with a bound ligand.")}
        box = PocketBox(
            center_x=detected.center[0], center_y=detected.center[1], center_z=detected.center[2],
            size_x=22.0, size_y=22.0, size_z=22.0,
        )
        pocket_caveat = f"pocket auto-detected ({detected.source_het})"
    box_center = (box.center_x, box.center_y, box.center_z)

    rec = prepare_receptor_for_target(
        pdb_id=pdb_id, chain=chain, mutation=mutation,
        pdb_cache=pdb_cache, receptor_cache=receptor_cache,
        minimize_mutant=minimize_mutant,
    )
    if not rec.receptor_pdbqt.exists() or rec.receptor_pdbqt.stat().st_size == 0:
        return None
    mutation_caveat = (rec.fallback_reason if (mutation and not rec.is_mutant) else None) or pocket_caveat

    cfg = PodDockConfig(base_url=pod_url, timeout_s=min(settings.pod_dock_timeout_s, 60))

    with tempfile.TemporaryDirectory(prefix="sel_dock_") as tmpdir:
        tmp = Path(tmpdir)
        ligand_pdbqt = tmp / "ligand.pdbqt"
        try:
            prepare_ligand(smiles, ligand_pdbqt)
        except Exception as e:  # noqa: BLE001 — bad ligand; report
            return {"ok": False, "error": f"Ligand preparation failed: {e}"}

        ens_dir = tmp / "ensemble"
        ens_dir.mkdir(exist_ok=True)
        # Single snapshot when ensemble_size<=1 (skip the relax step entirely);
        # otherwise generate ensemble_size-1 MD-relaxed conformers (relax never
        # raises — returns [input] on failure, degrading to single).
        if ensemble_size and ensemble_size > 1:
            conformer_pdbs = relax_ensemble_pod(
                receptor_pdb=rec.receptor_pdb, box_center=box_center, out_dir=ens_dir, cfg=cfg,
                n_relaxed=max(1, ensemble_size - 1),
            )
        else:
            conformer_pdbs = [rec.receptor_pdb]

        # conformer 0 is the original receptor whose PDBQT is already built.
        conformers = [rec.receptor_pdbqt]
        for i, conf_pdb in enumerate(conformer_pdbs[1:], start=1):
            try:
                conf_pdbqt = ens_dir / f"{conf_pdb.stem}.pdbqt"
                prepare_receptor(conf_pdb, conf_pdbqt, chain=chain)
                conformers.append(conf_pdbqt)
            except Exception as e:  # noqa: BLE001
                log.warning("selective.ensemble: conformer %d prep failed: %s — dropping", i, e)

        # Dock the ligand against each conformer; collect (offset, score).
        attempts: list[tuple[float, float]] = []
        for conf_pdbqt in conformers:
            run_dir = ens_dir / f"dock_{conf_pdbqt.stem}"
            run_dir.mkdir(exist_ok=True)
            try:
                roll = dock_one_pod(
                    receptor_pdbqt=conf_pdbqt, ligand_pdbqt=ligand_pdbqt, box=box,
                    work_dir=run_dir, cfg=cfg, exhaustiveness=8, num_modes=9,
                )
            except (PodDockError, Exception) as e:  # noqa: BLE001
                log.warning("selective.ensemble: conformer dock failed: %s", e)
                continue
            if not roll.modes:
                continue
            offset = compute_pose_offset_a(pose_pdbqt=roll.pose_pdbqt, box_center=box_center)
            attempts.append((offset, float(roll.modes[0].affinity_kcal_mol)))

        if not attempts:
            return None  # nothing docked → fall back to single quick_dock

        # Prefer in-pocket poses; among those (or all, if none in pocket) take
        # the most-negative score.
        in_pocket = [a for a in attempts if a[0] <= _POSE_DRIFT_THRESHOLD_A]
        pool = in_pocket if in_pocket else attempts
        best_offset, best_score = min(pool, key=lambda a: a[1])
        return {
            "ok": True,
            "score": best_score,
            "pose_in_pocket": bool(in_pocket) and best_offset <= _POSE_DRIFT_THRESHOLD_A,
            "mutation_caveat": mutation_caveat,
            # Path-agnostic honesty signal (quick_dock returns the same key):
            # "mutant" only when the mutant structure genuinely built; "wt"
            # when a mutation was requested but the build fell back to WT.
            "receptor_variant": "mutant" if getattr(rec, "is_mutant", False) else "wt",
            "n_conformers": len(conformers),
        }


def _load_job(session, job_share_id: str):
    from sqlmodel import select
    from ..models import SelectivityJob
    return session.exec(
        select(SelectivityJob).where(SelectivityJob.share_id == job_share_id)
    ).first()


def _set_progress(job_share_id: str, *, status=None, stage=None,
                  ranked_hits=None, error_message=None) -> None:
    """Atomically update a run's progress on its own session."""
    from datetime import datetime
    from ..models import SelectivityJobStatus  # noqa: F401 (status passed in)
    with _open_session() as session:
        job = _load_job(session, job_share_id)
        if job is None:
            return
        if status is not None:
            job.status = status
        if stage is not None:
            job.stage = stage
        if ranked_hits is not None:
            job.ranked_hits_json = json.dumps(ranked_hits)
        if error_message is not None:
            job.error_message = error_message
        job.updated_at = datetime.utcnow()
        session.add(job)
        session.commit()


def run_differential_pipeline(job_share_id: str) -> None:
    """Step D.1 — dock the candidate set against WT and mutant, rank by
    ΔΔG_sel. Runs in a background task. Never raises out — failures are
    recorded on the job row so the UI can render them.
    """
    from ..models import SelectivityJobStatus

    # Snapshot the inputs we need, then release the session for the (slow)
    # docking loop so we don't hold a connection open across many pod calls.
    with _open_session() as session:
        job = _load_job(session, job_share_id)
        if job is None:
            log.warning("selective.pipeline: run %s not found", job_share_id)
            return
        if job.status == SelectivityJobStatus.CANCELLED:
            return
        target_pdb = job.pdb_id
        chain = job.chain
        mutation = job.mutation
        ensemble_size = job.ensemble_size or 1
        try:
            candidates = json.loads(job.candidates_json or "[]")
        except (ValueError, TypeError):
            candidates = []

    if not candidates:
        _set_progress(job_share_id, status=SelectivityJobStatus.FAILED,
                      stage=None, error_message="No candidate molecules supplied.")
        return

    # Sanity import — fail early with a clear message if the docking pipeline
    # is unavailable. dock_candidate() handles single vs ensemble internally.
    try:
        from .quick_dock import quick_dock  # noqa: F401 — import-availability check
    except Exception as e:  # noqa: BLE001
        _set_progress(job_share_id, status=SelectivityJobStatus.FAILED,
                      error_message=f"Docking pipeline unavailable: {e}")
        return

    n = len(candidates)
    ranked: list[dict] = []

    for i, cand in enumerate(candidates, start=1):
        # Cooperative cancellation between candidates.
        with _open_session() as session:
            cur = _load_job(session, job_share_id)
            if cur is None or cur.status == SelectivityJobStatus.CANCELLED:
                return

        name = (cand.get("name") or f"cand_{i}").strip()
        smiles = (cand.get("smiles") or "").strip()
        _set_progress(job_share_id, status=SelectivityJobStatus.DOCKING,
                      stage=f"docking_{i}_of_{n}")
        if not smiles:
            ranked.append({"name": name, "smiles": smiles, "error": "empty SMILES"})
            continue

        # dock_candidate handles single-snapshot (ensemble_size<=1) vs the
        # multi-conformer ensemble path (step C) internally, with fallback.
        wt = dock_candidate(smiles=smiles, target_pdb=target_pdb, chain=chain,
                            mutation=None, ensemble_size=ensemble_size)
        mut = dock_candidate(smiles=smiles, target_pdb=target_pdb, chain=chain,
                             mutation=mutation, ensemble_size=ensemble_size)

        row: dict = {"name": name, "smiles": smiles}
        if not wt.get("ok"):
            row["error"] = f"WT dock failed: {wt.get('error')}"
            ranked.append(row)
            continue
        if not mut.get("ok"):
            row["error"] = f"Mutant dock failed: {mut.get('error')}"
            ranked.append(row)
            continue

        # ── Honesty gate ─────────────────────────────────────────────────
        # If a mutation was requested but the mutant structure could NOT be
        # built (residue-numbering mismatch, missing residue, etc.), the
        # "mutant" dock actually ran against the WT fallback — so score_mut ≈
        # score_wt and any ΔΔG_sel would be a WT-vs-WT artefact, not biology.
        # Never surface a selectivity number in that case: mark the row
        # not-scored with the concrete reason so it can't masquerade as a real
        # hit and can't push the run to a misleading "completed".
        if mutation and mut.get("receptor_variant") != "mutant":
            reason = mut.get("mutation_caveat") or "mutant structure could not be built"
            row["error"] = f"Mutant not built — {reason}"
            row["mutant_build_failed"] = True
            ranked.append(row)
            continue

        score_wt = float(wt["score"])
        score_mut = float(mut["score"])
        row.update({
            "score_wt": round(score_wt, 2),
            "score_mut": round(score_mut, 2),
            "ddg_sel": round(score_mut - score_wt, 2),  # negative = mutant-selective
            "pose_in_pocket_wt": bool(wt.get("pose_in_pocket", False)),
            "pose_in_pocket_mut": bool(mut.get("pose_in_pocket", False)),
            "mutation_caveat": mut.get("mutation_caveat") or None,
            # Number of receptor conformers actually docked (1 = single snapshot).
            "n_conformers": max(int(wt.get("n_conformers", 1)), int(mut.get("n_conformers", 1))),
        })
        ranked.append(row)

    # Rank: most-negative ΔΔG_sel first (most mutant-selective). Rows without a
    # ddg_sel (failed docks) sink to the bottom.
    _set_progress(job_share_id, status=SelectivityJobStatus.RANKING, stage="ranking")
    ranked.sort(key=lambda r: (r.get("ddg_sel") is None, r.get("ddg_sel", 0.0)))
    for rank, r in enumerate(ranked, start=1):
        if "ddg_sel" in r:
            r["rank"] = rank

    n_scored = sum(1 for r in ranked if "ddg_sel" in r)
    if n_scored == 0:
        # Prefer an actionable message when the failure was the mutant build
        # (numbering mismatch) rather than a generic docking miss — otherwise
        # the user just sees "nothing docked" and can't tell it's fixable by
        # picking a structure whose numbering matches the mutation.
        n_build_failed = sum(1 for r in ranked if r.get("mutant_build_failed"))
        if n_build_failed:
            detail = next((r.get("error") for r in ranked if r.get("mutant_build_failed")), "")
            msg = (
                f"Could not build the {mutation} mutant on {target_pdb} (chain {chain}): "
                f"the residue numbering in this structure doesn't match the mutation, "
                f"so no genuine mutant pocket exists to score against. Pick a PDB whose "
                f"chain-{chain} numbering matches the mutation (or double-check the "
                f"mutation), then re-run. No WT-vs-WT selectivity number was reported. "
                f"Detail: {detail}"
            )
        else:
            msg = "No candidate docked successfully against both pockets."
        _set_progress(job_share_id, status=SelectivityJobStatus.FAILED,
                      ranked_hits=ranked, error_message=msg)
        return

    _set_progress(job_share_id, status=SelectivityJobStatus.COMPLETED,
                  stage="completed", ranked_hits=ranked)
    log.info("selective.pipeline: run %s complete — %d/%d candidates scored",
             job_share_id, n_scored, n)
