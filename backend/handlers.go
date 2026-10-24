package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ---- vehicles ----

func (a *App) listVehicles(w http.ResponseWriter, r *http.Request, u *User) {
	rows, err := a.db.Query(`SELECT id FROM vehicles WHERE user_id = ? ORDER BY make, model`, u.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	out := []*Vehicle{}
	for _, id := range ids {
		v, err := loadVehicle(a.db, id, u.ID)
		if err != nil {
			serverError(w, err)
			return
		}
		out = append(out, v)
	}
	writeJSON(w, 200, out)
}

// optionalVehicle loads ?vehicle_id= if given. ok=false means an error response was written.
func (a *App) optionalVehicle(w http.ResponseWriter, r *http.Request, u *User) (*Vehicle, bool) {
	id := r.URL.Query().Get("vehicle_id")
	if id == "" {
		return nil, true
	}
	v, err := loadVehicle(a.db, id, u.ID)
	if err != nil {
		serverError(w, err)
		return nil, false
	}
	if v == nil {
		writeError(w, 404, "NOT_FOUND", "Vehicle not found")
		return nil, false
	}
	return v, true
}

// ---- chargers ----

func (a *App) searchChargers(w http.ResponseWriter, r *http.Request, u *User) {
	q := r.URL.Query()
	lat, err1 := strconv.ParseFloat(q.Get("lat"), 64)
	lng, err2 := strconv.ParseFloat(q.Get("lng"), 64)
	if err1 != nil || err2 != nil {
		writeError(w, 422, "VALIDATION_ERROR", "lat and lng are required numbers")
		return
	}
	radius := floatParam(q.Get("radius_km"), 5)
	maxPrice := floatParam(q.Get("max_price_paise"), 0)
	minPower := floatParam(q.Get("min_power_kw"), 0)
	connector, mode := q.Get("connector"), q.Get("mode")
	bookableOnly := q.Get("bookable_only") == "true"

	v, ok := a.optionalVehicle(w, r, u)
	if !ok {
		return
	}
	chargers, err := loadChargers(a.db, "c.status = 'approved'")
	if err != nil {
		serverError(w, err)
		return
	}
	from := &[2]float64{lat, lng}
	results := []ChargerSummary{}
	excluded := 0
	for _, c := range chargers {
		if haversineKM(lat, lng, c.Lat, c.Lng) > radius ||
			(connector != "" && c.Connector != connector) || (mode != "" && c.Mode != mode) ||
			(maxPrice > 0 && float64(c.PricePerKWhPaise) > maxPrice) || (minPower > 0 && c.PowerKW < minPower) ||
			(bookableOnly && !c.Bookable) {
			continue
		}
		s := a.summary(c, v, from, false)
		if s.Compatibility == "incompatible" {
			excluded++
			continue
		}
		results = append(results, s)
	}
	slices.SortFunc(results, func(x, y ChargerSummary) int {
		switch {
		case *x.DistanceKM < *y.DistanceKM:
			return -1
		case *x.DistanceKM > *y.DistanceKM:
			return 1
		}
		return 0
	})
	writeJSON(w, 200, map[string]any{"results": results, "excluded_incompatible": excluded})
}

// chargerFor loads {id} and enforces visibility (approved, or the viewer owns it).
func (a *App) chargerFor(w http.ResponseWriter, r *http.Request, u *User) *charger {
	c, err := loadCharger(a.db, r.PathValue("id"))
	if err != nil {
		serverError(w, err)
		return nil
	}
	if c == nil || (c.Status != "approved" && !isOwner(c, u)) {
		writeError(w, 404, "NOT_FOUND", "Charger not found")
		return nil
	}
	return c
}

func isOwner(c *charger, u *User) bool { return c.OwnerID != nil && *c.OwnerID == u.ID }

func (a *App) getCharger(w http.ResponseWriter, r *http.Request, u *User) {
	c := a.chargerFor(w, r, u)
	if c == nil {
		return
	}
	v, ok := a.optionalVehicle(w, r, u)
	if !ok {
		return
	}
	reveal := isOwner(c, u)
	if !reveal {
		var n int
		err := a.db.QueryRow(`SELECT COUNT(*) FROM bookings WHERE charger_id = ? AND driver_id = ? AND status IN ('confirmed','completed')`,
			c.ID, u.ID).Scan(&n)
		if err != nil {
			serverError(w, err)
			return
		}
		reveal = n > 0
	}
	writeJSON(w, 200, a.detail(c, v, nil, reveal))
}

func (a *App) getSlots(w http.ResponseWriter, r *http.Request, u *User) {
	c := a.chargerFor(w, r, u)
	if c == nil {
		return
	}
	date := r.URL.Query().Get("date")
	day, err := time.ParseInLocation("2006-01-02", date, IST)
	if err != nil {
		writeError(w, 422, "VALIDATION_ERROR", "date must be YYYY-MM-DD")
		return
	}
	taken, err := takenSpans(a.db, c.ID, day.Unix(), day.Add(24*time.Hour).Unix())
	if err != nil {
		serverError(w, err)
		return
	}
	slots := []Slot{}
	if c.Bookable {
		slots = buildSlots(day, c.Schedule, taken, a.now())
	}
	writeJSON(w, 200, map[string]any{
		"charger_id": c.ID, "date": date, "slot_minutes": slotMinutes, "bookable": c.Bookable,
		"availability": availabilityFor(c.AvailSource, c.LastUpdated, a.now()), "slots": slots,
	})
}

func takenSpans(q querier, chargerID string, from, to int64) ([]span, error) {
	rows, err := q.Query(`SELECT start_ts, end_ts FROM bookings WHERE charger_id = ? AND status IN ('requested','accepted','confirmed')
		AND start_ts < ? AND end_ts > ?`, chargerID, to, from)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []span
	for rows.Next() {
		var s span
		if err := rows.Scan(&s.start, &s.end); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (a *App) getEstimate(w http.ResponseWriter, r *http.Request, u *User) {
	c := a.chargerFor(w, r, u)
	if c == nil {
		return
	}
	kwh := floatParam(r.URL.Query().Get("kwh"), 20)
	if kwh <= 0 || kwh > 200 {
		writeError(w, 422, "VALIDATION_ERROR", "kwh must be between 0 and 200")
		return
	}
	writeJSON(w, 200, priceFor(c.PricePerKWhPaise, kwh))
}

// ---- bookings ----

func (a *App) createBooking(w http.ResponseWriter, r *http.Request, u *User) {
	if !u.Has("driver") {
		writeError(w, 403, "FORBIDDEN", "Only drivers can book")
		return
	}
	var body struct {
		ChargerID    string  `json:"charger_id"`
		VehicleID    string  `json:"vehicle_id"`
		StartAt      string  `json:"start_at"`
		EndAt        string  `json:"end_at"`
		EstimatedKWh float64 `json:"estimated_kwh"`
	}
	if !readBody(w, r, &body) {
		return
	}
	start, err1 := time.Parse(time.RFC3339, body.StartAt)
	end, err2 := time.Parse(time.RFC3339, body.EndAt)
	if err1 != nil || err2 != nil {
		writeError(w, 422, "VALIDATION_ERROR", "start_at and end_at must be ISO 8601 with offset")
		return
	}
	dur := end.Sub(start)
	if dur < time.Hour || dur > 4*time.Hour || dur%time.Hour != 0 || start.In(IST).Minute() != 0 || start.Second() != 0 {
		writeError(w, 422, "VALIDATION_ERROR", "Book 1 to 4 whole hourly slots")
		return
	}
	if !start.After(a.now()) {
		writeError(w, 422, "VALIDATION_ERROR", "That slot is in the past")
		return
	}
	if body.EstimatedKWh <= 0 {
		body.EstimatedKWh = 20
	}

	c, err := loadCharger(a.db, body.ChargerID)
	if err != nil {
		serverError(w, err)
		return
	}
	if c == nil || c.Status != "approved" {
		writeError(w, 404, "NOT_FOUND", "Charger not found")
		return
	}
	if !c.Bookable {
		writeError(w, 422, "VALIDATION_ERROR", "This charger does not support booking — directions only")
		return
	}
	if !fitsSchedule(start, end, c.Schedule) {
		writeError(w, 422, "VALIDATION_ERROR", "That time is outside the owner's available hours")
		return
	}
	v, err := loadVehicle(a.db, body.VehicleID, u.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	if v == nil {
		writeError(w, 404, "NOT_FOUND", "Vehicle not found")
		return
	}
	if compat, reason, _ := compatibility(v, c); compat != "compatible" {
		writeError(w, 422, "INCOMPATIBLE", reason)
		return
	}

	idemKey := r.Header.Get("Idempotency-Key")
	price := priceFor(c.PricePerKWhPaise, body.EstimatedKWh)

	tx, err := a.db.Begin()
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback()

	if idemKey != "" {
		var existing string
		err := tx.QueryRow(`SELECT id FROM bookings WHERE driver_id = ? AND idempotency_key = ?`, u.ID, idemKey).Scan(&existing)
		if err == nil {
			tx.Rollback()
			a.respondBooking(w, 200, existing, u)
			return
		}
		if !errors.Is(err, sql.ErrNoRows) {
			serverError(w, err)
			return
		}
	}

	taken, err := takenSpans(tx, c.ID, start.Unix(), end.Unix())
	if err != nil {
		serverError(w, err)
		return
	}
	if len(taken) > 0 {
		writeError(w, 409, "SLOT_TAKEN", "Someone just booked that slot. Pick another time.")
		return
	}

	id := uuid.NewString()
	now := a.now().Unix()
	var key any
	if idemKey != "" {
		key = idemKey
	}
	if _, err := tx.Exec(`INSERT INTO bookings (id, charger_id, driver_id, vehicle_id, start_ts, end_ts, status, energy_kwh,
		energy_cost_paise, service_fee_paise, tax_paise, total_paise, idempotency_key, created_at)
		VALUES (?,?,?,?,?,?,'requested',?,?,?,?,?,?,?)`,
		id, c.ID, u.ID, v.ID, start.Unix(), end.Unix(), price.EnergyKWh, price.EnergyCostPaise, price.ServiceFeePaise,
		price.TaxPaise, price.TotalPaise, key, now); err != nil {
		serverError(w, err)
		return
	}
	if err := addEvent(tx, id, u.ID, "requested", nil, now); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		serverError(w, err)
		return
	}
	a.respondBooking(w, 201, id, u)
}

func addEvent(tx *sql.Tx, bookingID, actorID, eventType string, meta map[string]any, ts int64) error {
	if meta == nil {
		meta = map[string]any{}
	}
	m, _ := json.Marshal(meta)
	_, err := tx.Exec(`INSERT INTO booking_events (id, booking_id, actor_id, event_type, metadata, created_at) VALUES (?,?,?,?,?,?)`,
		uuid.NewString(), bookingID, actorID, eventType, string(m), ts)
	return err
}

type bookingRow struct {
	b        Booking
	ownerID  *string
	driverID string
}

const bookingSelect = `SELECT b.id, b.status, c.id, c.name, c.approx_area, c.owner_id, c.address, c.access_instructions,
	d.id, d.name, b.vehicle_id, b.start_ts, b.end_ts, b.energy_kwh, b.energy_cost_paise, b.service_fee_paise, b.tax_paise,
	b.total_paise, b.created_at,
	COALESCE((SELECT p.status FROM payments p WHERE p.booking_id = b.id ORDER BY p.created_at DESC LIMIT 1), 'none')
	FROM bookings b JOIN chargers c ON c.id = b.charger_id JOIN users d ON d.id = b.driver_id`

func (a *App) queryBookings(where string, args ...any) ([]*bookingRow, error) {
	rows, err := a.db.Query(bookingSelect+" WHERE "+where+" ORDER BY b.start_ts DESC", args...)
	if err != nil {
		return nil, err
	}
	var out []*bookingRow
	for rows.Next() {
		br := &bookingRow{}
		b := &br.b
		var address, instructions string
		var startTS, endTS, created int64
		if err := rows.Scan(&b.ID, &b.Status, &b.Charger.ID, &b.Charger.Name, &b.Charger.ApproxArea, &br.ownerID, &address, &instructions,
			&b.Driver.ID, &b.Driver.Name, &b.VehicleID, &startTS, &endTS, &b.Price.EnergyKWh, &b.Price.EnergyCostPaise,
			&b.Price.ServiceFeePaise, &b.Price.TaxPaise, &b.Price.TotalPaise, &created, &b.PaymentStatus); err != nil {
			rows.Close()
			return nil, err
		}
		br.driverID = b.Driver.ID
		b.StartAt = time.Unix(startTS, 0).In(IST).Format(time.RFC3339)
		b.EndAt = time.Unix(endTS, 0).In(IST).Format(time.RFC3339)
		b.CreatedAt = time.Unix(created, 0).In(IST).Format(time.RFC3339)
		b.Price.Assumptions = priceFor(1, b.Price.EnergyKWh).Assumptions
		if revealsAddress(b.Status) {
			b.Address, b.AccessInstructions = &address, &instructions
		}
		out = append(out, br)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, br := range out {
		if br.b.Events, err = a.loadEvents(br.b.ID); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (a *App) loadEvents(bookingID string) ([]BookingEvent, error) {
	rows, err := a.db.Query(`SELECT event_type, actor_id, metadata, created_at FROM booking_events WHERE booking_id = ? ORDER BY created_at, rowid`, bookingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []BookingEvent{}
	for rows.Next() {
		var e BookingEvent
		var meta string
		var ts int64
		if err := rows.Scan(&e.EventType, &e.ActorID, &meta, &ts); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(meta), &e.Metadata)
		e.CreatedAt = time.Unix(ts, 0).In(IST).Format(time.RFC3339)
		events = append(events, e)
	}
	return events, rows.Err()
}

func canView(br *bookingRow, u *User) bool {
	return br.driverID == u.ID || (br.ownerID != nil && *br.ownerID == u.ID)
}

func (a *App) respondBooking(w http.ResponseWriter, status int, id string, u *User) {
	rows, err := a.queryBookings("b.id = ?", id)
	if err != nil {
		serverError(w, err)
		return
	}
	if len(rows) == 0 || !canView(rows[0], u) {
		writeError(w, 404, "NOT_FOUND", "Booking not found")
		return
	}
	writeJSON(w, status, rows[0].b)
}

func (a *App) getBooking(w http.ResponseWriter, r *http.Request, u *User) {
	a.respondBooking(w, 200, r.PathValue("id"), u)
}

func (a *App) listMyBookings(w http.ResponseWriter, r *http.Request, u *User) {
	a.writeBookingList(w, "b.driver_id = ?", u.ID)
}

func (a *App) ownerBookings(w http.ResponseWriter, r *http.Request, u *User) {
	if status := r.URL.Query().Get("status"); status != "" {
		a.writeBookingList(w, "c.owner_id = ? AND b.status = ?", u.ID, status)
		return
	}
	a.writeBookingList(w, "c.owner_id = ?", u.ID)
}

func (a *App) writeBookingList(w http.ResponseWriter, where string, args ...any) {
	rows, err := a.queryBookings(where, args...)
	if err != nil {
		serverError(w, err)
		return
	}
	out := []Booking{}
	for _, br := range rows {
		out = append(out, br.b)
	}
	writeJSON(w, 200, out)
}

// transitionBooking handles accept / reject / cancel / pay / complete.
func (a *App) transitionBooking(w http.ResponseWriter, r *http.Request, u *User) {
	action := r.PathValue("action")
	t, ok := transitions[action]
	if !ok {
		writeError(w, 404, "NOT_FOUND", "Unknown booking action")
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if r.ContentLength > 0 && !readBody(w, r, &body) {
		return
	}

	rows, err := a.queryBookings("b.id = ?", r.PathValue("id"))
	if err != nil {
		serverError(w, err)
		return
	}
	if len(rows) == 0 || !canView(rows[0], u) {
		writeError(w, 404, "NOT_FOUND", "Booking not found")
		return
	}
	br := rows[0]
	isDriver := br.driverID == u.ID
	isOwnerOf := br.ownerID != nil && *br.ownerID == u.ID
	allowed := map[string]bool{
		"accept": isOwnerOf, "reject": isOwnerOf, "cancel": isDriver, "pay": isDriver, "complete": isDriver || isOwnerOf,
	}[action]
	if !allowed {
		writeError(w, 403, "FORBIDDEN", "You can't "+action+" this booking")
		return
	}

	tx, err := a.db.Begin()
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback()
	now := a.now().Unix()
	// Conditional update = the state check and the write happen atomically.
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(t.from)), ",")
	args := []any{t.to, br.b.ID}
	for _, s := range t.from {
		args = append(args, s)
	}
	res, err := tx.Exec(`UPDATE bookings SET status = ? WHERE id = ? AND status IN (`+placeholders+`)`, args...)
	if err != nil {
		serverError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, 409, "INVALID_STATE", "Booking is "+br.b.Status+"; can't "+action+" it")
		return
	}
	meta := map[string]any{}
	if body.Reason != "" {
		meta["reason"] = body.Reason
	}
	if action == "pay" {
		// Prototype: mock payment, recorded like a real provider reference would be.
		ref := "mock_pay_" + uuid.NewString()[:8]
		if _, err := tx.Exec(`INSERT INTO payments (id, booking_id, amount_paise, status, provider_ref, created_at) VALUES (?,?,?,?,?,?)`,
			uuid.NewString(), br.b.ID, br.b.Price.TotalPaise, "paid", ref, now); err != nil {
			serverError(w, err)
			return
		}
		meta["payment_ref"] = ref
		meta["amount_paise"] = br.b.Price.TotalPaise
	}
	if err := addEvent(tx, br.b.ID, u.ID, t.to, meta, now); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		serverError(w, err)
		return
	}
	a.respondBooking(w, 200, br.b.ID, u)
}

// ---- owner ----

func (a *App) ownerChargers(w http.ResponseWriter, r *http.Request, u *User) {
	chargers, err := loadChargers(a.db, "c.owner_id = ? ORDER BY c.name", u.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	out := []ChargerDetail{}
	for _, c := range chargers {
		out = append(out, a.detail(c, nil, nil, true))
	}
	writeJSON(w, 200, out)
}

func floatParam(s string, fallback float64) float64 {
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return f
	}
	return fallback
}
