package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

// fixedNow is a Monday morning in IST so seed schedules (weekday 0) apply.
var fixedNow = time.Date(2026, 10, 26, 8, 0, 0, 0, IST)

func newTestApp(t *testing.T) *httptest.Server {
	t.Helper()
	db, err := openDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	if err := seed(db, "seed"); err != nil {
		t.Fatal(err)
	}
	app := &App{db: db, cfg: Config{AuthSecret: "test", CORSOrigins: "*", StaticDir: t.TempDir()}, now: func() time.Time { return fixedNow }}
	srv := httptest.NewServer(app.routes())
	t.Cleanup(func() { srv.Close(); db.Close() })
	return srv
}

func call(t *testing.T, srv *httptest.Server, method, path, token string, body any, out any) int {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, srv.URL+path, &buf)
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

func login(t *testing.T, srv *httptest.Server, email string) string {
	var res struct {
		AccessToken string `json:"access_token"`
	}
	if code := call(t, srv, "POST", "/api/auth/login", "", map[string]any{"email": email}, &res); code != 200 {
		t.Fatalf("login %s: %d", email, code)
	}
	return res.AccessToken
}

func TestBookingLoop(t *testing.T) {
	srv := newTestApp(t)
	driver, driver2, owner := login(t, srv, "driver@amply.test"), login(t, srv, "driver2@amply.test"), login(t, srv, "owner@amply.test")

	if code := call(t, srv, "GET", "/api/me", "bad.token", nil, nil); code != 401 {
		t.Fatalf("forged token accepted: %d", code)
	}

	var vehicles []Vehicle
	call(t, srv, "GET", "/api/vehicles", driver, nil, &vehicles)
	var nexon, comet Vehicle
	for _, v := range vehicles {
		if v.Model == "Nexon EV" {
			nexon = v
		} else {
			comet = v
		}
	}

	// Search near Koramangala with the Nexon: CHAdeMO + GB/T must be filtered out.
	var search struct {
		Results  []ChargerSummary `json:"results"`
		Excluded int              `json:"excluded_incompatible"`
	}
	call(t, srv, "GET", "/api/chargers/search?lat=12.9352&lng=77.6245&radius_km=5&vehicle_id="+nexon.ID, driver, nil, &search)
	if search.Excluded != 3 {
		t.Errorf("excluded_incompatible = %d, want 3 (CHAdeMO + 2 GB/T)", search.Excluded)
	}
	var ravi ChargerSummary
	for _, c := range search.Results {
		if c.Compatibility != "compatible" {
			t.Errorf("%s returned with compatibility %s", c.Name, c.Compatibility)
		}
		if c.Name == "Ravi's Home Fast Charger" {
			ravi = c
		}
		if c.Name == "Ravi's Second Charger (pending review)" {
			t.Error("unapproved charger in search")
		}
		if c.Name == "HSR Sector 2 Home Charger" && c.Availability.Source != "stale" {
			t.Errorf("HSR charger should be stale, got %s", c.Availability.Source)
		}
	}
	if ravi.ID == "" {
		t.Fatal("Ravi's charger missing from results")
	}
	if ravi.Lat != 12.935 {
		t.Errorf("private location not blurred: %v", ravi.Lat)
	}

	// Comet (AC only) can't book a DC charger.
	start := time.Date(2026, 10, 26, 18, 0, 0, 0, IST)
	slot := map[string]any{"charger_id": ravi.ID, "start_at": start.Format(time.RFC3339), "end_at": start.Add(time.Hour).Format(time.RFC3339), "estimated_kwh": 20}
	slot["vehicle_id"] = comet.ID
	var errBody struct{ Error apiError }
	if code := call(t, srv, "POST", "/api/bookings", driver, slot, &errBody); code != 422 || errBody.Error.Code != "INCOMPATIBLE" {
		t.Fatalf("incompatible booking: %d %+v", code, errBody)
	}

	// Book with the Nexon (idempotent retry returns the same booking).
	slot["vehicle_id"] = nexon.ID
	slot["_idem"] = "key-1"
	var b1, b1again Booking
	if code := call(t, srv, "POST", "/api/bookings", driver, slot, &b1); code != 201 || b1.Status != "requested" {
		t.Fatalf("create booking: %d %+v", code, b1)
	}
	call(t, srv, "POST", "/api/bookings", driver, slot, &b1again)
	if b1again.ID != b1.ID {
		t.Error("idempotency key created a second booking")
	}
	if b1.Price.TotalPaise != 36000+3600+648 {
		t.Errorf("total = %d", b1.Price.TotalPaise)
	}

	// Another driver can't take the same slot.
	var punch []Vehicle
	call(t, srv, "GET", "/api/vehicles", driver2, nil, &punch)
	other := map[string]any{"charger_id": ravi.ID, "vehicle_id": punch[0].ID, "start_at": slot["start_at"], "end_at": slot["end_at"]}
	if code := call(t, srv, "POST", "/api/bookings", driver2, other, &errBody); code != 409 || errBody.Error.Code != "SLOT_TAKEN" {
		t.Fatalf("double booking: %d %+v", code, errBody)
	}

	// Driver can't accept their own booking; can't pay before acceptance.
	if code := call(t, srv, "POST", "/api/bookings/"+b1.ID+"/accept", driver, nil, nil); code != 403 {
		t.Errorf("driver accept: %d", code)
	}
	if code := call(t, srv, "POST", "/api/bookings/"+b1.ID+"/pay", driver, nil, nil); code != 409 {
		t.Errorf("pay before accept: %d", code)
	}
	if b1.Address != nil {
		t.Error("address revealed before confirmation")
	}

	var b Booking
	call(t, srv, "POST", "/api/bookings/"+b1.ID+"/accept", owner, nil, &b)
	call(t, srv, "POST", "/api/bookings/"+b1.ID+"/pay", driver, nil, &b)
	if b.Status != "confirmed" || b.PaymentStatus != "paid" || b.Address == nil {
		t.Fatalf("after pay: %+v", b)
	}
	call(t, srv, "POST", "/api/bookings/"+b1.ID+"/complete", driver, nil, &b)
	if b.Status != "completed" || len(b.Events) != 4 {
		t.Fatalf("after complete: status=%s events=%d", b.Status, len(b.Events))
	}

	// Slot list reflects bookings; owner sees the booking.
	var slots struct{ Slots []Slot }
	call(t, srv, "GET", "/api/chargers/"+ravi.ID+"/slots?date=2026-10-26", driver, nil, &slots)
	if len(slots.Slots) != 16 {
		t.Errorf("slots = %d, want 16 (07:00–23:00)", len(slots.Slots))
	}
	var ownerList []Booking
	call(t, srv, "GET", "/api/owner/bookings", owner, nil, &ownerList)
	if len(ownerList) != 1 {
		t.Errorf("owner bookings = %d", len(ownerList))
	}
	// Unrelated driver can't read it.
	if code := call(t, srv, "GET", "/api/bookings/"+b1.ID, driver2, nil, nil); code != 404 {
		t.Errorf("other driver read booking: %d", code)
	}
}

func TestConcurrentBookingsOnlyOneWins(t *testing.T) {
	srv := newTestApp(t)
	driver := login(t, srv, "driver@amply.test")
	var vehicles []Vehicle
	call(t, srv, "GET", "/api/vehicles", driver, nil, &vehicles)
	var nexonID string
	for _, v := range vehicles {
		if v.Model == "Nexon EV" {
			nexonID = v.ID
		}
	}
	var search struct{ Results []ChargerSummary }
	call(t, srv, "GET", "/api/chargers/search?lat=12.9345&lng=77.6190&radius_km=1&vehicle_id="+nexonID, driver, nil, &search)
	cafe := search.Results[0]

	start := time.Date(2026, 10, 26, 19, 0, 0, 0, IST)
	var wg sync.WaitGroup
	codes := make(chan int, 10)
	for i := range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			body := map[string]any{"charger_id": cafe.ID, "vehicle_id": nexonID, "_idem": fmt.Sprint("k", i),
				"start_at": start.Format(time.RFC3339), "end_at": start.Add(2 * time.Hour).Format(time.RFC3339)}
			codes <- call(t, srv, "POST", "/api/bookings", driver, body, nil)
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
		t.Fatalf("%d bookings succeeded for the same slot, want 1", won)
	}
}

func vehicleID(t *testing.T, srv *httptest.Server, token, model string) string {
	var vs []Vehicle
	call(t, srv, "GET", "/api/vehicles", token, nil, &vs)
	for _, v := range vs {
		if v.Model == model {
			return v.ID
		}
	}
	t.Fatalf("vehicle %s not found", model)
	return ""
}

// Offline agent (no API key): finds, explains, prepares, and books only after confirm.
func TestAgentOfflineBooksOnlyAfterConfirm(t *testing.T) {
	srv := newTestApp(t)
	driver := login(t, srv, "driver@amply.test")
	nexon := vehicleID(t, srv, driver, "Nexon EV")

	chat := func(msg, vid string) agentResponse {
		var r agentResponse
		body := map[string]any{"messages": []map[string]string{{"role": "user", "content": msg}}, "vehicle_id": vid}
		if code := call(t, srv, "POST", "/api/agent/chat", driver, body, &r); code != 200 {
			t.Fatalf("chat: %d", code)
		}
		return r
	}

	if r := chat("find a charger near koramangala", ""); r.PendingAction != nil || len(r.Cards) != 0 {
		t.Fatalf("without vehicle the agent should ask first: %+v", r)
	}

	r := chat("Find a compatible charger near Koramangala under ₹20/kWh and book it for 6 PM", nexon)
	if r.Mode != "offline" || r.PendingAction == nil {
		t.Fatalf("expected a pending booking: %+v", r)
	}
	for _, c := range r.Cards {
		if c.Compatibility != "compatible" || c.PricePerKWhPaise > 2000 {
			t.Errorf("bad card %s (%s, %d)", c.Name, c.Compatibility, c.PricePerKWhPaise)
		}
	}
	var mine []Booking
	call(t, srv, "GET", "/api/bookings", driver, nil, &mine)
	if len(mine) != 0 {
		t.Fatal("agent booked without confirmation")
	}

	other := login(t, srv, "driver2@amply.test")
	if code := call(t, srv, "POST", "/api/agent/confirm", other, map[string]any{"confirmation_id": r.PendingAction.ConfirmationID}, nil); code != 404 {
		t.Errorf("another user confirmed my booking: %d", code)
	}
	var b Booking
	if code := call(t, srv, "POST", "/api/agent/confirm", driver, map[string]any{"confirmation_id": r.PendingAction.ConfirmationID}, &b); code != 201 {
		t.Fatalf("confirm: %d", code)
	}
	if b.Status != "requested" || b.StartAt[11:16] != "18:00" {
		t.Fatalf("booking: %+v", b)
	}
}

func TestOwnerListingAdminReviewAndRisk(t *testing.T) {
	srv := newTestApp(t)
	owner, admin, driver := login(t, srv, "owner2@amply.test"), login(t, srv, "admin@amply.test"), login(t, srv, "driver@amply.test")

	listing := map[string]any{"name": "Test Garage Charger", "category": "private", "lat": 12.93, "lng": 77.62,
		"address": "secret", "approx_area": "Koramangala", "connector": "CCS2", "mode": "DC", "power_kw": 25,
		"price_per_kwh_paise": 1600, "schedule": []map[string]any{{"weekdays": []int{0, 1, 2, 3, 4, 5, 6}, "start_time": "08:00", "end_time": "20:00"}}}
	if code := call(t, srv, "POST", "/api/owner/chargers", driver, listing, nil); code != 403 {
		t.Errorf("driver listed a charger: %d", code)
	}
	var created ChargerDetail
	if code := call(t, srv, "POST", "/api/owner/chargers", owner, listing, &created); code != 201 || created.Status != "submitted" {
		t.Fatalf("create listing: %d %+v", code, created)
	}
	if code := call(t, srv, "GET", "/api/admin/chargers", driver, nil, nil); code != 403 {
		t.Errorf("driver reached admin: %d", code)
	}
	var queue []ChargerDetail
	call(t, srv, "GET", "/api/admin/chargers?status=submitted", admin, nil, &queue)
	if len(queue) != 3 {
		t.Errorf("review queue = %d, want 3 (2 seeded + new)", len(queue))
	}
	var approved ChargerDetail
	call(t, srv, "POST", "/api/admin/chargers/"+created.ID+"/approve", admin, nil, &approved)
	if approved.Status != "approved" {
		t.Fatalf("approve: %+v", approved)
	}
	if code := call(t, srv, "POST", "/api/admin/chargers/"+created.ID+"/approve", admin, nil, nil); code != 409 {
		t.Errorf("double approve: %d", code)
	}
	var search struct{ Results []ChargerSummary }
	call(t, srv, "GET", "/api/chargers/search?lat=12.93&lng=77.62&radius_km=1", driver, nil, &search)
	if !slices.ContainsFunc(search.Results, func(c ChargerSummary) bool { return c.ID == created.ID }) {
		t.Error("approved listing not searchable")
	}

	for range 2 {
		call(t, srv, "POST", "/api/reports", driver, map[string]any{"target_type": "charger", "target_id": created.ID, "reason": "Charger was broken"}, nil)
	}
	var flags []RiskFlag
	call(t, srv, "GET", "/api/admin/risk", admin, nil, &flags)
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
	call(t, srv, "GET", "/api/admin/reports", admin, nil, &reports)
	if len(reports) != 2 {
		t.Fatalf("reports = %d", len(reports))
	}
	if code := call(t, srv, "POST", "/api/admin/reports/"+reports[0].ID+"/resolve", admin, map[string]any{"resolution": "Owner fixed it"}, nil); code != 204 {
		t.Errorf("resolve: %d", code)
	}
}
