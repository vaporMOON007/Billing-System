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

### 2026-10-11 · chore(db) · add full schema.sql, remove backup_prod.sql
Why: Fresh installs need one complete schema; prod data dump should not live in the repo
What: Added schema.sql (full schema); removed backup_prod.sql from the tree (still in older history)
Files: schema.sql, backup_prod.sql
DB: none (schema.sql is a snapshot of the existing schema)


### 2026-10-11 · chore(deps) · lock npm versions, use npm ci in setup
Why: Reproducible installs on dev and prod
What: Added package-lock.json for backend and frontend; setup.py now runs npm ci instead of npm install
Files: backend/package-lock.json, frontend/package-lock.json, setup.py
DB: none

