"""RunPod GPU serverless worker — one Boltz-2 prediction.

Boltz-2 (Wohlwend et al., 2025; MIT) jointly predicts a protein-ligand complex
structure AND a binding affinity from a protein *sequence* + ligand SMILES in
one forward pass. This worker is the serverless-endpoint counterpart of the
persistent-pod server in ../boltz2_server_async.py: same prediction logic,
different transport (RunPod's /run job API instead of a long-lived HTTP server),
so Boltz-2 scales to zero when idle — the cost model the platform wants.

Wire contract (matches the client that will call it):
  input : { receptor_sequence, ligand_smiles, chain_id?, pocket_residues?,
            use_msa?, num_samples? }
  output: { predicted_pdb_b64, affinity_pred_value, affinity_probability_binary,
            engine="boltz2" }   (or { error, stderr? })

pocket_residues are 1-based indices into `receptor_sequence` (Boltz indexes a
plain-sequence protein 1..N), NOT PDB author residue numbers — the caller maps
them before sending. msa=empty is baked in so WT and mutant predictions use the
same (no-MSA) assumption and the delta stays a fair comparison.
"""
from __future__ import annotations

import base64
import glob
import json
import os
import subprocess
import tempfile
from pathlib import Path

import yaml
import runpod

CACHE = os.environ.get("BOLTZ_CACHE", "/root/boltz2_cache")
TIMEOUT_S = int(os.environ.get("BOLTZ_TIMEOUT_S", "900"))


def _run(inp: dict) -> dict:
    seq = (inp.get("receptor_sequence") or "").strip()
    smiles = (inp.get("ligand_smiles") or "").strip()
    chain = str(inp.get("chain_id", "A"))
    pocket = inp.get("pocket_residues") or []
    use_msa = bool(inp.get("use_msa", False))
    n_samples = int(inp.get("num_samples", 1))

    if not seq or not all(c.isalpha() for c in seq):
        return {"error": "invalid receptor_sequence (empty or non-alphabetic)"}
    if len(smiles) < 2:
        return {"error": "invalid ligand_smiles"}

    work = Path(tempfile.mkdtemp(prefix="boltz2_"))
    spec: dict = {
        "sequences": [
            {"protein": {"id": chain, "sequence": seq, "msa": "empty"}},
            {"ligand": {"id": "L", "smiles": smiles}},
        ],
        "properties": [{"affinity": {"binder": "L"}}],
    }
    if pocket:
        spec["constraints"] = [
            {"pocket": {"binder": "L",
                        "contacts": [[chain, int(r)] for r in pocket]}}
        ]
    (work / "in.yaml").write_text(yaml.safe_dump(spec))

    cmd = ["boltz", "predict", str(work / "in.yaml"),
           "--out_dir", str(work / "out"), "--cache", CACHE,
           "--output_format", "pdb", "--diffusion_samples", str(n_samples),
           "--override"]
    if use_msa:
        cmd.append("--use_msa_server")

    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT_S)
    if proc.returncode != 0:
        return {"error": f"boltz_predict_failed (rc={proc.returncode})",
                "stderr": (proc.stderr or proc.stdout)[-2000:]}

    aff = glob.glob(str(work / "out" / "**" / "affinity_*.json"), recursive=True)
    pdb = glob.glob(str(work / "out" / "**" / "*.pdb"), recursive=True)
    if not aff or not pdb:
        return {"error": "boltz_output_missing",
                "stderr": (proc.stderr or "")[-500:]}

    a = json.load(open(aff[0]))
    return {
        "predicted_pdb_b64": base64.b64encode(Path(pdb[0]).read_bytes()).decode("ascii"),
        "affinity_pred_value": a.get("affinity_pred_value"),
        "affinity_probability_binary": a.get("affinity_probability_binary"),
        "engine": "boltz2",
    }


def handler(event: dict) -> dict:
    try:
        return _run(event.get("input") or {})
    except subprocess.TimeoutExpired:
        return {"error": f"boltz_predict_timeout after {TIMEOUT_S}s"}
    except Exception as e:  # noqa: BLE001 — worker must always return, never crash
        return {"error": str(e)[:1500]}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
