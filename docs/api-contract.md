# Amply API Contract (v1 — hackathon)

**This file is the single source of truth.** Frontend, AI agent, and admin code are written against it.
Backend implements it exactly. Do not invent endpoints or fields — if you need a change, follow
"Changing the contract" at the bottom.

---

## 0. Conventions

| Thing | Rule |
|---|---|
| Base URL | `http://localhost:8000` locally, deployed URL later. All routes start with `/api` |
| Frontend env | `VITE_API_URL` (e.g. `http://localhost:8000`) |
| Auth | `Authorization: Bearer <access_token>` (JWT). Token stored in `localStorage` key `amply_token` |
| IDs | UUID strings |
| Time | ISO 8601 **with offset**, e.g. `2026-10-24T18:00:00+05:30`. Display in Asia/Kolkata |
| Money | **Integer paise** (`2000` = ₹20.00). Never floats. Field names end in `_paise` |
| Distance | km, float, 1 decimal |
| Errors | HTTP status + body `{"error": {"code": "SLOT_TAKEN", "message": "Human readable"}}` |
| CORS | `http://localhost:5173` and the deployed frontend origin are allowed |

### Error codes
`UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `VALIDATION_ERROR` (422),
`INCOMPATIBLE` (422), `SLOT_TAKEN` (409), `INVALID_STATE` (409), `PAYMENT_FAILED` (402),
`CONFIRMATION_EXPIRED` (410).

---

## 1. Enums

```
Role             = "driver" | "owner" | "admin"
VehicleCategory  = "car" | "two_wheeler"
Connector        = "CCS2" | "TYPE2" | "CHADEMO" | "GBT" | "BHARAT_AC001" | "BHARAT_DC001"
ChargingMode     = "AC" | "DC"
ChargerCategory  = "private" | "business" | "public"
ListingStatus    = "draft" | "submitted" | "approved" | "rejected" | "paused"
AvailabilitySrc  = "live" | "schedule" | "reported" | "stale" | "unknown"
Compatibility    = "compatible" | "incompatible" | "unknown"
BookingStatus    = "requested" | "accepted" | "confirmed" | "in_progress" | "completed"
                 | "rejected" | "cancelled" | "expired"
PaymentStatus    = "none" | "created" | "paid" | "failed"
RiskStatus       = "open" | "dismissed" | "actioned"
```

### Booking state machine (backend enforces; anything else → 409 `INVALID_STATE`)
```
requested  --owner accept-->  accepted  --payment verified-->  confirmed
requested  --owner reject-->  rejected
requested/accepted --15 min no action--> expired
requested/accepted/confirmed --driver cancel--> cancelled
confirmed  --start-->  in_progress  --complete-->  completed
```

---

## 2. Shared object shapes

```jsonc
// User
{ "id": "uuid", "name": "Asha", "email": "a@x.com", "roles": ["driver", "owner"] }

// Vehicle
{ "id": "uuid", "make": "Tata", "model": "Nexon EV", "category": "car",
  "connectors": ["CCS2", "TYPE2"], "max_ac_kw": 7.2, "max_dc_kw": 50, "battery_kwh": 40.5 }

// Availability (attached to every charger)
{ "source": "schedule", "last_updated_at": "2026-10-24T17:40:00+05:30",
  "label": "Schedule-based (owner hours)" }
//  label rules: live→"Live", schedule→"Schedule-based (owner hours)",
//  reported→"Reported N min ago", stale (>24h old)→"Stale — may be outdated", unknown→"Availability unconfirmed"

// ChargerSummary  (search results, map pins, agent cards)
{ "id": "uuid", "name": "Koramangala Home Charger", "category": "private",
  "lat": 12.935, "lng": 77.624,              // private chargers: rounded to ~3 decimals until booking confirmed
  "approx_area": "Koramangala 5th Block",
  "distance_km": 1.2, "connector": "CCS2", "mode": "DC", "power_kw": 30,
  "effective_power_kw": 30,                   // min(charger, vehicle) if vehicle given, else null
  "price_per_kwh_paise": 1800, "bookable": true,
  "availability": { /* Availability */ },
  "compatibility": "compatible",              // "unknown" if no vehicle given or vehicle specs missing
  "compatibility_reason": "CCS2 DC supported by Nexon EV (max 50 kW)",
  "rating": 4.6, "review_count": 12 }

// ChargerDetail = ChargerSummary + 
{ "description": "string (UNTRUSTED user content)", "owner_name": "Ravi",
  "amenities": ["parking", "cafe"], "photo_url": "https://... | null",
  "status": "approved",                        // ListingStatus (owner/admin views)
  "address": null,                             // only for owner/admin, or driver with confirmed booking
  "access_instructions": null,                 // same rule as address
  "schedule": [ { "weekday": 0, "start_time": "08:00", "end_time": "22:00" } ]  // weekday 0 = Monday
}

// PriceBreakdown
{ "energy_kwh": 20, "energy_cost_paise": 36000, "service_fee_paise": 3600,
  "tax_paise": 648, "total_paise": 40248,
  "assumptions": ["Estimate assumes 20 kWh delivered", "Final charge may differ"] }
//  service_fee = 10% of energy cost (min 1000 paise); tax = 18% GST on service fee

// BookingEvent
{ "event_type": "accepted", "actor_id": "uuid", "created_at": "...", "metadata": {} }

// Booking
{ "id": "uuid", "status": "requested",
  "charger": { "id": "uuid", "name": "...", "approx_area": "..." },
  "driver": { "id": "uuid", "name": "..." },
  "vehicle_id": "uuid", "start_at": "...", "end_at": "...",
  "price": { /* PriceBreakdown */ },
  "payment_status": "none",
  "address": null, "access_instructions": null,   // filled when status ∈ confirmed/in_progress/completed
  "expires_at": "... | null",
  "events": [ /* BookingEvent */ ],
  "created_at": "..." }

// RiskCase
{ "id": "uuid", "target_type": "user" | "charger", "target_id": "uuid", "target_label": "string",
  "score": 0.8, "signals": ["3 cancellations in 24h"], "status": "open",
  "created_at": "...", "resolution_note": null }
```

---

## 3. Endpoints

### Auth
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/auth/register` | `{name, email, password, roles: Role[]}` (admin not allowed) | `{access_token, user}` |
| POST | `/api/auth/login` | `{email, password}` | `{access_token, user}` |
| GET | `/api/me` | — | `User` |

### Vehicles (driver)
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/vehicles` | — | `Vehicle[]` |
| POST | `/api/vehicles` | Vehicle without `id` | `Vehicle` |
| DELETE | `/api/vehicles/{id}` | — | `204` |

### Chargers (public / driver)
| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/api/chargers/search` | `lat, lng, radius_km=5, vehicle_id?, connector?, mode?, max_price_paise?, min_power_kw?, bookable_only=false` | `{results: ChargerSummary[], excluded_incompatible: number}` |
| GET | `/api/chargers/{id}` | `vehicle_id?` | `ChargerDetail` |
| GET | `/api/chargers/{id}/slots` | `date=YYYY-MM-DD` | `{charger_id, date, slot_minutes: 60, availability: Availability, slots: [{start_at, end_at, available: bool}]}` |
| GET | `/api/chargers/{id}/estimate` | `kwh=20` | `PriceBreakdown` |

Search rules: only `approved` chargers; if `vehicle_id` given, **incompatible chargers are removed** (count returned in
`excluded_incompatible`); results sorted by distance. Public imported chargers have `bookable: false` → UI shows
"Directions only".

### Owner
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/owner/chargers` | — | `ChargerDetail[]` (incl. status, address) |
| POST | `/api/owner/chargers` | `{name, category, lat, lng, address, approx_area, connector, mode, power_kw, price_per_kwh_paise, description, access_instructions, amenities, photo_url?, schedule[]}` | `ChargerDetail` (status `draft`) |
| PATCH | `/api/owner/chargers/{id}` | any subset of the above | `ChargerDetail` |
| POST | `/api/owner/chargers/{id}/submit` | — | `ChargerDetail` (`submitted`) |
| POST | `/api/owner/chargers/{id}/pause` | — | `ChargerDetail` (`paused`) |
| POST | `/api/owner/chargers/{id}/resume` | — | `ChargerDetail` (`approved`) |
| GET | `/api/owner/bookings` | query `status?` | `Booking[]` for the owner's chargers |

### Bookings
| Method | Path | Body | Who | Returns |
|---|---|---|---|---|
| POST | `/api/bookings` | `{charger_id, vehicle_id, start_at, end_at, estimated_kwh}` + header `Idempotency-Key: <uuid>` | driver | `Booking` (`requested`). 409 `SLOT_TAKEN`, 422 `INCOMPATIBLE` |
| GET | `/api/bookings` | — | driver | `Booking[]` (own) |
| GET | `/api/bookings/{id}` | — | driver or charger owner | `Booking` |
| POST | `/api/bookings/{id}/accept` | — | owner | `Booking` |
| POST | `/api/bookings/{id}/reject` | `{reason}` | owner | `Booking` |
| POST | `/api/bookings/{id}/cancel` | `{reason}` | driver | `Booking` |
| POST | `/api/bookings/{id}/start` | — | driver or owner | `Booking` |
| POST | `/api/bookings/{id}/complete` | — | driver or owner | `Booking` |
| POST | `/api/bookings/{id}/review` | `{rating: 1-5, comment}` | driver, completed only | `204` |

Slots are 60 min; a booking is 1–4 consecutive slots. Overlaps are blocked by a DB exclusion constraint.

### Payments (Razorpay test mode)
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/payments/order` | `{booking_id}` (booking must be `accepted`) | `{razorpay_order_id, amount_paise, currency: "INR", key_id}` |
| POST | `/api/payments/verify` | `{booking_id, razorpay_order_id, razorpay_payment_id, razorpay_signature}` | `Booking` (`confirmed`) |

Frontend opens Razorpay Checkout (`https://checkout.razorpay.com/v1/checkout.js`) with `key_id` + `order_id`,
then sends the handler response to `/verify`.

### Reports
| POST | `/api/reports` | `{target_type: "charger"|"user", target_id, reason}` | `204` |
|---|---|---|---|

### Admin (role `admin` only)
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/admin/chargers` | query `status=submitted` | `ChargerDetail[]` |
| POST | `/api/admin/chargers/{id}/approve` | `{note?}` | `ChargerDetail` |
| POST | `/api/admin/chargers/{id}/reject` | `{reason}` | `ChargerDetail` |
| GET | `/api/admin/risk-cases` | query `status=open` | `RiskCase[]` |
| POST | `/api/admin/risk/scan` | — | `RiskCase[]` (newly created) |
| POST | `/api/admin/risk-cases/{id}/resolve` | `{decision: "dismissed"|"actioned", note}` | `RiskCase` |
| GET | `/api/admin/audit-logs` | query `limit=50` | `[{id, actor_name, action, resource_type, resource_id, created_at}]` |
| GET | `/api/admin/stats` | — | `{chargers_live, bookings_today, completed_sessions, open_risk_cases}` |

Risk rules (deterministic): driver with ≥3 cancellations in 24h; two chargers within 20 m of each other
(duplicate); price > 3× area median; charger with ≥2 open reports.

### AI agent (owned by P3, mounted in the same FastAPI app)
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/agent/chat` | `{messages: [{role: "user"|"assistant", content: string}], vehicle_id?, location?: {lat, lng}}` | `AgentResponse` |
| POST | `/api/agent/confirm` | `{confirmation_id}` | `Booking` (410 `CONFIRMATION_EXPIRED` after 10 min) |
| GET | `/api/route` | `from_lat, from_lng, to_lat, to_lng, vehicle_id?, battery_pct?` | `RoutePlan` |

```jsonc
// AgentResponse
{ "reply": "markdown text",
  "tool_trace": [ { "tool": "search_chargers", "args": {}, "ok": true, "summary": "Found 6, removed 2 incompatible" } ],
  "cards": [ /* ChargerSummary[] to render under the reply */ ],
  "pending_action": null | {
      "type": "booking", "confirmation_id": "uuid", "expires_at": "...",
      "summary": { "charger_name": "...", "start_at": "...", "end_at": "...",
                   "price": { /* PriceBreakdown */ }, "cancellation_policy": "Free cancellation until owner accepts" } },
  "route": null | /* RoutePlan */ }

// RoutePlan
{ "distance_km": 148.2, "duration_min": 172, "polyline": [[12.97, 77.59], ...],
  "estimated_range_km": 120, "needs_charge": true,
  "suggested_stops": [ /* ChargerSummary[] */ ],
  "assumptions": ["Range assumes 6 km/kWh and 10% reserve", "Battery % not provided → assumed 50%"] }
```

---

## 4. Seed data format (P4 writes, backend loads)

`backend/seed/users.json`
```json
[ { "name": "Demo Driver", "email": "driver@amply.test", "password": "demo1234", "roles": ["driver"] } ]
```
Demo accounts: `driver@amply.test`, `owner@amply.test`, `admin@amply.test`, `driver2@amply.test` — all `demo1234`.

`backend/seed/vehicles.json` — `[{ "owner_email": "...", ...Vehicle without id }]`

`backend/seed/chargers.json`
```json
[ { "owner_email": "owner@amply.test", "name": "...", "category": "private",
    "lat": 12.9352, "lng": 77.6245, "address": "full address", "approx_area": "Koramangala 5th Block",
    "connector": "CCS2", "mode": "DC", "power_kw": 30, "price_per_kwh_paise": 1800,
    "description": "...", "access_instructions": "...", "amenities": ["parking"],
    "photo_url": null, "status": "approved", "bookable": true,
    "availability_source": "schedule", "last_updated_at": "2026-10-24T10:00:00+05:30",
    "schedule": [ { "weekday": 0, "start_time": "08:00", "end_time": "22:00" } ],
    "rating": 4.6, "review_count": 12 } ]
```
Public chargers: `"owner_email": null, "category": "public", "bookable": false`.

---

## 5. Changing the contract
1. Write the change in `docs/contract-changes.md` (who, what, why).
2. Post `CONTRACT CHANGE:` in the team chat.
3. Backend (P1) approves and updates this file. Nobody codes against a change until it's in this file.
