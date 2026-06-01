-- ============================================================
-- MIGRATION 008: Create password_reset_requests table
-- ============================================================
--
-- REASON:
--   Implements the new password reset flow where CA/EMPLOYEE users submit
--   a reset request (with their desired new password, bcrypt-hashed) which
--   a SUPERADMIN must approve. Requests expire after 12 hours if not actioned.
--
-- TABLE: password_reset_requests
--   id                  - primary key
--   user_id             - FK → users(id), the user requesting the reset
--   hashed_new_password - bcrypt hash of the desired new password (never plain text)
--   status              - PENDING | APPROVED | REJECTED
--   expires_at          - 12 hours from created_at; request is dead after this
--   created_at          - when the request was submitted
--   reviewed_at         - when SUPERADMIN actioned it (NULL if still pending)
--   reviewed_by         - FK → users(id), which SUPERADMIN approved/rejected (nullable)
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hashed_new_password   VARCHAR(255) NOT NULL,
  status                VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  expires_at            TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '12 hours'),
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at           TIMESTAMP,
  reviewed_by           INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Index for fast lookup of pending requests by user
CREATE INDEX IF NOT EXISTS idx_prr_user_status
  ON password_reset_requests (user_id, status);

-- Index for SUPERADMIN pending list (filter by status + expiry)
CREATE INDEX IF NOT EXISTS idx_prr_status_expires
  ON password_reset_requests (status, expires_at);

-- Verify
SELECT 'password_reset_requests table created' AS result,
       COUNT(*) AS existing_rows
FROM password_reset_requests;

COMMIT;
