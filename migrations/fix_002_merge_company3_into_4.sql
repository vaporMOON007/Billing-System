-- ============================================================
-- FIX 002: Merge Company 3 (URJA COMPUTERS duplicate) into Company 4
-- ============================================================
--
-- REASON:
--   Company 3 (URJA COMPUTERS, prefix URJ, id=3) was created as a workaround
--   when the system only allowed 1 bank account per company.
--   Company 4 (URJA COMPUTERS, prefix URJ, id=4) is the correct/primary record.
--   Both companies share the same prefix URJ which causes bill number conflicts.
--   Company 3 and Company 4 also have the EXACT SAME bank account
--   (HDFC Bank, account 06371930006766) — it was entered twice.
--
-- DATA THAT WILL CHANGE:
--
--   bill_payments (~4 rows):
--     received_in_account_id: 4 (company 3's bank hbd.id=4) → 5 (company 4's bank hbd.id=5)
--     (same physical bank account — just updating the reference to company 4's record)
--
--   bills (~10 rows where header_id=3):
--     header_id: 3 → 4
--     bank_account_id: 4 → 5 (same physical account, updating to company 4's record)
--     Affected bill numbers: URJ/2526/001, URJ/2526/002, URJ/2526/003,
--                            URJ/2526/005 and all DRAFT bills under company 3
--
--   bill_number_counters (id=10, header_id=3, FY=2526, last_number=5):
--     header_id: 3 → 4
--     (company 4 has no 2025-26 counter yet so no conflict)
--
--   header_bank_details (id=4, header_id=3):
--     DELETED — duplicate of company 4's bank account (id=5, same account number)
--
--   header_master (id=3):
--     DELETED — the duplicate URJA COMPUTERS company
--
-- ROWS AFFECTED: ~4 bill_payments, ~10 bills, 1 counter, 1 bank record, 1 company
-- ============================================================

-- ============================================================
-- PREVIEW — rows that will change (no data modified here)
-- ============================================================

SELECT 'header_master will be DELETED' AS preview,
       id,
       company_name,
       bill_prefix,
       is_active
FROM header_master
WHERE id = 3;

SELECT 'header_bank_details will be DELETED' AS preview,
       id,
       header_id,
       bank_name,
       account_number,
       ifsc_code
FROM header_bank_details
WHERE id = 4;

SELECT 'bills will change (header_id 3→4, bank_account_id 4→5)' AS preview,
       id,
       bill_no,
       status,
       header_id AS current_header_id,
       4 AS new_header_id,
       bank_account_id AS current_bank_account_id,
       5 AS new_bank_account_id
FROM bills
WHERE header_id = 3
ORDER BY id;

SELECT 'bill_payments will change (received_in_account_id 4→5)' AS preview,
       bp.id,
       bp.bill_id,
       bp.payment_date,
       bp.amount_paid,
       bp.received_in_account_id AS current_account_id,
       5 AS new_account_id
FROM bill_payments bp
WHERE bp.received_in_account_id = 4;

SELECT 'bill_number_counters will change (header_id 3→4)' AS preview,
       id,
       header_id AS current_header_id,
       4 AS new_header_id,
       financial_year,
       prefix,
       last_number
FROM bill_number_counters
WHERE header_id = 3;

-- ============================================================
-- APPLY CHANGES
-- ============================================================

BEGIN;

-- Step 1: Update bill_payments that recorded into company 3's bank account
--         Remap to company 4's bank account (same physical account, different hbd.id)
UPDATE bill_payments
SET received_in_account_id = 5
WHERE received_in_account_id = 4;

-- Step 2: Reassign all bills from company 3 → company 4
--         Also update bank_account_id since company 3's bank (hbd.id=4) will be deleted
UPDATE bills
SET header_id       = 4,
    bank_account_id = 5,
    updated_at      = CURRENT_TIMESTAMP
WHERE header_id = 3;

-- Step 3: Move company 3's bill_number_counter to company 4
--         (FY 2526, last_number=5 — company 4 has no 2526 counter so no conflict)
UPDATE bill_number_counters
SET header_id = 4
WHERE header_id = 3;

-- Step 4: Delete company 3's bank account
--         (duplicate of company 4's — same HDFC account 06371930006766)
DELETE FROM header_bank_details
WHERE id = 4;

-- Step 5: Delete the duplicate company
DELETE FROM header_master
WHERE id = 3;

-- Verify: company 3 should be gone, all its bills now under company 4
SELECT 'Remaining companies' AS check_name,
       id, company_name, bill_prefix
FROM header_master
ORDER BY id;

SELECT 'Bills now under company 4' AS check_name,
       COUNT(*) AS bill_count
FROM bills
WHERE header_id = 4;

SELECT 'Company 3 bills remaining (should be 0)' AS check_name,
       COUNT(*) AS bill_count
FROM bills
WHERE header_id = 3;

COMMIT;
