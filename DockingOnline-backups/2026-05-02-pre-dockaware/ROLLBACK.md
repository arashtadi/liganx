# ROLLBACK — Pre-dockaware AI snapshot (2026-05-02)

Snapshot taken just before wiring docking context (score + hits + misses)
into the AI editor's /assist/compound endpoint. The change adds three
optional payload fields to the assist endpoint, a docking-aware mode in
the system prompt, an "AI context" mode pill in the sidebar, and a
"Dock + Improve" combo button.

**This is a purely additive change.** No DB schema migration. No data
migration. No deletes. Files touched:

- backend/src/deltadock/services/ai_assistant.py (system prompt + signature)
- backend/src/deltadock/routers/assist.py (request schema)
- frontend/src/api.ts (client type)
- frontend/src/components/KetcherModal.tsx (UI wiring)

Rollback = revert the commits. No data restoration needed.

## Snapshot artefacts

- HEAD.txt: git SHA at snapshot time
- git-log-pre-dockaware.txt: last 20 commits
- working-tree-2026-05-02-dockaware.tar.gz: source snapshot

## Tags

- pre-dockaware-2026-05-02 (pushed to origin)

## Easy rollback (preferred)

    cd ~/Documents/Claude/Projects/DockingOnline
    git log --oneline c998cee..HEAD       # find the dock-aware commits
    git revert <sha> <sha> ...            # revert in reverse order
    git push origin main                  # auto-deploys to Fly + Vercel

## Hard rollback (if reverts conflict)

    cd ~/Documents/Claude/Projects/DockingOnline
    git fetch --tags
    git reset --hard pre-dockaware-2026-05-02
    git push --force-with-lease origin main

Force-push only if no one has pulled since (solo project = fine).

## Verify rollback

    curl -s https://api.liganx.com/health | python3 -c 'import json,sys;print(json.load(sys.stdin)["git_sha"])'
