# FEP+ end-to-end build — Final scientific verification (2026-05-15)

Auditor: chemist-agent verification, full pass over the Phase B
end-to-end build (G1–G10). Verdict applied: **NOT ship-ready until
B3 / M3 / M4 are fixed.** Fix list below; what's applied this
session is annotated.

## Blocking

### B1 / B2 — openfe API surface verification (DEFERRED to pod deploy)

Can't be verified without the actual pinned openfe 1.0 installed on
the Blackwell pod. Documented in `runpod/DEPLOY_FEP_POD.md` step 7
as the smoke-test verification gate — operator must verify before
flipping `FEP_ENABLED=1`.

### B3 — Cycle-closure math is mathematically broken — FIXING

Replace hand-rolled DFS cycle finder with `networkx.cycle_basis` on
an undirected MultiGraph. Sum signed ΔΔG values around each
elementary cycle. 15 lines of correct vs the prior ~50 lines.

## Medium

### M3 — Hysteresis silently returns 0.0 → disables NOT_CONVERGED — FIXING

openfe 1.x's `RelativeHybridTopologyProtocolResult` does not expose
`forward_estimate` / `reverse_estimate` attributes by default. The
`except: hysteresis = 0.0` swallows the AttributeError silently,
meaning every edge reports `hysteresis = 0.0` and `convergence_flag
= "ok"` — disabling the entire NOT_CONVERGED safety net.

Fix: if forward/reverse estimates aren't available, propagate a
sentinel `hysteresis = -1.0` and downgrade the convergence flag to
`high_uncertainty` rather than `ok`. The runner's per-node
aggregation then propagates the conservative flag.

### M4 — Backend doesn't enforce a cost cap — FIXING

Frontend asks for $50 confirmation; a `curl` POST bypasses that.
Add a hard reject in `create_fep_study` when the estimated cost
exceeds a configurable cap.

## Nice-to-have (deferred)

- **N1** — Duplicate / identity analog dedupe via RDKit canonicalisation.
- **N2** — Parent-job PDB-id mismatch check.
- **N3** — Widen smoke-test acceptance band (single-edge run, ~20%
  false-negative rate at current band).
- **N4** — Acrylamide-warhead detection + UI warning.
- **N5** — Inline `±` CI display in the ranked table.
- **N6** — Protonation state from input SMILES, restart durability
  for thread-fallback path, hinge-water preservation.

## What's applied this session

- ✅ B3 — replaced cycle finder with `networkx.cycle_basis`.
- ✅ M3 — hysteresis sentinel + conservative flag downgrade.
- ✅ M4 — backend cost cap with `FEP_MAX_USD_PER_STUDY` env var.

## Recommended sequence for next session

1. Verify B1 + B2 with the actual openfe 1.0 install on the pod.
2. N1 + N2 (cheap cleanups).
3. N6 — protonation + crystallographic water.
4. N3 — re-tune smoke band after first real run.
