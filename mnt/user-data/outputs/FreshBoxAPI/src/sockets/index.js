// FreshBox API — WebSocket / Socket.io Handler
const jwt = require('jsonwebtoken');
const { query } = require('../db');

function initSockets(io) {
  // ── Auth middleware for sockets ──────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const result = await query(
        'SELECT id, name FROM drivers WHERE id = $1 AND is_active = true',
        [decoded.driverId]
      );

      if (result.rows.length === 0) {
        return next(new Error('Driver not found'));
      }

      socket.driverId = decoded.driverId;
      socket.driverName = result.rows[0].name;
      next();

    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Driver connected: ${socket.driverName} (${socket.driverId})`);

    // Join driver's personal room
    socket.join(`driver:${socket.driverId}`);

    // ── Driver goes online ─────────────────────────────────────────────────
    socket.on('driver:online', async () => {
      try {
        await query(
          'UPDATE drivers SET is_online = true, updated_at = NOW() WHERE id = $1',
          [socket.driverId]
        );
        socket.emit('driver:status', { online: true });
        console.log(`✅ ${socket.driverName} is online`);
      } catch (err) {
        socket.emit('error', { message: 'Failed to set online status' });
      }
    });

    // ── GPS location update ────────────────────────────────────────────────
    socket.on('location:update', async (data) => {
      try {
        const { latitude, longitude, speed, heading } = data;

        if (!latitude || !longitude) return;

        // Store in DB
        await query(`
          INSERT INTO driver_locations (driver_id, latitude, longitude, speed, heading)
          VALUES ($1, $2, $3, $4, $5)
        `, [socket.driverId, latitude, longitude, speed || null, heading || null]);

        // Broadcast to anyone tracking this driver (customers)
        io.emit(`driver:location:${socket.driverId}`, {
          driverId: socket.driverId,
          latitude,
          longitude,
          speed,
          heading,
          timestamp: new Date().toISOString(),
        });

      } catch (err) {
        console.error('Location update error:', err.message);
      }
    });

    // ── Join a stop's message room ─────────────────────────────────────────
    socket.on('join:stop', (stopId) => {
      socket.join(`stop:${stopId}`);
    });

    // ── Leave a stop's message room ────────────────────────────────────────
    socket.on('leave:stop', (stopId) => {
      socket.leave(`stop:${stopId}`);
    });

    // ── Driver sends message via socket ───────────────────────────────────
    socket.on('message:send', async (data) => {
      try {
        const { stopId, text } = data;
        if (!stopId || !text?.trim()) return;

        const result = await query(`
          INSERT INTO messages (stop_id, sender, text, is_read)
          VALUES ($1, 'driver', $2, true)
          RETURNING *
        `, [stopId, text.trim()]);

        const msg = result.rows[0];
        const formatted = {
          id: msg.id,
          from: 'driver',
          text: msg.text,
          time: new Date(msg.created_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }),
          read: true,
        };

        // Broadcast to everyone in the stop room (driver + customer)
        io.to(`stop:${stopId}`).emit('message:new', formatted);

      } catch (err) {
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // ── Typing indicator ───────────────────────────────────────────────────
    socket.on('typing:start', ({ stopId }) => {
      socket.to(`stop:${stopId}`).emit('typing:start', { sender: 'driver' });
    });

    socket.on('typing:stop', ({ stopId }) => {
      socket.to(`stop:${stopId}`).emit('typing:stop', { sender: 'driver' });
    });

    // ── Disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      try {
        await query(
          'UPDATE drivers SET is_online = false, updated_at = NOW() WHERE id = $1',
          [socket.driverId]
        );
        console.log(`❌ Driver disconnected: ${socket.driverName}`);
      } catch (err) {
        console.error('Disconnect error:', err.message);
      }
    });
  });
}

module.exports = { initSockets };
