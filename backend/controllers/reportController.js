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

    // Get overall summary
    const summaryResult = await query(
      `SELECT 
        COUNT(*) as total_bills,
        COALESCE(SUM(total_invoice_value), 0) as total_billed,
        COALESCE(SUM(total_paid), 0) as total_paid,
        COALESCE(SUM(total_invoice_value - COALESCE(total_paid, 0)), 0) as total_outstanding
      FROM bills b
      ${whereClause}`,
      params
    );

    const summary = summaryResult.rows[0];
    const collectionRate = summary.total_billed > 0 
      ? ((summary.total_paid / summary.total_billed) * 100).toFixed(2)
      : 0;

    // Get company-wise breakdown
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
      ${whereClause}
      GROUP BY h.id, h.company_name
      ORDER BY outstanding DESC`,
      params
    );

    // Get client-wise breakdown
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
      ${whereClause} AND b.client_id IS NOT NULL
      GROUP BY c.id, c.client_name
      ORDER BY outstanding DESC
      LIMIT 10`,
      params
    );

    // Get aging analysis
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
      ${whereClause} AND b.payment_status != 'PAID' AND b.due_date < CURRENT_DATE`,
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

    // Get payment timeline
    const paymentsResult = await query(
      `SELECT 
        bp.payment_date,
        bp.amount_paid,
        b.bill_no,
        u.full_name as recorded_by
      FROM bill_payments bp
      JOIN bills b ON bp.bill_id = b.id
      LEFT JOIN users u ON bp.recorded_by = u.id
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

    const result = await query(
      `SELECT 
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

    // Calculate totals
    const totals = result.rows.reduce((acc, row) => ({
      total_billed: acc.total_billed + parseFloat(row.total_invoice_value),
      total_paid: acc.total_paid + parseFloat(row.total_paid || 0),
      total_balance: acc.total_balance + parseFloat(row.balance)
    }), { total_billed: 0, total_paid: 0, total_balance: 0 });

    res.json({
      success: true,
      data: {
        bills: result.rows,
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