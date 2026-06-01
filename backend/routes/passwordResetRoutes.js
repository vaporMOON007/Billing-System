const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { auth, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/passwordResetController');

// Rate limit on public submit endpoint — 5 requests per IP per 15 minutes
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many reset attempts. Please try again later.' }
});

// ── Public (no auth) ──────────────────────────────────────────────────────
router.post('/request', resetLimiter, ctrl.submitRequest);
router.get('/status',   resetLimiter, ctrl.getStatus);

// ── SUPERADMIN only ───────────────────────────────────────────────────────
router.get('/pending',          auth, authorize('SUPERADMIN'), ctrl.getPendingRequests);
router.get('/pending-count',    auth, authorize('SUPERADMIN'), ctrl.getPendingCount);
router.put('/:id/approve',      auth, authorize('SUPERADMIN'), ctrl.approveRequest);
router.put('/:id/reject',       auth, authorize('SUPERADMIN'), ctrl.rejectRequest);

module.exports = router;
