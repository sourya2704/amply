package main

import (
	"encoding/json"
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
	if v.Category == "" {
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

// ---- owner: list a new charger (goes straight to "submitted" for admin review) ----

func (a *App) createCharger(w http.ResponseWriter, r *http.Request, u *User) {
	if !u.Has("owner") {
		writeError(w, 403, "FORBIDDEN", "Only owners can list chargers")
		return
	}
	var c seedCharger
	if !readBody(w, r, &c) {
		return
	}
	switch {
	case strings.TrimSpace(c.Name) == "":
		writeError(w, 422, "VALIDATION_ERROR", "name is required")
		return
	case c.Lat < -90 || c.Lat > 90 || c.Lng < -180 || c.Lng > 180 || (c.Lat == 0 && c.Lng == 0):
		writeError(w, 422, "VALIDATION_ERROR", "pick the charger location on the map")
		return
	case !slices.Contains([]string{"CCS2", "TYPE2", "CHADEMO", "GBT"}, c.Connector):
		writeError(w, 422, "VALIDATION_ERROR", "unknown connector")
		return
	case c.Mode != "AC" && c.Mode != "DC":
		writeError(w, 422, "VALIDATION_ERROR", "mode must be AC or DC")
		return
	case c.PowerKW <= 0 || c.PricePerKWhPaise <= 0:
		writeError(w, 422, "VALIDATION_ERROR", "power and price must be positive")
		return
	case len(c.Schedule) == 0:
		writeError(w, 422, "VALIDATION_ERROR", "add at least one availability window")
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
	amen, _ := json.Marshal(nonNil(c.Amenities))
	if _, err := tx.Exec(`INSERT INTO chargers (id, owner_id, name, category, lat, lng, address, approx_area, connector, mode,
		power_kw, price_per_kwh_paise, description, access_instructions, amenities, status, bookable, availability_source, last_updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'submitted',1,'schedule',?)`,
		id, u.ID, c.Name, c.Category, c.Lat, c.Lng, c.Address, c.ApproxArea, c.Connector, c.Mode,
		c.PowerKW, c.PricePerKWhPaise, c.Description, c.AccessInstructions, string(amen), a.now().Unix()); err != nil {
		serverError(w, err)
		return
	}
	if err := insertSchedules(tx, id, c.Schedule); err != nil {
		writeError(w, 422, "VALIDATION_ERROR", err.Error())
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
	if !slices.Contains([]string{"charger", "user", "booking"}, body.TargetType) || body.TargetID == "" || strings.TrimSpace(body.Reason) == "" {
		writeError(w, 422, "VALIDATION_ERROR", "target_type, target_id and reason are required")
		return
	}
	if _, err := a.db.Exec(`INSERT INTO reports (id, reporter_id, target_type, target_id, reason, status, created_at) VALUES (?,?,?,?,?,'open',?)`,
		uuid.NewString(), u.ID, body.TargetType, body.TargetID, body.Reason, a.now().Unix()); err != nil {
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
	res, err := a.db.Exec(`UPDATE chargers SET status = ?, review_note = ? WHERE id = ? AND status = 'submitted'`, to, body.Note, r.PathValue("id"))
	if err != nil {
		serverError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, 409, "INVALID_STATE", "Only submitted listings can be reviewed")
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
	Reason       string `json:"reason"`
	Status       string `json:"status"`
	Resolution   string `json:"resolution"`
	CreatedAt    string `json:"created_at"`
}

func (a *App) adminReports(w http.ResponseWriter, r *http.Request, u *User) {
	rows, err := a.db.Query(`SELECT r.id, u.name, r.target_type, r.target_id, r.reason, r.status, r.resolution, r.created_at,
		COALESCE((SELECT name FROM chargers WHERE id = r.target_id), (SELECT name FROM users WHERE id = r.target_id), r.target_id)
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
		if err := rows.Scan(&rp.ID, &rp.ReporterName, &rp.TargetType, &rp.TargetID, &rp.Reason, &rp.Status, &rp.Resolution, &ts, &rp.TargetLabel); err != nil {
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
	if strings.TrimSpace(body.Resolution) == "" {
		writeError(w, 422, "VALIDATION_ERROR", "Write the resolution outcome")
		return
	}
	res, err := a.db.Exec(`UPDATE reports SET status = 'resolved', resolution = ? WHERE id = ? AND status = 'open'`, body.Resolution, r.PathValue("id"))
	if err != nil {
		serverError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, 409, "INVALID_STATE", "Report is already resolved")
		return
	}
	w.WriteHeader(204)
}

// RiskFlag is a rule-based signal for a human reviewer. Nothing is enforced automatically.
type RiskFlag struct {
	TargetType  string   `json:"target_type"`
	TargetID    string   `json:"target_id"`
	TargetLabel string   `json:"target_label"`
	Score       float64  `json:"score"`
	Signals     []string `json:"signals"`
}

func (a *App) adminRisk(w http.ResponseWriter, r *http.Request, u *User) {
	chargers, err := loadChargers(a.db, "c.status IN ('approved','submitted')")
	if err != nil {
		serverError(w, err)
		return
	}
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

	// Duplicate listings: two chargers within 30 m listed by different owners.
	for i, x := range chargers {
		for _, y := range chargers[i+1:] {
			d := haversineKM(x.Lat, x.Lng, y.Lat, y.Lng) * 1000
			if d < 30 && x.OwnerID != nil && y.OwnerID != nil && *x.OwnerID != *y.OwnerID {
				flag("charger", y.ID, y.Name, fmt.Sprintf("Possible duplicate of %q (%.0f m away, different owner)", x.Name, d), 0.7)
			}
		}
	}
	// Price outliers: more than 3× the median price of private/business chargers.
	var prices []int64
	for _, c := range chargers {
		if c.Category != "public" {
			prices = append(prices, c.PricePerKWhPaise)
		}
	}
	if len(prices) > 2 {
		slices.Sort(prices)
		median := prices[len(prices)/2]
		for _, c := range chargers {
			if c.Category != "public" && c.PricePerKWhPaise > 3*median {
				flag("charger", c.ID, c.Name, fmt.Sprintf("Price ₹%d/kWh is %.1f× the area median (₹%d)",
					c.PricePerKWhPaise/100, float64(c.PricePerKWhPaise)/float64(median), median/100), 0.6)
			}
		}
	}
	// Repeated reports on a charger.
	type count struct {
		id, label string
		n         int
	}
	collect := func(query string, args ...any) ([]count, error) {
		rows, err := a.db.Query(query, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []count
		for rows.Next() {
			var c count
			if err := rows.Scan(&c.id, &c.label, &c.n); err != nil {
				return nil, err
			}
			out = append(out, c)
		}
		return out, rows.Err()
	}
	reported, err := collect(`SELECT r.target_id, c.name, COUNT(*) FROM reports r JOIN chargers c ON c.id = r.target_id
		WHERE r.status = 'open' GROUP BY r.target_id HAVING COUNT(*) >= 2`)
	if err != nil {
		serverError(w, err)
		return
	}
	for _, c := range reported {
		flag("charger", c.id, c.label, fmt.Sprintf("%d open user reports", c.n), 0.8)
	}
	// Drivers with repeated cancellations in the last 24 hours.
	cancels, err := collect(`SELECT e.actor_id, u.name, COUNT(*) FROM booking_events e JOIN users u ON u.id = e.actor_id
		WHERE e.event_type = 'cancelled' AND e.created_at > ? GROUP BY e.actor_id HAVING COUNT(*) >= 3`, a.now().Unix()-86400)
	if err != nil {
		serverError(w, err)
		return
	}
	for _, c := range cancels {
		flag("user", c.id, c.label, fmt.Sprintf("%d cancellations in the last 24 h", c.n), 0.8)
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
	stats := map[string]int{}
	for key, q := range map[string]string{
		"chargers_live":      `SELECT COUNT(*) FROM chargers WHERE status = 'approved'`,
		"pending_listings":   `SELECT COUNT(*) FROM chargers WHERE status = 'submitted'`,
		"bookings_total":     `SELECT COUNT(*) FROM bookings`,
		"completed_sessions": `SELECT COUNT(*) FROM bookings WHERE status = 'completed'`,
		"open_reports":       `SELECT COUNT(*) FROM reports WHERE status = 'open'`,
	} {
		var n int
		if err := a.db.QueryRow(q).Scan(&n); err != nil {
			serverError(w, err)
			return
		}
		stats[key] = n
	}
	writeJSON(w, 200, stats)
}
