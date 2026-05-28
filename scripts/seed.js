// FreshBox API — Seed Script
// Run: npm run db:seed
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, pool } = require('../src/db');

async function seed() {
  console.log('🌱 Seeding FreshBox database...\n');

  try {
    // ── Create test driver ─────────────────────────────────────────────────
    const passwordHash = await bcrypt.hash('driver123', 12);

    const driverResult = await query(`
      INSERT INTO drivers (name, email, password_hash, phone, vehicle_reg, rating, total_deliveries)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name, email
    `, ['Thabo Mokoena', 'thabo@freshbox.co.za', passwordHash, '+27821234567', 'GP 42 FX', 4.9, 847]);

    const driver = driverResult.rows[0];
    console.log(`✅ Driver: ${driver.name} (${driver.email}) — password: driver123`);

    // ── Create today's route ───────────────────────────────────────────────
    const today = new Date().toISOString().split('T')[0];

    const routeResult = await query(`
      INSERT INTO routes (driver_id, route_date, hub_address, total_stops, status)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [driver.id, today, '14 Electron Ave, Brakpan · Hub JHB-North', 31, 'active']);

    let routeId;
    if (routeResult.rows.length > 0) {
      routeId = routeResult.rows[0].id;
    } else {
      const existing = await query(`SELECT id FROM routes WHERE driver_id=$1 AND route_date=$2`, [driver.id, today]);
      routeId = existing.rows[0].id;
    }
    console.log(`✅ Route created for ${today}`);

    // ── Create stops ───────────────────────────────────────────────────────
    const stopsData = [
      { num: 1, status: 'delivered', name: 'Naledi Dlamini',    initials: 'ND', addr: '22 Oxford Rd, Rosebank',          suburb: 'Rosebank',      ref: 'ND-1923', box: 'Standard 4-meal', notes: '',                              lat: -26.1452, lng: 28.0456 },
      { num: 2, status: 'delivered', name: 'Priya Naidoo',      initials: 'PN', addr: '8 Sturdee Ave, Rosebank',          suburb: 'Rosebank',      ref: 'PN-0471', box: 'Family 6-meal',   notes: 'Leave with concierge if not home', lat: -26.1467, lng: 28.0441 },
      { num: 3, status: 'delivered', name: 'Marcus Dube',       initials: 'MD', addr: '5 Melrose Blvd, Melrose',          suburb: 'Melrose',       ref: 'MD-3341', box: '2x Standard',     notes: '',                              lat: -26.1389, lng: 28.0598 },
      { num: 4, status: 'delivered', name: 'Aisha Hendricks',   initials: 'AH', addr: '17 Seventh Ave, Parktown North',   suburb: 'Parktown North',ref: 'AH-0088', box: 'Standard 4-meal', notes: 'Ring buzzer #14',               lat: -26.1521, lng: 28.0312 },
      { num: 5, status: 'active',    name: 'Sipho Mokoena',     initials: 'SM', addr: '14 Sandton Dr, Sandton',           suburb: 'Sandton',       ref: 'SIP-2841',box: 'Standard 4-meal', notes: 'Gate code: 1234 · Ring bell',  lat: -26.1075, lng: 28.0567, ws: '2:00 PM', we: '4:00 PM' },
      { num: 6, status: 'upcoming',  name: 'James van der Berg', initials: 'JB', addr: '3 Morningside Manor, Morningside', suburb: 'Morningside',   ref: 'JVB-5512',box: 'Standard 4-meal', notes: 'Leave at security booth',      lat: -26.1023, lng: 28.0701 },
      { num: 7, status: 'upcoming',  name: 'Fatima Osman',      initials: 'FO', addr: '91 Rivonia Rd, Illovo',            suburb: 'Illovo',        ref: 'FO-7731', box: 'Duo 2-meal',     notes: '',                              lat: -26.1134, lng: 28.0623 },
      { num: 8, status: 'upcoming',  name: 'Thandi Khumalo',    initials: 'TK', addr: '44 Wierda Valley, Sandton',        suburb: 'Wierda Valley', ref: 'TK-2209', box: '2x Duo 2-meal',  notes: '',                              lat: -26.1098, lng: 28.0589 },
    ];

    const stopIds = {};
    for (const s of stopsData) {
      const r = await query(`
        INSERT INTO stops (route_id, stop_number, status, customer_name, customer_initials,
          address, suburb, latitude, longitude, order_ref, box_type, notes, window_start, window_end)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (order_ref) DO UPDATE SET status = EXCLUDED.status
        RETURNING id
      `, [routeId, s.num, s.status, s.name, s.initials, s.addr, s.suburb,
          s.lat, s.lng, s.ref, s.box, s.notes || '', s.ws || null, s.we || null]);
      stopIds[s.ref] = r.rows[0].id;
    }
    console.log(`✅ ${stopsData.length} stops created`);

    // ── Seed messages for active stop ──────────────────────────────────────
    const siphoStopId = stopIds['SIP-2841'];
    if (siphoStopId) {
      await query(`DELETE FROM messages WHERE stop_id = $1`, [siphoStopId]);
      await query(`
        INSERT INTO messages (stop_id, sender, text, is_read, created_at) VALUES
        ($1, 'customer', 'Hi! I''m working from home today, please ring the bell when you arrive. Gate code is 1234.', true, NOW() - INTERVAL '30 minutes'),
        ($1, 'driver',   'Got it, thank you! I''ll be there in about 10 minutes.', true, NOW() - INTERVAL '27 minutes'),
        ($1, 'customer', 'Perfect, I''ll listen out for you!', false, NOW() - INTERVAL '26 minutes')
      `, [siphoStopId]);
      console.log('✅ Messages seeded for Sipho stop');
    }

    // ── Seed earnings ──────────────────────────────────────────────────────
    const earningsData = [
      { date: today,                    base: 279, speed: 40,  rating: 30, fuel: 50, stops: 4  },
      { date: daysAgo(1),               base: 342, speed: 40,  rating: 30, fuel: 50, stops: 29 },
      { date: daysAgo(2),               base: 369, speed: 40,  rating: 30, fuel: 50, stops: 33 },
      { date: daysAgo(7),               base: 315, speed: 0,   rating: 30, fuel: 50, stops: 28 },
      { date: daysAgo(8),               base: 342, speed: 40,  rating: 30, fuel: 50, stops: 30 },
    ];

    for (const e of earningsData) {
      const total = e.base + e.speed + e.rating + e.fuel;
      await query(`
        INSERT INTO earnings (driver_id, route_id, earn_date, base_amount, speed_bonus,
          rating_bonus, fuel_contribution, total_amount, stops_completed, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT DO NOTHING
      `, [driver.id, routeId, e.date, e.base, e.speed, e.rating, e.fuel, total, e.stops,
          e.date === today ? 'pending' : 'paid']);
    }
    console.log('✅ Earnings seeded');

    console.log('\n🎉 Database seeded successfully!');
    console.log('\n📋 Test credentials:');
    console.log('   Email:    thabo@freshbox.co.za');
    console.log('   Password: driver123');

  } catch (err) {
    console.error('\n❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

seed();
