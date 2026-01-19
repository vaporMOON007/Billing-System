const { query } = require('../config/database');

// @desc    Mark payment for a bill
// @route   POST /api/payments
// @access  Private (CA only)
exports.markPayment = async (req, res) => {
  const client = await require('../config/database').pool.connect();
  
  try {
    const { bill_id, payment_date, amount_paid, notes } = req.body;

    // Validate input
    if (!bill_id || !payment_date || !amount_paid) {
      return res.status(400).json({
        success: false,
        message: 'Please provide bill_id, payment_date, and amount_paid'
      });
    }

    if (amount_paid <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount must be greater than 0'
      });
    }

    await client.query('BEGIN');

    // Get bill details
    const billResult = await client.query(
      'SELECT total_invoice_value, total_paid FROM bills WHERE id = $1',
      [bill_id]
    );

    if (billResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Bill not found'
      });
    }

    const bill = billResult.rows[0];
    const balance = parseFloat(bill.total_invoice_value) - parseFloat(bill.total_paid || 0);

    // Validate payment amount doesn't exceed balance
    if (parseFloat(amount_paid) > balance) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Payment amount (₹${amount_paid}) exceeds outstanding balance (₹${balance})`
      });
    }

    // Insert payment record
    const paymentResult = await client.query(
      `INSERT INTO bill_payments (bill_id, payment_date, amount_paid, notes, recorded_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [bill_id, payment_date, amount_paid, notes || null, req.user.id]
    );

    await client.query('COMMIT');

    // Get updated bill details
    const updatedBill = await query(
      'SELECT * FROM bills WHERE id = $1',
      [bill_id]
    );

    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      data: {
        payment: paymentResult.rows[0],
        bill: updatedBill.rows[0]
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Mark payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record payment',
      error: error.message
    });
  } finally {
    client.release();
  }
};

// @desc    Get payment history for a bill
// @route   GET /api/payments/bill/:billId
// @access  Private
exports.getPaymentHistory = async (req, res) => {
  try {
    const { billId } = req.params;

    const result = await query(
      `SELECT 
        bp.*,
        u.full_name as recorded_by_name
       FROM bill_payments bp
       LEFT JOIN users u ON bp.recorded_by = u.id
       WHERE bp.bill_id = $1
       ORDER BY bp.payment_date DESC, bp.created_at DESC`,
      [billId]
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment history',
      error: error.message
    });
  }
};

// @desc    Delete a payment
// @route   DELETE /api/payments/:id
// @access  Private (CA only)
exports.deletePayment = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM bill_payments WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    res.json({
      success: true,
      message: 'Payment deleted successfully'
    });
  } catch (error) {
    console.error('Delete payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete payment',
      error: error.message
    });
  }
};