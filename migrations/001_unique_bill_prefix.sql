-- Migration 001: Enforce uniqueness on header_master.bill_prefix
-- Run once against your live database:
--   psql -U postgres -d CA_FIRM -f migrations/001_unique_bill_prefix.sql
--
-- BEFORE running: make sure no two companies already share the same prefix.
-- Check with:
--   SELECT UPPER(bill_prefix), COUNT(*) FROM header_master
--   GROUP BY UPPER(bill_prefix) HAVING COUNT(*) > 1;
-- If any rows come back, resolve the duplicates first.

-- Case-insensitive unique index (faster than a constraint for UPPER() comparisons)
CREATE UNIQUE INDEX IF NOT EXISTS uidx_header_master_bill_prefix
    ON header_master (UPPER(bill_prefix));

-- Also update schema.sql comment for documentation purposes
COMMENT ON COLUMN header_master.bill_prefix IS
    'Invoice prefix (e.g. INV, SCA). Must be unique across all companies. '
    'Cannot be changed after the first finalized bill is created.';
