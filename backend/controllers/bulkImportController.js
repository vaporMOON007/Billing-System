const { query } = require('../config/database');
const { logActivity } = require('./activityLogController');
const { GSTIN_REGEX, PAN_REGEX } = require('../utils/validators');

// @desc    Bulk import clients from CSV with smart upsert logic
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

    const updated = [];
    const created = [];
    const errors = [];

    // GSTIN_REGEX and PAN_REGEX imported from ../utils/validators

    for (let i = 0; i < clients.length; i++) {
      const row = clients[i];
      const rowNumber = i + 1;

      try {
        // Validate required fields
        if (!row.client_name) {
          errors.push({
            row: rowNumber,
            client_name: row.client_name || 'Unknown',
            error: 'Missing required fields (name, contact, or phone)'
          });
          continue;
        }

        // Validate phone
        if (row.phone && !/^[0-9]{10}$/.test(row.phone)) {
          errors.push({
            row: rowNumber,
            client_name: row.client_name,
            error: 'Invalid phone number (must be 10 digits)'
          });
          continue;
        }

        // Normalise GSTIN — treat empty string as null
        row.gstin = row.gstin && row.gstin.trim() !== '' ? row.gstin.trim() : null;

        // Validate GSTIN format if provided
        if (row.gstin && !GSTIN_REGEX.test(row.gstin)) {
          errors.push({
            row: rowNumber,
            client_name: row.client_name,
            error: 'Invalid GSTIN format'
          });
          continue;
        }

        // Normalise PAN — treat empty string as null
        row.pan = row.pan && row.pan.trim() !== '' ? row.pan.trim() : null;

        // Validate PAN format if provided
        if (row.pan && !PAN_REGEX.test(row.pan)) {
          errors.push({
            row: rowNumber,
            client_name: row.client_name,
            error: 'Invalid PAN format'
          });
          continue;
        }

        // Upsert logic based on ID
        if (row.id) {
          // If ID is provided, try to update that client
          const clientExists = await query(
            'SELECT id, client_name FROM clients_master WHERE id = $1',
            [parseInt(row.id)]
          );

          if (clientExists.rows.length === 0) {
            errors.push({
              row: rowNumber,
              client_name: row.client_name,
              error: `Client ID ${row.id} does not exist (cannot create with explicit ID)`
            });
            continue;
          }

          // Update existing client
          try {
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
               RETURNING id, client_name`,
              [
                row.client_name,
                row.contact_person,
                row.phone,
                row.email || null,
                row.gstin || null,
                row.pan || null,
                row.address_line1 || null,
                row.address_line2 || null,
                row.city || null,
                row.state || null,
                row.pincode || null,
                parseInt(row.id)
              ]
            );

            updated.push({
              id: result.rows[0].id,
              client_name: result.rows[0].client_name
            });
          } catch (updateError) {
            if (updateError.code === '23505' && updateError.constraint === 'clients_pan_unique') {
              errors.push({
                row: rowNumber,
                client_name: row.client_name,
                error: 'PAN already exists in database'
              });
            } else if (updateError.code === '23505' && updateError.constraint === 'clients_master_gstin_key') {
              errors.push({
                row: rowNumber,
                client_name: row.client_name,
                error: 'GSTIN already exists in database'
              });
            } else {
              throw updateError;
            }
          }
        } else {
          // No ID provided, create new client
          try {
            const result = await query(
              `INSERT INTO clients_master
               (client_name, contact_person, phone, email, gstin, pan, address_line1, address_line2, city, state, pincode)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
               RETURNING id, client_name`,
              [
                row.client_name,
                row.contact_person,
                row.phone,
                row.email || null,
                row.gstin || null,
                row.pan || null,
                row.address_line1 || null,
                row.address_line2 || null,
                row.city || null,
                row.state || null,
                row.pincode || null
              ]
            );

            created.push({
              id: result.rows[0].id,
              client_name: result.rows[0].client_name
            });
          } catch (insertError) {
            if (insertError.code === '23505' && insertError.constraint === 'clients_pan_unique') {
              errors.push({
                row: rowNumber,
                client_name: row.client_name,
                error: 'PAN already exists in database'
              });
            } else if (insertError.code === '23505' && insertError.constraint === 'clients_master_gstin_key') {
              errors.push({
                row: rowNumber,
                client_name: row.client_name,
                error: 'GSTIN already exists in database'
              });
            } else {
              throw insertError;
            }
          }
        }
      } catch (error) {
        console.error(`Error importing row ${rowNumber}:`, error);
        errors.push({
          row: rowNumber,
          client_name: row.client_name || 'Unknown',
          error: error.message
        });
      }
    }

    // Log bulk import activity if any clients were created
    if (created.length > 0) {
      logActivity({
        performedBy: req.user ? req.user.id : null,
        action: 'BULK_IMPORT_CLIENTS',
        entityType: 'client',
        entityId: null,
        description: `Bulk imported ${created.length} client(s)`,
        metadata: { created_count: created.length, created_clients: created }
      });
    }

    res.json({
      success: true,
      message: `Import completed: ${updated.length} updated, ${created.length} created, ${errors.length} errors`,
      data: {
        updated: updated.length,
        created: created.length,
        updated_clients: updated,
        created_clients: created,
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
