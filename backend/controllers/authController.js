const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const crypto = require('crypto');
const { logActivity } = require('./activityLogController');

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide username and password'
      });
    }

    // Check if user exists
    const result = await query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const user = result.rows[0];

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Block unapproved users (except SUPERADMIN — those are added manually and always approved)
    if (!user.is_approved) {
      return res.status(403).json({
        success: false,
        message: 'Your account is pending approval by an administrator.',
        code: 'PENDING_APPROVAL'
      });
    }

    // Generate token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          role: user.role
        },
        token
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
};

// @desc    Get user profile
// @route   GET /api/auth/profile
// @access  Private
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      'SELECT id, username, email, full_name, phone, role, created_at FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile',
      error: error.message
    });
  }
};

// @desc    Change password
// @route   POST /api/auth/change-password
// @access  Private
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Get user with current password
    const userResult = await query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = userResult.rows[0];

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    // Update password
    await query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newPasswordHash, userId]
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password',
      error: error.message
    });
  }
};

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
  try {
    const { username, email, password, full_name, phone, role } = req.body;

    // Validate required fields
    if (!username || !email || !password || !full_name || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    // Check if user already exists
    const existingUser = await query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Username or email already exists'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Determine if this is an admin-created user (authenticated request) or self-registration
    const isAdminCreate = !!req.user;

    // Security fix #26: self-registrants are always assigned STAFF role regardless of
    // what they send in the request body. Only authenticated admins may specify a role.
    const assignedRole = isAdminCreate ? (role || 'EMPLOYEE') : 'STAFF';

    // Insert new user — is_approved = true if created by admin, false if self-registered
    const result = await query(
      `INSERT INTO users (username, email, password_hash, full_name, phone, role, is_approved)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, username, email, full_name, phone, role, is_approved`,
      [username, email, passwordHash, full_name, phone, assignedRole, isAdminCreate]
    );

    const user = result.rows[0];

    // Log with best-effort: performedBy is the requesting user (if authenticated) or null (self-register)
    logActivity({
      performedBy: req.user?.id || null,
      action: 'CREATE_USER',
      entityType: 'USER',
      entityId: user.id,
      description: `Created user "${user.username}" with role ${user.role}${isAdminCreate ? ' (admin-created, auto-approved)' : ' (self-registered, pending approval)'}`,
      metadata: { new_user_id: user.id, username: user.username, role: user.role, is_approved: isAdminCreate },
    });

    // If admin is creating the user, return token so they can log in immediately
    if (isAdminCreate) {
      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      return res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: {
          user: { id: user.id, username: user.username, email: user.email, full_name: user.full_name, phone: user.phone, role: user.role },
          token
        }
      });
    }

    // Self-registration: do NOT return a token — account must be approved first
    res.status(201).json({
      success: true,
      message: 'Registration successful! Your account is pending approval by an administrator. You will be able to log in once approved.',
      pending_approval: true
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
};

// NOTE: Public self-service password reset removed (security issue #21/#22).
// Password resets are handled by authenticated CA/SUPERADMIN via
// PUT /api/auth/users/:id/reset-password  (adminResetPassword below).
// ============================================================================
// USER MANAGEMENT (CA only)
// ============================================================================

// @desc    Get all users
// @route   GET /api/auth/users
// @access  Private (CA only)
exports.getAllUsers = async (req, res) => {
  try {
    const result = await query(
      `SELECT id, username, email, full_name, phone, role, is_active, created_at
       FROM users
       WHERE is_approved = true
       ORDER BY created_at ASC`
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch users', error: error.message });
  }
};

// @desc    Update user (role, name, email, phone, active status)
// @route   PUT /api/auth/users/:id
// @access  Private (CA only)
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, phone, role, is_active } = req.body;

    if (parseInt(id) === req.user.id && is_active === false) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account.' });
    }

    const result = await query(
      `UPDATE users
       SET full_name  = COALESCE($1, full_name),
           email      = COALESCE($2, email),
           phone      = COALESCE($3, phone),
           role       = COALESCE($4, role),
           is_active  = COALESCE($5, is_active),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING id, username, email, full_name, phone, role, is_active`,
      [full_name, email, phone, role, is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const updatedUser = result.rows[0];
    logActivity({
      performedBy: req.user.id,
      action: 'UPDATE_USER',
      entityType: 'USER',
      entityId: updatedUser.id,
      description: `Updated user "${updatedUser.username}" (${updatedUser.role})`,
      metadata: { target_user_id: updatedUser.id, username: updatedUser.username },
    });
    res.json({ success: true, message: 'User updated successfully', data: updatedUser });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ success: false, message: 'Failed to update user', error: error.message });
  }
};

// @desc    Admin reset password (CA resets any user's password)
// @route   PUT /api/auth/users/:id/reset-password
// @access  Private (CA only)
exports.adminResetPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    const result = await query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id',
      [passwordHash, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    logActivity({
      performedBy: req.user.id,
      action: 'RESET_PASSWORD',
      entityType: 'USER',
      entityId: parseInt(id),
      description: `Admin reset password for user id ${id}`,
      metadata: { target_user_id: parseInt(id) },
    });
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('Admin reset password error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password', error: error.message });
  }
};

// ============================================================================
// PENDING USER APPROVAL (SUPERADMIN only)
// ============================================================================

// @desc    Get users pending approval
// @route   GET /api/auth/users/pending
// @access  Private (SUPERADMIN only)
exports.getPendingUsers = async (req, res) => {
  try {
    const result = await query(
      `SELECT id, username, email, full_name, phone, role, created_at
       FROM users
       WHERE is_approved = false
       ORDER BY created_at ASC`
    );
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    console.error('Get pending users error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch pending users', error: error.message });
  }
};

// @desc    Get count of users pending approval
// @route   GET /api/auth/users/pending-count
// @access  Private (SUPERADMIN only)
exports.getPendingCount = async (req, res) => {
  try {
    const result = await query(
      `SELECT COUNT(*) AS count FROM users WHERE is_approved = false`
    );
    res.json({ success: true, count: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('Get pending count error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch pending count', error: error.message });
  }
};

// @desc    Approve a pending user
// @route   PUT /api/auth/users/:id/approve
// @access  Private (SUPERADMIN only)
exports.approveUser = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `UPDATE users SET is_approved = true, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND is_approved = false
       RETURNING id, username, full_name, role`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found or already approved' });
    }
    const approved = result.rows[0];
    logActivity({
      performedBy: req.user.id,
      action: 'APPROVE_USER',
      entityType: 'USER',
      entityId: approved.id,
      description: `Approved user "${approved.username}" (${approved.role})`,
      metadata: { target_user_id: approved.id, username: approved.username },
    });
    res.json({ success: true, message: 'User approved successfully', data: approved });
  } catch (error) {
    console.error('Approve user error:', error);
    res.status(500).json({ success: false, message: 'Failed to approve user', error: error.message });
  }
};

// @desc    Reject (delete) a pending user
// @route   DELETE /api/auth/users/:id/reject
// @access  Private (SUPERADMIN only)
exports.rejectUser = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `DELETE FROM users WHERE id = $1 AND is_approved = false RETURNING id, username, full_name`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found or already approved (cannot reject approved users)' });
    }
    const rejected = result.rows[0];
    logActivity({
      performedBy: req.user.id,
      action: 'REJECT_USER',
      entityType: 'USER',
      entityId: rejected.id,
      description: `Rejected and removed pending user "${rejected.username}"`,
      metadata: { target_user_id: rejected.id, username: rejected.username },
    });
    res.json({ success: true, message: 'User registration rejected' });
  } catch (error) {
    console.error('Reject user error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject user', error: error.message });
  }
};
