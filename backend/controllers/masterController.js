const { query } = require('../config/database');

// ============================================================================
// HEADER MASTER (Company Master)
// ============================================================================

// @desc    Create new header/company
// @route   POST /api/masters/headers
// @access  Private
exports.createHeader = async (req, res) => {
  const client = await require('../config/database').pool.connect();
  
  try {
    const {
      company_name,
      proprietor_name,
      address_line1,
      address_line2,
      city,
      state,
      pincode,
      phone,
      email,
      gstin,
      pan,
      bill_prefix,
      upi_id
    } = req.body;

    await client.query('BEGIN');

    // Insert header
    const headerResult = await client.query(
      `INSERT INTO header_master 
       (company_name, proprietor_name, address_line1, address_line2, city, state, 
        pincode, phone, email, gstin, pan, bill_prefix, upi_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [company_name, proprietor_name, address_line1, address_line2, city, state,
       pincode, phone, email, gstin, pan, bill_prefix || company_name.substring(0, 3).toUpperCase(), upi_id]
    );

    const header = headerResult.rows[0];

    // Insert bank details
    const {
      bank_name,
      account_holder_name,
      account_number,
      ifsc_code,
      branch_name
    } = req.body;

    await client.query(
      `INSERT INTO bank_details_master 
       (header_id, bank_name, account_holder_name, account_number, ifsc_code, branch_name)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [header.id, bank_name, account_holder_name, account_number, ifsc_code, branch_name]
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

// @desc    Get all headers
// @route   GET /api/masters/headers
// @access  Private
exports.getAllHeaders = async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM header_master ORDER BY company_name ASC'
    );

    res.json({
      success: true,
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

// @desc    Get header by ID
// @route   GET /api/masters/headers/:id
// @access  Private
exports.getHeaderById = async (req, res) => {
  try {
    const { id } = req.params;

    const headerResult = await query(
      'SELECT * FROM header_master WHERE id = $1',
      [id]
    );

    if (headerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const bankResult = await query(
      'SELECT * FROM bank_details_master WHERE header_id = $1',
      [id]
    );

    res.json({
      success: true,
      data: {
        ...headerResult.rows[0],
        bank_details: bankResult.rows[0] || null
      }
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

// @desc    Update header
// @route   PUT /api/masters/headers/:id
// @access  Private
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
           bill_prefix = COALESCE($11, bill_prefix),
           upi_id = COALESCE($12, upi_id),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $13
       RETURNING *`,
      [updates.company_name, updates.proprietor_name, updates.address_line1,
       updates.city, updates.state, updates.pincode, updates.phone,
       updates.email, updates.gstin, updates.pan, updates.bill_prefix, updates.upi_id, id]
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

// @desc    Delete header
// @route   DELETE /api/masters/headers/:id
// @access  Private
exports.deleteHeader = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM header_master WHERE id = $1 RETURNING id',
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
      message: 'Company deleted successfully'
    });
  } catch (error) {
    console.error('Delete header error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete company',
      error: error.message
    });
  }
};

// ============================================================================
// PARTICULARS MASTER (Services)
// ============================================================================

// @desc    Get all particulars
// @route   GET /api/masters/particulars
// @access  Private
exports.getAllParticulars = async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM particulars_master ORDER BY service_name ASC'
    );

    res.json({
      success: true,
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

// @desc    Create particular
// @route   POST /api/masters/particulars
// @access  Private
exports.createParticular = async (req, res) => {
  try {
    const { service_name, sac_code, rate } = req.body;

    const result = await query(
      `INSERT INTO particulars_master (service_name, sac_code, rate)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [service_name, sac_code, rate]
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

// @desc    Update particular
// @route   PUT /api/masters/particulars/:id
// @access  Private
exports.updateParticular = async (req, res) => {
  try {
    const { id } = req.params;
    const { service_name, sac_code, rate } = req.body;

    const result = await query(
      `UPDATE particulars_master 
       SET service_name = COALESCE($1, service_name),
           sac_code = COALESCE($2, sac_code),
           rate = COALESCE($3, rate),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [service_name, sac_code, rate, id]
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

// @desc    Delete particular
// @route   DELETE /api/masters/particulars/:id
// @access  Private
exports.deleteParticular = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM particulars_master WHERE id = $1 RETURNING id',
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
      message: 'Service deleted successfully'
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

// @desc    Get all GST rates
// @route   GET /api/masters/gst-rates
// @access  Private
exports.getAllGSTRates = async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM gst_rates_master ORDER BY rate_percentage ASC'
    );

    res.json({
      success: true,
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

// @desc    Create GST rate
// @route   POST /api/masters/gst-rates
// @access  Private
exports.createGSTRate = async (req, res) => {
  try {
    const { rate_name, rate_percentage } = req.body;

    const result = await query(
      `INSERT INTO gst_rates_master (rate_name, rate_percentage)
       VALUES ($1, $2)
       RETURNING *`,
      [rate_name, rate_percentage]
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

// @desc    Update GST rate
// @route   PUT /api/masters/gst-rates/:id
// @access  Private
exports.updateGSTRate = async (req, res) => {
  try {
    const { id } = req.params;
    const { rate_name, rate_percentage } = req.body;

    const result = await query(
      `UPDATE gst_rates_master 
       SET rate_name = COALESCE($1, rate_name),
           rate_percentage = COALESCE($2, rate_percentage),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [rate_name, rate_percentage, id]
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

// @desc    Delete GST rate
// @route   DELETE /api/masters/gst-rates/:id
// @access  Private
exports.deleteGSTRate = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM gst_rates_master WHERE id = $1 RETURNING id',
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
      message: 'GST rate deleted successfully'
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

// @desc    Get all payment terms
// @route   GET /api/masters/payment-terms
// @access  Private
exports.getAllPaymentTerms = async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM payment_terms_master ORDER BY days_to_add ASC'
    );

    res.json({
      success: true,
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

// @desc    Create payment term
// @route   POST /api/masters/payment-terms
// @access  Private
exports.createPaymentTerm = async (req, res) => {
  try {
    const { term_name, days_to_add } = req.body;

    const result = await query(
      `INSERT INTO payment_terms_master (term_name, days_to_add)
       VALUES ($1, $2)
       RETURNING *`,
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

// @desc    Update payment term
// @route   PUT /api/masters/payment-terms/:id
// @access  Private
exports.updatePaymentTerm = async (req, res) => {
  try {
    const { id } = req.params;
    const { term_name, days_to_add } = req.body;

    const result = await query(
      `UPDATE payment_terms_master 
       SET term_name = COALESCE($1, term_name),
           days_to_add = COALESCE($2, days_to_add),
           updated_at = CURRENT_TIMESTAMP
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

// @desc    Delete payment term
// @route   DELETE /api/masters/payment-terms/:id
// @access  Private
exports.deletePaymentTerm = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM payment_terms_master WHERE id = $1 RETURNING id',
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
      message: 'Payment term deleted successfully'
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