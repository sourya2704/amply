# Amply — Team Guide (Prototype)

The prototype is **built and working end to end**. What's left for the team is to run it, test it, polish it, and
win the pitch.

## Submission checklist
- [x] GitHub repo with README
- [x] Working prototype (backend, frontend, AI assistant, admin)
- [ ] Deployed link (optional, see below), or run it on a laptop at judging
- [ ] 2–3 min demo video, following [demo-script.md](demo-script.md)
- [ ] Pitch deck, built from [../pitch/pitch-outline.md](../pitch/pitch-outline.md)

## Run it (one laptop, one command after the build)
```bash
cd frontend && npm install && npm run build      # builds the web app into frontend/dist
cd ../backend && go run . -reset                  # serves API + web app on http://localhost:8000, fresh demo data
```
Teammates on the same Wi-Fi can open `http://<that-laptop-IP>:8000`.

**Turn on the real AI:** put `ANTHROPIC_API_KEY=...` in `backend/.env` (copy `.env.example`; never commit it) and
restart. Without a key the assistant runs in a clearly labelled offline mode that uses the same tools, so the demo
still works if the key or Wi-Fi fails.

**Frontend dev with hot reload:** keep the backend running, then `cd frontend && npm run dev` → http://localhost:5173.

**Tests:** `cd backend && go test ./...` covers the booking loop, 10 simultaneous bookings for one slot (exactly one
wins), the AI booking only after confirm, owner listing → admin approval, risk flags, and reports.

## What's in the box

| Area | Where | What it does |
|---|---|---|
| API + DB | `backend/*.go`, SQLite | Search with compatibility filter, honest availability, slots, pricing, booking state machine, mock payment, owner listings, admin review, reports, risk flags |
| AI assistant | `backend/agent.go`, `frontend/src/components/AgentPanel.tsx` | Claude tool use over our own API, tool trace, charger cards, Confirm card. Offline fallback |
| Web app | `frontend/src` | Login picker, map search, charger page + slot booking, bookings + timeline, owner dashboard + "list a charger", admin trust & safety |
| Demo data | `backend/seed/*.json` | 25 Bengaluru chargers with planted demo cases (see demo script) |

## Splitting the remaining work (suggested)
| Person | Now |
|---|---|
| Shourya | Keep the server running for everyone; deploy if wanted; final bug fixes |
| Frontend teammate | Click through every screen on laptop + phone width, fix any visual issues |
| AI teammate | Add the API key, run the AI prompts in the demo script, tune `systemPrompt()` in `backend/agent.go` if needed |
| Product teammate | Rehearse the demo script, build the deck from the outline, record the video |

Work on branches (`fix/...`), merge to `main` often, never commit `.env`.

## Optional: deploy
Any host that runs Go works (Render, Railway, Fly.io). Build command:
`cd frontend && npm ci && npm run build && cd ../backend && go build -o amply .`. Start command:
`cd backend && ./amply -reset`. Set `AUTH_SECRET` and optionally `ANTHROPIC_API_KEY` as environment variables.
`-reset` reloads the demo data on every start, which is what you want for a demo.
