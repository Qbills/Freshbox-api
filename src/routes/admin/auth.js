// FreshBoxAPI/src/routes/admin/auth.js
// POST /api/admin/auth/login
// POST /api/admin/auth/logout

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Admin credentials stored as env vars — never hardcoded
// Set these in Railway:
//   ADMIN_EMAIL=ayo@freshbox.co.za
//   ADMIN_PASSWORD_HASH=<bcrypt hash of your password>

// POST /api/admin/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminHash = process.env.ADMIN_PASSWORD_HASH;

    if (!adminEmail || !adminHash) {
      return res.status(500).json({ error: 'Admin credentials not configured' });
    }

    if (email.toLowerCase().trim() !== adminEmail.toLowerCase()) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, adminHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { adminId: 'freshbox-admin', email: adminEmail },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      admin: { email: adminEmail, name: 'Ayo Williams', role: 'owner' }
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
