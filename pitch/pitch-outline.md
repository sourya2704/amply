# Amply Pitch Deck: Slides + Speaker Notes

Build the slides in Google Slides or Canva. Brand: Electric Blue `#315CFF`, Bright Cyan `#19C6D2`,
Volt Lime `#C8F169`, Midnight Navy `#101B3D`, font Inter. Keep to one idea per slide and big text.

---

### 1. Title
**Amply: Charge Anywhere. Power Together.**
An AI-powered EV charging marketplace for India.
*Notes:* team names, one-line hook: "We help EV drivers find a charger that actually fits their car, and let idle
home and café chargers earn."

### 2. The problem
- Drivers can't tell which chargers fit their car (CCS2 vs Type 2 vs CHAdeMO vs GB/T, AC vs DC)
- "Available" on a map often isn't: data is stale, unconfirmed, or scattered across apps
- Private and business chargers sit idle for most of the day
*Notes:* one real-feeling story: a Nexon owner drives to a CHAdeMO charger they can't use.

### 3. Our solution
Three layers:
1. **Discovery:** one map, with incompatible chargers hidden and honest availability labels
2. **Marketplace:** book a home or café charger; the owner approves; you pay; the address is revealed
3. **AI assistant:** finds, explains and books, only after you confirm

### 4. Live demo
*Switch to the app. Follow docs/demo-script.md (about 2.5 min).*

### 5. AI you can trust
- Grounded: every fact comes from our own API (tool trace visible to the user)
- Same permissions as the user: the AI calls the API with the user's token, never the database
- Human in the loop: the AI prepares, the user confirms
- Hardened: tested against prompt injection hidden in a listing description
- Works offline: a labelled fallback planner keeps the product usable without the model

### 6. Trust & safety
- Hard compatibility filter (never "maybe compatible")
- Availability source on every charger: Live / Owner schedule / Reported / Stale / Unconfirmed
- No double booking (enforced by the database; 10 concurrent requests → exactly 1 booking)
- Private address hidden until payment
- Listing verification, user reports, and rule-based risk flags, with humans deciding

### 7. Business model (hypotheses)
- Service fee on each booking (prototype: 10% of energy cost, min ₹10)
- Subscriptions for businesses (cafés, malls, offices): visibility + analytics
- Operator partnerships later
**North-star metric:** successful charging sessions completed through Amply per month

### 8. Roadmap
- **Now:** prototype (this demo)
- **Pilot:** one dense Bengaluru area (Koramangala/HSR), verified owners, real payments (Razorpay)
- **Next:** operator APIs + live status, route planning, smart-charger integration

### 9. Team + ask
Who built what. Ask: pilot partners (apartments, cafés), mentors on electrical safety and payments.

---

## Likely judge questions
- **"Is it legal to resell home electricity?"** Validating this is part of the pilot. We will take legal and
  electrical-safety advice before any paid launch, and the PRD makes that a launch gate.
- **"How do you know a charger is really available?"** We don't pretend to. Each listing shows its source and freshness.
  Live status comes later via operator integrations.
- **"Why would owners list?"** Idle hardware earns money, with schedule control and owner approval for every booking.
- **"What stops fake listings?"** Admin verification before going live, user reports, and duplicate and price-outlier flags.
- **"What does the AI add over a filter?"** It handles plain requests ("near X, under ₹Y, at 6 PM, book it"),
  explains trade-offs, and does the multi-step work. The rules stay in the backend.
