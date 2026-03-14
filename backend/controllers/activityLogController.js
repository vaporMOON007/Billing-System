const { query } = require('../config/database');

// ── Shared helper ────────────────────────────────────────────────────────────
// Call this from any controller to insert an audit row.
// It is fire-and-forget: errors are logged but never propagate to the caller.
const logActivity = async ({
  performedBy,   // user id (integer) or null
  action,        // string constant, e.g. 'CREATE_BILL'
  entityType,    // 'BILL' | 'SERVICE' | 'PAYMENT' | 'USER'
  entityId,      // integer id or null
  description,   // human-readable string
  metadata,      // plain object or null — stored as JSONB
}) => {
  try {
    await query(
      `INSERT INTO activity_log (performed_by, action, entity_type, entity_id, description, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        performedBy   || null,
        action,
        entityType,
        entityId      || null,
        description   || null,
        metadata      ? JSON.stringify(metadata) : null,
      ]
    );
  } catch (err) {
    // Never let logging blow up the main request
    console.error('[ActivityLog] Failed to write audit row:', err.message);
  }
};

module.exports.logActivity = logActivity;

// ── GET /api/audit-log/by-bill ────────────────────────────────────────────────
// @desc    Fetch audit log grouped by bill — one row per bill with all its
//          entries nested. Non-bill entries (USER, etc.) returned separately.
// @route   GET /api/audit-log/by-bill
// @access  Private (CA only)
module.exports.getActivityLogByBill = async (req, res) => {
  try {
    const { user_id, date_from, date_to, search, bill_no } = req.query;

    const conditions = [];
    const params     = [];
    let   p          = 1;

    if (user_id) {
      conditions.push(`al.performed_by = $${p++}`);
      params.push(parseInt(user_id));
    }
    if (date_from) {
      conditions.push(`al.created_at >= $${p++}`);
      params.push(date_from);
    }
    if (date_to) {
      conditions.push(`al.created_at < ($${p++}::date + INTERVAL '1 day')`);
      params.push(date_to);
    }
    if (search) {
      conditions.push(`(al.description ILIKE $${p} OR (al.metadata->>'bill_no') ILIKE $${p})`);
      params.push(`%${search}%`);
      p++;
    }
    if (bill_no) {
      conditions.push(`(al.metadata->>'bill_no') ILIKE $${p++}`);
      params.push(`%${bill_no}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // ── Bill-linked entries grouped by bill ───────────────────────────────
    const billGroupsResult = await query(
      `SELECT
         (al.metadata->>'bill_no')                               AS bill_no,
         (al.metadata->>'bill_id')::integer                      AS bill_id,
         COUNT(*)::integer                                        AS entry_count,
         MAX(al.created_at)                                       AS last_activity,
         json_agg(
           json_build_object(
             'id',                    al.id,
             'action',                al.action,
             'description',           al.description,
             'created_at',            al.created_at,
             'performed_by_name',     u.full_name,
             'performed_by_username', u.username,
             'metadata',              al.metadata
           )
           ORDER BY al.created_at ASC
         )                                                        AS entries
       FROM activity_log al
       LEFT JOIN users u ON al.performed_by = u.id
       ${where ? where + ' AND' : 'WHERE'} al.metadata->>'bill_no' IS NOT NULL
       GROUP BY (al.metadata->>'bill_no'), (al.metadata->>'bill_id')::integer
       ORDER BY MAX(al.created_at) DESC
       LIMIT 200`,
      params
    );

    // ── Non-bill entries (USER, SYSTEM, etc.) ─────────────────────────────
    const otherResult = await query(
      `SELECT
         al.id,
         al.action,
         al.entity_type,
         al.description,
         al.metadata,
         al.created_at,
         u.full_name  AS performed_by_name,
         u.username   AS performed_by_username
       FROM activity_log al
       LEFT JOIN users u ON al.performed_by = u.id
       ${where ? where + ' AND' : 'WHERE'} (al.metadata->>'bill_no') IS NULL
       ORDER BY al.created_at DESC
       LIMIT 100`,
      params
    );

    res.json({
      success:     true,
      bill_groups: billGroupsResult.rows,
      other:       otherResult.rows,
    });
  } catch (error) {
    console.error('Get activity log by bill error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch grouped audit log',
      error: error.message,
    });
  }
};

// ── GET /api/audit-log ────────────────────────────────────────────────────────
// @desc    Fetch audit log with optional filters
// @route   GET /api/audit-log
// @access  Private (CA only)
module.exports.getActivityLog = async (req, res) => {
  try {
    const {
      user_id,
      action,
      entity_type,
      entity_id,
      date_from,
      date_to,
      search,
      limit  = 100,
      offset = 0,
    } = req.query;

    const conditions = [];
    const params     = [];
    let   p          = 1;

    if (user_id) {
      conditions.push(`al.performed_by = $${p++}`);
      params.push(parseInt(user_id));
    }

    if (action) {
      conditions.push(`al.action = $${p++}`);
      params.push(action);
    }

    if (entity_type) {
      conditions.push(`al.entity_type = $${p++}`);
      params.push(entity_type);
    }

    if (entity_id) {
      conditions.push(`al.entity_id = $${p++}`);
      params.push(parseInt(entity_id));
    }

    if (date_from) {
      conditions.push(`al.created_at >= $${p++}`);
      params.push(date_from);
    }

    if (date_to) {
      // include the full end day
      conditions.push(`al.created_at < ($${p++}::date + INTERVAL '1 day')`);
      params.push(date_to);
    }

    if (search) {
      conditions.push(`al.description ILIKE $${p++}`);
      params.push(`%${search}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total count (without limit/offset)
    const countResult = await query(
      `SELECT COUNT(*) FROM activity_log al ${where}`,
      params
    );

    // Data rows
    const dataResult = await query(
      `SELECT
         al.id,
         al.action,
         al.entity_type,
         al.entity_id,
         al.description,
         al.metadata,
         al.created_at,
         u.full_name  AS performed_by_name,
         u.username   AS performed_by_username,
         u.role       AS performed_by_role
       FROM activity_log al
       LEFT JOIN users u ON al.performed_by = u.id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    res.json({
      success: true,
      data: dataResult.rows,
      pagination: {
        total:  parseInt(countResult.rows[0].count),
        limit:  parseInt(limit),
        offset: parseInt(offset),
      },
    });
  } catch (error) {
    console.error('Get activity log error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch audit log',
      error: error.message,
    });
  }
};
