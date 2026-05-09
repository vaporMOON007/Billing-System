# CA Firm Billing System — Full Context for New Chat

## Project Instructions (from CLAUDE.md)
YOU ARE A FULL STACK DEVELOPER. SUGGEST IDEAS USED IN PRODUCTION APPLICATIONS. DON'T BE A YES-SAYER — ASK QUESTIONS BACK AND POINT OUT ISSUES. DO NOT MAKE ANY ADDITIONAL CHANGE WITHOUT CONFIRMATION AND DISCUSSION.

---

## Tech Stack

- **Backend**: Node.js / Express, `pg` (node-postgres) driver
- **Frontend**: React (react-router, react-hot-toast, react-datepicker, Tailwind CSS)
- **Database**: PostgreSQL
  - Local: PostgreSQL 16.3
  - Production: PostgreSQL 17.9 (separate server — migrations must be run manually via `psql`)
- **DB name**: `ca_firm` (local) / `CA_FIRM` (prod — case-sensitive on Linux)
- **Auth**: JWT-based, roles: `SUPERADMIN`, `CA`, `USER`

---

## Business Domain

A billing system for a CA (Chartered Accountant) firm. Core entities:

- **Companies** (`header_master`): The CA firm's own legal entities. Each company has a unique bill prefix (e.g. `MSD`, `SCA`, `URJ`), one or more bank accounts, GSTIN, PAN.
- **Clients** (`clients_master`): The firm's customers.
- **Bills** (`bills`): Invoice records. Status: `DRAFT` → `FINALIZED` → (`ABSORBED` if merged). Payment status: `UNPAID` / `PARTIAL` / `PAID`.
- **Bill Number Format**: `{PREFIX}/{FYSHORT}/{3-digit-seq}` — e.g. `MSD/2526/001`. Assigned by DB trigger on finalize, NOT on creation.
- **Financial Year**: Indian FY — April to March. Format `"2025-26"`.
- **Services** (`bill_services`): Line items on a bill. Each has a particular (service type), amount, GST rate.
- **Payments** (`bill_payments`): Payments recorded against a bill.
- **Write-offs** (`bill_writeoffs`): Audit trail of write-off amounts applied to partially paid finalized bills. SUPERADMIN only.
- **Merges** (`bill_merges`): Multiple bills can be merged into one. Source bills become `ABSORBED`.
- **Bank Accounts** (`header_bank_details`): Now 1:many per company (was 1:1). Each bill stores which account was used via `bills.bank_account_id`.

---

## Key DB Triggers

| Trigger | Event | Table | Purpose |
|---|---|---|---|
| `assign_bill_number` | BEFORE INSERT/UPDATE | `bills` | Assigns `bill_no` on finalize using `bill_number_counters` |
| `trigger_calculate_gst` | AFTER INSERT/UPDATE/DELETE | `bill_services` | Recalculates GST amounts on service lines |
| `trigger_update_bill_totals` | AFTER INSERT/UPDATE/DELETE | `bill_services` | Recalculates `total_invoice_value` on `bills` |
| `trigger_update_bill_payment_status` | AFTER INSERT/UPDATE/DELETE | `bill_payments` | Updates `payment_status`, `total_paid`, `last_payment_date` on `bills` |
| `update_bill_payment_status_on_delete` | AFTER DELETE | `bill_payments` | **BROKEN ON PROD** — prod version missing `last_payment_date` update (fixed by migration 003) |

**Known trigger bug on prod**: There are TWO triggers firing on `bill_payments` INSERT — `update_payment_status_on_insert` AND `trigger_update_bill_payment_status` — causing the status calculation function to run twice on every payment. Fixed by migration 005 (drops the duplicate).

---

## Migrations Overview

All migration files are in `migrations/`. They must be run manually on prod via:
```bash
psql -U postgres -d CA_FIRM -f migrations/00X_name.sql
```

| File | Purpose | Status on Prod |
|---|---|---|
| `001_unique_bill_prefix.sql` | Unique index on `UPPER(bill_prefix)` in `header_master` | ❌ BLOCKED — duplicate URJ prefix exists in prod data (see Issue #1) |
| `002a_migrate_writeoff_data.sql` | Migrate write-off data from `bills` columns → `bill_writeoffs` table (run BEFORE 002) | ✅ Run (confirmed by user) |
| `002_bill_writeoffs_table.sql` | Create `bill_writeoffs` table | ✅ Run (was no-op since 002a created it first) |
| `003_fix_delete_trigger.sql` | Replace broken `update_bill_payment_status_on_delete` trigger | ❌ NOT YET RUN ON PROD |
| `004_finalize_zero_value_guard.sql` | DB-level CHECK constraint: finalized bills must have `total_invoice_value > 0` | ❌ NOT YET RUN ON PROD |
| `005_schema_cleanup.sql` | (A) Formalise `clients_master.pan` with CHECK; (B) Drop duplicate `update_payment_status_on_insert` trigger; (C) Drop dead `bill_number_sequence` table | ❌ NOT YET RUN ON PROD |
| `006_multi_bank_accounts.sql` | Multi-bank support: drop UNIQUE on `header_bank_details.header_id`, add `nick_name`/`is_primary`, add `bank_account_id` NOT NULL FK on `bills`, backfill | ❌ NOT YET RUN ON PROD — **run AFTER** resolving Issue #1 first |

---

## Migration File Contents (exact SQL)

### `migrations/001_unique_bill_prefix.sql`
```sql
-- BEFORE running: check for duplicates first:
-- SELECT UPPER(bill_prefix), COUNT(*) FROM header_master
-- GROUP BY UPPER(bill_prefix) HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_header_master_bill_prefix
    ON header_master (UPPER(bill_prefix));

COMMENT ON COLUMN header_master.bill_prefix IS
    'Invoice prefix (e.g. INV, SCA). Must be unique across all companies. '
    'Cannot be changed after the first finalized bill is created.';
```

### `migrations/002a_migrate_writeoff_data.sql`
```sql
-- Run BEFORE migration 002. Safe to run multiple times (ON CONFLICT DO NOTHING).
BEGIN;
CREATE TABLE IF NOT EXISTS bill_writeoffs (
    id               SERIAL PRIMARY KEY,
    bill_id          INTEGER       NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    writeoff_amount  NUMERIC(15,2) NOT NULL CHECK (writeoff_amount > 0),
    written_off_by   INTEGER       REFERENCES users(id),   -- nullable: old data may have no user
    writeoff_date    DATE          NOT NULL DEFAULT CURRENT_DATE,
    notes            TEXT,
    created_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bill_writeoffs_bill_id ON bill_writeoffs (bill_id);
INSERT INTO bill_writeoffs (bill_id, writeoff_amount, written_off_by, writeoff_date, notes, created_at)
SELECT b.id, b.writeoff_amount, b.writeoff_by,
       COALESCE(b.writeoff_date, CURRENT_DATE), b.writeoff_notes, CURRENT_TIMESTAMP
FROM bills b
WHERE b.writeoff_amount IS NOT NULL AND b.writeoff_amount > 0
  AND NOT EXISTS (SELECT 1 FROM bill_writeoffs bw WHERE bw.bill_id = b.id);
COMMIT;
-- DROP old columns manually AFTER verifying data:
-- ALTER TABLE bills DROP COLUMN IF EXISTS writeoff_amount, DROP COLUMN IF EXISTS writeoff_by,
--     DROP COLUMN IF EXISTS writeoff_date, DROP COLUMN IF EXISTS writeoff_notes;
```

### `migrations/002_bill_writeoffs_table.sql`
```sql
-- No-op if 002a was run first. written_off_by NOT NULL here (valid for new records only).
CREATE TABLE IF NOT EXISTS bill_writeoffs (
    id               SERIAL PRIMARY KEY,
    bill_id          INTEGER      NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    writeoff_amount  NUMERIC(15,2) NOT NULL CHECK (writeoff_amount > 0),
    written_off_by   INTEGER      NOT NULL REFERENCES users(id),
    writeoff_date    DATE         NOT NULL DEFAULT CURRENT_DATE,
    notes            TEXT,
    created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bill_writeoffs_bill_id ON bill_writeoffs (bill_id);
```

### `migrations/003_fix_delete_trigger.sql`
```sql
CREATE OR REPLACE FUNCTION update_bill_payment_status_on_delete()
RETURNS TRIGGER AS $$
DECLARE
    v_total_invoice  NUMERIC(15,2);
    v_total_paid     NUMERIC(15,2);
    v_last_date      DATE;
    v_new_status     VARCHAR(20);
BEGIN
    SELECT COALESCE(SUM(amount_paid), 0), MAX(payment_date)
    INTO v_total_paid, v_last_date
    FROM bill_payments WHERE bill_id = OLD.bill_id;

    SELECT COALESCE(total_invoice_value, 0) INTO v_total_invoice
    FROM bills WHERE id = OLD.bill_id;

    IF v_total_paid <= 0 THEN v_new_status := 'UNPAID';
    ELSIF v_total_paid < v_total_invoice THEN v_new_status := 'PARTIAL';
    ELSE v_new_status := 'PAID';
    END IF;

    UPDATE bills
    SET payment_status    = v_new_status,
        total_paid        = v_total_paid,
        last_payment_date = v_last_date,   -- THIS was missing in the prod version
        updated_at        = CURRENT_TIMESTAMP
    WHERE id = OLD.bill_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;
```

### `migrations/004_finalize_zero_value_guard.sql`
```sql
ALTER TABLE bills
    ADD CONSTRAINT chk_finalized_bill_has_value
    CHECK (
        status != 'FINALIZED'
        OR (total_invoice_value IS NOT NULL AND total_invoice_value > 0)
    );
```

### `migrations/005_schema_cleanup.sql`
```sql
-- A. Formalise clients_master.pan
ALTER TABLE clients_master ADD COLUMN IF NOT EXISTS pan VARCHAR(10);
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pan_format_check' AND conrelid = 'clients_master'::regclass
    ) THEN
        ALTER TABLE clients_master
            ADD CONSTRAINT pan_format_check
            CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]{1}$');
    END IF;
END $$;
-- B. Drop duplicate INSERT trigger
DROP TRIGGER IF EXISTS update_payment_status_on_insert ON bill_payments;
-- C. Drop dead table
DROP TABLE IF EXISTS bill_number_sequence;
```

### `migrations/006_multi_bank_accounts.sql`
```sql
BEGIN;
-- A. Drop the UNIQUE constraint enforcing 1:1 (header_id unique)
ALTER TABLE header_bank_details
    DROP CONSTRAINT IF EXISTS header_bank_details_header_id_key;

-- B. Add new columns
ALTER TABLE header_bank_details
    ADD COLUMN IF NOT EXISTS nick_name  VARCHAR(100),
    ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

-- C. Mark all existing rows as primary
UPDATE header_bank_details SET is_primary = true WHERE is_primary = false;

-- D. Add bank_account_id to bills (nullable first for backfill)
-- ON DELETE RESTRICT: cannot delete a bank account that has bills pointing at it
ALTER TABLE bills
    ADD COLUMN IF NOT EXISTS bank_account_id INTEGER
        REFERENCES header_bank_details(id) ON DELETE RESTRICT;

-- E. Backfill existing bills — pick the primary account for each company
UPDATE bills b
SET bank_account_id = (
    SELECT hbd.id FROM header_bank_details hbd
    WHERE hbd.header_id = b.header_id AND hbd.is_primary = true
    LIMIT 1
)
WHERE b.bank_account_id IS NULL;

-- Verification (RAISE WARNING if any bills still NULL — fix manually before step F)
DO $$
DECLARE v_null_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_null_count FROM bills WHERE bank_account_id IS NULL;
    IF v_null_count > 0 THEN
        RAISE WARNING '⚠  % bill(s) could not be backfilled. Fix manually before adding NOT NULL.', v_null_count;
    ELSE
        RAISE NOTICE '✓ All bills backfilled. Safe to proceed.';
    END IF;
END $$;

-- F. Enforce NOT NULL (fails if any bills were not backfilled — fix those first)
ALTER TABLE bills ALTER COLUMN bank_account_id SET NOT NULL;

-- G. Index
CREATE INDEX IF NOT EXISTS idx_bills_bank_account_id ON bills (bank_account_id);
COMMIT;
```

---

## Prod Data Issues Found (from backup.sql analysis)

1. **Duplicate bill_prefix `URJ`**: `header_master` has two companies with prefix `URJ`:
   - ID 3: URJA COMPUTERS (old/duplicate — created as workaround for second bank account)
   - ID 4: URJA COMPUTERS (correct/primary)
   - **Fix plan** (now multi-bank is coded): Run migration 006 on prod → add ID 3's bank account as a second account on ID 4 via the new UI → update any bills pointing at company ID 3 to point at ID 4 → delete company ID 3 → then run migration 001.

2. **`bills` table on prod has 4 extra columns** not in current `schema.sql`:
   - `writeoff_amount NUMERIC(15,2)`, `writeoff_by INTEGER`, `writeoff_date DATE`, `writeoff_notes TEXT`
   - Migration 002a migrated data to `bill_writeoffs`. Drop these manually (Issue #10) after verifying data.

3. **`gst_rates_master` on prod has orphan `rate_name` column** not in `schema.sql`. App normalises — both `description` and `rate_name` are accepted and mapped to `description` column. No functional impact.

4. **Activity log entry**: `WRITE_OFF_BILL` action has `entity_type = "bill"` (lowercase) in one historical prod row. Current code correctly uses uppercase. Manual `UPDATE` on that row if reporting queries filter by `entity_type`.

---

## Known Issues — Current Status

| # | Issue | Severity | Type | Tables/Files | Status |
|---|---|---|---|---|---|
| 1 | Duplicate `bill_prefix` on 2 companies (ID 3 & 4, both `URJ`) — blocks migration 001 | 🔴 High | Data + DB | `header_master` | ⏳ Unblocked now — multi-bank feature is coded. Fix: run 006, merge ID 3 into ID 4, delete ID 3, run 001 |
| 2 | Migration 001 — unique index on `bill_prefix` not yet applied on prod | 🔴 High | DB | `header_master` | ❌ Blocked by #1 |
| 3 | Delete DRAFT bill failing — root cause not confirmed yet | 🔴 High | App + DB | `bills`, `bill_merges`, `bill_payments` | ❌ Needs actual error message from server to diagnose |
| 4 | `deleteHeader` missing `override_header_id` and `bank_account_id` FK checks | 🟠 Medium | App + DB | `bills`, `header_master` | ✅ **FIXED in code** — all 3 FKs now checked with friendly messages |
| 5 | Broken `update_bill_payment_status_on_delete` trigger on prod | 🟠 Medium | DB | `bill_payments`, `bills` | ❌ Migration 003 not run on prod yet |
| 6 | Migration 004 — zero-value finalize guard not yet applied on prod | 🟠 Medium | DB | `bills` | ❌ Not run on prod yet |
| 7 | Migration 005 — duplicate trigger + dead `bill_number_sequence` table | 🟠 Medium | DB | `bill_payments`, `bill_number_sequence` | ❌ Not run on prod yet |
| 8 | `gst_rates_master` has orphan `rate_name` column on prod | 🟡 Low | DB | `gst_rates_master` | ❌ No functional impact — low priority |
| 9 | Finalized bills can be deleted by anyone — no status guard in `deleteBill` | 🟡 Low | App | `bills`, `billRoutes.js` | ❌ Pending |
| 10 | DROP old write-off columns from `bills` after data verified | 🟡 Low | DB | `bills` | ❌ Hold — verify prod data first |
| 11 | `WRITE_OFF_BILL` activity log `entity_type = "bill"` (lowercase) in one historical prod row | 🟡 Low | DB | `activity_log` | ❌ Manual UPDATE needed on that one row |

---

## Issue Detail Notes

### Issue #1 & #2 — Unblocking the duplicate URJ prefix
Step-by-step plan now that multi-bank is coded and deployed:
1. Run `migrations/006_multi_bank_accounts.sql` on prod
2. In Company Master UI: expand company ID 4 (URJA COMPUTERS, correct one), click "Add Account", enter the bank details from company ID 3
3. Find any bills that belong to company ID 3 (`SELECT * FROM bills WHERE header_id = 3`) — reassign them to company ID 4 via SUPERADMIN (needs a data fix or a one-off UPDATE)
4. Delete company ID 3 from Company Master UI (the new `deleteHeader` will block it if bills still reference it)
5. Run `migrations/001_unique_bill_prefix.sql` on prod

### Issue #3 — Delete DRAFT bill failing
**Most likely candidates** (in order of probability):
- `bill_merges.source_bill_id` has a RESTRICT FK on `bills(id)`. If the bill was ever involved in a merge/unmerge cycle, a `bill_merges` row may still reference it. `deleteBill` deletes `bill_payments` and `bill_services` but does NOT delete from `bill_merges` or `bill_history` before deleting the bill.
- The duplicate trigger (Issue #7) firing twice causing unexpected state.
- Need the actual error message from the server to confirm the exact cause.

**Current `deleteBill` gaps**:
```js
await client.query('DELETE FROM bill_payments WHERE bill_id = $1', [id]);
await client.query('DELETE FROM bill_services WHERE bill_id = $1', [id]);
await client.query('DELETE FROM bills WHERE id = $1', [id]);
// MISSING: DELETE FROM bill_merges WHERE source_bill_id = $1 (RESTRICT FK blocks this)
// MISSING: DELETE FROM bill_history WHERE bill_id = $1
// MISSING: Status check — any user can delete any bill including FINALIZED
```

### Issue #4 — FIXED
`deleteHeader` now checks all three FKs before attempting deletion:
1. `bills.header_id` — bills created under this company
2. `bills.override_header_id` — bills where SUPERADMIN reassigned the header
3. `bills.bank_account_id` via JOIN on `header_bank_details` — bills using a bank account of this company

### Issue #9 — No status guard in deleteBill
Any authenticated user can call `DELETE /api/bills/:id` regardless of bill status. No role check on the route, no status check in the controller. A regular user can delete a FINALIZED bill with payments. Fix: block non-SUPERADMIN from deleting FINALIZED bills.

### Issue #11 — Write-off entity_type casing
Current code is correct (`entityType: 'BILL'` uppercase). The prod inconsistency is a single historical row. Run this on prod DB if needed:
```sql
UPDATE activity_log SET entity_type = 'BILL' WHERE action = 'WRITE_OFF_BILL' AND entity_type = 'bill';
```

---

## Multi-Bank Account Feature — COMPLETED

### What Was Built
Full multi-bank support — DB migration, backend, and frontend all coded.

### DB Schema Changes (migration 006)
- `header_bank_details`: UNIQUE constraint on `header_id` dropped (now 1:many). New columns: `nick_name VARCHAR(100)`, `is_primary BOOLEAN NOT NULL DEFAULT false`.
- `bills`: New column `bank_account_id INTEGER NOT NULL REFERENCES header_bank_details(id) ON DELETE RESTRICT`.
- All existing bills are backfilled with their company's primary account on migration run.

### Backend Changes Made

**`masterController.js`**:
- `updateHeaderDetails`: Removed the broken `ON CONFLICT (header_id) DO UPDATE` bank upsert — bank accounts are now managed via dedicated endpoints only.
- `deleteHeader`: Fixed to check all 3 FKs (`header_id`, `override_header_id`, `bank_account_id` via join) — Issue #4 resolved.
- 4 new controller functions:
  - `getBankAccountsByHeader` — GET all accounts for a company, ordered primary first
  - `addBankAccount` — POST new account; forces `is_primary=true` if first account; demotes others if `is_primary=true`
  - `updateBankAccount` — PUT update; validates ownership; demotes others if setting primary
  - `deleteBankAccount` — DELETE; blocks if any bill references it; blocks if only account; promotes oldest remaining as primary after deletion

**`masterRoutes.js`**:
- Added `PUT /headers/:id` as alias for backwards compat (frontend `masterAPI.updateHeader` was calling a non-existent PUT route — now fixed)
- Added 4 bank account routes: `GET/POST /headers/:id/bank-accounts`, `PUT/DELETE /headers/:id/bank-accounts/:bankId`

**`billController.js`**:
- `createBill`: Accepts `bank_account_id` — validates it belongs to `header_id`. If not provided, auto-picks primary account (fallback: any account). Errors if company has no bank account at all.
- `updateBill`: Accepts `bank_account_id` — validates ownership. Permission check: DRAFT = any user can change; FINALIZED = SUPERADMIN only.

**`api.js`**:
- 4 new `masterAPI` methods: `getBankAccountsByHeader`, `addBankAccount`, `updateBankAccount`, `deleteBankAccount`
- Fixed typo in `deletePaymentTerm` URL (was `:id` literal, now `${id}`)

### Frontend Changes Made

**`MastersPage.jsx`**:
- Company table now has a chevron (▶/▼) per row to expand bank accounts inline
- Expanded section shows a nested table of all bank accounts with: nick name, bank, account holder, account number, IFSC, primary star indicator, Edit/Delete buttons
- "Add Account" button in the expanded section header
- Bank account Add/Edit modal: nick name, bank name, account holder, account number, IFSC, branch name, "Set as primary" checkbox
- Bank account delete confirm dialog with clear messaging about bills blocking deletion

**`ServicesFormPage.jsx`**:
- `formData` now includes `bank_account_id`
- `handleCompanyChange()`: fetches accounts for selected company → 1 account = silent auto-select; >1 accounts = shows popup
- `loadBankAccountsForCompany()`: shared loader; edit mode pre-selects bill's existing account without popup
- Bank account card at bottom of form: shows bank name, account holder, account number, IFSC
- "Change" button on card (only shown if company has >1 account AND user has permission: any user for DRAFT, SUPERADMIN only for FINALIZED)
- Bank account selection popup: radio buttons, pre-selects current account, shows bank name, nick name, primary badge, account holder, account number, IFSC
- `handleSubmit` (create): validates `bank_account_id` is set before submitting; sends it in payload
- `handleSubmit` (update): sends `bank_account_id` in payload if set

### Permission Model (Bank Account)
| Bill Status | Who Can Change Bank Account |
|---|---|
| DRAFT | Any authenticated user |
| FINALIZED | SUPERADMIN only (same as `override_edit` pattern) |

---

## Key File Locations

```
backend/
  controllers/
    masterController.js     — Company + bank account CRUD, particulars, GST, payment terms
    billController.js       — Bills CRUD, finalize, delete, write-off, merge
    activityLogController.js
  routes/
    masterRoutes.js         — /api/masters/* routes (incl. bank account routes)
    billRoutes.js           — /api/bills/* routes
  middleware/
    auth.js                 — JWT auth + authorize(role) middleware
  config/
    database.js             — pg pool + query helper

frontend/src/
  pages/
    ServicesFormPage.jsx    — Bill create/edit form (bank account card + popup now implemented)
    MastersPage.jsx         — Master data management (company expandable bank accounts now implemented)
    PrintBillPage.jsx       — Bill print/PDF view
  components/
    common/Modal.jsx
    common/Dropdown.jsx
    common/SearchableDropdown.jsx
  services/
    api.js                  — All API calls (masterAPI, billAPI, clientAPI)

migrations/
  001_unique_bill_prefix.sql
  002a_migrate_writeoff_data.sql
  002_bill_writeoffs_table.sql
  003_fix_delete_trigger.sql
  004_finalize_zero_value_guard.sql
  005_schema_cleanup.sql
  006_multi_bank_accounts.sql   ← NEW — run this on prod before using multi-bank

schema.sql                  — Local DB schema (reference — does not yet reflect 006 changes)
backup.sql                  — Prod DB dump (PostgreSQL 17.9)
CONTEXT_FOR_NEW_CHAT.md     — This file
```

---

## Remaining Work / Pending Items

### Must-do before going live with multi-bank
1. Run migrations 003, 004, 005 on prod (independent — no dependencies between them)
2. Run migration 006 on prod
3. Execute the URJA COMPUTERS merge plan (Issues #1/#2) — see detail above
4. Verify `PrintBillPage.jsx` uses `bills.bank_account_id` to fetch the correct bank account for printing (currently it JOINs `header_bank_details` on `header_id` — this will now return multiple rows for companies with >1 account; needs to be updated to JOIN on `bank_account_id` instead)

### Still pending (Issues #3, #5–#11 minus #4)
- **Issue #3**: Diagnose delete DRAFT bill failure — need actual error message from user
- **Issue #5**: Run migration 003 on prod
- **Issue #6**: Run migration 004 on prod
- **Issue #7**: Run migration 005 on prod
- **Issue #8**: Drop `rate_name` column from `gst_rates_master` on prod (low priority, no functional impact)
- **Issue #9**: Add status guard to `deleteBill` — block non-SUPERADMIN from deleting FINALIZED bills
- **Issue #10**: DROP old write-off columns from `bills` on prod after data verified
- **Issue #11**: Manual `UPDATE activity_log` for the one lowercase `entity_type` row on prod

### ✅ FIXED — Wrong bank JOIN in all query files
All `LEFT JOIN header_bank_details` queries were incorrectly joining on `header_id` (the old 1:1 key). After migration 006 this would return wrong/multiple rows. Fixed in **4 places across 3 files**:

| File | Query | Fix |
|---|---|---|
| `billController.js` | `getBillById` main query | `hb.id = b.bank_account_id` |
| `billController.js` | `updateBill` response query | `hbd.id = b.bank_account_id` |
| `paymentController.js` | `getPaymentHistory` | `hbd.id = bp.received_in_account_id` |
| `reportController.js` | `getReceivables` (×2) | `hbd.id = bp.received_in_account_id` |

`PrintBillPage.jsx` reads `selectedBill.bank_name` from the API — no frontend change needed, fix flows through automatically.

**Migration 006 prod blocker is fully cleared.** No remaining code changes needed before running 006.
