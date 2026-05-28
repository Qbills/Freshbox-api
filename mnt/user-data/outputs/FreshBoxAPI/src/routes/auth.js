// FreshBox API — Authentication Routes
const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { query } = require('../db');
const { authenticate, generateTokens } = require('../middleware/auth');

const router = express.Router();

// ── POST /api/auth/login ───────────────────────────────────────────────────
router.post('/login', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password min 6 characters'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find driver
    const result = await query(
      'SELECT * FROM drivers WHERE email = $1 AND is_active = true',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const driver = result.rows[0];

    // Check password
    const isValid = await bcrypt.compare(password, driver.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(driver.id);

    // Store refresh token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await query(
      'INSERT INTO refresh_tokens (driver_id, token, expires_at) VALUES ($1, $2, $3)',
      [driver.id, refreshToken, expiresAt]
    );

    // Set driver online
    await query('UPDATE drivers SET is_online = true, updated_at = NOW() WHERE id = $1', [driver.id]);

    res.json({
      success: true,
      data: {
        driver: {
          id: driver.id,
          name: driver.name,
          email: driver.email,
          phone: driver.phone,
          vehicleReg: driver.vehicle_reg,
          rating: parseFloat(driver.rating),
          totalDeliveries: driver.total_deliveries,
          initials: driver.name.split(' ').map(n => n[0]).join('').toUpperCase(),
        },
        accessToken,
        refreshToken,
      },
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// ── POST /api/auth/refresh ─────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, error: 'Refresh token required' });
    }

    // Verify token
    const jwt = require('jsonwebtoken');
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
    }

    // Check token exists in DB and not expired
    const tokenResult = await query(
      'SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
      [refreshToken]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Refresh token not found or expired' });
    }

    // Delete old refresh token (rotation)
    await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);

    // Generate new token pair
    const tokens = generateTokens(decoded.driverId);

    // Store new refresh token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await query(
      'INSERT INTO refresh_tokens (driver_id, token, expires_at) VALUES ($1, $2, $3)',
      [decoded.driverId, tokens.refreshToken, expiresAt]
    );

    res.json({ success: true, data: tokens });

  } catch (err) {
    console.error('Refresh error:', err);
    res.status(500).json({ success: false, error: 'Token refresh failed' });
  }
});

// ── POST /api/auth/logout ──────────────────────────────────────────────────
router.post('/logout', authenticate, async (req, res) => {
  try {
    const { refreshToken } = req.body;

    // Delete refresh token
    if (refreshToken) {
      await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    }

    // Set driver offline
    await query('UPDATE drivers SET is_online = false, updated_at = NOW() WHERE id = $1', [req.driverId]);

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Logout failed' });
  }
});

// ── GET /api/auth/me ───────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, name, email, phone, vehicle_reg, rating, total_deliveries, is_online, created_at FROM drivers WHERE id = $1',
      [req.driverId]
    );
    const d = result.rows[0];
    res.json({
      success: true,
      data: {
        id: d.id,
        name: d.name,
        email: d.email,
        phone: d.phone,
        vehicleReg: d.vehicle_reg,
        rating: parseFloat(d.rating),
        totalDeliveries: d.total_deliveries,
        isOnline: d.is_online,
        initials: d.name.split(' ').map(n => n[0]).join('').toUpperCase(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get profile' });
  }
});

// ── PATCH /api/auth/fcm-token ─────────────────────────────────────────────
router.patch('/fcm-token', authenticate, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    await query('UPDATE drivers SET fcm_token = $1 WHERE id = $2', [fcmToken, req.driverId]);
    res.json({ success: true, message: 'FCM token updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update FCM token' });
  }
});

module.exports = router;
