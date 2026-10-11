---
description: Commit the approved items in this chat to the given branch (e.g. /commit test). Every commit includes a CHANGELOG entry.
argument-hint: <branch-name>
---

Target branch: $ARGUMENTS

1. Run `git branch --show-current`. If it is not exactly `$ARGUMENTS`, STOP and tell me. Do not switch branches.
2. Run `git status --short`. If files are staged that you did not touch, tell me what they are and ask before continuing. Never use `git add -A`.
3. List the items from this chat that I approved and that are built but not yet committed. Do not include anything still under discussion. If there are none, say so and stop.
4. For EACH item, one at a time, in order:
   a. Stage only the files that item touched (`git add <paths>`).
   b. Add an entry for it at the TOP of the current month's section in `docs/CHANGELOG.md`, using exactly this format (hash is filled in later by /CAchangelog):
      ### YYYY-MM-DD · type(scope) · short summary
      Why: ...
      What: ...
      Files: ...
      DB: migration/schema changes, or "none"
   c. If the item has a row in `docs/FEATURES.md`, set it to Done and update the date (the hash is added later by /CAchangelog). Stage that file too.
   d. If the item changes architecture, DB shape, business rules, roles, deployment steps or known issues, update the matching section of `docs/CONTEXT_FOR_NEW_CHAT.md` and its "Last reviewed" date, and stage it.
   e. Stage `docs/CHANGELOG.md` and commit with the message `type(scope): summary` (types: feat, fix, refactor, db, docs, chore), a blank line, then a body with the why and what.
5. Never push. Finish by showing `git log --oneline` for the new commits.
