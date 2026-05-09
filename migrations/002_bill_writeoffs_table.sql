-- Migration 002: Create bill_writeoffs table
-- Replaces the non-existent writeoff_* columns on the bills table with a
-- proper child table that supports multiple write-off entries per bill
-- and gives a full audit trail.
--
-- Run once:
--   psql -U postgres -d CA_FIRM -f migrations/002_bill_writeoffs_table.sql

CREATE TABLE IF NOT EXISTS bill_writeoffs (
    id               SERIAL PRIMARY KEY,
    bill_id          INTEGER      NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    writeoff_amount  NUMERIC(15,2) NOT NULL CHECK (writeoff_amount > 0),
    written_off_by   INTEGER      NOT NULL REFERENCES users(id),
    writeoff_date    DATE         NOT NULL DEFAULT CURRENT_DATE,
    notes            TEXT,
    created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bill_writeoffs_bill_id ON bill_writeoffs (bill_id);

COMMENT ON TABLE  bill_writeoffs                   IS 'Audit trail of write-offs applied to partially paid finalized bills';
COMMENT ON COLUMN bill_writeoffs.writeoff_amount   IS 'Amount written off (remaining balance at time of write-off)';
COMMENT ON COLUMN bill_writeoffs.written_off_by    IS 'User ID of the SUPERADMIN who applied the write-off';
