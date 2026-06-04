// FreshBoxAPI/src/routes/admin/orders.js
// GET  /api/admin/orders         — all orders with filters
// GET  /api/admin/orders/:id     — single order detail
// PUT  /api/admin/orders/:id/status — update order status + send push notification

const express = require('express');
const router = express.Router();
const adminAuth = require('./middleware');
const { sendOrderStatusNotification } = require('../../services/fcm');

// GET /api/admin/orders
router.get('/', adminAuth, async (req, res) => {
  const db = req.app.get('db');
  const { status, zone, search, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    let whereClauses = [];
    const params = [];
    let paramIdx = 1;

    if (status && status !== 'all') {
      whereClauses.push(`o.status = $${paramIdx}`);
      params.push(status);
      paramIdx++;
    }
    if (zone && zone !== 'all') {
      whereClauses.push(`o.delivery_address ILIKE $${paramIdx}`);
      params.push(`%${zone}%`);
      paramIdx++;
    }
    if (search) {
      whereClauses.push(`(c.name ILIKE $${paramIdx} OR c.email ILIKE $${paramIdx} OR o.id::text = $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countResult = await db.query(
      `SELECT COUNT(*) FROM customer_orders o LEFT JOIN customers c ON c.id = o.customer_id ${whereSQL}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    params.push(parseInt(limit), offset);
    const result = await db.query(
      `SELECT
         o.id, o.status, o.total_amount, o.subtotal, o.delivery_fee,
         o.driver_tip, o.wallet_credit_used, o.delivery_address,
         o.delivery_slot, o.payment_method, o.notes, o.placed_at,
         o.delivered_at,
         c.name as customer_name, c.email as customer_email,
         c.phone as customer_phone,
         COALESCE(
           json_agg(
             json_build_object(
               'name', oi.product_name,
               'quantity', oi.quantity,
               'unit_price', oi.unit_price,
               'image_url', oi.image_url
             )
           ) FILTER (WHERE oi.id IS NOT NULL),
           '[]'
         ) as items
       FROM customer_orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN customer_order_items oi ON oi.order_id = o.id
       ${whereSQL}
       GROUP BY o.id, c.name, c.email, c.phone
       ORDER BY o.placed_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    res.json({
      orders: result.rows.map(o => ({
        ...o,
        ref: `#PNT-${String(o.id).padStart(4, '0')}`,
        amount: parseFloat(o.total_amount),
        zone: o.delivery_address?.includes('Sandton') ? 'Sandton' :
              o.delivery_address?.includes('Midrand') ? 'Midrand' :
              o.delivery_address?.includes('Fourways') ? 'Fourways' : 'Other',
        customer: { name: o.customer_name, email: o.customer_email, phone: o.customer_phone },
      })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) }
    });
  } catch (err) {
    console.error('GET /api/admin/orders error:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// PUT /api/admin/orders/:id/status — advance order status + send push notification
router.put('/:id/status', adminAuth, async (req, res) => {
  const db = req.app.get('db');
  const { id } = req.params;
  const { status } = req.body;

  const VALID_STATUSES = ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const timestampFields = {
      confirmed:        'confirmed_at',
      preparing:        'prepared_at',
      out_for_delivery: 'dispatched_at',
      delivered:        'delivered_at',
    };

    const timestampField = timestampFields[status];
    const updateSQL = timestampField
      ? `UPDATE customer_orders SET status = $1, ${timestampField} = NOW() WHERE id = $2 RETURNING *`
      : `UPDATE customer_orders SET status = $1 WHERE id = $2 RETURNING *`;

    const result = await db.query(updateSQL, [status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Update order_tracking table
    await db.query(
      `UPDATE order_tracking SET status = $1, updated_at = NOW() WHERE order_id = $2`,
      [status, id]
    );

    // Send push notification to customer
    try {
      const customerResult = await db.query(
        `SELECT c.fcm_token FROM customers c
         INNER JOIN customer_orders o ON o.customer_id = c.id
         WHERE o.id = $1`,
        [id]
      );

      const fcmToken = customerResult.rows[0]?.fcm_token;
      if (fcmToken) {
        await sendOrderStatusNotification(fcmToken, status, id);
      }
    } catch (notifErr) {
      // Notification failure must never break order status update
      console.error('Push notification failed (non-fatal):', notifErr.message);
    }

    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    console.error(`PUT /api/admin/orders/${id}/status error:`, err);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

module.exports = router;