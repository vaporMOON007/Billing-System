---
description: Audit docs/CHANGELOG.md against git history, fill in commit hashes, backfill missing entries.
---

1. Read `docs/CHANGELOG.md` and run `git log --reverse --format="%h|%ad|%s" --date=short`.
2. For every commit that already has an entry, add its short hash to the entry heading if missing.
3. For every commit with NO entry (including old ones like "minor bugs 3"), read its diff (`git show <hash> --stat` and the relevant hunks) and write a proper entry in the same format: date, type(scope), summary, Why, What, Files, DB. Put backfilled entries in order by commit date. If you cannot tell the why from the diff, write "Why: not recorded" instead of guessing.
4. Do not rewrite git history or old commit messages.
5. Show me a summary of what you added (counts and any entries where you were unsure), then commit only `docs/CHANGELOG.md` as `docs: sync changelog`. Do not push.
