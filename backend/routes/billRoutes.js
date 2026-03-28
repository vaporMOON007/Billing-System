const express = require('express');
const router = express.Router();
const billController = require('../controllers/billController');
const { auth, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// Merge / unmerge (must be before /:id routes)
router.post('/merge', billController.mergeBills);

// Bill CRUD operations
router.post('/', billController.createBill);
router.get('/', billController.getAllBills);
router.get('/preview-number', billController.previewBillNumber);
router.get('/search', billController.searchBillByNumber);

// Service-level operations (must be before /:id to avoid conflicts)
router.delete('/services/:serviceId', billController.deleteService);

// Bill-level operations
router.get('/:id', billController.getBillById);
router.put('/:id', billController.updateBill);
router.put('/:id/finalize', billController.finalizeBill);
router.post('/:id/unmerge', billController.unmergeBill);
router.delete('/:id', billController.deleteBill);

// PDF and Email
router.get('/:id/pdf', billController.generatePDF);
router.post('/:id/email', billController.sendEmail);

// Per-bill service add
router.post('/:billId/services', billController.addServiceToBill);

// Edit lock routes
router.post('/:id/lock', billController.acquireLock);
router.put('/:id/lock/refresh', billController.refreshLock);
router.delete('/:id/lock', billController.releaseLock);
router.get('/:id/lock', billController.checkLock);

// Write-off route
router.post('/:id/writeoff', authorize('SUPERADMIN'), billController.writeOffBill);

module.exports = router;