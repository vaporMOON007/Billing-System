# Changelog

Every commit adds its own entry here (enforced by `.githooks/commit-msg`).
Run `/CAchangelog` to fill in commit hashes and backfill missing entries.

Entry format:

    ### YYYY-MM-DD · type(scope) · short summary  [hash]
    Why: ...
    What: ...
    Files: ...
    DB: migration/schema changes, or "none"

## 2026-10

### 2026-10-11 · chore(deps) · lock npm versions, use npm ci in setup
Why: Reproducible installs on dev and prod
What: Added package-lock.json for backend and frontend; setup.py now runs npm ci instead of npm install
Files: backend/package-lock.json, frontend/package-lock.json, setup.py
DB: none

