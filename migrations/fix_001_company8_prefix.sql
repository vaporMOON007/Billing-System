-- ============================================================
-- FIX 001: Company 8 (CA RISHIKESH N. SANGTANI) Prefix Correction
-- ============================================================
--
-- REASON:
--   The bill prefix was entered as 'CA.' (with period) in bill_number_counters
--   and 'CA ' (with trailing space) in header_master.
--   The standard rule is first 3 alphabets = 'CAR'.
--   There is 1 finalized bill already created with number 'CA./2627/001'
--   which must also be corrected to 'CAR/2627/001'.
--
-- DATA THAT WILL CHANGE:
--
--   header_master (id=8):
--     bill_prefix: 'CA ' → 'CAR'
--
--   bills (id=58):
--     bill_no: 'CA./2627/001' → 'CAR/2627/001'
--
--   bill_number_counters (id=28):
--     prefix: 'CA.' → 'CAR'
--     (this ensures the next bill for this company generates CAR/2627/002)
--
-- ROWS AFFECTED: 3 rows across 3 tables
-- ============================================================

-- ============================================================
-- PREVIEW — rows that will change (no data modified here)
-- ============================================================

SELECT 'header_master will change' AS preview,
       id,
       company_name,
       bill_prefix AS current_prefix,
       'CAR' AS new_prefix
FROM header_master
WHERE id = 8;

SELECT 'bills will change' AS preview,
       id,
       bill_no AS current_bill_no,
       'CAR/2627/001' AS new_bill_no,
       status,
       header_id
FROM bills
WHERE id = 58;

SELECT 'bill_number_counters will change' AS preview,
       id,
       header_id,
       financial_year,
       prefix AS current_prefix,
       'CAR' AS new_prefix,
       last_number
FROM bill_number_counters
WHERE header_id = 8;

-- ============================================================
-- APPLY CHANGES
-- ============================================================

BEGIN;

-- 1. Fix prefix in company master
UPDATE header_master
SET bill_prefix = 'CAR',
    updated_at  = CURRENT_TIMESTAMP
WHERE id = 8;

-- 2. Fix the already-issued bill number
UPDATE bills
SET bill_no    = 'CAR/2627/001',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 58;

-- 3. Fix the counter so future bills generate CAR/... not CA./...
UPDATE bill_number_counters
SET prefix = 'CAR'
WHERE header_id = 8;

-- Verify
SELECT 'header_master' AS tbl, id, bill_prefix FROM header_master WHERE id = 8
UNION ALL
SELECT 'bills', id, bill_no FROM bills WHERE id = 58
UNION ALL
SELECT 'bill_number_counters', id, prefix FROM bill_number_counters WHERE header_id = 8;

COMMIT;
