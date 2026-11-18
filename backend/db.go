package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	_ "github.com/jackc/pgx/v5/stdlib"
	"golang.org/x/crypto/bcrypt"
)

// DB and Tx wrap database/sql so queries can be written with "?" placeholders;
// they are rewritten to Postgres "$1, $2…" before execution.
type DB struct{ *sql.DB }
type Tx struct{ *sql.Tx }

type querier interface {
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
	Exec(query string, args ...any) (sql.Result, error)
}

func rebind(q string) string {
	var b strings.Builder
	n := 0
	for _, r := range q {
		if r == '?' {
			n++
			b.WriteString("$" + strconv.Itoa(n))
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func (d *DB) Query(q string, args ...any) (*sql.Rows, error) { return d.DB.Query(rebind(q), args...) }
func (d *DB) QueryRow(q string, args ...any) *sql.Row        { return d.DB.QueryRow(rebind(q), args...) }
func (d *DB) Exec(q string, args ...any) (sql.Result, error) { return d.DB.Exec(rebind(q), args...) }
func (d *DB) Begin() (*Tx, error) {
	tx, err := d.DB.Begin()
	return &Tx{tx}, err
}
func (t *Tx) Query(q string, args ...any) (*sql.Rows, error) { return t.Tx.Query(rebind(q), args...) }
func (t *Tx) QueryRow(q string, args ...any) *sql.Row        { return t.Tx.QueryRow(rebind(q), args...) }
func (t *Tx) Exec(q string, args ...any) (sql.Result, error) { return t.Tx.Exec(rebind(q), args...) }

func openDB(url string) (*DB, error) {
	db, err := sql.Open("pgx", url)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(15)
	db.SetConnMaxIdleTime(5 * time.Minute)
	return &DB{db}, db.Ping()
}

// pgCode returns the Postgres SQLSTATE of an error ("" if none).
func pgCode(err error) string {
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		return pe.Code
	}
	return ""
}

const (
	codeExclusionViolation = "23P01" // overlapping booking
	codeUniqueViolation    = "23505"
)

const schema = `
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	seq BIGSERIAL,
	name TEXT NOT NULL,
	email TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	roles TEXT NOT NULL,                  -- comma separated: driver,owner,admin
	created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS vehicles (
	id TEXT PRIMARY KEY,
	seq BIGSERIAL,
	user_id TEXT NOT NULL REFERENCES users(id),
	make TEXT NOT NULL,
	model TEXT NOT NULL,
	category TEXT NOT NULL,
	connectors TEXT NOT NULL,             -- JSON array
	max_ac_kw DOUBLE PRECISION NOT NULL DEFAULT 0,
	max_dc_kw DOUBLE PRECISION NOT NULL DEFAULT 0,
	battery_kwh DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chargers (
	id TEXT PRIMARY KEY,
	owner_id TEXT REFERENCES users(id),
	name TEXT NOT NULL,
	category TEXT NOT NULL,
	lat DOUBLE PRECISION NOT NULL,
	lng DOUBLE PRECISION NOT NULL,
	location GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED,
	address TEXT NOT NULL DEFAULT '',
	approx_area TEXT NOT NULL DEFAULT '',
	connector TEXT NOT NULL,
	mode TEXT NOT NULL,
	power_kw DOUBLE PRECISION NOT NULL,
	price_per_kwh_paise BIGINT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	access_instructions TEXT NOT NULL DEFAULT '',
	amenities TEXT NOT NULL DEFAULT '[]',
	photo_url TEXT,
	status TEXT NOT NULL,                 -- submitted | approved | rejected | paused
	bookable BOOLEAN NOT NULL,
	availability_source TEXT NOT NULL,
	last_updated_at BIGINT NOT NULL,
	rating DOUBLE PRECISION NOT NULL DEFAULT 0,
	review_count INTEGER NOT NULL DEFAULT 0,
	review_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS chargers_location_gix ON chargers USING GIST (location);
CREATE TABLE IF NOT EXISTS schedules (
	charger_id TEXT NOT NULL REFERENCES chargers(id) ON DELETE CASCADE,
	weekday INTEGER NOT NULL,             -- 0 = Monday
	start_min INTEGER NOT NULL,           -- minutes after midnight IST
	end_min INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
	id TEXT PRIMARY KEY,
	charger_id TEXT NOT NULL REFERENCES chargers(id),
	driver_id TEXT NOT NULL REFERENCES users(id),
	vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
	start_ts BIGINT NOT NULL,
	end_ts BIGINT NOT NULL,
	status TEXT NOT NULL,
	energy_kwh DOUBLE PRECISION NOT NULL,
	energy_cost_paise BIGINT NOT NULL,
	service_fee_paise BIGINT NOT NULL,
	tax_paise BIGINT NOT NULL,
	total_paise BIGINT NOT NULL,
	idempotency_key TEXT,
	created_at BIGINT NOT NULL,
	status_changed_at BIGINT NOT NULL,
	UNIQUE (driver_id, idempotency_key),
	-- The database itself guarantees no two active bookings overlap on one charger.
	CONSTRAINT bookings_no_overlap EXCLUDE USING gist (charger_id WITH =, int8range(start_ts, end_ts) WITH &&)
		WHERE (status IN ('requested', 'accepted', 'confirmed', 'in_progress'))
);
CREATE TABLE IF NOT EXISTS booking_events (
	id TEXT PRIMARY KEY,
	seq BIGSERIAL,
	booking_id TEXT NOT NULL REFERENCES bookings(id),
	actor_id TEXT NOT NULL,
	event_type TEXT NOT NULL,
	metadata TEXT NOT NULL DEFAULT '{}',
	created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
	id TEXT PRIMARY KEY,
	booking_id TEXT NOT NULL REFERENCES bookings(id),
	provider TEXT NOT NULL,               -- razorpay | mock
	provider_order_id TEXT NOT NULL UNIQUE,
	provider_payment_id TEXT,
	amount_paise BIGINT NOT NULL,
	status TEXT NOT NULL,                 -- created | paid | refunded
	created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS refunds (
	id TEXT PRIMARY KEY,
	payment_id TEXT NOT NULL REFERENCES payments(id),
	provider_ref TEXT NOT NULL,
	amount_paise BIGINT NOT NULL,
	status TEXT NOT NULL,
	created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS payouts (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL REFERENCES users(id),
	booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id),
	amount_paise BIGINT NOT NULL,
	status TEXT NOT NULL,                 -- pending | paid
	created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
	id TEXT PRIMARY KEY,
	booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id),
	charger_id TEXT NOT NULL REFERENCES chargers(id),
	author_id TEXT NOT NULL REFERENCES users(id),
	rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
	comment TEXT NOT NULL DEFAULT '',
	created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
	id TEXT PRIMARY KEY,
	reporter_id TEXT NOT NULL REFERENCES users(id),
	target_type TEXT NOT NULL,            -- charger | user | booking
	target_id TEXT NOT NULL,
	category TEXT NOT NULL DEFAULT 'report',
	reason TEXT NOT NULL,
	status TEXT NOT NULL,                 -- open | resolved
	resolution TEXT NOT NULL DEFAULT '',
	created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
	id TEXT PRIMARY KEY,
	seq BIGSERIAL,
	user_id TEXT NOT NULL REFERENCES users(id),
	type TEXT NOT NULL,
	title TEXT NOT NULL,
	body TEXT NOT NULL DEFAULT '',
	link TEXT NOT NULL DEFAULT '',
	read BOOLEAN NOT NULL DEFAULT FALSE,
	created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, seq DESC);
CREATE TABLE IF NOT EXISTS audit_logs (
	id TEXT PRIMARY KEY,
	seq BIGSERIAL,
	actor_id TEXT NOT NULL,
	action TEXT NOT NULL,
	resource_type TEXT NOT NULL,
	resource_id TEXT NOT NULL,
	details TEXT NOT NULL DEFAULT '{}',
	created_at BIGINT NOT NULL
);
`

var allTables = []string{"audit_logs", "notifications", "reports", "reviews", "payouts", "refunds", "payments",
	"booking_events", "bookings", "schedules", "chargers", "vehicles", "users"}

func migrate(db *DB) error {
	_, err := db.DB.Exec(schema)
	return err
}

func resetDB(db *DB) error {
	_, err := db.DB.Exec("DROP TABLE IF EXISTS " + strings.Join(allTables, ", ") + " CASCADE")
	return err
}

func isEmpty(db *DB) (bool, error) {
	var n int
	err := db.QueryRow("SELECT COUNT(*) FROM users").Scan(&n)
	return n == 0, err
}

// bcryptCost is lowered in tests to keep reseeding fast.
var bcryptCost = bcrypt.DefaultCost

func hashPassword(pw string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(pw), bcryptCost)
	return string(h), err
}

// ---- seed files (format documented in docs/api-contract.md) ----

type seedUser struct {
	Name     string   `json:"name"`
	Email    string   `json:"email"`
	Password string   `json:"password"`
	Roles    []string `json:"roles"`
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

func seed(db *DB, dir string) error {
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
		if u.Password == "" {
			return fmt.Errorf("user %s: password is required", u.Email)
		}
		hash, err := hashPassword(u.Password)
		if err != nil {
			return err
		}
		id := uuid.NewString()
		userIDs[u.Email] = id
		if _, err := tx.Exec(`INSERT INTO users (id, name, email, password_hash, roles, created_at) VALUES (?,?,?,?,?,?)`,
			id, u.Name, u.Email, hash, strings.Join(u.Roles, ","), now.Unix()); err != nil {
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

func insertSchedules(tx *Tx, chargerID string, schedule []seedSchedule) error {
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
