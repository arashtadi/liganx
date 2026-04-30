"""Boltz-2 ML pose+affinity prediction client (Pod-hosted).

Companion to `pod_dock.py` (QuickVina2-GPU) and `gnina_dock.py` (GNINA-CNN).
Same Pod, same NVIDIA GPU, completely different methodology: Boltz-2 is a
biomolecular foundation model that jointly predicts the protein-ligand
complex structure AND a binding affinity from a protein sequence + ligand
SMILES, in one ~20 s forward pass. Trained on PDB; MIT-licensed.

Why a third engine. Vina and GNINA are physics-empirical (Vina) or
CNN-rescored physics (GNINA) — same scoring family, similar failure modes
(covalent mechanism, active-conformation selectivity, water displacement
all invisible). Boltz-2 is a different methodology entirely; its agreement
or disagreement with Vina/GNINA on a given (target, mutation, ligand) is
the signal we surface to the user. Two-engine cross-validation has been a
staple of structure-based drug design since the 90s; we're catching up.

Wire flow:
    runner.py  →  predict_one_boltz2()  →  HTTPS POST /predict_boltz2  →  Pod
        →  Boltz-2 on GPU  →  predicted PDB + affinity_pred_value + binary prob
        →  back to caller as a Boltz2Result.

Mutation handling: Boltz-2 takes the protein sequence as input. A mutant
build is just a one-character substitution in the sequence string — no
PDBFixer, no FoldX, no OpenMM minimisation. The model handles mutation at
its input layer. Whether the model is *sensitive enough* to single-residue
changes to give a meaningful Δ is the open validation question (see
docs/boltz2_integration_plan.md).

Pod-side endpoint: backend/docs/runpod_boltz2_setup.md (companion to the
GNINA runbook). Until that's installed and the endpoint is live, this
module raises Boltz2DockError on every call — wired into runner dispatch
behind a feature flag so the rest of the pipeline keeps working.

This file is the v1 client stub. The shape mirrors gnina_dock.py so the
runner dispatch logic stays a clean three-line switch on engine.
"""

from __future__ import annotations

import base64
import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)


class Boltz2DockError(RuntimeError):
    """Raised on any failure talking to the Pod's Boltz-2 endpoint. Caller
    is expected to fall back to Vina or GNINA rather than failing the whole
    job — same contract as PodDockError / GninaDockError."""


@dataclass
class Boltz2DockConfig:
    """Tuning knobs for a Boltz-2 prediction request.

    Defaults are chosen for the mutation-comparison use case:
    - use_msa=False so WT and mutant predictions don't differ because of
      MSA construction differences. Direction of the WT/mutant Δ is what
      we care about; absolute pose accuracy is secondary.
    - num_samples=1 because Boltz-2 is deterministic at temperature=0 and
      we don't need pose ensembling for direction-only Δ comparison.
    - timeout_s=180 because cold start + model load + 20s inference can
      land at ~90s on the first request after Pod wake; 3 min gives
      headroom without burning queue capacity.
    """
    base_url: str
    use_msa: bool = False
    num_samples: int = 1
    timeout_s: int = 180


@dataclass
class Boltz2Result:
    """Output of a single Boltz-2 prediction.

    Mirrors the shape of DockingResult but with ML-model-native fields:
    no docking-mode list, no Vina kcal/mol score — instead a single
    predicted complex + the model's two affinity heads.
    """
    receptor_sequence: str
    ligand_smiles: str
    predicted_pdb: Path
    # Boltz-2 affinity head 1 — log10(IC50 in μM). More-negative = stronger
    # binder. NOT directly comparable to Vina kcal/mol; for ΔΔG we compute
    # mutant.affinity_pred_value − wt.affinity_pred_value and read direction.
    affinity_pred_value: float
    # Boltz-2 affinity head 2 — 0..1 probability that this ligand is a
    # real binder vs decoy. Useful for hit triage; not used in our ΔΔG
    # path.
    affinity_probability_binary: float
    # Pseudo-Vina-equivalent score for downstream code that expects a
    # kcal/mol-like number. Convention: -1 * affinity_pred_value, so larger
    # negative = stronger, matching Vina score sign. Caller must NOT treat
    # this as a free-energy value; it's a normalised score for ranking.
    score: float = field(init=False)
    raw: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Boltz-2's affinity_pred_value is "more negative = stronger"
        # already (it's log10 IC50 μM), so the sign conversion is just an
        # identity. Keeping the field as an explicit alias makes the
        # runner's score-extraction code uniform across engines.
        self.score = float(self.affinity_pred_value)


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _post_json(url: str, body: dict, timeout_s: int) -> dict:
    """POST a JSON body, return the parsed JSON response."""
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:300]
        raise Boltz2DockError(f"HTTP {e.code} from {url}: {body}") from e
    except urllib.error.URLError as e:
        raise Boltz2DockError(f"Network error talking to {url}: {e}") from e


def predict_one_boltz2(
    receptor_sequence: str,
    ligand_smiles: str,
    work_dir: Path | str,
    cfg: Boltz2DockConfig,
    *,
    pocket_residues: list[int] | None = None,
    chain_id: str = "A",
) -> Boltz2Result:
    """Single (sequence, SMILES) → Boltz-2 prediction.

    Args
    ----
    receptor_sequence : str
        FASTA-style amino-acid sequence (one-letter codes). For mutant
        predictions, this is the WT sequence with the substitution baked
        in by the caller (e.g. T315→I at position 315). Boltz-2 has no
        opinion about which residue is "mutant"; it just sees a sequence.
    ligand_smiles : str
        SMILES string for the small-molecule ligand.
    work_dir : Path
        Where to write the predicted complex PDB.
    cfg : Boltz2DockConfig
        Endpoint URL + sampling parameters.
    pocket_residues : list[int] | None
        Optional list of residue indices (1-indexed, matching the input
        sequence) that the ligand should be biased toward binding. Strongly
        recommended — without this, Boltz-2 can place the ligand on the
        protein surface. Pulled from the catalog Target's contact-residue
        list at runner-dispatch time.
    chain_id : str
        Chain identifier in the output PDB. Defaults to "A".

    Returns
    -------
    Boltz2Result with `predicted_pdb` written to `work_dir`.
    """
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    if not receptor_sequence or not all(c.isalpha() for c in receptor_sequence):
        raise Boltz2DockError(
            f"Invalid receptor sequence (empty or non-alphabetic): "
            f"{receptor_sequence[:40]!r}..."
        )
    if not ligand_smiles or len(ligand_smiles) < 2:
        raise Boltz2DockError(f"Invalid ligand SMILES: {ligand_smiles!r}")

    payload = {
        "receptor_sequence": receptor_sequence,
        "ligand_smiles": ligand_smiles,
        "chain_id": chain_id,
        "pocket_residues": pocket_residues or [],
        "use_msa": cfg.use_msa,
        "num_samples": cfg.num_samples,
    }

    url = cfg.base_url.rstrip("/") + "/predict_boltz2"
    log.info(
        "Dispatching Boltz-2 on Pod %s (seq_len=%d, smiles_len=%d, pocket=%d)",
        cfg.base_url, len(receptor_sequence), len(ligand_smiles),
        len(pocket_residues) if pocket_residues else 0,
    )

    output = _post_json(url=url, body=payload, timeout_s=cfg.timeout_s)

    pdb_b64 = output.get("predicted_pdb_b64")
    affinity_pred = output.get("affinity_pred_value")
    affinity_prob = output.get("affinity_probability_binary")
    if pdb_b64 is None or affinity_pred is None:
        raise Boltz2DockError(
            f"Malformed Boltz-2 response (missing pdb/affinity): "
            f"{str(output)[:200]}"
        )

    # Cache the predicted complex so PoseBusters / ProLIF / 3D viewer can
    # consume it identically to a Vina pose. The shape is a full protein-
    # ligand PDB though, not a ligand-only PDBQT, so downstream code that
    # extracts the ligand needs a different path. For v1 we write under a
    # `boltz2/` subdir to make the engine origin obvious to the renderer.
    pdb_path = work_dir / "boltz2" / "predicted_complex.pdb"
    pdb_path.parent.mkdir(parents=True, exist_ok=True)
    pdb_path.write_bytes(base64.b64decode(pdb_b64))

    return Boltz2Result(
        receptor_sequence=receptor_sequence,
        ligand_smiles=ligand_smiles,
        predicted_pdb=pdb_path,
        affinity_pred_value=float(affinity_pred),
        affinity_probability_binary=float(affinity_prob) if affinity_prob is not None else 0.0,
        raw=output,
    )


def predict_batch_boltz2(
    receptor_sequence: str,
    ligands: list[tuple[str, str]],  # list of (id, smiles)
    work_dir: Path | str,
    cfg: Boltz2DockConfig,
    *,
    pocket_residues: list[int] | None = None,
    chain_id: str = "A",
) -> list[tuple[str, Boltz2Result | str]]:
    """Predict N ligands against ONE receptor sequence in a single HTTP call.

    Returns list of (ligand_id, Boltz2Result | error_string). Boltz-2 has
    no native ligand-batch mode in its CLI; the Pod-side handler is
    responsible for running ligands serially under the hood and returning
    the combined response. Cap at 25 ligands per batch — Boltz-2 is GPU-
    serialized and 25 × 20s = ~8 min is a reasonable upper bound for a
    synchronous HTTP call.

    Status: stub — the Pod-side `/predict_boltz2_batch` endpoint is not
    yet implemented (see runpod_boltz2_setup.md, Phase 2). Until then,
    callers should iterate predict_one_boltz2 instead.
    """
    raise Boltz2DockError(
        "predict_batch_boltz2 not implemented yet — see "
        "docs/boltz2_integration_plan.md Phase 2. Use predict_one_boltz2 "
        "in a loop for now."
    )
