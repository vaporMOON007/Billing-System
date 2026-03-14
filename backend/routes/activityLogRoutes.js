const express = require('express');
const router  = express.Router();
const { getActivityLog, getActivityLogByBill } = require('../controllers/activityLogController');
const { auth, authorize } = require('../middleware/auth');

// CA-only: flat log with filters
router.get('/',        auth, authorize('CA'), getActivityLog);
// CA-only: grouped by bill (one accordion row per bill)
router.get('/by-bill', auth, authorize('CA'), getActivityLogByBill);

module.exports = router;
