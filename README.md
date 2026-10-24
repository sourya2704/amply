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
- **Accounts and roles:** one user can be both driver and owner; permissions are enforced server-side.
- **Vehicle profiles:** make/model, connectors, AC/DC power limits. Missing specs are treated as *unknown*, never assumed.
- **Charger listings:** owners submit a charger → admin approves or rejects → it goes live. Private addresses stay hidden until a booking is paid.
- **Nearby search:** map search filtered by connector, mode, power, price, distance, and bookability (PostGIS planned for scale).
- **Honest availability:** every charger is labelled *Live*, *Schedule-based*, *Reported*, *Stale*, or *Unknown*.
- **Booking:** slot-based reservations with owner approval. Double booking is blocked by serialized database transactions, and every state change is logged in a timeline.
- **Payments:** mock checkout in the prototype (Razorpay planned), with transparent fees and idempotent booking requests.
- **Trust and safety:** listing verification, user reports with recorded outcomes, and rule-based risk flags (duplicates, price outliers, report and cancellation spikes) for human review.

### Booking lifecycle
```
Requested ─accept→ Accepted ─pay→ Confirmed ─start→ In Progress ─complete→ Completed
    │                 │               │
    └─reject/expire───┴──cancel───────┘  → Rejected / Expired / Cancelled
```

## AI agents
The AI is a **decision-support layer**, not a chatbot that makes things up. Agents call backend tools for every fact;
the language model only interprets requests and explains results.

| Agent | Role |
|---|---|
| **Orchestrator** | Understands the request, asks for missing info, picks tools, combines answers |
| **Discovery & Recommendation** | Applies hard compatibility filters, then ranks by distance, price, speed, and availability confidence |
| **Route & Range Planning** | Suggests charging stops along a route, with assumptions and uncertainty stated |
| **Booking Assistant** | Prepares a booking summary. **Nothing is booked without the user's explicit confirmation** |
| **Trust & Risk Triage** | Flags suspicious listings or behaviour with evidence, for human review only |
| **Support & Disputes** | Collects booking context and prepares a structured case for review |

**AI safety rules:** the AI never invents station status, energy delivered, or approvals. It never overrides
compatibility, booking, or payment rules. It treats listing text and reviews as untrusted input.

## Tech stack
| Layer | Technology |
|---|---|
| Web app | React, Vite, TypeScript, Tailwind CSS, Leaflet (OpenStreetMap) |
| API | Go (standard library `net/http`) |
| Database | SQLite (prototype) → PostgreSQL + PostGIS for production |
| AI | Claude API tool use (Anthropic Go SDK), built into the Go server |
| Maps | OpenStreetMap (Leaflet) |
| Payments | Mock payment (prototype) → Razorpay later |

```
React web app
      │
Go API ── auth · roles
      ├── Marketplace services: users · vehicles · chargers · availability · search · bookings · payments · reviews · admin
      ├── AI assistant ──▶ Claude tool use, calling the same API with the user's permissions
      └── Integrations: maps/routing · payments
      │
SQLite · booking event history
```

## Prototype scope
**Built:** demo login with roles, vehicle profiles, owner listing + admin verification, map search, compatibility
filtering, honest availability labels, slot booking with owner approval, mock payment, AI assistant (search, explain,
book with confirmation), rule-based risk flags, user reports, and admin tools.

**Not yet:** real sign-up and payments (Razorpay), route planning, reviews, notifications, live operator data,
smart-charger control, and the separate risk/support AI agents described above.

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

## Run the prototype
```bash
cd frontend && npm install && npm run build
cd ../backend && go run . -reset        # http://localhost:8000
```
Log in with one of the demo accounts on the login page. Optional: add `ANTHROPIC_API_KEY` to `backend/.env` for the
Claude-powered assistant (without it, a labelled offline planner is used). Tests: `cd backend && go test ./...`.

Docs: [team guide](docs/WORKFLOW.md) · [API contract](docs/api-contract.md) · [demo script](docs/demo-script.md) · [pitch outline](pitch/pitch-outline.md)
