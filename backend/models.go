package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// ---- API shapes (docs/api-contract.md §2) ----

type User struct {
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	Email string   `json:"email"`
	Roles []string `json:"roles"`
}

func (u *User) Has(role string) bool {
	for _, r := range u.Roles {
		if r == role {
			return true
		}
	}
	return false
}

type Vehicle struct {
	ID         string   `json:"id"`
	Make       string   `json:"make"`
	Model      string   `json:"model"`
	Category   string   `json:"category"`
	Connectors []string `json:"connectors"`
	MaxACKW    float64  `json:"max_ac_kw"`
	MaxDCKW    float64  `json:"max_dc_kw"`
	BatteryKWh float64  `json:"battery_kwh"`
}

type Availability struct {
	Source        string `json:"source"`
	LastUpdatedAt string `json:"last_updated_at"`
	Label         string `json:"label"`
}

type ChargerSummary struct {
	ID                  string       `json:"id"`
	Name                string       `json:"name"`
	Category            string       `json:"category"`
	Lat                 float64      `json:"lat"`
	Lng                 float64      `json:"lng"`
	ApproxArea          string       `json:"approx_area"`
	DistanceKM          *float64     `json:"distance_km"`
	Connector           string       `json:"connector"`
	Mode                string       `json:"mode"`
	PowerKW             float64      `json:"power_kw"`
	EffectivePowerKW    *float64     `json:"effective_power_kw"`
	PricePerKWhPaise    int64        `json:"price_per_kwh_paise"`
	Bookable            bool         `json:"bookable"`
	Availability        Availability `json:"availability"`
	Compatibility       string       `json:"compatibility"`
	CompatibilityReason string       `json:"compatibility_reason"`
	Rating              float64      `json:"rating"`
	ReviewCount         int          `json:"review_count"`
}

type ScheduleOut struct {
	Weekday   int    `json:"weekday"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
}

type ChargerDetail struct {
	ChargerSummary
	Description        string        `json:"description"`
	OwnerName          *string       `json:"owner_name"`
	Amenities          []string      `json:"amenities"`
	PhotoURL           *string       `json:"photo_url"`
	Status             string        `json:"status"`
	Address            *string       `json:"address"`
	AccessInstructions *string       `json:"access_instructions"`
	Schedule           []ScheduleOut `json:"schedule"`
}

type PriceBreakdown struct {
	EnergyKWh       float64  `json:"energy_kwh"`
	EnergyCostPaise int64    `json:"energy_cost_paise"`
	ServiceFeePaise int64    `json:"service_fee_paise"`
	TaxPaise        int64    `json:"tax_paise"`
	TotalPaise      int64    `json:"total_paise"`
	Assumptions     []string `json:"assumptions"`
}

type Slot struct {
	StartAt   string `json:"start_at"`
	EndAt     string `json:"end_at"`
	Available bool   `json:"available"`
}

type BookingEvent struct {
	EventType string         `json:"event_type"`
	ActorID   string         `json:"actor_id"`
	CreatedAt string         `json:"created_at"`
	Metadata  map[string]any `json:"metadata"`
}

type Ref struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	ApproxArea string `json:"approx_area,omitempty"`
}

type Booking struct {
	ID                 string         `json:"id"`
	Status             string         `json:"status"`
	Charger            Ref            `json:"charger"`
	Driver             Ref            `json:"driver"`
	VehicleID          string         `json:"vehicle_id"`
	StartAt            string         `json:"start_at"`
	EndAt              string         `json:"end_at"`
	Price              PriceBreakdown `json:"price"`
	PaymentStatus      string         `json:"payment_status"`
	Address            *string        `json:"address"`
	AccessInstructions *string        `json:"access_instructions"`
	Events             []BookingEvent `json:"events"`
	CreatedAt          string         `json:"created_at"`
}

// ---- DB rows ----

type scheduleRule struct {
	Weekday, StartMin, EndMin int
}

type charger struct {
	ID, Name, Category, Address, ApproxArea, Connector, Mode string
	OwnerID, OwnerName, PhotoURL                            *string
	Lat, Lng, PowerKW, Rating                               float64
	PricePerKWhPaise                                        int64
	Description, AccessInstructions, Status, AvailSource    string
	Amenities                                               []string
	Bookable                                                bool
	LastUpdated                                             time.Time
	ReviewCount                                             int
	Schedule                                                []scheduleRule
}

const chargerCols = `c.id, c.owner_id, u.name, c.name, c.category, c.lat, c.lng, c.address, c.approx_area, c.connector, c.mode,
	c.power_kw, c.price_per_kwh_paise, c.description, c.access_instructions, c.amenities, c.photo_url, c.status, c.bookable,
	c.availability_source, c.last_updated_at, c.rating, c.review_count`

type querier interface {
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

func loadChargers(q querier, where string, args ...any) ([]*charger, error) {
	rows, err := q.Query(`SELECT `+chargerCols+` FROM chargers c LEFT JOIN users u ON u.id = c.owner_id WHERE `+where, args...)
	if err != nil {
		return nil, err
	}
	var out []*charger
	byID := map[string]*charger{}
	for rows.Next() {
		c := &charger{}
		var amen string
		var updated int64
		if err := rows.Scan(&c.ID, &c.OwnerID, &c.OwnerName, &c.Name, &c.Category, &c.Lat, &c.Lng, &c.Address, &c.ApproxArea,
			&c.Connector, &c.Mode, &c.PowerKW, &c.PricePerKWhPaise, &c.Description, &c.AccessInstructions, &amen, &c.PhotoURL,
			&c.Status, &c.Bookable, &c.AvailSource, &updated, &c.Rating, &c.ReviewCount); err != nil {
			rows.Close()
			return nil, err
		}
		_ = json.Unmarshal([]byte(amen), &c.Amenities)
		c.Amenities = nonNil(c.Amenities)
		c.LastUpdated = time.Unix(updated, 0)
		out = append(out, c)
		byID[c.ID] = c
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(out) == 0 {
		return out, err
	}

	srows, err := q.Query(`SELECT charger_id, weekday, start_min, end_min FROM schedules ORDER BY weekday, start_min`)
	if err != nil {
		return nil, err
	}
	defer srows.Close()
	for srows.Next() {
		var id string
		var r scheduleRule
		if err := srows.Scan(&id, &r.Weekday, &r.StartMin, &r.EndMin); err != nil {
			return nil, err
		}
		if c, ok := byID[id]; ok {
			c.Schedule = append(c.Schedule, r)
		}
	}
	return out, srows.Err()
}

func loadCharger(q querier, id string) (*charger, error) {
	cs, err := loadChargers(q, "c.id = ?", id)
	if err != nil || len(cs) == 0 {
		return nil, err
	}
	return cs[0], nil
}

func loadVehicle(q querier, id, userID string) (*Vehicle, error) {
	v := &Vehicle{}
	var conns string
	err := q.QueryRow(`SELECT id, make, model, category, connectors, max_ac_kw, max_dc_kw, battery_kwh FROM vehicles WHERE id = ? AND user_id = ?`,
		id, userID).Scan(&v.ID, &v.Make, &v.Model, &v.Category, &conns, &v.MaxACKW, &v.MaxDCKW, &v.BatteryKWh)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(conns), &v.Connectors)
	v.Connectors = nonNil(v.Connectors)
	return v, nil
}

func loadUser(q querier, id string) (*User, error) {
	u := &User{}
	var roles string
	err := q.QueryRow(`SELECT id, name, email, roles FROM users WHERE id = ?`, id).Scan(&u.ID, &u.Name, &u.Email, &roles)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	u.Roles = strings.Split(roles, ",")
	return u, nil
}

// ---- conversions ----

func (a *App) summary(c *charger, v *Vehicle, from *[2]float64, exactLocation bool) ChargerSummary {
	compat, reason, eff := compatibility(v, c)
	s := ChargerSummary{
		ID: c.ID, Name: c.Name, Category: c.Category, Lat: c.Lat, Lng: c.Lng, ApproxArea: c.ApproxArea,
		Connector: c.Connector, Mode: c.Mode, PowerKW: c.PowerKW, EffectivePowerKW: eff,
		PricePerKWhPaise: c.PricePerKWhPaise, Bookable: c.Bookable,
		Availability:  availabilityFor(c.AvailSource, c.LastUpdated, a.now()),
		Compatibility: compat, CompatibilityReason: reason, Rating: c.Rating, ReviewCount: c.ReviewCount,
	}
	if from != nil {
		d := round1(haversineKM(from[0], from[1], c.Lat, c.Lng))
		s.DistanceKM = &d
	}
	// Private home locations are blurred (~100 m) until a booking is confirmed.
	if c.Category == "private" && !exactLocation {
		s.Lat, s.Lng = round3(c.Lat), round3(c.Lng)
	}
	return s
}

func (a *App) detail(c *charger, v *Vehicle, from *[2]float64, reveal bool) ChargerDetail {
	d := ChargerDetail{
		ChargerSummary: a.summary(c, v, from, reveal),
		Description:    c.Description, OwnerName: c.OwnerName, Amenities: c.Amenities, PhotoURL: c.PhotoURL,
		Status: c.Status, Schedule: []ScheduleOut{},
	}
	if reveal {
		d.Address, d.AccessInstructions = &c.Address, &c.AccessInstructions
	}
	for _, r := range c.Schedule {
		d.Schedule = append(d.Schedule, ScheduleOut{r.Weekday, hhmm(r.StartMin), hhmm(r.EndMin)})
	}
	return d
}

func hhmm(min int) string { return fmt.Sprintf("%02d:%02d", min/60, min%60) }
