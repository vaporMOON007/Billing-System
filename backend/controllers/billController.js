const { query } = require('../config/database');

// @desc    Create new bill
// @route   POST /api/bills
// @access  Private
exports.createBill = async (req, res) => {
  const client = await require('../config/database').pool.connect();
  
  try {
    await client.query('BEGIN');

    const {
      header_id,
      client_id,
      bill_date,
      due_date,
      financial_year,
      services
    } = req.body;

    const userId = req.user.id;

    // Create bill
    const billResult = await client.query(
      `INSERT INTO bills 
       (header_id, client_id, bill_date, due_date, financial_year, created_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'DRAFT')
       RETURNING *`,
      [header_id, client_id, bill_date, due_date, financial_year, userId]
    );

    const bill = billResult.rows[0];

    // Insert services
    let totalInvoiceValue = 0;
    for (const service of services) {
      const serviceResult = await client.query(
        `INSERT INTO bill_services 
         (bill_id, particulars_id, sac_code, quantity, rate, amount, gst_rate_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          bill.id,
          service.particulars_id,
          service.sac_code,
          service.quantity,
          service.rate,
          service.amount,
          service.gst_rate_id
        ]
      );

      // Get GST rate to calculate total
      const gstRate = await client.query(
        'SELECT rate_percentage FROM gst_rates_master WHERE id = $1',
        [service.gst_rate_id]
      );

      const gstAmount = service.amount * (gstRate.rows[0].rate_percentage / 100);
      totalInvoiceValue += service.amount + gstAmount;
    }

    // Update bill with total
    await client.query(
      'UPDATE bills SET total_invoice_value = $1 WHERE id = $2',
      [totalInvoiceValue, bill.id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Bill created successfully',
      data: { ...bill, total_invoice_value: totalInvoiceValue }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create bill error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create bill',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// @desc    Get all bills with filters
// @route   GET /api/bills
// @access  Private
exports.getAllBills = async (req, res) => {
  try {
    const {
      status,
      payment_status,
      client_id,
      date_from,
      date_to,
      created_by,
      header_id,
      limit = 50,
      offset = 0
    } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramCount = 1;

    if (status) {
      whereClause += ` AND b.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    if (payment_status) {
      whereClause += ` AND b.payment_status = $${paramCount}`;
      params.push(payment_status);
      paramCount++;
    }

    if (client_id) {
      whereClause += ` AND b.client_id = $${paramCount}`;
      params.push(client_id);
      paramCount++;
    }

    if (header_id) {
      whereClause += ` AND b.header_id = $${paramCount}`;
      params.push(header_id);
      paramCount++;
    }

    if (date_from) {
      whereClause += ` AND b.bill_date >= $${paramCount}`;
      params.push(date_from);
      paramCount++;
    }

    if (date_to) {
      whereClause += ` AND b.bill_date <= $${paramCount}`;
      params.push(date_to);
      paramCount++;
    }

    if (created_by) {
      whereClause += ` AND b.created_by = $${paramCount}`;
      params.push(created_by);
      paramCount++;
    }

    // Add limit and offset
    whereClause += ` ORDER BY b.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await query(
      `SELECT 
        b.*,
        h.company_name,
        c.client_name,
        u.full_name as created_by_name
      FROM bills b
      LEFT JOIN header_master h ON b.header_id = h.id
      LEFT JOIN clients_master c ON b.client_id = c.id
      LEFT JOIN users u ON b.created_by = u.id
      ${whereClause}`,
      params
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM bills b ${whereClause.split('ORDER BY')[0]}`,
      params.slice(0, -2)
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    console.error('Get bills error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bills',
      error: error.message
    });
  }
};

// @desc    Get bill by ID
// @route   GET /api/bills/:id
// @access  Private
exports.getBillById = async (req, res) => {
  try {
    const { id } = req.params;

    // Get bill details
    const billResult = await query(
      `SELECT 
        b.*,
        h.*,
        c.client_name,
        c.contact_person,
        c.phone as client_phone,
        c.email as client_email,
        c.gstin as client_gstin,
        c.address_line1 as client_address_line1,
        c.address_line2 as client_address_line2,
        c.city as client_city,
        c.state as client_state,
        c.pincode as client_pincode
      FROM bills b
      LEFT JOIN header_master h ON b.header_id = h.id
      LEFT JOIN clients_master c ON b.client_id = c.id
      WHERE b.id = $1`,
      [id]
    );

    if (billResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }

    // Get bill services
    const servicesResult = await query(
      `SELECT 
        bs.*,
        p.service_name,
        gr.rate_name,
        gr.rate_percentage
      FROM bill_services bs
      LEFT JOIN particulars_master p ON bs.particulars_id = p.id
      LEFT JOIN gst_rates_master gr ON bs.gst_rate_id = gr.id
      WHERE bs.bill_id = $1
      ORDER BY bs.id`,
      [id]
    );

    const bill = {
      ...billResult.rows[0],
      services: servicesResult.rows
    };

    res.json({
      success: true,
      data: bill
    });
  } catch (error) {
    console.error('Get bill by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bill',
      error: error.message
    });
  }
};

// @desc    Update bill
// @route   PUT /api/bills/:id
// @access  Private
exports.updateBill = async (req, res) => {
  const client = await require('../config/database').pool.connect();
  
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const {
      header_id,
      client_id,
      bill_date,
      due_date,
      services
    } = req.body;

    // Update bill
    const billResult = await client.query(
      `UPDATE bills 
       SET header_id = COALESCE($1, header_id),
           client_id = COALESCE($2, client_id),
           bill_date = COALESCE($3, bill_date),
           due_date = COALESCE($4, due_date),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [header_id, client_id, bill_date, due_date, id]
    );

    if (billResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }

    // Delete existing services if new services provided
    if (services && services.length > 0) {
      await client.query('DELETE FROM bill_services WHERE bill_id = $1', [id]);

      // Insert new services
      let totalInvoiceValue = 0;
      for (const service of services) {
        await client.query(
          `INSERT INTO bill_services 
           (bill_id, particulars_id, sac_code, quantity, rate, amount, gst_rate_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            id,
            service.particulars_id,
            service.sac_code,
            service.quantity,
            service.rate,
            service.amount,
            service.gst_rate_id
          ]
        );

        // Get GST rate to calculate total
        const gstRate = await client.query(
          'SELECT rate_percentage FROM gst_rates_master WHERE id = $1',
          [service.gst_rate_id]
        );

        const gstAmount = service.amount * (gstRate.rows[0].rate_percentage / 100);
        totalInvoiceValue += service.amount + gstAmount;
      }

      // Update bill with new total
      await client.query(
        'UPDATE bills SET total_invoice_value = $1 WHERE id = $2',
        [totalInvoiceValue, id]
      );
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Bill updated successfully',
      data: billResult.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update bill error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update bill',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// @desc    Finalize bill
// @route   PUT /api/bills/:id/finalize
// @access  Private
exports.finalizeBill = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE bills 
       SET status = 'FINALIZED', 
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }

    res.json({
      success: true,
      message: 'Bill finalized successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Finalize bill error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to finalize bill',
      error: error.message
    });
  }
};

// @desc    Delete bill
// @route   DELETE /api/bills/:id
// @access  Private
exports.deleteBill = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query('DELETE FROM bills WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }

    res.json({
      success: true,
      message: 'Bill deleted successfully'
    });
  } catch (error) {
    console.error('Delete bill error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete bill',
      error: error.message
    });
  }
};

// @desc    Search bill by number
// @route   GET /api/bills/search/:billNo
// @access  Private
exports.searchBillByNumber = async (req, res) => {
  try {
    const { billNo } = req.params;

    const result = await query(
      `SELECT 
        b.*,
        h.company_name,
        c.client_name
      FROM bills b
      LEFT JOIN header_master h ON b.header_id = h.id
      LEFT JOIN clients_master c ON b.client_id = c.id
      WHERE b.bill_no = $1`,
      [billNo]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Search bill error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search bill',
      error: error.message
    });
  }
};

// @desc    Preview next bill number
// @route   GET /api/bills/preview-number
// @access  Private
exports.previewBillNumber = async (req, res) => {
  try {
    const { header_id, bill_date } = req.query;

    if (!header_id || !bill_date) {
      return res.status(400).json({
        success: false,
        message: 'Header ID and bill date are required'
      });
    }

    // Get financial year from date
    const date = new Date(bill_date);
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    const financial_year = month >= 4 
      ? `${year}-${String(year + 1).slice(-2)}`
      : `${year - 1}-${String(year).slice(-2)}`;

    // Get company prefix
    const headerResult = await query(
      'SELECT bill_prefix, company_name FROM header_master WHERE id = $1',
      [header_id]
    );

    if (headerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const prefix = headerResult.rows[0].bill_prefix || 
                   headerResult.rows[0].company_name.substring(0, 3).toUpperCase();

    // Get next number
    const counterResult = await query(
      'SELECT last_number FROM bill_number_counters WHERE header_id = $1 AND financial_year = $2',
      [header_id, financial_year]
    );

    const nextNumber = counterResult.rows.length > 0 
      ? counterResult.rows[0].last_number + 1 
      : 1;

    const billNo = `INV-${prefix}-${String(nextNumber).padStart(3, '0')}`;

    res.json({
      success: true,
      data: {
        bill_no: billNo,
        financial_year,
        next_number: nextNumber
      }
    });
  } catch (error) {
    console.error('Preview bill number error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to preview bill number',
      error: error.message
    });
  }
};