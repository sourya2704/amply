package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	// One connection = every write transaction is serialized, which is what makes
	// the overlap check + insert in createBooking race-free.
	db.SetMaxOpenConns(1)
	return db, db.Ping()
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	email TEXT NOT NULL UNIQUE,
	roles TEXT NOT NULL,              -- comma separated: driver,owner,admin
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS vehicles (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id),
	make TEXT NOT NULL,
	model TEXT NOT NULL,
	category TEXT NOT NULL,
	connectors TEXT NOT NULL,         -- JSON array
	max_ac_kw REAL NOT NULL DEFAULT 0,
	max_dc_kw REAL NOT NULL DEFAULT 0,
	battery_kwh REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chargers (
	id TEXT PRIMARY KEY,
	owner_id TEXT REFERENCES users(id),
	name TEXT NOT NULL,
	category TEXT NOT NULL,
	lat REAL NOT NULL,
	lng REAL NOT NULL,
	address TEXT NOT NULL DEFAULT '',
	approx_area TEXT NOT NULL DEFAULT '',
	connector TEXT NOT NULL,
	mode TEXT NOT NULL,
	power_kw REAL NOT NULL,
	price_per_kwh_paise INTEGER NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	access_instructions TEXT NOT NULL DEFAULT '',
	amenities TEXT NOT NULL DEFAULT '[]',
	photo_url TEXT,
	status TEXT NOT NULL,
	bookable INTEGER NOT NULL,
	availability_source TEXT NOT NULL,
	last_updated_at INTEGER NOT NULL,
	rating REAL NOT NULL DEFAULT 0,
	review_count INTEGER NOT NULL DEFAULT 0,
	review_note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS schedules (
	charger_id TEXT NOT NULL REFERENCES chargers(id),
	weekday INTEGER NOT NULL,         -- 0 = Monday
	start_min INTEGER NOT NULL,       -- minutes after midnight IST
	end_min INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
	id TEXT PRIMARY KEY,
	charger_id TEXT NOT NULL REFERENCES chargers(id),
	driver_id TEXT NOT NULL REFERENCES users(id),
	vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
	start_ts INTEGER NOT NULL,
	end_ts INTEGER NOT NULL,
	status TEXT NOT NULL,
	energy_kwh REAL NOT NULL,
	energy_cost_paise INTEGER NOT NULL,
	service_fee_paise INTEGER NOT NULL,
	tax_paise INTEGER NOT NULL,
	total_paise INTEGER NOT NULL,
	idempotency_key TEXT,
	created_at INTEGER NOT NULL,
	UNIQUE (driver_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS bookings_charger_time ON bookings (charger_id, start_ts, end_ts);
CREATE TABLE IF NOT EXISTS booking_events (
	id TEXT PRIMARY KEY,
	booking_id TEXT NOT NULL REFERENCES bookings(id),
	actor_id TEXT NOT NULL,
	event_type TEXT NOT NULL,
	metadata TEXT NOT NULL DEFAULT '{}',
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
	id TEXT PRIMARY KEY,
	reporter_id TEXT NOT NULL REFERENCES users(id),
	target_type TEXT NOT NULL,        -- charger | user | booking
	target_id TEXT NOT NULL,
	reason TEXT NOT NULL,
	status TEXT NOT NULL,             -- open | resolved
	resolution TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
	id TEXT PRIMARY KEY,
	booking_id TEXT NOT NULL REFERENCES bookings(id),
	amount_paise INTEGER NOT NULL,
	status TEXT NOT NULL,
	provider_ref TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
`

func migrate(db *sql.DB) error {
	_, err := db.Exec(schema)
	return err
}

func resetDB(db *sql.DB) error {
	for _, t := range []string{"reports", "payments", "booking_events", "bookings", "schedules", "chargers", "vehicles", "users"} {
		if _, err := db.Exec("DROP TABLE IF EXISTS " + t); err != nil {
			return err
		}
	}
	return nil
}

func isEmpty(db *sql.DB) (bool, error) {
	var n int
	err := db.QueryRow("SELECT COUNT(*) FROM users").Scan(&n)
	return n == 0, err
}

// ---- seed files (format documented in docs/api-contract.md §4) ----

type seedUser struct {
	Name  string   `json:"name"`
	Email string   `json:"email"`
	Roles []string `json:"roles"`
}

type seedVehicle struct {
	OwnerEmail string   `json:"owner_email"`
	Make       string   `json:"make"`
	Model      string   `json:"model"`
	Category   string   `json:"category"`
	Connectors []string `json:"connectors"`
	MaxACKW    float64  `json:"max_ac_kw"`
	MaxDCKW    float64  `json:"max_dc_kw"`
	BatteryKWh float64  `json:"battery_kwh"`
}

type seedSchedule struct {
	Weekdays  []int  `json:"weekdays"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
}

type seedCharger struct {
	OwnerEmail         *string        `json:"owner_email"`
	Name               string         `json:"name"`
	Category           string         `json:"category"`
	Lat                float64        `json:"lat"`
	Lng                float64        `json:"lng"`
	Address            string         `json:"address"`
	ApproxArea         string         `json:"approx_area"`
	Connector          string         `json:"connector"`
	Mode               string         `json:"mode"`
	PowerKW            float64        `json:"power_kw"`
	PricePerKWhPaise   int64          `json:"price_per_kwh_paise"`
	Description        string         `json:"description"`
	AccessInstructions string         `json:"access_instructions"`
	Amenities          []string       `json:"amenities"`
	PhotoURL           *string        `json:"photo_url"`
	Status             string         `json:"status"`
	Bookable           bool           `json:"bookable"`
	AvailabilitySource string         `json:"availability_source"`
	UpdatedMinutesAgo  int            `json:"updated_minutes_ago"`
	Rating             float64        `json:"rating"`
	ReviewCount        int            `json:"review_count"`
	Schedule           []seedSchedule `json:"schedule"`
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(b, v); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	return nil
}

func seed(db *sql.DB, dir string) error {
	var users []seedUser
	var vehicles []seedVehicle
	var chargers []seedCharger
	if err := readJSON(filepath.Join(dir, "users.json"), &users); err != nil {
		return err
	}
	if err := readJSON(filepath.Join(dir, "vehicles.json"), &vehicles); err != nil {
		return err
	}
	if err := readJSON(filepath.Join(dir, "chargers.json"), &chargers); err != nil {
		return err
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now()
	userIDs := map[string]string{}
	for _, u := range users {
		id := uuid.NewString()
		userIDs[u.Email] = id
		if _, err := tx.Exec(`INSERT INTO users (id, name, email, roles, created_at) VALUES (?,?,?,?,?)`,
			id, u.Name, u.Email, strings.Join(u.Roles, ","), now.Unix()); err != nil {
			return fmt.Errorf("user %s: %w", u.Email, err)
		}
	}
	for _, v := range vehicles {
		uid, ok := userIDs[v.OwnerEmail]
		if !ok {
			return fmt.Errorf("vehicle %s %s: unknown owner_email %q", v.Make, v.Model, v.OwnerEmail)
		}
		conns, _ := json.Marshal(v.Connectors)
		if _, err := tx.Exec(`INSERT INTO vehicles (id, user_id, make, model, category, connectors, max_ac_kw, max_dc_kw, battery_kwh)
			VALUES (?,?,?,?,?,?,?,?,?)`, uuid.NewString(), uid, v.Make, v.Model, v.Category, string(conns), v.MaxACKW, v.MaxDCKW, v.BatteryKWh); err != nil {
			return err
		}
	}
	for _, c := range chargers {
		var owner any
		if c.OwnerEmail != nil {
			uid, ok := userIDs[*c.OwnerEmail]
			if !ok {
				return fmt.Errorf("charger %q: unknown owner_email %q", c.Name, *c.OwnerEmail)
			}
			owner = uid
		}
		if c.Status == "" {
			c.Status = "approved"
		}
		if c.AvailabilitySource == "" {
			c.AvailabilitySource = "unknown"
		}
		amen, _ := json.Marshal(nonNil(c.Amenities))
		id := uuid.NewString()
		updated := now.Add(-time.Duration(c.UpdatedMinutesAgo) * time.Minute).Unix()
		if _, err := tx.Exec(`INSERT INTO chargers (id, owner_id, name, category, lat, lng, address, approx_area, connector, mode,
			power_kw, price_per_kwh_paise, description, access_instructions, amenities, photo_url, status, bookable,
			availability_source, last_updated_at, rating, review_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			id, owner, c.Name, c.Category, c.Lat, c.Lng, c.Address, c.ApproxArea, c.Connector, c.Mode,
			c.PowerKW, c.PricePerKWhPaise, c.Description, c.AccessInstructions, string(amen), c.PhotoURL, c.Status, c.Bookable,
			c.AvailabilitySource, updated, c.Rating, c.ReviewCount); err != nil {
			return fmt.Errorf("charger %q: %w", c.Name, err)
		}
		if err := insertSchedules(tx, id, c.Schedule); err != nil {
			return fmt.Errorf("charger %q: %w", c.Name, err)
		}
	}
	return tx.Commit()
}

func insertSchedules(tx *sql.Tx, chargerID string, schedule []seedSchedule) error {
	for _, s := range schedule {
		start, err1 := parseHHMM(s.StartTime)
		end, err2 := parseHHMM(s.EndTime)
		if err1 != nil || err2 != nil || end <= start {
			return fmt.Errorf("bad schedule %s-%s", s.StartTime, s.EndTime)
		}
		for _, wd := range s.Weekdays {
			if wd < 0 || wd > 6 {
				return fmt.Errorf("bad weekday %d", wd)
			}
			if _, err := tx.Exec(`INSERT INTO schedules (charger_id, weekday, start_min, end_min) VALUES (?,?,?,?)`, chargerID, wd, start, end); err != nil {
				return err
			}
		}
	}
	return nil
}

// parseHHMM turns "08:00" into minutes after midnight; "24:00" is allowed as end of day.
func parseHHMM(s string) (int, error) {
	h, m, ok := strings.Cut(s, ":")
	if !ok {
		return 0, fmt.Errorf("bad time %q", s)
	}
	hh, err1 := strconv.Atoi(h)
	mm, err2 := strconv.Atoi(m)
	if err1 != nil || err2 != nil || hh < 0 || hh > 24 || mm < 0 || mm > 59 || (hh == 24 && mm != 0) {
		return 0, fmt.Errorf("bad time %q", s)
	}
	return hh*60 + mm, nil
}

func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}
