const { query } = require('../config/database');
const { logActivity } = require('./activityLogController');

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
      pan,
      address_line1,
      address_line2,
      city,
      state,
      pincode
    } = req.body;

    // Normalise GSTIN — treat empty string as null
    const gstinValue = gstin && gstin.trim() !== '' ? gstin.trim() : null;

    // Validate GSTIN format if provided
    if (gstinValue) {
      const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
      if (!gstinRegex.test(gstinValue)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid GSTIN format'
        });
      }
    }

    // Normalise PAN — treat empty string as null
    const panValue = pan && pan.trim() !== '' ? pan.trim() : null;

    // Validate PAN format if provided
    if (panValue) {
      const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
      if (!panRegex.test(panValue)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid PAN format'
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
       (client_name, contact_person, phone, email, gstin, pan, address_line1, address_line2, city, state, pincode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [client_name, contact_person, phone, email, gstinValue, panValue, address_line1, address_line2, city, state, pincode]
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

    // Handle duplicate PAN
    if (error.code === '23505' && error.constraint === 'clients_pan_unique') {
      return res.status(400).json({
        success: false,
        message: 'PAN already exists'
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

    // Normalise GSTIN — treat empty string as null
    if (updates.gstin !== undefined) {
      updates.gstin = updates.gstin && updates.gstin.trim() !== '' ? updates.gstin.trim() : null;
    }

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

    // Normalise PAN — treat empty string as null
    if (updates.pan !== undefined) {
      updates.pan = updates.pan && updates.pan.trim() !== '' ? updates.pan.trim() : null;
    }

    // Validate PAN format if provided
    if (updates.pan) {
      const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
      if (!panRegex.test(updates.pan)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid PAN format'
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
           pan = COALESCE($6, pan),
           address_line1 = COALESCE($7, address_line1),
           address_line2 = COALESCE($8, address_line2),
           city = COALESCE($9, city),
           state = COALESCE($10, state),
           pincode = COALESCE($11, pincode),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $12
       RETURNING *`,
      [
        updates.client_name,
        updates.contact_person,
        updates.phone,
        updates.email,
        updates.gstin,
        updates.pan,
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

    // Handle duplicate PAN
    if (error.code === '23505' && error.constraint === 'clients_pan_unique') {
      return res.status(400).json({
        success: false,
        message: 'PAN already exists'
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
          OR pan ILIKE $1
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

// @desc    Export all clients as JSON
// @route   GET /api/clients/export
// @access  Private
exports.exportClients = async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM clients_master ORDER BY client_name ASC'
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Export clients error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export clients',
      error: error.message
    });
  }
};

// @desc    Bulk delete clients (only if they have no bills)
// @route   POST /api/clients/bulk-delete
// @access  SUPERADMIN only
exports.bulkDeleteClients = async (req, res) => {
  try {
    const { client_ids } = req.body;

    if (!Array.isArray(client_ids) || client_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No client IDs provided'
      });
    }

    const deleted = [];
    const skipped = [];

    for (const clientId of client_ids) {
      try {
        // Fetch client details
        const clientResult = await query(
          'SELECT id, client_name FROM clients_master WHERE id = $1',
          [clientId]
        );

        if (clientResult.rows.length === 0) {
          skipped.push({
            id: clientId,
            client_name: 'Unknown',
            reason: 'Client not found'
          });
          continue;
        }

        const client = clientResult.rows[0];

        // Check if client has any bills
        const billCheck = await query(
          'SELECT COUNT(*) as bill_count FROM bills WHERE client_id = $1',
          [clientId]
        );

        if (parseInt(billCheck.rows[0].bill_count) > 0) {
          skipped.push({
            id: client.id,
            client_name: client.client_name,
            reason: 'Client has existing bills'
          });
          continue;
        }

        // Delete client
        await query(
          'DELETE FROM clients_master WHERE id = $1',
          [clientId]
        );

        deleted.push({
          id: client.id,
          client_name: client.client_name
        });

        // Log activity
        logActivity({
          userId: req.user.id,
          action: 'DELETE_CLIENT',
          entityType: 'client',
          entityId: client.id,
          description: `Deleted client: ${client.client_name}`,
          metadata: { client_name: client.client_name }
        });
      } catch (error) {
        console.error(`Error deleting client ${clientId}:`, error);
        skipped.push({
          id: clientId,
          client_name: 'Unknown',
          reason: error.message
        });
      }
    }

    // Log bulk delete activity
    if (deleted.length > 0) {
      logActivity({
        userId: req.user.id,
        action: 'BULK_DELETE_CLIENTS',
        entityType: 'client',
        entityId: null,
        description: `Bulk deleted ${deleted.length} client(s)`,
        metadata: { deleted_count: deleted.length, deleted_clients: deleted }
      });
    }

    res.json({
      success: true,
      message: `Bulk delete completed: ${deleted.length} deleted, ${skipped.length} skipped`,
      data: {
        deleted,
        skipped
      }
    });
  } catch (error) {
    console.error('Bulk delete clients error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk delete clients',
      error: error.message
    });
  }
};
