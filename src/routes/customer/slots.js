// FreshBoxAPI/src/routes/customer/slots.js
// GET /api/customer/slots — returns available delivery slots based on current SA time
// No auth required — slots are public info

const express = require('express');
const router = express.Router();

// SA timezone offset — UTC+2
const SA_OFFSET_HOURS = 2;

// Slot definitions — start hour, end hour, display label
const SLOT_DEFINITIONS = [
  { id: 'morning',   startHour: 8,  endHour: 11, label: '8am – 11am' },
  { id: 'midmorning', startHour: 11, endHour: 14, label: '11am – 2pm' },
  { id: 'afternoon', startHour: 14, endHour: 17, label: '2pm – 5pm' },
  { id: 'evening',   startHour: 17, endHour: 20, label: '5pm – 8pm' },
];

// Max orders per slot before it shows as full
const MAX_ORDERS_PER_SLOT = 10;

// Cut-off: how many hours before slot start to stop accepting orders
const CUTOFF_HOURS_BEFORE = 2;

function getSANow() {
  const now = new Date();
  // Convert to SA time
  const saTime = new Date(now.getTime() + (SA_OFFSET_HOURS * 60 * 60 * 1000));
  return saTime;
}

function formatDateKey(date) {
  // Returns YYYY-MM-DD in SA time
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatSlotLabel(dateLabel, slotLabel) {
  return `${dateLabel} ${slotLabel}`;
}

// GET /api/customer/slots
router.get('/', async (req, res) => {
  const db = req.app.get('db');

  try {
    const now = getSANow();
    const currentHour = now.getUTCHours(); // SA hour since we offset already
    const currentDay = now.getUTCDay(); // 0 = Sunday

    const todayKey = formatDateKey(now);

    // Tomorrow in SA time
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowKey = formatDateKey(tomorrow);
    const tomorrowDay = tomorrow.getUTCDay();

    // Count existing orders per slot for today and tomorrow
    const ordersResult = await db.query(
      `SELECT delivery_slot, COUNT(*) as count
       FROM customer_orders
       WHERE status NOT IN ('cancelled')
       AND (
         delivery_slot LIKE 'Today%'
         OR delivery_slot LIKE 'Tomorrow%'
         OR delivery_slot LIKE $1
         OR delivery_slot LIKE $2
       )
       GROUP BY delivery_slot`,
      [`${todayKey}%`, `${tomorrowKey}%`]
    );

    const slotCounts = {};
    for (const row of ordersResult.rows) {
      slotCounts[row.delivery_slot] = parseInt(row.count);
    }

    const slots = [];

    // Today's slots
    if (true) {
      for (const def of SLOT_DEFINITIONS) {
        const cutoffHour = def.startHour - CUTOFF_HOURS_BEFORE;
        const isPast = currentHour >= cutoffHour;

        // Check order count for this slot
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
          orderCount,
        });
      }
    }

    // Tomorrow's slots
    if (true) {
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
          orderCount,
        });
      }
    }

    // If all today's slots have passed — show day after tomorrow
    const allTodayUnavailable = slots.filter(s => s.day === 'Today').every(s => !s.available);
    if (allTodayUnavailable) {
      const dayAfterTomorrow = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      const datKey = formatDateKey(dayAfterTomorrow);
      const datDay = dayAfterTomorrow.getUTCDay();
      const datLabel = dayAfterTomorrow.toLocaleDateString('en-ZA', { weekday: 'long', timeZone: 'UTC' });

      if (true) {
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
            orderCount,
          });
        }
      }
    }

    res.json({ slots });

  } catch (err) {
    console.error('GET /api/customer/slots error:', err);
    res.status(500).json({ error: 'Failed to fetch delivery slots' });
  }
});

module.exports = router;