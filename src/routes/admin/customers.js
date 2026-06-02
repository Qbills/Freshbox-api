// FreshBoxAPI/src/routes/admin/customers.js
// GET /api/admin/customers       — all customers with stats
// GET /api/admin/customers/:id   — single customer full profile
// POST /api/admin/customers/:id/wallet — add wallet credit

const express = require('express');
const router = express.Router();
const adminAuth = require('./middleware');

// GET /api/admin/customers
router.get('/', adminAuth, async (req, res) => {
  const db = req.app.get('db');
  const { search, tier } = req.query;

  try {
    let whereClauses = ['c.is_active = true'];
    const params = [];
    let paramIdx = 1;

    if (search) {
      whereClauses.push(`(c.name ILIKE $${paramIdx} OR c.email ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereSQL = `WHERE ${whereClauses.join(' AND ')}`;

    const result = await db.query(
      `SELECT
         c.id, c.name, c.email, c.phone, c.referral_code, c.created_at,
         COALESCE(cp.loyalty_points, 0) as loyalty_points,
         COALESCE(cp.total_orders, 0) as total_orders,
         COALESCE(cp.total_spent, 0) as total_spent,
         COALESCE(cw.balance, 0) as wallet_balance,
         MAX(o.placed_at) as last_order_at
       FROM customers c
       LEFT JOIN customer_profiles cp ON cp.customer_id = c.id
       LEFT JOIN customer_wallets cw ON cw.customer_id = c.id
       LEFT JOIN customer_orders o ON o.customer_id = c.id
       ${whereSQL}
       GROUP BY c.id, cp.loyalty_points, cp.total_orders, cp.total_spent, cw.balance
       ORDER BY cp.total_spent DESC NULLS LAST`,
      params
    );

    const customers = result.rows.map(c => {
      const points = parseInt(c.loyalty_points || 0);
      let tier = 'Seedling';
      if (points >= 3000) tier = 'Pantri Elite';
      else if (points >= 1500) tier = 'Harvest';
      else if (points >= 500) tier = 'Sprout';

      // Churn risk: no order in 30+ days
      const daysSinceLastOrder = c.last_order_at
        ? Math.floor((Date.now() - new Date(c.last_order_at)) / (1000 * 60 * 60 * 24))
        : 999;
      const churnRisk = daysSinceLastOrder > 30 ? 'high' : daysSinceLastOrder > 14 ? 'medium' : 'low';

      return {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        referralCode: c.referral_code,
        joinedAt: c.created_at,
        lastOrderAt: c.last_order_at,
        loyaltyPoints: points,
        totalOrders: parseInt(c.total_orders || 0),
        totalSpent: parseFloat(c.total_spent || 0),
        walletBalance: parseFloat(c.wallet_balance || 0),
        tier,
        churnRisk,
        daysSinceLastOrder,
      };
    });

    // Apply tier filter after building
    const filtered = tier && tier !== 'all'
      ? customers.filter(c => c.tier === tier)
      : customers;

    res.json({ customers: filtered, total: filtered.length });
  } catch (err) {
    console.error('GET /api/admin/customers error:', err);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// POST /api/admin/customers/:id/wallet — add wallet credit
router.post('/:id/wallet', adminAuth, async (req, res) => {
  const db = req.app.get('db');
  const { id } = req.params;
  const { amount, description } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid amount required' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO customer_wallets (customer_id, balance, created_at)
       VALUES ($1::uuid, $2, NOW())
       ON CONFLICT (customer_id) DO UPDATE SET balance = customer_wallets.balance + $2`,
      [id, amount]
    );

    await client.query(
      `INSERT INTO wallet_transactions (customer_id, type, amount, description, created_at)
       VALUES ($1::uuid, 'credit', $2, $3, NOW())`,
      [id, amount, description || 'Admin credit']
    );

    await client.query('COMMIT');

    const walletResult = await db.query(
      `SELECT balance FROM customer_wallets WHERE customer_id = $1::uuid`,
      [id]
    );

    res.json({
      success: true,
      newBalance: parseFloat(walletResult.rows[0]?.balance || 0),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`POST /api/admin/customers/${id}/wallet error:`, err);
    res.status(500).json({ error: 'Failed to add credit' });
  } finally {
    client.release();
  }
});

module.exports = router;
