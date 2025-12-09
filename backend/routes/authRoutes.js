const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { auth } = require('../middleware/auth');

// Public routes
router.post('/login', authController.login);
router.post('/register', authController.register);

// Protected routes
router.get('/me', auth, authController.getProfile);
router.post('/logout', auth, authController.logout);
router.put('/change-password', auth, authController.changePassword);

module.exports = router;