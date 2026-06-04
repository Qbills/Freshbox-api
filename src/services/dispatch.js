// FreshBoxAPI/src/services/dispatch.js
// Assigns a customer order to a driver when status changes to out_for_delivery

const { sendOrderStatusNotification } = require('./fcm');

// Parse delivery slot string into window_start and window_end
// e.g. "Today 2pm - 5pm" -> { window_start: "14:00", window_end: "17:00" }
function parseDeliverySlot(slot) {
  if (!slot) return { window_start: '09:00', window_end: '17:00' };

  const timeMap = {
    '8am': '08:00', '9am': '09:00', '10am': '10:00', '11am': '11:00',
    '12pm': '12:00', '1pm': '13:00', '2pm': '14:00', '3pm': '15:00',
    '4pm': '16:00', '5pm': '17:00', '6pm': '18:00', '7pm': '19:00', '8pm': '20:00',
  };

  const clean = slot.toLowerCase().replace(/\s/g, '');
  const match = clean.match(/(\d+(?:am|pm))-(\d+(?:am|pm))/);
  if (match) {
    return {
      window_start: timeMap[match[1]] || '09:00',
      window_end: timeMap[match[2]] || '17:00',
    };
  }
  return { window_start: '09:00', window_end: '17:00' };
}

// Get initials from a name
function getInitials(name) {
  if (!name) return 'C';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

// Extract suburb from delivery address
function extractSuburb(address) {
  if (!address) return 'Johannesburg';
  if (address.toLowerCase().includes('sandton')) return 'Sandton';
  if (address.toLowerCase().includes('midrand')) return 'Midrand';
  if (address.toLowerCase().includes('fourways')) return 'Fourways';
  const parts = address.split(',');
  return parts.length > 1 ? parts[parts.length - 2].trim() : 'Johannesburg';
}

async function dispatchOrderToDriver(db, orderId) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // 1. Get full order details with customer info
    const orderResult = await client.query(
      `SELECT 
         o.id, o.delivery_address, o.delivery_slot, o.notes,
         o.total_amount, o.customer_id,
         c.name as customer_name, c.phone as customer_phone,
         COALESCE(
           json_agg(
             json_build_object('name', oi.product_name, 'category', p.category)
           ) FILTER (WHERE oi.id IS NOT NULL),
           '[]'
         ) as items
       FROM customer_orders o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN customer_order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE o.id = $1
       GROUP BY o.id, c.name, c.phone`,
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      throw new Error(`Order ${orderId} not found`);
    }

    const order = orderResult.rows[0];

    // 2. Find an available active driver
    const driverResult = await client.query(
      `SELECT id, name, fcm_token FROM drivers 
       WHERE is_active = true AND is_online = true
       ORDER BY total_deliveries ASC`
    );

    // If no online driver, fall back to any active driver
    let driver = driverResult.rows[0];
    if (!driver) {
      const fallbackResult = await client.query(
        `SELECT id, name, fcm_token FROM drivers 
         WHERE is_active = true
         ORDER BY total_deliveries ASC`
      );
      driver = fallbackResult.rows[0];
    }

    if (!driver) {
      throw new Error('No available drivers found');
    }

    const today = new Date().toISOString().split('T')[0];

    // 3. Find or create today's route for this driver
    let routeId;
    const routeResult = await client.query(
      `SELECT id FROM routes 
       WHERE driver_id = $1 AND route_date = $2`,
      [driver.id, today]
    );

    if (routeResult.rows.length > 0) {
      routeId = routeResult.rows[0].id;
    } else {
      const newRoute = await client.query(
        `INSERT INTO routes (driver_id, route_date, hub_address, status, total_stops, created_at)
         VALUES ($1, $2, 'FreshBox Hub, Johannesburg', 'active', 0, NOW())
         RETURNING id`,
        [driver.id, today]
      );
      routeId = newRoute.rows[0].id;
    }

    // 4. Get the next stop number
    const stopCountResult = await client.query(
      `SELECT COUNT(*) FROM stops WHERE route_id = $1`,
      [routeId]
    );
    const stopNumber = parseInt(stopCountResult.rows[0].count) + 1;

    // 5. Determine if this is the first stop (make it active) or upcoming
    const stopStatus = stopNumber === 1 ? 'active' : 'upcoming';

    // 6. Parse delivery slot into time window
    const { window_start, window_end } = parseDeliverySlot(order.delivery_slot);

    // 7. Determine box type from order items
    const categories = order.items.map(i => i.category).filter(Boolean);
    let boxType = 'Pantri Order';
    if (categories.includes('meal_kit')) boxType = 'Meal Kit';
    else if (categories.includes('produce')) boxType = 'Fresh Produce';
    else if (categories.includes('wellness')) boxType = 'Wellness Box';

    // 8. Create the stop
    const orderRef = `#PNT-${String(orderId).padStart(4, '0')}`;
    await client.query(
      `INSERT INTO stops (
         route_id, stop_number, status, customer_name, customer_initials,
         address, suburb, order_ref, box_type, box_count,
         notes, window_start, window_end, order_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())`,
      [
        routeId,
        stopNumber,
        stopStatus,
        order.customer_name,
        getInitials(order.customer_name),
        order.delivery_address,
        extractSuburb(order.delivery_address),
        orderRef,
        boxType,
        1,
        order.notes || null,
        window_start,
        window_end,
        orderId,
      ]
    );

    // 9. Update route total_stops count
    await client.query(
      `UPDATE routes SET total_stops = total_stops + 1 WHERE id = $1`,
      [routeId]
    );

    // 10. Send push notification to driver
    if (driver.fcm_token) {
      await sendDriverNotification(driver.fcm_token, order, orderRef, window_start, window_end);
    }

    await client.query('COMMIT');

    console.log(`✅ Order ${orderRef} dispatched to driver ${driver.name} — stop #${stopNumber}`);

    return {
      driverId: driver.id,
      driverName: driver.name,
      routeId,
      stopNumber,
      orderRef,
    };

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Dispatch error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

async function sendDriverNotification(fcmToken, order, orderRef, windowStart, windowEnd) {
  try {
    const https = require('https');
    const { GoogleAuth } = require('google-auth-library');

    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;

    if (!privateKey) return;

    const credentials = {
      type: 'service_account',
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: privateKey,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
    };

    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });

    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const accessToken = tokenResponse.token;

    const payload = {
      message: {
        token: fcmToken,
        notification: {
          title: '🛵 New delivery assigned',
          body: `${order.customer_name} — ${order.delivery_address.split(',')[0]} (${windowStart}–${windowEnd})`,
        },
        data: {
          type: 'new_stop',
          orderRef,
          customerName: order.customer_name,
          address: order.delivery_address,
        },
        android: { priority: 'high' },
      },
    };

    return new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);
      const options = {
        hostname: 'fcm.googleapis.com',
        path: `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/messages:send`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log(`✅ Driver notification sent to ${fcmToken.slice(0, 20)}...`);
            resolve();
          } else {
            console.error(`Driver FCM error ${res.statusCode}:`, data);
            resolve(); // Non-fatal
          }
        });
      });
      req.on('error', () => resolve()); // Non-fatal
      req.write(body);
      req.end();
    });
  } catch (err) {
    console.error('Driver notification error (non-fatal):', err.message);
  }
}

module.exports = { dispatchOrderToDriver };