// middleware/customerAuth.js
// Validates JWT and confirms it contains customerId (issued by customer login)
// Drop this file into: FreshBoxAPI/src/middleware/customerAuth.js
// REPLACES the previous version

const jwt = require('jsonwebtoken');

module.exports = function customerAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Customer tokens contain customerId
    // Driver tokens contain driverId
    // Reject driver tokens from customer endpoints
    if (!decoded.customerId) {
      return res.status(403).json({
        error: 'This endpoint requires a customer account. Please log in with your Pantri customer account.'
      });
    }

    req.user = { id: decoded.customerId };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
