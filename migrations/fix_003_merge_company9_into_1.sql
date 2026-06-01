-- ============================================================
-- FIX 003: Merge Company 9 (MANOJ S DISA AND CO duplicate) into Company 1
-- ============================================================
--
-- REASON:
--   Company 9 (MANOJ S DISA AND CO, prefix MAN, id=9) was created as a workaround
--   when the system only allowed 1 bank account per company.
--   Company 1 (MANOJ S DISA AND CO, prefix MSD, id=1) is the correct/primary record.
--   Company 9 has a DIFFERENT bank account from Company 1:
--     Company 1: HDFC Bank, account 50200002663828 (hbd.id=1) — PRIMARY
--     Company 9: DHULE VIKAS SAHAKARI BANK, account 01021001652 (hbd.id=11) — becomes 2nd account
--
-- DATA THAT WILL CHANGE:
--
--   header_bank_details (id=11, currently header_id=9):
--     header_id: 9 → 1  (bank account moves to company 1)
--     is_primary: false  (company 1 already has a primary — HDFC stays primary)
--     (no bills reference this bank account so no cascade effects)
--
--   header_master (id=9):
--     DELETED — the duplicate MANOJ S DISA AND CO company
--
-- NOTE: Company 9 has NO bills at all — nothing to reassign.
--
-- ROWS AFFECTED: 1 bank record updated, 1 company deleted
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
WHERE id = 9;

SELECT 'header_bank_details will change (header_id 9→1, is_primary false)' AS preview,
       id,
       header_id AS current_header_id,
       1 AS new_header_id,
       bank_name,
       account_number,
       ifsc_code,
       is_primary AS current_is_primary,
       false AS new_is_primary
FROM header_bank_details
WHERE id = 11;

SELECT 'bills under company 9 (should be empty)' AS preview,
       id, bill_no, status
FROM bills
WHERE header_id = 9;

SELECT 'company 1 bank accounts AFTER merge (preview)' AS preview,
       id,
       bank_name,
       account_number,
       is_primary
FROM header_bank_details
WHERE header_id IN (1, 9)
ORDER BY header_id, is_primary DESC;

-- ============================================================
-- APPLY CHANGES
-- ============================================================

BEGIN;

-- Step 1: Move company 9's bank account to company 1 as a second (non-primary) account
UPDATE header_bank_details
SET header_id  = 1,
    is_primary = false
WHERE id = 11;

-- Step 2: Delete the duplicate company
DELETE FROM header_master
WHERE id = 9;

-- Verify: company 9 gone, company 1 now has 2 bank accounts
SELECT 'Remaining companies' AS check_name,
       id, company_name, bill_prefix
FROM header_master
ORDER BY id;

SELECT 'Bank accounts for company 1' AS check_name,
       id, bank_name, account_number, is_primary
FROM header_bank_details
WHERE header_id = 1
ORDER BY is_primary DESC;

COMMIT;
