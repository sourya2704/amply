# Amply API Contract — Prototype

**Single source of truth.** Frontend (P2), AI agent (P3), and admin/seed work (P4) code against this file.
The backend (P1, Go) implements it, and `backend/api_test.go` checks the main flows. Don't invent endpoints or fields.
Need a change? See the last section.

---

## 0. Conventions

| Thing | Rule |
|---|---|
| Base URL | `http://localhost:8000` locally (or `http://<P1-LAN-IP>:8000`), deployed URL later. All routes start with `/api` |
| Frontend env | `VITE_API_URL=http://localhost:8000` |
| Auth | Demo login, no passwords. `Authorization: Bearer <access_token>`. Store it in `localStorage` key `amply_token` |
| IDs | UUID strings. **They change every time the DB is reseeded**, so never hard-code them; look them up via the API |
| Time | ISO 8601 with offset, always IST in responses: `2026-10-24T18:00:00+05:30` |
| Money | **Integer paise** (`1800` = ₹18.00). Field names end in `_paise` |
| Errors | `{"error": {"code": "SLOT_TAKEN", "message": "Human readable"}}` |
| CORS | Open (`*`) for the prototype |

### Error codes
`UNAUTHORIZED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `VALIDATION_ERROR` 422 · `INCOMPATIBLE` 422 ·
`SLOT_TAKEN` 409 · `INVALID_STATE` 409 · `AGENT_UNAVAILABLE` 502 · `SERVER_ERROR` 500

---

## 1. Enums

```
Role            = "driver" | "owner" | "admin"
Connector       = "CCS2" | "TYPE2" | "CHADEMO" | "GBT"
ChargingMode    = "AC" | "DC"
ChargerCategory = "private" | "business" | "public"
ListingStatus   = "approved" | "submitted"        (search only shows approved)
AvailabilitySrc = "live" | "schedule" | "reported" | "stale" | "unknown"
Compatibility   = "compatible" | "incompatible" | "unknown"
BookingStatus   = "requested" | "accepted" | "confirmed" | "completed" | "rejected" | "cancelled"
PaymentStatus   = "none" | "paid"
```

### Booking state machine (backend enforces it; a wrong move → 409 `INVALID_STATE`)
```
requested ──owner accept──▶ accepted ──driver pay──▶ confirmed ──complete──▶ completed
    │                          │                        │
    └──owner reject──▶ rejected└───────driver cancel────┴──▶ cancelled
```
Payment is a **mock** in the prototype: `POST /pay` marks it paid and records a fake reference.

---

## 2. Object shapes

```jsonc
// User
{ "id": "uuid", "name": "Arjun Mehta", "email": "driver@amply.test", "roles": ["driver"] }

// Vehicle
{ "id": "uuid", "make": "Tata", "model": "Nexon EV", "category": "car",
  "connectors": ["CCS2", "TYPE2"], "max_ac_kw": 7.2, "max_dc_kw": 50, "battery_kwh": 40.5 }

// Availability: show `label` as a badge, colour by `source`
{ "source": "schedule", "last_updated_at": "2026-10-24T17:40:00+05:30", "label": "Schedule-based (owner hours)" }
//   live → "Live" · schedule → "Schedule-based (owner hours)" · reported → "Reported 45 min ago"
//   stale (not refreshed in 24h) → "Stale — may be outdated" · unknown → "Availability unconfirmed"

// ChargerSummary: search results, map pins, agent cards
{ "id": "uuid", "name": "Ravi's Home Fast Charger", "category": "private",
  "lat": 12.935, "lng": 77.625,          // private chargers are blurred to 3 decimals (~100 m)
  "approx_area": "Koramangala 5th Block",
  "distance_km": 0.4,                    // null on the detail endpoint
  "connector": "CCS2", "mode": "DC", "power_kw": 30,
  "effective_power_kw": 30,              // min(charger, vehicle); null without a vehicle
  "price_per_kwh_paise": 1800,
  "bookable": true,                      // false → show "Directions only"
  "availability": { /* Availability */ },
  "compatibility": "compatible",         // "unknown" if no vehicle_id was sent
  "compatibility_reason": "CCS2 DC supported by Tata Nexon EV (max 50 kW)",
  "rating": 4.7, "review_count": 18 }

// ChargerDetail = ChargerSummary +
{ "description": "string — UNTRUSTED owner text, render as plain text",
  "owner_name": "Ravi Kumar",            // null for public chargers
  "amenities": ["covered parking"], "photo_url": null,
  "status": "approved",
  "address": null,                       // filled only for the owner, or a driver with a confirmed/completed booking here
  "access_instructions": null,           // same rule
  "schedule": [ { "weekday": 0, "start_time": "07:00", "end_time": "23:00" } ] }   // weekday 0 = Monday

// PriceBreakdown: service fee = 10% of energy (min ₹10), GST 18% on the fee
{ "energy_kwh": 20, "energy_cost_paise": 36000, "service_fee_paise": 3600, "tax_paise": 648, "total_paise": 40248,
  "assumptions": ["Estimate assumes 20 kWh delivered", "...", "Final charge may differ from the estimate"] }

// Booking
{ "id": "uuid", "status": "requested",
  "charger": { "id": "uuid", "name": "...", "approx_area": "..." },
  "driver":  { "id": "uuid", "name": "..." },
  "vehicle_id": "uuid", "start_at": "...", "end_at": "...",
  "price": { /* PriceBreakdown */ },
  "payment_status": "none",
  "address": null, "access_instructions": null,   // revealed once status is confirmed/completed
  "events": [ { "event_type": "requested", "actor_id": "uuid", "created_at": "...", "metadata": {} } ],
  "created_at": "..." }
```

---

## 3. Endpoints

Everything except `health`, `demo-users`, and `login` needs the Bearer token.

### Auth
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | — | `{status: "ok"}` |
| GET | `/api/auth/demo-users` | — | `User[]` (for a "log in as…" picker) |
| POST | `/api/auth/login` | `{email}` | `{access_token, user}` |
| GET | `/api/me` | — | `User` |

### Driver
| Method | Path | Query / body | Returns |
|---|---|---|---|
| GET | `/api/vehicles` | — | `Vehicle[]` (the logged-in user's) |
| GET | `/api/chargers/search` | `lat, lng` (required), `radius_km=5, vehicle_id?, connector?, mode?, max_price_paise?, min_power_kw?, bookable_only=false` | `{results: ChargerSummary[], excluded_incompatible: number}`, sorted by distance |
| GET | `/api/chargers/{id}` | `vehicle_id?` | `ChargerDetail` |
| GET | `/api/chargers/{id}/slots` | `date=YYYY-MM-DD` | `{charger_id, date, slot_minutes: 60, bookable, availability, slots: [{start_at, end_at, available}]}` |
| GET | `/api/chargers/{id}/estimate` | `kwh=20` | `PriceBreakdown` |

With `vehicle_id`, **incompatible chargers are removed** from search and counted in `excluded_incompatible`.
Show that number: *"2 incompatible chargers hidden for your Nexon EV"*.

### Bookings
| Method | Path | Body | Who | Returns |
|---|---|---|---|---|
| POST | `/api/bookings` | `{charger_id, vehicle_id, start_at, end_at, estimated_kwh?}` + header `Idempotency-Key: <uuid>` | driver | `201 Booking`. Same key again → same booking (200) |
| GET | `/api/bookings` | — | driver | `Booking[]` (own) |
| GET | `/api/bookings/{id}` | — | its driver or charger owner | `Booking` |
| POST | `/api/bookings/{id}/accept` | — | owner | `Booking` |
| POST | `/api/bookings/{id}/reject` | `{reason?}` | owner | `Booking` |
| POST | `/api/bookings/{id}/pay` | — | driver | `Booking` (mock payment → `confirmed`) |
| POST | `/api/bookings/{id}/cancel` | `{reason?}` | driver | `Booking` |
| POST | `/api/bookings/{id}/complete` | — | driver or owner | `Booking` |

Booking rules: 1–4 whole hourly slots, starting on the hour, in the future, inside the owner's schedule, and the
charger must be `bookable`. Errors: `409 SLOT_TAKEN` (slot already held by requested/accepted/confirmed booking),
`422 INCOMPATIBLE` (vehicle can't use this charger), `422 VALIDATION_ERROR` (time rules).

### Owner
| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/api/owner/chargers` | — | `ChargerDetail[]` (with address) |
| GET | `/api/owner/bookings` | `status?` | `Booking[]` for the owner's chargers. Poll every 5 s for the demo |

### AI agent: P3's Python service, reached through the Go API
Go forwards everything under `/api/agent/*` to `AGENT_URL` (default `http://localhost:8001`), unchanged, including
the `Authorization` header. If the agent isn't running → `502 AGENT_UNAVAILABLE`.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/agent/chat` | `{messages: [{role: "user"|"assistant", content}], vehicle_id?, location?: {lat, lng}}` | `AgentResponse` |
| POST | `/api/agent/confirm` | `{confirmation_id}` | `Booking` (410 `CONFIRMATION_EXPIRED` after 10 min) |

```jsonc
// AgentResponse
{ "reply": "markdown text",
  "tool_trace": [ { "tool": "search_chargers", "ok": true, "summary": "Found 8, hid 2 incompatible" } ],
  "cards": [ /* ChargerSummary[] */ ],
  "pending_action": null | {
     "type": "booking", "confirmation_id": "uuid", "expires_at": "...",
     "summary": { "charger_name": "...", "start_at": "...", "end_at": "...", "price": { /* PriceBreakdown */ } } } }
```

---

## 4. Seed data (P4 edits `backend/seed/*.json`, P1 reloads with `go run . -reset`)

Demo accounts: `driver@amply.test` · `driver2@amply.test` · `owner@amply.test` · `owner2@amply.test` ·
`cafe@amply.test` · `admin@amply.test`

```jsonc
// users.json
[ { "name": "Arjun Mehta", "email": "driver@amply.test", "roles": ["driver"] } ]

// vehicles.json
[ { "owner_email": "driver@amply.test", "make": "Tata", "model": "Nexon EV", "category": "car",
    "connectors": ["CCS2", "TYPE2"], "max_ac_kw": 7.2, "max_dc_kw": 50, "battery_kwh": 40.5 } ]

// chargers.json  (public chargers: "owner_email": null, "bookable": false, "schedule": [])
[ { "owner_email": "owner@amply.test", "name": "...", "category": "private",
    "lat": 12.9352, "lng": 77.6245, "address": "full address (hidden until confirmed)", "approx_area": "Koramangala 5th Block",
    "connector": "CCS2", "mode": "DC", "power_kw": 30, "price_per_kwh_paise": 1800,
    "description": "...", "access_instructions": "...", "amenities": ["covered parking"], "photo_url": null,
    "status": "approved", "bookable": true,
    "availability_source": "schedule",
    "updated_minutes_ago": 30,                 // > 1440 makes it show as Stale
    "rating": 4.7, "review_count": 18,
    "schedule": [ { "weekdays": [0,1,2,3,4,5,6], "start_time": "07:00", "end_time": "23:00" } ] } ]
```

---

## 5. Changing the contract
1. Add a line to `docs/contract-changes.md` (who, what, why).
2. Post `CONTRACT CHANGE:` in the team chat.
3. P1 implements it and updates this file. Don't code against a change until it's here.
