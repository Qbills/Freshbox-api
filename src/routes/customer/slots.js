// FreshBoxAPI/src/routes/customer/slots.js
// GET /api/customer/slots — returns available delivery slots based on current SA time

const express = require('express');
const router = express.Router();

const SA_OFFSET_HOURS = 2;

const SLOT_DEFINITIONS = [
  { id: 'slot1', startHour:  8, endHour: 10, label: '8am – 10am'  },
  { id: 'slot2', startHour: 10, endHour: 12, label: '10am – 12pm' },
  { id: 'slot3', startHour: 12, endHour: 14, label: '12pm – 2pm'  },
  { id: 'slot4', startHour: 14, endHour: 16, label: '2pm – 4pm'   },
  { id: 'slot5', startHour: 16, endHour: 18, label: '4pm – 6pm'   },
  { id: 'slot6', startHour: 18, endHour: 20, label: '6pm – 8pm'   },
];

const MAX_ORDERS_PER_SLOT = 10;
const CUTOFF_HOURS_BEFORE = 2;

function getSANow() {
  const now = new Date();
  return new Date(now.getTime() + (SA_OFFSET_HOURS * 60 * 60 * 1000));
}

function formatDateKey(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

router.get('/', async (req, res) => {
  const db = req.app.get('db');

  try {
    const now = getSANow();
    const currentHour = now.getUTCHours();

    const todayKey = formatDateKey(now);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowKey = formatDateKey(tomorrow);

    // Count existing orders per slot
    const ordersResult = await db.query(
      `SELECT delivery_slot, COUNT(*) as count
       FROM customer_orders
       WHERE status NOT IN ('cancelled')
       AND (delivery_slot LIKE 'Today%' OR delivery_slot LIKE 'Tomorrow%'
         OR delivery_slot LIKE $1 OR delivery_slot LIKE $2)
       GROUP BY delivery_slot`,
      [`${todayKey}%`, `${tomorrowKey}%`]
    );

    const slotCounts = {};
    for (const row of ordersResult.rows) {
      slotCounts[row.delivery_slot] = parseInt(row.count);
    }

    const slots = [];

    // Today's slots
    for (const def of SLOT_DEFINITIONS) {
      const cutoffHour = def.startHour - CUTOFF_HOURS_BEFORE;
      const isPast = currentHour >= cutoffHour;
      const slotKey = `Today ${def.label}`;
      const orderCount = slotCounts[slotKey] || 0;
      const isFull = orderCount >= MAX_ORDERS_PER_SLOT;

      slots.push({
        id: `today_${def.id}`,
        day: 'Today',
        label: def.label,
        value: slotKey,
        available: !isPast && !isFull,
        reason: isPast ? 'passed' : isFull ? 'full' : null,
      });
    }

    // Tomorrow's slots
    for (const def of SLOT_DEFINITIONS) {
      const slotKey = `Tomorrow ${def.label}`;
      const orderCount = slotCounts[slotKey] || 0;
      const isFull = orderCount >= MAX_ORDERS_PER_SLOT;

      slots.push({
        id: `tomorrow_${def.id}`,
        day: 'Tomorrow',
        label: def.label,
        value: slotKey,
        available: !isFull,
        reason: isFull ? 'full' : null,
      });
    }

    // If all today's slots have passed — add day after tomorrow
    const allTodayUnavailable = slots.filter(s => s.day === 'Today').every(s => !s.available);
    if (allTodayUnavailable) {
      const dayAfterTomorrow = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      const datLabel = dayAfterTomorrow.toLocaleDateString('en-ZA', { weekday: 'long', timeZone: 'UTC' });

      for (const def of SLOT_DEFINITIONS) {
        const slotKey = `${datLabel} ${def.label}`;
        const orderCount = slotCounts[slotKey] || 0;
        const isFull = orderCount >= MAX_ORDERS_PER_SLOT;

        slots.push({
          id: `dat_${def.id}`,
          day: datLabel,
          label: def.label,
          value: slotKey,
          available: !isFull,
          reason: isFull ? 'full' : null,
        });
      }
    }

    res.json({ slots });

  } catch (err) {
    console.error('GET /api/customer/slots error:', err);
    res.status(500).json({ error: 'Failed to fetch delivery slots' });
  }
});

module.exports = router;