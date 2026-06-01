const express = require('express');
const router = express.Router();
const masterController = require('../controllers/masterController');
const { auth } = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// Bank Accounts (for Mark Payment dropdown — all companies)
router.get('/bank-accounts', masterController.getBankAccounts);

// Header Master (Companies)
router.get('/headers', masterController.getAllHeaders);
router.get('/headers/:id', masterController.getHeaderById);
router.post('/headers', masterController.createHeader);
// PUT is aliased to PATCH /details for backwards compatibility with frontend masterAPI.updateHeader
router.put('/headers/:id', masterController.updateHeaderDetails);
router.patch('/headers/:id/details', masterController.updateHeaderDetails);
router.delete('/headers/:id', masterController.deleteHeader);

// Bank accounts per company (multi-bank support — migration 006)
router.get('/headers/:id/bank-accounts', masterController.getBankAccountsByHeader);
router.post('/headers/:id/bank-accounts', masterController.addBankAccount);
router.put('/headers/:id/bank-accounts/:bankId', masterController.updateBankAccount);
router.delete('/headers/:id/bank-accounts/:bankId', masterController.deleteBankAccount);

// Particulars (Services)
router.get('/particulars', masterController.getAllParticulars);
router.post('/particulars', masterController.createParticular);
router.put('/particulars/:id', masterController.updateParticular);
router.delete('/particulars/:id', masterController.deleteParticular);

// GST Rates
router.get('/gst-rates', masterController.getAllGSTRates);
router.post('/gst-rates', masterController.createGSTRate);
router.put('/gst-rates/:id', masterController.updateGSTRate);
router.delete('/gst-rates/:id', masterController.deleteGSTRate);

// Payment Terms
router.get('/payment-terms', masterController.getAllPaymentTerms);
router.post('/payment-terms', masterController.createPaymentTerm);
router.put('/payment-terms/:id', masterController.updatePaymentTerm);
router.delete('/payment-terms/:id', masterController.deletePaymentTerm);

module.exports = router;