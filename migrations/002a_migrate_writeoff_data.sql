-- Migration 002a: Migrate write-off data from bills columns → bill_writeoffs table
-- Run this BEFORE migration 002 (which creates the bill_writeoffs table).
--
-- Order of execution on prod:
--   Step 1: psql -U postgres -d ca_firm -f migrations/002a_migrate_writeoff_data.sql
--   Step 2: psql -U postgres -d ca_firm -f migrations/002_bill_writeoffs_table.sql
--   Step 3: (Later, once confirmed) Run the DROP COLUMN block at the bottom manually.
--
-- What this does:
--   1. Creates bill_writeoffs table (with written_off_by nullable to handle edge cases)
--   2. Copies all existing write-off rows from bills.writeoff_* columns
--   3. Leaves the old columns in place — do NOT drop them until you've verified the data
--
-- Safe to run multiple times — uses ON CONFLICT DO NOTHING.

BEGIN;

-- ----------------------------------------------------------------
-- STEP 1: Create bill_writeoffs table
-- NOTE: written_off_by is nullable here (unlike migration 002's version)
-- because prod data may have writeoff_by = NULL for some rows.
-- The app-level constraint (SUPERADMIN only) enforces this at write time.
-- ----------------------------------------------------------------
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

COMMENT ON TABLE  bill_writeoffs                   IS 'Audit trail of write-offs applied to partially paid finalized bills';
COMMENT ON COLUMN bill_writeoffs.writeoff_amount   IS 'Amount written off (remaining balance at time of write-off)';
COMMENT ON COLUMN bill_writeoffs.written_off_by    IS 'User ID of the SUPERADMIN who applied the write-off (nullable for pre-migration rows)';

-- ----------------------------------------------------------------
-- STEP 2: Migrate existing write-off data from bills columns
-- Only migrates rows where writeoff_amount > 0
-- Skips any bill that already has a row in bill_writeoffs (idempotent)
-- ----------------------------------------------------------------
INSERT INTO bill_writeoffs (bill_id, writeoff_amount, written_off_by, writeoff_date, notes, created_at)
SELECT
    b.id,
    b.writeoff_amount,
    b.writeoff_by,                          -- may be NULL for old records
    COALESCE(b.writeoff_date, CURRENT_DATE), -- fallback if date is missing
    b.writeoff_notes,
    CURRENT_TIMESTAMP
FROM bills b
WHERE b.writeoff_amount IS NOT NULL
  AND b.writeoff_amount > 0
  AND NOT EXISTS (
      SELECT 1 FROM bill_writeoffs bw WHERE bw.bill_id = b.id
  );

-- ----------------------------------------------------------------
-- STEP 3: Verify — print what was migrated
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM bill_writeoffs;
    RAISE NOTICE '✓ bill_writeoffs now contains % row(s).', v_count;

    SELECT COUNT(*) INTO v_count
    FROM bills
    WHERE writeoff_amount > 0
      AND NOT EXISTS (SELECT 1 FROM bill_writeoffs bw WHERE bw.bill_id = bills.id);

    IF v_count > 0 THEN
        RAISE WARNING '⚠ % bill(s) with writeoff_amount > 0 still have no matching bill_writeoffs row. Investigate before proceeding.', v_count;
    ELSE
        RAISE NOTICE '✓ All write-off data successfully migrated. Safe to run migration 002.';
    END IF;
END $$;

COMMIT;

-- ================================================================
-- STEP 4 (MANUAL — run separately AFTER you have confirmed the data):
-- Drop the old write-off columns from bills.
--
-- DO NOT run this block now. Run it only after:
--   a) migration 002 has been applied
--   b) you have verified bill_writeoffs has all expected rows
--   c) the app is running correctly against the new table
--
-- ALTER TABLE bills
--     DROP COLUMN IF EXISTS writeoff_amount,
--     DROP COLUMN IF EXISTS writeoff_by,
--     DROP COLUMN IF EXISTS writeoff_date,
--     DROP COLUMN IF EXISTS writeoff_notes;
-- ================================================================
