# Installing the medchem-phd and liganx-site-monitor skills

Two skills are ready in `/Users/arash/Documents/Claude/Projects/DockingOnline/skills/`:

- **`medchem-phd.skill`** — PhD medicinal chemist consultant. Use for auditing docking pipelines, mutation hints, scoring conventions, and getting medchem suggestions.
- **`liganx-site-monitor.skill`** — Daily production sweep agent. Tests the live site, validates the JSON snapshot, spot-checks science correctness.

## How to install

1. Open the Cowork sidebar → **Skills** section
2. Click **Install skill** (or drag-and-drop)
3. Select the `.skill` file from `/Users/arash/Documents/Claude/Projects/DockingOnline/skills/`
4. Repeat for the other skill

After install, both skills become available in any future Cowork session.

## Already running

A scheduled task **`liganx-site-monitor-daily`** has been created. It runs at **9:01 AM local time** every day and:

- Health-checks the API
- Smoke-tests homepage / `/validation` / `/library` / `/contact`
- Verifies the validation snapshot JSON is fresh and consistent
- Spot-checks 3 random catalog mutation hints for science accuracy
- Reviews the last 10 commits for risk to safety-critical files
- Sanity-checks Fly cost flags (BOLTZ2_ENABLED etc.)
- Reports findings via Telegram

You can manage the task from the **Scheduled** section in the sidebar, or click "Run now" to do an immediate test (recommended on first run, so it can pre-approve the tools it needs — Bash, web fetches, Chrome MCP).

## Reviewing the eval results

The skill was tested on 3 prompts (mutation-hint audit, the v5 symmetric-min trap, Imatinib T315I medchem moves), each run with-skill and without-skill. Results:

| Eval | with-skill | without-skill | Skill helped |
|------|-----------|----------------|--------------|
| Mutation hint audit (Y1230H) | 5/5 ✅ | 1/5 ❌ | Massively |
| v5 symmetric-min trap | 5/5 ✅ | 3/5 ⚠️ | Yes — explained WHY |
| Imatinib T315I moves | 5/5 ✅ | 2/5 ⚠️ | Yes — caught a fabricated precedent |

Aggregate: **with-skill = 100% pass rate, without-skill = 40%.** The full HTML eval viewer is at `skills/medchem-phd-workspace/iteration-1/review.html`.

## Iteration

If after using the skills for a few days you notice they undertrigger or give wrong-shaped output, run the skill-creator's eval loop again with the new feedback. The current version is an iteration-1 draft and is expected to evolve.
