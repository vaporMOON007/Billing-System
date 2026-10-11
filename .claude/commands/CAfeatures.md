---
description: Show or update the feature register (docs/FEATURES.md). Examples: /CAfeatures, /CAfeatures add tax module, /CAfeatures F-003 postponed until Dec
argument-hint: [add <title> | <ID> <status> [reason/date]]
---

Argument: $ARGUMENTS

- No argument: read `docs/FEATURES.md` and show a short summary grouped by status. Flag any Postponed item whose revisit date has passed, and any Blocked item.
- `add <title>`: add a new row with the next F-number, status Idea (or Discussing if we are discussing it now), module, today's date.
- `<ID> <status> ...`: change that row's status and update the date. Postponed needs a revisit date or trigger, Shelved/Rejected need a reason, Blocked needs what/who. If the reason is missing, ask me before saving.
- Statuses must be one of: Idea, Discussing, Approved, In progress, Done, Postponed, Shelved, Blocked, Rejected.
- Never delete rows. Append to Notes instead of overwriting old reasons.
- Commit only `docs/FEATURES.md` as `docs: update feature register`. Do not push.
