# AI Brief — P2: Frontend

> **Paste this whole file into your AI assistant as the first message**, together with `docs/api-contract.md`
> and `docs/WORKFLOW.md`. Then say: "Start with Step 1."

---

## Who you are helping
You are the coding assistant for **P2, the frontend developer** on team Amply at an all-night hackathon (~12 h).
Amply is an AI-powered EV charging marketplace for India: drivers find and book compatible public/private
chargers, owners list chargers and accept bookings, admins verify listings and review risk flags.

The team has 4 people. Backend (FastAPI + Postgres/PostGIS) is being built by P1 in parallel; the AI agent by
P3; admin pages + seed data by P4. **You build the driver and owner web app.**

## Hard rules
1. **Only edit files in `frontend/`**, and **not** in `frontend/src/components/agent/` (P3), `frontend/src/pages/trip/` (P3)
   or `frontend/src/pages/admin/` (P4). You create placeholder files for them in Step 1, then hand them over.
2. **Use `docs/api-contract.md` exactly.** Don't invent endpoints or fields. If something is missing, stop and tell
   your human to raise a `CONTRACT CHANGE:`.
3. Must work with **mocks** (`VITE_USE_MOCKS=true`) so you're never blocked on the backend.
4. Money is integer paise → format with `formatINR(paise)` → `₹402.48`. Times are ISO with offset → show in Asia/Kolkata.
5. Charger `description` is user content: render as plain text, never `dangerouslySetInnerHTML`.
6. Small commits on a `fe/<feature>` branch; merge to `main` at least every 2 hours. Never commit `.env*`.

## Stack
React 18 + Vite + TypeScript + Tailwind CSS · `react-router-dom` · `@tanstack/react-query` · `leaflet` +
`react-leaflet` (OpenStreetMap tiles, no API key) · `lucide-react` icons · `date-fns` + `date-fns-tz`.

**Brand:** primary Electric Blue `#315CFF`, accent Bright Cyan `#19C6D2`, highlight Volt Lime `#C8F169`,
dark base Midnight Navy `#101B3D`, font Inter. Tagline: "Charge Anywhere. Power Together."
Clean, modern, trustworthy. Has to look good on a projector and at mobile width.

## Folder layout you create
```
frontend/src/
  lib/api.ts          # fetch wrapper: base URL, Bearer token, error → {code,message}, mock switch
  lib/types.ts        # TS types copied 1:1 from the contract (shared with P3/P4 — you own it)
  lib/format.ts       # formatINR, formatTime, availability badge colors
  lib/auth.tsx        # AuthContext: user, token, login, logout, roles
  mocks/              # mock JSON for every endpoint you use + a mock router in api.ts
  components/         # ChargerCard, AvailabilityBadge, CompatibilityChip, SlotPicker, PriceBreakdown,
                      # BookingTimeline, StatusPill, Map, Navbar, ProtectedRoute
  components/agent/   # P3 — create only AgentPanel.tsx placeholder exporting <AgentPanel />
  pages/              # your pages (below)
  pages/trip/         # P3 — create only TripPlanner.tsx placeholder
  pages/admin/        # P4 — create only AdminHome.tsx placeholder
```

## Steps

### Step 1 (H0–H1) — Scaffold and unblock the team. **Push to main within the first hour.**
- `npm create vite@latest frontend -- --template react-ts`, install the stack, set up Tailwind with brand colors as theme tokens.
- `lib/types.ts` with every type and enum from the contract.
- `lib/api.ts`: `api.get/post/patch/delete`, reads `VITE_API_URL`, adds the `Authorization` header from `localStorage.amply_token`,
  sends `Idempotency-Key` (via `crypto.randomUUID()`) on `POST /api/bookings`, throws `ApiError{status, code, message}`.
  If `VITE_USE_MOCKS=true`, return data from `mocks/`.
- Router with all routes below. `/trip` → `pages/trip/TripPlanner.tsx`, `/admin/*` → `pages/admin/AdminHome.tsx`,
  and `<AgentPanel />` mounted as a floating button on the search page. Use placeholders for all three.
- Navbar with role-aware links (driver / owner / admin) and the logo text "⚡ Amply".
- **Push to `main` and tell the team "frontend scaffold merged"** so P3/P4 can start.

### Step 2 (H1–H4) — Driver discovery (on mocks)
- `/login`, `/register` (role checkboxes driver/owner). Use demo accounts from the contract §4.
- `/vehicles`: list, add (connector multi-select, AC/DC kW), delete. Vehicle selector stored in context.
- `/` **Map search** (the main screen):
  - Left: filters (connector, AC/DC, max price ₹/kWh, min kW, radius, "bookable only"), result list of `ChargerCard`s.
  - Right: Leaflet map centered on Koramangala (12.9352, 77.6245) with pins colored by availability source. Add a "use my location" button.
  - Show the banner "N incompatible chargers hidden for your <vehicle>" from `excluded_incompatible`.
  - `ChargerCard`: name, area, distance, connector + mode + kW, ₹/kWh, `AvailabilityBadge` (label from the API), `CompatibilityChip`
    with reason tooltip, rating, plus "Bookable" or "Directions only".
- `/chargers/:id`: details, schedule, `SlotPicker` (date + 60-min slots, select 1–4 consecutive), `PriceBreakdown`
  from `/estimate`, a **Request booking** button, and a "Report listing" link.

### Step 3 (H4–H7) — Booking loop + owner (switch to the real API)
- Booking request → toast → go to `/bookings/:id`. On `SLOT_TAKEN`, show a friendly error and refresh slots. **This is a demo moment, so make it look clear.**
- `/bookings`: list with `StatusPill`. `/bookings/:id`: details, `BookingTimeline` from `events`, `expires_at` countdown,
  action buttons by status (cancel / **Pay now** when `accepted` / start / complete / review). Show the address + access
  instructions only when the API returns them, with a "🔒 revealed after confirmation" placeholder otherwise.
- **Razorpay:** load `checkout.js`, `POST /api/payments/order` → open Checkout with `key_id` and `order_id`, and on success
  `POST /api/payments/verify` → refetch the booking.
- **Owner** `/owner`: my listings (status, pause/resume, submit for review), incoming booking requests with
  Accept / Reject. Poll every 5s with react-query `refetchInterval` so the demo updates live.
- `/owner/chargers/new` and `/owner/chargers/:id/edit`: form plus a click-to-place pin on a map, and a weekly schedule editor.

### Step 4 (H7–H9) — Polish
- Loading skeletons, empty states, error toasts, 375 px mobile layout, favicon/logo, landing hero on `/` for logged-out users.
- Verify that every demo-story step in `docs/WORKFLOW.md` works without the console open.

### Step 5 (H9+) — Feature freeze. Fix bugs reported by P4 only.

## Definition of done
Every route works against the real API. The full driver flow and owner flow run without errors.
`npm run build` passes. Nothing outside your folders was changed.
