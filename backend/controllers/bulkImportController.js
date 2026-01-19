const { query } = require('../config/database');

// @desc    Bulk import clients from CSV
// @route   POST /api/clients/bulk-import
// @access  Private
exports.bulkImportClients = async (req, res) => {
  try {
    const { clients } = req.body;

    if (!clients || !Array.isArray(clients) || clients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No client data provided'
      });
    }

    const imported = [];
    const duplicates = [];
    const errors = [];

    // GSTIN validation regex
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

    for (let i = 0; i < clients.length; i++) {
      const row = clients[i];
      const rowNumber = i + 1;

      try {
        // Validate required fields
        if (!row.client_name || !row.contact_person || !row.phone) {
          errors.push({
            row: rowNumber,
            client_name: row.client_name || 'Unknown',
            error: 'Missing required fields (name, contact, or phone)'
          });
          continue;
        }

        // Validate phone
        if (!/^[0-9]{10}$/.test(row.phone)) {
          errors.push({
            row: rowNumber,
            client_name: row.client_name,
            error: 'Invalid phone number (must be 10 digits)'
          });
          continue;
        }

        // Validate GSTIN if provided
        if (row.gstin && !gstinRegex.test(row.gstin)) {
          errors.push({
            row: rowNumber,
            client_name: row.client_name,
            error: 'Invalid GSTIN format'
          });
          continue;
        }

        // Check for duplicate name
        const duplicateCheck = await query(
          'SELECT id, client_name FROM clients_master WHERE LOWER(client_name) = LOWER($1)',
          [row.client_name]
        );

        if (duplicateCheck.rows.length > 0) {
          duplicates.push({
            row: rowNumber,
            client_name: row.client_name,
            existing_id: duplicateCheck.rows[0].id
          });
          continue;
        }

        // Insert client
        const result = await query(
          `INSERT INTO clients_master 
           (client_name, contact_person, phone, email, gstin, address_line1, address_line2, city, state, pincode)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, client_name`,
          [
            row.client_name,
            row.contact_person,
            row.phone,
            row.email || null,
            row.gstin || null,
            row.address_line1 || null,
            row.address_line2 || null,
            row.city || null,
            row.state || null,
            row.pincode || null
          ]
        );

        imported.push({
          id: result.rows[0].id,
          client_name: result.rows[0].client_name
        });
      } catch (error) {
        console.error(`Error importing row ${rowNumber}:`, error);
        errors.push({
          row: rowNumber,
          client_name: row.client_name || 'Unknown',
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: `Import completed: ${imported.length} imported, ${duplicates.length} duplicates, ${errors.length} errors`,
      data: {
        imported: imported.length,
        imported_clients: imported,
        duplicates,
        errors
      }
    });
  } catch (error) {
    console.error('Bulk import error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to import clients',
      error: error.message
    });
  }
};