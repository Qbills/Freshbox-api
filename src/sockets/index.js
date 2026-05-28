const jwt = require('jsonwebtoken');
const { query } = require('../db');

function initSockets(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Authentication required'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const result = await query('SELECT id, name FROM drivers WHERE id = $1 AND is_active = true', [decoded.driverId]);
      if (result.rows.length === 0) return next(new Error('Driver not found'));
      socket.driverId = decoded.driverId;
      socket.driverName = result.rows[0].name;
      next();
    } catch (err) { next(new Error('Invalid token')); }
  });

  io.on('connection', (socket) => {
    console.log(`Driver connected: ${socket.driverName}`);
    socket.join(`driver:${socket.driverId}`);

    socket.on('driver:online', async () => {
      await query('UPDATE drivers SET is_online = true, updated_at = NOW() WHERE id = $1', [socket.driverId]);
      socket.emit('driver:status', { online: true });
    });

    socket.on('location:update', async (data) => {
      const { latitude, longitude, speed, heading } = data;
      if (!latitude || !longitude) return;
      await query('INSERT INTO driver_locations (driver_id, latitude, longitude, speed, heading) VALUES ($1, $2, $3, $4, $5)', [socket.driverId, latitude, longitude, speed || null, heading || null]);
      io.emit(`driver:location:${socket.driverId}`, { driverId: socket.driverId, latitude, longitude, speed, heading, timestamp: new Date().toISOString() });
    });

    socket.on('join:stop', (stopId) => socket.join(`stop:${stopId}`));
    socket.on('leave:stop', (stopId) => socket.leave(`stop:${stopId}`));

    socket.on('message:send', async (data) => {
      const { stopId, text } = data;
      if (!stopId || !text?.trim()) return;
      const result = await query('INSERT INTO messages (stop_id, sender, text, is_read) VALUES ($1, $2, $3, true) RETURNING *', [stopId, 'driver', text.trim()]);
      const msg = result.rows[0];
      io.to(`stop:${stopId}`).emit('message:new', { id: msg.id, from: 'driver', text: msg.text, time: new Date(msg.created_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }), read: true });
    });

    socket.on('typing:start', ({ stopId }) => socket.to(`stop:${stopId}`).emit('typing:start', { sender: 'driver' }));
    socket.on('typing:stop', ({ stopId }) => socket.to(`stop:${stopId}`).emit('typing:stop', { sender: 'driver' }));

    socket.on('disconnect', async () => {
      await query('UPDATE drivers SET is_online = false, updated_at = NOW() WHERE id = $1', [socket.driverId]);
      console.log(`Driver disconnected: ${socket.driverName}`);
    });
  });
}

module.exports = { initSockets };