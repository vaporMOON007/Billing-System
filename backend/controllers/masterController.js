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

    // Normalise optional fields — treat empty string as null
    const gstinValue = gstin && gstin.trim() !== '' ? gstin.trim() : null;
    const panValue   = pan   && pan.trim()   !== '' ? pan.trim()   : null;

    // Check bill_prefix uniqueness
    if (bill_prefix) {
      const prefixCheck = await query(
        'SELECT id FROM header_master WHERE UPPER(bill_prefix) = UPPER($1)',
        [bill_prefix]
      );
      if (prefixCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Bill prefix "${bill_prefix}" is already used by another company. Please choose a unique prefix.`
        });
      }
    }

    await client.query('BEGIN');

    // Insert header
    const headerResult = await client.query(
      `INSERT INTO header_master
       (company_name, proprietor_name, address_line1, address_line2, city, state,
        pincode, phone, email, gstin, pan, bill_prefix, upi_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [company_name, proprietor_name, address_line1, address_line2, city, state,
       pincode, phone, email, gstinValue, panValue, bill_prefix || company_name.substring(0, 3).toUpperCase(), upi_id]
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
      `INSERT INTO header_bank_details
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

// @desc    Get all bank accounts (for Mark Payment dropdown)
// @route   GET /api/masters/bank-accounts
// @access  Private
exports.getBankAccounts = async (req, res) => {
  try {
    const result = await query(
      `SELECT
         hbd.header_id,
         hbd.bank_name,
         hbd.account_number,
         hbd.account_holder_name,
         hbd.ifsc_code,
         hbd.branch_name,
         hm.company_name
       FROM header_bank_details hbd
       JOIN header_master hm ON hm.id = hbd.header_id
       WHERE hbd.bank_name IS NOT NULL
       ORDER BY hm.company_name ASC`
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get bank accounts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bank accounts',
      error: error.message
    });
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
      'SELECT * FROM header_bank_details WHERE header_id = $1',
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

// @desc    Update header details (everything except bill_prefix)
// @route   PATCH /api/masters/headers/:id/details
// @access  Private
exports.updateHeaderDetails = async (req, res) => {
  const client = await require('../config/database').pool.connect();
  try {
    const { id } = req.params;
    const updates = req.body;

    // Normalise optional fields — treat empty string as null so they clear cleanly
    const gstin = updates.gstin !== undefined
      ? (updates.gstin && updates.gstin.trim() !== '' ? updates.gstin.trim() : null)
      : undefined;
    const pan = updates.pan !== undefined
      ? (updates.pan && updates.pan.trim() !== '' ? updates.pan.trim() : null)
      : undefined;

    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE header_master
       SET company_name     = COALESCE($1,  company_name),
           proprietor_name  = COALESCE($2,  proprietor_name),
           address_line1    = COALESCE($3,  address_line1),
           address_line2    = COALESCE($4,  address_line2),
           city             = COALESCE($5,  city),
           state            = COALESCE($6,  state),
           pincode          = COALESCE($7,  pincode),
           phone            = COALESCE($8,  phone),
           email            = COALESCE($9,  email),
           gstin            = COALESCE($10, gstin),
           pan              = COALESCE($11, pan),
           upi_id           = COALESCE($12, upi_id),
           updated_at       = CURRENT_TIMESTAMP
       WHERE id = $13
       RETURNING *`,
      [updates.company_name, updates.proprietor_name, updates.address_line1,
       updates.address_line2, updates.city, updates.state, updates.pincode,
       updates.phone, updates.email, gstin, pan, updates.upi_id, id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    // Upsert bank details if any bank field was provided
    if (updates.bank_name !== undefined || updates.account_number !== undefined ||
        updates.ifsc_code !== undefined || updates.branch_name !== undefined ||
        updates.account_holder_name !== undefined) {
      await client.query(
        `INSERT INTO header_bank_details
           (header_id, bank_name, account_holder_name, account_number, ifsc_code, branch_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (header_id) DO UPDATE SET
           bank_name           = COALESCE(EXCLUDED.bank_name,           header_bank_details.bank_name),
           account_holder_name = COALESCE(EXCLUDED.account_holder_name, header_bank_details.account_holder_name),
           account_number      = COALESCE(EXCLUDED.account_number,      header_bank_details.account_number),
           ifsc_code           = COALESCE(EXCLUDED.ifsc_code,           header_bank_details.ifsc_code),
           branch_name         = COALESCE(EXCLUDED.branch_name,         header_bank_details.branch_name)`,
        [id, updates.bank_name, updates.account_holder_name, updates.account_number,
         updates.ifsc_code, updates.branch_name]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'Company updated successfully', data: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update header details error:', error);
    res.status(500).json({ success: false, message: 'Failed to update company', error: error.message });
  } finally {
    client.release();
  }
};

// @desc    Update bill prefix only — blocked once any finalized bill exists
// @route   PATCH /api/masters/headers/:id/prefix
// @access  Private
exports.updateHeaderPrefix = async (req, res) => {
  const client = await require('../config/database').pool.connect();
  try {
    const { id } = req.params;
    const { bill_prefix } = req.body;

    if (!bill_prefix || bill_prefix.trim() === '') {
      return res.status(400).json({ success: false, message: 'bill_prefix is required' });
    }

    const prefix = bill_prefix.trim().toUpperCase();

    // Block if any finalized bill already uses this header's current prefix
    const finalizedCheck = await client.query(
      `SELECT COUNT(*) AS cnt FROM bills WHERE header_id = $1 AND status = 'FINALIZED'`,
      [id]
    );
    if (parseInt(finalizedCheck.rows[0].cnt) > 0) {
      return res.status(400).json({
        success: false,
        message: `Prefix cannot be changed — this company already has ${finalizedCheck.rows[0].cnt} finalized bill(s). ` +
                 `Changing the prefix now would create collisions with existing bill numbers. ` +
                 `If you need a different prefix, create a new company.`
      });
    }

    // Check uniqueness across all other companies (case-insensitive)
    const prefixCheck = await client.query(
      'SELECT id FROM header_master WHERE UPPER(bill_prefix) = $1 AND id != $2',
      [prefix, id]
    );
    if (prefixCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Bill prefix "${prefix}" is already used by another company. Please choose a unique prefix.`
      });
    }

    const result = await client.query(
      `UPDATE header_master SET bill_prefix = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [prefix, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    res.json({ success: true, message: 'Bill prefix updated successfully', data: result.rows[0] });
  } catch (error) {
    console.error('Update header prefix error:', error);
    res.status(500).json({ success: false, message: 'Failed to update prefix', error: error.message });
  } finally {
    client.release();
  }
};

// @desc    Delete header
// @route   DELETE /api/masters/headers/:id
// @access  Private
exports.deleteHeader = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if any bills exist for this company
    const billCheck = await query(
      'SELECT COUNT(*) AS cnt FROM bills WHERE header_id = $1',
      [id]
    );
    if (parseInt(billCheck.rows[0].cnt) > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete — this company has ${billCheck.rows[0].cnt} bill(s) associated with it. Please reassign or delete those bills first.`
      });
    }

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
      `INSERT INTO particulars_master (service_name)
       VALUES ($1)
       RETURNING *`,
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

// @desc    Update particular
// @route   PUT /api/masters/particulars/:id
// @access  Private
exports.updateParticular = async (req, res) => {
  try {
    const { id } = req.params;
    const { service_name, sac_code, rate } = req.body;

    const result = await query(
      `UPDATE particulars_master
       SET service_name = COALESCE($1, service_name)
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

// @desc    Delete particular
// @route   DELETE /api/masters/particulars/:id
// @access  Private
exports.deleteParticular = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if this service is used in any bill
    const usageCheck = await query(
      'SELECT COUNT(*) AS cnt FROM bill_services WHERE particulars_id = $1',
      [id]
    );
    if (parseInt(usageCheck.rows[0].cnt) > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete — this service is used in ${usageCheck.rows[0].cnt} bill(s). Remove it from those bills first.`
      });
    }

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
    // FK violation fallback
    if (error.code === '23503') {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete — this service is referenced in existing bills.'
      });
    }
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
    // rate_name does not exist in gst_rates_master schema.
    // The frontend sends either 'description' or 'rate_name' — both mean the same label.
    // We normalise to 'description' which is the actual column.
    const { description, rate_name, rate_percentage } = req.body;
    const label = description || rate_name;

    const result = await query(
      `INSERT INTO gst_rates_master (description, rate_percentage)
       VALUES ($1, $2)
       RETURNING *`,
      [label, rate_percentage]
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
    const { description, rate_name, rate_percentage } = req.body;
    // Normalise: accept either field name from frontend, map to the 'description' column.
    const label = description || rate_name || null;

    const result = await query(
      `UPDATE gst_rates_master
       SET rate_percentage = COALESCE($1, rate_percentage),
           description     = COALESCE($2, description)
       WHERE id = $3
       RETURNING *`,
      [rate_percentage, label, id]
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

    // Check if this GST rate is used in any bill
    const usageCheck = await query(
      'SELECT COUNT(*) AS cnt FROM bill_services WHERE gst_rate_id = $1',
      [id]
    );
    if (parseInt(usageCheck.rows[0].cnt) > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete — this GST rate is used in ${usageCheck.rows[0].cnt} bill line(s). Remove it from those bills first.`
      });
    }

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
    // FK violation fallback
    if (error.code === '23503') {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete — this GST rate is referenced in existing bills.'
      });
    }
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
           days_to_add = COALESCE($2, days_to_add)
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

    // Check if this payment term is used in any bill
    const usageCheck = await query(
      'SELECT COUNT(*) AS cnt FROM bills WHERE payment_term_id = $1',
      [id]
    );
    if (parseInt(usageCheck.rows[0].cnt) > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete — this payment term is used in ${usageCheck.rows[0].cnt} bill(s). Update those bills first.`
      });
    }

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
    // FK violation fallback
    if (error.code === '23503') {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete — this payment term is referenced in existing bills.'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to delete payment term',
      error: error.message
    });
  }
};