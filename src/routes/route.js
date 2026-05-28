// FreshBox API — Stops & Delivery Routes
const express = require('express');
const { query, getClient } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// ── GET /api/route/today ───────────────────────────────────────────────────
router.get('/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const routeResult = await query(`
      SELECT r.*, 
        COUNT(s.id) as total_stops,
        COUNT(CASE WHEN s.status = 'delivered' THEN 1 END) as completed_stops,
        COUNT(CASE WHEN s.status = 'active' THEN 1 END) as active_stops
      FROM routes r
      LEFT JOIN stops s ON s.route_id = r.id
      WHERE r.driver_id = $1 AND r.route_date = $2
      GROUP BY r.id
    `, [req.driverId, today]);

    if (routeResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No route found for today' });
    }

    const route = routeResult.rows[0];

    // Get all stops for this route
    const stopsResult = await query(`
      SELECT 
        s.*,
        COUNT(CASE WHEN m.is_read = false AND m.sender = 'customer' THEN 1 END) as unread_count
      FROM stops s
      LEFT JOIN messages m ON m.stop_id = s.id
      WHERE s.route_id = $1
      GROUP BY s.id
      ORDER BY s.stop_number ASC
    `, [route.id]);

    res.json({
      success: true,
      data: {
        route: {
          id: route.id,
          date: route.route_date,
          hubAddress: route.hub_address,
          totalStops: parseInt(route.total_stops),
          completedStops: parseInt(route.completed_stops),
          status: route.status,
          startedAt: route.started_at,
        },
        stops: stopsResult.rows.map(formatStop),
      },
    });

  } catch (err) {
    console.error('Get route error:', err);
    res.status(500).json({ success: false, error: 'Failed to get route' });
  }
});

// ── GET /api/route/stops/:id ───────────────────────────────────────────────
router.get('/stops/:id', async (req, res) => {
  try {
    const result = await query(`
      SELECT s.* FROM stops s
      JOIN routes r ON r.id = s.route_id
      WHERE s.id = $1 AND r.driver_id = $2
    `, [req.params.id, req.driverId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Stop not found' });
    }

    res.json({ success: true, data: formatStop(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get stop' });
  }
});

// ── PATCH /api/route/stops/:id/deliver ────────────────────────────────────
router.patch('/stops/:id/deliver', async (req, res) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { photoUrl } = req.body;

    // Verify stop belongs to driver
    const stopCheck = await client.query(`
      SELECT s.*, r.id as route_id, r.driver_id FROM stops s
      JOIN routes r ON r.id = s.route_id
      WHERE s.id = $1 AND r.driver_id = $2 AND s.status = 'active'
    `, [req.params.id, req.driverId]);

    if (stopCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Active stop not found' });
    }

    const stop = stopCheck.rows[0];

    // Mark stop as delivered
    await client.query(`
      UPDATE stops SET 
        status = 'delivered', 
        delivered_at = NOW(),
        delivery_photo_url = $1
      WHERE id = $2
    `, [photoUrl || null, stop.id]);

    // Promote next upcoming stop to active
    await client.query(`
      UPDATE stops SET status = 'active'
      WHERE route_id = $1
        AND status = 'upcoming'
        AND stop_number = (
          SELECT MIN(stop_number) FROM stops 
          WHERE route_id = $1 AND status = 'upcoming'
        )
    `, [stop.route_id]);

    // Update driver total deliveries
    await client.query(`
      UPDATE drivers SET 
        total_deliveries = total_deliveries + 1,
        updated_at = NOW()
      WHERE id = $1
    `, [req.driverId]);

    // Check if all stops done — complete the route
    const remaining = await client.query(
      `SELECT COUNT(*) FROM stops WHERE route_id = $1 AND status != 'delivered'`,
      [stop.route_id]
    );

    if (parseInt(remaining.rows[0].count) === 0) {
      await client.query(
        `UPDATE routes SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [stop.route_id]
      );
    }

    await client.query('COMMIT');

    // Emit real-time event via Socket.io (attached to app in server.js)
    if (req.app.get('io')) {
      req.app.get('io').to(`driver:${req.driverId}`).emit('stop:delivered', {
        stopId: stop.id,
        stopNumber: stop.stop_number,
        deliveredAt: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: `Stop ${stop.stop_number} marked as delivered`,
      data: { stopId: stop.id, deliveredAt: new Date().toISOString() },
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Deliver stop error:', err);
    res.status(500).json({ success: false, error: 'Failed to mark stop as delivered' });
  } finally {
    client.release();
  }
});

// ── POST /api/route/location ───────────────────────────────────────────────
router.post('/location', async (req, res) => {
  try {
    const { latitude, longitude, speed, heading } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, error: 'latitude and longitude required' });
    }

    await query(`
      INSERT INTO driver_locations (driver_id, latitude, longitude, speed, heading)
      VALUES ($1, $2, $3, $4, $5)
    `, [req.driverId, latitude, longitude, speed || null, heading || null]);

    // Broadcast to any customers tracking this driver
    if (req.app.get('io')) {
      req.app.get('io').emit(`driver:location:${req.driverId}`, {
        driverId: req.driverId,
        latitude,
        longitude,
        speed,
        heading,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({ success: true, message: 'Location updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update location' });
  }
});

// ── Helper: format stop for API response ──────────────────────────────────
function formatStop(s) {
  return {
    id: s.id,
    stopNumber: s.stop_number,
    status: s.status,
    name: s.customer_name,
    initials: s.customer_initials,
    address: s.address,
    suburb: s.suburb,
    latitude: s.latitude ? parseFloat(s.latitude) : null,
    longitude: s.longitude ? parseFloat(s.longitude) : null,
    orderRef: s.order_ref,
    boxType: s.box_type,
    boxCount: s.box_count,
    notes: s.notes,
    windowStart: s.window_start,
    windowEnd: s.window_end,
    deliveredAt: s.delivered_at,
    photoUrl: s.delivery_photo_url,
    unreadCount: parseInt(s.unread_count || 0),
  };
}

module.exports = router;
