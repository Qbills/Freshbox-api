// FreshBox API — Messages Routes
const express = require('express');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// ── GET /api/messages ──────────────────────────────────────────────────────
// Get all conversations for driver's today route
router.get('/', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const result = await query(`
      SELECT 
        s.id as stop_id,
        s.customer_name,
        s.customer_initials,
        s.order_ref,
        s.suburb,
        s.status as stop_status,
        COUNT(CASE WHEN m.is_read = false AND m.sender = 'customer' THEN 1 END) as unread_count,
        (SELECT text FROM messages WHERE stop_id = s.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE stop_id = s.id ORDER BY created_at DESC LIMIT 1) as last_message_time
      FROM stops s
      JOIN routes r ON r.id = s.route_id
      LEFT JOIN messages m ON m.stop_id = s.id
      WHERE r.driver_id = $1 AND r.route_date = $2
      GROUP BY s.id
      ORDER BY s.stop_number ASC
    `, [req.driverId, today]);

    res.json({
      success: true,
      data: result.rows.map(r => ({
        stopId: r.stop_id,
        customerName: r.customer_name,
        initials: r.customer_initials,
        orderRef: r.order_ref,
        suburb: r.suburb,
        isCurrentStop: r.stop_status === 'active',
        unreadCount: parseInt(r.unread_count),
        lastMessage: r.last_message || 'No messages yet',
        lastTime: r.last_message_time
          ? new Date(r.last_message_time).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
          : '',
      })),
    });

  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ success: false, error: 'Failed to get messages' });
  }
});

// ── GET /api/messages/:stopId ──────────────────────────────────────────────
router.get('/:stopId', async (req, res) => {
  try {
    // Verify stop belongs to driver
    const stopCheck = await query(`
      SELECT s.id FROM stops s
      JOIN routes r ON r.id = s.route_id
      WHERE s.id = $1 AND r.driver_id = $2
    `, [req.params.stopId, req.driverId]);

    if (stopCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Stop not found' });
    }

    const result = await query(`
      SELECT * FROM messages WHERE stop_id = $1 ORDER BY created_at ASC
    `, [req.params.stopId]);

    // Mark customer messages as read
    await query(`
      UPDATE messages SET is_read = true 
      WHERE stop_id = $1 AND sender = 'customer' AND is_read = false
    `, [req.params.stopId]);

    res.json({
      success: true,
      data: result.rows.map(m => ({
        id: m.id,
        from: m.sender,
        text: m.text,
        time: new Date(m.created_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }),
        read: m.is_read,
      })),
    });

  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get thread' });
  }
});

// ── POST /api/messages/:stopId ─────────────────────────────────────────────
router.post('/:stopId', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Message text required' });
    }

    // Verify stop belongs to driver
    const stopCheck = await query(`
      SELECT s.id, s.customer_name FROM stops s
      JOIN routes r ON r.id = s.route_id
      WHERE s.id = $1 AND r.driver_id = $2
    `, [req.params.stopId, req.driverId]);

    if (stopCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Stop not found' });
    }

    const result = await query(`
      INSERT INTO messages (stop_id, sender, text, is_read)
      VALUES ($1, 'driver', $2, true)
      RETURNING *
    `, [req.params.stopId, text.trim()]);

    const msg = result.rows[0];

    // Emit real-time message event
    if (req.app.get('io')) {
      req.app.get('io').to(`stop:${req.params.stopId}`).emit('message:new', {
        id: msg.id,
        from: 'driver',
        text: msg.text,
        time: new Date(msg.created_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }),
        read: true,
      });
    }

    res.status(201).json({
      success: true,
      data: {
        id: msg.id,
        from: 'driver',
        text: msg.text,
        time: new Date(msg.created_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }),
        read: true,
      },
    });

  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to send message' });
  }
});

module.exports = router;
