// FreshBox API — Earnings Routes
const express = require('express');
const { query } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// ── GET /api/earnings?period=today|week|month ──────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { period = 'today' } = req.query;
    const today = new Date().toISOString().split('T')[0];

    let dateFilter;
    if (period === 'today') dateFilter = `e.earn_date = '${today}'`;
    else if (period === 'week') dateFilter = `e.earn_date >= NOW() - INTERVAL '7 days'`;
    else if (period === 'month') dateFilter = `e.earn_date >= NOW() - INTERVAL '30 days'`;
    else dateFilter = `e.earn_date = '${today}'`;

    const summaryResult = await query(`
      SELECT 
        SUM(total_amount) as total,
        SUM(base_amount) as base,
        SUM(speed_bonus) as speed,
        SUM(rating_bonus) as rating,
        SUM(fuel_contribution) as fuel,
        SUM(stops_completed) as stops,
        COUNT(*) as routes
      FROM earnings e
      WHERE e.driver_id = $1 AND ${dateFilter}
    `, [req.driverId]);

    const s = summaryResult.rows[0];

    // Today's breakdown specifically
    let todayBreakdown = null;
    if (period === 'today') {
      const todayResult = await query(`
        SELECT * FROM earnings 
        WHERE driver_id = $1 AND earn_date = $2
        ORDER BY created_at DESC LIMIT 1
      `, [req.driverId, today]);

      if (todayResult.rows.length > 0) {
        const t = todayResult.rows[0];
        todayBreakdown = {
          baseRate: parseFloat(t.base_amount),
          speedBonus: parseFloat(t.speed_bonus),
          ratingBonus: parseFloat(t.rating_bonus),
          fuelContrib: parseFloat(t.fuel_contribution),
          total: parseFloat(t.total_amount),
          completedStops: t.stops_completed,
          ratePerStop: t.stops_completed > 0
            ? Math.round(parseFloat(t.base_amount) / t.stops_completed)
            : 9,
          onTrack: parseFloat(t.speed_bonus) > 0,
        };
      }
    }

    // Payment history
    const historyResult = await query(`
      SELECT earn_date, stops_completed, total_amount, status
      FROM earnings
      WHERE driver_id = $1
      ORDER BY earn_date DESC
      LIMIT 10
    `, [req.driverId]);

    const driver = await query(
      'SELECT rating, total_deliveries FROM drivers WHERE id = $1',
      [req.driverId]
    );

    res.json({
      success: true,
      data: {
        period,
        summary: {
          total: parseFloat(s.total || 0),
          base: parseFloat(s.base || 0),
          stops: parseInt(s.stops || 0),
          routes: parseInt(s.routes || 0),
        },
        today: todayBreakdown,
        driverRating: parseFloat(driver.rows[0]?.rating || 5.0),
        totalDeliveries: driver.rows[0]?.total_deliveries || 0,
        payHistory: historyResult.rows.map(h => ({
          date: new Date(h.earn_date).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' }),
          stops: h.stops_completed,
          amount: parseFloat(h.total_amount),
          status: h.status,
        })),
      },
    });

  } catch (err) {
    console.error('Earnings error:', err);
    res.status(500).json({ success: false, error: 'Failed to get earnings' });
  }
});

module.exports = router;
