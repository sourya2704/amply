# Amply — Hackathon Workflow (Prototype)

**We are submitting a prototype:** one convincing, working flow, not the full PRD. Fake the hard parts (payments, login,
real charger data). Make the core idea work for real.

> **Demo story:** Driver (Tata Nexon EV) asks the AI *"Find a compatible charger near Koramangala under ₹20/kWh and
> book it for 6 PM"* → the AI searches real backend data, hides incompatible chargers, explains its pick, and shows a
> **Confirm** card → owner accepts on their dashboard → driver pays (mock) → address revealed → session completed.
>
> **Judge moments:** (1) two drivers book the same slot → one gets "slot taken"; (2) honest badges
> (Live / Schedule / Reported / Stale / Unknown); (3) the AI hides incompatible chargers, ignores a malicious listing,
> and can't book without your click.

## Submission checklist
- [ ] GitHub repo with README ✅
- [ ] Working prototype (live link or run locally at judging)
- [ ] 2–3 min demo video (also our backup if the Wi-Fi dies)
- [ ] Pitch deck (6–7 slides)

---

## 1. Who does what

| | Person | Owns (only they edit these) | Brief for their AI |
|---|---|---|---|
| **P1** | Shourya | `backend/` except `backend/seed/` · `docs/api-contract.md` | `ai-briefs/P1-backend.md` |
| **P2** | Frontend | `frontend/` except `frontend/src/components/agent/` | `ai-briefs/P2-frontend.md` |
| **P3** | AI | `agent/` (Python service) · `frontend/src/components/agent/` | `ai-briefs/P3-ai-agent.md` |
| **P4** | Product | `backend/seed/` · `docs/demo-script.md` · `pitch/` · demo video | `ai-briefs/P4-product-pitch.md` |

**Start your AI with:** `Read docs/WORKFLOW.md, docs/api-contract.md and docs/ai-briefs/<your file>. Start with step 1.`

## 2. Architecture

```
React app (P2, :5173) ──▶ Go API (P1, :8000) ──▶ SQLite file
                               │
                               └─ /api/agent/* ──▶ Python agent (P3, :8001) ──▶ Claude API
                                                         │
                                                         └─ calls the Go API back with the user's token
```
The frontend only knows **one URL** (the Go API). The agent never touches the database. It uses the same API
the frontend does, so it gets exactly the user's permissions.

## 3. Timeline (H0 = start)

| Time | P1 Backend | P2 Frontend | P3 AI | P4 Product |
|---|---|---|---|---|
| **H0–H1** | ✅ API done + tested. Share LAN URL | Scaffold, router, api client, login picker | Agent service skeleton, Claude key working | Expand seed data, outline deck |
| **H1–H4** | Support team, fix contract gaps, deploy | Map search + charger detail + slot booking | Tools + loop + `/chat` + `/confirm` | Demo script, deck draft |
| **H4** ✅ | **Checkpoint 1:** booking works from the UI. Agent answers a search question. | | | |
| **H4–H7** | Bugs, deploy | My bookings, owner dashboard, mock pay | Chat panel UI + confirm card, guardrail tests | Test every flow, report bugs |
| **H7** ✅ | **Checkpoint 2:** the full demo story works end to end. | | | |
| **H7–H9** | Deploy + reseed | Polish (brand, mobile, empty states) | Prompt tuning | Rehearse, finish deck |
| **H9** 🧊 | **Feature freeze.** Bug fixes only. | | | |
| **H9–H12** | Reseed DB before judging | Bugs | Bugs | **Record the demo video**, final rehearsal |

## 4. Git
- `main` must always run. Work on `be/…`, `fe/…`, `ai/…`, `pm/…` branches; merge at least every 2 hours.
- `git pull --rebase origin main` every hour. Never commit `.env`; share keys by DM.

## 5. Running locally

| What | Command | URL |
|---|---|---|
| Backend | `cd backend && go run .` (first run seeds; `go run . -reset` reseeds) | http://localhost:8000/api/health |
| Agent | `cd agent && uvicorn main:app --port 8001 --reload` | via http://localhost:8000/api/agent/chat |
| Frontend | `cd frontend && npm run dev` | http://localhost:5173 |

Teammates who aren't running the backend can point `VITE_API_URL` at `http://<P1-laptop-LAN-IP>:8000`
(same Wi-Fi), or at the deployed URL.

## 6. Chat prefixes
`BLOCKED:` · `CONTRACT CHANGE:` · `MERGED:` · `BUG:` (with steps to reproduce, sent to the owner)
