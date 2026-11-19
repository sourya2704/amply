# ⚡ Amply — Charge Anywhere. Power Together.

**An AI-powered EV charging marketplace for India.** Amply connects EV drivers with public charging stations,
verified private charger owners, and businesses, and uses tool-using AI agents to help drivers decide where to charge.

> **Product principle:** a station being *listed* is never the same as it being *available*, *compatible*,
> *safe to access*, or *bookable*. Each claim needs its own evidence and status.

---

## The problem
- **Discovery:** charging options are scattered across apps and operators.
- **Compatibility:** drivers need to know connector, AC/DC mode, and power limits *before* they travel.
- **Availability:** listings, schedules, and live status get mixed up, which leads to wasted trips.
- **Access and trust:** private chargers need owner approval, verification, clear pricing, and dispute handling.
- **Idle supply:** many private and business chargers sit unused for hours every day.

## The solution
Amply combines three layers:

| Layer | What it does |
|---|---|
| **Charging discovery** | Map and search across participating public and private chargers, with compatibility and freshness labels |
| **Community marketplace** | Listings, schedules, reservations, payments, reviews, and owner payouts |
| **AI charging assistance** | Multi-step agents for compatibility checks, ranking, route planning, booking help, and risk triage |

## Who it's for
| User | Needs | What Amply gives them |
|---|---|---|
| **EV driver** | Compatible chargers, clear price, reliable status, booking | Compare options and make informed charging decisions |
| **Private owner** | Schedule control, privacy, payouts | Earn from a home charger during chosen hours |
| **Business / property** | Visibility, bookings, analytics | Attract customers and monetise chargers |
| **Charging operator** | Accurate listings, integrations | More discoverability |
| **Admin** | Verification, disputes, risk review | Run a trustworthy, auditable marketplace |

## Key features
- **Accounts and roles:** sign-up and login with hashed passwords and expiring tokens; one person can be both driver and owner. Every action is checked server-side.
- **Vehicle profiles:** make/model, connectors, AC/DC power limits. Missing specs are treated as *unknown*, never assumed.
- **Geospatial search:** PostGIS finds chargers near you, and incompatible chargers are hidden (the count is shown).
- **Honest availability:** every charger is labelled *Live*, *Owner schedule*, *Reported*, *Stale*, or *Unconfirmed*.
- **Booking:** hourly slots with owner approval. A PostgreSQL exclusion constraint makes double booking impossible, requests that nobody answers expire, and every change is recorded in a timeline.
- **Payments:** Razorpay test mode (orders, signature verification, refunds on cancellation), with a labelled mock fallback. Owners' earnings are tracked as payouts.
- **Charger listings:** owners submit → admins verify → live, with edit, pause and resume. Home addresses stay hidden until a driver has paid.
- **Trip planning:** road routes (OSRM) with a range estimate and compatible chargers along the way, found with PostGIS.
- **Reviews, notifications, support:** reviews after completed sessions, in-app notifications, and support cases on bookings.
- **Trust and safety:** listing verification, reports and support cases with recorded outcomes, risk flags (duplicate listings, price outliers, report and cancellation spikes) for human review, and a full audit log.

### Booking lifecycle
```
Requested ─accept→ Accepted ─pay→ Confirmed ─start→ In Progress ─complete→ Completed
    │                 │               │
    └─reject/expire───┴──cancel (refund if paid)──┘  → Rejected / Expired / Cancelled
```

## AI assistant
The AI is a **decision-support layer**, not a chatbot that makes things up. It calls the same API as the app, using
the signed-in user's permissions, for every fact; the language model only interprets requests and explains results.

| PRD agent role | How it works in Amply |
|---|---|
| **Orchestrator** | One assistant that understands the request, asks for missing info, and picks tools |
| **Discovery & Recommendation** | `search_chargers` (compatibility already enforced), `get_charger`, `estimate_cost` |
| **Route & Range Planning** | `plan_route`: distance, time, range estimate and chargers along the route, with stated assumptions |
| **Booking Assistant** | `get_slots` + `prepare_booking`. **Nothing is booked until the user presses Confirm** |
| **Support & Disputes** | `open_support_case` on a booking, resolved by an admin |
| **Trust & Risk Triage** | Rule-based risk flags with evidence in the admin dashboard; humans decide |

**AI safety rules:** the AI never invents station status, energy delivered, or approvals. It never overrides
compatibility, booking, or payment rules, and treats listing text and reviews as untrusted input. If no AI model is
configured, a clearly labelled offline planner uses the same tools.

## Tech stack
| Layer | Technology |
|---|---|
| Web app | React, Vite, TypeScript, Tailwind CSS, Leaflet (OpenStreetMap) |
| API | Go (standard library `net/http`), bcrypt, HMAC-signed tokens |
| Database | PostgreSQL + PostGIS (geography columns, GiST indexes, exclusion constraint) |
| AI | LLM with tool calling, built into the Go server |
| Routing | OSRM road routing + PostGIS corridor search |
| Payments | Razorpay (test mode) |

```
React web app
      │
Go API ── auth · roles · rate limits · audit log
      ├── Marketplace: users · vehicles · chargers · availability · bookings · payments · payouts · reviews · notifications
      ├── AI assistant ──▶ LLM tool calling over the same API, with the user's permissions
      ├── Trust & safety: verification · reports & support cases · risk flags
      └── Integrations: OSRM routing · Razorpay
      │
PostgreSQL + PostGIS
```

## Not yet built
Live operator data and station integrations, smart-charger control and metered energy, native mobile apps, SMS/email
notifications, automated owner payouts (tracked, settled manually), and multilingual chat.

## Business model (hypotheses to validate)
- Transparent service fee on eligible bookings
- Business subscriptions for advanced listings and analytics
- Operator partnership and software fees

**North-star metric:** successful charging sessions completed through Amply per active month.

## Roadmap
| Horizon | Plans |
|---|---|
| **Pilot** | One dense area in Bengaluru with verified charger supply and a controlled driver group |
| **Near term** | Better ranking, notifications, owner analytics, multilingual conversational UX |
| **Medium term** | Operator API integrations, live availability, stronger route planning, business accounts |
| **Long term** | Smart-charger integrations, session telemetry, fleet tools, demand forecasting |

---

*Amply is a working name; trademark and domain availability are still to be confirmed.*

## Run it locally
```bash
docker compose up -d db                              # Postgres + PostGIS on localhost:5434
cd frontend && npm install && npm run build
cd ../backend && cp .env.example .env && go run . -reset   # http://localhost:8000
```
Log in with a demo account on the login page (password `demo1234`), or create your own account. Optional keys in
`backend/.env`: `ANTHROPIC_API_KEY` for the AI model, `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` (test mode) for payments.

Tests (need the database running):
```bash
cd backend && TEST_DATABASE_URL="postgres://amply:amply@localhost:5434/amply_test?sslmode=disable" go test ./...
```

Docs: [team guide](docs/WORKFLOW.md) · [API contract](docs/api-contract.md) · [demo script](docs/demo-script.md) · [pitch outline](pitch/pitch-outline.md)
