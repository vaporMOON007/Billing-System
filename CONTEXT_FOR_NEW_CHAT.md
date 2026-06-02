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
- **Edit Locks** (`bills.lock_held_by`, `bills.lock_expires_at`): DB-backed edit locks on the `bills` table (migration 009). Prevents two users editing the same bill simultaneously. Survives server restarts.
- **Password Reset Requests** (`password_reset_requests`): Table for CA/EMPLOYEE self-service password reset flow. User submits request with desired new password (bcrypt hashed), SUPERADMIN approves/rejects. Expires after 12 hours.

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
| `001_unique_bill_prefix.sql` | Unique index on `UPPER(bill_prefix)` | ✅ Done | ❌ Not yet |
| `002a_migrate_writeoff_data.sql` | Migrate write-off data to `bill_writeoffs` table | ✅ Done | ✅ Done |
| `002_bill_writeoffs_table.sql` | Create `bill_writeoffs` table | ✅ Done | ✅ Done |
| `003_fix_delete_trigger.sql` | Fix broken delete trigger (adds `last_payment_date`) | ✅ Done | ❌ Not yet |
| `004_finalize_zero_value_guard.sql` | CHECK constraint: finalized bills must have value > 0 | ✅ Done | ❌ Not yet |
| `005_schema_cleanup.sql` | Drop duplicate trigger + dead `bill_number_sequence` table | ✅ Done | ❌ Not yet |
| `006_multi_bank_accounts.sql` | Multi-bank support | ✅ Done | ❌ Not yet |
| `007_users_username_not_null.sql` | Enforce `username NOT NULL` on users table | ✅ Done | ❌ Not yet |
| `008_password_reset_requests.sql` | Create `password_reset_requests` table | ✅ Done | ❌ Not yet |
| `009_bill_edit_locks.sql` | Add `lock_held_by` + `lock_expires_at` to `bills` | ✅ Done | ❌ Not yet |
| `fix_001_company8_prefix.sql` | Fix Company 8 prefix `CA.`/`CA ` → `CAR` | ✅ Done | ❌ Not yet |
| `fix_002_merge_company3_into_4.sql` | Merge duplicate URJA COMPUTERS (ID 3) into ID 4 | ✅ Done | ❌ Not yet |
| `fix_003_merge_company9_into_1.sql` | Merge duplicate MANOJ S DISA (ID 9) into ID 1 | ✅ Done | ❌ Not yet |

### Migration 006 — Important Notes
1. **Step A0**: Drops `bill_payments_received_in_account_id_fkey` before dropping UNIQUE constraint on `header_bank_details.header_id`
2. **Step H0**: Remaps `bill_payments.received_in_account_id` from `header_id` values → actual `header_bank_details.id` values
3. **Step H**: Re-adds FK correctly pointing to `header_bank_details(id)` instead of `header_bank_details(header_id)`

---

## Company Master — Current State (Local — after all fixes)

| ID | Company Name | Prefix | Status |
|---|---|---|---|
| 1 | MANOJ S DISA AND CO | MSD | ✅ Has 2 bank accounts (HDFC primary + DHULE VIKAS secondary) |
| 4 | URJA COMPUTERS | URJ | ✅ Clean — ID 3 merged in |
| 8 | CA RISHIKESH N. SANGTANI | CAR | ✅ Prefix fixed |

IDs 3 and 9 were deleted after data fix scripts ran locally.

---

## Pending Infrastructure Fixes (Non-DB)

1. **JWT_SECRET** — Still placeholder value on prod. Must be changed to a random string in prod `.env`. All users will be logged out once changed.
2. **CORS_ORIGIN** — `.env` has `FRONTEND_URL` but `server.js` reads `CORS_ORIGIN`. Rename to `CORS_ORIGIN=http://192.168.1.105:3000` on prod, `CORS_ORIGIN=http://localhost:3000` on local.
3. **Frontend API URL** — Verify frontend is not hardcoding `localhost:5000` for API calls. Users on other devices will fail if it is.
4. **Frontend build** — `npm run dev` running in production. Should be `npm run build` + static file serving.
5. **Process manager** — No crash recovery. Replace `start.py` logic with PM2.

---

## Features Completed This Session (02 Jun 2026)

### Password Reset Flow (new feature)
- CA/EMPLOYEE submits a reset request with their desired new password (bcrypt-hashed at submission)
- SUPERADMIN sees pending requests in User Management → Password Resets tab
- Navbar badge shows count of pending reset requests (polls every 2 min)
- SUPERADMIN approves → password updated. Rejects → user re-submits
- Requests expire after 12 hours if not actioned
- On successful login with old password → pending request auto-cancelled
- Disabled/unapproved accounts blocked from submitting requests
- SUPERADMIN accounts cannot use this flow (they use direct DB update for recovery)
- `ResetPassword.jsx` fully rewritten, `ForgotPassword` link on login page

### SUPERADMIN Guard (min 2 active SUPERADMINs)
- Cannot demote or deactivate a SUPERADMIN if it would leave fewer than 2 active SUPERADMINs
- Enforced in `authController.js` `updateUser`

### Bill Delete Guards
- `DELETE /api/bills/:id` now restricted to CA+ (no EMPLOYEE)
- FINALIZED/ABSORBED bills — SUPERADMIN only
- Any bill with payments recorded — blocked entirely (must remove payments first)
- Delete confirmation modal shows bill number with Copy button; DRAFT bills require typing "DELETE"

### DB-Backed Edit Locks (migration 009)
- Locks moved from in-memory Map to `bills.lock_held_by` + `bills.lock_expires_at` columns
- Survives server restarts
- Lazy cleanup: expired locks overwritten on acquire
- `useEditLock.js` rewritten using `useEffect` + `useRef` to fix stale closure bug

### Excel Export Fix
- `exportBills` in `reportController.js` fixed — was querying non-existent `b.writeoff_amount`, `b.writeoff_date`, `b.writeoff_notes` columns on `bills` table (moved to `bill_writeoffs` in migration 002)
- Now uses `LATERAL JOIN` to `bill_writeoffs` with correct column `writeoff_amount`
- Export logic deduplicated into `frontend/src/utils/exportUtils.js` — used by both `Dashboard.jsx` and `ReportsPage.jsx`

### MarkPaymentModal Bank Account Fix
- Was sending `acc.header_id` (company ID) as `received_in_account_id` — now sends `acc.id` (correct bank account row ID)
- `getBankAccounts` query now returns `hbd.id`, `nick_name`, `is_primary`
- Dropdown label improved: shows company name, nick name, last 4 digits, marks primary

### authRoutes Route Ordering Fix
- `PUT /users/:id/approve` and `PUT /users/:id/reset-password` were registered AFTER `PUT /users/:id` — Express was shadowing them
- Specific routes now registered before the general `/:id` route

### Payment Delete Audit Logging
- `deletePayment` now fetches full payment details before deleting and logs `DELETE_PAYMENT` action with amount, mode, date, bill number

### updatePayment Overpay Validation
- Now checks bill total minus other payments before accepting new `amount_paid`
- Returns 400 if new amount would exceed remaining balance

### Other Bug Fixes
- `toast` import missing in `App.jsx` — fixed
- `register` endpoint no longer returns JWT to admin (impersonation risk)
- `logActivity` called with `userId:` instead of `performedBy:` in clientController bulk ops — fixed
- `createBill` null guard on `services` array — added before any DB insert
- `mergeBills` epoch date bug — null due dates now filtered before `Math.max`
- Raw PostgreSQL error messages stripped from all 500 responses in production (dev-only via `NODE_ENV`)
- INNER JOIN on `gst_rates_master` changed to LEFT JOIN — services with null GST rate no longer silently dropped from reports
- GSTIN/PAN regex consolidated: `backend/utils/validators.js` + `frontend/src/utils/helpers.js`
- Vite scaffold files `App.tsx` and `main.tsx` deleted
- Dead routes removed: `PATCH /headers/:id/prefix`, `GET /client-ledger`
- Dead api.js functions removed: `downloadBill`, `addServiceToBill`, `verifyUserForReset`, `resetPassword`
- Dead controller function `generateClientLedger` removed from `reportController.js`
- `getHeaderById` now returns full array of bank accounts (was `rows[0]` only)
- Company edit form bank fields removed — bank accounts managed via expandable section
- `ACTION_META` in `AuditLogPage.jsx` updated with missing entries: `APPROVE_USER`, `REJECT_USER`, `DELETE_CLIENT`, `DELETE_PAYMENT`, `APPROVE_PASSWORD_RESET`, `REJECT_PASSWORD_RESET`, `OVERRIDE_EDIT_PAYMENT`
- `AuthContext.jsx` dead token branch removed from `register()`
- Duplicate success animation in `ServicesFormPage.jsx` removed (kept `SuccessCheckmark`)
- `tfoot` column mismatch in `ServicesFormPage.jsx` fixed (was 10 cols vs 9-col thead)
- `onlyFinalized` toggle in `ReportsPage.jsx` now auto-refreshes data

---

## Key File Locations

```
backend/
  controllers/
    masterController.js
    billController.js
    authController.js
    paymentController.js
    reportController.js
    passwordResetController.js    ← NEW this session
    activityLogController.js
  routes/
    masterRoutes.js
    billRoutes.js
    authRoutes.js
    passwordResetRoutes.js        ← NEW this session
  middleware/
    auth.js
  config/
    database.js
  utils/
    validators.js                 ← NEW this session (GSTIN/PAN regex)

frontend/src/
  pages/
    ServicesFormPage.jsx
    MastersPage.jsx
    PrintBillPage.jsx
    UserManagementPage.jsx        ← Updated: Password Resets tab + badge
    AuditLogPage.jsx              ← Updated: ACTION_META entries added
    Dashboard.jsx
    ReportsPage.jsx
  components/
    auth/
      ResetPassword.jsx           ← REWRITTEN this session
      Login.jsx
    modals/
      MarkPaymentModal.jsx        ← Fixed: bank account ID bug
    layout/
      Navbar.jsx                  ← Updated: reset request badge
    common/Modal.jsx
  hooks/
    useEditLock.js                ← REWRITTEN this session
  services/
    api.js
  utils/
    helpers.js                    ← Updated: GSTIN/PAN regex added
    exportUtils.js                ← NEW this session (shared Excel export)
  context/
    AuthContext.jsx

migrations/
  001_unique_bill_prefix.sql
  002a_migrate_writeoff_data.sql
  002_bill_writeoffs_table.sql
  003_fix_delete_trigger.sql
  004_finalize_zero_value_guard.sql
  005_schema_cleanup.sql
  006_multi_bank_accounts.sql
  007_users_username_not_null.sql  ← NEW this session
  008_password_reset_requests.sql  ← NEW this session
  009_bill_edit_locks.sql          ← NEW this session
  fix_001_company8_prefix.sql
  fix_002_merge_company3_into_4.sql
  fix_003_merge_company9_into_1.sql

CONTEXT_FOR_NEW_CHAT.md  ← this file
backup_prod.sql           ← prod DB dump (taken May 2026)
```

---

## Known Remaining Issues

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | Delete DRAFT bill failing on prod | 🔴 High | ❌ Need actual error message from prod server |
| 2 | Old write-off columns on `bills` table on prod | 🟡 Low | ❌ Verify then drop |
| 3 | One `WRITE_OFF_BILL` activity log row has lowercase `entity_type` | 🟡 Low | ❌ One SQL UPDATE needed |
| 4 | Orphan `rate_name` column in `gst_rates_master` on prod | 🟡 Low | ❌ No functional impact |

---

## Next Steps (In Order)

### Step 1 — Take a fresh prod DB backup FIRST
Before touching prod, always take a backup. Run on prod server:
```cmd
pg_dump -U postgres -d "Billing" -F c -f "C:\Users\Administrator\Desktop\Billing-System\backup_prod_before_migrations.sql"
```
Keep this backup safe. If anything goes wrong mid-migration you can restore from it.

---

### Step 2 — Copy updated code files to prod server
Copy everything from local `C:\Users\jatsh\Desktop\Billing-System` to prod `C:\Users\Administrator\Desktop\Billing-System`:
- `backend/` — all controller, route, utils, middleware files
- `frontend/src/` — all pages, components, hooks, services, utils files
- `migrations/` — all migration + fix scripts (007, 008, 009, fix_001, fix_002, fix_003 are new)

Do NOT overwrite:
- `backend/.env` — prod has its own credentials
- `frontend/.env` — if it exists on prod

---

### Step 3 — Install backend dependencies on prod
```cmd
cd C:\Users\Administrator\Desktop\Billing-System\backend
npm install
```

---

### Step 4 — Run all pending migrations on prod IN ORDER
> **Note:** `002a` and `002` are already on prod (confirmed in the May 2026 backup — skip them).
> `001` is included below — it must run AFTER the data fix scripts or it will fail due to duplicate prefixes.
```cmd
psql -U postgres -d "Billing" -f "C:\Users\Administrator\Desktop\Billing-System\migrations\003_fix_delete_trigger.sql"
psql -U postgres -d "Billing" -f "C:\Users\Administrator\Desktop\Billing-System\migrations\004_finalize_zero_value_guard.sql"
psql -U postgres -d "Billing" -f "C:\Users\Administrator\Desktop\Billing-System\migrations\005_schema_cleanup.sql"
psql -U postgres -d "Billing" -f "C:\Users\Administrator\Desktop\Billing-System\migrations\006_multi_bank_accounts.sql"
psql -U postgres -d "Billing" -f "C:\Users\Administrator\Desktop\Billing-System\migrations\fix_001_company8_prefix.sql"
psql -U postgres -d "Billing" -f "C:\Users\Administrator\Desktop\Billing-System\migrations\fix_002_merge_company3_into_4.sql"
psql -U postgres -d "Billing" -f "C:\Users\Administrator\Desktop\Billing-System\migrations\fix_003_merge_company9_into_1.sql"
psql -U postgres -d "Billing" -f "C:\Users\Administrator\Desktop\Billing-System\migrations\001_unique_bill_prefix.sql"
psql -U postgres -d "Billing" -f "C:\Users\Administrator\Desktop\Billing-System\migrations\007_users_username_not_null.sql"
psql -U postgres -d "Billing" -f "C:\Users\Administrator\Desktop\Billing-System\migrations\008_password_reset_requests.sql"
psql -U postgres -d "Billing" -f "C:\Users\Administrator\Desktop\Billing-System\migrations\009_bill_edit_locks.sql"
```
After each migration, check the output for errors before running the next one.

---

### Step 5 — Restart the backend
```cmd
cd C:\Users\Administrator\Desktop\Billing-System\backend
node server.js
```
Or restart via Windows Task Scheduler / whatever process is running it.

---

### Step 6 — Smoke test on prod
- Log in as SUPERADMIN
- Create a DRAFT bill, finalize it, record a payment
- Check bank account dropdown in Mark Payment modal shows correct accounts
- Check User Management → Password Resets tab loads
- Check Audit Log shows readable action labels

---

### Remaining Issues (after prod deployment)
1. **Delete DRAFT bill failing on prod** — need actual error message from prod server logs
2. **Infrastructure** — JWT_SECRET, CORS_ORIGIN, npm run build instead of dev, PM2
