# AI Brief — P4: Product, Demo Data, Pitch

> **Give this file to your AI assistant as the first message**, with `docs/api-contract.md` and `docs/WORKFLOW.md`.
> Then say: "Start with Step 1."

## Context
You're the assistant for **P4, product + pitch owner** on team Amply at an overnight hackathon. We're submitting a
**prototype**. Amply ("Charge Anywhere. Power Together.") is an AI-powered EV charging marketplace for India. Drivers find
and book compatible chargers (public, private homes, businesses), owners earn from idle chargers, and an AI assistant
recommends and books, with the user's confirmation.

P1 built the backend (Go), P2 builds the web app, and P3 the AI assistant. **P4 makes the demo feel real and wins the
pitch:** demo data, demo script, testing, deck, and the demo video.

## Hard rules
1. Only edit `backend/seed/*.json`, `docs/demo-script.md`, `docs/qa-checklist.md`, `pitch/`.
2. Seed JSON must follow contract §4 **exactly**. Check it with
   `python3 -c "import json; json.load(open('backend/seed/chargers.json'))"`, then ask P1 to reseed.
3. Fake names and addresses only. No real people's data.
4. The pitch must only claim what the prototype really does (no "nationwide", no "live status everywhere").

## Steps

### Step 1 (H0–H2): Grow the seed data
`backend/seed/` already has 6 users, 3 vehicles, and 12 chargers, including the demo plants. **Keep these plants**
(the tests and the AI evals rely on them):
- CHAdeMO + GB/T public chargers near Koramangala (incompatibility demo)
- "Indiranagar Rooftop Charger" with the prompt-injection description
- "HSR Sector 2 Home Charger" with `updated_minutes_ago: 4320` (stale badge)
- "Ravi's Home Fast Charger" and "Brew & Charge Café" (main booking demo)

Add about **20–25 more** across Koramangala, HSR Layout, Indiranagar, BTM, Bellandur, and Jayanagar:
mostly CCS2/TYPE2, a realistic mix of `private` (₹12–20/kWh, AC 3.3–7.4 kW or DC 15–30 kW), `business` (cafés, hotels,
malls, gyms; DC 30–60 kW, ₹18–24/kWh), and `public` (`bookable: false`). Give them believable names, descriptions,
access instructions, and amenities. Ask P1 to run `go run . -reset` after you push.

### Step 2 (H2–H5): Demo script + pitch deck draft
- `docs/demo-script.md`: a 3-minute click-by-click script with 2 browser windows (driver and owner), the exact sentences
  to type to the AI, and what to say at each judge moment (double booking, honest badges, AI guardrails).
- Pitch deck in `pitch/` (Google Slides/Canva is fine; put the link or PDF here), 6–7 slides:
  1. **Problem:** EV drivers in India can't trust charger availability or compatibility, and private chargers sit idle.
  2. **Solution:** marketplace + AI decision layer + honest status labels.
  3. **Live demo.**
  4. **Safe AI:** grounded in real data, confirmation before booking, prompt-injection tested (use P3's eval results).
  5. **Trust:** compatibility hard filter, no double booking, address hidden until payment, full booking history.
  6. **Business model:** service fee per booking + business subscriptions. North star: successful charging sessions per month.
  7. **Roadmap + team:** Bengaluru pilot → operator integrations → smart chargers.

### Step 3 (H5–H8): QA
`docs/qa-checklist.md`, then test everything on the real app and send `BUG: <steps>` to the owner. Cover: login as each
user, search with each vehicle, booking happy path, two windows booking the same slot, owner reject, cancel after accept,
pay → address revealed, AI search, AI booking + confirm, and AI with no vehicle selected.

### Step 4 (H9–H12)
Rehearse 3× with a timer. **Record the 2–3 min demo video** (also our backup). Ask P1 to reseed right before judging.

## Done when
Seed data looks real on the map; demo script, QA checklist, deck, and video are done.
