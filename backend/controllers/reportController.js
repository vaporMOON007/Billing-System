const { query } = require('../config/database');

// @desc    Get dashboard KPIs with filters
// @route   GET /api/reports/dashboard-kpis
// @access  Private (CA only)
exports.getDashboardKPIs = async (req, res) => {
  try {
    const {
      date_from,
      date_to,
      financial_year,
      month,
      year,
      header_id,
      client_id,
      payment_status
    } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramCount = 1;

    // Build where clause based on filters
    if (financial_year) {
      whereClause += ` AND b.financial_year = $${paramCount}`;
      params.push(financial_year);
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

    if (month && year) {
      whereClause += ` AND EXTRACT(MONTH FROM b.bill_date) = $${paramCount}`;
      params.push(month);
      paramCount++;
      whereClause += ` AND EXTRACT(YEAR FROM b.bill_date) = $${paramCount}`;
      params.push(year);
      paramCount++;
    }

    if (header_id) {
      whereClause += ` AND b.header_id = $${paramCount}`;
      params.push(header_id);
      paramCount++;
    }

    if (client_id) {
      whereClause += ` AND b.client_id = $${paramCount}`;
      params.push(client_id);
      paramCount++;
    }

    if (payment_status) {
      whereClause += ` AND b.payment_status = $${paramCount}`;
      params.push(payment_status);
      paramCount++;
    }

    // Get overall summary (exclude DRAFT bills from financial totals)
    const summaryResult = await query(
      `SELECT
        COUNT(*) as total_bills,
        COALESCE(SUM(total_invoice_value), 0) as total_billed,
        COALESCE(SUM(total_paid), 0) as total_paid,
        COALESCE(SUM(total_invoice_value - COALESCE(total_paid, 0)), 0) as total_outstanding
      FROM bills b
      ${whereClause} AND b.status != 'DRAFT'`,
      params
    );

    const summary = summaryResult.rows[0];
    const collectionRate = summary.total_billed > 0 
      ? ((summary.total_paid / summary.total_billed) * 100).toFixed(2)
      : 0;

    // Get company-wise breakdown (exclude DRAFT bills)
    const companyResult = await query(
      `SELECT
        h.id,
        h.company_name,
        COUNT(b.id) as bill_count,
        COALESCE(SUM(b.total_invoice_value), 0) as total_billed,
        COALESCE(SUM(b.total_paid), 0) as total_paid,
        COALESCE(SUM(b.total_invoice_value - COALESCE(b.total_paid, 0)), 0) as outstanding
      FROM bills b
      LEFT JOIN header_master h ON b.header_id = h.id
      ${whereClause} AND b.status != 'DRAFT'
      GROUP BY h.id, h.company_name
      ORDER BY outstanding DESC`,
      params
    );

    // Get client-wise breakdown (exclude DRAFT bills)
    const clientResult = await query(
      `SELECT
        c.id,
        c.client_name,
        COUNT(b.id) as bill_count,
        COALESCE(SUM(b.total_invoice_value), 0) as total_billed,
        COALESCE(SUM(b.total_paid), 0) as total_paid,
        COALESCE(SUM(b.total_invoice_value - COALESCE(b.total_paid, 0)), 0) as outstanding
      FROM bills b
      LEFT JOIN clients_master c ON b.client_id = c.id
      ${whereClause} AND b.client_id IS NOT NULL AND b.status != 'DRAFT'
      GROUP BY c.id, c.client_name
      ORDER BY outstanding DESC
      LIMIT 10`,
      params
    );

    // Get aging analysis (exclude DRAFT bills)
    const agingResult = await query(
      `SELECT
        SUM(CASE
          WHEN CURRENT_DATE - b.due_date BETWEEN 0 AND 30
          THEN b.total_invoice_value - COALESCE(b.total_paid, 0)
          ELSE 0
        END) as "0-30",
        SUM(CASE
          WHEN CURRENT_DATE - b.due_date BETWEEN 31 AND 60
          THEN b.total_invoice_value - COALESCE(b.total_paid, 0)
          ELSE 0
        END) as "31-60",
        SUM(CASE
          WHEN CURRENT_DATE - b.due_date BETWEEN 61 AND 90
          THEN b.total_invoice_value - COALESCE(b.total_paid, 0)
          ELSE 0
        END) as "61-90",
        SUM(CASE
          WHEN CURRENT_DATE - b.due_date > 90
          THEN b.total_invoice_value - COALESCE(b.total_paid, 0)
          ELSE 0
        END) as "90+"
      FROM bills b
      ${whereClause} AND b.payment_status != 'PAID' AND b.status != 'DRAFT' AND b.due_date < CURRENT_DATE`,
      params
    );

    res.json({
      success: true,
      data: {
        summary: {
          ...summary,
          collection_rate: parseFloat(collectionRate)
        },
        by_company: companyResult.rows,
        by_client: clientResult.rows,
        aging_analysis: agingResult.rows[0] || {
          "0-30": 0,
          "31-60": 0,
          "61-90": 0,
          "90+": 0
        }
      }
    });
  } catch (error) {
    console.error('Get dashboard KPIs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data',
      error: error.message
    });
  }
};

// @desc    Generate client ledger (simple format)
// @route   GET /api/reports/client-ledger
// @access  Private (CA only)
exports.generateClientLedger = async (req, res) => {
  try {
    const { client_id, date_from, date_to } = req.query;

    if (!client_id) {
      return res.status(400).json({
        success: false,
        message: 'Client ID is required'
      });
    }

    let whereClause = 'WHERE b.client_id = $1';
    const params = [client_id];
    let paramCount = 2;

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

    // Get client details
    const clientResult = await query(
      'SELECT * FROM clients_master WHERE id = $1',
      [client_id]
    );

    if (clientResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    const client = clientResult.rows[0];

    // Get bills
    const billsResult = await query(
      `SELECT 
        b.bill_no,
        b.bill_date,
        b.total_invoice_value,
        b.total_paid,
        b.payment_status,
        h.company_name,
        (b.total_invoice_value - COALESCE(b.total_paid, 0)) as balance
      FROM bills b
      LEFT JOIN header_master h ON b.header_id = h.id
      ${whereClause}
      ORDER BY b.bill_date DESC`,
      params
    );

    // Calculate summary
    const summary = billsResult.rows.reduce((acc, bill) => ({
      total_bills: acc.total_bills + 1,
      total_billed: acc.total_billed + parseFloat(bill.total_invoice_value),
      total_paid: acc.total_paid + parseFloat(bill.total_paid || 0),
      outstanding: acc.outstanding + parseFloat(bill.balance)
    }), { total_bills: 0, total_billed: 0, total_paid: 0, outstanding: 0 });

    res.json({
      success: true,
      data: {
        client,
        period: { date_from, date_to },
        summary,
        bills: billsResult.rows
      }
    });
  } catch (error) {
    console.error('Generate client ledger error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate ledger',
      error: error.message
    });
  }
};

// @desc    Generate detailed client report
// @route   GET /api/reports/client-detailed
// @access  Private (CA only)
exports.generateDetailedReport = async (req, res) => {
  try {
    const { client_id, date_from, date_to } = req.query;

    if (!client_id) {
      return res.status(400).json({
        success: false,
        message: 'Client ID is required'
      });
    }

    let whereClause = 'WHERE b.client_id = $1';
    const params = [client_id];
    let paramCount = 2;

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

    // Get client details
    const clientResult = await query(
      'SELECT * FROM clients_master WHERE id = $1',
      [client_id]
    );

    if (clientResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    const client = clientResult.rows[0];

    // Get bills with services
    const billsResult = await query(
      `SELECT 
        b.*,
        h.company_name
      FROM bills b
      LEFT JOIN header_master h ON b.header_id = h.id
      ${whereClause}
      ORDER BY b.bill_date DESC`,
      params
    );

    // Get service breakdown
    const servicesResult = await query(
      `SELECT 
        p.service_name,
        COUNT(bs.id) as count,
        SUM(bs.amount + (bs.amount * gr.rate_percentage / 100)) as total
      FROM bill_services bs
      JOIN bills b ON bs.bill_id = b.id
      JOIN particulars_master p ON bs.particulars_id = p.id
      JOIN gst_rates_master gr ON bs.gst_rate_id = gr.id
      ${whereClause}
      GROUP BY p.service_name
      ORDER BY total DESC`,
      params
    );

    // Get payment timeline (with all new fields)
    const paymentsResult = await query(
      `SELECT
        bp.id,
        bp.bill_id,
        bp.payment_date,
        bp.amount_paid,
        bp.payment_mode,
        bp.cheque_no,
        bp.utr,
        bp.cash_collected_by,
        b.bill_no,
        u.full_name as recorded_by,
        hbd.bank_name as received_in_bank
      FROM bill_payments bp
      JOIN bills b ON bp.bill_id = b.id
      LEFT JOIN users u ON bp.recorded_by = u.id
      LEFT JOIN header_bank_details hbd ON bp.received_in_account_id = hbd.header_id
      ${whereClause}
      ORDER BY bp.payment_date DESC`,
      params
    );

    // Calculate summary
    const summary = billsResult.rows.reduce((acc, bill) => ({
      total_bills: acc.total_bills + 1,
      total_billed: acc.total_billed + parseFloat(bill.total_invoice_value),
      total_paid: acc.total_paid + parseFloat(bill.total_paid || 0),
      outstanding: acc.outstanding + (parseFloat(bill.total_invoice_value) - parseFloat(bill.total_paid || 0))
    }), { total_bills: 0, total_billed: 0, total_paid: 0, outstanding: 0 });

    const collectionRate = summary.total_billed > 0 
      ? ((summary.total_paid / summary.total_billed) * 100).toFixed(2)
      : 0;

    res.json({
      success: true,
      data: {
        client,
        period: { date_from, date_to },
        summary: {
          ...summary,
          collection_rate: parseFloat(collectionRate)
        },
        services_breakdown: servicesResult.rows,
        bills: billsResult.rows,
        payment_timeline: paymentsResult.rows
      }
    });
  } catch (error) {
    console.error('Generate detailed report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate report',
      error: error.message
    });
  }
};

// @desc    Export filtered bills to Excel/CSV data
// @route   GET /api/reports/export-bills
// @access  Private (CA only)
exports.exportBills = async (req, res) => {
  try {
    const {
      status,
      header_id,
      client_id,
      payment_status,
      date_from,
      date_to,
      created_by
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

    if (header_id) {
      whereClause += ` AND b.header_id = $${paramCount}`;
      params.push(header_id);
      paramCount++;
    }

    if (client_id) {
      whereClause += ` AND b.client_id = $${paramCount}`;
      params.push(client_id);
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

    const billsResult = await query(
      `SELECT
        b.id as bill_id,
        b.bill_no,
        b.bill_date,
        b.due_date,
        h.company_name,
        c.client_name,
        b.total_invoice_value,
        b.total_paid,
        (b.total_invoice_value - COALESCE(b.total_paid, 0)) as balance,
        b.status,
        b.payment_status,
        u.full_name as created_by
      FROM bills b
      LEFT JOIN header_master h ON b.header_id = h.id
      LEFT JOIN clients_master c ON b.client_id = c.id
      LEFT JOIN users u ON b.created_by = u.id
      ${whereClause}
      ORDER BY b.bill_date DESC`,
      params
    );

    // Split into main bills (DRAFT/FINALIZED) and absorbed bills
    const mainBillRows     = billsResult.rows.filter(b => b.status !== 'ABSORBED');
    const absorbedBillRows = billsResult.rows.filter(b => b.status === 'ABSORBED');

    // Calculate totals from non-absorbed bills only
    const totals = mainBillRows.reduce((acc, row) => ({
      total_billed: acc.total_billed + parseFloat(row.total_invoice_value),
      total_paid: acc.total_paid + parseFloat(row.total_paid || 0),
      total_balance: acc.total_balance + parseFloat(row.balance)
    }), { total_billed: 0, total_paid: 0, total_balance: 0 });

    // Fetch payments for all returned bills (main + absorbed)
    const allBillIds = billsResult.rows.map(b => b.bill_id);
    let paymentsMap = {};
    if (allBillIds.length > 0) {
      const pmtResult = await query(
        `SELECT
          bp.bill_id,
          bp.payment_date,
          bp.amount_paid,
          bp.payment_mode,
          bp.utr,
          bp.cheque_no,
          bp.cash_collected_by,
          hbd.bank_name         as received_in_bank,
          hbd.account_holder_name as received_account_holder,
          hbd.account_number    as received_account_number
        FROM bill_payments bp
        LEFT JOIN header_bank_details hbd ON bp.received_in_account_id = hbd.header_id
        WHERE bp.bill_id = ANY($1)
        ORDER BY bp.payment_date ASC`,
        [allBillIds]
      );
      pmtResult.rows.forEach(p => {
        if (!paymentsMap[p.bill_id]) paymentsMap[p.bill_id] = [];
        paymentsMap[p.bill_id].push(p);
      });
    }

    // Attach payments array to each bill row
    const attachPayments = (rows) => rows.map(b => ({
      ...b,
      payments: paymentsMap[b.bill_id] || []
    }));

    res.json({
      success: true,
      data: {
        bills:          attachPayments(mainBillRows),
        absorbed_bills: attachPayments(absorbedBillRows),
        totals
      }
    });
  } catch (error) {
    console.error('Export bills error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export bills',
      error: error.message
    });
  }
};
// @desc    Get full receivables — all companies + all clients (no limit) + monthly summary
// @route   GET /api/reports/receivables
// @access  Private (CA only)
exports.getReceivables = async (req, res) => {
  try {
    const { financial_year, date_from, date_to } = req.query;

    let whereClause = "WHERE b.status = 'FINALIZED'";
    const params = [];
    let paramCount = 1;

    if (financial_year) {
      whereClause += ` AND b.financial_year = $${paramCount}`;
      params.push(financial_year);
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

    // Summary totals
    const summaryResult = await query(
      `SELECT
        COUNT(*)                                                          AS total_bills,
        COALESCE(SUM(b.total_invoice_value), 0)                         AS total_billed,
        COALESCE(SUM(b.total_paid), 0)                                   AS total_collected,
        COALESCE(SUM(b.total_invoice_value - COALESCE(b.total_paid,0)),0) AS total_outstanding
       FROM bills b ${whereClause}`,
      params
    );

    // Company-wise (all, no limit)
    const companyResult = await query(
      `SELECT
        h.id                                                              AS header_id,
        h.company_name,
        COUNT(b.id)                                                       AS bill_count,
        COALESCE(SUM(b.total_invoice_value), 0)                         AS total_billed,
        COALESCE(SUM(b.total_paid), 0)                                   AS total_collected,
        COALESCE(SUM(b.total_invoice_value - COALESCE(b.total_paid,0)),0) AS outstanding,
        COUNT(CASE WHEN b.payment_status = 'UNPAID'  THEN 1 END)        AS unpaid_count,
        COUNT(CASE WHEN b.payment_status = 'PARTIAL' THEN 1 END)        AS partial_count,
        COUNT(CASE WHEN b.payment_status = 'PAID'    THEN 1 END)        AS paid_count
       FROM bills b
       LEFT JOIN header_master h ON b.header_id = h.id
       ${whereClause}
       GROUP BY h.id, h.company_name
       ORDER BY outstanding DESC`,
      params
    );

    // Client-wise (all, no limit)
    const clientResult = await query(
      `SELECT
        c.id                                                              AS client_id,
        c.client_name,
        COUNT(b.id)                                                       AS bill_count,
        COALESCE(SUM(b.total_invoice_value), 0)                         AS total_billed,
        COALESCE(SUM(b.total_paid), 0)                                   AS total_collected,
        COALESCE(SUM(b.total_invoice_value - COALESCE(b.total_paid,0)),0) AS outstanding,
        COUNT(CASE WHEN b.payment_status = 'UNPAID'  THEN 1 END)        AS unpaid_count,
        COUNT(CASE WHEN b.payment_status = 'PARTIAL' THEN 1 END)        AS partial_count,
        COUNT(CASE WHEN b.payment_status = 'PAID'    THEN 1 END)        AS paid_count
       FROM bills b
       LEFT JOIN clients_master c ON b.client_id = c.id
       ${whereClause}
       GROUP BY c.id, c.client_name
       ORDER BY outstanding DESC`,
      params
    );

    // Aging buckets (outstanding only)
    const agingResult = await query(
      `SELECT
        COALESCE(SUM(CASE WHEN CURRENT_DATE - b.due_date BETWEEN 0  AND 30  THEN b.total_invoice_value - COALESCE(b.total_paid,0) ELSE 0 END),0) AS "0_30",
        COALESCE(SUM(CASE WHEN CURRENT_DATE - b.due_date BETWEEN 31 AND 60  THEN b.total_invoice_value - COALESCE(b.total_paid,0) ELSE 0 END),0) AS "31_60",
        COALESCE(SUM(CASE WHEN CURRENT_DATE - b.due_date BETWEEN 61 AND 90  THEN b.total_invoice_value - COALESCE(b.total_paid,0) ELSE 0 END),0) AS "61_90",
        COALESCE(SUM(CASE WHEN CURRENT_DATE - b.due_date > 90               THEN b.total_invoice_value - COALESCE(b.total_paid,0) ELSE 0 END),0) AS "90_plus"
       FROM bills b
       ${whereClause} AND b.payment_status != 'PAID' AND b.due_date IS NOT NULL`,
      params
    );

    // Monthly collection summary (last 12 months)
    const monthlyResult = await query(
      `SELECT
        TO_CHAR(b.bill_date, 'Mon YYYY')                                 AS month_label,
        TO_CHAR(b.bill_date, 'YYYY-MM')                                  AS month_sort,
        COALESCE(SUM(b.total_invoice_value), 0)                         AS billed,
        COALESCE(SUM(b.total_paid), 0)                                   AS collected,
        COALESCE(SUM(b.total_invoice_value - COALESCE(b.total_paid,0)),0) AS outstanding
       FROM bills b
       WHERE b.status = 'FINALIZED'
         AND b.bill_date >= CURRENT_DATE - INTERVAL '12 months'
       GROUP BY month_label, month_sort
       ORDER BY month_sort ASC`
    );

    res.json({
      success: true,
      data: {
        summary:  summaryResult.rows[0],
        by_company: companyResult.rows,
        by_client:  clientResult.rows,
        aging:      agingResult.rows[0],
        monthly:    monthlyResult.rows
      }
    });
  } catch (error) {
    console.error('Get receivables error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch receivables', error: error.message });
  }
};
