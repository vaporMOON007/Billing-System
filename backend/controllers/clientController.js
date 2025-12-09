const { query } = require('../config/database');

// @desc    Create new client
// @route   POST /api/clients
// @access  Private
exports.createClient = async (req, res) => {
  try {
    const { client_name, contact_person, phone, email } = req.body;

    if (!client_name) {
      return res.status(400).json({
        success: false,
        message: 'Client name is required'
      });
    }

    // Check for similar names (optional fuzzy matching)
    const similarClients = await query(
      `SELECT client_name FROM clients_master 
       WHERE LOWER(client_name) SIMILAR TO LOWER($1) AND is_active = true
       LIMIT 3`,
      [`%${client_name}%`]
    );

    if (similarClients.rows.length > 0) {
      return res.status(200).json({
        success: true,
        warning: 'Similar clients found',
        similar_clients: similarClients.rows,
        message: 'Please confirm if you want to create a new client'
      });
    }

    const result = await query(
      `INSERT INTO clients_master (client_name, contact_person, phone, email)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [client_name, contact_person || null, phone || null, email || null]
    );

    res.status(201).json({
      success: true,
      message: 'Client created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create client error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create client',
      error: error.message
    });
  }
};

// @desc    Get all clients
// @route   GET /api/clients
// @access  Private
exports.getAllClients = async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM clients_master 
       WHERE is_active = true 
       ORDER BY client_name`
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch clients',
      error: error.message
    });
  }
};

// @desc    Search clients by name
// @route   GET /api/clients/search?q=searchTerm
// @access  Private
exports.searchClients = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search term must be at least 2 characters'
      });
    }

    const result = await query(
      `SELECT * FROM clients_master 
       WHERE LOWER(client_name) LIKE LOWER($1) 
       AND is_active = true 
       ORDER BY client_name 
       LIMIT 10`,
      [`%${q}%`]
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Search clients error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search clients',
      error: error.message
    });
  }
};

// @desc    Get client by ID
// @route   GET /api/clients/:id
// @access  Private
exports.getClientById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'SELECT * FROM clients_master WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get client error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch client',
      error: error.message
    });
  }
};

// @desc    Update client
// @route   PUT /api/clients/:id
// @access  Private
exports.updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const { client_name, contact_person, phone, email } = req.body;

    const result = await query(
      `UPDATE clients_master 
       SET client_name = COALESCE($1, client_name),
           contact_person = COALESCE($2, contact_person),
           phone = COALESCE($3, phone),
           email = COALESCE($4, email),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [client_name, contact_person, phone, email, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    res.json({
      success: true,
      message: 'Client updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update client error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update client',
      error: error.message
    });
  }
};

// @desc    Delete (soft delete) client
// @route   DELETE /api/clients/:id
// @access  Private
exports.deleteClient = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE clients_master 
       SET is_active = false, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    res.json({
      success: true,
      message: 'Client deactivated successfully'
    });
  } catch (error) {
    console.error('Delete client error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete client',
      error: error.message
    });
  }
};