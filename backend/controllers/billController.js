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
      payment_term_id,
      notes,
      services
    } = req.body;

    const userId = req.user.id;

    // Calculate financial year from bill_date (e.g., "2024-25")
    const dateObj = new Date(bill_date);
    const month = dateObj.getMonth() + 1;
    const year = dateObj.getFullYear();
    const fyStart = month >= 4 ? year : year - 1;
    const fyEnd = fyStart + 1;
    const financial_year = `${fyStart}-${String(fyEnd).slice(-2)}`;

    // Calculate due_date from payment_terms_master
    let due_date = null;
    if (payment_term_id) {
      const termResult = await client.query(
        'SELECT days_to_add FROM payment_terms_master WHERE id = $1',
        [payment_term_id]
      );
      if (termResult.rows.length > 0) {
        const daysToAdd = termResult.rows[0].days_to_add;
        const dueDateObj = new Date(bill_date);
        dueDateObj.setDate(dueDateObj.getDate() + daysToAdd);
        due_date = dueDateObj.toISOString().split('T')[0];
      }
    }

    // Create bill — bill_no is auto-assigned by DB trigger
    const billResult = await client.query(
      `INSERT INTO bills
       (header_id, client_id, bill_date, due_date, financial_year, payment_term_id, notes, created_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT')
       RETURNING *`,
      [header_id, client_id || null, bill_date, due_date, financial_year,
       payment_term_id || null, notes || null, userId]
    );

    const bill = billResult.rows[0];

    // Insert services — sr_no is required (NOT NULL), total_amount is DB-generated
    for (let i = 0; i < services.length; i++) {
      const service = services[i];
      await client.query(
        `INSERT INTO bill_services
         (bill_id, sr_no, particulars_id, particulars_other, service_date, service_year, amount, gst_rate_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          bill.id,
          i + 1,
          service.particulars_id,
          service.particulars_other || null,
          service.service_date || null,
          service.service_year || null,
          service.amount,
          service.gst_rate_id
        ]
      );
    }

    await client.query('COMMIT');

    // Re-fetch bill to get DB-computed values (bill_no, total_invoice_value set by triggers).
    // If the re-fetch fails for any reason the bill is already committed — fall back gracefully.
    let billData = bill;
    try {
      const refreshResult = await require('../config/database').query(
        'SELECT * FROM bills WHERE id = $1',
        [bill.id]
      );
      if (refreshResult.rows.length > 0) {
        billData = refreshResult.rows[0];
      }
    } catch (refetchError) {
      console.error('Re-fetch after create failed (bill was still saved):', refetchError.message);
    }

    res.status(201).json({
      success: true,
      message: 'Bill created successfully',
      data: billData
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {}); // ROLLBACK may fail if COMMIT already ran
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

    // Get bill details.
    // IMPORTANT: do NOT use h.* — header_master also has id/created_at/updated_at which
    // would overwrite b.id via pg spread, breaking every downstream ID lookup.
    // Bank details live in a SEPARATE table (header_bank_details), not in header_master.
    // We select explicit h/hb/c columns (not h.*) to avoid column name collision.
    // h.id, h.created_at, h.updated_at would overwrite b.id etc. if we used h.*.
    const billResult = await query(
      `SELECT
        b.*,
        h.company_name,
        h.proprietor_name,
        h.address_line1    AS header_address_line1,
        h.address_line2    AS header_address_line2,
        h.city             AS header_city,
        h.state            AS header_state,
        h.pincode          AS header_pincode,
        h.phone,
        h.email,
        h.gstin,
        h.pan,
        h.bill_prefix,
        h.upi_id,
        hb.bank_name,
        hb.account_holder_name,
        hb.account_number,
        hb.ifsc_code,
        hb.branch_name,
        c.client_name,
        c.contact_person,
        c.phone            AS client_phone,
        c.email            AS client_email,
        c.gstin            AS client_gstin,
        c.address_line1    AS client_address_line1,
        c.address_line2    AS client_address_line2,
        c.city             AS client_city,
        c.state            AS client_state,
        c.pincode          AS client_pincode
      FROM bills b
      LEFT JOIN header_master h  ON b.header_id = h.id
      LEFT JOIN header_bank_details hb ON hb.header_id = h.id
      LEFT JOIN clients_master c  ON b.client_id = c.id
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
    console.error('Get bill by ID error:', error.message);
    console.error('Full error:', error);

    // If the query fails because header_bank_details doesn't exist,
    // fall back to a simpler query without the bank details join.
    if (error.message && error.message.includes('header_bank_details')) {
      try {
        const { id } = req.params;
        console.log('Retrying getBillById WITHOUT header_bank_details for bill', id);
        const billResult = await query(
          `SELECT
            b.*,
            h.company_name,
            h.proprietor_name,
            h.address_line1    AS header_address_line1,
            h.address_line2    AS header_address_line2,
            h.city             AS header_city,
            h.state            AS header_state,
            h.pincode          AS header_pincode,
            h.phone,
            h.email,
            h.gstin,
            h.pan,
            h.bill_prefix,
            h.upi_id,
            c.client_name,
            c.contact_person,
            c.phone            AS client_phone,
            c.email            AS client_email,
            c.gstin            AS client_gstin,
            c.address_line1    AS client_address_line1,
            c.address_line2    AS client_address_line2,
            c.city             AS client_city,
            c.state            AS client_state,
            c.pincode          AS client_pincode
          FROM bills b
          LEFT JOIN header_master h  ON b.header_id = h.id
          LEFT JOIN clients_master c  ON b.client_id = c.id
          WHERE b.id = $1`,
          [id]
        );

        if (billResult.rows.length === 0) {
          return res.status(404).json({ success: false, message: 'Bill not found' });
        }

        const servicesResult = await query(
          `SELECT bs.*, p.service_name, gr.rate_percentage
           FROM bill_services bs
           LEFT JOIN particulars_master p ON bs.particulars_id = p.id
           LEFT JOIN gst_rates_master gr ON bs.gst_rate_id = gr.id
           WHERE bs.bill_id = $1 ORDER BY bs.id`,
          [id]
        );

        return res.json({
          success: true,
          data: { ...billResult.rows[0], services: servicesResult.rows }
        });
      } catch (fallbackError) {
        console.error('Fallback query also failed:', fallbackError.message);
      }
    }

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
      payment_term_id,
      notes,
      services
    } = req.body;

    // Recalculate due_date if both payment_term_id and bill_date are provided
    let due_date = null;
    const effectiveBillDate = bill_date || (
      await client.query('SELECT bill_date FROM bills WHERE id = $1', [id])
    ).rows[0]?.bill_date;

    if (payment_term_id && effectiveBillDate) {
      const termResult = await client.query(
        'SELECT days_to_add FROM payment_terms_master WHERE id = $1',
        [payment_term_id]
      );
      if (termResult.rows.length > 0) {
        const daysToAdd = termResult.rows[0].days_to_add;
        const dueDateObj = new Date(effectiveBillDate);
        dueDateObj.setDate(dueDateObj.getDate() + daysToAdd);
        due_date = dueDateObj.toISOString().split('T')[0];
      }
    }

    // Update bill header fields — only DRAFT bills can be updated
    const billResult = await client.query(
      `UPDATE bills
       SET header_id = COALESCE($1, header_id),
           client_id = COALESCE($2, client_id),
           bill_date = COALESCE($3, bill_date),
           due_date = COALESCE($4, due_date),
           payment_term_id = COALESCE($5, payment_term_id),
           notes = $6,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $7 AND status = 'DRAFT'
       RETURNING *`,
      [header_id || null, client_id || null, bill_date || null,
       due_date || null, payment_term_id || null,
       notes !== undefined ? notes : null, id]
    );

    if (billResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Bill not found or is not in DRAFT status'
      });
    }

    // Replace services if new list provided
    if (services && services.length > 0) {
      await client.query('DELETE FROM bill_services WHERE bill_id = $1', [id]);

      for (let i = 0; i < services.length; i++) {
        const service = services[i];
        await client.query(
          `INSERT INTO bill_services
           (bill_id, sr_no, particulars_id, particulars_other, service_date, service_year, amount, gst_rate_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            i + 1,
            service.particulars_id,
            service.particulars_other || null,
            service.service_date || null,
            service.service_year || null,
            service.amount,
            service.gst_rate_id
          ]
        );
      }
    }

    await client.query('COMMIT');

    // Re-fetch with DB-computed total_invoice_value — fall back to basic row if re-fetch fails
    let updatedBillData = billResult.rows[0];
    try {
      const refreshResult = await require('../config/database').query(
        'SELECT * FROM bills WHERE id = $1',
        [id]
      );
      if (refreshResult.rows.length > 0) {
        updatedBillData = refreshResult.rows[0];
      }
    } catch (refetchError) {
      console.error('Re-fetch after update failed (bill was still saved):', refetchError.message);
    }

    res.json({
      success: true,
      message: 'Bill updated successfully',
      data: updatedBillData
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
  const client = await require('../config/database').pool.connect();

  try {
    const { id } = req.params;

    // Verify the bill exists first
    const checkResult = await client.query('SELECT id, bill_no FROM bills WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }

    // Auto-repair the broken delete trigger function (wrong column name total_amount → total_invoice_value).
    // Safe to run on every delete call — CREATE OR REPLACE is idempotent.
    await client.query(`
      CREATE OR REPLACE FUNCTION update_bill_payment_status_on_delete()
      RETURNS TRIGGER AS $$
      DECLARE
          v_total_invoice  NUMERIC;
          v_total_paid     NUMERIC;
          v_new_status     TEXT;
      BEGIN
          SELECT COALESCE(SUM(amount_paid), 0)
          INTO v_total_paid
          FROM bill_payments
          WHERE bill_id = OLD.bill_id;

          SELECT COALESCE(total_invoice_value, 0)
          INTO v_total_invoice
          FROM bills
          WHERE id = OLD.bill_id;

          IF v_total_paid <= 0 THEN
              v_new_status := 'UNPAID';
          ELSIF v_total_paid < v_total_invoice THEN
              v_new_status := 'PARTIAL';
          ELSE
              v_new_status := 'PAID';
          END IF;

          UPDATE public.bills
          SET payment_status = v_new_status,
              total_paid     = v_total_paid,
              updated_at     = CURRENT_TIMESTAMP
          WHERE id = OLD.bill_id;

          RETURN OLD;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query('BEGIN');

    // Delete child records in dependency order to satisfy FK constraints
    // (edit locks are stored in-memory — no DB table to delete from)
    await client.query('DELETE FROM bill_payments WHERE bill_id = $1', [id]);
    await client.query('DELETE FROM bill_services WHERE bill_id = $1', [id]);
    await client.query('DELETE FROM bills WHERE id = $1', [id]);

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Bill deleted successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Delete bill error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete bill',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// @desc    Search bill by number
// @route   GET /api/bills/search/:billNo
// @access  Private
exports.searchBillByNumber = async (req, res) => {
  try {
    const billNo = req.query.bill_no || req.params.billNo;

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

// ============================================================================
// IN-MEMORY EDIT LOCK STORE
// ============================================================================

const activeLocks = new Map(); // billId -> { userId, userName, expiresAt }
const LOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes

const cleanExpiredLocks = () => {
  const now = Date.now();
  for (const [billId, lock] of activeLocks.entries()) {
    if (lock.expiresAt < now) activeLocks.delete(billId);
  }
};

// @desc    Acquire edit lock on a bill
// @route   POST /api/bills/:id/lock
// @access  Private
exports.acquireLock = async (req, res) => {
  try {
    cleanExpiredLocks();
    const { id } = req.params;
    const userId = req.user.id;
    const userName = req.user.full_name || req.user.username;
    const now = Date.now();

    const existingLock = activeLocks.get(id);

    if (existingLock && existingLock.expiresAt > now && existingLock.userId !== userId) {
      return res.json({
        success: false,
        lockedBy: existingLock.userId,
        lockedByName: existingLock.userName,
        expiresAt: new Date(existingLock.expiresAt).toISOString()
      });
    }

    const expiresAt = now + LOCK_DURATION_MS;
    activeLocks.set(id, { userId, userName, expiresAt });

    res.json({
      success: true,
      userName,
      expiresAt: new Date(expiresAt).toISOString()
    });
  } catch (error) {
    console.error('Acquire lock error:', error);
    res.status(500).json({ success: false, message: 'Failed to acquire lock', error: error.message });
  }
};

// @desc    Refresh edit lock (heartbeat)
// @route   PUT /api/bills/:id/lock/refresh
// @access  Private
exports.refreshLock = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const existingLock = activeLocks.get(id);
    if (existingLock && existingLock.userId === userId) {
      existingLock.expiresAt = Date.now() + LOCK_DURATION_MS;
      activeLocks.set(id, existingLock);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Refresh lock error:', error);
    res.status(500).json({ success: false, message: 'Failed to refresh lock' });
  }
};

// @desc    Release edit lock
// @route   DELETE /api/bills/:id/lock
// @access  Private
exports.releaseLock = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const existingLock = activeLocks.get(id);
    if (existingLock && existingLock.userId === userId) {
      activeLocks.delete(id);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Release lock error:', error);
    res.status(500).json({ success: false, message: 'Failed to release lock' });
  }
};

// @desc    Check lock status on a bill
// @route   GET /api/bills/:id/lock
// @access  Private
exports.checkLock = async (req, res) => {
  try {
    cleanExpiredLocks();
    const { id } = req.params;
    const now = Date.now();

    const existingLock = activeLocks.get(id);

    if (!existingLock || existingLock.expiresAt <= now) {
      return res.json({ isLocked: false, lockedBy: null, lockedByName: null, expiresAt: null });
    }

    res.json({
      isLocked: true,
      lockedBy: existingLock.userId,
      lockedByName: existingLock.userName,
      expiresAt: new Date(existingLock.expiresAt).toISOString()
    });
  } catch (error) {
    console.error('Check lock error:', error);
    res.status(500).json({ success: false, message: 'Failed to check lock' });
  }
};

// ============================================================================
// PDF GENERATION
// ============================================================================

// @desc    Generate PDF invoice for a bill
// @route   GET /api/bills/:id/pdf
// @access  Private
exports.generatePDF = async (req, res) => {
  try {
    const { id } = req.params;

    const billResult = await query(
      `SELECT
        b.*,
        h.company_name, h.proprietor_name, h.address_line1, h.address_line2,
        h.city, h.state, h.pincode, h.phone as company_phone, h.email as company_email,
        h.gstin as company_gstin, h.pan, h.upi_id,
        hbd.bank_name, hbd.account_number, hbd.ifsc_code, hbd.branch_name,
        c.client_name, c.contact_person, c.gstin as client_gstin,
        c.address_line1 as client_address_line1, c.city as client_city,
        c.state as client_state, c.pincode as client_pincode
       FROM bills b
       LEFT JOIN header_master h ON b.header_id = h.id
       LEFT JOIN header_bank_details hbd ON h.id = hbd.header_id
       LEFT JOIN clients_master c ON b.client_id = c.id
       WHERE b.id = $1`,
      [id]
    );

    if (billResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    const bill = billResult.rows[0];

    const servicesResult = await query(
      `SELECT bs.*, p.service_name, gr.rate_percentage
       FROM bill_services bs
       LEFT JOIN particulars_master p ON bs.particulars_id = p.id
       LEFT JOIN gst_rates_master gr ON bs.gst_rate_id = gr.id
       WHERE bs.bill_id = $1
       ORDER BY bs.id`,
      [id]
    );

    const services = servicesResult.rows;
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${bill.bill_no}.pdf"`);
    doc.pipe(res);

    // Company Header
    doc.fontSize(18).font('Helvetica-Bold').text(bill.company_name || '', { align: 'center' });
    doc.fontSize(9).font('Helvetica').text(bill.address_line1 || '', { align: 'center' });
    if (bill.city) doc.text(`${bill.city}, ${bill.state} - ${bill.pincode}`, { align: 'center' });
    doc.text(`GSTIN: ${bill.company_gstin || ''}  |  PAN: ${bill.pan || ''}`, { align: 'center' });
    if (bill.company_phone) doc.text(`Phone: ${bill.company_phone}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    // Invoice Title
    doc.fontSize(14).font('Helvetica-Bold').text('TAX INVOICE', { align: 'center', underline: true });
    doc.moveDown(0.5);

    // Bill Info Row
    doc.fontSize(10).font('Helvetica');
    const billInfoY = doc.y;
    doc.text(`Invoice No: ${bill.bill_no || ''}`, 50, billInfoY);
    doc.text(`Date: ${new Date(bill.bill_date).toLocaleDateString('en-IN')}`, 350, billInfoY);
    doc.moveDown(1);

    // Client Details
    if (bill.client_name) {
      doc.font('Helvetica-Bold').text('Bill To:');
      doc.font('Helvetica').text(bill.client_name);
      if (bill.contact_person) doc.text(bill.contact_person);
      if (bill.client_address_line1) doc.text(bill.client_address_line1);
      if (bill.client_city) doc.text(`${bill.client_city}, ${bill.client_state} - ${bill.client_pincode}`);
      if (bill.client_gstin) doc.text(`GSTIN: ${bill.client_gstin}`);
      doc.moveDown(0.5);
    }

    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.3);

    // Services Table Header
    const tableHeaderY = doc.y;
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Sr', 50, tableHeaderY, { width: 25 });
    doc.text('Description', 75, tableHeaderY, { width: 200 });
    doc.text('Amount', 285, tableHeaderY, { width: 70, align: 'right' });
    doc.text('GST%', 365, tableHeaderY, { width: 50, align: 'right' });
    doc.text('GST Amt', 425, tableHeaderY, { width: 65, align: 'right' });
    doc.text('Total', 495, tableHeaderY, { width: 50, align: 'right' });
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.3);

    // Services Rows
    let subtotal = 0;
    let totalGST = 0;
    doc.font('Helvetica').fontSize(9);

    services.forEach((service, i) => {
      const rowY = doc.y;
      const amt = parseFloat(service.amount) || 0;
      const gstPct = parseFloat(service.rate_percentage) || 0;
      const gstAmt = amt * (gstPct / 100);
      const lineTotal = amt + gstAmt;
      subtotal += amt;
      totalGST += gstAmt;

      doc.text(`${i + 1}`, 50, rowY, { width: 25 });
      doc.text(service.service_name || '', 75, rowY, { width: 200 });
      doc.text(amt.toFixed(2), 285, rowY, { width: 70, align: 'right' });
      doc.text(`${gstPct}%`, 365, rowY, { width: 50, align: 'right' });
      doc.text(gstAmt.toFixed(2), 425, rowY, { width: 65, align: 'right' });
      doc.text(lineTotal.toFixed(2), 495, rowY, { width: 50, align: 'right' });
      doc.moveDown(0.8);
    });

    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.3);

    // Totals
    doc.font('Helvetica').fontSize(10);
    doc.text(`Subtotal: ₹${subtotal.toFixed(2)}`, { align: 'right' });
    doc.text(`Total GST: ₹${totalGST.toFixed(2)}`, { align: 'right' });
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text(`TOTAL: ₹${(subtotal + totalGST).toFixed(2)}`, { align: 'right' });
    doc.moveDown(1);

    // Bank Details
    if (bill.bank_name) {
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(9).text('Bank Details:');
      doc.font('Helvetica').fontSize(9);
      doc.text(`Bank: ${bill.bank_name}  |  A/C No: ${bill.account_number}`);
      doc.text(`IFSC: ${bill.ifsc_code}  |  Branch: ${bill.branch_name || ''}`);
      if (bill.upi_id) doc.text(`UPI ID: ${bill.upi_id}`);
    }

    doc.end();
  } catch (error) {
    console.error('Generate PDF error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to generate PDF', error: error.message });
    }
  }
};

// ============================================================================
// EMAIL
// ============================================================================

// @desc    Send invoice by email
// @route   POST /api/bills/:id/email
// @access  Private
exports.sendEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { to_email, subject, message } = req.body;

    const billResult = await query(
      `SELECT b.*, h.company_name, h.email as company_email,
              c.client_name, c.email as client_email
       FROM bills b
       LEFT JOIN header_master h ON b.header_id = h.id
       LEFT JOIN clients_master c ON b.client_id = c.id
       WHERE b.id = $1`,
      [id]
    );

    if (billResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    const bill = billResult.rows[0];
    const recipientEmail = to_email || bill.client_email;

    if (!recipientEmail) {
      return res.status(400).json({ success: false, message: 'No recipient email address available. Please provide to_email.' });
    }

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT),
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    const billDate = new Date(bill.bill_date).toLocaleDateString('en-IN');
    const totalAmount = parseFloat(bill.total_invoice_value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

    await transporter.sendMail({
      from: `"${bill.company_name}" <${process.env.EMAIL_USER}>`,
      to: recipientEmail,
      subject: subject || `Invoice ${bill.bill_no} from ${bill.company_name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a56db;">${bill.company_name}</h2>
          <p>Dear ${bill.client_name || 'Client'},</p>
          <p>${message || 'Please find your invoice details below.'}</p>
          <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
            <tr style="background: #f3f4f6;">
              <td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Invoice No</strong></td>
              <td style="padding: 8px; border: 1px solid #e5e7eb;">${bill.bill_no}</td>
            </tr>
            <tr>
              <td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Date</strong></td>
              <td style="padding: 8px; border: 1px solid #e5e7eb;">${billDate}</td>
            </tr>
            <tr style="background: #f3f4f6;">
              <td style="padding: 8px; border: 1px solid #e5e7eb;"><strong>Total Amount</strong></td>
              <td style="padding: 8px; border: 1px solid #e5e7eb;">₹${totalAmount}</td>
            </tr>
          </table>
          <p style="color: #6b7280; font-size: 12px;">This is a system-generated email. Please do not reply.</p>
          <p>Regards,<br/><strong>${bill.company_name}</strong></p>
        </div>
      `
    });

    res.json({ success: true, message: `Invoice emailed to ${recipientEmail}` });
  } catch (error) {
    console.error('Send email error:', error);
    res.status(500).json({ success: false, message: 'Failed to send email', error: error.message });
  }
};

// ============================================================================
// SERVICE MANAGEMENT (Individual service add/delete on a bill)
// ============================================================================

// @desc    Add a service to an existing DRAFT bill
// @route   POST /api/bills/:billId/services
// @access  Private
exports.addServiceToBill = async (req, res) => {
  const client = await require('../config/database').pool.connect();
  try {
    const { billId } = req.params;
    const { particulars_id, particulars_other, service_date, service_year, amount, gst_rate_id } = req.body;

    await client.query('BEGIN');

    const billCheck = await client.query('SELECT status FROM bills WHERE id = $1', [billId]);
    if (billCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }
    if (billCheck.rows[0].status === 'FINALIZED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Cannot modify a finalized bill' });
    }

    // Get next sr_no for this bill
    const srResult = await client.query(
      'SELECT COALESCE(MAX(sr_no), 0) + 1 AS next_sr FROM bill_services WHERE bill_id = $1',
      [billId]
    );
    const nextSr = srResult.rows[0].next_sr;

    // Insert service — gst_amount and total_amount are computed by DB triggers
    const serviceResult = await client.query(
      `INSERT INTO bill_services
       (bill_id, sr_no, particulars_id, particulars_other, service_date, service_year, amount, gst_rate_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [billId, nextSr, particulars_id, particulars_other || null,
       service_date || null, service_year || null, amount, gst_rate_id]
    );

    await client.query('COMMIT');
    res.status(201).json({ success: true, message: 'Service added successfully', data: serviceResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Add service error:', error);
    res.status(500).json({ success: false, message: 'Failed to add service', error: error.message });
  } finally {
    client.release();
  }
};

// @desc    Delete a service from a DRAFT bill
// @route   DELETE /api/bills/services/:serviceId
// @access  Private
exports.deleteService = async (req, res) => {
  const client = await require('../config/database').pool.connect();
  try {
    const { serviceId } = req.params;

    await client.query('BEGIN');

    const serviceCheck = await client.query(
      'SELECT bs.bill_id, b.status FROM bill_services bs JOIN bills b ON bs.bill_id = b.id WHERE bs.id = $1',
      [serviceId]
    );

    if (serviceCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    if (serviceCheck.rows[0].status === 'FINALIZED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Cannot modify a finalized bill' });
    }

    const billId = serviceCheck.rows[0].bill_id;

    const countResult = await client.query('SELECT COUNT(*) FROM bill_services WHERE bill_id = $1', [billId]);
    if (parseInt(countResult.rows[0].count) <= 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Cannot delete the last service. A bill must have at least one service.' });
    }

    await client.query('DELETE FROM bill_services WHERE id = $1', [serviceId]);

    // DB trigger (trigger_update_bill_totals) automatically recalculates bill total

    await client.query('COMMIT');
    res.json({ success: true, message: 'Service deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete service error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete service', error: error.message });
  } finally {
    client.release();
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

    // Calculate financial year in 4-char short format matching the DB trigger (e.g., "2425")
    const date = new Date(bill_date);
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    const fyStart = month >= 4 ? year : year - 1;
    const fyEnd = fyStart + 1;
    const fyShort = `${String(fyStart).slice(-2)}${String(fyEnd).slice(-2)}`; // e.g., "2425"
    const financial_year = `${fyStart}-${String(fyEnd).slice(-2)}`; // e.g., "2024-25"

    // Get this company's bill prefix from header_master
    const headerResult = await query(
      'SELECT bill_prefix FROM header_master WHERE id = $1',
      [header_id]
    );

    if (headerResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const prefix = headerResult.rows[0].bill_prefix || 'INV';

    // Read current counter from bill_number_counters (per company + per FY)
    const counterResult = await query(
      'SELECT last_number FROM bill_number_counters WHERE header_id = $1 AND financial_year = $2',
      [header_id, fyShort]
    );

    const nextNumber = counterResult.rows.length > 0
      ? counterResult.rows[0].last_number + 1
      : 1;

    // Format exactly matches DB trigger output: {prefix}/{fyShort}/{3-digit}
    // e.g., "INV/2425/001"
    const next_bill_no = `${prefix}/${fyShort}/${String(nextNumber).padStart(3, '0')}`;

    res.json({
      success: true,
      data: {
        next_bill_no,
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