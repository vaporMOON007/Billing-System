const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { auth, authorize } = require('../middleware/auth');

// All routes require authentication — SUPERADMIN only
// Matches the frontend ProtectedRoute allowedRoles={['SUPERADMIN']} on /reports
router.use(auth);
router.use(authorize('SUPERADMIN'));

// Dashboard & Reports
router.get('/dashboard-kpis', reportController.getDashboardKPIs);
router.get('/receivables', reportController.getReceivables);
router.get('/client-detailed', reportController.generateDetailedReport);
router.get('/export-bills', reportController.exportBills);

module.exports = router;