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

### 2026-10-11 · chore(repo) · normalize .gitignore line endings
Why: Previous commit stored mixed CRLF/LF, which can break ignore patterns on Linux
What: Converted .gitignore to LF only; no pattern changes
Files: .gitignore
DB: none


### 2026-10-11 · chore(workflow) · commit hook, slash commands, docs registers
Why: One repeatable workflow: auto commits, changelog, feature and migration registers, living context file
What: Added .githooks/commit-msg, /commit, /CAchangelog and /CAfeatures commands, docs/FEATURES.md, docs/MIGRATIONS.md, docs/decisions/, moved CONTEXT_FOR_NEW_CHAT.md to docs/ with a maintenance header
Files: .githooks/, .claude/commands/, docs/
DB: none


### 2026-10-11 · chore(repo) · update .gitignore
Why: Keep env files and local artefacts out of git
What: Rewrote .gitignore (adds .env variants; mostly line-ending churn elsewhere)
Files: .gitignore
DB: none


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

