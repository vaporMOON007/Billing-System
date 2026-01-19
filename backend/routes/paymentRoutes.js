const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { auth, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// Payment operations
router.post('/', authorize('CA'), paymentController.markPayment);
router.get('/bill/:billId', paymentController.getPaymentHistory);
router.delete('/:id', authorize('CA'), paymentController.deletePayment);

module.exports = router;