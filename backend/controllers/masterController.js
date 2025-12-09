const { query } = require('../config/database');

// ============================================================================
// HEADER MASTER (Companies)
// ============================================================================

exports.getAllHeaders = async (req, res) => {
  try {
    const result = await query(
      `SELECT h.*, hb.bank_name, hb.account_number, hb.ifsc_code, hb.upi_id
       FROM header_master h
       LEFT JOIN header_bank_details hb ON h.id = hb.header_id
       WHERE h.is_active = true
       ORDER BY h.company_name`
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get headers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch companies',
      error: error.message
    });
  }
};

exports.getHeaderById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT h.*, hb.*
       FROM header_master h
       LEFT JOIN header_bank_details hb ON h.id = hb.header_id
       WHERE h.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get header error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch company',
      error: error.message
    });
  }
};

exports.createHeader = async (req, res) => {
  const client = await require('../config/database').pool.connect();
  
  try {
    const { company_name, proprietor_name, address_line1, address_line2, 
            city, state, pincode, phone, email, gstin, pan,
            bank_name, account_holder_name, account_number, ifsc_code, 
            branch_name, upi_id, qr_code_image } = req.body;

    await client.query('BEGIN');

    // Insert header
    const headerResult = await client.query(
      `INSERT INTO header_master 
       (company_name, proprietor_name, address_line1, address_line2, city, state, 
        pincode, phone, email, gstin, pan)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [company_name, proprietor_name, address_line1, address_line2, city, state,
       pincode, phone, email, gstin, pan]
    );

    const header = headerResult.rows[0];

    // Insert bank details
    await client.query(
      `INSERT INTO header_bank_details 
       (header_id, bank_name, account_holder_name, account_number, ifsc_code, 
        branch_name, upi_id, qr_code_image)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [header.id, bank_name, account_holder_name, account_number, ifsc_code,
       branch_name, upi_id, qr_code_image]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Company created successfully',
      data: header
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create header error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create company',
      error: error.message
    });
  } finally {
    client.release();
  }
};

exports.updateHeader = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const result = await query(
      `UPDATE header_master 
       SET company_name = COALESCE($1, company_name),
           proprietor_name = COALESCE($2, proprietor_name),
           address_line1 = COALESCE($3, address_line1),
           city = COALESCE($4, city),
           state = COALESCE($5, state),
           pincode = COALESCE($6, pincode),
           phone = COALESCE($7, phone),
           email = COALESCE($8, email),
           gstin = COALESCE($9, gstin),
           pan = COALESCE($10, pan),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $11
       RETURNING *`,
      [updates.company_name, updates.proprietor_name, updates.address_line1,
       updates.city, updates.state, updates.pincode, updates.phone,
       updates.email, updates.gstin, updates.pan, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    res.json({
      success: true,
      message: 'Company updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update header error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update company',
      error: error.message
    });
  }
};

// ============================================================================
// PARTICULARS MASTER (Services)
// ============================================================================

exports.getAllParticulars = async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM particulars_master WHERE is_active = true ORDER BY service_name'
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get particulars error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch services',
      error: error.message
    });
  }
};

exports.createParticular = async (req, res) => {
  try {
    const { service_name } = req.body;

    const result = await query(
      'INSERT INTO particulars_master (service_name) VALUES ($1) RETURNING *',
      [service_name]
    );

    res.status(201).json({
      success: true,
      message: 'Service created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create particular error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create service',
      error: error.message
    });
  }
};

exports.updateParticular = async (req, res) => {
  try {
    const { id } = req.params;
    const { service_name } = req.body;

    const result = await query(
      `UPDATE particulars_master 
       SET service_name = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING *`,
      [service_name, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    res.json({
      success: true,
      message: 'Service updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update particular error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update service',
      error: error.message
    });
  }
};

exports.deleteParticular = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'UPDATE particulars_master SET is_active = false WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    res.json({
      success: true,
      message: 'Service deactivated successfully'
    });
  } catch (error) {
    console.error('Delete particular error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete service',
      error: error.message
    });
  }
};

// ============================================================================
// GST RATES MASTER
// ============================================================================

exports.getAllGSTRates = async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM gst_rates_master WHERE is_active = true ORDER BY rate_percentage'
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get GST rates error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch GST rates',
      error: error.message
    });
  }
};

exports.createGSTRate = async (req, res) => {
  try {
    const { rate_percentage, description } = req.body;

    const result = await query(
      'INSERT INTO gst_rates_master (rate_percentage, description) VALUES ($1, $2) RETURNING *',
      [rate_percentage, description]
    );

    res.status(201).json({
      success: true,
      message: 'GST rate created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create GST rate error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create GST rate',
      error: error.message
    });
  }
};

exports.updateGSTRate = async (req, res) => {
  try {
    const { id } = req.params;
    const { rate_percentage, description } = req.body;

    const result = await query(
      `UPDATE gst_rates_master 
       SET rate_percentage = $1, description = $2 
       WHERE id = $3 
       RETURNING *`,
      [rate_percentage, description, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'GST rate not found'
      });
    }

    res.json({
      success: true,
      message: 'GST rate updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update GST rate error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update GST rate',
      error: error.message
    });
  }
};

exports.deleteGSTRate = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'UPDATE gst_rates_master SET is_active = false WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'GST rate not found'
      });
    }

    res.json({
      success: true,
      message: 'GST rate deactivated successfully'
    });
  } catch (error) {
    console.error('Delete GST rate error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete GST rate',
      error: error.message
    });
  }
};

// ============================================================================
// PAYMENT TERMS MASTER
// ============================================================================

exports.getAllPaymentTerms = async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM payment_terms_master WHERE is_active = true ORDER BY days_to_add'
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get payment terms error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment terms',
      error: error.message
    });
  }
};

exports.createPaymentTerm = async (req, res) => {
  try {
    const { term_name, days_to_add } = req.body;

    const result = await query(
      'INSERT INTO payment_terms_master (term_name, days_to_add) VALUES ($1, $2) RETURNING *',
      [term_name, days_to_add]
    );

    res.status(201).json({
      success: true,
      message: 'Payment term created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create payment term error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment term',
      error: error.message
    });
  }
};

exports.updatePaymentTerm = async (req, res) => {
  try {
    const { id } = req.params;
    const { term_name, days_to_add } = req.body;

    const result = await query(
      `UPDATE payment_terms_master 
       SET term_name = $1, days_to_add = $2 
       WHERE id = $3 
       RETURNING *`,
      [term_name, days_to_add, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payment term not found'
      });
    }

    res.json({
      success: true,
      message: 'Payment term updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update payment term error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update payment term',
      error: error.message
    });
  }
};

exports.deletePaymentTerm = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'UPDATE payment_terms_master SET is_active = false WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payment term not found'
      });
    }

    res.json({
      success: true,
      message: 'Payment term deactivated successfully'
    });
  } catch (error) {
    console.error('Delete payment term error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete payment term',
      error: error.message
    });
  }
};