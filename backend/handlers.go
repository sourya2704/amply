package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ---- vehicles ----

func (a *App) listVehicles(w http.ResponseWriter, r *http.Request, u *User) {
	rows, err := a.db.Query(`SELECT id FROM vehicles WHERE user_id = ? ORDER BY seq`, u.ID)
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

// pointSQL is a PostGIS geography point built from (lng, lat) parameters.
const pointSQL = `ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography`

func (a *App) searchChargers(w http.ResponseWriter, r *http.Request, u *User) {
	q := r.URL.Query()
	lat, err1 := strconv.ParseFloat(q.Get("lat"), 64)
	lng, err2 := strconv.ParseFloat(q.Get("lng"), 64)
	if err1 != nil || err2 != nil || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		writeError(w, 422, "VALIDATION_ERROR", "lat and lng are required numbers")
		return
	}
	radius := floatParam(q.Get("radius_km"), 5)
	if radius <= 0 || radius > 100 {
		radius = 5
	}

	v, ok := a.optionalVehicle(w, r, u)
	if !ok {
		return
	}

	// Geospatial filter and ordering happen in PostGIS; hard filters too.
	where := []string{"c.status = 'approved'", "ST_DWithin(c.location, " + pointSQL + ", ?)"}
	args := []any{lng, lat, radius * 1000}
	if c := q.Get("connector"); c != "" {
		where, args = append(where, "c.connector = ?"), append(args, c)
	}
	if m := q.Get("mode"); m != "" {
		where, args = append(where, "c.mode = ?"), append(args, m)
	}
	if p := floatParam(q.Get("max_price_paise"), 0); p > 0 {
		where, args = append(where, "c.price_per_kwh_paise <= ?"), append(args, int64(p))
	}
	if p := floatParam(q.Get("min_power_kw"), 0); p > 0 {
		where, args = append(where, "c.power_kw >= ?"), append(args, p)
	}
	if q.Get("bookable_only") == "true" {
		where = append(where, "c.bookable")
	}
	args = append(args, lng, lat)
	chargers, err := loadChargers(a.db, strings.Join(where, " AND ")+" ORDER BY ST_Distance(c.location, "+pointSQL+")", args...)
	if err != nil {
		serverError(w, err)
		return
	}

	from := &[2]float64{lat, lng}
	results := []ChargerSummary{}
	excluded := 0
	for _, c := range chargers {
		s := a.summary(c, v, from, false)
		if s.Compatibility == "incompatible" {
			excluded++
			continue
		}
		results = append(results, s)
	}
	writeJSON(w, 200, map[string]any{"results": results, "excluded_incompatible": excluded})
}

// chargerFor loads {id} and enforces visibility (approved, or the viewer owns it, or the viewer is an admin).
func (a *App) chargerFor(w http.ResponseWriter, r *http.Request, u *User) *charger {
	c, err := loadCharger(a.db, r.PathValue("id"))
	if err != nil {
		serverError(w, err)
		return nil
	}
	if c == nil || (c.Status != "approved" && !isOwner(c, u) && !u.Has("admin")) {
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
		err := a.db.QueryRow(`SELECT COUNT(*) FROM bookings WHERE charger_id = ? AND driver_id = ?
			AND status IN ('confirmed','in_progress','completed')`, c.ID, u.ID).Scan(&n)
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
	a.expireStale()
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
	args := append([]any{chargerID, to, from}, anySlice(blockingStatuses)...)
	rows, err := q.Query(`SELECT start_ts, end_ts FROM bookings WHERE charger_id = ? AND start_ts < ? AND end_ts > ?
		AND status IN (`+placeholders(len(blockingStatuses))+`)`, args...)
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

type ReviewOut struct {
	Rating     int    `json:"rating"`
	Comment    string `json:"comment"`
	AuthorName string `json:"author_name"`
	CreatedAt  string `json:"created_at"`
}

func (a *App) chargerReviews(w http.ResponseWriter, r *http.Request, u *User) {
	c := a.chargerFor(w, r, u)
	if c == nil {
		return
	}
	rows, err := a.db.Query(`SELECT r.rating, r.comment, u.name, r.created_at FROM reviews r JOIN users u ON u.id = r.author_id
		WHERE r.charger_id = ? ORDER BY r.created_at DESC LIMIT 20`, c.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	out := []ReviewOut{}
	for rows.Next() {
		var rv ReviewOut
		var ts int64
		if err := rows.Scan(&rv.Rating, &rv.Comment, &rv.AuthorName, &ts); err != nil {
			serverError(w, err)
			return
		}
		// Show first name only to protect reviewers' privacy.
		rv.AuthorName, _, _ = strings.Cut(rv.AuthorName, " ")
		rv.CreatedAt = formatTS(ts)
		out = append(out, rv)
	}
	writeJSON(w, 200, out)
}

// ---- bookings ----

func when(startTS int64) string { return time.Unix(startTS, 0).In(IST).Format("Mon 2 Jan, 3:04 PM") }

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
	if body.EstimatedKWh > 200 {
		writeError(w, 422, "VALIDATION_ERROR", "estimated_kwh is too large")
		return
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
	if isOwner(c, u) {
		writeError(w, 422, "VALIDATION_ERROR", "You can't book your own charger")
		return
	}
	if !c.Bookable {
		writeError(w, 422, "VALIDATION_ERROR", "This charger does not support booking (directions only)")
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

	a.expireStale()
	idemKey := r.Header.Get("Idempotency-Key")
	if existing := a.bookingForKey(u.ID, idemKey); existing != "" {
		a.respondBooking(w, 200, existing, u)
		return
	}

	price := priceFor(c.PricePerKWhPaise, body.EstimatedKWh)
	tx, err := a.db.Begin()
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback()

	id := uuid.NewString()
	now := a.now().Unix()
	var key any
	if idemKey != "" {
		key = idemKey
	}
	_, err = tx.Exec(`INSERT INTO bookings (id, charger_id, driver_id, vehicle_id, start_ts, end_ts, status, energy_kwh,
		energy_cost_paise, service_fee_paise, tax_paise, total_paise, idempotency_key, created_at, status_changed_at)
		VALUES (?,?,?,?,?,?,'requested',?,?,?,?,?,?,?,?)`,
		id, c.ID, u.ID, v.ID, start.Unix(), end.Unix(), price.EnergyKWh, price.EnergyCostPaise, price.ServiceFeePaise,
		price.TaxPaise, price.TotalPaise, key, now, now)
	switch pgCode(err) {
	case "":
	case codeExclusionViolation: // the bookings_no_overlap constraint rejected it
		writeError(w, 409, "SLOT_TAKEN", "Someone just booked that slot. Pick another time.")
		return
	case codeUniqueViolation: // same Idempotency-Key raced in twice
		tx.Rollback()
		if existing := a.bookingForKey(u.ID, idemKey); existing != "" {
			a.respondBooking(w, 200, existing, u)
			return
		}
		serverError(w, err)
		return
	default:
		serverError(w, err)
		return
	}
	err = errors.Join(
		addEvent(tx, id, u.ID, "requested", nil, now),
		audit(tx, u.ID, "booking.requested", "booking", id, map[string]any{"charger_id": c.ID, "total_paise": price.TotalPaise}, now),
	)
	if c.OwnerID != nil {
		err = errors.Join(err, notify(tx, *c.OwnerID, "booking_requested", "New booking request",
			fmt.Sprintf("%s wants %s on %s", u.Name, c.Name, when(start.Unix())), "/owner", now))
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		serverError(w, err)
		return
	}
	a.respondBooking(w, 201, id, u)
}

func (a *App) bookingForKey(userID, key string) string {
	if key == "" {
		return ""
	}
	var id string
	if err := a.db.QueryRow(`SELECT id FROM bookings WHERE driver_id = ? AND idempotency_key = ?`, userID, key).Scan(&id); err != nil {
		return ""
	}
	return id
}

func addEvent(q querier, bookingID, actorID, eventType string, meta map[string]any, ts int64) error {
	if meta == nil {
		meta = map[string]any{}
	}
	m, _ := json.Marshal(meta)
	_, err := q.Exec(`INSERT INTO booking_events (id, booking_id, actor_id, event_type, metadata, created_at) VALUES (?,?,?,?,?,?)`,
		uuid.NewString(), bookingID, actorID, eventType, string(m), ts)
	return err
}

// expireStale releases slots held by requests the owner never answered, or acceptances never paid for,
// once holdTimeout passes or the slot starts. Called lazily from the endpoints that read bookings.
func (a *App) expireStale() {
	now := a.now().Unix()
	tx, err := a.db.Begin()
	if err != nil {
		log.Printf("expire: %v", err)
		return
	}
	defer tx.Rollback()
	rows, err := tx.Query(`UPDATE bookings b SET status = 'expired', status_changed_at = ?
		FROM chargers c WHERE c.id = b.charger_id AND b.status IN ('requested','accepted')
		AND (b.status_changed_at < ? OR b.start_ts <= ?)
		RETURNING b.id, b.driver_id, b.start_ts, c.name, c.owner_id`, now, now-int64(holdTimeout.Seconds()), now)
	if err != nil {
		log.Printf("expire: %v", err)
		return
	}
	type expired struct {
		id, driver, name string
		owner            *string
		start            int64
	}
	var list []expired
	for rows.Next() {
		var e expired
		if err := rows.Scan(&e.id, &e.driver, &e.start, &e.name, &e.owner); err == nil {
			list = append(list, e)
		}
	}
	rows.Close()
	if len(list) == 0 {
		return
	}
	for _, e := range list {
		err := errors.Join(
			addEvent(tx, e.id, systemActor, "expired", map[string]any{"reason": "No response or payment in time"}, now),
			audit(tx, systemActor, "booking.expired", "booking", e.id, nil, now),
			notify(tx, e.driver, "booking_expired", "Booking expired",
				fmt.Sprintf("Your request for %s on %s expired and the slot was released.", e.name, when(e.start)), "/bookings/"+e.id, now),
		)
		if err != nil {
			log.Printf("expire: %v", err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		log.Printf("expire: %v", err)
	}
}

type bookingRow struct {
	b        Booking
	ownerID  *string
	driverID string
	startTS  int64
}

const bookingSelect = `SELECT b.id, b.status, c.id, c.name, c.approx_area, c.owner_id, c.address, c.access_instructions,
	d.id, d.name, b.vehicle_id, b.start_ts, b.end_ts, b.energy_kwh, b.energy_cost_paise, b.service_fee_paise, b.tax_paise,
	b.total_paise, b.created_at, b.status_changed_at,
	COALESCE((SELECT p.status FROM payments p WHERE p.booking_id = b.id AND p.status IN ('paid','refunded')
		ORDER BY p.created_at DESC LIMIT 1), 'none'),
	EXISTS (SELECT 1 FROM reviews rv WHERE rv.booking_id = b.id),
	EXISTS (SELECT 1 FROM reports rp WHERE rp.target_type = 'booking' AND rp.target_id = b.id AND rp.status = 'open')
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
		var endTS, created, changed int64
		if err := rows.Scan(&b.ID, &b.Status, &b.Charger.ID, &b.Charger.Name, &b.Charger.ApproxArea, &br.ownerID, &address, &instructions,
			&b.Driver.ID, &b.Driver.Name, &b.VehicleID, &br.startTS, &endTS, &b.Price.EnergyKWh, &b.Price.EnergyCostPaise,
			&b.Price.ServiceFeePaise, &b.Price.TaxPaise, &b.Price.TotalPaise, &created, &changed, &b.PaymentStatus,
			&b.Reviewed, &b.HasOpenIssue); err != nil {
			rows.Close()
			return nil, err
		}
		br.driverID = b.Driver.ID
		b.StartAt, b.EndAt, b.CreatedAt = formatTS(br.startTS), formatTS(endTS), formatTS(created)
		b.Price.Assumptions = priceFor(1, b.Price.EnergyKWh).Assumptions
		if revealsAddress(b.Status) {
			b.Address, b.AccessInstructions = &address, &instructions
		}
		if b.Status == "requested" || b.Status == "accepted" {
			exp := formatTS(min(changed+int64(holdTimeout.Seconds()), br.startTS))
			b.ExpiresAt = &exp
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
	rows, err := a.db.Query(`SELECT event_type, actor_id, metadata, created_at FROM booking_events WHERE booking_id = ? ORDER BY seq`, bookingID)
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
		e.CreatedAt = formatTS(ts)
		events = append(events, e)
	}
	return events, rows.Err()
}

func canView(br *bookingRow, u *User) bool {
	return br.driverID == u.ID || (br.ownerID != nil && *br.ownerID == u.ID)
}

// loadBookingFor returns the booking if u may see it; otherwise writes 404 and returns nil.
func (a *App) loadBookingFor(w http.ResponseWriter, id string, u *User) *bookingRow {
	rows, err := a.queryBookings("b.id = ?", id)
	if err != nil {
		serverError(w, err)
		return nil
	}
	if len(rows) == 0 || !canView(rows[0], u) {
		writeError(w, 404, "NOT_FOUND", "Booking not found")
		return nil
	}
	return rows[0]
}

func (a *App) respondBooking(w http.ResponseWriter, status int, id string, u *User) {
	if br := a.loadBookingFor(w, id, u); br != nil {
		writeJSON(w, status, br.b)
	}
}

func (a *App) getBooking(w http.ResponseWriter, r *http.Request, u *User) {
	a.expireStale()
	a.respondBooking(w, 200, r.PathValue("id"), u)
}

func (a *App) listMyBookings(w http.ResponseWriter, r *http.Request, u *User) {
	a.expireStale()
	a.writeBookingList(w, "b.driver_id = ?", u.ID)
}

func (a *App) ownerBookings(w http.ResponseWriter, r *http.Request, u *User) {
	a.expireStale()
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

// transitionBooking handles accept / reject / cancel / start / complete.
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
	a.expireStale()
	br := a.loadBookingFor(w, r.PathValue("id"), u)
	if br == nil {
		return
	}
	isDriver := br.driverID == u.ID
	isOwnerOf := br.ownerID != nil && *br.ownerID == u.ID
	allowed := map[string]bool{
		"accept": isOwnerOf, "reject": isOwnerOf, "cancel": isDriver,
		"start": isDriver || isOwnerOf, "complete": isDriver || isOwnerOf,
	}[action]
	if !allowed {
		writeError(w, 403, "FORBIDDEN", "You can't "+action+" this booking")
		return
	}
	if action == "start" && a.now().Unix() < br.startTS-15*60 {
		writeError(w, 409, "INVALID_STATE", "The session can start from 15 minutes before the slot")
		return
	}

	tx, err := a.db.Begin()
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback()
	now := a.now().Unix()
	// Conditional update: the state check and the write happen atomically.
	args := append([]any{t.to, now, br.b.ID}, anySlice(t.from)...)
	res, err := tx.Exec(`UPDATE bookings SET status = ?, status_changed_at = ? WHERE id = ? AND status IN (`+placeholders(len(t.from))+`)`, args...)
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
	b := br.b
	slot := when(br.startTS)
	switch action {
	case "cancel":
		if b.PaymentStatus == "paid" {
			ref, err := a.refundBooking(tx, b.ID, u.ID, now)
			if err != nil {
				serverError(w, err)
				return
			}
			meta["refund_ref"] = ref
			meta["refund_paise"] = b.Price.TotalPaise
		}
		if br.ownerID != nil {
			err = notify(tx, *br.ownerID, "booking_cancelled", "Booking cancelled", fmt.Sprintf("%s cancelled %s on %s", b.Driver.Name, b.Charger.Name, slot), "/owner", now)
		}
	case "accept":
		err = notify(tx, br.driverID, "booking_accepted", "Owner accepted your booking",
			fmt.Sprintf("%s on %s. Pay within 30 minutes to confirm.", b.Charger.Name, slot), "/bookings/"+b.ID, now)
	case "reject":
		err = notify(tx, br.driverID, "booking_rejected", "Booking declined", fmt.Sprintf("%s isn't available on %s. Try another slot.", b.Charger.Name, slot), "/bookings/"+b.ID, now)
	case "start":
		other := br.driverID
		if isDriver && br.ownerID != nil {
			other = *br.ownerID
		}
		err = notify(tx, other, "session_started", "Charging session started", b.Charger.Name, "/bookings/"+b.ID, now)
	case "complete":
		if br.ownerID != nil {
			// Owner earns the energy cost; the platform keeps the service fee. Settlement is tracked, paid out offline.
			_, err = tx.Exec(`INSERT INTO payouts (id, owner_id, booking_id, amount_paise, status, created_at) VALUES (?,?,?,?,'pending',?)
				ON CONFLICT (booking_id) DO NOTHING`, uuid.NewString(), *br.ownerID, b.ID, b.Price.EnergyCostPaise, now)
			err = errors.Join(err, notify(tx, *br.ownerID, "payout_pending", "Session completed",
				fmt.Sprintf("You earned %s from %s. Payout is pending.", rupees(b.Price.EnergyCostPaise), b.Driver.Name), "/owner", now))
		}
		err = errors.Join(err, notify(tx, br.driverID, "session_completed", "Session completed", "How was it? Leave a review.", "/bookings/"+b.ID, now))
	}
	err = errors.Join(err,
		addEvent(tx, b.ID, u.ID, t.to, meta, now),
		audit(tx, u.ID, "booking."+t.to, "booking", b.ID, meta, now),
	)
	if err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		serverError(w, err)
		return
	}
	a.respondBooking(w, 200, b.ID, u)
}

func (a *App) reviewBooking(w http.ResponseWriter, r *http.Request, u *User) {
	var body struct {
		Rating  int    `json:"rating"`
		Comment string `json:"comment"`
	}
	if !readBody(w, r, &body) {
		return
	}
	if body.Rating < 1 || body.Rating > 5 || len(body.Comment) > 1000 {
		writeError(w, 422, "VALIDATION_ERROR", "rating must be 1–5 and the comment under 1000 characters")
		return
	}
	br := a.loadBookingFor(w, r.PathValue("id"), u)
	if br == nil {
		return
	}
	if br.driverID != u.ID || br.b.Status != "completed" {
		writeError(w, 409, "INVALID_STATE", "Only the driver can review, after the session is completed")
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback()
	now := a.now().Unix()
	_, err = tx.Exec(`INSERT INTO reviews (id, booking_id, charger_id, author_id, rating, comment, created_at) VALUES (?,?,?,?,?,?,?)`,
		uuid.NewString(), br.b.ID, br.b.Charger.ID, u.ID, body.Rating, strings.TrimSpace(body.Comment), now)
	if pgCode(err) == codeUniqueViolation {
		writeError(w, 409, "INVALID_STATE", "You already reviewed this booking")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	_, err = tx.Exec(`UPDATE chargers SET rating = ROUND(((rating * review_count + ?) / (review_count + 1))::numeric, 1),
		review_count = review_count + 1 WHERE id = ?`, float64(body.Rating), br.b.Charger.ID)
	if err == nil && br.ownerID != nil {
		err = notify(tx, *br.ownerID, "review", fmt.Sprintf("New %d★ review", body.Rating), br.b.Charger.Name, "/owner", now)
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(204)
}

var supportCategories = []string{"charger_not_working", "access_issue", "billing", "safety", "other"}

// supportCase opens a dispute/support ticket on a booking for an admin to resolve.
func (a *App) supportCase(w http.ResponseWriter, r *http.Request, u *User) {
	var body struct {
		Category    string `json:"category"`
		Description string `json:"description"`
	}
	if !readBody(w, r, &body) {
		return
	}
	body.Description = strings.TrimSpace(body.Description)
	if !slices.Contains(supportCategories, body.Category) || body.Description == "" || len(body.Description) > 2000 {
		writeError(w, 422, "VALIDATION_ERROR", "Pick a category and describe the problem")
		return
	}
	br := a.loadBookingFor(w, r.PathValue("id"), u)
	if br == nil {
		return
	}
	id, err := a.openCase(u, "booking", br.b.ID, body.Category, body.Description)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 201, map[string]string{"id": id, "status": "open"})
}

// openCase stores a report or support case and tells the admins.
func (a *App) openCase(u *User, targetType, targetID, category, reason string) (string, error) {
	tx, err := a.db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	now := a.now().Unix()
	id := uuid.NewString()
	if _, err := tx.Exec(`INSERT INTO reports (id, reporter_id, target_type, target_id, category, reason, status, created_at)
		VALUES (?,?,?,?,?,?,'open',?)`, id, u.ID, targetType, targetID, category, reason, now); err != nil {
		return "", err
	}
	rows, err := tx.Query(`SELECT id FROM users WHERE roles LIKE '%admin%'`)
	if err != nil {
		return "", err
	}
	var admins []string
	for rows.Next() {
		var aid string
		rows.Scan(&aid)
		admins = append(admins, aid)
	}
	rows.Close()
	title := "New report"
	if targetType == "booking" {
		title = "New support case"
	}
	for _, aid := range admins {
		if err := notify(tx, aid, "case_opened", title, fmt.Sprintf("%s: %s", u.Name, truncate(reason, 80)), "/admin", now); err != nil {
			return "", err
		}
	}
	if err := audit(tx, u.ID, "case.opened", targetType, targetID, map[string]any{"category": category}, now); err != nil {
		return "", err
	}
	return id, tx.Commit()
}

func truncate(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
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

func (a *App) ownerPayouts(w http.ResponseWriter, r *http.Request, u *User) {
	rows, err := a.db.Query(`SELECT p.id, p.booking_id, c.name, p.amount_paise, p.status, p.created_at FROM payouts p
		JOIN bookings b ON b.id = p.booking_id JOIN chargers c ON c.id = b.charger_id
		WHERE p.owner_id = ? ORDER BY p.created_at DESC`, u.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	type payout struct {
		ID          string `json:"id"`
		BookingID   string `json:"booking_id"`
		ChargerName string `json:"charger_name"`
		AmountPaise int64  `json:"amount_paise"`
		Status      string `json:"status"`
		CreatedAt   string `json:"created_at"`
	}
	out := []payout{}
	for rows.Next() {
		var p payout
		var ts int64
		if err := rows.Scan(&p.ID, &p.BookingID, &p.ChargerName, &p.AmountPaise, &p.Status, &ts); err != nil {
			serverError(w, err)
			return
		}
		p.CreatedAt = formatTS(ts)
		out = append(out, p)
	}
	writeJSON(w, 200, out)
}

func floatParam(s string, fallback float64) float64 {
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return f
	}
	return fallback
}
