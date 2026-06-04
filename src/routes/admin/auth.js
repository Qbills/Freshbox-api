// FreshBoxAPI/src/routes/admin/auth.js
// POST /api/admin/auth/login

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const adminEmail    = process.env.ADMIN_EMAIL;
    const adminHash     = process.env.ADMIN_PASSWORD_HASH;

    // Diagnose missing env vars clearly
    if (!adminEmail) {
      return res.status(500).json({ error: 'ADMIN_EMAIL not configured' });
    }
    if (!adminHash) {
      return res.status(500).json({ error: 'ADMIN_PASSWORD_HASH not configured' });
    }

    // Check email first
    if (email.toLowerCase().trim() !== adminEmail.toLowerCase().trim()) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Compare password against hash
    const valid = await bcrypt.compare(password.trim(), adminHash.trim());

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
      admin: {
        email: adminEmail,
        name: 'Ayo Williams',
        role: 'owner'
      }
    });

  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Login failed', detail: err.message });
  }
});

module.exports = router;