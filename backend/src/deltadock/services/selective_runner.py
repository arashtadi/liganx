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


def _open_session():
    """Fresh DB session for the background task (request session is gone)."""
    from sqlmodel import Session
    from ..db import engine
    return Session(engine)


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
        try:
            candidates = json.loads(job.candidates_json or "[]")
        except (ValueError, TypeError):
            candidates = []

    if not candidates:
        _set_progress(job_share_id, status=SelectivityJobStatus.FAILED,
                      stage=None, error_message="No candidate molecules supplied.")
        return

    # Lazy import — heavy pipeline deps; keep them out of cold start.
    try:
        from .quick_dock import quick_dock
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

        wt = quick_dock(smiles=smiles, target_pdb=target_pdb, chain=chain, mutation=None)
        mut = quick_dock(smiles=smiles, target_pdb=target_pdb, chain=chain, mutation=mutation)

        row: dict = {"name": name, "smiles": smiles}
        if not wt.get("ok"):
            row["error"] = f"WT dock failed: {wt.get('error')}"
            ranked.append(row)
            continue
        if not mut.get("ok"):
            row["error"] = f"Mutant dock failed: {mut.get('error')}"
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
        _set_progress(job_share_id, status=SelectivityJobStatus.FAILED,
                      ranked_hits=ranked,
                      error_message="No candidate docked successfully against both pockets.")
        return

    _set_progress(job_share_id, status=SelectivityJobStatus.COMPLETED,
                  stage="completed", ranked_hits=ranked)
    log.info("selective.pipeline: run %s complete — %d/%d candidates scored",
             job_share_id, n_scored, n)
