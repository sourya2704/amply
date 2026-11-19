package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Tests need Postgres + PostGIS:  docker compose up -d db
//   TEST_DATABASE_URL=postgres://amply:amply@localhost:5434/amply_test?sslmode=disable go test ./...

func TestMain(m *testing.M) {
	bcryptCost = bcrypt.MinCost
	os.Exit(m.Run())
}

// fixedNow is a Monday morning in IST so seed schedules (weekday 0) apply.
var fixedNow = time.Date(2026, 10, 26, 8, 0, 0, 0, IST)

type testEnv struct {
	srv   *httptest.Server
	app   *App
	clock time.Time
}

func newTestApp(t *testing.T) *testEnv {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set (see top of api_test.go)")
	}
	db, err := openDB(url)
	if err != nil {
		t.Fatal(err)
	}
	if err := resetDB(db); err != nil {
		t.Fatal(err)
	}
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	if err := seed(db, "seed"); err != nil {
		t.Fatal(err)
	}
	env := &testEnv{clock: fixedNow}
	env.app = &App{db: db, now: func() time.Time { return env.clock }, rzp: newRazorpay("", ""), authLimiter: newRateLimiter(10), geo: newGeocoder(""),
		cfg: Config{AuthSecret: "test", CORSOrigins: "*", StaticDir: t.TempDir(), DemoMode: true}}
	env.srv = httptest.NewServer(env.app.routes())
	t.Cleanup(func() { env.srv.Close(); db.Close() })
	return env
}

func (e *testEnv) call(t *testing.T, method, path, token string, body any, out any) int {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, &buf)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if m, ok := body.(map[string]any); ok {
		if k, ok := m["_idem"].(string); ok {
			req.Header.Set("Idempotency-Key", k)
		}
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if out != nil {
		json.NewDecoder(res.Body).Decode(out)
	}
	return res.StatusCode
}

func (e *testEnv) login(t *testing.T, email string) string {
	t.Helper()
	var res struct {
		AccessToken string `json:"access_token"`
	}
	if code := e.call(t, "POST", "/api/auth/login", "", map[string]any{"email": email, "password": "demo1234"}, &res); code != 200 {
		t.Fatalf("login %s: %d", email, code)
	}
	return res.AccessToken
}

func (e *testEnv) vehicleID(t *testing.T, token, model string) string {
	t.Helper()
	var vs []Vehicle
	e.call(t, "GET", "/api/vehicles", token, nil, &vs)
	for _, v := range vs {
		if v.Model == model {
			return v.ID
		}
	}
	t.Fatalf("vehicle %s not found", model)
	return ""
}

func (e *testEnv) chargerID(t *testing.T, token, name string) string {
	t.Helper()
	var res struct{ Results []ChargerSummary }
	e.call(t, "GET", "/api/chargers/search?lat=12.9352&lng=77.6245&radius_km=20", token, nil, &res)
	for _, c := range res.Results {
		if c.Name == name {
			return c.ID
		}
	}
	t.Fatalf("charger %s not found", name)
	return ""
}

// book creates a 1-hour booking starting at the given IST hour on fixedNow's day.
func (e *testEnv) book(t *testing.T, token, chargerID, vehicleID string, hour int) (int, Booking) {
	t.Helper()
	start := time.Date(2026, 10, 26, hour, 0, 0, 0, IST)
	var b Booking
	code := e.call(t, "POST", "/api/bookings", token, map[string]any{"charger_id": chargerID, "vehicle_id": vehicleID,
		"start_at": start.Format(time.RFC3339), "end_at": start.Add(time.Hour).Format(time.RFC3339), "estimated_kwh": 20,
		"_idem": fmt.Sprint("k-", chargerID, hour, token[:8])}, &b)
	return code, b
}

func (e *testEnv) pay(t *testing.T, token, bookingID string) (int, Booking) {
	t.Helper()
	var order map[string]any
	if code := e.call(t, "POST", "/api/payments/order", token, map[string]any{"booking_id": bookingID}, &order); code != 200 {
		t.Fatalf("payment order: %d %v", code, order)
	}
	var b Booking
	code := e.call(t, "POST", "/api/payments/verify", token, map[string]any{"booking_id": bookingID, "razorpay_order_id": order["order_id"]}, &b)
	return code, b
}

type apiErr struct{ Error apiError }

func TestAuth(t *testing.T) {
	e := newTestApp(t)
	var reg struct {
		AccessToken string `json:"access_token"`
		User        User
	}
	body := map[string]any{"name": "Kiran", "email": "Kiran@Example.com", "password": "longpassword", "roles": []string{"driver", "admin"}}
	if code := e.call(t, "POST", "/api/auth/register", "", body, &reg); code != 201 {
		t.Fatalf("register: %d", code)
	}
	if reg.User.Has("admin") || !reg.User.Has("driver") || reg.User.Email != "kiran@example.com" {
		t.Fatalf("register must not grant admin and must normalise email: %+v", reg.User)
	}
	if code := e.call(t, "POST", "/api/auth/register", "", body, nil); code != 409 {
		t.Errorf("duplicate email: %d", code)
	}
	if code := e.call(t, "POST", "/api/auth/register", "", map[string]any{"name": "X", "email": "x@y.z", "password": "short", "roles": []string{"driver"}}, nil); code != 422 {
		t.Errorf("short password: %d", code)
	}
	if code := e.call(t, "POST", "/api/auth/login", "", map[string]any{"email": "driver@amply.test", "password": "wrong-password"}, nil); code != 401 {
		t.Errorf("wrong password: %d", code)
	}
	if code := e.call(t, "GET", "/api/me", "bad.token", nil, nil); code != 401 {
		t.Errorf("forged token: %d", code)
	}
	e.clock = fixedNow.Add(8 * 24 * time.Hour)
	if code := e.call(t, "GET", "/api/me", reg.AccessToken, nil, nil); code != 401 {
		t.Errorf("expired token accepted: %d", code)
	}
	var demo []User
	e.call(t, "GET", "/api/auth/demo-users", "", nil, &demo)
	if len(demo) != 6 || slices.ContainsFunc(demo, func(u User) bool { return !strings.HasSuffix(u.Email, "@amply.test") }) {
		t.Errorf("demo users should list only seeded accounts: %d", len(demo))
	}
	limited := 0
	for range 12 {
		if e.call(t, "POST", "/api/auth/login", "", map[string]any{"email": "nobody@x.com", "password": "nope-nope"}, nil) == 429 {
			limited++
		}
	}
	if limited == 0 {
		t.Error("login is not rate limited")
	}
}

func TestBookingLoopPaymentRefundPayoutReview(t *testing.T) {
	e := newTestApp(t)
	driver, driver2, owner := e.login(t, "driver@amply.test"), e.login(t, "driver2@amply.test"), e.login(t, "owner@amply.test")
	nexon, comet := e.vehicleID(t, driver, "Nexon EV"), e.vehicleID(t, driver, "Comet EV")

	var search struct {
		Results  []ChargerSummary `json:"results"`
		Excluded int              `json:"excluded_incompatible"`
	}
	e.call(t, "GET", "/api/chargers/search?lat=12.9352&lng=77.6245&radius_km=5&vehicle_id="+nexon, driver, nil, &search)
	if search.Excluded != 3 {
		t.Errorf("excluded_incompatible = %d, want 3 (CHAdeMO + 2 GB/T)", search.Excluded)
	}
	for i, c := range search.Results {
		if c.Compatibility != "compatible" || c.Name == "Ravi's Second Charger (pending review)" {
			t.Errorf("bad search result %s (%s)", c.Name, c.Compatibility)
		}
		if i > 0 && *c.DistanceKM < *search.Results[i-1].DistanceKM {
			t.Error("results not sorted by distance")
		}
	}
	ravi := e.chargerID(t, driver, "Ravi's Home Fast Charger")

	var errBody apiErr
	if code, _ := e.book(t, driver, ravi, comet, 18); code != 422 {
		t.Fatalf("AC-only Comet booked a DC charger: %d", code)
	}
	code, b := e.book(t, driver, ravi, nexon, 18)
	if code != 201 || b.Status != "requested" || b.ExpiresAt == nil || b.Address != nil {
		t.Fatalf("create booking: %d %+v", code, b)
	}
	if code, again := e.book(t, driver, ravi, nexon, 18); code != 200 || again.ID != b.ID {
		t.Error("idempotency key created a second booking")
	}
	punch := e.vehicleID(t, driver2, "Punch EV")
	if code := e.call(t, "POST", "/api/bookings", driver2, map[string]any{"charger_id": ravi, "vehicle_id": punch,
		"start_at": b.StartAt, "end_at": b.EndAt}, &errBody); code != 409 || errBody.Error.Code != "SLOT_TAKEN" {
		t.Fatalf("double booking: %d %+v", code, errBody)
	}

	if code := e.call(t, "POST", "/api/payments/order", driver, map[string]any{"booking_id": b.ID}, nil); code != 409 {
		t.Errorf("payment before acceptance: %d", code)
	}
	if code := e.call(t, "POST", "/api/bookings/"+b.ID+"/accept", driver, nil, nil); code != 403 {
		t.Errorf("driver accepted own booking: %d", code)
	}
	e.call(t, "POST", "/api/bookings/"+b.ID+"/accept", owner, nil, &b)
	if b.Status != "accepted" {
		t.Fatalf("accept: %+v", b)
	}
	code, b = e.pay(t, driver, b.ID)
	if code != 200 || b.Status != "confirmed" || b.PaymentStatus != "paid" || b.Address == nil {
		t.Fatalf("pay: %d %+v", code, b)
	}

	// Cancelling a paid booking refunds it and frees the slot.
	e.call(t, "POST", "/api/bookings/"+b.ID+"/cancel", driver, map[string]any{"reason": "plans changed"}, &b)
	if b.Status != "cancelled" || b.PaymentStatus != "refunded" {
		t.Fatalf("cancel+refund: %+v", b)
	}
	if code, _ := e.book(t, driver2, ravi, punch, 18); code != 201 {
		t.Fatalf("slot not released after cancel: %d", code)
	}

	// Full happy path on another slot: accept → pay → start → complete → payout → review.
	_, b2 := e.book(t, driver, ravi, nexon, 10)
	e.call(t, "POST", "/api/bookings/"+b2.ID+"/accept", owner, nil, nil)
	e.pay(t, driver, b2.ID)
	if code := e.call(t, "POST", "/api/bookings/"+b2.ID+"/start", driver, nil, nil); code != 409 {
		t.Errorf("started 2h early: %d", code)
	}
	e.clock = time.Date(2026, 10, 26, 10, 0, 0, 0, IST)
	e.call(t, "POST", "/api/bookings/"+b2.ID+"/start", owner, nil, &b2)
	e.call(t, "POST", "/api/bookings/"+b2.ID+"/complete", driver, nil, &b2)
	if b2.Status != "completed" || len(b2.Events) != 5 {
		t.Fatalf("complete: status=%s events=%d", b2.Status, len(b2.Events))
	}
	var payouts []map[string]any
	e.call(t, "GET", "/api/owner/payouts", owner, nil, &payouts)
	if len(payouts) != 1 || payouts[0]["amount_paise"].(float64) != 36000 {
		t.Fatalf("payout: %+v", payouts)
	}
	if code := e.call(t, "POST", "/api/bookings/"+b2.ID+"/review", driver, map[string]any{"rating": 5, "comment": "Great"}, nil); code != 204 {
		t.Fatalf("review: %d", code)
	}
	if code := e.call(t, "POST", "/api/bookings/"+b2.ID+"/review", driver, map[string]any{"rating": 1}, nil); code != 409 {
		t.Errorf("second review: %d", code)
	}
	var detail ChargerDetail
	e.call(t, "GET", "/api/chargers/"+ravi, driver, nil, &detail)
	if detail.ReviewCount != 19 || detail.Address == nil {
		t.Errorf("review count %d, address revealed to past customer: %v", detail.ReviewCount, detail.Address != nil)
	}

	var notes struct {
		Unread int
		Items  []Notification
	}
	e.call(t, "GET", "/api/notifications", owner, nil, &notes)
	if notes.Unread < 4 {
		t.Errorf("owner notifications = %d", notes.Unread)
	}
	e.call(t, "POST", "/api/notifications/read", owner, nil, nil)
	e.call(t, "GET", "/api/notifications", owner, nil, &notes)
	if notes.Unread != 0 {
		t.Error("mark read failed")
	}
	if code := e.call(t, "GET", "/api/bookings/"+b2.ID, driver2, nil, nil); code != 404 {
		t.Errorf("other driver read booking: %d", code)
	}
}

func TestExpiryReleasesSlot(t *testing.T) {
	e := newTestApp(t)
	driver, driver2 := e.login(t, "driver@amply.test"), e.login(t, "driver2@amply.test")
	ravi := e.chargerID(t, driver, "Ravi's Home Fast Charger")
	_, b := e.book(t, driver, ravi, e.vehicleID(t, driver, "Nexon EV"), 19)
	e.clock = fixedNow.Add(holdTimeout + time.Minute)
	e.call(t, "GET", "/api/bookings/"+b.ID, driver, nil, &b)
	if b.Status != "expired" {
		t.Fatalf("status = %s, want expired", b.Status)
	}
	if code, _ := e.book(t, driver2, ravi, e.vehicleID(t, driver2, "Punch EV"), 19); code != 201 {
		t.Fatalf("expired hold still blocks the slot: %d", code)
	}
}

func TestConcurrentBookingsOnlyOneWins(t *testing.T) {
	e := newTestApp(t)
	driver := e.login(t, "driver@amply.test")
	nexon := e.vehicleID(t, driver, "Nexon EV")
	cafe := e.chargerID(t, driver, "Brew & Charge Café")
	start := time.Date(2026, 10, 26, 19, 0, 0, 0, IST)
	var wg sync.WaitGroup
	codes := make(chan int, 20)
	for i := range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			body := map[string]any{"charger_id": cafe, "vehicle_id": nexon, "_idem": fmt.Sprint("k", i),
				"start_at": start.Add(time.Duration(i%2) * time.Hour).Format(time.RFC3339), "end_at": start.Add(2 * time.Hour).Format(time.RFC3339)}
			codes <- e.call(t, "POST", "/api/bookings", driver, body, nil)
		}()
	}
	wg.Wait()
	close(codes)
	won := 0
	for c := range codes {
		if c == 201 {
			won++
		} else if c != 409 {
			t.Errorf("unexpected status %d", c)
		}
	}
	if won != 1 {
		t.Fatalf("%d overlapping bookings succeeded, want exactly 1", won)
	}
}

// Offline assistant (no API key): finds, explains, prepares, and books only after confirm.
func TestAgentOfflineBooksOnlyAfterConfirm(t *testing.T) {
	e := newTestApp(t)
	driver := e.login(t, "driver@amply.test")
	nexon := e.vehicleID(t, driver, "Nexon EV")
	chat := func(msg, vid string) agentResponse {
		var r agentResponse
		body := map[string]any{"messages": []map[string]string{{"role": "user", "content": msg}}, "vehicle_id": vid}
		if code := e.call(t, "POST", "/api/agent/chat", driver, body, &r); code != 200 {
			t.Fatalf("chat: %d", code)
		}
		return r
	}
	if r := chat("find a charger near koramangala", ""); r.PendingAction != nil || len(r.Cards) != 0 {
		t.Fatalf("without a vehicle the assistant should ask first: %+v", r)
	}
	r := chat("Find a compatible charger near Koramangala under ₹20/kWh and book it for 6 PM", nexon)
	if r.Mode != "offline" || r.PendingAction == nil {
		t.Fatalf("expected a pending booking: %+v", r)
	}
	for _, c := range r.Cards {
		if c.Compatibility != "compatible" || c.PricePerKWhPaise > 2000 {
			t.Errorf("bad card %s", c.Name)
		}
	}
	var mine []Booking
	e.call(t, "GET", "/api/bookings", driver, nil, &mine)
	if len(mine) != 0 {
		t.Fatal("assistant booked without confirmation")
	}
	other := e.login(t, "driver2@amply.test")
	if code := e.call(t, "POST", "/api/agent/confirm", other, map[string]any{"confirmation_id": r.PendingAction.ConfirmationID}, nil); code != 404 {
		t.Errorf("another user confirmed my booking: %d", code)
	}
	var b Booking
	if code := e.call(t, "POST", "/api/agent/confirm", driver, map[string]any{"confirmation_id": r.PendingAction.ConfirmationID}, &b); code != 201 {
		t.Fatalf("confirm: %d", code)
	}
	if b.Status != "requested" || b.StartAt[11:16] != "18:00" || b.Charger.Name != "Ravi's Home Fast Charger" {
		t.Fatalf("booking: %+v", b)
	}
}

func TestOwnerListingLifecycleAdminAndRisk(t *testing.T) {
	e := newTestApp(t)
	owner, admin, driver := e.login(t, "owner2@amply.test"), e.login(t, "admin@amply.test"), e.login(t, "driver@amply.test")

	listing := map[string]any{"name": "Test Garage Charger", "category": "private", "lat": 12.93, "lng": 77.62,
		"address": "secret", "approx_area": "Koramangala", "connector": "CCS2", "mode": "DC", "power_kw": 25,
		"price_per_kwh_paise": 1600, "schedule": []map[string]any{{"weekdays": []int{0, 1, 2, 3, 4, 5, 6}, "start_time": "08:00", "end_time": "20:00"}}}
	if code := e.call(t, "POST", "/api/owner/chargers", driver, listing, nil); code != 403 {
		t.Errorf("driver listed a charger: %d", code)
	}
	var created ChargerDetail
	if code := e.call(t, "POST", "/api/owner/chargers", owner, listing, &created); code != 201 || created.Status != "submitted" {
		t.Fatalf("create listing: %d %+v", code, created)
	}
	if code := e.call(t, "GET", "/api/admin/chargers", driver, nil, nil); code != 403 {
		t.Errorf("driver reached admin: %d", code)
	}
	var queue []ChargerDetail
	e.call(t, "GET", "/api/admin/chargers?status=submitted", admin, nil, &queue)
	if len(queue) != 3 {
		t.Errorf("review queue = %d, want 3", len(queue))
	}
	var approved ChargerDetail
	e.call(t, "POST", "/api/admin/chargers/"+created.ID+"/approve", admin, map[string]any{"note": "ok"}, &approved)
	if approved.Status != "approved" {
		t.Fatalf("approve: %+v", approved)
	}
	if code := e.call(t, "POST", "/api/admin/chargers/"+created.ID+"/approve", admin, nil, nil); code != 409 {
		t.Errorf("double approve: %d", code)
	}
	inSearch := func() bool {
		var res struct{ Results []ChargerSummary }
		e.call(t, "GET", "/api/chargers/search?lat=12.93&lng=77.62&radius_km=1", driver, nil, &res)
		return slices.ContainsFunc(res.Results, func(c ChargerSummary) bool { return c.ID == created.ID })
	}
	if !inSearch() {
		t.Fatal("approved listing not searchable")
	}
	e.call(t, "POST", "/api/owner/chargers/"+created.ID+"/pause", owner, nil, nil)
	if inSearch() {
		t.Error("paused listing still searchable")
	}
	e.call(t, "POST", "/api/owner/chargers/"+created.ID+"/resume", owner, nil, nil)
	var edited ChargerDetail
	e.call(t, "PATCH", "/api/owner/chargers/"+created.ID, owner, map[string]any{"price_per_kwh_paise": 1500}, &edited)
	if !inSearch() || edited.PricePerKWhPaise != 1500 {
		t.Errorf("resume/edit failed: %d", edited.PricePerKWhPaise)
	}
	if code := e.call(t, "PATCH", "/api/owner/chargers/"+created.ID, driver, map[string]any{"price_per_kwh_paise": 1}, nil); code != 404 {
		t.Errorf("non-owner edited listing: %d", code)
	}

	for range 2 {
		e.call(t, "POST", "/api/reports", driver, map[string]any{"target_type": "charger", "target_id": created.ID, "reason": "Charger was broken"}, nil)
	}
	var flags []RiskFlag
	e.call(t, "GET", "/api/admin/risk", admin, nil, &flags)
	labels := map[string]string{}
	for _, f := range flags {
		labels[f.TargetLabel] = strings.Join(f.Signals, " | ")
	}
	for _, want := range []string{"Test Garage Charger", "Bellandur Premium DC", "Koramangala Home DC Listing"} {
		if labels[want] == "" {
			t.Errorf("missing risk flag for %s; got %v", want, labels)
		}
	}
	var reports []Report
	e.call(t, "GET", "/api/admin/reports", admin, nil, &reports)
	if len(reports) != 2 {
		t.Fatalf("reports = %d", len(reports))
	}
	if code := e.call(t, "POST", "/api/admin/reports/"+reports[0].ID+"/resolve", admin, map[string]any{"resolution": "Owner fixed it"}, nil); code != 204 {
		t.Errorf("resolve: %d", code)
	}
	var audit []AuditEntry
	e.call(t, "GET", "/api/admin/audit-logs", admin, nil, &audit)
	actions := map[string]bool{}
	for _, a := range audit {
		actions[a.Action] = true
	}
	for _, want := range []string{"listing.submitted", "listing.approved", "listing.paused", "listing.updated", "case.opened", "case.resolved"} {
		if !actions[want] {
			t.Errorf("audit log missing %s", want)
		}
	}
}

func TestSupportCaseAndRoute(t *testing.T) {
	e := newTestApp(t)
	driver, admin := e.login(t, "driver@amply.test"), e.login(t, "admin@amply.test")
	nexon := e.vehicleID(t, driver, "Nexon EV")
	_, b := e.book(t, driver, e.chargerID(t, driver, "Ravi's Home Fast Charger"), nexon, 15)
	if code := e.call(t, "POST", "/api/bookings/"+b.ID+"/support", driver, map[string]any{"category": "access_issue", "description": "Gate was locked"}, nil); code != 201 {
		t.Fatalf("support case: %d", code)
	}
	var reports []Report
	e.call(t, "GET", "/api/admin/reports", admin, nil, &reports)
	if len(reports) != 1 || reports[0].Category != "access_issue" || !strings.HasPrefix(reports[0].TargetLabel, "Booking at") {
		t.Fatalf("admin case list: %+v", reports)
	}

	// Routing server disabled in tests → labelled straight-line estimate; stops come from PostGIS.
	var plan RoutePlan
	q := "from_lat=12.9352&from_lng=77.6245&to_lat=12.9116&to_lng=77.6389&battery_pct=1&vehicle_id=" + nexon
	if code := e.call(t, "GET", "/api/route?"+q, driver, nil, &plan); code != 200 {
		t.Fatalf("route: %d", code)
	}
	if plan.Source != "estimate" || plan.EstimatedRangeKM == nil || plan.NeedsCharge == nil || !*plan.NeedsCharge || len(plan.SuggestedStops) == 0 {
		t.Fatalf("route plan: %+v", plan)
	}
	// Address search falls back to the pilot areas when the geocoder is unavailable.
	var geo struct {
		Results []Place
		Source  string
	}
	e.call(t, "GET", "/api/geocode?q=kora", driver, nil, &geo)
	if geo.Source != "local" || len(geo.Results) != 1 || geo.Results[0].Name != "Koramangala" {
		t.Errorf("geocode fallback: %+v", geo)
	}
	for _, s := range plan.SuggestedStops {
		if s.Compatibility == "incompatible" {
			t.Errorf("incompatible stop %s", s.Name)
		}
	}
}
