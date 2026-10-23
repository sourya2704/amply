# AI Brief — P1: Backend (Shourya + Claude)

Read `docs/WORKFLOW.md` and `docs/api-contract.md` first. We implement the contract exactly and own it.

## Owned
`backend/` except `backend/app/agent/` (P3) and `backend/seed/` (P4). Also `docs/api-contract.md`.

## Stack
FastAPI + Pydantic v2 · SQLAlchemy 2.0 (async, asyncpg) · Postgres + PostGIS on Supabase/Neon (shared by the team) ·
`python-jose` JWT + `passlib[bcrypt]` · `razorpay` SDK (test mode) · schema in a plain `sql/schema.sql` (no Alembic tonight).

## Layout
```
backend/
  app/main.py                 # app, CORS, error handler, include routers (incl. app.agent.router)
  app/core/config.py db.py auth.py errors.py
  app/models/                 # SQLAlchemy models
  app/schemas/                # Pydantic shapes = contract §2
  app/routers/                # auth, vehicles, chargers, owner, bookings, payments, reports, admin
  app/services/               # compatibility, pricing, availability, booking (state machine), risk, audit
  app/seed.py                 # loads backend/seed/*.json (reset + load)
  sql/schema.sql
  requirements.txt  .env.example
```

## Order of work
1. **H0–H1:** DB + PostGIS + `btree_gist`, `schema.sql`, FastAPI skeleton, `/api/health`, CORS, error format. Push.
2. **H1–H2:** auth (register/login/me, roles), `get_current_user` + `require_role` (P3 imports `get_current_user`), vehicles.
3. **H2–H4:** charger search (`ST_DWithin` + compatibility filter + availability label + private coord rounding), detail,
   slots, estimate, seed loader. Make it reachable on LAN/deployed → **Checkpoint 1**.
4. **H4–H6:** bookings + state machine + events + exclusion constraint + idempotency, owner endpoints, lazy expiry.
5. **H6–H7:** Razorpay order/verify (HMAC signature check), address/access-instruction reveal → **Checkpoint 2**.
6. **H7–H9:** admin endpoints, risk scan rules, audit logs, stats, reports, reviews. Deploy (Render/Railway).
7. **H9+:** bug fixes, reseed script for demo.

## Key rules
- Money in integer paise; `timestamptz` everywhere.
- Exclusion constraint on `bookings (charger_id =, tstzrange(start_at,end_at) &&)` where status in
  requested/accepted/confirmed/in_progress → catch `ExclusionViolation` → 409 `SLOT_TAKEN`.
- Every booking transition writes a `booking_events` row and an `audit_logs` row; every admin action writes to the audit log.
- Never return `address` / `access_instructions` to drivers before `confirmed`.
