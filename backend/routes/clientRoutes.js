const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');
const bulkImportController = require('../controllers/bulkImportController');
const { auth, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// Client CRUD operations
router.post('/', clientController.createClient);
router.post('/bulk-import', bulkImportController.bulkImportClients);
router.post('/bulk-delete', authorize('SUPERADMIN'), clientController.bulkDeleteClients);
router.get('/export', clientController.exportClients);
router.get('/', clientController.getAllClients);
router.get('/search', clientController.searchClients);
router.get('/:id', clientController.getClientById);
router.put('/:id', clientController.updateClient);
router.delete('/:id', clientController.deleteClient);

module.exports = router;
