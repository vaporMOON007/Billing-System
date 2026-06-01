const { query } = require('../config/database');
const { logActivity } = require('./activityLogController');

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
      services,
      bank_account_id
    } = req.body;

    const userId = req.user.id;

    // Validate services array early — before any DB insert
    if (!services || !Array.isArray(services) || services.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'A bill must have at least one service line.'
      });
    }

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

    // Resolve bank_account_id:
    // If provided, validate it belongs to the selected company.
    // If not provided, auto-pick the primary account for the company.
    let resolvedBankAccountId = bank_account_id ? parseInt(bank_account_id) : null;

    if (resolvedBankAccountId) {
      const bankCheck = await client.query(
        `SELECT id FROM header_bank_details WHERE id = $1 AND header_id = $2`,
        [resolvedBankAccountId, header_id]
      );
      if (bankCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'The selected bank account does not belong to the selected company.'
        });
      }
    } else {
      // Auto-pick primary account
      const primaryBank = await client.query(
        `SELECT id FROM header_bank_details WHERE header_id = $1 AND is_primary = true LIMIT 1`,
        [header_id]
      );
      if (primaryBank.rows.length === 0) {
        // Fallback: pick any account
        const anyBank = await client.query(
          `SELECT id FROM header_bank_details WHERE header_id = $1 ORDER BY id ASC LIMIT 1`,
          [header_id]
        );
        if (anyBank.rows.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'This company has no bank account set up. Please add a bank account to the company before creating a bill.'
          });
        }
        resolvedBankAccountId = anyBank.rows[0].id;
      } else {
        resolvedBankAccountId = primaryBank.rows[0].id;
      }
    }

    // Create bill — bill_no is auto-assigned by DB trigger
    const billResult = await client.query(
      `INSERT INTO bills
       (header_id, client_id, bill_date, due_date, financial_year, payment_term_id, notes, created_by, status, bank_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9)
       RETURNING *`,
      [header_id, client_id || null, bill_date, due_date, financial_year,
       payment_term_id || null, notes || null, userId, resolvedBankAccountId]
    );

    const bill = billResult.rows[0];

    // Insert services — sr_no is required (NOT NULL), total_amount is DB-generated
    for (let i = 0; i < services.length; i++) {
      const service = services[i];
      await client.query(
        `INSERT INTO bill_services
         (bill_id, sr_no, particulars_id, particulars_other, description, service_date, service_year, amount, gst_rate_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          bill.id,
          i + 1,
          service.particulars_id,
          service.particulars_other || null,
          service.description || null,
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
        `SELECT b.*, h.bill_prefix,
                COALESCE(b.bill_no, h.bill_prefix || '-DRAFT-' || b.id::text) AS display_ref
         FROM bills b
         LEFT JOIN header_master h ON h.id = b.header_id
         WHERE b.id = $1`,
        [bill.id]
      );
      if (refreshResult.rows.length > 0) {
        billData = refreshResult.rows[0];
      }
    } catch (refetchError) {
      console.error('Re-fetch after create failed (bill was still saved):', refetchError.message);
    }

    const displayRef = billData.display_ref || billData.bill_no || `DRAFT-${bill.id}`;

    logActivity({
      performedBy: userId,
      action: 'CREATE_BILL',
      entityType: 'BILL',
      entityId: bill.id,
      description: `Created bill #${displayRef} (${financial_year})`,
      metadata: { bill_id: bill.id, bill_no: displayRef, financial_year },
    });

    // Log each service individually as ADD_SERVICE (fire-and-forget)
    query(
      `SELECT bs.id, bs.amount, p.service_name, bs.particulars_other
       FROM bill_services bs
       LEFT JOIN particulars_master p ON bs.particulars_id = p.id
       WHERE bs.bill_id = $1
       ORDER BY bs.sr_no`,
      [bill.id]
    ).then(svcRows => {
      for (const svc of svcRows.rows) {
        const name = svc.service_name || svc.particulars_other || 'Service';
        logActivity({
          performedBy: userId,
          action: 'ADD_SERVICE',
          entityType: 'SERVICE',
          entityId: svc.id,
          description: `Added "${name}" — ₹${parseFloat(svc.amount).toFixed(2)}`,
          metadata: {
            bill_id:      bill.id,
            bill_no:      displayRef,
            service_id:   svc.id,
            service_name: name,
            amount:       parseFloat(svc.amount),
          },
        });
      }
    }).catch(() => {});

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
    } else {
      // By default hide ABSORBED bills — they only appear when explicitly filtered
      whereClause += ` AND b.status != 'ABSORBED'`;
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

    if (req.query.client_search) {
      whereClause += ` AND c.client_name ILIKE $${paramCount}`;
      params.push(`%${req.query.client_search}%`);
      paramCount++;
    }

    // Add limit and offset
    whereClause += ` ORDER BY b.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await query(
      `SELECT
        b.*,
        h.company_name,
        h.bill_prefix,
        COALESCE(b.bill_no, h.bill_prefix || '-DRAFT-' || b.id::text) AS display_ref,
        c.client_name,
        c.gstin AS client_gstin,
        c.pan   AS client_pan,
        u.full_name as created_by_name,
        EXISTS (SELECT 1 FROM bill_merges bm WHERE bm.merged_bill_id = b.id) AS is_merged
      FROM bills b
      LEFT JOIN header_master h ON b.header_id = h.id
      LEFT JOIN clients_master c ON b.client_id = c.id
      LEFT JOIN users u ON b.created_by = u.id
      ${whereClause}`,
      params
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM bills b
      LEFT JOIN header_master h ON b.header_id = h.id
      LEFT JOIN clients_master c ON b.client_id = c.id
      LEFT JOIN users u ON b.created_by = u.id
      ${whereClause.split('ORDER BY')[0]}`,
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
        c.pan              AS client_pan,
        c.address_line1    AS client_address_line1,
        c.address_line2    AS client_address_line2,
        c.city             AS client_city,
        c.state            AS client_state,
        c.pincode          AS client_pincode,
        pt.term_name       AS payment_term
      FROM bills b
      LEFT JOIN header_master h  ON b.header_id = h.id
      LEFT JOIN header_bank_details hb ON hb.id = b.bank_account_id
      LEFT JOIN clients_master c  ON b.client_id = c.id
      LEFT JOIN payment_terms_master pt ON b.payment_term_id = pt.id
      WHERE b.id = $1`,
      [id]
    );

    if (billResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }

    // Get services + merge info in parallel
    const [servicesResult, mergedFromResult, absorbedIntoResult] = await Promise.all([
      query(
        `SELECT bs.*, p.service_name, gr.rate_percentage
         FROM bill_services bs
         LEFT JOIN particulars_master p ON bs.particulars_id = p.id
         LEFT JOIN gst_rates_master gr ON bs.gst_rate_id = gr.id
         WHERE bs.bill_id = $1 ORDER BY bs.id`,
        [id]
      ),
      // If this bill is the RESULT of a merge: which source bills were absorbed?
      query(
        `SELECT bm.source_bill_id AS id, sb.bill_no
         FROM bill_merges bm
         JOIN bills sb ON sb.id = bm.source_bill_id
         WHERE bm.merged_bill_id = $1`,
        [id]
      ),
      // If this bill was ABSORBED: which merged bill does it belong to?
      query(
        `SELECT bm.merged_bill_id AS id, mb.bill_no
         FROM bill_merges bm
         JOIN bills mb ON mb.id = bm.merged_bill_id
         WHERE bm.source_bill_id = $1`,
        [id]
      ),
    ]);

    const bill = {
      ...billResult.rows[0],
      display_ref: billResult.rows[0].bill_no
        || `${billResult.rows[0].bill_prefix || 'DRAFT'}-DRAFT-${billResult.rows[0].id}`,
      services:       servicesResult.rows,
      merged_from:    mergedFromResult.rows.length    > 0 ? mergedFromResult.rows    : null,
      absorbed_into:  absorbedIntoResult.rows.length  > 0 ? absorbedIntoResult.rows[0] : null,
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
            c.pan              AS client_pan,
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
      services,
      bank_account_id
    } = req.body;

    const isSuperAdmin = req.user.role === 'SUPERADMIN';
    const overrideEdit = req.body.override_edit === true && isSuperAdmin;

    // Fetch the current bill to check status and get existing header_id
    const currentBill = await client.query(
      'SELECT id, status, header_id, bank_account_id FROM bills WHERE id = $1',
      [id]
    );
    if (currentBill.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }
    const bill = currentBill.rows[0];

    // Permission check: regular users can only edit DRAFT bills
    if (bill.status !== 'DRAFT' && !overrideEdit) {
      return res.status(403).json({
        success: false,
        message: 'Bill is not in DRAFT status. Only SUPERADMIN can edit finalized bills.'
      });
    }

    // Bank account permission:
    // Any user can change bank account on DRAFT. Only SUPERADMIN can change on FINALIZED.
    let resolvedBankAccountId = undefined; // undefined = don't touch it
    if (bank_account_id !== undefined) {
      if (bill.status === 'FINALIZED' && !isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Only SUPERADMIN can change the bank account on a finalized bill.'
        });
      }
      // Validate the bank account belongs to the bill's company (header_id doesn't change on update)
      const effectiveHeaderId = bill.header_id;
      const bankCheck = await client.query(
        `SELECT id FROM header_bank_details WHERE id = $1 AND header_id = $2`,
        [bank_account_id, effectiveHeaderId]
      );
      if (bankCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'The selected bank account does not belong to this bill\'s company.'
        });
      }
      resolvedBankAccountId = parseInt(bank_account_id);
    }

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

    // SUPERADMIN can override-edit any bill regardless of status
    // Regular users can only edit DRAFT bills (enforced above, this WHERE clause is a safety net)
    const updateQuery = overrideEdit
      ? `UPDATE bills
         SET header_id       = COALESCE($1, header_id),
             client_id       = COALESCE($2, client_id),
             bill_date       = COALESCE($3, bill_date),
             due_date        = COALESCE($4, due_date),
             payment_term_id = COALESCE($5, payment_term_id),
             notes           = $6,
             bank_account_id = COALESCE($8, bank_account_id),
             updated_at      = CURRENT_TIMESTAMP
         WHERE id = $7
         RETURNING *`
      : `UPDATE bills
         SET header_id       = COALESCE($1, header_id),
             client_id       = COALESCE($2, client_id),
             bill_date       = COALESCE($3, bill_date),
             due_date        = COALESCE($4, due_date),
             payment_term_id = COALESCE($5, payment_term_id),
             notes           = $6,
             bank_account_id = COALESCE($8, bank_account_id),
             updated_at      = CURRENT_TIMESTAMP
         WHERE id = $7 AND status = 'DRAFT'
         RETURNING *`;

    // Update bill header fields
    const billResult = await client.query(updateQuery,
      [header_id || null, client_id || null, bill_date || null,
       due_date || null, payment_term_id || null,
       notes !== undefined ? notes : null, id,
       resolvedBankAccountId !== undefined ? resolvedBankAccountId : null]
    );

    if (billResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: overrideEdit
          ? 'Bill not found'
          : 'Bill not found or is not in DRAFT status'
      });
    }

    // Replace services if new list provided
    let oldServicesForLog = [];
    if (services && services.length > 0) {
      // Capture existing services BEFORE deleting — needed for DELETE_SERVICE audit rows
      const oldSvcResult = await client.query(
        `SELECT bs.id, bs.particulars_id, bs.amount, p.service_name, bs.particulars_other
         FROM bill_services bs
         LEFT JOIN particulars_master p ON bs.particulars_id = p.id
         WHERE bs.bill_id = $1
         ORDER BY bs.sr_no`,
        [id]
      );
      oldServicesForLog = oldSvcResult.rows;

      await client.query('DELETE FROM bill_services WHERE bill_id = $1', [id]);

      for (let i = 0; i < services.length; i++) {
        const service = services[i];
        await client.query(
          `INSERT INTO bill_services
           (bill_id, sr_no, particulars_id, particulars_other, description, service_date, service_year, amount, gst_rate_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, ROUND($8::numeric, 2), $9)`,
          [
            id,
            i + 1,
            service.particulars_id,
            service.particulars_other || null,
            service.description || null,
            service.service_date || null,
            service.service_year || null,
            service.amount,
            service.gst_rate_id
          ]
        );
      }
    }

    await client.query('COMMIT');

    // Re-fetch with DB-computed total_invoice_value + display_ref
    let updatedBillData = billResult.rows[0];
    try {
      const refreshResult = await require('../config/database').query(
        `SELECT b.*, h.bill_prefix,
                COALESCE(b.bill_no, h.bill_prefix || '-DRAFT-' || b.id::text) AS display_ref
         FROM bills b
         LEFT JOIN header_master h ON h.id = b.header_id
         WHERE b.id = $1`,
        [id]
      );
      if (refreshResult.rows.length > 0) {
        updatedBillData = refreshResult.rows[0];
      }
    } catch (refetchError) {
      console.error('Re-fetch after update failed (bill was still saved):', refetchError.message);
    }

    const updatedDisplayRef = updatedBillData.display_ref || updatedBillData.bill_no || `DRAFT-${id}`;

    logActivity({
      performedBy: req.user.id,
      action: overrideEdit ? 'OVERRIDE_EDIT_BILL' : 'UPDATE_BILL',
      entityType: 'BILL',
      entityId: parseInt(id),
      description: overrideEdit
        ? `[SUPERADMIN OVERRIDE] Edited finalized bill #${updatedDisplayRef}`
        : `Updated bill #${updatedDisplayRef}`,
      metadata: { bill_id: parseInt(id), bill_no: updatedDisplayRef, override_edit: overrideEdit || false },
    });

    // If services were replaced, diff old vs new and only log genuine adds/removals
    if (services && services.length > 0) {
      const billNo = updatedDisplayRef;
      const billId = parseInt(id);

      // Fire-and-forget: fetch freshly-inserted services (with real IDs + names), then diff
      query(
        `SELECT bs.id, bs.amount, bs.particulars_id, p.service_name, bs.particulars_other
         FROM bill_services bs
         LEFT JOIN particulars_master p ON bs.particulars_id = p.id
         WHERE bs.bill_id = $1
         ORDER BY bs.sr_no`,
        [billId]
      ).then(newSvcRows => {
        const newSvcs = newSvcRows.rows;

        // Greedy match: for each new service, find one matching old service (same particulars + same rounded amount)
        // Anything unmatched in old = deleted; anything unmatched in new = added
        const oldPool = oldServicesForLog.map(s => ({
          ...s,
          _amt: parseFloat(parseFloat(s.amount).toFixed(2)),
          _matched: false,
        }));

        const genuinelyAdded = [];
        for (const ns of newSvcs) {
          const nsAmt = parseFloat(parseFloat(ns.amount).toFixed(2));
          const matchIdx = oldPool.findIndex(
            o => !o._matched && o.particulars_id === ns.particulars_id && o._amt === nsAmt
          );
          if (matchIdx !== -1) {
            oldPool[matchIdx]._matched = true; // unchanged — skip
          } else {
            genuinelyAdded.push(ns);
          }
        }
        const genuinelyDeleted = oldPool.filter(o => !o._matched);

        for (const svc of genuinelyDeleted) {
          const name = svc.service_name || svc.particulars_other || 'Service';
          logActivity({
            performedBy: req.user.id,
            action: 'DELETE_SERVICE',
            entityType: 'SERVICE',
            entityId: svc.id,
            description: `Removed "${name}" — ₹${parseFloat(svc.amount).toFixed(2)}`,
            metadata: { bill_id: billId, bill_no: billNo, service_id: svc.id, service_name: name, amount: parseFloat(svc.amount) },
          });
        }
        for (const svc of genuinelyAdded) {
          const name = svc.service_name || svc.particulars_other || 'Service';
          logActivity({
            performedBy: req.user.id,
            action: 'ADD_SERVICE',
            entityType: 'SERVICE',
            entityId: svc.id,
            description: `Added "${name}" — ₹${parseFloat(svc.amount).toFixed(2)}`,
            metadata: { bill_id: billId, bill_no: billNo, service_id: svc.id, service_name: name, amount: parseFloat(svc.amount) },
          });
        }
      }).catch(() => {});
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

    // --- Guard #9: check for services and non-zero value BEFORE the status update ---
    // We read the bill first so we can return a meaningful error message.
    const billCheck = await query(
      `SELECT b.total_invoice_value, COUNT(bs.id) AS service_count
       FROM bills b
       LEFT JOIN bill_services bs ON bs.bill_id = b.id
       WHERE b.id = $1
       GROUP BY b.id, b.total_invoice_value`,
      [id]
    );

    if (billCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    const { total_invoice_value, service_count } = billCheck.rows[0];

    if (parseInt(service_count) === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot finalize a bill with no services. Add at least one service line before finalizing.'
      });
    }
    if (!total_invoice_value || parseFloat(total_invoice_value) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot finalize a bill with zero value. The total invoice value must be greater than ₹0.'
      });
    }

    // --- Fix #10: atomic check-and-set — only update if currently DRAFT ---
    // If two users click Finalize simultaneously, only one UPDATE wins the
    // WHERE status = 'DRAFT' condition. The other gets 0 rows and returns 409.
    const result = await query(
      `UPDATE bills
       SET status     = 'FINALIZED',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND status = 'DRAFT'
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      // Either already finalized (race condition) or some other status
      return res.status(409).json({
        success: false,
        message: 'Bill could not be finalized — it may have already been finalized by another user, or is not in Draft status.'
      });
    }

    const finalized = result.rows[0];
    logActivity({
      performedBy: req.user.id,
      action: 'FINALIZE_BILL',
      entityType: 'BILL',
      entityId: parseInt(id),
      description: `Total ₹${parseFloat(finalized.total_invoice_value || 0).toFixed(2)}`,
      metadata: { bill_id: parseInt(id), bill_no: finalized.bill_no, total_invoice_value: finalized.total_invoice_value },
    });

    res.json({
      success: true,
      message: 'Bill finalized successfully',
      data: finalized
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

    // Trigger function update_bill_payment_status_on_delete is now managed via
    // migrations/003_fix_delete_trigger.sql — no longer patched on every request.
    await client.query('BEGIN');

    // Delete child records in dependency order to satisfy FK constraints
    // (edit locks are stored in-memory — no DB table to delete from)
    await client.query('DELETE FROM bill_payments WHERE bill_id = $1', [id]);
    await client.query('DELETE FROM bill_services WHERE bill_id = $1', [id]);
    await client.query('DELETE FROM bills WHERE id = $1', [id]);

    await client.query('COMMIT');

    const deletedBill = checkResult.rows[0];
    logActivity({
      performedBy: req.user.id,
      action: 'DELETE_BILL',
      entityType: 'BILL',
      entityId: parseInt(id),
      description: `Deleted bill #${deletedBill.bill_no || id}`,
      metadata: { bill_id: parseInt(id), bill_no: deletedBill.bill_no },
    });

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
// DB-BACKED EDIT LOCK STORE (migration 009)
// Locks live in two nullable columns on the bills table:
//   lock_held_by    INTEGER REFERENCES users(id) ON DELETE SET NULL
//   lock_expires_at TIMESTAMP
// Survives server restarts. Lazy cleanup: expired locks overwritten on acquire.
// ============================================================================

const LOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// @desc    Acquire edit lock on a bill
// @route   POST /api/bills/:id/lock
// @access  Private
exports.acquireLock = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userName = req.user.full_name || req.user.username;
    const now = new Date();

    const lockResult = await query(
      `SELECT b.lock_held_by, b.lock_expires_at, u.full_name AS lock_holder_name
       FROM bills b
       LEFT JOIN users u ON u.id = b.lock_held_by
       WHERE b.id = $1`,
      [id]
    );

    if (lockResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    const { lock_held_by, lock_expires_at, lock_holder_name } = lockResult.rows[0];

    if (lock_held_by && lock_held_by !== userId && lock_expires_at && new Date(lock_expires_at) > now) {
      return res.json({
        success: false,
        lockedBy: lock_held_by,
        lockedByName: lock_holder_name,
        expiresAt: new Date(lock_expires_at).toISOString()
      });
    }

    const expiresAt = new Date(now.getTime() + LOCK_DURATION_MS);
    await query(
      'UPDATE bills SET lock_held_by = $1, lock_expires_at = $2 WHERE id = $3',
      [userId, expiresAt, id]
    );

    res.json({ success: true, userName, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    console.error('Acquire lock error:', error);
    res.status(500).json({ success: false, message: 'Failed to acquire lock' });
  }
};

// @desc    Refresh edit lock (heartbeat)
// @route   PUT /api/bills/:id/lock/refresh
// @access  Private
exports.refreshLock = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const expiresAt = new Date(Date.now() + LOCK_DURATION_MS);

    const result = await query(
      `UPDATE bills SET lock_expires_at = $1
       WHERE id = $2 AND lock_held_by = $3
       RETURNING id`,
      [expiresAt, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ success: false, message: 'Lock lost — please reload the bill.' });
    }

    res.json({ success: true, expiresAt: expiresAt.toISOString() });
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

    await query(
      'UPDATE bills SET lock_held_by = NULL, lock_expires_at = NULL WHERE id = $1 AND lock_held_by = $2',
      [id, userId]
    );

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
    const { id } = req.params;
    const now = new Date();

    const result = await query(
      `SELECT b.lock_held_by, b.lock_expires_at, u.full_name AS lock_holder_name
       FROM bills b
       LEFT JOIN users u ON u.id = b.lock_held_by
       WHERE b.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    const { lock_held_by, lock_expires_at, lock_holder_name } = result.rows[0];

    if (!lock_held_by || !lock_expires_at || new Date(lock_expires_at) <= now) {
      return res.json({ isLocked: false, lockedBy: null, lockedByName: null, expiresAt: null });
    }

    res.json({
      isLocked: true,
      lockedBy: lock_held_by,
      lockedByName: lock_holder_name,
      expiresAt: new Date(lock_expires_at).toISOString()
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
        c.state as client_state, c.pincode as client_pincode,
        pt.term_name as payment_term_name
       FROM bills b
       LEFT JOIN header_master h ON b.header_id = h.id
       LEFT JOIN header_bank_details hbd ON hbd.id = b.bank_account_id
       LEFT JOIN clients_master c ON b.client_id = c.id
       LEFT JOIN payment_terms_master pt ON b.payment_term_id = pt.id
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
    doc.moveDown(0.5);
    const row2Y = doc.y;
    if (bill.payment_term_name) doc.text(`Payment Terms: ${bill.payment_term_name}`, 50, row2Y);
    if (bill.due_date) doc.text(`Due Date: ${new Date(bill.due_date).toLocaleDateString('en-IN')}`, 350, row2Y);
    doc.moveDown(0.8);

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

      const serviceName = service.particulars_other || service.service_name || '';

      doc.text(`${i + 1}`, 50, rowY, { width: 25 });
      doc.font('Helvetica').fontSize(9).fillColor('black')
         .text(serviceName, 75, rowY, { width: 200 });

      // Save Y after service name so description can be drawn directly below it
      const afterNameY = doc.y;

      // Draw numeric columns at the same row start
      doc.text(amt.toFixed(2), 285, rowY, { width: 70, align: 'right' });
      doc.text(`${gstPct}%`, 365, rowY, { width: 50, align: 'right' });
      doc.text(gstAmt.toFixed(2), 425, rowY, { width: 65, align: 'right' });
      doc.text(lineTotal.toFixed(2), 495, rowY, { width: 50, align: 'right' });

      if (service.description) {
        // Draw description indented below the service name
        doc.font('Helvetica-Oblique').fontSize(8).fillColor('#555555')
           .text(service.description, 77, afterNameY, { width: 196 });
        doc.font('Helvetica').fontSize(9).fillColor('black');
        doc.moveDown(0.3);
      } else {
        doc.moveDown(0.8);
      }
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
    const { particulars_id, particulars_other, description, service_date, service_year, amount, gst_rate_id } = req.body;

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
       (bill_id, sr_no, particulars_id, particulars_other, description, service_date, service_year, amount, gst_rate_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [billId, nextSr, particulars_id, particulars_other || null,
       description || null, service_date || null, service_year || null, amount, gst_rate_id]
    );

    await client.query('COMMIT');

    // Look up service name + bill display_ref for the audit log (fire-and-forget)
    const addedService = serviceResult.rows[0];
    query(
      `SELECT COALESCE(b.bill_no, h.bill_prefix || '-DRAFT-' || b.id::text) AS display_ref,
              p.service_name
       FROM bills b
       LEFT JOIN header_master h ON h.id = b.header_id
       LEFT JOIN particulars_master p ON p.id = $2
       WHERE b.id = $1`,
      [billId, particulars_id]
    ).then(infoResult => {
      const info = infoResult.rows[0] || {};
      const serviceName = info.service_name || particulars_other || 'Service';
      logActivity({
        performedBy: req.user.id,
        action: 'ADD_SERVICE',
        entityType: 'SERVICE',
        entityId: addedService.id,
        description: `Added service "${serviceName}" — ₹${parseFloat(amount).toFixed(2)}`,
        metadata: {
          bill_id:      parseInt(billId),
          bill_no:      info.display_ref || null,
          service_id:   addedService.id,
          service_name: serviceName,
          amount:       parseFloat(amount),
        },
      });
    }).catch(() => {});

    res.status(201).json({ success: true, message: 'Service added successfully', data: addedService });
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

    // Capture service details + display_ref BEFORE deleting (for audit log)
    const serviceDetailResult = await client.query(
      `SELECT bs.amount, bs.particulars_other,
              COALESCE(b.bill_no, h.bill_prefix || '-DRAFT-' || b.id::text) AS display_ref,
              p.service_name
       FROM bill_services bs
       JOIN bills b ON bs.bill_id = b.id
       LEFT JOIN header_master h ON h.id = b.header_id
       LEFT JOIN particulars_master p ON bs.particulars_id = p.id
       WHERE bs.id = $1`,
      [serviceId]
    );
    const serviceDetail = serviceDetailResult.rows[0] || {};

    await client.query('DELETE FROM bill_services WHERE id = $1', [serviceId]);

    // DB trigger (trigger_update_bill_totals) automatically recalculates bill total

    await client.query('COMMIT');

    const deletedServiceName = serviceDetail.service_name || serviceDetail.particulars_other || 'Service';
    logActivity({
      performedBy: req.user.id,
      action: 'DELETE_SERVICE',
      entityType: 'SERVICE',
      entityId: parseInt(serviceId),
      description: `Deleted service "${deletedServiceName}" — ₹${parseFloat(serviceDetail.amount || 0).toFixed(2)}`,
      metadata: {
        bill_id:      billId,
        bill_no:      serviceDetail.display_ref || null,
        service_id:   parseInt(serviceId),
        service_name: deletedServiceName,
        amount:       parseFloat(serviceDetail.amount || 0),
      },
    });

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

// ============================================================================
// MERGE BILLS
// ============================================================================

// @desc    Merge two or more DRAFT bills from the same company into one new DRAFT
// @route   POST /api/bills/merge
// @access  Private (CA only)
exports.mergeBills = async (req, res) => {
  const client = await require('../config/database').pool.connect();
  try {
    const { bill_ids, notes, override_header_id } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(bill_ids) || bill_ids.length < 2) {
      return res.status(400).json({ success: false, message: 'Select at least 2 bills to merge' });
    }

    await client.query('BEGIN');

    // Fetch all source bills
    const sourceBillsResult = await client.query(
      `SELECT b.* FROM bills b WHERE b.id = ANY($1::int[])`,
      [bill_ids]
    );
    const sourceBills = sourceBillsResult.rows;

    if (sourceBills.length !== bill_ids.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'One or more bills not found' });
    }

    const nonDrafts = sourceBills.filter(b => b.status !== 'DRAFT');
    if (nonDrafts.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'All selected bills must be DRAFT to merge' });
    }

    const headerIds  = [...new Set(sourceBills.map(b => b.header_id))];
    const clientIds2 = [...new Set(sourceBills.map(b => b.client_id).filter(Boolean))];

    if (headerIds.length > 1) {
      // Different headers allowed only if: same client AND a valid override_header_id supplied
      if (clientIds2.length !== 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Bills belong to different clients and cannot be merged' });
      }
      if (!override_header_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Bills are from different companies — please specify which company header to use' });
      }
      const overrideIdNum = parseInt(override_header_id, 10);
      if (!headerIds.includes(overrideIdNum)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'override_header_id must be one of the headers from the selected bills' });
      }
    }

    const fyears = [...new Set(sourceBills.map(b => b.financial_year))];
    if (fyears.length > 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'All selected bills must be from the same financial year' });
    }

    // Already-absorbed check
    const alreadyAbsorbed = await client.query(
      'SELECT source_bill_id FROM bill_merges WHERE source_bill_id = ANY($1::int[])',
      [bill_ids]
    );
    if (alreadyAbsorbed.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'One or more bills have already been merged into another bill' });
    }

    // Use override header if cross-company merge, otherwise use the common header
    const headerId       = headerIds.length > 1 ? parseInt(override_header_id, 10) : headerIds[0];
    const financialYear  = fyears[0];
    const clientId       = clientIds2.length === 1 ? clientIds2[0] : null;
    const billDates      = sourceBills.map(b => new Date(b.bill_date));
    const earliestDate   = new Date(Math.min(...billDates)).toISOString().split('T')[0];

    // Filter out null due dates — new Date(null) produces epoch (Jan 1 1970) which is wrong
    const validDueDates  = sourceBills
      .map(b => b.due_date ? new Date(b.due_date) : null)
      .filter(Boolean);
    const latestDueDate  = validDueDates.length > 0
      ? new Date(Math.max(...validDueDates)).toISOString().split('T')[0]
      : null;

    // Get payment_term_id — use common one if all match, else fall back to the first bill's term
    const ptIds   = [...new Set(sourceBills.map(b => b.payment_term_id).filter(Boolean))];
    const ptId    = ptIds.length >= 1 ? ptIds[0] : sourceBills[0].payment_term_id;

    // Create the merged DRAFT bill — bill_no stays NULL until finalized
    const mergedBillResult = await client.query(
      `INSERT INTO bills (header_id, client_id, bill_date, due_date, financial_year, payment_term_id, notes, created_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT')
       RETURNING *`,
      [headerId, clientId, earliestDate, latestDueDate, financialYear, ptId, notes || null, userId]
    );
    const mergedBill = mergedBillResult.rows[0];

    // Copy services from ALL source bills in order
    let srNo = 1;
    for (const sb of sourceBills) {
      const svcResult = await client.query(
        'SELECT * FROM bill_services WHERE bill_id = $1 ORDER BY sr_no',
        [sb.id]
      );
      for (const svc of svcResult.rows) {
        await client.query(
          `INSERT INTO bill_services
           (bill_id, sr_no, particulars_id, particulars_other, description, service_date, service_year, amount, gst_rate_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [mergedBill.id, srNo++, svc.particulars_id, svc.particulars_other,
           svc.description || null, svc.service_date, svc.service_year, svc.amount, svc.gst_rate_id]
        );
      }
    }

    // Mark source bills as ABSORBED
    await client.query(
      `UPDATE bills SET status = 'ABSORBED', updated_at = CURRENT_TIMESTAMP WHERE id = ANY($1::int[])`,
      [bill_ids]
    );

    // Create bill_merges records
    for (const srcId of bill_ids) {
      await client.query(
        'INSERT INTO bill_merges (merged_bill_id, source_bill_id, merged_by) VALUES ($1, $2, $3)',
        [mergedBill.id, srcId, userId]
      );
    }

    await client.query('COMMIT');

    // Re-fetch to get DB-computed totals
    let mergedBillData = mergedBill;
    try {
      const refresh = await require('../config/database').query('SELECT * FROM bills WHERE id = $1', [mergedBill.id]);
      if (refresh.rows.length > 0) mergedBillData = refresh.rows[0];
    } catch (_) {}

    // Log source bill_nos for context
    const sourceBillNos = sourceBills.map(b => b.bill_no).filter(Boolean);
    logActivity({
      performedBy: userId,
      action: 'MERGE_BILLS',
      entityType: 'BILL',
      entityId: mergedBill.id,
      description: `Merged ${bill_ids.length} bills${sourceBillNos.length ? ' (' + sourceBillNos.join(', ') + ')' : ''} into new draft`,
      metadata: { merged_bill_id: mergedBill.id, source_bill_ids: bill_ids, source_bill_nos: sourceBillNos },
    });

    res.status(201).json({
      success: true,
      message: `${bill_ids.length} bills merged successfully`,
      data: mergedBillData
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Merge bills error:', error);
    res.status(500).json({ success: false, message: 'Failed to merge bills', error: error.message });
  } finally {
    client.release();
  }
};

// @desc    Unmerge a DRAFT merged bill — restores all source bills to DRAFT
// @route   POST /api/bills/:id/unmerge
// @access  Private (CA only)
exports.unmergeBill = async (req, res) => {
  const client = await require('../config/database').pool.connect();
  try {
    const { id } = req.params;
    const userId  = req.user.id;

    await client.query('BEGIN');

    // Check the bill exists and is DRAFT
    const billResult = await client.query('SELECT * FROM bills WHERE id = $1', [id]);
    if (billResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }
    const mergedBill = billResult.rows[0];
    if (mergedBill.status !== 'DRAFT') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Only DRAFT merged bills can be unmerged' });
    }

    // Get all source bills from merge records
    const mergeRecords = await client.query(
      'SELECT source_bill_id FROM bill_merges WHERE merged_bill_id = $1',
      [id]
    );
    if (mergeRecords.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'This bill was not created by a merge' });
    }
    const sourceBillIds = mergeRecords.rows.map(r => r.source_bill_id);

    // Restore source bills to DRAFT
    await client.query(
      `UPDATE bills SET status = 'DRAFT', updated_at = CURRENT_TIMESTAMP WHERE id = ANY($1::int[])`,
      [sourceBillIds]
    );

    // Delete the merged bill's services + the bill itself
    // (bill_merges rows cascade-delete when merged_bill is deleted)
    await client.query('DELETE FROM bill_services WHERE bill_id = $1', [id]);
    await client.query('DELETE FROM bills WHERE id = $1', [id]);

    await client.query('COMMIT');

    logActivity({
      performedBy: userId,
      action: 'UNMERGE_BILL',
      entityType: 'BILL',
      entityId: parseInt(id),
      description: `Unmerged bill — restored ${sourceBillIds.length} bills to Draft`,
      metadata: { merged_bill_id: parseInt(id), source_bill_ids: sourceBillIds },
    });

    res.json({
      success: true,
      message: `Bill unmerged — ${sourceBillIds.length} source bill(s) restored to Draft`,
      data: { restored_bill_ids: sourceBillIds }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Unmerge bill error:', error);
    res.status(500).json({ success: false, message: 'Failed to unmerge bill', error: error.message });
  } finally {
    client.release();
  }
};

// ============================================================================
// WRITE-OFF BILL
// ============================================================================

// @desc    Write off remaining balance on a FINALIZED PARTIAL bill
// @route   POST /api/bills/:id/writeoff
// @access  SUPERADMIN only
// Write-off data is stored in the bill_writeoffs child table (migration 002),
// NOT as columns on bills. This preserves the full audit trail.
exports.writeOffBill = async (req, res) => {
  const dbClient = await require('../config/database').pool.connect();
  try {
    await dbClient.query('BEGIN');
    const { id } = req.params;
    const { notes } = req.body;
    const userId = req.user.id;

    // Fetch the bill with a row lock to prevent concurrent write-offs
    const billResult = await dbClient.query(
      'SELECT * FROM bills WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (billResult.rows.length === 0) {
      await dbClient.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }
    const bill = billResult.rows[0];

    // Only FINALIZED + PARTIAL bills can be written off
    if (bill.status !== 'FINALIZED') {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Only finalized bills can be written off' });
    }
    if (bill.payment_status !== 'PARTIAL') {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Only partially paid bills can be written off. ' +
                 `This bill's payment status is "${bill.payment_status}".`
      });
    }

    // Prevent duplicate write-offs for the same bill
    const existingWriteoff = await dbClient.query(
      'SELECT id FROM bill_writeoffs WHERE bill_id = $1',
      [id]
    );
    if (existingWriteoff.rows.length > 0) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'This bill has already been written off' });
    }

    const writeoffAmount = parseFloat(bill.total_invoice_value) - parseFloat(bill.total_paid || 0);
    if (writeoffAmount <= 0) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'No outstanding balance to write off' });
    }

    // Insert write-off record into the dedicated audit table
    const writeoffResult = await dbClient.query(
      `INSERT INTO bill_writeoffs (bill_id, writeoff_amount, written_off_by, writeoff_date, notes)
       VALUES ($1, $2, $3, CURRENT_DATE, $4)
       RETURNING *`,
      [id, writeoffAmount, userId, notes || null]
    );

    // Mark the bill as fully PAID now that the remainder is written off
    await dbClient.query(
      `UPDATE bills
       SET payment_status = 'PAID',
           updated_at     = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );

    await dbClient.query('COMMIT');

    logActivity({
      performedBy: userId,
      action: 'WRITE_OFF_BILL',
      entityType: 'BILL',
      entityId: parseInt(id),
      description: `Wrote off ₹${writeoffAmount.toFixed(2)} on bill ${bill.bill_no || `DRAFT-${id}`}`,
      metadata: { writeoff_amount: writeoffAmount, bill_no: bill.bill_no, notes }
    });

    res.json({
      success: true,
      message: `Write-off of ₹${writeoffAmount.toFixed(2)} applied successfully`,
      data: writeoffResult.rows[0]
    });
  } catch (error) {
    await dbClient.query('ROLLBACK').catch(() => {});
    console.error('Write-off error:', error);
    res.status(500).json({ success: false, message: 'Failed to apply write-off', error: error.message });
  } finally {
    dbClient.release();
  }
};