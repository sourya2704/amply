package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"slices"
	"strings"

	"github.com/google/uuid"
)

// ---- driver: add vehicle ----

func (a *App) addVehicle(w http.ResponseWriter, r *http.Request, u *User) {
	var v Vehicle
	if !readBody(w, r, &v) {
		return
	}
	if strings.TrimSpace(v.Make) == "" || strings.TrimSpace(v.Model) == "" {
		writeError(w, 422, "VALIDATION_ERROR", "make and model are required")
		return
	}
	for _, c := range v.Connectors {
		if !slices.Contains(connectors, c) {
			writeError(w, 422, "VALIDATION_ERROR", "unknown connector "+c)
			return
		}
	}
	if v.Category != "two_wheeler" {
		v.Category = "car"
	}
	v.ID = uuid.NewString()
	v.Connectors = nonNil(v.Connectors)
	conns, _ := json.Marshal(v.Connectors)
	if _, err := a.db.Exec(`INSERT INTO vehicles (id, user_id, make, model, category, connectors, max_ac_kw, max_dc_kw, battery_kwh)
		VALUES (?,?,?,?,?,?,?,?,?)`, v.ID, u.ID, v.Make, v.Model, v.Category, string(conns), v.MaxACKW, v.MaxDCKW, v.BatteryKWh); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 201, v)
}

var connectors = []string{"CCS2", "TYPE2", "CHADEMO", "GBT"}

// ---- owner: listing lifecycle  submitted → approved/rejected (admin) ⇄ paused (owner) ----

func validateListing(c *seedCharger) string {
	switch {
	case strings.TrimSpace(c.Name) == "" || len(c.Name) > 120:
		return "name is required"
	case c.Lat < -90 || c.Lat > 90 || c.Lng < -180 || c.Lng > 180 || (c.Lat == 0 && c.Lng == 0):
		return "pick the charger location on the map"
	case !slices.Contains(connectors, c.Connector):
		return "unknown connector"
	case c.Mode != "AC" && c.Mode != "DC":
		return "mode must be AC or DC"
	case c.PowerKW <= 0 || c.PowerKW > 400 || c.PricePerKWhPaise <= 0 || c.PricePerKWhPaise > 20000:
		return "power and price must be positive and realistic"
	case len(c.Schedule) == 0:
		return "add at least one availability window"
	}
	return ""
}

func (a *App) createCharger(w http.ResponseWriter, r *http.Request, u *User) {
	if !u.Has("owner") {
		writeError(w, 403, "FORBIDDEN", "Only owners can list chargers")
		return
	}
	var c seedCharger
	if !readBody(w, r, &c) {
		return
	}
	if msg := validateListing(&c); msg != "" {
		writeError(w, 422, "VALIDATION_ERROR", msg)
		return
	}
	if c.Category != "business" {
		c.Category = "private"
	}
	tx, err := a.db.Begin()
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback()
	id := uuid.NewString()
	now := a.now().Unix()
	amen, _ := json.Marshal(nonNil(c.Amenities))
	if _, err := tx.Exec(`INSERT INTO chargers (id, owner_id, name, category, lat, lng, address, approx_area, connector, mode,
		power_kw, price_per_kwh_paise, description, access_instructions, amenities, status, bookable, availability_source, last_updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'submitted',TRUE,'schedule',?)`,
		id, u.ID, c.Name, c.Category, c.Lat, c.Lng, c.Address, c.ApproxArea, c.Connector, c.Mode,
		c.PowerKW, c.PricePerKWhPaise, c.Description, c.AccessInstructions, string(amen), now); err != nil {
		serverError(w, err)
		return
	}
	if err := insertSchedules(tx, id, c.Schedule); err != nil {
		writeError(w, 422, "VALIDATION_ERROR", err.Error())
		return
	}
	if err := audit(tx, u.ID, "listing.submitted", "charger", id, map[string]any{"name": c.Name}, now); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		serverError(w, err)
		return
	}
	ch, err := loadCharger(a.db, id)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 201, a.detail(ch, nil, nil, true))
}

// ownedCharger loads {id} if u owns it, else writes 404.
func (a *App) ownedCharger(w http.ResponseWriter, r *http.Request, u *User) *charger {
	c, err := loadCharger(a.db, r.PathValue("id"))
	if err != nil {
		serverError(w, err)
		return nil
	}
	if c == nil || !isOwner(c, u) {
		writeError(w, 404, "NOT_FOUND", "Charger not found")
		return nil
	}
	return c
}

// updateCharger edits price, details and hours. Location, connector and power changes need a new
// listing because they change what was verified.
func (a *App) updateCharger(w http.ResponseWriter, r *http.Request, u *User) {
	c := a.ownedCharger(w, r, u)
	if c == nil {
		return
	}
	var body struct {
		Name               *string        `json:"name"`
		PricePerKWhPaise   *int64         `json:"price_per_kwh_paise"`
		Description        *string        `json:"description"`
		AccessInstructions *string        `json:"access_instructions"`
		Amenities          []string       `json:"amenities"`
		Schedule           []seedSchedule `json:"schedule"`
	}
	if !readBody(w, r, &body) {
		return
	}
	if body.PricePerKWhPaise != nil && (*body.PricePerKWhPaise <= 0 || *body.PricePerKWhPaise > 20000) {
		writeError(w, 422, "VALIDATION_ERROR", "price must be positive and realistic")
		return
	}
	if body.Name != nil && strings.TrimSpace(*body.Name) == "" {
		writeError(w, 422, "VALIDATION_ERROR", "name can't be empty")
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback()
	now := a.now().Unix()
	changed := map[string]any{}
	set := func(col string, v any) error {
		changed[col] = v
		_, err := tx.Exec(`UPDATE chargers SET `+col+` = ? WHERE id = ?`, v, c.ID)
		return err
	}
	var errs []error
	if body.Name != nil {
		errs = append(errs, set("name", strings.TrimSpace(*body.Name)))
	}
	if body.PricePerKWhPaise != nil {
		errs = append(errs, set("price_per_kwh_paise", *body.PricePerKWhPaise))
	}
	if body.Description != nil {
		errs = append(errs, set("description", *body.Description))
	}
	if body.AccessInstructions != nil {
		errs = append(errs, set("access_instructions", *body.AccessInstructions))
	}
	if body.Amenities != nil {
		amen, _ := json.Marshal(body.Amenities)
		errs = append(errs, set("amenities", string(amen)))
	}
	if body.Schedule != nil {
		if len(body.Schedule) == 0 {
			writeError(w, 422, "VALIDATION_ERROR", "add at least one availability window")
			return
		}
		if _, err := tx.Exec(`DELETE FROM schedules WHERE charger_id = ?`, c.ID); err != nil {
			serverError(w, err)
			return
		}
		if err := insertSchedules(tx, c.ID, body.Schedule); err != nil {
			writeError(w, 422, "VALIDATION_ERROR", err.Error())
			return
		}
		changed["schedule"] = body.Schedule
		// The owner just confirmed their hours, so the schedule is fresh again.
		errs = append(errs, set("last_updated_at", now))
	}
	errs = append(errs, audit(tx, u.ID, "listing.updated", "charger", c.ID, changed, now))
	if err := errors.Join(errs...); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		serverError(w, err)
		return
	}
	updated, err := loadCharger(a.db, c.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, a.detail(updated, nil, nil, true))
}

func (a *App) pauseResumeCharger(w http.ResponseWriter, r *http.Request, u *User) {
	move, ok := map[string]struct{ from, to string }{
		"pause":  {"approved", "paused"},
		"resume": {"paused", "approved"},
	}[r.PathValue("action")]
	from, to := move.from, move.to
	if !ok {
		writeError(w, 404, "NOT_FOUND", "Unknown action")
		return
	}
	c := a.ownedCharger(w, r, u)
	if c == nil {
		return
	}
	now := a.now().Unix()
	res, err := a.db.Exec(`UPDATE chargers SET status = ?, last_updated_at = ? WHERE id = ? AND status = ?`, to, now, c.ID, from)
	if err != nil {
		serverError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, 409, "INVALID_STATE", fmt.Sprintf("Only %s listings can be %sd", from, r.PathValue("action")))
		return
	}
	audit(a.db, u.ID, "listing."+to, "charger", c.ID, nil, now)
	updated, err := loadCharger(a.db, c.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, a.detail(updated, nil, nil, true))
}

// ---- reports ----

func (a *App) createReport(w http.ResponseWriter, r *http.Request, u *User) {
	var body struct {
		TargetType string `json:"target_type"`
		TargetID   string `json:"target_id"`
		Reason     string `json:"reason"`
	}
	if !readBody(w, r, &body) {
		return
	}
	body.Reason = strings.TrimSpace(body.Reason)
	if !slices.Contains([]string{"charger", "user"}, body.TargetType) || body.TargetID == "" || body.Reason == "" || len(body.Reason) > 2000 {
		writeError(w, 422, "VALIDATION_ERROR", "target_type (charger or user), target_id and reason are required")
		return
	}
	if _, err := a.openCase(u, body.TargetType, body.TargetID, "report", body.Reason); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(204)
}

// ---- admin ----

func adminOnly(h func(http.ResponseWriter, *http.Request, *User)) func(http.ResponseWriter, *http.Request, *User) {
	return func(w http.ResponseWriter, r *http.Request, u *User) {
		if !u.Has("admin") {
			writeError(w, 403, "FORBIDDEN", "Admins only")
			return
		}
		h(w, r, u)
	}
}

func (a *App) adminChargers(w http.ResponseWriter, r *http.Request, u *User) {
	status := r.URL.Query().Get("status")
	if status == "" {
		status = "submitted"
	}
	chargers, err := loadChargers(a.db, "c.status = ? ORDER BY c.name", status)
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

func (a *App) reviewCharger(w http.ResponseWriter, r *http.Request, u *User) {
	decision := r.PathValue("decision")
	to := map[string]string{"approve": "approved", "reject": "rejected"}[decision]
	if to == "" {
		writeError(w, 404, "NOT_FOUND", "Unknown action")
		return
	}
	var body struct {
		Note string `json:"note"`
	}
	if r.ContentLength > 0 && !readBody(w, r, &body) {
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback()
	now := a.now().Unix()
	var name string
	var owner *string
	err = tx.QueryRow(`UPDATE chargers SET status = ?, review_note = ?, last_updated_at = ? WHERE id = ? AND status = 'submitted'
		RETURNING name, owner_id`, to, body.Note, now, r.PathValue("id")).Scan(&name, &owner)
	if err != nil {
		writeError(w, 409, "INVALID_STATE", "Only submitted listings can be reviewed")
		return
	}
	errs := []error{audit(tx, u.ID, "listing."+to, "charger", r.PathValue("id"), map[string]any{"note": body.Note}, now)}
	if owner != nil {
		title, msg := "Your charger is live", name+" passed verification and drivers can now book it."
		if to == "rejected" {
			title, msg = "Listing not approved", name+": "+body.Note
		}
		errs = append(errs, notify(tx, *owner, "listing_"+to, title, msg, "/owner", now))
	}
	if err := errors.Join(append(errs, tx.Commit())...); err != nil {
		serverError(w, err)
		return
	}
	c, err := loadCharger(a.db, r.PathValue("id"))
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, a.detail(c, nil, nil, true))
}

type Report struct {
	ID           string `json:"id"`
	ReporterName string `json:"reporter_name"`
	TargetType   string `json:"target_type"`
	TargetID     string `json:"target_id"`
	TargetLabel  string `json:"target_label"`
	Category     string `json:"category"`
	Reason       string `json:"reason"`
	Status       string `json:"status"`
	Resolution   string `json:"resolution"`
	CreatedAt    string `json:"created_at"`
}

func (a *App) adminReports(w http.ResponseWriter, r *http.Request, u *User) {
	rows, err := a.db.Query(`SELECT r.id, u.name, r.target_type, r.target_id, r.category, r.reason, r.status, r.resolution, r.created_at,
		COALESCE(
			(SELECT name FROM chargers WHERE id = r.target_id),
			(SELECT name FROM users WHERE id = r.target_id),
			(SELECT 'Booking at ' || c.name FROM bookings b JOIN chargers c ON c.id = b.charger_id WHERE b.id = r.target_id),
			r.target_id)
		FROM reports r JOIN users u ON u.id = r.reporter_id ORDER BY r.status, r.created_at DESC`)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	out := []Report{}
	for rows.Next() {
		var rp Report
		var ts int64
		if err := rows.Scan(&rp.ID, &rp.ReporterName, &rp.TargetType, &rp.TargetID, &rp.Category, &rp.Reason, &rp.Status,
			&rp.Resolution, &ts, &rp.TargetLabel); err != nil {
			serverError(w, err)
			return
		}
		rp.CreatedAt = formatTS(ts)
		out = append(out, rp)
	}
	writeJSON(w, 200, out)
}

func (a *App) resolveReport(w http.ResponseWriter, r *http.Request, u *User) {
	var body struct {
		Resolution string `json:"resolution"`
	}
	if !readBody(w, r, &body) {
		return
	}
	body.Resolution = strings.TrimSpace(body.Resolution)
	if body.Resolution == "" {
		writeError(w, 422, "VALIDATION_ERROR", "Write the resolution outcome")
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback()
	now := a.now().Unix()
	var reporter, targetType, targetID string
	err = tx.QueryRow(`UPDATE reports SET status = 'resolved', resolution = ? WHERE id = ? AND status = 'open'
		RETURNING reporter_id, target_type, target_id`, body.Resolution, r.PathValue("id")).Scan(&reporter, &targetType, &targetID)
	if err != nil {
		writeError(w, 409, "INVALID_STATE", "Report is already resolved")
		return
	}
	link := ""
	if targetType == "booking" {
		link = "/bookings/" + targetID
	}
	err = errors.Join(
		audit(tx, u.ID, "case.resolved", targetType, targetID, map[string]any{"resolution": body.Resolution}, now),
		notify(tx, reporter, "case_resolved", "Your report was resolved", body.Resolution, link, now),
		tx.Commit(),
	)
	if err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(204)
}

// RiskFlag is a rule-based signal for a human reviewer. Nothing is enforced automatically (PRD Agent 5).
type RiskFlag struct {
	TargetType  string   `json:"target_type"`
	TargetID    string   `json:"target_id"`
	TargetLabel string   `json:"target_label"`
	Score       float64  `json:"score"`
	Signals     []string `json:"signals"`
}

func (a *App) adminRisk(w http.ResponseWriter, r *http.Request, u *User) {
	flags := map[string]*RiskFlag{}
	flag := func(typ, id, label, signal string, score float64) {
		f, ok := flags[id]
		if !ok {
			f = &RiskFlag{TargetType: typ, TargetID: id, TargetLabel: label}
			flags[id] = f
		}
		f.Signals = append(f.Signals, signal)
		f.Score = math.Min(1, math.Max(f.Score, score)+0.1*float64(len(f.Signals)-1))
	}
	type hit struct {
		id, label, other string
		n                float64
	}
	collect := func(query string, args ...any) ([]hit, error) {
		rows, err := a.db.Query(query, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []hit
		for rows.Next() {
			var h hit
			if err := rows.Scan(&h.id, &h.label, &h.other, &h.n); err != nil {
				return nil, err
			}
			out = append(out, h)
		}
		return out, rows.Err()
	}

	// Duplicate listings: PostGIS finds pairs within 30 m listed by different owners. The suspect is the
	// less established one: a listing still awaiting review, else the one with fewer reviews.
	dups, err := collect(`SELECT b.id, b.name, a.name, ST_Distance(a.location, b.location) FROM chargers a JOIN chargers b
		ON a.id <> b.id AND ST_DWithin(a.location, b.location, 30)
		WHERE a.status IN ('approved','submitted','paused') AND b.status IN ('approved','submitted','paused')
		AND a.owner_id IS NOT NULL AND b.owner_id IS NOT NULL AND a.owner_id <> b.owner_id
		AND ((b.status = 'submitted') > (a.status = 'submitted')
			OR ((b.status = 'submitted') = (a.status = 'submitted') AND (b.review_count, b.id) < (a.review_count, a.id)))`)
	if err != nil {
		serverError(w, err)
		return
	}
	for _, h := range dups {
		flag("charger", h.id, h.label, fmt.Sprintf("Possible duplicate of %q (%.0f m away, different owner)", h.other, h.n), 0.7)
	}
	// Price outliers: more than 3× the median price of private/business chargers.
	outliers, err := collect(`WITH m AS (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_kwh_paise) AS median
			FROM chargers WHERE category <> 'public' AND status IN ('approved','submitted'))
		SELECT c.id, c.name, (m.median / 100)::int::text, c.price_per_kwh_paise / m.median FROM chargers c, m
		WHERE c.category <> 'public' AND c.status IN ('approved','submitted') AND c.price_per_kwh_paise > 3 * m.median`)
	if err != nil {
		serverError(w, err)
		return
	}
	for _, h := range outliers {
		flag("charger", h.id, h.label, fmt.Sprintf("Price is %.1f× the area median (₹%s/kWh)", h.n, h.other), 0.6)
	}
	// Repeated open reports on a charger.
	reported, err := collect(`SELECT c.id, c.name, '', COUNT(*) FROM reports r JOIN chargers c ON c.id = r.target_id
		WHERE r.status = 'open' GROUP BY c.id, c.name HAVING COUNT(*) >= 2`)
	if err != nil {
		serverError(w, err)
		return
	}
	for _, h := range reported {
		flag("charger", h.id, h.label, fmt.Sprintf("%.0f open user reports", h.n), 0.8)
	}
	// Drivers with repeated cancellations in the last 24 hours.
	cancels, err := collect(`SELECT u.id, u.name, '', COUNT(*) FROM booking_events e JOIN users u ON u.id = e.actor_id
		WHERE e.event_type = 'cancelled' AND e.created_at > ? GROUP BY u.id, u.name HAVING COUNT(*) >= 3`, a.now().Unix()-86400)
	if err != nil {
		serverError(w, err)
		return
	}
	for _, h := range cancels {
		flag("user", h.id, h.label, fmt.Sprintf("%.0f cancellations in the last 24 h", h.n), 0.8)
	}

	out := []RiskFlag{}
	for _, f := range flags {
		f.Score = math.Round(f.Score*100) / 100
		out = append(out, *f)
	}
	slices.SortFunc(out, func(x, y RiskFlag) int {
		if x.Score != y.Score {
			if x.Score > y.Score {
				return -1
			}
			return 1
		}
		return strings.Compare(x.TargetLabel, y.TargetLabel)
	})
	writeJSON(w, 200, out)
}

func (a *App) adminStats(w http.ResponseWriter, r *http.Request, u *User) {
	a.expireStale()
	stats := map[string]int64{}
	for key, q := range map[string]string{
		"chargers_live":      `SELECT COUNT(*) FROM chargers WHERE status = 'approved'`,
		"pending_listings":   `SELECT COUNT(*) FROM chargers WHERE status = 'submitted'`,
		"users":              `SELECT COUNT(*) FROM users`,
		"bookings_total":     `SELECT COUNT(*) FROM bookings`,
		"completed_sessions": `SELECT COUNT(*) FROM bookings WHERE status = 'completed'`,
		"open_reports":       `SELECT COUNT(*) FROM reports WHERE status = 'open'`,
		"gmv_paise":          `SELECT COALESCE(SUM(amount_paise), 0) FROM payments WHERE status = 'paid'`,
		"platform_fee_paise": `SELECT COALESCE(SUM(b.service_fee_paise), 0) FROM bookings b WHERE b.status = 'completed'`,
	} {
		var n int64
		if err := a.db.QueryRow(q).Scan(&n); err != nil {
			serverError(w, err)
			return
		}
		stats[key] = n
	}
	writeJSON(w, 200, stats)
}
