// FreshBoxAPI/src/routes/customer/auth.js
// With referral bonus logic on registration

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const customerAuth = require('../../middleware/customerAuth');

function generateCustomerTokens(customerId) {
  const accessToken = jwt.sign(
    { customerId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
  const refreshToken = jwt.sign(
    { customerId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
  return { accessToken, refreshToken };
}

// POST /api/customer/auth/register
router.post('/register', async (req, res) => {
  const db = req.app.get('db');
  const { name, email, password, phone, referral_code } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ success: false, error: 'Name, email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // Check if email already exists
    const existing = await client.query(
      'SELECT id FROM customers WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'An account with this email already exists' });
    }

    // Find referrer if referral code was provided
    let referrerId = null;
    if (referral_code && referral_code.trim()) {
      const referrerResult = await client.query(
        'SELECT id FROM customers WHERE referral_code = $1 AND is_active = true',
        [referral_code.trim().toUpperCase()]
      );
      if (referrerResult.rows.length > 0) {
        referrerId = referrerResult.rows[0].id;
      }
    }

    // Hash password and generate referral code
    const password_hash = await bcrypt.hash(password, 12);
    const myReferralCode = 'PANTRI' + Math.random().toString(36).substring(2, 7).toUpperCase();

    // Insert customer
    const result = await client.query(
      `INSERT INTO customers (name, email, password_hash, phone, referral_code, referred_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, name, email, phone`,
      [
        name.trim(),
        email.toLowerCase().trim(),
        password_hash,
        phone || null,
        myReferralCode,
        referrerId,
      ]
    );

    const customer = result.rows[0];

    // Initial wallet balance — R50 if referred, R0 otherwise
    const initialBalance = referrerId ? 50 : 0;

    await client.query(
      `INSERT INTO customer_wallets (customer_id, balance, created_at) VALUES ($1, $2, NOW())`,
      [customer.id, initialBalance]
    );

    await client.query(
      `INSERT INTO customer_profiles (customer_id, loyalty_points, total_orders, total_spent, created_at) VALUES ($1, 0, 0, 0, NOW())`,
      [customer.id]
    );

    // Record the R50 welcome credit transaction if referred
    if (referrerId) {
      await client.query(
        `INSERT INTO wallet_transactions (customer_id, type, amount, description, created_at)
         VALUES ($1, 'credit', 50, 'Welcome bonus — referral code applied', NOW())`,
        [customer.id]
      );
      console.log(`✅ R50 referral welcome credit applied to new customer ${customer.email}`);
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateCustomerTokens(customer.id);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await client.query(
      `INSERT INTO customer_refresh_tokens (customer_id, token, expires_at) VALUES ($1, $2, $3)`,
      [customer.id, refreshToken, expiresAt]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      data: {
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          tier: 'seedling',
          loyaltyPoints: 0,
          walletBalance: initialBalance.toFixed(2),
          referralCode: myReferralCode,
        },
        accessToken,
        refreshToken,
        referralApplied: !!referrerId,
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/customer/auth/register error:', err);
    res.status(500).json({ success: false, error: 'Registration failed' });
  } finally {
    client.release();
  }
});

// POST /api/customer/auth/login
router.post('/login', async (req, res) => {
  const db = req.app.get('db');
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required' });
  }

  try {
    const result = await db.query(
      `SELECT c.*, cp.loyalty_points, cw.balance as wallet_balance
       FROM customers c
       LEFT JOIN customer_profiles cp ON cp.customer_id = c.id
       LEFT JOIN customer_wallets cw ON cw.customer_id = c.id
       WHERE c.email = $1 AND c.is_active = true`,
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const customer = result.rows[0];
    const isValid = await bcrypt.compare(password, customer.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const { accessToken, refreshToken } = generateCustomerTokens(customer.id);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await db.query(
      `INSERT INTO customer_refresh_tokens (customer_id, token, expires_at) VALUES ($1, $2, $3)`,
      [customer.id, refreshToken, expiresAt]
    );

    const points = parseInt(customer.loyalty_points || 0);
    let tier = 'seedling';
    if (points >= 3000) tier = 'elite';
    else if (points >= 1500) tier = 'harvest';
    else if (points >= 500) tier = 'sprout';

    res.json({
      success: true,
      data: {
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          tier,
          loyaltyPoints: points,
          walletBalance: parseFloat(customer.wallet_balance || 0).toFixed(2),
          referralCode: customer.referral_code,
        },
        accessToken,
        refreshToken,
      }
    });
  } catch (err) {
    console.error('POST /api/customer/auth/login error:', err);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// POST /api/customer/auth/refresh
router.post('/refresh', async (req, res) => {
  const db = req.app.get('db');
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ success: false, error: 'Refresh token required' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    if (!decoded.customerId) {
      return res.status(401).json({ success: false, error: 'Invalid refresh token' });
    }

    const tokenResult = await db.query(
      `SELECT * FROM customer_refresh_tokens
       WHERE token = $1 AND customer_id = $2::uuid AND expires_at > NOW()`,
      [refreshToken, decoded.customerId]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Refresh token expired or invalid' });
    }

    const accessToken = jwt.sign(
      { customerId: decoded.customerId },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({ success: true, data: { accessToken } });
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
  }
});

// POST /api/customer/auth/logout
router.post('/logout', async (req, res) => {
  const db = req.app.get('db');
  const { refreshToken } = req.body;
  try {
    if (refreshToken) {
      await db.query('DELETE FROM customer_refresh_tokens WHERE token = $1', [refreshToken]);
    }
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Logout failed' });
  }
});

// GET /api/customer/auth/me
router.get('/me', async (req, res) => {
  const db = req.app.get('db');
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.customerId) {
      return res.status(403).json({ success: false, error: 'Not a customer token' });
    }

    const result = await db.query(
      `SELECT c.*, cp.loyalty_points, cw.balance as wallet_balance
       FROM customers c
       LEFT JOIN customer_profiles cp ON cp.customer_id = c.id
       LEFT JOIN customer_wallets cw ON cw.customer_id = c.id
       WHERE c.id = $1 AND c.is_active = true`,
      [decoded.customerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    const customer = result.rows[0];
    const points = parseInt(customer.loyalty_points || 0);
    let tier = 'seedling';
    if (points >= 3000) tier = 'elite';
    else if (points >= 1500) tier = 'harvest';
    else if (points >= 500) tier = 'sprout';

    res.json({
      success: true,
      data: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        tier,
        loyaltyPoints: points,
        walletBalance: parseFloat(customer.wallet_balance || 0).toFixed(2),
        referralCode: customer.referral_code,
      }
    });
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
});

// POST /api/customer/auth/fcm-token
router.post('/fcm-token', customerAuth, async (req, res) => {
  const db = req.app.get('db');
  const customerId = req.user.id;
  const { fcm_token } = req.body;

  if (!fcm_token) {
    return res.status(400).json({ error: 'FCM token required' });
  }

  try {
    await db.query(
      `UPDATE customers SET fcm_token = $1 WHERE id = $2::uuid`,
      [fcm_token, customerId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('FCM token save error:', err);
    res.status(500).json({ error: 'Failed to save FCM token' });
  }
});

module.exports = router;