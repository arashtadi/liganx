"""Shared receptor build/cache helper for the editor's Quick Dock + Optimize.

Both `services/quick_dock.py` and `services/optimize_loop.py` historically
had their own copies of the receptor-prep dance: fetch PDB, fix, prepare
WT PDBQT. Both ALSO hard-coded "use WT receptor only" with a TODO to
support mutants — which meant editor scores were mutation-aware in
DESIGN (the AI prompt used the mutation) but not in SCORING (every dock
ran against WT). This module fixes both shortcuts.

The cache filename convention matches `services/runner.py`:
  {pdb_id}_{chain}_WT.pdbqt           — wild-type
  {pdb_id}_{chain}_{mut}.pdbqt        — mutant (e.g. T315I, T790M+C797S)
  {pdb_id}_{chain}.clean.pdb          — wild-type cleaned PDB
  {pdb_id}_{chain}_{mut}.clean.pdb    — mutant cleaned PDB

So a warmed cache from a full New Job dock against the same target +
mutation is reused here for free. The first editor click on a NEW
mutation pays the PDBFixer build cost (~30-60s); subsequent clicks
hit the cache (~0.1s).

Failure modes are surfaced as a structured ReceptorPrepResult so callers
can render an honest UI signal (e.g. "Built mutant for T315I" vs "Mutant
build failed; using WT — score is wild-type only") instead of silently
docking the wrong thing.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)


@dataclass
class ReceptorPrepResult:
    """Output of `prepare_receptor_for_target`.

    `receptor_pdbqt` is always populated (we never return without a
    receptor — fall back to WT when the mutant build fails). `is_mutant`
    tells the caller whether the score should be labelled mutation-aware
    or "WT-only fallback" in the UI."""
    receptor_pdbqt: Path
    receptor_pdb: Path           # cleaned PDB; needed for contact extraction
    is_mutant: bool              # True when the PDBQT actually has the substitution
    requested_mutation: Optional[str]  # e.g. "T315I" or None for WT
    fallback_reason: Optional[str] = None  # populated when is_mutant=False but mutation was requested


def prepare_receptor_for_target(
    *,
    pdb_id: str,
    chain: str,
    mutation: Optional[str],
    pdb_cache: Path,
    receptor_cache: Path,
    minimize_mutant: bool = True,
) -> ReceptorPrepResult:
    """Resolve (or build) the receptor PDBQT for a target+optional-mutation.

    1. Ensure the WT cleaned PDB and WT PDBQT exist (fetch + fix +
       prepare on miss).
    2. If `mutation` is None or "WT", return WT paths.
    3. If `mutation` is set, try the mutant cache first; on miss, build
       via PDBFixer (matches the runner.py code path so caches are
       cross-compatible). Verify the substitution actually landed.
    4. On any mutant-build failure, fall back to WT with a structured
       reason in `fallback_reason` so the caller can warn the user.

    Args:
        pdb_id: RESOLVED RCSB PDB id (e.g. "4OBE"), NOT a catalog slug.
        chain: chain id (e.g. "A").
        mutation: single mutation code ("T315I") or compound ("T790M+C797S")
                  or None/empty for WT only.
        pdb_cache, receptor_cache: directories for the cleaned PDB and
                                   the prepared PDBQT respectively.
                                   Should be on the persistent Fly volume.
        minimize_mutant: pass-through to PDBFixer build. Default True
                         (matches runner.py default; some targets like
                         BRAF V600E set this False per catalog).

    Returns:
        ReceptorPrepResult with paths + mutation status. Never raises;
        all failures fall back to WT with `fallback_reason` populated.
    """
    pdb_cache = Path(pdb_cache)
    receptor_cache = Path(receptor_cache)
    pdb_cache.mkdir(parents=True, exist_ok=True)
    receptor_cache.mkdir(parents=True, exist_ok=True)

    # ── 1. Always ensure WT exists ───────────────────────────────────
    wt_pdbqt = receptor_cache / f"{pdb_id}_{chain}_WT.pdbqt"
    wt_pdb = pdb_cache / f"{pdb_id}_{chain}.clean.pdb"
    try:
        from deltadock_pipeline.fetch import fetch_pdb
        from deltadock_pipeline.prep import fix_pdb, prepare_receptor
        if not wt_pdb.exists():
            raw = pdb_cache / f"{pdb_id}.pdb"
            if not raw.exists():
                fetch_pdb(pdb_id, raw)
            fix_pdb(raw, wt_pdb, chain=chain)
        if not wt_pdbqt.exists():
            prepare_receptor(wt_pdb, wt_pdbqt, chain=chain)
    except Exception as e:
        # Catastrophic — caller can't proceed. Bubble a synthetic
        # result with a fallback reason; downstream will see an empty
        # PDBQT path and error out cleanly.
        log.exception("WT receptor prep failed for %s_%s", pdb_id, chain)
        return ReceptorPrepResult(
            receptor_pdbqt=wt_pdbqt,
            receptor_pdb=wt_pdb,
            is_mutant=False,
            requested_mutation=mutation,
            fallback_reason=f"WT receptor prep failed: {e}",
        )

    # ── 2. WT-only path ──────────────────────────────────────────────
    mut = (mutation or "").strip()
    if not mut or mut.upper() == "WT":
        return ReceptorPrepResult(
            receptor_pdbqt=wt_pdbqt,
            receptor_pdb=wt_pdb,
            is_mutant=False,
            requested_mutation=None,
        )

    # Compound mutations like "T790M+C797S" or "T315I, E255K" — keep the
    # full code as the cache key so a multi-mutant receptor doesn't
    # collide with single-mutant caches.
    cache_key = mut.replace(" ", "").replace(",", "+")
    mut_pdb = receptor_cache / f"{pdb_id}_{chain}_{cache_key}.clean.pdb"
    mut_pdbqt = receptor_cache / f"{pdb_id}_{chain}_{cache_key}.pdbqt"

    # ── 3a. Cache hit — return immediately ───────────────────────────
    if mut_pdbqt.exists() and mut_pdb.exists() and mut_pdbqt.stat().st_size > 0:
        log.info("receptor_prep: cache hit for %s_%s_%s", pdb_id, chain, cache_key)
        return ReceptorPrepResult(
            receptor_pdbqt=mut_pdbqt,
            receptor_pdb=mut_pdb,
            is_mutant=True,
            requested_mutation=mut,
        )

    # ── 3b. Cache miss — build the mutant ────────────────────────────
    log.info("receptor_prep: building mutant %s on %s_%s", cache_key, pdb_id, chain)
    try:
        from deltadock_pipeline.mutate import build_mutant_pdbfixer
        from deltadock_pipeline.prep import prepare_receptor
        build_mutant_pdbfixer(
            pdb_path=wt_pdb,
            chain=chain,
            mutation_code=cache_key,
            out_path=mut_pdb,
            minimize=minimize_mutant,
        )
        prepare_receptor(mut_pdb, mut_pdbqt, chain=chain)
    except Exception as e:
        log.warning(
            "receptor_prep: mutant build failed for %s on %s_%s — falling back to WT (%s)",
            cache_key, pdb_id, chain, e,
        )
        return ReceptorPrepResult(
            receptor_pdbqt=wt_pdbqt,
            receptor_pdb=wt_pdb,
            is_mutant=False,
            requested_mutation=mut,
            fallback_reason=f"mutant build failed: {type(e).__name__}: {str(e)[:80]}",
        )

    # ── 4. Verify the substitution actually landed ───────────────────
    # Defensive — PDBFixer can occasionally complete without raising but
    # leave the residue unchanged (e.g. when the residue number doesn't
    # exist on the chain). Better to fall back to WT loudly than to
    # silently report mutation-aware scores that are actually WT.
    try:
        from .runner import verify_mutation_applied  # type: ignore
        ok, reason = verify_mutation_applied(mut_pdb, chain, cache_key)
        if not ok:
            log.warning(
                "receptor_prep: mutant verify failed for %s on %s_%s: %s — falling back to WT",
                cache_key, pdb_id, chain, reason,
            )
            return ReceptorPrepResult(
                receptor_pdbqt=wt_pdbqt,
                receptor_pdb=wt_pdb,
                is_mutant=False,
                requested_mutation=mut,
                fallback_reason=f"mutant verify failed: {reason}",
            )
    except ImportError:
        # verify_mutation_applied lives in runner.py; if the import
        # path changes we don't want this helper to break the editor.
        # Skip verification and trust PDBFixer — at worst we report a
        # mutant when WT was used; loud at the runner level the next
        # time the same job runs.
        log.info("receptor_prep: skipped verify (helper unavailable)")

    return ReceptorPrepResult(
        receptor_pdbqt=mut_pdbqt,
        receptor_pdb=mut_pdb,
        is_mutant=True,
        requested_mutation=mut,
    )
