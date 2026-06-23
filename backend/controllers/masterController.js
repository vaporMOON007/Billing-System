const { query } = require('../config/database');

// ============================================================================
// HEADER MASTER (Company Master)
// ============================================================================

// @desc    Create new header/company
// @route   POST /api/masters/headers
// @access  Private
exports.createHeader = async (req, res) => {
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

    // Resolve the final prefix upfront (user-supplied or auto-generated from company name)
    const resolvedPrefix = (bill_prefix && bill_prefix.trim() !== '')
      ? bill_prefix.trim().toUpperCase()
      : company_name.substring(0, 3).toUpperCase();

    // Check uniqueness on the resolved prefix — covers both paths
    const prefixCheck = await query(
      'SELECT id FROM header_master WHERE UPPER(bill_prefix) = $1',
      [resolvedPrefix]
    );
    if (prefixCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Bill prefix "${resolvedPrefix}" is already used by another company. Please provide a different prefix in the Bill Prefix field.`
      });
    }

    // Insert header — bank accounts are added separately via POST /headers/:id/bank-accounts
    const headerResult = await query(
      `INSERT INTO header_master
       (company_name, proprietor_name, address_line1, address_line2, city, state,
        pincode, phone, email, gstin, pan, bill_prefix, upi_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [company_name, proprietor_name, address_line1, address_line2, city, state,
       pincode, phone, email, gstinValue, panValue, resolvedPrefix, upi_id]
    );

    res.status(201).json({
      success: true,
      message: 'Company created successfully',
      data: headerResult.rows[0]
    });
  } catch (error) {
    console.error('Create header error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create company',
      error: error.message
    });
  }
};

// @desc    Get all bank accounts (for Mark Payment dropdown)
// @route   GET /api/masters/bank-accounts
// @access  Private
exports.getBankAccounts = async (req, res) => {
  try {
    const result = await query(
      `SELECT
         hbd.id,
         hbd.header_id,
         hbd.nick_name,
         hbd.is_primary,
         hbd.bank_name,
         hbd.account_number,
         hbd.account_holder_name,
         hbd.ifsc_code,
         hbd.branch_name,
         hm.company_name
       FROM header_bank_details hbd
       JOIN header_master hm ON hm.id = hbd.header_id
       WHERE hbd.bank_name IS NOT NULL
       ORDER BY hm.company_name ASC, hbd.is_primary DESC`
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
      'SELECT * FROM header_bank_details WHERE header_id = $1 ORDER BY is_primary DESC, id ASC',
      [id]
    );

    res.json({
      success: true,
      data: {
        ...headerResult.rows[0],
        bank_details: bankResult.rows   // all accounts, primary first
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

    // NOTE: Bank details are no longer upserted here — they are managed
    // individually via the dedicated bank account endpoints (add/edit/delete).
    // The old ON CONFLICT (header_id) DO UPDATE pattern broke when the UNIQUE
    // constraint on header_id was dropped for multi-bank support (migration 006).

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

// ============================================================================
// BANK ACCOUNTS (per company)
// ============================================================================

// @desc    Get all bank accounts for a company
// @route   GET /api/masters/headers/:id/bank-accounts
// @access  Private
exports.getBankAccountsByHeader = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT * FROM header_bank_details WHERE header_id = $1 ORDER BY is_primary DESC, id ASC`,
      [id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get bank accounts error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bank accounts', error: error.message });
  }
};

// @desc    Add a bank account to a company
// @route   POST /api/masters/headers/:id/bank-accounts
// @access  Private (CA / SUPERADMIN)
exports.addBankAccount = async (req, res) => {
  const client = await require('../config/database').pool.connect();
  try {
    const { id } = req.params;
    const { bank_name, account_holder_name, account_number, ifsc_code, branch_name, nick_name, is_primary } = req.body;

    // Verify company exists
    const companyCheck = await client.query('SELECT id FROM header_master WHERE id = $1', [id]);
    if (companyCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    await client.query('BEGIN');

    // If this account is being set as primary, demote all others for this company first
    if (is_primary) {
      await client.query(
        `UPDATE header_bank_details SET is_primary = false WHERE header_id = $1`,
        [id]
      );
    }

    // If this is the first account for the company, force it to be primary regardless
    const existingCount = await client.query(
      `SELECT COUNT(*) AS cnt FROM header_bank_details WHERE header_id = $1`,
      [id]
    );
    const forcesPrimary = parseInt(existingCount.rows[0].cnt) === 0 ? true : (is_primary || false);

    const result = await client.query(
      `INSERT INTO header_bank_details
         (header_id, bank_name, account_holder_name, account_number, ifsc_code, branch_name, nick_name, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [id, bank_name || null, account_holder_name || null, account_number || null,
       ifsc_code || null, branch_name || null, nick_name || null, forcesPrimary]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Bank account added successfully',
      data: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Add bank account error:', error);
    res.status(500).json({ success: false, message: 'Failed to add bank account', error: error.message });
  } finally {
    client.release();
  }
};

// @desc    Update a bank account
// @route   PUT /api/masters/headers/:id/bank-accounts/:bankId
// @access  Private (CA / SUPERADMIN)
exports.updateBankAccount = async (req, res) => {
  const client = await require('../config/database').pool.connect();
  try {
    const { id, bankId } = req.params;
    const { bank_name, account_holder_name, account_number, ifsc_code, branch_name, nick_name, is_primary } = req.body;

    // Verify this bank account belongs to this company
    const ownerCheck = await client.query(
      `SELECT id FROM header_bank_details WHERE id = $1 AND header_id = $2`,
      [bankId, id]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bank account not found for this company' });
    }

    await client.query('BEGIN');

    // If setting this account as primary, demote all others for this company
    if (is_primary) {
      await client.query(
        `UPDATE header_bank_details SET is_primary = false WHERE header_id = $1`,
        [id]
      );
    }

    const result = await client.query(
      `UPDATE header_bank_details
       SET bank_name           = COALESCE($1, bank_name),
           account_holder_name = COALESCE($2, account_holder_name),
           account_number      = COALESCE($3, account_number),
           ifsc_code           = COALESCE($4, ifsc_code),
           branch_name         = COALESCE($5, branch_name),
           nick_name           = COALESCE($6, nick_name),
           is_primary          = COALESCE($7, is_primary)
       WHERE id = $8 AND header_id = $9
       RETURNING *`,
      [bank_name, account_holder_name, account_number, ifsc_code, branch_name, nick_name, is_primary, bankId, id]
    );

    await client.query('COMMIT');

    res.json({ success: true, message: 'Bank account updated successfully', data: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update bank account error:', error);
    res.status(500).json({ success: false, message: 'Failed to update bank account', error: error.message });
  } finally {
    client.release();
  }
};

// @desc    Delete a bank account
// @route   DELETE /api/masters/headers/:id/bank-accounts/:bankId
// @access  Private (CA / SUPERADMIN)
exports.deleteBankAccount = async (req, res) => {
  const client = await require('../config/database').pool.connect();
  try {
    const { id, bankId } = req.params;

    // Verify this bank account belongs to this company
    const ownerCheck = await client.query(
      `SELECT id, is_primary FROM header_bank_details WHERE id = $1 AND header_id = $2`,
      [bankId, id]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bank account not found for this company' });
    }

    // Block deletion if any bill (DRAFT or FINALIZED) references this bank account
    const billCheck = await client.query(
      `SELECT COUNT(*) AS cnt FROM bills WHERE bank_account_id = $1`,
      [bankId]
    );
    if (parseInt(billCheck.rows[0].cnt) > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete — ${billCheck.rows[0].cnt} bill(s) are using this bank account. Please reassign those bills to a different account first.`
      });
    }

    // Block deletion if this is the only account for the company
    const countCheck = await client.query(
      `SELECT COUNT(*) AS cnt FROM header_bank_details WHERE header_id = $1`,
      [id]
    );
    if (parseInt(countCheck.rows[0].cnt) <= 1) {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete the only bank account for a company. Add another account first, then delete this one.'
      });
    }

    await client.query('BEGIN');

    await client.query(`DELETE FROM header_bank_details WHERE id = $1`, [bankId]);

    // If the deleted account was primary, promote the oldest remaining account
    if (ownerCheck.rows[0].is_primary) {
      await client.query(
        `UPDATE header_bank_details SET is_primary = true
         WHERE id = (SELECT id FROM header_bank_details WHERE header_id = $1 ORDER BY id ASC LIMIT 1)`,
        [id]
      );
    }

    await client.query('COMMIT');

    res.json({ success: true, message: 'Bank account deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete bank account error:', error);
    // ON DELETE RESTRICT FK violation from bills.bank_account_id
    if (error.code === '23503') {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete — bills are referencing this bank account. Please reassign them first.'
      });
    }
    res.status(500).json({ success: false, message: 'Failed to delete bank account', error: error.message });
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

    // Check bills.header_id (standard FK — bills created under this company)
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

    // Check bills.override_header_id (SUPERADMIN can reassign a bill's company header)
    // This FK was previously missed, causing a cryptic DB-level FK violation error.
    const overrideCheck = await query(
      'SELECT COUNT(*) AS cnt FROM bills WHERE override_header_id = $1',
      [id]
    );
    if (parseInt(overrideCheck.rows[0].cnt) > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete — ${overrideCheck.rows[0].cnt} bill(s) reference this company as their override header. Please update those bills first.`
      });
    }

    // Check bills.bank_account_id — bills reference a specific bank account, which
    // belongs to this company via header_bank_details. If any bank account of this
    // company is referenced by a bill, the cascade through header_bank_details
    // (ON DELETE CASCADE from header_master) would be blocked by the RESTRICT FK on bills.
    const bankBillCheck = await query(
      `SELECT COUNT(*) AS cnt
       FROM bills b
       JOIN header_bank_details hbd ON hbd.id = b.bank_account_id
       WHERE hbd.header_id = $1`,
      [id]
    );
    if (parseInt(bankBillCheck.rows[0].cnt) > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete — ${bankBillCheck.rows[0].cnt} bill(s) are linked to a bank account of this company. Please reassign those bills to a different company/account first.`
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
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};