const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { logActivity } = require('./activityLogController');

// ============================================================================
// SUBMIT RESET REQUEST (public — no auth required)
// POST /api/password-reset/request
// Body: { username, newPassword }
// ============================================================================
exports.submitRequest = async (req, res) => {
  try {
    const { username, newPassword } = req.body;

    if (!username || !username.trim()) {
      return res.status(400).json({ success: false, message: 'Username is required' });
    }
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    // Find user — intentionally no filter on is_active/is_approved yet
    const userResult = await query(
      'SELECT id, username, full_name, role, is_active, is_approved FROM users WHERE username = $1',
      [username.trim()]
    );

    // Generic message if username doesn't exist at all — prevents user enumeration
    if (userResult.rows.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'If this username exists, your request has been submitted. Please contact your administrator.'
      });
    }

    const user = userResult.rows[0];

    // Disabled account — reset won't help, they need reactivation first
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been disabled. Please contact your administrator to reactivate it.',
        code: 'ACCOUNT_DISABLED'
      });
    }

    // Pending approval — account not yet approved by admin
    if (!user.is_approved) {
      return res.status(403).json({
        success: false,
        message: 'Your account is still pending approval. Please contact your administrator.',
        code: 'ACCOUNT_PENDING'
      });
    }

    // SUPERADMIN cannot use this flow — they have a separate recovery path
    if (user.role === 'SUPERADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Super Admin accounts cannot use this reset flow. Contact another Super Admin directly.'
      });
    }

    // Block if there is already a PENDING non-expired request for this user
    const existingRequest = await query(
      `SELECT id FROM password_reset_requests
       WHERE user_id = $1 AND status = 'PENDING' AND expires_at > CURRENT_TIMESTAMP`,
      [user.id]
    );

    if (existingRequest.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'You already have a pending reset request. Please wait for your administrator to action it, or contact them directly.',
        code: 'PENDING_REQUEST_EXISTS'
      });
    }

    // Hash the new password — never store plain text
    const salt = await bcrypt.genSalt(10);
    const hashedNewPassword = await bcrypt.hash(newPassword, salt);

    // Insert request
    await query(
      `INSERT INTO password_reset_requests (user_id, hashed_new_password, status, expires_at)
       VALUES ($1, $2, 'PENDING', CURRENT_TIMESTAMP + INTERVAL '12 hours')`,
      [user.id, hashedNewPassword]
    );

    return res.status(200).json({
      success: true,
      message: 'Your reset request has been submitted. Please contact your administrator to approve it. Requests expire after 12 hours.'
    });

  } catch (error) {
    console.error('Submit reset request error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit request' });
  }
};

// ============================================================================
// GET REQUEST STATUS (public — no auth required)
// GET /api/password-reset/status?username=xxx
// Used by the ForgotPassword page to show pending/rejected state
// ============================================================================
exports.getStatus = async (req, res) => {
  try {
    const { username } = req.query;

    if (!username || !username.trim()) {
      return res.status(400).json({ success: false, message: 'Username is required' });
    }

    // Find user
    const userResult = await query(
      'SELECT id FROM users WHERE username = $1 AND is_approved = true AND is_active = true',
      [username.trim()]
    );

    // Return unknown if user not found — same generic response to prevent enumeration
    if (userResult.rows.length === 0) {
      return res.json({ success: true, status: 'NONE' });
    }

    const userId = userResult.rows[0].id;

    // Get the most recent request for this user
    const requestResult = await query(
      `SELECT status, expires_at, created_at
       FROM password_reset_requests
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (requestResult.rows.length === 0) {
      return res.json({ success: true, status: 'NONE' });
    }

    const req_row = requestResult.rows[0];

    // If PENDING but expired, treat as expired (not actionable)
    if (req_row.status === 'PENDING' && new Date(req_row.expires_at) < new Date()) {
      return res.json({ success: true, status: 'EXPIRED', expires_at: req_row.expires_at });
    }

    return res.json({
      success: true,
      status: req_row.status,
      expires_at: req_row.expires_at,
      created_at: req_row.created_at
    });

  } catch (error) {
    console.error('Get reset status error:', error);
    res.status(500).json({ success: false, message: 'Failed to get status' });
  }
};

// ============================================================================
// GET PENDING REQUESTS (SUPERADMIN only)
// GET /api/password-reset/pending
// Returns all non-expired PENDING requests with user details
// ============================================================================
exports.getPendingRequests = async (req, res) => {
  try {
    const result = await query(
      `SELECT
         prr.id,
         prr.user_id,
         prr.status,
         prr.expires_at,
         prr.created_at,
         u.username,
         u.full_name,
         u.role
       FROM password_reset_requests prr
       JOIN users u ON u.id = prr.user_id
       WHERE prr.status = 'PENDING'
         AND prr.expires_at > CURRENT_TIMESTAMP
       ORDER BY prr.created_at ASC`
    );

    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error('Get pending reset requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch reset requests' });
  }
};

// ============================================================================
// GET PENDING COUNT (SUPERADMIN only)
// GET /api/password-reset/pending-count
// Used by Navbar badge
// ============================================================================
exports.getPendingCount = async (req, res) => {
  try {
    const result = await query(
      `SELECT COUNT(*) AS count
       FROM password_reset_requests
       WHERE status = 'PENDING' AND expires_at > CURRENT_TIMESTAMP`
    );

    res.json({ success: true, count: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('Get reset request count error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch count' });
  }
};

// ============================================================================
// APPROVE REQUEST (SUPERADMIN only)
// PUT /api/password-reset/:id/approve
// Copies hashed_new_password → users.password_hash
// ============================================================================
exports.approveRequest = async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch the request — must be PENDING and not expired
    const requestResult = await query(
      `SELECT prr.id, prr.user_id, prr.hashed_new_password, prr.status, prr.expires_at,
              u.username, u.full_name
       FROM password_reset_requests prr
       JOIN users u ON u.id = prr.user_id
       WHERE prr.id = $1`,
      [id]
    );

    if (requestResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    const request = requestResult.rows[0];

    if (request.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: `Cannot approve — request is already ${request.status.toLowerCase()}`
      });
    }

    if (new Date(request.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'This request has expired. The user must submit a new request.'
      });
    }

    // Apply the hashed password to the user account
    await query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [request.hashed_new_password, request.user_id]
    );

    // Mark request as approved
    await query(
      `UPDATE password_reset_requests
       SET status = 'APPROVED', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = $1
       WHERE id = $2`,
      [req.user.id, id]
    );

    logActivity({
      performedBy: req.user.id,
      action: 'APPROVE_PASSWORD_RESET',
      entityType: 'USER',
      entityId: request.user_id,
      description: `Approved password reset request for user "${request.username}"`,
      metadata: { target_user_id: request.user_id, username: request.username, request_id: parseInt(id) }
    });

    res.json({ success: true, message: `Password reset approved for ${request.full_name}` });
  } catch (error) {
    console.error('Approve reset request error:', error);
    res.status(500).json({ success: false, message: 'Failed to approve request' });
  }
};

// ============================================================================
// REJECT REQUEST (SUPERADMIN only)
// PUT /api/password-reset/:id/reject
// ============================================================================
exports.rejectRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const requestResult = await query(
      `SELECT prr.id, prr.user_id, prr.status,
              u.username, u.full_name
       FROM password_reset_requests prr
       JOIN users u ON u.id = prr.user_id
       WHERE prr.id = $1`,
      [id]
    );

    if (requestResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    const request = requestResult.rows[0];

    if (request.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: `Cannot reject — request is already ${request.status.toLowerCase()}`
      });
    }

    await query(
      `UPDATE password_reset_requests
       SET status = 'REJECTED', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = $1
       WHERE id = $2`,
      [req.user.id, id]
    );

    logActivity({
      performedBy: req.user.id,
      action: 'REJECT_PASSWORD_RESET',
      entityType: 'USER',
      entityId: request.user_id,
      description: `Rejected password reset request for user "${request.username}"`,
      metadata: { target_user_id: request.user_id, username: request.username, request_id: parseInt(id) }
    });

    res.json({ success: true, message: `Password reset rejected for ${request.full_name}` });
  } catch (error) {
    console.error('Reject reset request error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject request' });
  }
};
