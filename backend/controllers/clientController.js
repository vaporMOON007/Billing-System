const { query } = require('../config/database');

// @desc    Create new client
// @route   POST /api/clients
// @access  Private
exports.createClient = async (req, res) => {
  try {
    const {
      client_name,
      contact_person,
      phone,
      email,
      gstin,
      address_line1,
      address_line2,
      city,
      state,
      pincode
    } = req.body;

    // Validate GSTIN format if provided
    if (gstin) {
      const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
      if (!gstinRegex.test(gstin)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid GSTIN format'
        });
      }
    }

    // Validate phone
    if (!/^[0-9]{10}$/.test(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must be 10 digits'
      });
    }

    const result = await query(
      `INSERT INTO clients_master 
       (client_name, contact_person, phone, email, gstin, address_line1, address_line2, city, state, pincode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [client_name, contact_person, phone, email, gstin, address_line1, address_line2, city, state, pincode]
    );

    res.status(201).json({
      success: true,
      message: 'Client created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create client error:', error);
    
    // Handle duplicate GSTIN
    if (error.code === '23505' && error.constraint === 'clients_master_gstin_key') {
      return res.status(400).json({
        success: false,
        message: 'GSTIN already exists'
      });
    }

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
      'SELECT * FROM clients_master ORDER BY client_name ASC'
    );

    res.json({
      success: true,
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
    const updates = req.body;

    // Validate GSTIN format if provided
    if (updates.gstin) {
      const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
      if (!gstinRegex.test(updates.gstin)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid GSTIN format'
        });
      }
    }

    // Validate phone if provided
    if (updates.phone && !/^[0-9]{10}$/.test(updates.phone)) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must be 10 digits'
      });
    }

    const result = await query(
      `UPDATE clients_master 
       SET client_name = COALESCE($1, client_name),
           contact_person = COALESCE($2, contact_person),
           phone = COALESCE($3, phone),
           email = COALESCE($4, email),
           gstin = COALESCE($5, gstin),
           address_line1 = COALESCE($6, address_line1),
           address_line2 = COALESCE($7, address_line2),
           city = COALESCE($8, city),
           state = COALESCE($9, state),
           pincode = COALESCE($10, pincode),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $11
       RETURNING *`,
      [
        updates.client_name,
        updates.contact_person,
        updates.phone,
        updates.email,
        updates.gstin,
        updates.address_line1,
        updates.address_line2,
        updates.city,
        updates.state,
        updates.pincode,
        id
      ]
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
    
    // Handle duplicate GSTIN
    if (error.code === '23505' && error.constraint === 'clients_master_gstin_key') {
      return res.status(400).json({
        success: false,
        message: 'GSTIN already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update client',
      error: error.message
    });
  }
};

// @desc    Delete client
// @route   DELETE /api/clients/:id
// @access  Private
exports.deleteClient = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM clients_master WHERE id = $1 RETURNING id',
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
      message: 'Client deleted successfully'
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

// @desc    Search clients
// @route   GET /api/clients/search
// @access  Private
exports.searchClients = async (req, res) => {
  try {
    const { query: searchQuery } = req.query;

    if (!searchQuery) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const result = await query(
      `SELECT * FROM clients_master 
       WHERE client_name ILIKE $1 
          OR contact_person ILIKE $1 
          OR phone ILIKE $1
       ORDER BY client_name ASC
       LIMIT 20`,
      [`%${searchQuery}%`]
    );

    res.json({
      success: true,
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