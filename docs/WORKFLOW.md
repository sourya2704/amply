# Amply — Team Guide

Amply is built end to end: accounts, PostGIS search, bookings with payments, trip planning, the AI assistant, owner
tools and trust & safety. This guide is how to run, test, demo and deploy it.

## Run it locally
```bash
docker compose up -d db                                    # Postgres + PostGIS on localhost:5434 (+ amply_test DB)
cd frontend && npm install && npm run build                # builds the web app into frontend/dist
cd ../backend && cp .env.example .env && go run . -reset   # API + web app on http://localhost:8000, fresh demo data
```
- **Demo accounts:** one click on the login page (password `demo1234`), or create a new account.
- **AI model:** set `ANTHROPIC_API_KEY` in `backend/.env`. Without it, the assistant runs in a clearly labelled
  offline mode with the same tools.
- **Payments:** set Razorpay **test** keys (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`) to use real Razorpay Checkout in
  test mode. Without them a labelled mock provider runs the same order → verify → refund flow.
- **Frontend hot reload:** keep the backend running, then `cd frontend && npm run dev` → http://localhost:5173.
- Never commit `.env`.

## Tests
```bash
cd backend && TEST_DATABASE_URL="postgres://amply:amply@localhost:5434/amply_test?sslmode=disable" go test ./...
```
Covered: auth (hashing, token expiry, rate limit, no self-granted admin), booking → accept → pay → cancel+refund →
re-book, start → complete → payout → review, notifications, hold expiry releasing the slot, 20 concurrent overlapping
requests with exactly 1 winner (database constraint), the AI booking only after confirm, the listing lifecycle (submit,
approve, pause, resume, edit), risk flags, reports, the audit log, support cases, and route planning.

## Where things live

| Area | Files |
|---|---|
| Schema, seeding, Postgres wrapper | `backend/db.go` |
| Search, slots, bookings, expiry, reviews, support | `backend/handlers.go`, `backend/logic.go` |
| Payments (Razorpay / mock, refunds) | `backend/payments.go` |
| Auth, routes, rate limiting | `backend/http.go` |
| Owner listings, reports, admin, risk | `backend/admin.go` |
| Notifications, audit log | `backend/notify.go` |
| Route planning | `backend/route.go` |
| AI assistant | `backend/agent.go`, `frontend/src/components/AgentPanel.tsx` |
| Web app pages | `frontend/src/pages/*` |
| Demo data | `backend/seed/*.json` |

## Deploy (Render + Neon, both free)
1. **Database (Neon):** neon.tech → new project, region **AWS Asia Pacific (Singapore)** → copy the connection string
   (it ends in `?sslmode=require`). The app runs `CREATE EXTENSION postgis` itself on first start.
2. **App (Render):** dashboard → **New → Blueprint** → pick this repo. Render reads `render.yaml`; paste the Neon
   connection string as `DATABASE_URL`, leave the optional keys empty, and apply. First build takes ~5–8 minutes.
3. Demo data loads into the empty database on first start and persists after that. To reseed before a demo, set
   `RESET_DB_ON_START=true` in Render's Environment tab, redeploy once, then remove it.
4. Free Render services sleep after 15 minutes idle; the first visit afterwards takes ~50 seconds to wake.
