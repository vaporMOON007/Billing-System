const express = require('express');
const router = express.Router();
const billController = require('../controllers/billController');
const { auth } = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// Bill CRUD operations
router.post('/', billController.createBill);
router.get('/', billController.getAllBills);
router.get('/:billNo', billController.getBillByNumber);
router.put('/:id', billController.updateBill);
router.delete('/:id', billController.deleteBill);

// Bill actions
router.post('/:id/finalize', billController.finalizeBill);
router.get('/:id/pdf', billController.generatePDF);
router.post('/:id/email', billController.sendEmail);

// Service management
router.post('/:id/services', billController.addServiceToBill);
router.delete('/services/:serviceId', billController.deleteService);

module.exports = router;