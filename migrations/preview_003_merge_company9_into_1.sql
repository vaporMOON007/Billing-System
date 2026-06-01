-- ============================================================
-- PREVIEW 003: Merge Company 9 into Company 1 — rows that WILL change
-- No data is modified by this script.
-- ============================================================

-- 1. The company being deleted
SELECT 'header_master will be DELETED' AS preview,
       id,
       company_name,
       bill_prefix,
       is_active
FROM header_master
WHERE id = 9;

-- 2. The bank account being moved from company 9 → company 1
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

-- 3. Confirm company 9 has no bills (should return 0 rows)
SELECT 'bills under company 9 (should be empty)' AS preview,
       id,
       bill_no,
       status
FROM bills
WHERE header_id = 9;

-- 4. Show what company 1 bank accounts will look like after merge
SELECT 'company 1 bank accounts AFTER merge (preview)' AS preview,
       id,
       bank_name,
       account_number,
       is_primary
FROM header_bank_details
WHERE header_id IN (1, 9)
ORDER BY header_id, is_primary DESC;
