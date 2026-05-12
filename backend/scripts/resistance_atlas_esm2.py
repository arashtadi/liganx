"""ESM-2 fitness scoring for the Resistance Atlas calibration set.

For each event with a single-residue substitution, fetches the canonical
UniProt sequence, masks the mutation position, runs ESM-2's masked-LM
head, and computes:

    fitness = log P(mut_residue | context) - log P(wt_residue | context)

Interpretation:
  fitness > 0  → mutant residue is MORE compatible with the protein
                 family — biologically tolerable, mutation can fix.
  fitness ≈ 0  → neutral, mutation is biologically permitted.
  fitness < 0  → mutant residue is LESS compatible — protein function
                 may break under the substitution, mutation is
                 unlikely to spread under selection.

Resistance events that ACTUALLY emerge clinically should cluster
near fitness ≈ 0 (function preserved) — that's the hypothesis the
joint Δ + ESM2 model exploits.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

import torch
from transformers import AutoTokenizer, AutoModelForMaskedLM

MODEL_ID = "facebook/esm2_t12_35M_UR50D"  # small, fast; ~150 MB
EVENTS_PATH = Path("/tmp/events.json")
OUT_PATH = Path("/tmp/esm2_results.json")
SEQ_CACHE = Path("/tmp/uniprot_seq_cache.json")

# UniProt sequences are tiny — cache once per ID.
if SEQ_CACHE.exists():
    SEQ_BY_UNIPROT = json.loads(SEQ_CACHE.read_text())
else:
    SEQ_BY_UNIPROT = {}


def fetch_seq(uniprot_id: str) -> str:
    if uniprot_id in SEQ_BY_UNIPROT:
        return SEQ_BY_UNIPROT[uniprot_id]
    url = f"https://rest.uniprot.org/uniprotkb/{uniprot_id}.fasta"
    print(f"  fetching {url}", file=sys.stderr)
    with urllib.request.urlopen(url, timeout=30) as r:
        text = r.read().decode("utf-8")
    lines = text.splitlines()
    seq = "".join(L for L in lines if not L.startswith(">"))
    SEQ_BY_UNIPROT[uniprot_id] = seq
    SEQ_CACHE.write_text(json.dumps(SEQ_BY_UNIPROT))
    return seq


print(f"Loading {MODEL_ID} ...", file=sys.stderr)
tok = AutoTokenizer.from_pretrained(MODEL_ID)
model = AutoModelForMaskedLM.from_pretrained(MODEL_ID)
model.eval()


def fitness_for(uniprot_id: str, position: int, wt_aa: str, mut_aa: str) -> dict:
    """ESM2 fitness for a single substitution at a single position.

    The position is 1-indexed (UniProt convention). We mask that position
    in the full WT sequence, run the model, and read the masked-LM logits
    at that position for the WT and MUT residues.
    """
    seq = fetch_seq(uniprot_id)
    if position < 1 or position > len(seq):
        return {"error": f"position {position} out of bounds for len(seq)={len(seq)}"}
    seq_aa = seq[position - 1]
    if seq_aa != wt_aa:
        # UniProt residue mismatch with our event's WT — flag but still score
        # (the structural/literature wt may differ from canonical UniProt
        # sequence in rare cases, e.g. isoform numbering).
        mismatch = f"uniprot[{position}]={seq_aa}, event_wt={wt_aa}"
    else:
        mismatch = None
    # Mask the position and tokenize.
    masked = seq[: position - 1] + tok.mask_token + seq[position:]
    inputs = tok(masked, return_tensors="pt", truncation=True, max_length=1024)
    with torch.no_grad():
        logits = model(**inputs).logits
    # Find the mask position in the tokenized output.
    mask_idx_t = (inputs.input_ids[0] == tok.mask_token_id).nonzero(as_tuple=True)[0]
    if len(mask_idx_t) == 0:
        return {"error": "no mask token in tokenized input (sequence too long?)"}
    mask_idx = mask_idx_t[0].item()
    pos_logits = logits[0, mask_idx]
    log_probs = torch.log_softmax(pos_logits, dim=-1)
    # ESM-2 vocabulary: tokens are single-letter AAs; we look them up.
    wt_id = tok.convert_tokens_to_ids(wt_aa)
    mut_id = tok.convert_tokens_to_ids(mut_aa)
    log_p_wt = float(log_probs[wt_id])
    log_p_mut = float(log_probs[mut_id])
    return {
        "log_p_wt": log_p_wt,
        "log_p_mut": log_p_mut,
        "fitness": log_p_mut - log_p_wt,  # > 0 = mutant tolerated
        "seq_len": len(seq),
        "uniprot_mismatch": mismatch,
    }


events = json.loads(EVENTS_PATH.read_text())["events"]
print(f"Scoring {len(events)} events ...", file=sys.stderr)

results = []
t0 = time.time()
for i, ev in enumerate(events, 1):
    eid = ev["id"]
    row = {"event_id": eid}
    try:
        # Skip deletion / multi-residue events
        if ev.get("codon_distance") is None or len(ev.get("wt_residue", "")) != 1 or len(ev.get("mutant", "")) != 1:
            row["status"] = "skipped"
            row["skip_reason"] = "not a single-AA substitution"
            results.append(row)
            print(f"  [{i:2d}/{len(events)}] SKIP {eid}", file=sys.stderr)
            continue
        uniprot = ev["uniprot_id"]
        score = fitness_for(uniprot, ev["position"], ev["wt_residue"], ev["mutant"])
        if "error" in score:
            row["status"] = "failed"
            row["error"] = score["error"]
        else:
            row["status"] = "ok"
            row.update(score)
        elapsed = time.time() - t0
        eta = elapsed / i * (len(events) - i)
        msg = f"  [{i:2d}/{len(events)}] {row['status']:7s} {eid}"
        if "fitness" in row:
            msg += f" fit={row['fitness']:+.2f} (lpWT={row['log_p_wt']:+.2f} lpMUT={row['log_p_mut']:+.2f})"
        msg += f"  ETA {eta:.0f}s"
        print(msg, file=sys.stderr)
    except Exception as e:
        row["status"] = "failed"
        row["error"] = str(e)[:200]
        print(f"  [{i:2d}/{len(events)}] FAIL {eid}: {e}", file=sys.stderr)
    results.append(row)

OUT_PATH.write_text(json.dumps({
    "schema_version": 1,
    "model_id": MODEL_ID,
    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "total": len(results),
    "ok": sum(1 for r in results if r.get("status") == "ok"),
    "failed": sum(1 for r in results if r.get("status") == "failed"),
    "skipped": sum(1 for r in results if r.get("status") == "skipped"),
    "results": results,
}, indent=2))

print(f"\nDone. Wrote {OUT_PATH}", file=sys.stderr)
