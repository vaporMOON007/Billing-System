-- ============================================================
-- MIGRATION 007: Enforce username NOT NULL on users table
-- ============================================================
--
-- REASON:
--   The username column is currently nullable, which causes issues with login
--   (login is username-based) and the new password reset flow (users are
--   identified by username). Any user without a username would be unreachable.
--
-- WHAT THIS DOES:
--   1. Preview: shows any users currently missing a username
--   2. Adds NOT NULL constraint to users.username
--
-- SAFE TO RUN: Will FAIL if any user row has username = NULL.
--   If it fails, manually set usernames for those rows first, then re-run.
-- ============================================================

-- ── PREVIEW: check for NULL usernames before applying ──────────────────────
SELECT 'Users with NULL username (must be fixed before migration runs)' AS warning,
       id, full_name, email, role, created_at
FROM users
WHERE username IS NULL;

-- ── APPLY ──────────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE users
  ALTER COLUMN username SET NOT NULL;

-- Verify
SELECT 'username column is_nullable after migration (should be NO)' AS check_name,
       is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'users'
  AND column_name  = 'username';

COMMIT;
