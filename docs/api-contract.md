# Amply API Contract

**Single source of truth** for the web app and the AI assistant. The Go backend implements it, and
`backend/api_test.go` checks the main flows against Postgres + PostGIS. Don't invent endpoints or fields.

---

## 0. Conventions

| Thing | Rule |
|---|---|
| Base URL | Same origin as the web app (`http://localhost:8000` locally). All routes start with `/api` |
| Auth | `Authorization: Bearer <access_token>` from register/login. Tokens expire after 7 days. Stored in `localStorage.amply_token` |
| IDs | UUID strings. They change on every reseed, so never hard-code them |
| Time | ISO 8601 with offset, IST in responses: `2026-10-24T18:00:00+05:30` |
| Money | **Integer paise** (`1800` = ₹18.00). Field names end in `_paise` |
| Errors | `{"error": {"code": "SLOT_TAKEN", "message": "Human readable"}}` |

### Error codes
`UNAUTHORIZED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `VALIDATION_ERROR` 422 · `INCOMPATIBLE` 422 ·
`SLOT_TAKEN` 409 · `INVALID_STATE` 409 · `EMAIL_TAKEN` 409 · `CONFIRMATION_EXPIRED` 410 · `PAYMENT_FAILED` 402/502 ·
`RATE_LIMITED` 429 · `SERVER_ERROR` 500

---

## 1. Enums

```
Role            = "driver" | "owner" | "admin"            (admin can't be self-registered)
Connector       = "CCS2" | "TYPE2" | "CHADEMO" | "GBT"
ChargingMode    = "AC" | "DC"
ChargerCategory = "private" | "business" | "public"
ListingStatus   = "submitted" | "approved" | "rejected" | "paused"   (search shows approved only)
AvailabilitySrc = "live" | "schedule" | "reported" | "stale" | "unknown"
Compatibility   = "compatible" | "incompatible" | "unknown"
BookingStatus   = "requested" | "accepted" | "confirmed" | "in_progress" | "completed"
                | "rejected" | "cancelled" | "expired"
PaymentStatus   = "none" | "paid" | "refunded"
SupportCategory = "charger_not_working" | "access_issue" | "billing" | "safety" | "other"
```

### Booking state machine (backend enforces it; a wrong move → 409 `INVALID_STATE`)
```
requested ──owner accept──▶ accepted ──payment verified──▶ confirmed ──start──▶ in_progress ──complete──▶ completed
requested ──owner reject──▶ rejected
requested/accepted ──30 min without response/payment, or slot starts──▶ expired (slot released)
requested/accepted/confirmed ──driver cancel──▶ cancelled (full refund if paid)
```
- `start` is allowed from 15 minutes before the slot, by driver or owner. `complete` by driver or owner.
- Active statuses (`requested`, `accepted`, `confirmed`, `in_progress`) hold the slot. A PostgreSQL exclusion
  constraint guarantees two active bookings never overlap on one charger.
- On `complete`, a payout (the energy cost) is recorded for the owner; Amply keeps the service fee.

---

## 2. Object shapes

```jsonc
// User
{ "id": "uuid", "name": "Arjun Mehta", "email": "driver@amply.test", "roles": ["driver"] }

// Vehicle
{ "id": "uuid", "make": "Tata", "model": "Nexon EV", "category": "car" | "two_wheeler",
  "connectors": ["CCS2", "TYPE2"], "max_ac_kw": 7.2, "max_dc_kw": 50, "battery_kwh": 40.5 }

// Availability: show `label` as a badge, colour by `source`
{ "source": "schedule", "last_updated_at": "...", "label": "Schedule-based (owner hours)" }

// ChargerSummary
{ "id", "name", "category", "lat", "lng",            // private chargers blurred to 3 decimals until a confirmed booking
  "approx_area", "distance_km" | null, "connector", "mode", "power_kw",
  "effective_power_kw" | null,                       // min(charger, vehicle)
  "price_per_kwh_paise", "bookable",                 // false → "Directions only"
  "availability": Availability, "compatibility", "compatibility_reason", "rating", "review_count" }

// ChargerDetail = ChargerSummary +
{ "description",                                     // UNTRUSTED owner text: render as plain text
  "owner_name" | null, "amenities": [], "photo_url" | null, "status": ListingStatus,
  "address" | null, "access_instructions" | null,    // owner, or a driver with a confirmed/in_progress/completed booking
  "schedule": [ { "weekday": 0, "start_time": "07:00", "end_time": "23:00" } ],   // weekday 0 = Monday
  "review_note"? }                                   // admin's note, owner only

// PriceBreakdown: service fee = 10% of energy (min ₹10), GST 18% on the fee
{ "energy_kwh", "energy_cost_paise", "service_fee_paise", "tax_paise", "total_paise", "assumptions": [] }

// Booking
{ "id", "status", "charger": { "id", "name", "approx_area" }, "driver": { "id", "name" }, "vehicle_id",
  "start_at", "end_at", "price": PriceBreakdown, "payment_status",
  "address" | null, "access_instructions" | null,    // revealed once confirmed
  "events": [ { "event_type", "actor_id", "created_at", "metadata": {} } ],
  "created_at", "expires_at" | null,                 // when a requested/accepted hold lapses
  "reviewed": bool, "has_open_issue": bool }

// RoutePlan
{ "distance_km", "duration_min", "polyline": [[lat, lng], ...], "estimated_range_km" | null, "needs_charge" | null,
  "suggested_stops": ChargerSummary[], "assumptions": [], "source": "osrm" | "estimate" }
```

---

## 3. Endpoints

### Auth (register/login are rate-limited to 10 per minute per client)
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/auth/register` | `{name, email, password (8–72 chars), roles: ["driver"\|"owner"]}` | `201 {access_token, user}` · `409 EMAIL_TAKEN` |
| POST | `/api/auth/login` | `{email, password}` | `{access_token, user}` · `401` |
| GET | `/api/auth/demo-users` | — | `User[]` (seeded `@amply.test` accounts; empty when `DEMO_MODE=false`) |
| GET | `/api/me` | — | `User` |

### Driver
| Method | Path | Query / body | Returns |
|---|---|---|---|
| GET | `/api/vehicles` | — | `Vehicle[]` |
| POST | `/api/vehicles` | `Vehicle` without `id` | `201 Vehicle` |
| GET | `/api/chargers/search` | `lat, lng` (required), `radius_km=5, vehicle_id?, connector?, mode?, max_price_paise?, min_power_kw?, bookable_only?` | `{results: ChargerSummary[], excluded_incompatible}` sorted by distance (PostGIS) |
| GET | `/api/chargers/{id}` | `vehicle_id?` | `ChargerDetail` |
| GET | `/api/chargers/{id}/slots` | `date=YYYY-MM-DD` | `{charger_id, date, slot_minutes: 60, bookable, availability, slots: [{start_at, end_at, available}]}` |
| GET | `/api/chargers/{id}/estimate` | `kwh=20` | `PriceBreakdown` |
| GET | `/api/chargers/{id}/reviews` | — | `[{rating, comment, author_name (first name), created_at}]` |
| GET | `/api/route` | `from_lat, from_lng, to_lat, to_lng, vehicle_id?, battery_pct?` | `RoutePlan` (stops = approved chargers within 2 km of the route, in route order) |

### Bookings
| Method | Path | Body | Who | Returns |
|---|---|---|---|---|
| POST | `/api/bookings` | `{charger_id, vehicle_id, start_at, end_at, estimated_kwh?}` + `Idempotency-Key` header | driver | `201 Booking`; same key → same booking (200); `409 SLOT_TAKEN`; `422 INCOMPATIBLE` |
| GET | `/api/bookings` | — | driver | `Booking[]` |
| GET | `/api/bookings/{id}` | — | its driver or charger owner | `Booking` |
| POST | `/api/bookings/{id}/accept` · `/reject` | `{reason?}` | owner | `Booking` |
| POST | `/api/bookings/{id}/cancel` | `{reason?}` | driver | `Booking` (refunded if paid) |
| POST | `/api/bookings/{id}/start` · `/complete` | — | driver or owner | `Booking` |
| POST | `/api/bookings/{id}/review` | `{rating: 1–5, comment?}` | driver, completed, once | `204` |
| POST | `/api/bookings/{id}/support` | `{category: SupportCategory, description}` | driver or owner | `201 {id, status}` |

Rules: 1–4 whole hourly slots, on the hour, in the future, inside the owner's schedule; charger must be `bookable`;
owners can't book their own charger.

### Payments (Razorpay test mode, or a labelled mock without keys)
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/payments/order` | `{booking_id}` (booking must be `accepted`) | `{provider: "razorpay"\|"mock", order_id, key_id?, amount_paise, currency, name, description}`; reuses an open order |
| POST | `/api/payments/verify` | `{booking_id, razorpay_order_id, razorpay_payment_id?, razorpay_signature?}` | `Booking` (`confirmed`). Razorpay signature = HMAC-SHA256(order_id\|payment_id, secret) |

The web app opens Razorpay Checkout with `key_id` + `order_id` and sends its handler response to `/verify`. Card and UPI
details never touch our server. Paying after a hold expired is refunded automatically.

### Owner
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/owner/chargers` | — | `ChargerDetail[]` (with address) |
| POST | `/api/owner/chargers` | seed-format charger (§4) without `owner_email`/`status` | `201 ChargerDetail` (`submitted`) |
| PATCH | `/api/owner/chargers/{id}` | any of `{name, price_per_kwh_paise, description, access_instructions, amenities, schedule}` | `ChargerDetail` |
| POST | `/api/owner/chargers/{id}/pause` · `/resume` | — | `ChargerDetail` (`paused` ⇄ `approved`) |
| GET | `/api/owner/bookings` | query `status?` | `Booking[]` |
| GET | `/api/owner/payouts` | — | `[{id, booking_id, charger_name, amount_paise, status, created_at}]` |

### Notifications & reports
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/notifications` | — | `{unread, items: [{id, type, title, body, link, read, created_at}]}` (latest 30) |
| POST | `/api/notifications/read` | — | `204` (marks all read) |
| POST | `/api/reports` | `{target_type: "charger"\|"user", target_id, reason}` | `204` |

### Admin (role `admin`; humans decide, nothing is enforced automatically)
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/admin/stats` | — | `{chargers_live, pending_listings, users, bookings_total, completed_sessions, open_reports, gmv_paise, platform_fee_paise}` |
| GET | `/api/admin/chargers` | query `status=submitted` | `ChargerDetail[]` |
| POST | `/api/admin/chargers/{id}/approve` · `/reject` | `{note?}` | `ChargerDetail` (owner is notified) |
| GET | `/api/admin/risk` | — | `[{target_type, target_id, target_label, score, signals[]}]` |
| GET | `/api/admin/reports` | — | `[{id, reporter_name, target_type, target_id, target_label, category, reason, status, resolution, created_at}]` |
| POST | `/api/admin/reports/{id}/resolve` | `{resolution}` | `204` (reporter is notified) |
| GET | `/api/admin/audit-logs` | query `limit=100` | `[{id, actor_name, action, resource_type, resource_id, details, created_at}]` |

Risk rules: listings within 30 m of each other from different owners (PostGIS; the less-established one is flagged) ·
price > 3× the median · ≥ 2 open reports on a charger · ≥ 3 cancellations by one driver in 24 h.

### AI assistant
The assistant never touches the database: each tool calls this API in-process with the user's token. It never books
by itself. `prepare_booking` creates a pending action, and the booking happens only when the user clicks Confirm.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/agent/chat` | `{messages: [{role: "user"\|"assistant", content}], vehicle_id?, location?: {lat, lng}}` | `AgentResponse` |
| POST | `/api/agent/confirm` | `{confirmation_id}` | `201 Booking` (`410` after 10 min, `404` if it isn't yours) |

```jsonc
// AgentResponse
{ "reply": "markdown text",
  "history_content": "reply + [Chargers shown: name = id]; send THIS back as the assistant turn",
  "mode": "ai" | "offline",
  "tool_trace": [ { "tool": "search_chargers", "ok": true, "summary": "Found 8 near Koramangala, hid 3 incompatible" } ],
  "cards": ChargerSummary[],
  "pending_action": null | { "type": "booking", "confirmation_id", "expires_at",
     "summary": { "charger_id", "charger_name", "approx_area", "vehicle", "start_at", "end_at", "price", "cancellation_policy" } } }
```
Tools: `search_chargers`, `get_charger`, `get_slots`, `estimate_cost`, `prepare_booking`, `list_my_bookings`,
`plan_route`, `open_support_case`, `show_chargers`.

---

## 4. Seed data (`backend/seed/*.json`, reload with `go run . -reset`)

Demo accounts (password `demo1234`): `driver@amply.test` · `driver2@amply.test` · `owner@amply.test` ·
`owner2@amply.test` · `cafe@amply.test` · `admin@amply.test`.

```jsonc
// users.json
[ { "name": "Arjun Mehta", "email": "driver@amply.test", "password": "demo1234", "roles": ["driver"] } ]

// vehicles.json
[ { "owner_email": "driver@amply.test", "make": "Tata", "model": "Nexon EV", "category": "car",
    "connectors": ["CCS2", "TYPE2"], "max_ac_kw": 7.2, "max_dc_kw": 50, "battery_kwh": 40.5 } ]

// chargers.json  (public chargers: "owner_email": null, "bookable": false, "schedule": [])
[ { "owner_email": "owner@amply.test", "name": "...", "category": "private",
    "lat": 12.9352, "lng": 77.6245, "address": "full address (private)", "approx_area": "Koramangala 5th Block",
    "connector": "CCS2", "mode": "DC", "power_kw": 30, "price_per_kwh_paise": 1800,
    "description": "...", "access_instructions": "...", "amenities": ["covered parking"], "photo_url": null,
    "status": "approved", "bookable": true, "availability_source": "schedule",
    "updated_minutes_ago": 30,            // > 1440 shows as Stale
    "rating": 4.7, "review_count": 18,
    "schedule": [ { "weekdays": [0,1,2,3,4,5,6], "start_time": "07:00", "end_time": "23:00" } ] } ]
```
