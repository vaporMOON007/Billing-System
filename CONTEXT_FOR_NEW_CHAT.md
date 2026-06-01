# CA Firm Billing System — Full Context for New Chat

## Project Instructions (from CLAUDE.md)
YOU ARE A FULL STACK DEVELOPER. SUGGEST IDEAS USED IN PRODUCTION APPLICATIONS. DON'T BE A YES-SAYER — ASK QUESTIONS BACK AND POINT OUT ISSUES. DO NOT MAKE ANY ADDITIONAL CHANGE WITHOUT CONFIRMATION AND DISCUSSION.

---

## Tech Stack

- **Backend**: Node.js / Express, `pg` (node-postgres) driver
- **Frontend**: React (react-router, react-hot-toast, react-datepicker, Tailwind CSS)
- **Database**: PostgreSQL
  - Local: PostgreSQL (working DB is now `Billing` — cloned from prod)
  - Production: PostgreSQL 17.9
- **DB name**: `Billing` (both local working copy AND prod — case-sensitive, always use quotes)
- **Auth**: JWT-based, roles: `SUPERADMIN`, `CA`, `EMPLOYEE`

---

## Business Domain

A billing system for a CA (Chartered Accountant) firm. Core entities:

- **Companies** (`header_master`): The CA firm's own legal entities. Each company has a unique bill prefix (e.g. `MSD`, `URJ`, `CAR`), one or more bank accounts, GSTIN, PAN.
- **Clients** (`clients_master`): The firm's customers.
- **Bills** (`bills`): Invoice records. Status: `DRAFT` → `FINALIZED` → (`ABSORBED` if merged). Payment status: `UNPAID` / `PARTIAL` / `PAID`.
- **Bill Number Format**: `{PREFIX}/{FYSHORT}/{3-digit-seq}` — e.g. `MSD/2526/001`. Assigned by DB trigger on finalize, NOT on creation.
- **Financial Year**: Indian FY — April to March. Format `"2025-26"`.
- **Services** (`bill_services`): Line items on a bill. Each has a particular (service type), amount, GST rate.
- **Payments** (`bill_payments`): Payments recorded against a bill.
- **Write-offs** (`bill_writeoffs`): Audit trail of write-off amounts applied to partially paid finalized bills. SUPERADMIN only.
- **Merges** (`bill_merges`): Multiple bills can be merged into one. Source bills become `ABSORBED`.
- **Bank Accounts** (`header_bank_details`): 1:many per company. Each bill stores which account was used via `bills.bank_account_id`. Each account has `nick_name` and `is_primary` flag.

---

## Production Server Setup

- **Server**: Windows dedicated server, IP `192.168.1.105`
- **Remote access**: UltraViewer
- **Backend path**: `C:\Users\Administrator\Desktop\Billing-System\backend`
- **Frontend path**: `C:\Users\Administrator\Desktop\Billing-System\frontend`
- **Startup**: `start.py` scheduled via Windows Task Scheduler
- **Backend port**: 5000
- **Frontend port**: 3000 (running `npm run dev` — needs to be fixed)

---

## Key DB Triggers

| Trigger | Event | Table | Purpose |
|---|---|---|---|
| `assign_bill_number` | BEFORE INSERT/UPDATE | `bills` | Assigns `bill_no` on finalize using `bill_number_counters` |
| `trigger_calculate_gst` | BEFORE INSERT/UPDATE | `bill_services` | Recalculates GST amounts on service lines |
| `trigger_update_bill_totals` | AFTER INSERT/UPDATE/DELETE | `bill_services` | Recalculates `total_invoice_value` on `bills` |
| `trigger_update_bill_payment_status` | AFTER INSERT/UPDATE/DELETE | `bill_payments` | Updates `payment_status`, `total_paid`, `last_payment_date` on `bills` |
| `update_payment_status_on_delete` | AFTER DELETE | `bill_payments` | Recalculates status when payment deleted — fixed in migration 003 |

---

## Migrations Status

| File | Purpose | Local (`Billing`) | Prod (`Billing`) |
|---|---|---|---|
| `001_unique_bill_prefix.sql` | Unique index on `UPPER(bill_prefix)` | ❌ Not yet — run AFTER data fixes | ❌ Not yet |
| `002a_migrate_writeoff_data.sql` | Migrate write-off data to `bill_writeoffs` table | ✅ Already in prod backup | ✅ Done |
| `002_bill_writeoffs_table.sql` | Create `bill_writeoffs` table | ✅ Already in prod backup | ✅ Done |
| `003_fix_delete_trigger.sql` | Fix broken delete trigger (adds `last_payment_date`) | ✅ Done | ❌ Not yet |
| `004_finalize_zero_value_guard.sql` | CHECK constraint: finalized bills must have value > 0 | ✅ Done | ❌ Not yet |
| `005_schema_cleanup.sql` | Drop duplicate trigger + dead `bill_number_sequence` table | ✅ Done | ❌ Not yet |
| `006_multi_bank_accounts.sql` | Multi-bank support — **UPDATED** (see note below) | ✅ Done | ❌ Not yet |

### Migration 006 — Important Update
Migration 006 was updated during this session to fix two issues before running on prod:
1. **Added Step A0**: Drops `bill_payments_received_in_account_id_fkey` before dropping the UNIQUE constraint on `header_bank_details.header_id` (PostgreSQL blocks the drop otherwise)
2. **Added Step H0**: Remaps `bill_payments.received_in_account_id` values from `header_id` values → actual `header_bank_details.id` values before re-adding the FK
3. **Added Step H**: Re-adds the FK correctly pointing to `header_bank_details(id)` instead of `header_bank_details(header_id)`

---

## Data Fix Scripts (NEW — created this session)

These scripts are in `migrations/` folder. They must be run on local first, verified, then run on prod in the same order.

| File | Purpose | Local (`Billing`) | Prod (`Billing`) |
|---|---|---|---|
| `fix_001_company8_prefix.sql` | Fix Company 8 prefix `CA.`/`CA ` → `CAR`, fix bill number `CA./2627/001` → `CAR/2627/001` | ❌ Not yet run | ❌ Not yet |
| `fix_002_merge_company3_into_4.sql` | Merge duplicate URJA COMPUTERS (ID 3) into correct company (ID 4) | ❌ Not yet run | ❌ Not yet |
| `fix_003_merge_company9_into_1.sql` | Merge duplicate MANOJ S DISA (ID 9) into correct company (ID 1) | ❌ Not yet run | ❌ Not yet |

**Each script has:**
- Preview SELECTs at top (show what will change before touching data)
- BEGIN/changes/COMMIT transaction block
- Verification SELECTs at bottom

**Run order**: fix_001 → fix_002 → fix_003 → migration 001

---

## Company Master — Current State (Prod)

| ID | Company Name | Prefix | Status | Notes |
|---|---|---|---|---|
| 1 | MANOJ S DISA AND CO | MSD | ✅ Keep | Primary/correct |
| 3 | URJA COMPUTERS | URJ | 🔴 Delete | Duplicate — merge into ID 4 (fix_002) |
| 4 | URJA COMPUTERS | URJ | ✅ Keep | Primary/correct |
| 8 | CA RISHIKESH N. SANGTANI | CA. / CA  | 🟠 Fix prefix | Change to `CAR` (fix_001) |
| 9 | MANOJ S DISA AND CO | MAN | 🔴 Delete | Duplicate — merge into ID 1 (fix_003) |

---

## Bank Accounts — Current State (Prod, after migration 006)

| hbd.id | header_id (Company) | Bank | Account No | is_primary | Action |
|---|---|---|---|---|---|
| 1 | 1 (MSD) | HDFC | 50200002663828 | true | ✅ Keep |
| 4 | 3 (URJ duplicate) | HDFC | 06371930006766 | true | 🔴 Delete (fix_002 — same account as hbd.id=5) |
| 5 | 4 (URJ correct) | HDFC | 06371930006766 | true | ✅ Keep |
| 10 | 8 (CAR) | Kotak | 0145314192 | true | ✅ Keep |
| 11 | 9 (MAN duplicate) | Dhule Vikas Sahakari | 01021001652 | true | 🟠 Move to Company 1 as second account (fix_003) |

---

## Known Issues — Current Status

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | Duplicate `bill_prefix` URJ (companies ID 3 & 4) | 🔴 High | ⏳ fix_002 script ready — not run yet |
| 2 | Migration 001 — unique index on `bill_prefix` not on prod | 🔴 High | ❌ Blocked until fix_001/002/003 done |
| 3 | Delete DRAFT bill failing on prod | 🔴 High | ❌ Need actual error message from server |
| 4 | `deleteHeader` missing FK checks | 🟠 Medium | ✅ Fixed in code |
| 5 | Broken delete trigger on `bill_payments` on prod | 🟠 Medium | ❌ Migration 003 not run on prod yet |
| 6 | Zero-value finalize guard not on prod | 🟠 Medium | ❌ Migration 004 not run on prod yet |
| 7 | Duplicate trigger + dead table on prod | 🟠 Medium | ❌ Migration 005 not run on prod yet |
| 8 | Orphan `rate_name` column in `gst_rates_master` on prod | 🟡 Low | ❌ No functional impact |
| 9 | Any user can delete a FINALIZED bill — no status guard | 🟡 Low | ❌ Pending |
| 10 | Old write-off columns on `bills` table on prod | 🟡 Low | ❌ Verify then drop |
| 11 | One `WRITE_OFF_BILL` activity log row has lowercase `entity_type` | 🟡 Low | ❌ One SQL UPDATE needed |
| 12 | Company 8 prefix `CA.`/`CA ` needs to be `CAR` | 🟠 Medium | ⏳ fix_001 script ready — not run yet |
| 13 | Company 9 (MAN) duplicate of Company 1 (MSD) | 🔴 High | ⏳ fix_003 script ready — not run yet |

---

## Pending Infrastructure Fixes (Non-DB)

1. **JWT_SECRET** — Still placeholder value on prod. Must be changed to a random string in prod `.env`. All users will be logged out once changed.
2. **CORS_ORIGIN** — `.env` has `FRONTEND_URL` but `server.js` reads `CORS_ORIGIN`. Rename to `CORS_ORIGIN=http://192.168.1.105:3000` on prod, `CORS_ORIGIN=http://localhost:3000` on local.
3. **Frontend API URL** — Verify frontend is not hardcoding `localhost:5000` for API calls. Users on other devices will fail if it is.
4. **Frontend build** — `npm run dev` running in production. Should be `npm run build` + static file serving.
5. **Process manager** — No crash recovery. Replace `start.py` logic with PM2.

---

## Multi-Bank Account Feature — COMPLETED IN CODE

### What Was Built
Full multi-bank support — DB migration, backend, and frontend all coded.

### DB Schema Changes (migration 006)
- `header_bank_details`: UNIQUE constraint on `header_id` dropped (now 1:many). New columns: `nick_name VARCHAR(100)`, `is_primary BOOLEAN NOT NULL DEFAULT false`.
- `bills`: New column `bank_account_id INTEGER NOT NULL REFERENCES header_bank_details(id) ON DELETE RESTRICT`.
- `bill_payments.received_in_account_id`: FK now references `header_bank_details(id)` (was `header_bank_details(header_id)`).
- All existing bills backfilled with their company's primary account on migration run.

### Backend Changes Made

**`masterController.js`**:
- `updateHeaderDetails`: Removed broken `ON CONFLICT (header_id) DO UPDATE` bank upsert
- `deleteHeader`: Fixed to check all 3 FKs (`header_id`, `override_header_id`, `bank_account_id` via join)
- 4 new controller functions: `getBankAccountsByHeader`, `addBankAccount`, `updateBankAccount`, `deleteBankAccount`

**`masterRoutes.js`**:
- Added `PUT /headers/:id` alias for backwards compat
- Added 4 bank account routes: `GET/POST /headers/:id/bank-accounts`, `PUT/DELETE /headers/:id/bank-accounts/:bankId`

**`billController.js`**:
- `createBill`: Accepts `bank_account_id`, validates it belongs to `header_id`, auto-picks primary if not provided
- `updateBill`: Accepts `bank_account_id`, validates ownership, DRAFT = any user, FINALIZED = SUPERADMIN only

**`api.js`**:
- 4 new `masterAPI` methods: `getBankAccountsByHeader`, `addBankAccount`, `updateBankAccount`, `deleteBankAccount`
- Fixed typo in `deletePaymentTerm` URL

### Frontend Changes Made

**`MastersPage.jsx`**:
- Company table expandable rows showing bank accounts inline
- Add/Edit/Delete bank account modals

**`ServicesFormPage.jsx`**:
- `bank_account_id` in form state
- Auto-select if 1 account, popup if multiple
- Bank account card shown on form

### Fixed — Wrong bank JOIN in query files
All `LEFT JOIN header_bank_details` queries now join on `hb.id = b.bank_account_id` (was `header_id`). Fixed in `billController.js`, `paymentController.js`, `reportController.js`.

---

## Key File Locations

```
backend/
  controllers/
    masterController.js
    billController.js
    activityLogController.js
  routes/
    masterRoutes.js
    billRoutes.js
  middleware/
    auth.js
  config/
    database.js

frontend/src/
  pages/
    ServicesFormPage.jsx
    MastersPage.jsx
    PrintBillPage.jsx
  components/
    common/Modal.jsx
    common/Dropdown.jsx
    common/SearchableDropdown.jsx
  services/
    api.js

migrations/
  001_unique_bill_prefix.sql
  002a_migrate_writeoff_data.sql
  002_bill_writeoffs_table.sql
  003_fix_delete_trigger.sql
  004_finalize_zero_value_guard.sql
  005_schema_cleanup.sql
  006_multi_bank_accounts.sql        ← UPDATED this session
  fix_001_company8_prefix.sql        ← NEW this session
  fix_002_merge_company3_into_4.sql  ← NEW this session
  fix_003_merge_company9_into_1.sql  ← NEW this session
  preview_001_company8_prefix.sql    ← NEW (can delete — merged into fix_001)
  preview_002_merge_company3_into_4.sql ← NEW (can delete — merged into fix_002)
  preview_003_merge_company9_into_1.sql ← NEW (can delete — merged into fix_003)

CONTEXT_FOR_NEW_CHAT.md  ← this file
backup_prod.sql           ← prod DB dump (taken this session, May 2026)
```

---

## What Was Done This Session (31 May 2026)

1. Fixed `express-rate-limit` missing on prod server — ran `npm install` in backend
2. Analysed prod vs local schema differences — found 5 missing migrations + data issues
3. Created local `Billing` DB by restoring `backup_prod.sql` (exact prod clone)
4. Ran migrations 003, 004, 005 on local `Billing` DB — all successful
5. Fixed and ran migration 006 on local `Billing` DB — required 3 additional steps (drop FK, remap data, re-add FK correctly)
6. Created 3 data fix scripts with preview queries + verification queries
7. Updated CONTEXT_FOR_NEW_CHAT.md

## Next Steps (In Order)

1. Run `fix_001_company8_prefix.sql` on local — verify output
2. Run `fix_002_merge_company3_into_4.sql` on local — verify output
3. Run `fix_003_merge_company9_into_1.sql` on local — verify output
4. Run `001_unique_bill_prefix.sql` on local — should succeed now
5. Test the app locally against the `Billing` DB — confirm everything works
6. Apply same steps (003, 004, 005, 006, fix_001, fix_002, fix_003, 001) on prod
7. Address Issue #3 (delete DRAFT bill failing) — need error message from prod
8. Address Issue #9 (FINALIZED bill delete guard)
9. Address infrastructure fixes (JWT_SECRET, CORS_ORIGIN, frontend build, PM2)
