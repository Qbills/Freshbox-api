// FreshBox API — Database Migration
// Run: npm run db:migrate
require('dotenv').config();
const { query, pool } = require('../src/db');

async function migrate() {
  console.log('🚀 Running FreshBox database migrations...\n');

  try {
    // ── Enable UUID extension ──────────────────────────────────────────────
    await query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ── Drivers ───────────────────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS drivers (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name          VARCHAR(100) NOT NULL,
        email         VARCHAR(150) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        phone         VARCHAR(20),
        vehicle_reg   VARCHAR(20),
        rating        DECIMAL(3,2) DEFAULT 5.00,
        total_deliveries INTEGER DEFAULT 0,
        is_active     BOOLEAN DEFAULT true,
        is_online     BOOLEAN DEFAULT false,
        fcm_token     TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✅ drivers table');

    // ── Refresh tokens ─────────────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        driver_id  UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
        token      TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✅ refresh_tokens table');

    // ── Routes ─────────────────────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS routes (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        driver_id     UUID REFERENCES drivers(id),
        route_date    DATE NOT NULL,
        hub_address   VARCHAR(255),
        total_stops   INTEGER DEFAULT 0,
        status        VARCHAR(20) DEFAULT 'pending',
        started_at    TIMESTAMPTZ,
        completed_at  TIMESTAMPTZ,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✅ routes table');

    // ── Stops ──────────────────────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS stops (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        route_id      UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
        stop_number   INTEGER NOT NULL,
        status        VARCHAR(20) DEFAULT 'upcoming',
        customer_name VARCHAR(100) NOT NULL,
        customer_initials VARCHAR(5),
        address       VARCHAR(255) NOT NULL,
        suburb        VARCHAR(100),
        latitude      DECIMAL(10,8),
        longitude     DECIMAL(11,8),
        order_ref     VARCHAR(50) UNIQUE NOT NULL,
        box_type      VARCHAR(100),
        box_count     INTEGER DEFAULT 1,
        notes         TEXT,
        window_start  VARCHAR(20),
        window_end    VARCHAR(20),
        delivered_at  TIMESTAMPTZ,
        delivery_photo_url TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✅ stops table');

    // ── Messages ───────────────────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS messages (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        stop_id     UUID NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
        sender      VARCHAR(10) NOT NULL CHECK (sender IN ('driver', 'customer')),
        text        TEXT NOT NULL,
        is_read     BOOLEAN DEFAULT false,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✅ messages table');

    // ── Earnings ───────────────────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS earnings (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        driver_id        UUID NOT NULL REFERENCES drivers(id),
        route_id         UUID REFERENCES routes(id),
        earn_date        DATE NOT NULL,
        base_amount      DECIMAL(10,2) DEFAULT 0,
        speed_bonus      DECIMAL(10,2) DEFAULT 0,
        rating_bonus     DECIMAL(10,2) DEFAULT 0,
        fuel_contribution DECIMAL(10,2) DEFAULT 0,
        total_amount     DECIMAL(10,2) DEFAULT 0,
        stops_completed  INTEGER DEFAULT 0,
        status           VARCHAR(20) DEFAULT 'pending',
        paid_at          TIMESTAMPTZ,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✅ earnings table');

    // ── Driver locations (GPS tracking) ────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS driver_locations (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        driver_id   UUID NOT NULL REFERENCES drivers(id),
        latitude    DECIMAL(10,8) NOT NULL,
        longitude   DECIMAL(11,8) NOT NULL,
        speed       DECIMAL(5,2),
        heading     DECIMAL(5,2),
        recorded_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✅ driver_locations table');

    // ── Indexes for performance ────────────────────────────────────────────
    await query(`CREATE INDEX IF NOT EXISTS idx_routes_driver_date ON routes(driver_id, route_date)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_stops_route ON stops(route_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_stops_order_ref ON stops(order_ref)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_messages_stop ON messages(stop_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_earnings_driver ON earnings(driver_id, earn_date)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_locations_driver ON driver_locations(driver_id, recorded_at DESC)`);
    console.log('✅ indexes created');

    console.log('\n🎉 All migrations completed successfully!');
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
