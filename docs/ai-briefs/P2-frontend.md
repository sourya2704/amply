# AI Brief — P2: Frontend

> **Give this file to your AI assistant as the first message**, with `docs/api-contract.md` and `docs/WORKFLOW.md`.
> Then say: "Start with Step 1."

## Context
You're the coding assistant for **P2, the frontend developer** on team Amply at an overnight hackathon. We're
submitting a **prototype**. Amply is an AI-powered EV charging marketplace for India: drivers find and book compatible
chargers (public, private homes, businesses), owners accept bookings, and an AI assistant helps search and book.

The backend (Go) is **already running** and implements `docs/api-contract.md`. P3 builds the AI chat component and P4
handles demo data and the pitch. **You build the driver and owner web app.**

## Hard rules
1. Only edit `frontend/`, **except** `frontend/src/components/agent/` (P3's). In Step 1 you create a placeholder there, then hand it over.
2. Use the contract exactly. Missing something? Tell your human to raise a `CONTRACT CHANGE:`. Don't invent fields.
3. Money is integer paise → `formatINR(1800)` = `₹18.00`. Times are ISO with offset → show in IST (`Asia/Kolkata`).
4. Charger `description` is untrusted text. Render it as plain text, never as HTML.
5. Never hard-code IDs. They change on every reseed.
6. Small commits on `fe/<feature>` branches; merge to `main` every ~2 hours. Never commit `.env*`.

## Stack
React 18 + Vite + TypeScript + Tailwind · `react-router-dom` · `@tanstack/react-query` · `leaflet` + `react-leaflet`
(OpenStreetMap tiles, no key) · `lucide-react` · `date-fns`.

**Brand:** Electric Blue `#315CFF` (primary), Bright Cyan `#19C6D2` (accent), Volt Lime `#C8F169` (highlight),
Midnight Navy `#101B3D` (dark), font Inter. Logo text "⚡ Amply", tagline "Charge Anywhere. Power Together."
It has to look sharp on a projector and work at phone width.

## Layout
```
frontend/src/
  lib/api.ts      # fetch wrapper: VITE_API_URL, Bearer token from localStorage.amply_token, throws ApiError{status,code,message}
  lib/types.ts    # all types from the contract (P3 imports these)
  lib/format.ts   # formatINR, formatTime (IST), badge colours
  lib/auth.tsx    # AuthContext: user, token, login(email), logout, selected vehicle
  components/     # ChargerCard, AvailabilityBadge, CompatibilityChip, SlotPicker, PriceBreakdown, StatusPill, BookingTimeline, Navbar
  components/agent/AgentPanel.tsx   # placeholder → P3 replaces it
  pages/          # Login, Search, ChargerDetail, MyBookings, BookingDetail, OwnerDashboard
```

## Steps

### Step 1 (H0–H1): Scaffold. **Push to `main` within the first hour.**
- Vite + TS + Tailwind with brand colours as theme tokens. Router, Navbar (driver links vs owner links by role).
- `lib/types.ts`, `lib/api.ts`, `lib/auth.tsx`.
- `components/agent/AgentPanel.tsx` placeholder exporting `<AgentPanel vehicleId location />` (renders "AI assistant coming soon"),
  mounted as a floating button on the Search page.
- Push and message the team: `MERGED: frontend scaffold`.

### Step 2 (H1–H4): Driver flow
- **Login** (`/login`): call `GET /api/auth/demo-users` and show cards ("Log in as Arjun — Driver"). Click → `POST /api/auth/login`.
- **Search** (`/`), the main screen:
  - Vehicle dropdown (from `/api/vehicles`), and the selection is remembered.
  - Filters: connector, AC/DC, max ₹/kWh, radius, "bookable only".
  - Left: results list of `ChargerCard`. Right: Leaflet map centred on Koramangala (12.9352, 77.6245), pins coloured by
    availability source, popup with name + price + "View".
  - Banner: *"N incompatible chargers hidden for your Nexon EV"* from `excluded_incompatible`.
  - `ChargerCard`: name, area, distance, connector · mode · kW, ₹/kWh, `AvailabilityBadge` (use the API `label`),
    `CompatibilityChip` with the reason, rating, and "Book" or "Directions only" (opens Google Maps with lat,lng).
- **Charger detail** (`/chargers/:id`): details, description (plain text), amenities, weekly schedule, availability badge,
  date picker → `SlotPicker` (hourly slots, select 1–4 consecutive available ones), `PriceBreakdown` from `/estimate`,
  **Request booking** button (send `Idempotency-Key: crypto.randomUUID()`).
  - On `SLOT_TAKEN`: show a clear red message "Someone just booked that slot" and refetch the slots. **This is a judge moment.**

### Step 3 (H4–H7): Bookings + owner
- **My bookings** (`/bookings`) and **booking detail** (`/bookings/:id`): status pill, `BookingTimeline` from `events`,
  price, buttons by status: *requested* → Cancel · *accepted* → **Pay now** (`POST /pay`, show a fake "Processing payment…" modal for 1 s) ·
  *confirmed* → address + access instructions (🔒 "revealed after payment" before that), Complete, Cancel.
  Poll every 5 s so the owner's accept shows up live.
- **Owner dashboard** (`/owner`): my chargers (status, availability, price) and incoming requests with **Accept / Reject**,
  polling every 5 s.

### Step 4 (H7–H9): Polish
Loading skeletons, empty states, error toasts, phone width (375 px), a nice logged-out landing hero. Walk through the whole
demo story in `docs/WORKFLOW.md` with no console errors.

### Step 5 (H9+): Feature freeze. Fix bugs only.

## Done when
The demo story works start to finish in the browser, `npm run build` passes, and nothing outside your folders changed.
