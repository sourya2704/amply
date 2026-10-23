# Amply — Hackathon Team Workflow

**Goal for tonight:** one polished end-to-end demo, not the whole PRD.

> **Demo story:** Driver (Tata Nexon EV, CCS2) asks the AI *"Find a compatible charger near Koramangala under
> ₹20/kWh and book it for 6 PM"* → AI searches real backend data, filters incompatible chargers, explains its
> ranking, asks **Confirm?** → Owner accepts → Driver pays (Razorpay test) → session started/completed →
> Admin approves a new listing and reviews a risk flag.
>
> **Judge moments:** (1) two tabs book the same slot → one gets `SLOT_TAKEN`; (2) honest availability badges
> (Live / Schedule / Stale / Unknown); (3) the AI refuses incompatible chargers and can't book without your click.

---

## 1. Who does what

| | Person | Owns (only they edit these) | AI brief |
|---|---|---|---|
| **P1** | Shourya + Claude | `backend/` except `backend/app/agent/` and `backend/seed/`; `docs/api-contract.md` | `ai-briefs/P1-backend.md` |
| **P2** | Frontend dev | `frontend/` except `frontend/src/components/agent/`, `frontend/src/pages/trip/`, `frontend/src/pages/admin/` | `ai-briefs/P2-frontend.md` |
| **P3** | AI dev | `backend/app/agent/`, `frontend/src/components/agent/`, `frontend/src/pages/trip/` | `ai-briefs/P3-ai-agent.md` |
| **P4** | Product / admin / pitch | `backend/seed/`, `frontend/src/pages/admin/`, `docs/demo-script.md`, `docs/qa-checklist.md`, pitch deck | `ai-briefs/P4-product-admin.md` |

**Each person:** open your AI tool (Claude Code / Cursor / ChatGPT) in the repo, and give it your brief
**plus** `docs/api-contract.md` as the first message. For Claude Code, start with:
`Read docs/WORKFLOW.md, docs/api-contract.md and docs/ai-briefs/<your file>. That is your job. Start with step 1.`

**Rule for everyone's AI:** stay inside your owned folders, code only against the contract, never commit secrets.

---

## 2. Timeline (H0 = start time)

| Time | P1 Backend | P2 Frontend | P3 AI | P4 Product/Admin |
|---|---|---|---|---|
| **H0–H1** | Repo + DB (Supabase/Neon + PostGIS), schema, `.env`, FastAPI skeleton running | Vite scaffold, Tailwind, router, placeholder pages for P3/P4, `lib/api.ts`, `lib/types.ts`, mocks | Get Claude API key working, write system prompt + tool schemas | Write `seed/*.json` (30–40 chargers, Koramangala/HSR/Indiranagar), create Razorpay test account |
| **H1–H4** | Auth, vehicles, charger search (PostGIS + compatibility), detail, slots, estimate, seed loader | Login/register, map search page, charger detail + slot picker (on mocks) | Agent loop with tools calling the API (stub responses until P1 is ready), `/api/agent/chat` | Admin pages on mocks, demo script v1, pitch deck outline |
| **H4** ✅ | **Checkpoint 1:** deployed or LAN-reachable API, real search on the map. Everyone merges to `main`. | | | |
| **H4–H7** | Bookings + state machine + exclusion constraint, owner endpoints, payments, admin + risk scan | Booking flow, my bookings + timeline, owner dashboard, Razorpay checkout | AgentPanel UI, confirm flow, `/api/route` + trip page | Wire admin pages to real API, QA checklist, start testing flows |
| **H7** ✅ | **Checkpoint 2:** full loop works in the UI: search → book → accept → pay → complete. | | | |
| **H7–H9** | Bug fixes, audit logs, stats, expiry logic, deploy | Polish: loading/empty/error states, mobile width, brand colors | Prompt-injection test listing, guardrail tests, tool-trace UI | Run the QA checklist, file bugs to owners, finish deck |
| **H9** 🧊 | **Feature freeze.** Only bug fixes after this. | | | |
| **H9–H11** | Fix bugs, reset/reseed DB for demo | Fix bugs | Fix bugs, tune answers | Rehearse demo 3×, record **backup demo video** |
| **H11–H12** | Buffer | Buffer | Buffer | Final pitch run |

---

## 3. Git workflow

```
main                 ← always runnable. Never push broken code here.
be/<feature>         ← P1   (e.g. be/bookings)
fe/<feature>         ← P2   (e.g. fe/map-search)
ai/<feature>         ← P3   (e.g. ai/agent-loop)
pm/<feature>         ← P4   (e.g. pm/admin-pages)
```

1. `git checkout main && git pull` → `git checkout -b fe/map-search`
2. Commit small and often. Pull `main` every ~hour: `git pull --rebase origin main`
3. Push → open a PR → merge it yourself if it builds and only touches your folders. Shared-file changes need a 👍 from the owner.
4. **Merge at least every 2 hours.** No giant merges at H7.
5. Never commit `.env`. Share keys over DM only.

## 4. Running things

| What | Command | URL |
|---|---|---|
| Backend | `cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000` | http://localhost:8000/docs |
| Frontend | `cd frontend && npm run dev` | http://localhost:5173 |
| Use mocks | `VITE_USE_MOCKS=true` in `frontend/.env.local` | — |
| Use real API | `VITE_API_URL=http://<P1-laptop-LAN-IP>:8000` until deployed | — |

Everyone shares **one cloud Postgres**. Only P1 changes the schema or reseeds.

## 5. Communication (team group chat)

Prefix messages so they're easy to scan:
- `BLOCKED:` what you need, from whom
- `CONTRACT CHANGE:` see `docs/contract-changes.md`
- `MERGED:` what landed on `main`
- `BUG:` steps to reproduce → owner

Stand-up at each checkpoint (H4, H7, H9): 2 minutes each, covering what works, what's blocked, and what's next.

## 6. Definition of done (for the demo)
- [ ] Driver can log in, pick a vehicle, search on the map, and see compatibility + availability badges
- [ ] Driver books a slot; the second tab booking the same slot gets a clear "slot taken" error
- [ ] Owner accepts → driver pays in Razorpay test mode → status `confirmed`, address revealed
- [ ] Start → complete → review
- [ ] AI chat finds, explains, and books (with confirm) and refuses incompatible chargers
- [ ] Trip planner shows a route + suggested stops with stated assumptions
- [ ] Admin approves a submitted listing and resolves a risk case; audit log shows it
- [ ] Deployed URL + backup video ready
