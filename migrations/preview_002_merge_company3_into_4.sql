-- ============================================================
-- PREVIEW 002: Merge Company 3 into Company 4 — rows that WILL change
-- No data is modified by this script.
-- ============================================================

-- 1. The company being deleted
SELECT 'header_master will be DELETED' AS preview,
       id,
       company_name,
       bill_prefix,
       is_active
FROM header_master
WHERE id = 3;

-- 2. The bank account being deleted (duplicate of company 4's account)
SELECT 'header_bank_details will be DELETED' AS preview,
       id,
       header_id,
       bank_name,
       account_number,
       ifsc_code
FROM header_bank_details
WHERE id = 4;

-- 3. Bills that will be reassigned from company 3 → company 4
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

-- 4. Bill payments where received_in_account_id will be remapped
SELECT 'bill_payments will change (received_in_account_id 4→5)' AS preview,
       bp.id,
       bp.bill_id,
       bp.payment_date,
       bp.amount_paid,
       bp.received_in_account_id AS current_account_id,
       5 AS new_account_id
FROM bill_payments bp
WHERE bp.received_in_account_id = 4;

-- 5. Counter row being moved to company 4
SELECT 'bill_number_counters will change (header_id 3→4)' AS preview,
       id,
       header_id AS current_header_id,
       4 AS new_header_id,
       financial_year,
       prefix,
       last_number
FROM bill_number_counters
WHERE header_id = 3;
