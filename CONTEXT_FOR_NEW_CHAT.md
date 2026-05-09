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

- **Companies** (`header_master`): The CA firm's own legal entities. Each company has a unique bill prefix (e.g. `MSD`, `SCA`, `URJ`), bank account details, GSTIN, PAN.
- **Clients** (`clients_master`): The firm's customers.
- **Bills** (`bills`): Invoice records. Status: `DRAFT` → `FINALIZED` → (`ABSORBED` if merged). Payment status: `UNPAID` / `PARTIAL` / `PAID`.
- **Bill Number Format**: `{PREFIX}/{FYSHORT}/{3-digit-seq}` — e.g. `MSD/2526/001`. Assigned by DB trigger on finalize, NOT on creation.
- **Financial Year**: Indian FY — April to March. Format `"2025-26"`.
- **Services** (`bill_services`): Line items on a bill. Each has a particular (service type), amount, GST rate.
- **Payments** (`bill_payments`): Payments recorded against a bill.
- **Write-offs** (`bill_writeoffs`): Audit trail of write-off amounts applied to partially paid finalized bills. SUPERADMIN only.
- **Merges** (`bill_merges`): Multiple bills can be merged into one. Source bills become `ABSORBED`.

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
| `001_unique_bill_prefix.sql` | Unique index on `UPPER(bill_prefix)` in `header_master` | ❌ BLOCKED — duplicate URJ prefix exists in prod data |
| `002a_migrate_writeoff_data.sql` | Migrate write-off data from `bills` columns → `bill_writeoffs` table (run BEFORE 002) | ✅ Run (confirmed by user) |
| `002_bill_writeoffs_table.sql` | Create `bill_writeoffs` table | ✅ Run (was no-op since 002a created it first) |
| `003_fix_delete_trigger.sql` | Replace broken `update_bill_payment_status_on_delete` trigger | ❌ NOT YET RUN |
| `004_finalize_zero_value_guard.sql` | DB-level CHECK constraint: finalized bills must have `total_invoice_value > 0` | ❌ NOT YET RUN |
| `005_schema_cleanup.sql` | (A) Formalise `clients_master.pan` with CHECK; (B) Drop duplicate `update_payment_status_on_insert` trigger on `bill_payments`; (C) Drop dead `bill_number_sequence` table | ❌ NOT YET RUN |

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
-- Creates bill_writeoffs with written_off_by NULLABLE (prod data has NULL writeoff_by).
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

-- Verification block (RAISE NOTICE statements) omitted here for brevity — see file.
COMMIT;

-- DROP old columns (run manually AFTER verifying data — see bottom of file):
-- ALTER TABLE bills DROP COLUMN IF EXISTS writeoff_amount, DROP COLUMN IF EXISTS writeoff_by,
--     DROP COLUMN IF EXISTS writeoff_date, DROP COLUMN IF EXISTS writeoff_notes;
```

### `migrations/002_bill_writeoffs_table.sql`
```sql
-- NOTE: If 002a was run first, this CREATE TABLE is a no-op.
-- written_off_by is NOT NULL here — only valid for new records post-migration.
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
    FROM bill_payments
    WHERE bill_id = OLD.bill_id;

    SELECT COALESCE(total_invoice_value, 0)
    INTO v_total_invoice
    FROM bills WHERE id = OLD.bill_id;

    IF v_total_paid <= 0 THEN
        v_new_status := 'UNPAID';
    ELSIF v_total_paid < v_total_invoice THEN
        v_new_status := 'PARTIAL';
    ELSE
        v_new_status := 'PAID';
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

-- B. Drop duplicate INSERT trigger (causes payment status function to run twice)
DROP TRIGGER IF EXISTS update_payment_status_on_insert ON bill_payments;

-- C. Drop dead table (app uses bill_number_counters, not this)
DROP TABLE IF EXISTS bill_number_sequence;
```

---

## Prod Data Issues Found (from backup.sql analysis)

1. **Duplicate bill_prefix `URJ`**: `header_master` has two companies with prefix `URJ`:
   - ID 3: URJA COMPUTERS (old/duplicate — created as workaround for second bank account)
   - ID 4: URJA COMPUTERS (correct/primary)
   - Root cause: System was 1:1 company-to-bank-account. User created a duplicate company just to have a second bank account.
   - Fix plan: Implement multi-bank feature first, then migrate ID 3's bank account as a second account on ID 4, delete ID 3.

2. **`bills` table on prod has 4 extra columns** not in current `schema.sql`:
   - `writeoff_amount NUMERIC(15,2)`
   - `writeoff_by INTEGER`
   - `writeoff_date DATE`
   - `writeoff_notes TEXT`
   - These were the old write-off columns. Migration 002a migrated data to `bill_writeoffs`. Columns to be dropped manually (Issue #10) after verifying data integrity.

3. **`gst_rates_master` on prod has orphan `rate_name` column** not in `schema.sql`. App normalises field names in controller — both `description` and `rate_name` are accepted and mapped to `description` column.

4. **Activity log entry**: `WRITE_OFF_BILL` action has `entity_type = "bill"` (lowercase) in prod data — should be `"BILL"` (uppercase) to be consistent with all other entries.

---

## Known Issues Table (All Pending)

| # | Issue | Severity | Type | Tables/Files | Status |
|---|---|---|---|---|---|
| 1 | Duplicate `bill_prefix` on 2 companies (ID 3 & 4, both `URJ`) — blocks migration 001 | 🔴 High | Data + DB | `header_master` | ❌ Pending — blocked until multi-bank feature is built |
| 2 | Migration 001 — unique index on `bill_prefix` not yet applied | 🔴 High | DB | `header_master` | ❌ Blocked by #1 |
| 3 | Delete DRAFT bill failing — root cause not confirmed yet | 🔴 High | App + DB | `bills`, `bill_merges`, `bill_payments` | ❌ Needs error message from user to diagnose |
| 4 | `deleteHeader` checks `bills.header_id` but misses `bills.override_header_id` FK | 🟠 Medium | App + DB | `bills`, `header_master` | ❌ Pending |
| 5 | Broken `update_bill_payment_status_on_delete` trigger on prod — missing `last_payment_date` | 🟠 Medium | DB | `bill_payments`, `bills` | ❌ Migration 003 not run on prod |
| 6 | Migration 004 — zero-value finalize guard not yet applied on prod | 🟠 Medium | DB | `bills` | ❌ Pending |
| 7 | Migration 005 — duplicate trigger + dead `bill_number_sequence` table not cleaned up | 🟠 Medium | DB | `bill_payments`, `bill_number_sequence` | ❌ Pending |
| 8 | `gst_rates_master` has orphan `rate_name` column on prod not in schema | 🟡 Low | DB | `gst_rates_master` | ❌ Pending |
| 9 | Finalized bills can be deleted by anyone — no status guard in `deleteBill` | 🟡 Low | App | `bills` | ❌ Pending |
| 10 | DROP old write-off columns from `bills` after data verified | 🟡 Low | DB | `bills` | ❌ Hold until confirmed |
| 11 | `WRITE_OFF_BILL` activity log has `entity_type = "bill"` (lowercase) — inconsistent | 🟡 Low | App | `activity_log` | ❌ Pending |

---

## Issue Detail Notes

### Issue #3 — Delete DRAFT bill failing
**Most likely candidates** (in order of probability):
- `bill_merges.source_bill_id` has a RESTRICT FK on `bills(id)`. If the bill was ever involved in a merge/unmerge cycle, a `bill_merges` row may still reference it. `deleteBill` deletes `bill_payments` and `bill_services` but does NOT delete from `bill_merges` or `bill_history` before deleting the bill.
- The duplicate trigger (Issue #7) firing twice causing unexpected state.
- Need the actual error message from the server to confirm.

**Current `deleteBill` code** (relevant section):
```js
await client.query('DELETE FROM bill_payments WHERE bill_id = $1', [id]);
await client.query('DELETE FROM bill_services WHERE bill_id = $1', [id]);
await client.query('DELETE FROM bills WHERE id = $1', [id]);
// MISSING: DELETE FROM bill_merges WHERE source_bill_id = $1 (or merged_bill_id)
// MISSING: DELETE FROM bill_history WHERE bill_id = $1
// MISSING: Status check — any user can delete any bill including FINALIZED
```

### Issue #4 — deleteHeader misses override_header_id FK
**Current `deleteHeader` code**:
```js
const billCheck = await query(
  'SELECT COUNT(*) AS cnt FROM bills WHERE header_id = $1',
  [id]
);
// BUG: Does NOT check: SELECT COUNT(*) FROM bills WHERE override_header_id = $1
// If override_header_id FK is ON DELETE RESTRICT, delete will fail at DB level
// with a cryptic FK violation error instead of a friendly message
```

### Issue #5 — Broken delete trigger on prod
The prod version of `update_bill_payment_status_on_delete` does NOT update `last_payment_date` when a payment is deleted. This means if a user deletes the most recent payment, the `last_payment_date` on the bill stays stale showing the old date.
Fix: Run `migrations/003_fix_delete_trigger.sql` on prod.

### Issue #9 — No status guard in deleteBill
**Current code**: Any authenticated user can call `DELETE /api/bills/:id` regardless of bill status. There is no role check on the route and no status check in the controller.
**Risk**: A regular user can delete a FINALIZED bill that has payments recorded against it.
**Fix needed**: Check `status` — if `FINALIZED`, only `SUPERADMIN` can delete (and should probably require extra confirmation).

### Issue #11 — Write-off entity_type casing
**In `writeOffBill` controller** (line ~1790):
```js
logActivity({
  performedBy: userId,
  action: 'WRITE_OFF_BILL',
  entityType: 'BILL',   // ← This is CORRECT in current code
  ...
});
```
The inconsistency was found in the prod activity log data from `backup.sql` — a historical entry had `entity_type = "bill"` (lowercase). The current code has it uppercase. The prod data entry is a one-off legacy record; no code fix needed, but the prod data row may need a manual UPDATE if reporting queries filter by `entity_type`.

---

## Multi-Bank Account Feature (Work In Progress — Next Priority After Issue #1/#2)

### Background
The system currently has a 1:1 relationship between `header_master` and `header_bank_details`. The user wants to support multiple bank accounts per company. When creating/editing a bill, the user should be able to choose which bank account to associate with that bill.

### Agreed Design Decisions
1. Each bill always has exactly 1 bank account (stored as FK on `bills`).
2. The bank account on a bill is changeable after finalization (SUPERADMIN override rules still apply for other fields).
3. When a company has multiple bank accounts and the user selects/changes that company on the bill form, a **popup appears** with radio buttons to select which account to use. Show: bank name, account number, account holder name.
4. When a company has only 1 bank account, auto-assign silently — no popup.
5. A **"Change" button** on the bank account card at the bottom of the bill form (for same-company account switching without changing the company).
6. Cannot delete a bank account if any bill (DRAFT or FINALIZED) references it — must reassign first.
7. The bank account card belongs at the bottom of the bill form (currently absent — bank account is fully server-side and not shown on form at all).

### DB Changes Needed (Migration 006 — NOT YET WRITTEN)
```sql
-- Step 1: Drop UNIQUE constraint on header_bank_details.header_id
-- (currently 1:1 enforced at DB level)
ALTER TABLE header_bank_details DROP CONSTRAINT IF EXISTS header_bank_details_header_id_key;

-- Step 2: Add new columns to header_bank_details
ALTER TABLE header_bank_details
    ADD COLUMN IF NOT EXISTS nick_name   VARCHAR(100),      -- e.g. "HDFC Current", "SBI Savings"
    ADD COLUMN IF NOT EXISTS is_primary  BOOLEAN NOT NULL DEFAULT false;

-- Step 3: Mark all existing rows as primary (they were the only account per company)
UPDATE header_bank_details SET is_primary = true;

-- Step 4: Add bank_account_id FK to bills table
ALTER TABLE bills ADD COLUMN IF NOT EXISTS bank_account_id INTEGER REFERENCES header_bank_details(id);

-- Step 5: Backfill bank_account_id on all existing bills
UPDATE bills b
SET bank_account_id = (
    SELECT hbd.id FROM header_bank_details hbd WHERE hbd.header_id = b.header_id LIMIT 1
)
WHERE bank_account_id IS NULL;

-- Step 6: Add NOT NULL constraint after backfill
ALTER TABLE bills ALTER COLUMN bank_account_id SET NOT NULL;

-- Step 7: Add index
CREATE INDEX IF NOT EXISTS idx_bills_bank_account_id ON bills (bank_account_id);
```

### Backend Changes Needed (NOT YET CODED)
- `masterController.js`:
  - `updateHeaderDetails`: The current `ON CONFLICT (header_id) DO UPDATE` upsert will break once UNIQUE constraint on `header_id` is dropped. Needs rework.
  - New endpoints needed: `POST /api/masters/headers/:id/bank-accounts`, `PUT /api/masters/headers/:id/bank-accounts/:bankId`, `DELETE /api/masters/headers/:id/bank-accounts/:bankId`
  - `deleteHeader`: Add guard for `bank_account_id` FK on `bills`
- `billController.js`:
  - `createBill`: Accept `bank_account_id` in request body; validate it belongs to the selected `header_id`; NOT NULL required
  - `updateBill`: Allow changing `bank_account_id`; same validation

### Frontend Changes Needed (NOT YET CODED)
- `ServicesFormPage.jsx`:
  - Add `bank_account_id` to `formData` state
  - Fetch bank accounts for selected company on company change
  - If company has >1 account → show selection popup (radio buttons)
  - If company has 1 account → auto-select silently
  - Bank account card at bottom of form with "Change" button
  - Send `bank_account_id` in `createBill` and `updateBill` payloads
- `MastersPage.jsx`:
  - Company edit modal: replace single bank section with multi-bank management UI
  - Option B preferred: bank accounts listed within the edit modal with +Add, edit, delete per account

---

## Key File Locations

```
backend/
  controllers/
    masterController.js     — Company, bank, particulars, GST, payment terms CRUD
    billController.js       — Bills CRUD, finalize, delete, write-off, merge
    activityLogController.js
  routes/
    masterRoutes.js         — /api/masters/* routes
    billRoutes.js           — /api/bills/* routes
  middleware/
    auth.js                 — JWT auth + authorize(role) middleware
  config/
    database.js             — pg pool + query helper

frontend/src/
  pages/
    ServicesFormPage.jsx    — Bill create/edit form (NO bank account UI currently)
    MastersPage.jsx         — Master data management (company, clients, etc.)
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

schema.sql                  — Local DB schema (reference)
backup.sql                  — Prod DB dump (PostgreSQL 17.9)
```

---

## Current State of ServicesFormPage.jsx (bill form)

- `formData` state: `{ header_id, bill_date, payment_term_id, client_id, notes }` — NO `bank_account_id`
- `loadMasterData` fetches: headers, particulars, clients, gstRates, paymentTerms — NO bank accounts
- Company dropdown `onChange` is plain `setFormData` — no popup trigger
- No bank account card/section anywhere in JSX (entirely server-side)
- `handleSubmit` (create): sends `{ header_id, bill_date, payment_term_id, client_id, notes, services }` — NO bank_account_id
- `handleSubmit` (update): sends `{ bill_date, payment_term_id, client_id, notes, services }` — NO bank_account_id
- Edit mode: company dropdown is `disabled` (cannot change company on existing bill)
- Permission model: regular users edit DRAFT only; SUPERADMIN uses `override_edit` flag for finalized bills

## Current State of MastersPage.jsx (company master)

- Company list table: shows ID, Company Name, Proprietor, GSTIN, Phone, Edit/Delete buttons
- `handleEdit` for company: calls `getHeaderById`, flattens `bank_details` object into editing item (works for 1:1, will break for 1:many)
- Company edit modal: one "Bank Details" section with 5 flat inputs (bank_name, account_holder_name, account_number, ifsc_code, branch_name)
- `handleSubmit` for company: calls `masterAPI.updateHeader(id, companyData)` with all fields merged — single call for both company details and bank account

---

## Questions Pending Before Coding Multi-Bank Feature

1. **"Change" button**: Confirmed — small "Change" button/link next to bank account card at bottom of bill form for same-company account switching. Waiting on user confirmation.
2. **Company master bank account UI**: Two options proposed:
   - **Option A**: Keep company edit modal for company details only; add separate bank accounts section below company table.
   - **Option B**: Within company edit modal, add "Bank Accounts" tab/section listing all accounts with +Add, edit inline, delete per account, one marked as primary.
   - Waiting on user choice.
