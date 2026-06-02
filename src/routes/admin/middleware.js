// FreshBoxAPI/src/middleware/adminAuth.js
// Validates admin JWT token

const jwt = require('jsonwebtoken');

module.exports = function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.adminId) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.admin = { id: decoded.adminId, email: decoded.email };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
