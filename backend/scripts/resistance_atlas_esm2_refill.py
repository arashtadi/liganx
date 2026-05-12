"""Re-run ESM2 for the 8 failed events using a windowed sequence
(±400 residues around the mutation position) so we fit within the
1024-token context of the 35M model. ESM-2 has been shown to give
near-identical masked-LM fitness scores on windowed vs full sequences
for kinase domains (windows still capture the local + medium-range
contact patterns that dominate the MLM signal)."""
import json, sys, urllib.request, time
import torch
from transformers import AutoTokenizer, AutoModelForMaskedLM

MODEL_ID = "facebook/esm2_t12_35M_UR50D"
WIN = 400  # residues on each side of the mutation

tok = AutoTokenizer.from_pretrained(MODEL_ID)
model = AutoModelForMaskedLM.from_pretrained(MODEL_ID)
model.eval()

SEQ_CACHE = json.loads(open('/tmp/uniprot_seq_cache.json').read())
events = json.loads(open('/tmp/events.json').read())["events"]
existing = json.loads(open('/tmp/esm2_results.json').read())
results = existing["results"]
results_by_id = {r["event_id"]: r for r in results}

def fetch_seq(u):
    if u in SEQ_CACHE: return SEQ_CACHE[u]
    with urllib.request.urlopen(f"https://rest.uniprot.org/uniprotkb/{u}.fasta") as r:
        text = r.read().decode("utf-8")
    seq = "".join(L for L in text.splitlines() if not L.startswith(">"))
    SEQ_CACHE[u] = seq
    open('/tmp/uniprot_seq_cache.json', 'w').write(json.dumps(SEQ_CACHE))
    return seq

def windowed_fitness(seq, pos1, wt, mut):
    """pos1 is 1-indexed in `seq`. Window ±WIN around it."""
    pos0 = pos1 - 1
    lo = max(0, pos0 - WIN)
    hi = min(len(seq), pos0 + WIN + 1)
    win = seq[lo:hi]
    masked_pos0_in_win = pos0 - lo  # where the mask goes inside the window
    if win[masked_pos0_in_win] != wt:
        return {"error": f"window WT mismatch: win[{masked_pos0_in_win}]={win[masked_pos0_in_win]}, expected {wt}"}
    masked = win[:masked_pos0_in_win] + tok.mask_token + win[masked_pos0_in_win+1:]
    inputs = tok(masked, return_tensors="pt", truncation=True, max_length=1024)
    with torch.no_grad():
        logits = model(**inputs).logits
    mask_idx_t = (inputs.input_ids[0] == tok.mask_token_id).nonzero(as_tuple=True)[0]
    if len(mask_idx_t) == 0:
        return {"error": "no mask token after tokenization"}
    pos_logits = logits[0, mask_idx_t[0].item()]
    lp = torch.log_softmax(pos_logits, dim=-1)
    wt_id = tok.convert_tokens_to_ids(wt)
    mut_id = tok.convert_tokens_to_ids(mut)
    return {
        "log_p_wt": float(lp[wt_id]),
        "log_p_mut": float(lp[mut_id]),
        "fitness": float(lp[mut_id]) - float(lp[wt_id]),
        "seq_len_full": len(seq),
        "window_len": len(win),
        "windowed": True,
    }

failed_ids = [r["event_id"] for r in results if r.get("status") == "failed"]
print(f"Refilling {len(failed_ids)} failed events using ±{WIN}-residue windows ...")

ev_by_id = {e["id"]: e for e in events}
for eid in failed_ids:
    ev = ev_by_id[eid]
    try:
        seq = fetch_seq(ev["uniprot_id"])
        score = windowed_fitness(seq, ev["position"], ev["wt_residue"], ev["mutant"])
        row = {"event_id": eid, **score}
        if "error" in score:
            row["status"] = "failed"
        else:
            row["status"] = "ok"
            print(f"  ok {eid} fit={score['fitness']:+.2f} (windowed)")
        results_by_id[eid] = row
    except Exception as e:
        results_by_id[eid] = {"event_id": eid, "status": "failed", "error": str(e)[:200]}
        print(f"  FAIL {eid}: {e}")

# Rebuild ordered results, preserving original order
final = []
for r in results:
    final.append(results_by_id.get(r["event_id"], r))

existing["results"] = final
existing["ok"] = sum(1 for r in final if r.get("status") == "ok")
existing["failed"] = sum(1 for r in final if r.get("status") == "failed")
existing["skipped"] = sum(1 for r in final if r.get("status") == "skipped")
existing["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
existing["windowed_residues"] = WIN
open('/tmp/esm2_results.json', 'w').write(json.dumps(existing, indent=2))
print(f"\nFinal: ok={existing['ok']} failed={existing['failed']} skipped={existing['skipped']}")
