const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');
const { auth } = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// Client CRUD operations
router.post('/', clientController.createClient);
router.get('/', clientController.getAllClients);
router.get('/search', clientController.searchClients);
router.get('/:id', clientController.getClientById);
router.put('/:id', clientController.updateClient);
router.delete('/:id', clientController.deleteClient);

module.exports = router;