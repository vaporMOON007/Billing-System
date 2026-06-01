-- ============================================================
-- MIGRATION 009: Move edit locks from memory to bills table
-- ============================================================
--
-- REASON:
--   Edit locks were stored in a Node.js Map (in-memory).
--   On every server restart, all active locks were wiped —
--   allowing two users to edit the same bill simultaneously.
--
-- WHAT THIS DOES:
--   Adds two nullable columns to bills:
--     lock_held_by    — which user currently holds the edit lock
--     lock_expires_at — when the lock auto-expires (5 min from last refresh)
--
--   Both are NULL when a bill is unlocked (the default state).
--   ON DELETE SET NULL ensures locks are auto-cleared if the user is deleted.
--
-- NO DATA CHANGES — all existing bills remain unlocked (NULL).
-- ============================================================

BEGIN;

ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS lock_held_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lock_expires_at TIMESTAMP;

-- Index for fast lock lookup (acquire/check operations query by bill id + expiry)
CREATE INDEX IF NOT EXISTS idx_bills_lock
  ON bills (lock_held_by, lock_expires_at)
  WHERE lock_held_by IS NOT NULL;

-- Verify
SELECT 'lock columns added to bills' AS result,
       COUNT(*) FILTER (WHERE lock_held_by IS NOT NULL) AS currently_locked_bills
FROM bills;

COMMIT;
