const { query } = require('../config/database');
const { logActivity } = require('./activityLogController');
const { GSTIN_REGEX, PAN_REGEX } = require('../utils/validators');

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
      if (!GSTIN_REGEX.test(gstinValue)) {
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
      if (!PAN_REGEX.test(panValue)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid PAN format'
        });
      }
    }

    // Validate phone
    if (phone && !/^[0-9]{10}$/.test(phone)) {
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
      if (!GSTIN_REGEX.test(updates.gstin)) {
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
      if (!PAN_REGEX.test(updates.pan)) {
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
    // Return only the columns the frontend xlsx export actually uses.
    // SELECT * was leaking internal fields (is_active, created_at, updated_at).
    const result = await query(
      `SELECT id, client_name, contact_person, phone, email,
              gstin, pan, address_line1, address_line2, city, state, pincode
       FROM clients_master
       WHERE is_active = true
       ORDER BY client_name ASC`
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

    // 1 query: fetch all requested clients
    const clientsResult = await query(
      'SELECT id, client_name FROM clients_master WHERE id = ANY($1::int[])',
      [client_ids]
    );
    const foundMap = new Map(clientsResult.rows.map(c => [c.id, c.client_name]));

    // 1 query: find which of the requested clients have bills
    const billedResult = await query(
      'SELECT DISTINCT client_id FROM bills WHERE client_id = ANY($1::int[])',
      [client_ids]
    );
    const billedIds = new Set(billedResult.rows.map(r => r.client_id));

    const deleted = [];
    const skipped = [];

    for (const clientId of client_ids) {
      if (!foundMap.has(clientId)) {
        skipped.push({ id: clientId, client_name: 'Unknown', reason: 'Client not found' });
        continue;
      }
      if (billedIds.has(clientId)) {
        skipped.push({ id: clientId, client_name: foundMap.get(clientId), reason: 'Client has existing bills' });
        continue;
      }
      deleted.push({ id: clientId, client_name: foundMap.get(clientId) });
    }

    // 1 query: delete all eligible clients at once
    if (deleted.length > 0) {
      const deleteIds = deleted.map(c => c.id);
      await query(
        'DELETE FROM clients_master WHERE id = ANY($1::int[])',
        [deleteIds]
      );
      logActivity({
        performedBy: req.user.id,
        action: 'BULK_DELETE_CLIENTS',
        entityType: 'client',
        entityId: null,
        description: `Bulk deleted ${deleted.length} client(s)`,
        metadata: { deleted_count: deleted.length, deleted_clients: deleted }
      });
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
