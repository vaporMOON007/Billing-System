const express = require('express');
const router = express.Router();
const billController = require('../controllers/billController');
const { auth } = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// Bill CRUD operations
router.post('/', billController.createBill);
router.get('/', billController.getAllBills);
router.get('/preview-number', billController.previewBillNumber);
router.get('/search/:billNo', billController.searchBillByNumber);
router.get('/:id', billController.getBillById);
router.put('/:id', billController.updateBill);
router.put('/:id/finalize', billController.finalizeBill);
router.delete('/:id', billController.deleteBill);

module.exports = router;