// routes/customer/wallet.js
// Drop into: FreshBoxAPI/src/routes/customer/wallet.js
//
// Endpoints:
//   GET  /api/customer/wallet                    — balance + transaction history
//   POST /api/customer/wallet/add                — add credit (admin/promo use)
//   GET  /api/customer/wallet/loyalty            — loyalty points summary + tier
//   POST /api/customer/wallet/loyalty/convert    — convert points to wallet cash

const express = require('express');
const router = express.Router();
const customerAuth = require('../../middleware/customerAuth');

// GET /api/customer/wallet
router.get('/', customerAuth, async (req, res) => {
  const db = req.app.get('db');
  const customerId = req.user.id;

  try {
    // Upsert wallet so it always exists
    await db.query(
      `INSERT INTO customer_wallets (customer_id, balance, created_at)
       VALUES ($1, 0, NOW())
       ON CONFLICT (customer_id) DO NOTHING`,
      [customerId]
    );

    const walletResult = await db.query(
      `SELECT balance FROM customer_wallets WHERE customer_id = $1`,
      [customerId]
    );

    const transactionsResult = await db.query(
      `SELECT id, type, amount, description, created_at
       FROM wallet_transactions
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [customerId]
    );

    res.json({
      balance: parseFloat(walletResult.rows[0]?.balance || 0),
      transactions: transactionsResult.rows
    });
  } catch (err) {
    console.error('GET /api/customer/wallet error:', err);
    res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

// GET /api/customer/wallet/loyalty — points + tier info
router.get('/loyalty', customerAuth, async (req, res) => {
  const db = req.app.get('db');
  const customerId = req.user.id;

  try {
    // Upsert profile so it always exists
    await db.query(
      `INSERT INTO customer_profiles (customer_id, loyalty_points, created_at)
       VALUES ($1, 0, NOW())
       ON CONFLICT (customer_id) DO NOTHING`,
      [customerId]
    );

    const profileResult = await db.query(
      `SELECT loyalty_points FROM customer_profiles WHERE customer_id = $1`,
      [customerId]
    );

    const points = parseInt(profileResult.rows[0]?.loyalty_points || 0);

    // Tier thresholds (from freshbox_summary_3.txt)
    let tier, tier_emoji, next_tier, points_to_next, bonus_rate, perks;
    if (points >= 3000) {
      tier = 'Pantri Elite'; tier_emoji = '⭐'; next_tier = null;
      points_to_next = 0; bonus_rate = 1.30;
      perks = ['+30% bonus points', 'Priority delivery', 'Monthly gift'];
    } else if (points >= 1500) {
      tier = 'Harvest'; tier_emoji = '🌾'; next_tier = 'Pantri Elite';
      points_to_next = 3000 - points; bonus_rate = 1.20;
      perks = ['+20% bonus points', '1 free delivery/month'];
    } else if (points >= 500) {
      tier = 'Sprout'; tier_emoji = '🌿'; next_tier = 'Harvest';
      points_to_next = 1500 - points; bonus_rate = 1.10;
      perks = ['+10% bonus points'];
    } else {
      tier = 'Seedling'; tier_emoji = '🌱'; next_tier = 'Sprout';
      points_to_next = 500 - points; bonus_rate = 1.00;
      perks = ['Standard earn rate'];
    }

    const recentPoints = await db.query(
      `SELECT points, type, description, created_at
       FROM loyalty_points
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [customerId]
    );

    res.json({
      points,
      cash_value: parseFloat((points / 1000 * 100).toFixed(2)), // 1000 pts = R100
      tier,
      tier_emoji,
      next_tier,
      points_to_next,
      bonus_rate,
      perks,
      earn_rate: 'R10 spent = 1 point',
      conversion_rate: '1000 points = R100 wallet cash',
      history: recentPoints.rows
    });
  } catch (err) {
    console.error('GET /api/customer/wallet/loyalty error:', err);
    res.status(500).json({ error: 'Failed to fetch loyalty data' });
  }
});

// POST /api/customer/wallet/loyalty/convert — redeem points for wallet cash
router.post('/loyalty/convert', customerAuth, async (req, res) => {
  const db = req.app.get('db');
  const customerId = req.user.id;
  const { points_to_convert } = req.body;

  if (!points_to_convert || points_to_convert < 1000) {
    return res.status(400).json({ error: 'Minimum conversion is 1000 points (= R100)' });
  }

  if (points_to_convert % 1000 !== 0) {
    return res.status(400).json({ error: 'Points must be converted in multiples of 1000' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const profileResult = await client.query(
      `SELECT loyalty_points FROM customer_profiles WHERE customer_id = $1 FOR UPDATE`,
      [customerId]
    );

    const currentPoints = parseInt(profileResult.rows[0]?.loyalty_points || 0);

    if (currentPoints < points_to_convert) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient points' });
    }

    const cashValue = (points_to_convert / 1000) * 100;

    // Deduct points
    await client.query(
      `UPDATE customer_profiles SET loyalty_points = loyalty_points - $1 WHERE customer_id = $2`,
      [points_to_convert, customerId]
    );

    // Record point deduction
    await client.query(
      `INSERT INTO loyalty_points (customer_id, points, type, description, created_at)
       VALUES ($1, $2, 'redeem', 'Converted to wallet cash', NOW())`,
      [customerId, points_to_convert]
    );

    // Add to wallet
    await client.query(
      `INSERT INTO customer_wallets (customer_id, balance, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (customer_id) DO UPDATE SET balance = customer_wallets.balance + $2`,
      [customerId, cashValue]
    );

    // Record wallet transaction
    await client.query(
      `INSERT INTO wallet_transactions (customer_id, type, amount, description, created_at)
       VALUES ($1, 'credit', $2, 'Loyalty points converted', NOW())`,
      [customerId, cashValue]
    );

    const newBalance = await client.query(
      `SELECT balance FROM customer_wallets WHERE customer_id = $1`,
      [customerId]
    );

    const newPoints = await client.query(
      `SELECT loyalty_points FROM customer_profiles WHERE customer_id = $1`,
      [customerId]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      points_converted: points_to_convert,
      cash_added: cashValue,
      new_wallet_balance: parseFloat(newBalance.rows[0].balance),
      remaining_points: parseInt(newPoints.rows[0].loyalty_points)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/customer/wallet/loyalty/convert error:', err);
    res.status(500).json({ error: 'Failed to convert points' });
  } finally {
    client.release();
  }
});

module.exports = router;
