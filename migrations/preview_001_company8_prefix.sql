-- ============================================================
-- PREVIEW 001: Company 8 prefix fix — rows that WILL change
-- No data is modified by this script.
-- ============================================================

-- 1. Company record that will be updated
SELECT 'header_master will change' AS preview,
       id,
       company_name,
       bill_prefix AS current_prefix,
       'CAR' AS new_prefix
FROM header_master
WHERE id = 8;

-- 2. Bill number that will be renamed
SELECT 'bills will change' AS preview,
       id,
       bill_no AS current_bill_no,
       'CAR/2627/001' AS new_bill_no,
       status,
       header_id
FROM bills
WHERE id = 58;

-- 3. Counter that will be updated
SELECT 'bill_number_counters will change' AS preview,
       id,
       header_id,
       financial_year,
       prefix AS current_prefix,
       'CAR' AS new_prefix,
       last_number
FROM bill_number_counters
WHERE header_id = 8;
