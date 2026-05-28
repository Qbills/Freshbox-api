// FreshBox API — JWT Authentication Middleware
const jwt = require('jsonwebtoken');
const { query } = require('../db');

// ── Verify access token ────────────────────────────────────────────────────
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided. Include Authorization: Bearer <token>',
      });
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    // Verify driver still exists and is active
    const result = await query(
      'SELECT id, name, email, is_active, is_online, rating FROM drivers WHERE id = $1',
      [decoded.driverId]
    );

    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return res.status(401).json({ success: false, error: 'Driver account not found or deactivated' });
    }

    req.driver = result.rows[0];
    req.driverId = decoded.driverId;
    next();

  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ success: false, error: 'Authentication error' });
  }
}

// ── Generate token pair ────────────────────────────────────────────────────
function generateTokens(driverId) {
  const accessToken = jwt.sign(
    { driverId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  const refreshToken = jwt.sign(
    { driverId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  return { accessToken, refreshToken };
}

module.exports = { authenticate, generateTokens };
