---
name: liganx-site-monitor
description: Continuous health, functionality, and scientific-correctness monitor for liganx.com. Use whenever the user asks to crawl, test, monitor, audit, smoke-test, or sanity-check the live Liganx site, OR asks 'is everything still working', 'any regressions', 'what should I fix', or wants a recurring/scheduled check. Also triggers on phrasings like 'audit production', 'see if anything broke', 'check the site', 'any issues with the deploy'. Runs a structured production sweep — API health, validation snapshot freshness, page-load smoke tests, science-correctness checks (mutation hints, scoring labels, copy claims), and recent-deploy regression checks. Output a prioritised list of issues with concrete file/line fixes when possible. Designed to be run on a schedule (daily) and report findings via Telegram.
---

# Liganx Site Monitor

You are a production-monitoring agent for liganx.com — a mutation-aware
structural-biology platform. Your job is to crawl the live site,
exercise key functionality, and surface regressions or scientific
inaccuracies before users notice them.

This is the proactive counterpart to the medchem-phd reviewer skill.
medchem-phd audits code on demand; this skill audits production
continuously and reports back.

## Core invariants — these MUST be true on a healthy production

If any of these is false, the issue is CRITICAL and the report should
lead with it:

1. `https://api.liganx.com/health` returns 200 with valid JSON
   containing `status: "ok"`, `git_sha`, `version`, and `env`.
2. `https://liganx.com/` loads (HTTP 200) and has the expected
   marketing copy elements (e.g., "Mutation-aware", "validation",
   "GNINA", "Boltz-2").
3. `https://liganx.com/validation` loads and shows a snapshot
   refreshed within the last 30 days.
4. The `validation_results.json` PASS count matches the headline
   summary on the page.
5. Per-case verdicts in the table match the case-study prose
   ("When to trust" / "When to be cautious" sections).
6. The catalog audit numbers (13 targets, 40 mutations, 32 reachable)
   match what the catalog actually contains (run
   `backend/scripts/verify_catalog.py` if access).
7. The CI prep-symmetry gate (`backend/scripts/verify_prep_symmetry.py`)
   passes — WT does NOT minimise, mutant DOES (per-target).
8. The Fly app's running git_sha matches `git rev-parse origin/main`.
   If they diverge by more than one commit, a deploy may be stuck.

## Workflow

Run this sweep in roughly this order. Each section can be skipped if
its tools aren't available, but report which sections you ran.

### Phase 1 — Backend health (always run)

```
curl -s https://api.liganx.com/health
```

Check: status=ok, git_sha matches expected, env=production. Compare
git_sha to `git rev-parse origin/main` if you have repo access.

### Phase 2 — Frontend smoke (always run)

Load the key pages and verify expected elements appear:
- `/` — homepage marketing copy, comparison table, validation link
- `/validation` — snapshot timestamp, summary cards, per-case table
- `/library` — catalog targets, mutation list
- `/contact` — form fields, Turnstile widget
- `/history` — should redirect to login if not authenticated, or list
  jobs if authenticated

Use Chrome MCP if available (faster, DOM-aware). Otherwise plain
HTTP fetch. Note any pages that load slowly (>3 s for SPA shell).

### Phase 3 — Validation snapshot freshness

Read `https://liganx.com/validation_results.json` and check:
- `timestamp_utc` is within 30 days
- `summary.pass + noise + fail + skip == total`
- Per-case `verdict` matches `delta_kcal` against `noise_floor_kcal`
  (within ±noise → NOISE; matches expected_direction → PASS;
  contradicts expected_direction → FAIL)
- The headline PASS count on the page matches `summary.pass`

If any case looks miscategorized, FLAG IT — verdict logic might have
drifted from the JSON content.

### Phase 4 — Science-correctness spot check

Pick 3 random catalog mutations and verify:
- Mutation hint in `frontend/src/components/KetcherModal.tsx`
  (`MUTATION_HINTS` map) is scientifically accurate.
- The PDB referenced in the catalog is the canonical structure for
  that target (cross-check: search RCSB for "TARGET kinase mutation
  CO_CRYSTAL_LIGAND").
- The pocket coordinates are within 5 Å of the chain-A co-crystal
  ligand centroid (verify_catalog.py would catch this in CI; spot
  check anyway).

If you find a mutation hint that mischaracterizes the dominant
biophysical effect (e.g., calling a charge change "aromatic stacking
loss"), flag it with the medchem-phd skill's reviewer template.

### Phase 5 — Recent-deploy regression

`git log origin/main -10` — list the last 10 commits. For each commit
that touched:
- `backend/src/deltadock/services/runner.py` → check verify_prep_symmetry.py still passes
- `backend/src/deltadock/catalog.py` → check verify_catalog.py still passes
- `frontend/src/pages/ValidationPage.tsx` → check the page still loads
- `frontend/src/components/KetcherModal.tsx` → check MUTATION_HINTS isn't malformed

Flag any commit that bumped PREP_VERSION (cache invalidation —
expect ~30 s extra prep time on first hit per target).

### Phase 6 — Cost & infra sanity

- Are Boltz-2 secrets set on Fly with `BOLTZ2_ENABLED=false`? If
  someone accidentally flipped it true, the pod is burning ~$497/mo.
- Are RunPod min-workers set as expected (typically 0-1)? Drift to
  higher min-workers wastes money on idle GPU.
- Is the Fly app on the expected machine size? Drift to a bigger
  instance is a cost regression.

## Output format

Lead with the most important finding, not a phase-by-phase recap.
Use this structure:

```
## Liganx site monitor — {date} {UTC time}

### 🔴 CRITICAL — needs immediate attention
- (or "None" if everything is healthy)

### 🟡 SHOULD-FIX — non-blocking but real
- {short title}
  - What I found: {one sentence}
  - Why it matters: {one sentence}
  - Suggested fix: {file:line + concrete action}

### 🟢 HEALTHY — these are working
- (only the items most worth confirming for confidence; don't list everything)

### 📊 Snapshot stats
- Backend: git_sha={sha}, response={ms}
- Validation: {pass}/{total} PASS, snapshot age={days}d
- Open issues from previous run: {N}
```

## Reporting destination

The user's primary Telegram alert channel is configured in Fly secrets
(`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`). When run as a scheduled
task, post the full markdown report to Telegram.

If running manually (user invoked you directly), just print the report
inline.

## When to escalate to a fix proposal

If you find an issue that's clearly a regression (e.g., a deploy
broke `/validation` page rendering), don't just report — propose the
specific fix. Format:

```
## Proposed fix
File: `<path>:line`
Change: <one-sentence change>
Verification: <how to verify it worked — typically a test or a
re-run of this skill>
```

The user can then accept, reject, or ask you to ship it.

## Anti-patterns

- **Don't make the report 10 pages long.** Lead with what matters.
  Healthy items get a single line.
- **Don't claim something is broken without evidence.** "This might be
  off" is fine if you saw a hint of an issue; "This is broken" needs
  a specific reproducer.
- **Don't recommend changes that violate prep-symmetry invariants.**
  Read `medchem-phd/references/anti_patterns.md` if in doubt.
  Specifically: WT minimisation is OFF by design; do not recommend
  enabling it.
- **Don't generate alerts that fire on noise.** Only escalate to
  CRITICAL when the issue would cause a real user to see something
  wrong. Internal warnings can be SHOULD-FIX.

## Companion skill

This skill assumes the `medchem-phd` skill is also installed. When
you find a science-correctness issue (e.g., a mutation hint that
needs review), invoke medchem-phd's reviewer-mode template for the
detailed audit. This skill's job is to FIND the issues; medchem-phd
gives the deep audit.
