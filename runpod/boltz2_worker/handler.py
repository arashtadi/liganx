"""RunPod GPU serverless worker — one Boltz-2 prediction.

Boltz-2 (MIT Jameel Clinic, Wohlwend et al. 2025) jointly predicts the
protein-ligand complex structure AND a binding affinity from a protein
sequence + ligand SMILES in a single forward pass. This serverless worker
wraps the `boltz predict` CLI.

Why serverless (not the always-on pod the old boltz2_dock.py client targets):
a GPU spins up only when a prediction is requested and scales back to zero
after — pay-per-prediction, and it draws from RunPod's serverless pool
instead of the on-demand pool. Model weights (~5 GB) are cached on the
mounted network volume at /runpod-volume/boltz2_cache, so only the
first-ever request on a fresh volume pays the download cost.

Wire contract (mirrors the field names in
pipeline/deltadock_pipeline/boltz2_dock.py so a thin boltz2_runpod.py
client can dispatch to it):
  input : { receptor_sequence, ligand_smiles, chain_id, pocket_residues,
            use_msa, num_samples }
  output: { predicted_pdb_b64, affinity_pred_value,
            affinity_probability_binary, engine="boltz2" }  (or { error })
"""

from __future__ import annotations

import base64
import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import runpod  # provided by the RunPod base layer

# Weights + any downloaded MSAs live on the mounted network volume so a cold
# worker on a warm volume skips the ~5 GB download.
CACHE = os.environ.get("BOLTZ_CACHE", "/runpod-volume/boltz2_cache")
os.environ.setdefault("BOLTZ_CACHE", CACHE)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("liganx-boltz2-worker")


def _dump_yaml(spec: dict[str, Any]) -> str:
    """Serialise the Boltz input spec. Uses PyYAML when present, else a
    tiny hand-roll (the spec shape is fixed and shallow)."""
    try:
        import yaml  # noqa: WPS433 (local import — optional dep)

        return yaml.safe_dump(spec, sort_keys=False)
    except Exception:  # pragma: no cover - fallback path
        lines = ["sequences:"]
        for entry in spec["sequences"]:
            (kind, val), = entry.items()
            lines.append(f"  - {kind}:")
            for k, v in val.items():
                lines.append(f"      {k}: {v!r}" if k == "smiles" else f"      {k}: {v}")
        if "properties" in spec:
            lines.append("properties:")
            lines.append("  - affinity:")
            lines.append(f"      binder: {spec['properties'][0]['affinity']['binder']}")
        if "constraints" in spec:
            lines.append("constraints:")
            for c in spec["constraints"]:
                pk = c["pocket"]
                lines.append("  - pocket:")
                lines.append(f"      binder: {pk['binder']}")
                lines.append(f"      contacts: {json.dumps(pk['contacts'])}")
        return "\n".join(lines) + "\n"


def handler(event: dict[str, Any]) -> dict[str, Any]:
    inp = event.get("input") or {}

    # Warmup ping: primes the weights onto the volume via a normal
    # serverless job (no on-demand pod needed). Send this once against a
    # fresh volume before the first real prediction.
    if inp.get("mode") == "warmup":
        Path(CACHE).mkdir(parents=True, exist_ok=True)
        try:
            import boltz  # noqa: F401

            ver = getattr(boltz, "__version__", "?")
        except Exception as e:  # pragma: no cover
            return {"error": f"boltz import failed: {e}"}
        return {"engine": "boltz2", "warmup": True, "boltz_version": str(ver),
                "cache": CACHE, "cache_exists": Path(CACHE).exists()}

    seq = inp.get("receptor_sequence")
    smiles = inp.get("ligand_smiles")
    if not seq or not isinstance(seq, str) or not seq.isalpha():
        return {"error": "receptor_sequence missing or non-alphabetic"}
    if not smiles or not isinstance(smiles, str) or len(smiles) < 2:
        return {"error": "ligand_smiles missing or too short"}

    chain = str(inp.get("chain_id", "A"))
    pocket = inp.get("pocket_residues") or []
    use_msa = bool(inp.get("use_msa", False))
    n_samples = int(inp.get("num_samples", 1))

    Path(CACHE).mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        # Boltz 2.2.x requires the protein MSA to be resolved: either an MSA
        # file, `--use_msa_server` (fetch one), or the literal `msa: empty`
        # for single-sequence mode. Default is single-sequence (fair WT vs
        # mutant comparison), so set `msa: empty` unless the caller asked for
        # the MSA server. Without this, boltz skips the input with
        # "Missing MSA's in input and --use_msa_server flag not set".
        protein: dict[str, Any] = {"id": chain, "sequence": seq}
        if not use_msa:
            protein["msa"] = "empty"
        spec: dict[str, Any] = {
            "sequences": [
                {"protein": protein},
                {"ligand": {"id": "L", "smiles": smiles}},
            ],
            "properties": [{"affinity": {"binder": "L"}}],
        }
        if pocket:
            spec["constraints"] = [{
                "pocket": {"binder": "L",
                           "contacts": [[chain, int(r)] for r in pocket]},
            }]

        yaml_path = work / "input.yaml"
        yaml_path.write_text(_dump_yaml(spec))
        out_dir = work / "out"

        cmd = [
            "boltz", "predict", str(yaml_path),
            "--out_dir", str(out_dir),
            "--cache", CACHE,
            "--output_format", "pdb",
            "--diffusion_samples", str(n_samples),
            # Use the pure-PyTorch path instead of the optional cuequivariance
            # CUDA triangle-multiplication kernels. Those live in boltz's
            # [cuda] extra (cuequivariance_ops_cu12), are compiled for specific
            # CUDA versions, and would reintroduce driver-mismatch fragility;
            # without --no_kernels boltz hard-imports cuequivariance_torch and
            # dies with ModuleNotFoundError. Slower per prediction, but correct
            # and portable across every RunPod GPU.
            "--no_kernels",
        ]
        # --use_msa_server is a Click flag (default off = single-sequence
        # mode, which we want for fair WT/mutant comparison). Append only
        # when the caller explicitly asks for MSA.
        if use_msa:
            cmd.append("--use_msa_server")

        log.info("boltz predict seq_len=%d smiles_len=%d pocket=%d samples=%d",
                 len(seq), len(smiles), len(pocket), n_samples)
        try:
            res = subprocess.run(cmd, capture_output=True, text=True,
                                 check=False, timeout=1500)
        except subprocess.TimeoutExpired:
            return {"error": "boltz predict exceeded 1500 s"}

        if res.returncode != 0:
            return {"error": "boltz_predict_failed",
                    "stderr_tail": (res.stderr or "")[-2000:],
                    "stdout_tail": (res.stdout or "")[-800:]}

        # Boltz output layout varies across versions; rglob is robust.
        pdbs = sorted(out_dir.rglob("*.pdb")) if out_dir.exists() else []
        affs = sorted(out_dir.rglob("affinity*.json")) if out_dir.exists() else []
        if not pdbs or not affs:
            found = [str(p.relative_to(out_dir)) for p in out_dir.rglob("*")][:40] \
                if out_dir.exists() else []
            return {"error": "boltz_output_missing", "found": found,
                    "stdout_tail": (res.stdout or "")[-1000:]}

        try:
            aff = json.loads(affs[0].read_text())
        except Exception as e:
            return {"error": f"affinity parse failed: {e}"}

        return {
            "predicted_pdb_b64": base64.b64encode(pdbs[0].read_bytes()).decode("ascii"),
            "affinity_pred_value": aff.get("affinity_pred_value"),
            "affinity_probability_binary": aff.get("affinity_probability_binary"),
            "engine": "boltz2",
            "raw_affinity": aff,
        }


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
