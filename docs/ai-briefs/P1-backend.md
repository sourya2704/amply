# AI Brief — P1: Backend (Go)

Read `docs/WORKFLOW.md` and `docs/api-contract.md` first. P1 owns the contract and implements it exactly.

## Owned
`backend/` except `backend/seed/` (P4 edits seed JSON; P1 reloads it).

## Stack
Go 1.26, standard library `net/http` (method + path patterns), SQLite via `modernc.org/sqlite` (pure Go, no cgo),
`github.com/google/uuid`. Single `package main`. No framework, no ORM.

## Files
| File | What |
|---|---|
| `main.go` | config from env/`.env`, `-reset` flag, startup seed |
| `db.go` | schema, seed loader for `seed/*.json` |
| `logic.go` | availability labels, compatibility, pricing, distance, slots, state machine. **Pure functions** |
| `models.go` | API JSON shapes + DB row loading |
| `http.go` | routes, demo auth (HMAC-signed token), agent reverse proxy, CORS, logging |
| `handlers.go` | endpoint handlers |
| `api_test.go` | end-to-end tests: booking loop, double booking under concurrency, agent proxy down |

## Rules
- Money in integer paise; times stored as unix seconds, returned as RFC 3339 in IST.
- `db.SetMaxOpenConns(1)` serializes writes, so the overlap check + insert in `createBooking` is race-free.
  Inside a transaction, only use `tx`, never `a.db` (that would deadlock on the single connection).
- State changes use a conditional `UPDATE … WHERE status IN (...)` and always write a `booking_events` row.
- Address and access instructions are only returned for confirmed/completed bookings or to the owner.
- Run `go vet ./... && go test ./...` before every merge.

## Status / next
- [x] Full prototype API per contract, tested
- [ ] Deploy (Render/Railway/Fly: `go build`, persistent disk for the `.db` file or reseed on boot)
- [ ] Stretch: `GET /api/admin/chargers?status=submitted` + approve (only if time allows)
