const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { auth, authorize } = require('../middleware/auth');

// Rate limiters
// Tight limit on login — 10 attempts per IP per 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please try again after 15 minutes.' }
});

// Tight limit on registration — 5 registrations per IP per hour
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many registration attempts. Please try again later.' }
});

// Public routes
router.post('/login', loginLimiter, authController.login);
router.post('/register', registerLimiter, authController.register);

// NOTE: /verify-user and /reset-password have been removed.
// They were unauthenticated endpoints that allowed user enumeration (#22)
// and account takeover without any token verification (#21).
// Password resets are handled by authenticated admins via PUT /users/:id/reset-password.

// Protected routes
router.get('/profile', auth, authController.getProfile);
router.post('/change-password', auth, authController.changePassword);

// User management (CA + SUPERADMIN)
router.get('/users', auth, authorize('CA'), authController.getAllUsers);
router.put('/users/:id', auth, authorize('CA'), authController.updateUser);
router.put('/users/:id/reset-password', auth, authorize('CA'), authController.adminResetPassword);

// Pending approval management (SUPERADMIN only)
// Note: these specific routes must come BEFORE /:id routes to avoid conflicts
router.get('/users/pending', auth, authorize('SUPERADMIN'), authController.getPendingUsers);
router.get('/users/pending-count', auth, authorize('SUPERADMIN'), authController.getPendingCount);
router.put('/users/:id/approve', auth, authorize('SUPERADMIN'), authController.approveUser);
router.delete('/users/:id/reject', auth, authorize('SUPERADMIN'), authController.rejectUser);

module.exports = router;