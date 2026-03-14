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

    // Generate token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET || 'your-secret-key',
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

    // Insert new user
    const result = await query(
      `INSERT INTO users (username, email, password_hash, full_name, phone, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, username, email, full_name, phone, role`,
      [username, email, passwordHash, full_name, phone, role || 'EMPLOYEE']
    );

    const user = result.rows[0];

    // Generate token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    // Log with best-effort: performedBy is the requesting user (if authenticated) or null (self-register)
    logActivity({
      performedBy: req.user?.id || null,
      action: 'CREATE_USER',
      entityType: 'USER',
      entityId: user.id,
      description: `Created user "${user.username}" with role ${user.role}`,
      metadata: { new_user_id: user.id, username: user.username, role: user.role },
    });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          phone: user.phone,
          role: user.role
        },
        token
      }
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

// @desc    Verify user for password reset
// @route   POST /api/auth/verify-user
// @access  Public
exports.verifyUserForReset = async (req, res) => {
  try {
    const { email, username } = req.body;

    if (!email && !username) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email or username'
      });
    }

    let result;
    if (email) {
      result = await query(
        'SELECT id, username, email, full_name FROM users WHERE email = $1',
        [email]
      );
    } else {
      result = await query(
        'SELECT id, username, email, full_name FROM users WHERE username = $1',
        [username]
      );
    }

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = result.rows[0];

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name
      }
    });
  } catch (error) {
    console.error('Verify user error:', error);
    res.status(500).json({
      success: false,
      message: 'Verification failed',
      error: error.message
    });
  }
};

// @desc    Reset password
// @route   POST /api/auth/reset-password
// @access  Public
exports.resetPassword = async (req, res) => {
  try {
    const { userId, newPassword } = req.body;

    if (!userId || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'User ID and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    // Update password
    const result = await query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id',
      [passwordHash, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Password reset failed',
      error: error.message
    });
  }
};
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
