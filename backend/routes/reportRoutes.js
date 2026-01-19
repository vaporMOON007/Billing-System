const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { auth, authorize } = require('../middleware/auth');

// All routes require authentication and CA role
router.use(auth);
router.use(authorize('CA'));

// Dashboard & Reports
router.get('/dashboard-kpis', reportController.getDashboardKPIs);
router.get('/client-ledger', reportController.generateClientLedger);
router.get('/client-detailed', reportController.generateDetailedReport);
router.get('/export-bills', reportController.exportBills);

module.exports = router;