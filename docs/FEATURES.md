# Feature Register

One row per feature or discussion point. Claude updates this during discussions;
`/commit` marks items Done with the commit hash. Never delete a row, change its status instead.

## Statuses
| Status | Meaning |
|---|---|
| Idea | Raised, not discussed yet |
| Discussing | Under discussion, no decision |
| Approved | Decided, ready to build |
| In progress | Being built |
| Done | Built and committed (hash in Notes) |
| Postponed | Will do later. Needs a revisit date or trigger |
| Shelved | Parked indefinitely. Needs the reason |
| Blocked | Waiting on something external. Needs what and who |
| Rejected | Decided against. Needs the reason |

## Register
| ID | Feature | Module | Status | Updated | Notes |
|---|---|---|---|---|---|
| F-001 | Grow Billing-System into a full CA firm platform | platform | Discussing | 2026-10-11 | Modules to be listed. Billing is module 1 |
| F-002 | Commit npm lockfiles, use npm ci | deploy | Done | 2026-10-11 | Commit 91925db. Backend prod install: npm ci --omit=dev |
| F-003 | Track schema.sql as the baseline schema | db | Done | 2026-10-11 | Commit e9d697e. Table definitions only, no real data |
| F-004 | Stop tracking backup_prod.sql, ignore dumps/backups | security | Done | 2026-10-11 | Untracked in e9d697e, ignore rules in .gitignore. File still on disk |
| F-005 | Error handler: hide 5xx messages and stacks outside development (server.js ~line 65) | backend | Discussing | 2026-10-11 | err.message currently reaches the client in every env (leaks constraint/table names). Proposed fix: generic message for status >= 500 unless NODE_ENV=development; log full error server-side. Awaiting go-ahead. Also set NODE_ENV=production in prod .env and in the PM2/NSSM service config |
| F-006 | Add backend/.env.example with variable names and fake values | deploy | Discussing | 2026-10-11 | Keys: PORT, NODE_ENV, DB_*, JWT_*, EMAIL_*, FRONTEND_URL |
| F-007 | nginx config (static dist + /api proxy) and PM2/NSSM service setup for prod | deploy | Idea | 2026-10-11 | Prod already runs nginx. Not started |
| F-008 | HTTPS / domain for prod | security | Postponed | 2026-10-11 | Owner wants to discuss later. Revisit when deployment hardening is discussed. Current state: no HTTPS, no domain. Open question: office-only or internet users? |
| F-009 | Real migrations workflow (numbered files after the schema.sql baseline) | db | Postponed | 2026-10-11 | Approach C agreed in principle: start when the second module begins. Interim rule in CLAUDE.md: migration per DB change, starting at 010 |
| F-010 | Rewrite git history to remove backup_prod.sql (commit 84b2078) | security | Rejected | 2026-10-11 | Owner does not want to delete or rewrite that commit. Mitigation: keep the GitHub repo private, treat dump contents as exposed, rotate secrets if they ever appeared in it |
| F-011 | Rename test/main branches and move prod to pull main | deploy | In progress | 2026-10-12 | Names chosen: main (prod) + develop (was test). Local rename done 2026-10-11. Done so far: develop pushed to origin/develop (2026-10-12); GitHub default branch set to develop by owner (screenshot, 2026-10-12). Remaining: push main (origin/main still 3ccd27c), switch server to pull main explicitly (git pull origin main; a fresh clone would land on develop), then delete origin/test. Decision 2026-10-12: GitHub default branch stays develop (Claude sessions attach to the default branch; all work happens on develop). main is still what prod runs and is only updated by fast-forward merge from develop. Server must pull main explicitly. Note: pulling e9d697e on the server deletes the tracked backup_prod.sql from its working tree, so copy it aside first |
