// FreshBox API — Main Server
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const authRoutes            = require('./routes/auth');
const routeRoutes           = require('./routes/route');
const messageRoutes         = require('./routes/messages');
const earningsRoutes        = require('./routes/earnings');
const customerAuthRoutes    = require('./routes/customer/auth');
const customerProductRoutes = require('./routes/customer/products');
const customerOrderRoutes   = require('./routes/customer/orders');
const customerWalletRoutes  = require('./routes/customer/wallet');
const { initSockets } = require('./sockets');
const { pool }       = require('./db');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
});

// ── Make io and db accessible in route handlers ───────────────────────────
app.set('io', io);
app.set('db', pool);

// ── Middleware ────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logger (dev only)
if (process.env.NODE_ENV === 'development') {
  app.use((req, _res, next) => {
    console.log(`${new Date().toISOString().slice(11,19)} ${req.method} ${req.path}`);
    next();
  });
}

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      service: 'FreshBox API',
      version: '1.0.0',
      db: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ── API Routes ────────────────────────────────────────────────────────────
// Driver routes
app.use('/api/auth',     authRoutes);
app.use('/api/route',    routeRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/earnings', earningsRoutes);

// Customer routes
app.use('/api/customer/auth',     customerAuthRoutes);
app.use('/api/customer/products', customerProductRoutes);
app.use('/api/customer/orders',   customerOrderRoutes);
app.use('/api/customer/wallet',   customerWalletRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} not found`,
  });
});

// ── Global error handler ──────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── WebSockets ────────────────────────────────────────────────────────────
initSockets(io);

// ── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 FreshBox API running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📡 WebSocket: enabled`);
  console.log(`🔗 Health: http://localhost:${PORT}/health\n`);
});

module.exports = { app, server };