const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { auth, authorize } = require('../middleware/auth');

// Public routes
router.post('/login', authController.login);
router.post('/register', authController.register);
router.post('/verify-user', authController.verifyUserForReset);
router.post('/reset-password', authController.resetPassword);

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