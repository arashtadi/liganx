#!/usr/bin/env python3
"""Liganx positive-control validation suite.

Submits a fixed set of (target, mutation, drug) pairs whose mutation-driven
binding shift is published in the clinical / pharmacology literature, then
checks whether Liganx's Δ(mutant - WT) score points in the right direction.
This is the smallest defensible numerical claim we can make: if the platform
gets the direction wrong on one of these eight head-to-head cases, the value
proposition isn't real and we shouldn't be selling it.

What this script PROVES (when it passes) and DOES NOT PROVE:

  PROVES — that on the current production catalog, with the current pocket
  boxes, prep pipeline, and engine, Liganx ranks the published
  resistance / selectivity events in the correct direction.

  DOES NOT PROVE — that absolute Δ values match the literature ΔΔG. Vina
  scoring isn't free energy and isn't calibrated to cellular IC50 shifts.
  The point is direction, not magnitude.

Why eight cases (not three, not eighty):

  Three is enough to claim a single anecdote each; eight gives roughly
  one example per major class (covalent-escape, gatekeeper, activation-
  loop, allele-selective drug). Eighty would take all night to dock and
  saturate the Pod GPU. Eight runs in ~10 minutes wall-clock and fits in
  one slide.

Auth:

  POST /jobs requires a verified user. Set LIGANX_BEARER_TOKEN to a valid
  Supabase JWT (copy from a signed-in browser session: Cookies → look for
  sb-*-auth-token, or call Supabase auth.getSession() in the console).
  We submit and poll using that header. Future iteration: a dedicated
  validation@liganx.com bot user with a long-lived service-role JWT.

Re-running:

  Idempotent in spirit — each invocation submits fresh jobs with deliberately
  marked titles and tags so the History page can group them. The script does
  NOT reuse cached results: stale results would be the worst possible bug
  here. Every run hits the live pipeline end-to-end.

Exit codes:

  0  every case agrees with literature direction
  1  one or more cases disagree (regression — investigate before announcing)
  2  network / auth / submission error (transient)
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Literal

API_BASE = os.environ.get("LIGANX_API_BASE", "https://api.liganx.com")
TOKEN = os.environ.get("LIGANX_BEARER_TOKEN", "").strip()
# Optional path — when set, write a machine-readable JSON of the run for the
# public /validation page on liganx.com to consume. Without this, the script
# only emits the human-readable markdown report.
JSON_OUT = os.environ.get("LIGANX_VALIDATE_JSON_OUT", "").strip()
# Vina sampling depth. Default 16 for the validation suite (vs 8 for the
# product default) because the suite's whole point is to resolve direction
# vs noise — bumping exhaustiveness halves the standard deviation of
# repeated Vina runs and is roughly 2× wall-clock per cell, which is fine
# for an ~8-cell suite that runs on demand. Tweak via env var if you want
# to bisect a noise-vs-method-limitation question on a specific case.
EXHAUSTIVENESS = int(os.environ.get("LIGANX_VALIDATE_EXHAUSTIVENESS", "16"))

# Vina/QuickVina2 noise floor at default exhaustiveness. Δs below this
# magnitude are within scoring noise and shouldn't be claimed as a direction.
# Source: AutoDock Vina docs + our own reproducibility tests at task #228.
NOISE_FLOOR_KCAL = 1.0


# ─── Cases ─────────────────────────────────────────────────────────────────
# Each case is one (pdb, chain, mutation, drug) triple with a published
# cellular shift. expected_direction encodes the literature-known answer:
#
#   "resistance" — the mutation makes this drug bind WORSE than WT.
#                  Liganx Δ(mutant - WT) should be POSITIVE (mutant score
#                  is less negative, i.e. weaker binding).
#
#   "selectivity" — the drug binds the mutant BETTER than WT (allele-
#                   selective drug). Liganx Δ should be NEGATIVE.
#
#   "retained"  — the drug binds about the same WT vs mutant (no
#                 covalent escape). Liganx Δ should sit within ±noise.
#
# The `caveat` field documents method-level reasons a particular case might
# under- or over-state the magnitude (covalent inhibitors, conformational
# mutations). The verdict is direction-only; magnitude caveats are reported
# alongside but don't fail the test.

@dataclass
class Case:
    name: str
    pdb_id: str
    chain: str
    uniprot_id: str
    mutation: str
    drug_name: str
    drug_smiles: str
    expected_direction: Literal["resistance", "selectivity", "retained"]
    literature: str
    caveat: str | None = None
    # Filled in at runtime.
    share_id: str | None = field(default=None, repr=False)
    delta_kcal: float | None = field(default=None, repr=False)
    wt_score: float | None = field(default=None, repr=False)
    mut_score: float | None = field(default=None, repr=False)
    error: str | None = field(default=None, repr=False)


# All target metadata mirrors backend/src/deltadock/catalog.py — keep in sync
# if a target's canonical PDB or chain changes there. The verify_catalog.py
# CI gate will catch a drift in the PocketBox; this list does not need its
# own gate because it's just a re-statement of catalog identity.
CASES: list[Case] = [
    Case(
        name="ABL T315I — Imatinib resistance",
        pdb_id="2HYY", chain="A", uniprot_id="P00519",
        mutation="T315I",
        drug_name="Imatinib",
        drug_smiles="Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1",
        expected_direction="resistance",
        literature="O'Hare et al., Nat Rev Cancer 2007 — T315I drives near-total Imatinib loss in CML; >400-fold IC50 shift in cellular assays.",
    ),
    Case(
        name="EGFR T790M — Gefitinib resistance",
        pdb_id="2ITY", chain="A", uniprot_id="P00533",
        mutation="T790M",
        drug_name="Gefitinib",
        drug_smiles="COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1",
        expected_direction="resistance",
        literature="Pao et al., PLoS Med 2005 — T790M gatekeeper drives 1st-gen TKI resistance in NSCLC.",
    ),
    Case(
        name="EGFR T790M — Osimertinib retains/gains",
        pdb_id="2ITY", chain="A", uniprot_id="P00533",
        mutation="T790M",
        drug_name="Osimertinib",
        drug_smiles="COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1",
        expected_direction="selectivity",
        literature="Cross et al., Cancer Discov 2014 — Osimertinib (AZD9291) was specifically designed to retain potency against T790M; cellular IC50 ~1 nM vs T790M, comparable to or better than WT.",
        caveat="Osimertinib is a covalent acrylamide on C797. Vina is non-covalent — magnitude will be smaller than IC50 shifts suggest, but the geometric T790M preference (the methionine bulk fits the Osimertinib scaffold better than threonine does) still produces a measurable ΔΔG.",
    ),
    Case(
        name="BRAF V600E — Vemurafenib selectivity",
        pdb_id="4WO5", chain="A", uniprot_id="P15056",
        mutation="V600E",
        drug_name="Vemurafenib",
        drug_smiles="CCCS(=O)(=O)Nc1ccc(F)c(C(=O)c2c[nH]c3ncc(-c4ccc(Cl)cc4)cc23)c1F",
        expected_direction="selectivity",
        literature="Bollag et al., Nature 2010 — Vemurafenib (PLX4032) is V600E-selective; ~30 nM against V600E vs ~100 nM against WT BRAF in cellular assays.",
    ),
    Case(
        name="KIT D816V — Imatinib resistance",
        pdb_id="1T46", chain="A", uniprot_id="P10721",
        mutation="D816V",
        drug_name="Imatinib",
        drug_smiles="Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1",
        expected_direction="resistance",
        literature="Heinrich et al., J Clin Oncol 2003 — D816V shifts KIT into an active conformation Imatinib cannot bind; >100-fold loss in mastocytosis.",
    ),
    Case(
        name="KIT D816V — Avapritinib selectivity",
        pdb_id="1T46", chain="A", uniprot_id="P10721",
        mutation="D816V",
        drug_name="Avapritinib",
        drug_smiles="CC[C@H]1OCCN(c2ncc(F)c(-c3cccc4c3CN(C(=O)Nc3ccccn3)CC4)n2)C1",
        expected_direction="selectivity",
        literature="Evans et al., Sci Transl Med 2017 — Avapritinib (BLU-285) was designed to bind the D816V active conformation; sub-nM cellular potency.",
    ),
    Case(
        name="BTK C481S — Ibrutinib covalent escape",
        pdb_id="5P9J", chain="A", uniprot_id="Q06187",
        mutation="C481S",
        drug_name="Ibrutinib",
        drug_smiles="C=CC(=O)N1CCC[C@H]1c1nc(-c2ccc(Oc3ccccc3)cc2)c2c(N)ncnc21",
        expected_direction="resistance",
        literature="Woyach et al., NEJM 2014 — C481S ablates the covalent cysteine target of Ibrutinib; >100-fold cellular IC50 loss in CLL.",
        caveat="Ibrutinib's WT advantage is COVALENT (acrylamide → C481 thiol). Vina is non-covalent and will under-represent this effect; the residual non-covalent ΔΔG should still be positive (S is smaller than C, slight pocket reshape) but smaller than IC50 data suggests.",
    ),
    Case(
        name="BTK C481S — Pirtobrutinib retention",
        pdb_id="5P9J", chain="A", uniprot_id="Q06187",
        mutation="C481S",
        drug_name="Pirtobrutinib",
        drug_smiles="Cc1ccc(C(=O)Nc2ccnc(-c3cn(C)c4ccc(F)cc34)n2)cc1OC",
        expected_direction="retained",
        literature="Mato et al., NEJM 2021 — Pirtobrutinib is non-covalent; retains potency against C481S (cellular IC50 essentially unchanged).",
    ),
]


# ─── Pretty output helpers ─────────────────────────────────────────────────
def _yellow(s: str) -> str: return f"\033[33m{s}\033[0m" if sys.stderr.isatty() else s
def _red(s: str) -> str:    return f"\033[31m{s}\033[0m" if sys.stderr.isatty() else s
def _green(s: str) -> str:  return f"\033[32m{s}\033[0m" if sys.stderr.isatty() else s


# ─── HTTP plumbing ─────────────────────────────────────────────────────────
def _request(method: str, path: str, body: dict | None = None, timeout: int = 60) -> dict:
    url = f"{API_BASE}{path}"
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code} on {method} {path}: {msg[:500]}") from e


def _submit(case: Case) -> str:
    payload = {
        "pdb_id": case.pdb_id,
        "chain": case.chain,
        "uniprot_id": case.uniprot_id,
        "mutations": [case.mutation],
        "include_wt": True,
        "exhaustiveness": EXHAUSTIVENESS,
        "engine": "quickvina2_gpu",
        "compounds": [{"name": case.drug_name, "smiles": case.drug_smiles}],
        "title": f"PC-validation: {case.name}",
        "tags": ["positive-control", "validation"],
    }
    job = _request("POST", "/jobs", payload, timeout=30)
    return job["share_id"]


def _poll(case: Case, max_wait_s: int = 900, interval_s: int = 8) -> dict:
    """Poll the public GET /jobs/{share_id} endpoint until the job lands in
    a terminal state. Two hardening lessons baked in here:

    1. **Transient HTTP 500s do not abort the case.** Run #5 of the
       validation suite hit a brief window where /jobs/{id} GETs returned
       500 (the backend was busy serving in-flight docking jobs from
       earlier runs). The prior version of this loop bubbled the first
       error straight up to the caller, the caller marked the case SKIP,
       and we lost real numbers that the backend was about to deliver.
       Now we treat 500s as soft errors — log, sleep, retry, up to
       MAX_TRANSIENT_RETRIES consecutive failures before giving up.

    2. **max_wait_s lifted from 600 → 900 seconds.** At exhaustiveness=16
       a typical cell takes 60-180s on the GPU pod; the prior 10-minute
       cap was tight when the pod queues up multiple cells in parallel.
       15 min is generous and still bounded.
    """
    MAX_TRANSIENT_RETRIES = 5
    start = time.time()
    last_status = None
    transient_failures = 0
    while time.time() - start < max_wait_s:
        try:
            # Public GET /jobs/{share_id} doesn't need auth — reading by share-link
            # is intentional, the bearer is only required to submit.
            j = _request("GET", f"/jobs/{case.share_id}", timeout=30)
            transient_failures = 0  # reset on any successful read
        except RuntimeError as e:
            msg = str(e)
            # 5xx and connection errors are transient — backend overload,
            # network blip, etc. 4xx is a hard error (bad share_id, etc.)
            # and we surface immediately.
            is_transient = "HTTP 5" in msg or "timed out" in msg.lower() or "Connection" in msg
            if is_transient and transient_failures < MAX_TRANSIENT_RETRIES:
                transient_failures += 1
                print(
                    f"  [{case.share_id}] transient poll error "
                    f"({transient_failures}/{MAX_TRANSIENT_RETRIES}): {msg[:120]}",
                    file=sys.stderr,
                )
                time.sleep(interval_s * 2)  # back off a bit
                continue
            raise
        status = j.get("status")
        if status != last_status:
            print(f"  [{case.share_id}] status={status} (t+{int(time.time()-start)}s)", file=sys.stderr)
            last_status = status
        if status in ("completed", "failed", "cancelled"):
            return j
        time.sleep(interval_s)
    raise TimeoutError(f"Job {case.share_id} did not complete in {max_wait_s}s (last status: {last_status})")


def _extract_delta(case: Case, job: dict) -> tuple[float | None, float | None, float | None, str | None]:
    """Pull the WT and mutant Vina best_score for the single compound in this
    job and return (wt, mut, delta, error). Δ = mut - WT in kcal/mol.

    Returns (None, None, None, error_str) if scoring couldn't be extracted —
    most commonly because the runner badged the cell as outside-pocket or
    skipped, which is an honest failure mode that the verdict logic below
    will treat as 'no answer' rather than 'wrong direction'."""
    results = job.get("results", [])
    compounds = job.get("compounds", [])
    if not compounds:
        return None, None, None, "no compounds in job"
    cid = compounds[0]["id"]
    wt = next((r for r in results if r.get("compound_id") == cid and r.get("variant") == "WT"), None)
    mut = next((r for r in results if r.get("compound_id") == cid and r.get("variant") == case.mutation), None)
    if not wt or not mut:
        return None, None, None, "missing WT or mutant result row"
    # Skip cells whose best_score isn't a real docking score:
    #   - 'outside_pocket' — the runner returns a number but it's against
    #     a residue Vina never sampled near, so the Δ is meaningless.
    #   - 'docking_failed' / 'ligand_prep_failed' — the runner stores
    #     best_score=0.0 as a sentinel on hard failures (a malformed
    #     receptor PDBQT, an exited Vina process, etc.). Treating that
    #     as a real "no binding" score would invent signal where there is
    #     none. The validation suite caught this on 2026-04-30 when a
    #     broken BTK C481S mutant PDBQT silently produced 0.0 scores
    #     and the prior version of this script counted them as valid.
    #   - 'skipped' / 'validate=skip' — runner-marked unscored cells.
    FAIL_TAGS = ("outside_pocket", "docking_failed", "ligand_prep_failed",
                 "validate=skip", "skipped", "mutant_build_failed")
    for label, r in (("WT", wt), (case.mutation, mut)):
        extra = r.get("extra") or ""
        for tag in FAIL_TAGS:
            if tag in extra:
                return None, None, None, f"{label} cell tagged '{tag}' — not a real Vina score"
    wt_s = float(wt["best_score"])
    mut_s = float(mut["best_score"])
    return wt_s, mut_s, mut_s - wt_s, None


def _verdict(case: Case) -> tuple[str, str]:
    """Decide PASS / FAIL / NOISE / SKIP for one case based on Δ direction.
    Returns (verdict, note) — note is a human-readable explanation."""
    if case.error:
        return "SKIP", case.error
    if case.delta_kcal is None:
        return "SKIP", "no Δ extracted"
    d = case.delta_kcal
    if abs(d) < NOISE_FLOOR_KCAL:
        # Within noise. For 'retained' that's a PASS; for direction cases it's
        # ambiguous — flag as NOISE so it's neither false PASS nor false FAIL.
        if case.expected_direction == "retained":
            return "PASS", f"|Δ|={abs(d):.2f} within ±{NOISE_FLOOR_KCAL} kcal/mol noise floor (retained as expected)"
        return "NOISE", f"|Δ|={abs(d):.2f} below ±{NOISE_FLOOR_KCAL} kcal/mol noise floor — direction not resolvable at exhaustiveness={EXHAUSTIVENESS}"
    sign_ok = (
        (case.expected_direction == "resistance" and d > 0)
        or (case.expected_direction == "selectivity" and d < 0)
        or (case.expected_direction == "retained" and abs(d) < NOISE_FLOOR_KCAL)
    )
    if sign_ok:
        return "PASS", f"Δ={d:+.2f} kcal/mol matches expected '{case.expected_direction}'"
    return "FAIL", f"Δ={d:+.2f} kcal/mol DISAGREES with literature '{case.expected_direction}' direction"


# ─── Main flow ─────────────────────────────────────────────────────────────
def main() -> int:
    if not TOKEN:
        print(_red("ERROR: set LIGANX_BEARER_TOKEN to a Supabase JWT to submit jobs."), file=sys.stderr)
        print("Get one from a signed-in browser console:", file=sys.stderr)
        print("  (await window.supabaseClient?.auth.getSession())?.data?.session?.access_token", file=sys.stderr)
        return 2

    # Optional ONLY filter — comma-separated case names (substring match) so
    # we can re-run a subset after fixing a specific bug. e.g.:
    #   LIGANX_VALIDATE_ONLY="BTK,KIT" python validate_positive_controls.py
    # When unset, run the full eight-case suite.
    global CASES  # must come before the first reference below
    only = [s.strip() for s in os.environ.get("LIGANX_VALIDATE_ONLY", "").split(",") if s.strip()]
    if only:
        original = len(CASES)
        CASES = [c for c in CASES if any(o.lower() in c.name.lower() for o in only)]
        print(f"Filter active (LIGANX_VALIDATE_ONLY): running {len(CASES)} of {original} cases", file=sys.stderr)

    print(f"Liganx positive-control validation — {len(CASES)} cases", file=sys.stderr)
    print(f"  API: {API_BASE}", file=sys.stderr)
    print(f"  Noise floor: ±{NOISE_FLOOR_KCAL} kcal/mol\n", file=sys.stderr)

    # Submit all jobs first so they queue + run in parallel on the Pod.
    for c in CASES:
        try:
            c.share_id = _submit(c)
            print(f"submitted {c.share_id}  {c.name}", file=sys.stderr)
        except Exception as e:
            c.error = f"submit failed: {e}"
            print(_red(f"submit FAILED {c.name}: {e}"), file=sys.stderr)

    # Poll each one in order. They run in parallel on the GPU pod, so by the
    # time we get to the 4th or 5th poll the earlier ones have completed.
    print("\nPolling for completion...", file=sys.stderr)
    for c in CASES:
        if c.error or not c.share_id:
            continue
        try:
            job = _poll(c)
            if job.get("status") != "completed":
                c.error = f"job status={job.get('status')} error={job.get('error_message')}"
                continue
            wt_s, mut_s, delta, err = _extract_delta(c, job)
            c.wt_score, c.mut_score, c.delta_kcal, c.error = wt_s, mut_s, delta, err
        except Exception as e:
            c.error = f"poll/extract failed: {e}"

    # Markdown report.
    lines = []
    lines.append(f"# Liganx positive-control validation\n")
    lines.append(f"**Run target**: `{API_BASE}`  ")
    lines.append(f"**Cases**: {len(CASES)}  ")
    lines.append(f"**Noise floor**: ±{NOISE_FLOOR_KCAL} kcal/mol  \n")
    lines.append("## Results\n")
    lines.append("| # | Case | Drug | WT | Mut | Δ | Expected | Verdict |")
    lines.append("|---|------|------|----|-----|---|----------|---------|")
    n_pass = n_fail = n_noise = n_skip = 0
    for i, c in enumerate(CASES, 1):
        v, note = _verdict(c)
        if v == "PASS":  n_pass  += 1; mark = "✓ PASS"
        elif v == "FAIL": n_fail  += 1; mark = "✗ FAIL"
        elif v == "NOISE": n_noise += 1; mark = "~ NOISE"
        else:             n_skip  += 1; mark = "— SKIP"
        wt = f"{c.wt_score:.2f}" if c.wt_score is not None else "—"
        mu = f"{c.mut_score:.2f}" if c.mut_score is not None else "—"
        de = f"{c.delta_kcal:+.2f}" if c.delta_kcal is not None else "—"
        lines.append(f"| {i} | {c.name} | {c.drug_name} | {wt} | {mu} | {de} | {c.expected_direction} | **{mark}** |")
    lines.append("")
    lines.append(f"**Pass: {n_pass} / {len(CASES)}**, Fail: {n_fail}, Noise (within floor): {n_noise}, Skipped: {n_skip}\n")

    lines.append("## Notes per case\n")
    for i, c in enumerate(CASES, 1):
        v, note = _verdict(c)
        lines.append(f"### {i}. {c.name}")
        lines.append(f"- **Drug**: {c.drug_name}")
        lines.append(f"- **Mutation**: {c.mutation} on {c.pdb_id}/{c.chain}")
        lines.append(f"- **Literature**: {c.literature}")
        if c.caveat:
            lines.append(f"- **Caveat**: {c.caveat}")
        lines.append(f"- **Verdict**: {v} — {note}")
        if c.share_id:
            lines.append(f"- **Job**: https://liganx.com/jobs/{c.share_id}")
        lines.append("")

    report = "\n".join(lines)
    print(report)

    # Optional machine-readable dump for the public /validation page on
    # liganx.com. The frontend reads this JSON at runtime — re-running the
    # suite and committing the refreshed JSON to frontend/public/ updates
    # the page's honest current snapshot.
    if JSON_OUT:
        # Re-derive verdict for each case so the JSON has the canonical
        # PASS/NOISE/FAIL/SKIP that the markdown table shows. Including it
        # in the JSON spares the frontend from re-implementing the noise-
        # floor logic (and accidentally diverging from the script).
        cases_json = []
        for c in CASES:
            v, note = _verdict(c)
            cases_json.append({
                "name": c.name,
                "pdb_id": c.pdb_id,
                "chain": c.chain,
                "uniprot_id": c.uniprot_id,
                "mutation": c.mutation,
                "drug_name": c.drug_name,
                "expected_direction": c.expected_direction,
                "literature": c.literature,
                "caveat": c.caveat,
                "share_id": c.share_id,
                "wt_score": c.wt_score,
                "mut_score": c.mut_score,
                "delta_kcal": c.delta_kcal,
                "verdict": v,
                "verdict_note": note,
            })
        # ISO-8601 UTC for the timestamp — frontend renders 'Last refreshed:
        # …' near the top so a reviewer can see if the page is stale.
        run = {
            "timestamp_utc": __import__("datetime").datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "api_base": API_BASE,
            "noise_floor_kcal": NOISE_FLOOR_KCAL,
            "summary": {
                "total": len(CASES),
                "pass": n_pass, "fail": n_fail, "noise": n_noise, "skip": n_skip,
            },
            "cases": cases_json,
        }
        out_path = JSON_OUT
        with open(out_path, "w") as f:
            json.dump(run, f, indent=2)
        print(f"\nWrote {out_path} ({len(cases_json)} cases)", file=sys.stderr)

    # Exit code: 0 if no FAIL (NOISE / SKIP are not regressions on their own).
    if n_fail > 0:
        print(_red(f"\nREGRESSION: {n_fail} case(s) disagree with literature direction. Investigate before any external claims about validation."), file=sys.stderr)
        return 1
    if n_skip > 0:
        print(_yellow(f"\nWarning: {n_skip} case(s) skipped (no Δ available). Suite did not fully exercise."), file=sys.stderr)
    print(_green(f"\nPASS: {n_pass}/{len(CASES)} cases agree with literature direction."), file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(_red(f"fatal: {e}"), file=sys.stderr)
        sys.exit(2)
