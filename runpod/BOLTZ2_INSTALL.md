# Boltz-2 install on the existing Liganx RunPod

**Companion to:** `docs/boltz2_integration_plan.md`, `runpod/GNINA_INSTALL.md`
**Pod target:** existing NVIDIA Blackwell pod that already runs QuickVina2-GPU + GNINA

This runbook installs Boltz-2 alongside the existing docking engines
on the same pod. We're not creating a new endpoint or a new container —
just adding a third tool the pod's `dock_server.py` knows about.

Boltz-2 is from the MIT Jameel Clinic (Wohlwend et al., 2025). Open-
sourced under MIT license; commercial use permitted. Repo:
<https://github.com/jwohlwend/boltz>.

---

## Prerequisites

- Pod is up and reachable on port 7861 (the existing dock_server port).
- `/workspace` volume has at least 10 GB free for the model weights
  (~5 GB) plus runtime cache.
- Existing mamba/conda environments `qvina2-gpu` and `gnina` already
  installed (per `GNINA_INSTALL.md`). We add a third env for Boltz-2 to
  keep dependency conflicts isolated.

Free disk before installing:

```bash
df -h /workspace
mamba clean --all -y      # cheap; usually frees a couple GB
```

---

## Phase 1 — install Boltz-2 in a fresh env

SSH into the pod (existing `runpodctl ssh ${POD_ID}` flow), then:

```bash
mamba create -n boltz2 python=3.10 pip -y
mamba activate boltz2

# Boltz package — pulls torch, openff-toolkit, dgl, rdkit, etc.
pip install boltz

# First-run model download. boltz auto-fetches weights on first
# `boltz predict`; force the download up-front so the first user request
# isn't a 5-minute cold start.
mkdir -p /workspace/boltz2_cache
export BOLTZ_CACHE=/workspace/boltz2_cache

# Smoke-test predict with a tiny example. This downloads weights (~5GB)
# and confirms the GPU is visible. ~3 min on a cold start.
cat > /tmp/boltz_smoke.yaml <<'EOF'
sequences:
  - protein:
      id: A
      sequence: MLEICLKLVGCKSKKGLSSSSSCYLEEALQRPVASDFEPQGLSEAARWNSKENLLAGPSENDPNLFVALYDFVASGDNTLSITKGEKLRVLGYNHNGEWCEAQTKNGQGWVPSNYITPVNS
  - ligand:
      id: B
      smiles: 'C1=CC=CC=C1'
properties:
  - affinity:
      binder: B
EOF

boltz predict /tmp/boltz_smoke.yaml --use_msa_server False --output_format pdb --cache /workspace/boltz2_cache 2>&1 | tail -20
```

If you see the predicted complex PDB written and an
`affinity_pred_value` in the output, the install is good.

---

## Phase 2 — add `/predict_boltz2` endpoint to dock_server.py

The existing `dock_server.py` on the pod (under `/workspace/dock_server.py`
or similar — check the README) already exposes `/dock_one`, `/dock_batch`,
`/dock_gnina`, `/dock_batch_gnina`. Add `/predict_boltz2` parallel to
those.

Add this handler function inside `dock_server.py` (above the existing
GNINA handlers for visual proximity):

```python
def predict_boltz2(payload: dict) -> dict:
    """One Boltz-2 prediction. Mirrors the contract in
    pipeline/deltadock_pipeline/boltz2_dock.py — we exchange a JSON shape
    so the pod and the client can be deployed independently."""
    import base64, json, subprocess, tempfile, yaml
    from pathlib import Path

    seq = payload["receptor_sequence"]
    smiles = payload["ligand_smiles"]
    chain = payload.get("chain_id", "A")
    pocket = payload.get("pocket_residues", [])
    use_msa = payload.get("use_msa", False)
    n_samples = int(payload.get("num_samples", 1))

    workdir = Path(tempfile.mkdtemp(prefix="boltz2_"))
    yaml_path = workdir / "input.yaml"

    spec = {
        "sequences": [
            {"protein": {"id": chain, "sequence": seq}},
            {"ligand":  {"id": "L", "smiles": smiles}},
        ],
        "properties": [{"affinity": {"binder": "L"}}],
    }
    if pocket:
        # Boltz takes pocket residues as a list of (chain, residue) tuples.
        spec["constraints"] = [{
            "pocket": {
                "binder": "L",
                "contacts": [[chain, r] for r in pocket],
            },
        }]

    yaml_path.write_text(yaml.safe_dump(spec))

    cmd = [
        "boltz", "predict", str(yaml_path),
        "--out_dir", str(workdir),
        "--cache", "/workspace/boltz2_cache",
        "--output_format", "pdb",
        "--diffusion_samples", str(n_samples),
    ]
    if not use_msa:
        cmd.append("--use_msa_server")
        cmd.append("False")

    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        return {"error": "boltz_predict_failed",
                "stderr": proc.stderr[-2000:]}

    # Boltz writes outputs under {out_dir}/predictions/{name}/
    out_dir = workdir / "predictions" / yaml_path.stem
    pdb_files = list(out_dir.glob("*.pdb"))
    affinity_json = out_dir / "affinity.json"

    if not pdb_files or not affinity_json.exists():
        return {"error": "boltz_output_missing",
                "found": [str(p.name) for p in out_dir.iterdir()]}

    pdb_bytes = pdb_files[0].read_bytes()
    aff = json.loads(affinity_json.read_text())

    return {
        "predicted_pdb_b64": base64.b64encode(pdb_bytes).decode("ascii"),
        "affinity_pred_value": aff.get("affinity_pred_value"),
        "affinity_probability_binary": aff.get("affinity_probability_binary"),
        "engine": "boltz2",
    }
```

Wire into the request router (the existing pattern matches GNINA):

```python
elif path == "/predict_boltz2":
    result = predict_boltz2(json.loads(body))
    self.send_response(200 if "error" not in result else 500)
    ...
```

The boltz2 environment is activated **only** for this handler — wrap
the `subprocess.run([...])` call in a shell that activates the env:

```python
cmd = ["bash", "-lc",
       f"source activate boltz2 && boltz predict {yaml_path} ..."]
```

(GNINA does the same trick. Check how it sources `gnina` env in the
existing handler and copy that pattern verbatim.)

---

## Phase 3 — restart dock_server, smoke-test from outside

```bash
# Whatever the existing pattern is for restarting dock_server (systemd,
# pm2, supervisord, plain pkill+nohup — check the pod README).
sudo systemctl restart dock_server   # or equivalent

# From a laptop with the pod URL:
curl -X POST https://${POD_URL}/predict_boltz2 \
  -H 'Content-Type: application/json' \
  -d '{
    "receptor_sequence": "MLEICLKLVGCKSKKGLSSSSSCYLEEALQRPVASDFEPQGLSEAARWNSKENLLAGPSENDPNLFVALYDFVASGDNTLSITKGEKLRVLGYNHNGEWCEAQTKNGQGWVPSNYITPVNS",
    "ligand_smiles": "C1=CC=CC=C1",
    "chain_id": "A",
    "pocket_residues": []
  }' | jq '.affinity_pred_value, .engine'
```

Expected: a non-null float for `affinity_pred_value` and `"boltz2"` for
engine. If you see `boltz_predict_failed` with a stderr message, paste
the stderr to me and we'll debug.

---

## Phase 4 — wire the Liganx backend

After the endpoint is live and smoke-tested:

1. Set `LIGANX_BOLTZ2_POD_URL` Fly secret to the pod's URL (same as
   `LIGANX_POD_URL`, since it's the same pod).
2. Add `engine="boltz2"` dispatch in
   `backend/src/deltadock/services/runner.py` — this is the work
   tracked under task #104 phase 2. The pipeline client stub is
   already in
   `pipeline/deltadock_pipeline/boltz2_dock.py`.
3. Add Boltz-2 to the `/jobs` engine enum in API + frontend
   picker.

---

## Troubleshooting

**`mamba` not found.** The pod uses Mambaforge under `/workspace/mambaforge`.
Source it: `source /workspace/mambaforge/etc/profile.d/conda.sh && conda
activate boltz2`.

**OOM at first prediction.** Boltz-2 needs ~10 GB GPU VRAM for typical
proteins (<400 residues + small molecule). The Blackwell has plenty,
but if a long protein is submitted, prediction can OOM. Set
`--max_seqs 1` in the boltz command and consider trimming the sequence
to the kinase domain (we already do this for Vina via the catalog
`pdb_id` — Boltz can reuse the same trimmed sequence).

**MSA server timeouts.** `--use_msa_server False` skips MSA construction
entirely and uses single-sequence mode. This is what we want for the
mutation-comparison use case (so WT and mutant predictions don't
diverge because of MSA fetch differences). It's also faster.

**`affinity.json` missing in output.** Boltz versions before 2.0
didn't emit affinity files; only structure prediction. Check
`pip show boltz | grep Version` — must be ≥ 2.0.0.
