// FreshBoxAPI/src/routes/admin/overview.js
// GET /api/admin/overview — real business stats

const express = require('express');
const router = express.Router();
const adminAuth = require('./middleware');

router.get('/', adminAuth, async (req, res) => {
  const db = req.app.get('db');

  try {
    // Run all queries in parallel
    const [
      ordersToday,
      ordersTotal,
      revenueToday,
      revenueTotal,
      customersTotal,
      customersNew,
      activeOrders,
      productsLowStock,
      revenueByDay,
      ordersByZone,
      recentOrders,
    ] = await Promise.all([

      // Orders placed today
      db.query(`SELECT COUNT(*) FROM customer_orders WHERE DATE(placed_at) = CURRENT_DATE`),

      // Total orders ever
      db.query(`SELECT COUNT(*) FROM customer_orders`),

      // Revenue today
      db.query(`SELECT COALESCE(SUM(total_amount), 0) as total FROM customer_orders WHERE DATE(placed_at) = CURRENT_DATE AND status != 'cancelled'`),

      // Total revenue ever
      db.query(`SELECT COALESCE(SUM(total_amount), 0) as total FROM customer_orders WHERE status != 'cancelled'`),

      // Total customers
      db.query(`SELECT COUNT(*) FROM customers`),

      // New customers this week
      db.query(`SELECT COUNT(*) FROM customers WHERE created_at >= NOW() - INTERVAL '7 days'`),

      // Active orders (not delivered/cancelled)
      db.query(`SELECT COUNT(*) FROM customer_orders WHERE status NOT IN ('delivered', 'cancelled')`),

      // Products low stock (< 10)
      db.query(`SELECT COUNT(*) FROM products WHERE stock_count < 10 AND is_active = true`),

      // Revenue last 7 days
      db.query(`
        SELECT
          TO_CHAR(d.day, 'Dy') as day,
          COALESCE(SUM(o.total_amount), 0) as revenue,
          COUNT(o.id) as orders
        FROM generate_series(
          CURRENT_DATE - INTERVAL '6 days',
          CURRENT_DATE,
          '1 day'::interval
        ) AS d(day)
        LEFT JOIN customer_orders o
          ON DATE(o.placed_at) = d.day AND o.status != 'cancelled'
        GROUP BY d.day
        ORDER BY d.day ASC
      `),

      // Orders by delivery zone (extracted from address)
      db.query(`
        SELECT
          CASE
            WHEN delivery_address ILIKE '%sandton%' THEN 'Sandton'
            WHEN delivery_address ILIKE '%midrand%' THEN 'Midrand'
            WHEN delivery_address ILIKE '%fourways%' THEN 'Fourways'
            ELSE 'Other'
          END as zone,
          COUNT(*) as orders,
          COALESCE(SUM(total_amount), 0) as revenue
        FROM customer_orders
        WHERE status != 'cancelled'
        GROUP BY zone
        ORDER BY orders DESC
      `),

      // Recent orders with customer info
      db.query(`
        SELECT
          o.id,
          o.status,
          o.total_amount,
          o.delivery_address,
          o.placed_at,
          c.name as customer_name,
          c.email as customer_email,
          COALESCE(
            json_agg(
              json_build_object('name', oi.product_name, 'quantity', oi.quantity)
            ) FILTER (WHERE oi.id IS NOT NULL),
            '[]'
          ) as items
        FROM customer_orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN customer_order_items oi ON oi.order_id = o.id
        GROUP BY o.id, c.name, c.email
        ORDER BY o.placed_at DESC
      `),
    ]);

    res.json({
      stats: {
        ordersToday: parseInt(ordersToday.rows[0].count),
        ordersTotal: parseInt(ordersTotal.rows[0].count),
        revenueToday: parseFloat(revenueToday.rows[0].total),
        revenueTotal: parseFloat(revenueTotal.rows[0].total),
        customersTotal: parseInt(customersTotal.rows[0].count),
        customersNew: parseInt(customersNew.rows[0].count),
        activeOrders: parseInt(activeOrders.rows[0].count),
        productsLowStock: parseInt(productsLowStock.rows[0].count),
      },
      revenueByDay: revenueByDay.rows.map(r => ({
        day: r.day,
        revenue: parseFloat(r.revenue),
        orders: parseInt(r.orders),
      })),
      ordersByZone: ordersByZone.rows.map(r => ({
        zone: r.zone,
        orders: parseInt(r.orders),
        revenue: parseFloat(r.revenue),
      })),
      recentOrders: recentOrders.rows.map(r => ({
        id: r.id,
        ref: `#PNT-${String(r.id).padStart(4, '0')}`,
        status: r.status,
        amount: parseFloat(r.total_amount),
        address: r.delivery_address,
        placedAt: r.placed_at,
        customer: { name: r.customer_name, email: r.customer_email },
        items: r.items,
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/overview error:', err);
    res.status(500).json({ error: 'Failed to fetch overview', detail: err.message });
  }
});

module.exports = router;
