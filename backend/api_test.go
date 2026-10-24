package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
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
	app := &App{db: db, cfg: Config{AuthSecret: "test", CORSOrigins: "*", AgentURL: "http://127.0.0.1:1"}, now: func() time.Time { return fixedNow }}
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
	if search.Excluded != 2 {
		t.Errorf("excluded_incompatible = %d, want 2", search.Excluded)
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

func TestAgentProxyDown(t *testing.T) {
	srv := newTestApp(t)
	var e struct{ Error apiError }
	if code := call(t, srv, "POST", "/api/agent/chat", "", map[string]any{}, &e); code != 502 || e.Error.Code != "AGENT_UNAVAILABLE" {
		t.Fatalf("agent proxy: %d %+v", code, e)
	}
}
