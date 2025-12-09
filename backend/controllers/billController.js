const { query } = require('../config/database');

// @desc    Create new bill with services
// @route   POST /api/bills
// @access  Private
exports.createBill = async (req, res) => {
  const client = await require('../config/database').pool.connect();
  
  try {
      const { header_id, bill_date, payment_term_id, client_id, services, notes } = req.body;  

    // Validate input
    if (!header_id || !bill_date || !payment_term_id || !services || services.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    await client.query('BEGIN');

    // Insert bill (triggers will auto-generate bill_no, financial_year, due_date)
    const billResult = await client.query(
      `INSERT INTO bills (header_id, created_by, bill_date, payment_term_id, client_id, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [header_id, req.user.id, bill_date, payment_term_id, client_id || null, notes || null]
    );

    const bill = billResult.rows[0];

    // Insert services
    for (let i = 0; i < services.length; i++) {
      const service = services[i];
      await client.query(
        `INSERT INTO bill_services 
         (bill_id, sr_no, particulars_id, particulars_other, service_date, service_year, 
          amount, gst_rate_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          bill.id,
          i + 1,
          service.particulars_id,
          service.particulars_other || null,
          service.service_date,
          service.service_year,
          service.amount,
          service.gst_rate_id
        ]
      );
    }

    await client.query('COMMIT');

    // Fetch complete bill with services
    const completeBill = await getBillDetails(bill.id);

    res.status(201).json({
      success: true,
      message: 'Bill created successfully',
      data: completeBill
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

// @desc    Get all bills
// @route   GET /api/bills
// @access  Private
exports.getAllBills = async (req, res) => {
  try {
    const { status, header_id, limit = 50, offset = 0 } = req.query;

    let queryText = `
      SELECT 
        b.*,
        h.company_name,
        u.full_name as created_by_name,
        pt.term_name as payment_term
      FROM bills b
      LEFT JOIN header_master h ON b.header_id = h.id
      LEFT JOIN users u ON b.created_by = u.id
      LEFT JOIN payment_terms_master pt ON b.payment_term_id = pt.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (status) {
      queryText += ` AND b.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    if (header_id) {
      queryText += ` AND b.header_id = $${paramCount}`;
      params.push(header_id);
      paramCount++;
    }

    queryText += ` ORDER BY b.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await query(queryText, params);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
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

// @desc    Get bill by bill number
// @route   GET /api/bills/:billNo
// @access  Private
exports.getBillByNumber = async (req, res) => {
  try {
    const { billNo } = req.params;

    const result = await query(
      'SELECT id FROM bills WHERE bill_no = $1',
      [billNo]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }

    const billId = result.rows[0].id;
    const billDetails = await getBillDetails(billId);

    res.json({
      success: true,
      data: billDetails
    });
  } catch (error) {
    console.error('Get bill error:', error);
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
    const { id } = req.params;
    const { bill_date, payment_term_id, client_id, notes, status, services } = req.body;

    // Check if bill exists and is editable
    const billCheck = await client.query('SELECT status FROM bills WHERE id = $1', [id]);
    
    if (billCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }

    if (billCheck.rows[0].status !== 'DRAFT') {
      return res.status(403).json({
        success: false,
        message: 'Only DRAFT bills can be edited'
      });
    }

    await client.query('BEGIN');

    // Update bill header
    await client.query(
      `UPDATE bills 
       SET bill_date = COALESCE($1, bill_date),
           payment_term_id = COALESCE($2, payment_term_id),
           client_id = COALESCE($3, client_id),
           notes = COALESCE($4, notes),
           status = COALESCE($5, status),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6`,
      [bill_date, payment_term_id, client_id, notes, status, id]
    );

    // If services provided, delete old ones and insert new ones
    if (services && services.length > 0) {
      // Delete existing services
      await client.query('DELETE FROM bill_services WHERE bill_id = $1', [id]);

      // Insert new services
      for (let i = 0; i < services.length; i++) {
        const service = services[i];
        await client.query(
          `INSERT INTO bill_services 
           (bill_id, sr_no, particulars_id, particulars_other, service_date, service_year, 
            amount, gst_rate_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            i + 1,
            service.particulars_id,
            service.particulars_other || null,
            service.service_date,
            service.service_year,
            service.amount,
            service.gst_rate_id
          ]
        );
      }
    }

    await client.query('COMMIT');

    // Fetch updated bill
    const billDetails = await getBillDetails(id);

    res.json({
      success: true,
      message: 'Bill updated successfully',
      data: billDetails
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

// @desc    Delete bill
// @route   DELETE /api/bills/:id
// @access  Private
exports.deleteBill = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query('DELETE FROM bills WHERE id = $1 RETURNING *', [id]);

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

// @desc    Finalize bill (change status from DRAFT to FINALIZED)
// @route   POST /api/bills/:id/finalize
// @access  Private
exports.finalizeBill = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE bills SET status = 'FINALIZED', updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 AND status = 'DRAFT' 
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Bill not found or already finalized'
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

// @desc    Generate PDF for bill
// @route   GET /api/bills/:id/pdf
// @access  Private
exports.generatePDF = async (req, res) => {
  try {
    const { id } = req.params;
    
    // TODO: Implement PDF generation using pdfkit
    // For now, return placeholder
    res.json({
      success: true,
      message: 'PDF generation not yet implemented',
      data: { billId: id }
    });
  } catch (error) {
    console.error('Generate PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate PDF',
      error: error.message
    });
  }
};

// @desc    Send bill via email
// @route   POST /api/bills/:id/email
// @access  Private
exports.sendEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { recipient_email } = req.body;

    if (!recipient_email) {
      return res.status(400).json({
        success: false,
        message: 'Recipient email is required'
      });
    }

    // TODO: Implement email sending using nodemailer
    // Log to bill_history
    await query(
      `INSERT INTO bill_history (bill_id, action_type, action_by, recipient_email, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, 'EMAIL_SENT', req.user.id, recipient_email, 'SUCCESS']
    );

    res.json({
      success: true,
      message: 'Email sent successfully (placeholder)',
      data: { billId: id, recipient: recipient_email }
    });
  } catch (error) {
    console.error('Send email error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send email',
      error: error.message
    });
  }
};

// Helper function to get complete bill details
async function getBillDetails(billId) {
  const billResult = await query(
    `SELECT 
      b.*,
      h.company_name, h.proprietor_name, h.address_line1, h.address_line2,
      h.city, h.state, h.pincode, h.phone, h.email, h.gstin, h.pan,
      hb.bank_name, hb.account_holder_name, hb.account_number, 
      hb.ifsc_code, hb.branch_name, hb.upi_id, hb.qr_code_image,
      pt.term_name as payment_term,
      u.full_name as created_by_name,
      c.client_name, c.contact_person as client_contact, c.phone as client_phone, c.email as client_email
    FROM bills b
    LEFT JOIN header_master h ON b.header_id = h.id
    LEFT JOIN header_bank_details hb ON h.id = hb.header_id
    LEFT JOIN payment_terms_master pt ON b.payment_term_id = pt.id
    LEFT JOIN users u ON b.created_by = u.id
    LEFT JOIN clients_master c ON b.client_id = c.id
    WHERE b.id = $1`,
    [billId]
  );

  const servicesResult = await query(
    `SELECT 
      bs.*,
      p.service_name as particulars_name,
      gr.rate_percentage as gst_rate
    FROM bill_services bs
    LEFT JOIN particulars_master p ON bs.particulars_id = p.id
    LEFT JOIN gst_rates_master gr ON bs.gst_rate_id = gr.id
    WHERE bs.bill_id = $1
    ORDER BY bs.sr_no`,
    [billId]
  );

  return {
    ...billResult.rows[0],
    services: servicesResult.rows
  };
}

// @desc    Add service to existing bill
// @route   POST /api/bills/:id/services
// @access  Private
exports.addServiceToBill = async (req, res) => {
  try {
    const { id } = req.params;
    const { particulars_id, particulars_other, service_date, service_year, amount, gst_rate_id } = req.body;

    // Check if bill is DRAFT
    const billCheck = await query('SELECT status FROM bills WHERE id = $1', [id]);
    
    if (billCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }

    if (billCheck.rows[0].status !== 'DRAFT') {
      return res.status(403).json({
        success: false,
        message: 'Can only add services to DRAFT bills'
      });
    }

    // Get next sr_no
    const srNoResult = await query(
      'SELECT COALESCE(MAX(sr_no), 0) + 1 as next_sr_no FROM bill_services WHERE bill_id = $1',
      [id]
    );
    const nextSrNo = srNoResult.rows[0].next_sr_no;

    // Insert service
    await query(
      `INSERT INTO bill_services 
       (bill_id, sr_no, particulars_id, particulars_other, service_date, service_year, 
        amount, gst_rate_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, nextSrNo, particulars_id, particulars_other || null, service_date, service_year, amount, gst_rate_id]
    );

    res.status(201).json({
      success: true,
      message: 'Service added successfully'
    });
  } catch (error) {
    console.error('Add service error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add service',
      error: error.message
    });
  }
};

// @desc    Delete service from bill
// @route   DELETE /api/bills/services/:serviceId
// @access  Private
exports.deleteService = async (req, res) => {
  try {
    const { serviceId } = req.params;

    // Check if service exists and bill is DRAFT
    const serviceCheck = await query(
      `SELECT bs.bill_id, b.status 
       FROM bill_services bs
       JOIN bills b ON bs.bill_id = b.id
       WHERE bs.id = $1`,
      [serviceId]
    );

    if (serviceCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    if (serviceCheck.rows[0].status !== 'DRAFT') {
      return res.status(403).json({
        success: false,
        message: 'Can only delete services from DRAFT bills'
      });
    }

    // Delete service
    await query('DELETE FROM bill_services WHERE id = $1', [serviceId]);

    res.json({
      success: true,
      message: 'Service deleted successfully'
    });
  } catch (error) {
    console.error('Delete service error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete service',
      error: error.message
    });
  }
};