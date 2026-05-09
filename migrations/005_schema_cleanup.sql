-- Migration 005: Schema cleanup
-- Three changes:
--   A. Sync clients_master.pan (column already exists in live DB, formalising it with a CHECK)
--   B. Drop the duplicate INSERT trigger on bill_payments
--   C. Drop the dead bill_number_sequence table
--
-- Run once:
--   psql -U postgres -d CA_FIRM -f migrations/005_schema_cleanup.sql

-- ----------------------------------------------------------------
-- A. clients_master.pan
-- The column was added directly to the live DB without a migration.
-- This makes it official and adds format validation.
-- ADD COLUMN IF NOT EXISTS is safe to run even though the column already exists.
-- ----------------------------------------------------------------
ALTER TABLE clients_master
    ADD COLUMN IF NOT EXISTS pan VARCHAR(10);

-- Add format check only if it doesn't already exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pan_format_check'
          AND conrelid = 'clients_master'::regclass
    ) THEN
        ALTER TABLE clients_master
            ADD CONSTRAINT pan_format_check
            CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]{1}$');
    END IF;
END $$;


-- ----------------------------------------------------------------
-- B. Drop duplicate trigger on bill_payments
-- update_payment_status_on_insert fired AFTER INSERT only.
-- trigger_update_bill_payment_status fires AFTER INSERT OR UPDATE OR DELETE.
-- Having both caused update_bill_payment_status() to run twice on every payment insert.
-- trigger_update_bill_payment_status is the one to keep — it covers all events.
-- ----------------------------------------------------------------
DROP TRIGGER IF EXISTS update_payment_status_on_insert ON bill_payments;


-- ----------------------------------------------------------------
-- C. Drop dead bill_number_sequence table
-- Never referenced in application code. The active counter table is
-- bill_number_counters (keyed per company per financial year).
-- ----------------------------------------------------------------
DROP TABLE IF EXISTS bill_number_sequence;
