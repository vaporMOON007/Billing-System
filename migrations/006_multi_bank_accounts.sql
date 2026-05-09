-- Migration 006: Multi-bank accounts per company
-- Changes:
--   A. Drop UNIQUE constraint on header_bank_details.header_id  (1:1 → 1:many)
--   B. Add nick_name and is_primary columns to header_bank_details
--   C. Mark all existing rows as is_primary = true (they were the only account)
--   D. Add bank_account_id FK column to bills
--   E. Backfill bank_account_id on all existing bills from header_bank_details
--   F. Set bank_account_id NOT NULL after backfill
--   G. Add index on bills.bank_account_id
--
-- Run order on prod:
--   psql -U postgres -d CA_FIRM -f migrations/006_multi_bank_accounts.sql
--
-- Safe to run multiple times — uses IF NOT EXISTS / IF EXISTS guards throughout.
-- Run inside a transaction so it rolls back cleanly on any failure.

BEGIN;

-- ----------------------------------------------------------------
-- A. Drop the UNIQUE constraint that enforces 1:1 (header_id unique)
-- The constraint name on schema.sql is: header_bank_details_header_id_key
-- (PostgreSQL auto-names UNIQUE constraints as <table>_<col>_key)
-- ----------------------------------------------------------------
ALTER TABLE header_bank_details
    DROP CONSTRAINT IF EXISTS header_bank_details_header_id_key;

-- ----------------------------------------------------------------
-- B. Add new columns
-- ----------------------------------------------------------------
ALTER TABLE header_bank_details
    ADD COLUMN IF NOT EXISTS nick_name  VARCHAR(100),
    ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

-- ----------------------------------------------------------------
-- C. Mark all existing rows as primary
-- They were the sole account per company — they stay primary.
-- ----------------------------------------------------------------
UPDATE header_bank_details SET is_primary = true WHERE is_primary = false;

-- ----------------------------------------------------------------
-- D. Add bank_account_id to bills (nullable first for backfill)
-- References header_bank_details(id) — NOT header_bank_details(header_id)
-- ON DELETE RESTRICT: cannot delete a bank account that has bills pointing at it
-- ----------------------------------------------------------------
ALTER TABLE bills
    ADD COLUMN IF NOT EXISTS bank_account_id INTEGER
        REFERENCES header_bank_details(id) ON DELETE RESTRICT;

-- ----------------------------------------------------------------
-- E. Backfill existing bills — pick the primary account for each company
-- If a company has no bank account row at all, bill stays NULL
-- (handled gracefully — NOT NULL is added after, only fails if there are
--  bills with no corresponding bank account at all, which would be a data issue)
-- ----------------------------------------------------------------
UPDATE bills b
SET bank_account_id = (
    SELECT hbd.id
    FROM header_bank_details hbd
    WHERE hbd.header_id = b.header_id
      AND hbd.is_primary = true
    LIMIT 1
)
WHERE b.bank_account_id IS NULL;

-- Verify: warn if any bills still have NULL bank_account_id after backfill
DO $$
DECLARE
    v_null_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_null_count FROM bills WHERE bank_account_id IS NULL;
    IF v_null_count > 0 THEN
        RAISE WARNING '⚠  % bill(s) could not be backfilled — their company has no bank account row in header_bank_details. Fix these manually before step F.', v_null_count;
    ELSE
        RAISE NOTICE '✓ All bills backfilled with bank_account_id. Safe to proceed.';
    END IF;
END $$;

-- ----------------------------------------------------------------
-- F. Now enforce NOT NULL
-- This will FAIL if any bills were not backfilled (see warning above).
-- Fix those bills manually first if needed.
-- ----------------------------------------------------------------
ALTER TABLE bills
    ALTER COLUMN bank_account_id SET NOT NULL;

-- ----------------------------------------------------------------
-- G. Index
-- ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_bills_bank_account_id ON bills (bank_account_id);

-- ----------------------------------------------------------------
-- Update schema comments
-- ----------------------------------------------------------------
COMMENT ON TABLE  header_bank_details              IS 'Bank accounts per company (1:many). One account marked is_primary per company.';
COMMENT ON COLUMN header_bank_details.is_primary   IS 'True for the default/primary account of a company. Only one should be true per header_id.';
COMMENT ON COLUMN header_bank_details.nick_name    IS 'Optional label to distinguish accounts, e.g. "HDFC Current", "SBI Savings"';
COMMENT ON COLUMN bills.bank_account_id            IS 'Which bank account of the company is printed on this bill (FK → header_bank_details.id)';

COMMIT;
