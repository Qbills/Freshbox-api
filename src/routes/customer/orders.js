// routes/customer/orders.js
// FreshBoxAPI/src/routes/customer/orders.js

const express = require('express');
const router = express.Router();
const customerAuth = require('../../middleware/customerAuth');

// GET /api/customer/orders
router.get('/', customerAuth, async (req, res) => {
  const db = req.app.get('db');
  const customerId = req.user.id;

  try {
    const result = await db.query(
      `SELECT
         o.id, o.status, o.total_amount, o.delivery_fee,
         o.wallet_credit_used, o.delivery_address, o.delivery_slot,
         o.placed_at, o.delivered_at, o.driver_tip, o.notes,
         COALESCE(
           json_agg(
             json_build_object(
               'product_id', oi.product_id,
               'name', oi.product_name,
               'quantity', oi.quantity,
               'unit_price', oi.unit_price,
               'image_url', oi.image_url
             )
           ) FILTER (WHERE oi.id IS NOT NULL),
           '[]'
         ) AS items
       FROM customer_orders o
       LEFT JOIN customer_order_items oi ON oi.order_id = o.id
       WHERE o.customer_id = $1::uuid
       GROUP BY o.id
       ORDER BY o.placed_at DESC`,
      [customerId]
    );

    const orders = result.rows;
    const active = orders.filter(o =>
      ['pending', 'confirmed', 'preparing', 'out_for_delivery'].includes(o.status)
    );
    const past = orders.filter(o =>
      ['delivered', 'cancelled'].includes(o.status)
    );

    res.json({ active, past });
  } catch (err) {
    console.error('GET /api/customer/orders error:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// POST /api/customer/orders
router.post('/', customerAuth, async (req, res) => {
  const db = req.app.get('db');
  const customerId = req.user.id;
  const {
    items,
    delivery_address,
    delivery_slot,
    payment_method,
    use_wallet_credit,
    driver_tip = 0,
    notes = ''
  } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Order must contain at least one item' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const productIds = items.map(i => i.product_id);
    const productsResult = await client.query(
      `SELECT id, name, price, image_url, stock_count, is_available
       FROM products
       WHERE id = ANY($1::int[]) AND is_active = true`,
      [productIds]
    );

    if (productsResult.rows.length !== productIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'One or more products not found or unavailable' });
    }

    const productMap = {};
    for (const p of productsResult.rows) {
      productMap[p.id] = p;
      if (!p.is_available) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `${p.name} is currently unavailable` });
      }
    }

    let subtotal = 0;
    const orderItems = items.map(item => {
      const product = productMap[item.product_id];
      subtotal += product.price * item.quantity;
      return {
        product_id: item.product_id,
        product_name: product.name,
        quantity: item.quantity,
        unit_price: product.price,
        image_url: product.image_url
      };
    });

    const delivery_fee = 49.00;
    let wallet_credit_used = 0;

    if (use_wallet_credit) {
      const walletResult = await client.query(
        `SELECT balance FROM customer_wallets WHERE customer_id = $1::uuid FOR UPDATE`,
        [customerId]
      );
      if (walletResult.rows.length > 0) {
        const available = parseFloat(walletResult.rows[0].balance);
        const orderTotal = subtotal + delivery_fee + parseFloat(driver_tip);
        wallet_credit_used = Math.min(available, orderTotal);
      }
    }

    const total_amount = subtotal + delivery_fee + parseFloat(driver_tip) - wallet_credit_used;

    const orderResult = await client.query(
      `INSERT INTO customer_orders
         (customer_id, status, subtotal, delivery_fee, driver_tip, wallet_credit_used,
          total_amount, delivery_address, delivery_slot, payment_method, notes, placed_at)
       VALUES ($1::uuid, 'pending', $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       RETURNING id`,
      [customerId, subtotal, delivery_fee, driver_tip, wallet_credit_used,
       total_amount, delivery_address, delivery_slot, payment_method, notes]
    );

    const orderId = orderResult.rows[0].id;

    for (const item of orderItems) {
      await client.query(
        `INSERT INTO customer_order_items
           (order_id, product_id, product_name, quantity, unit_price, image_url)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orderId, item.product_id, item.product_name, item.quantity, item.unit_price, item.image_url]
      );
      await client.query(
        `UPDATE products SET stock_count = stock_count - $1 WHERE id = $2`,
        [item.quantity, item.product_id]
      );
    }

    if (wallet_credit_used > 0) {
      await client.query(
        `UPDATE customer_wallets SET balance = balance - $1 WHERE customer_id = $2::uuid`,
        [wallet_credit_used, customerId]
      );
      await client.query(
        `INSERT INTO wallet_transactions (customer_id, type, amount, description, reference_id, created_at)
         VALUES ($1::uuid, 'debit', $2, 'Used for order', $3, NOW())`,
        [customerId, wallet_credit_used, orderId]
      );
    }

    const pointsEarned = Math.floor(subtotal / 10);
    if (pointsEarned > 0) {
      await client.query(
        `INSERT INTO loyalty_points (customer_id, points, type, description, order_id, created_at)
         VALUES ($1::uuid, $2, 'earn', 'Order points', $3, NOW())`,
        [customerId, pointsEarned, orderId]
      );
      await client.query(
        `UPDATE customer_profiles SET loyalty_points = loyalty_points + $1 WHERE customer_id = $2::uuid`,
        [pointsEarned, customerId]
      );
    }

    await client.query(
      `INSERT INTO order_tracking (order_id, status, updated_at)
       VALUES ($1, 'pending', NOW())`,
      [orderId]
    );

    await client.query('COMMIT');

    res.status(201).json({
      order: {
        id: orderId,
        status: 'pending',
        total_amount,
        subtotal,
        delivery_fee,
        driver_tip,
        wallet_credit_used,
        points_earned: pointsEarned,
        payment_method,
        delivery_slot,
        items: orderItems
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/customer/orders error:', err);
    res.status(500).json({ error: 'Failed to place order', detail: err.message });
  } finally {
    client.release();
  }
});

// GET /api/customer/orders/:id
router.get('/:id', customerAuth, async (req, res) => {
  const db = req.app.get('db');
  const customerId = req.user.id;
  const { id } = req.params;

  try {
    const result = await db.query(
      `SELECT o.*,
         COALESCE(
           json_agg(
             json_build_object(
               'product_id', oi.product_id,
               'name', oi.product_name,
               'quantity', oi.quantity,
               'unit_price', oi.unit_price,
               'image_url', oi.image_url
             )
           ) FILTER (WHERE oi.id IS NOT NULL),
           '[]'
         ) AS items
       FROM customer_orders o
       LEFT JOIN customer_order_items oi ON oi.order_id = o.id
       WHERE o.id = $1::integer AND o.customer_id = $2::uuid
       GROUP BY o.id`,
      [id, customerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ order: result.rows[0] });
  } catch (err) {
    console.error(`GET /api/customer/orders/${id} error:`, err);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// GET /api/customer/orders/:id/tracking
router.get('/:id/tracking', customerAuth, async (req, res) => {
  const db = req.app.get('db');
  const customerId = req.user.id;
  const { id } = req.params;

  try {
    const orderResult = await db.query(
      `SELECT o.id, o.status, o.delivery_address, o.delivery_slot,
              d.name AS driver_name,
              d.vehicle_registration AS driver_vehicle,
              ot.driver_lat, ot.driver_lng, ot.eta_mins,
              ot.updated_at AS tracking_updated_at
       FROM customer_orders o
       LEFT JOIN order_tracking ot ON ot.order_id = o.id
       LEFT JOIN drivers d ON d.id = ot.driver_id
       WHERE o.id = $1::integer AND o.customer_id = $2::uuid
       ORDER BY ot.updated_at DESC NULLS LAST`,
      [id, customerId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const row = orderResult.rows[0];

    const statusSteps = {
      pending:          { step: 1, label: 'Order Placed',     description: 'We have received your order' },
      confirmed:        { step: 2, label: 'Order Confirmed',  description: 'Your order is confirmed' },
      preparing:        { step: 3, label: 'Being Prepared',   description: 'Your meal kit is being packed' },
      out_for_delivery: { step: 4, label: 'Out for Delivery', description: 'Your driver is on the way' },
      delivered:        { step: 5, label: 'Delivered',        description: 'Enjoy your meal!' },
    };

    const tracking = statusSteps[row.status] || statusSteps['pending'];

    res.json({
      order_id: row.id,
      status: row.status,
      current_step: tracking.step,
      step_label: tracking.label,
      step_description: tracking.description,
      delivery_address: row.delivery_address,
      delivery_slot: row.delivery_slot,
      driver: row.driver_name ? {
        name: row.driver_name,
        vehicle: row.driver_vehicle,
      } : null,
      live_location: (row.driver_lat && row.driver_lng) ? {
        lat: parseFloat(row.driver_lat),
        lng: parseFloat(row.driver_lng),
        eta_mins: row.eta_mins,
      } : null,
      updated_at: row.tracking_updated_at,
    });
  } catch (err) {
    console.error(`GET /api/customer/orders/${id}/tracking error:`, err);
    res.status(500).json({ error: 'Failed to fetch tracking', detail: err.message });
  }
});

module.exports = router;