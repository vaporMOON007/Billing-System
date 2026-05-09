-- Migration 004: Prevent finalizing zero-value bills at the DB level
-- App-level check in finalizeBill catches this first with a friendly message.
-- This constraint is the safety net for any future code path that bypasses the app.
--
--   psql -U postgres -d CA_FIRM -f migrations/004_finalize_zero_value_guard.sql

ALTER TABLE bills
    ADD CONSTRAINT chk_finalized_bill_has_value
    CHECK (
        status != 'FINALIZED'
        OR (total_invoice_value IS NOT NULL AND total_invoice_value > 0)
    );
