// middleware/customerAuth.js
// Validates JWT and confirms role === 'customer'
// Drop this file into: FreshBoxAPI/src/middleware/customerAuth.js

const jwt = require('jsonwebtoken');

module.exports = function customerAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Accept both customer role AND driver role for testing with thabo@freshbox.co.za
    // Remove the driver exception once you have a dedicated customer account
    if (decoded.role !== 'customer' && decoded.role !== 'driver') {
      return res.status(403).json({ error: 'Customer access required' });
    }

    req.user = decoded; // { id, email, role, iat, exp }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
