# FreshBox API

Production-ready Node.js + Express + PostgreSQL backend for the FreshBox Driver App.

## What's included

- **JWT authentication** — login, token refresh, auto-logout
- **Route & stops API** — today's route, mark delivered, GPS location
- **Messages API** — per-stop chat threads, read receipts
- **Earnings API** — daily/weekly/monthly breakdown
- **WebSockets** — real-time GPS tracking, live messages, delivery events
- **PostgreSQL** — full schema with migrations and seed data

## API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/login | Driver login → returns JWT |
| POST | /api/auth/refresh | Refresh access token |
| POST | /api/auth/logout | Logout + invalidate token |
| GET | /api/auth/me | Get driver profile |
| GET | /api/route/today | Today's route + all stops |
| PATCH | /api/route/stops/:id/deliver | Mark stop as delivered |
| POST | /api/route/location | Update GPS location |
| GET | /api/messages | All conversations |
| GET | /api/messages/:stopId | Single chat thread |
| POST | /api/messages/:stopId | Send message |
| GET | /api/earnings?period=today | Earnings breakdown |
| GET | /health | Health check |

---

## Deploy to Railway (free)

### Step 1 — Install Git
Download from https://git-scm.com/download/win and install with defaults.

### Step 2 — Create a GitHub account
Go to https://github.com and sign up (free).

### Step 3 — Push this code to GitHub
Open Command Prompt in the FreshBoxAPI folder:
```
cd C:\Users\Q\Downloads\FreshBoxAPI
git init
git add .
git commit -m "Initial FreshBox API"
```
Then go to GitHub → New Repository → name it `freshbox-api` → copy the commands it shows and run them.

### Step 4 — Create Railway account
Go to https://railway.app → Sign up with GitHub (free tier).

### Step 5 — Deploy on Railway
1. Click **New Project → Deploy from GitHub repo**
2. Select your `freshbox-api` repo
3. Railway auto-detects Node.js and deploys it

### Step 6 — Add PostgreSQL database
1. In your Railway project → click **+ New** → **Database → PostgreSQL**
2. Railway automatically sets `DATABASE_URL` in your environment

### Step 7 — Set environment variables
In Railway → your service → **Variables** tab, add:
```
NODE_ENV=production
JWT_SECRET=<generate a random 64-char string>
JWT_REFRESH_SECRET=<generate another random 64-char string>
JWT_EXPIRES_IN=8h
JWT_REFRESH_EXPIRES_IN=7d
```

### Step 8 — Run migrations and seed
In Railway → your service → **Settings** → temporarily set Start Command to:
```
node scripts/migrate.js && node scripts/seed.js && node src/server.js
```
Deploy once, then change it back to just `node src/server.js`.

### Step 9 — Get your API URL
Railway gives you a URL like: `https://freshbox-api-production.up.railway.app`

### Step 10 — Update the React Native app
In `FreshBoxDriverApp/src/services/api.js`, change:
```javascript
const BASE_URL = __DEV__
  ? 'http://10.0.2.2:3000/api'
  : 'https://freshbox-api-production.up.railway.app/api'; // ← your Railway URL
```

---

## Local development

```bash
# Install dependencies
npm install

# Copy env file and fill in values
copy .env.example .env

# Run PostgreSQL locally (or use Railway's DB URL in .env)

# Run migrations
npm run db:migrate

# Seed test data
npm run db:seed

# Start dev server (auto-restarts on changes)
npm run dev
```

Test credentials after seeding:
- Email: `thabo@freshbox.co.za`
- Password: `driver123`

## Test the API
```bash
# Health check
curl http://localhost:3000/health

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"thabo@freshbox.co.za\",\"password\":\"driver123\"}"

# Get today's route (use token from login)
curl http://localhost:3000/api/route/today \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```
