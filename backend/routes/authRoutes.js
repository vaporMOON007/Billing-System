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

// User management (CA only)
router.get('/users', auth, authorize('CA'), authController.getAllUsers);
router.put('/users/:id', auth, authorize('CA'), authController.updateUser);
router.put('/users/:id/reset-password', auth, authorize('CA'), authController.adminResetPassword);

module.exports = router;