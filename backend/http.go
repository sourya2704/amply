package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

func (a *App) routes() http.Handler {
	mux := http.NewServeMux()
	auth := func(h func(http.ResponseWriter, *http.Request, *User)) http.HandlerFunc { return a.withUser(h) }
	admin := func(h func(http.ResponseWriter, *http.Request, *User)) http.HandlerFunc {
		return a.withUser(adminOnly(h))
	}

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/auth/demo-users", a.demoUsers)
	mux.HandleFunc("POST /api/auth/register", a.authLimiter.wrap(a.register))
	mux.HandleFunc("POST /api/auth/login", a.authLimiter.wrap(a.login))
	mux.HandleFunc("GET /api/me", auth(func(w http.ResponseWriter, r *http.Request, u *User) { writeJSON(w, 200, u) }))

	mux.HandleFunc("GET /api/vehicles", auth(a.listVehicles))
	mux.HandleFunc("POST /api/vehicles", auth(a.addVehicle))

	mux.HandleFunc("GET /api/chargers/search", auth(a.searchChargers))
	mux.HandleFunc("GET /api/chargers/{id}", auth(a.getCharger))
	mux.HandleFunc("GET /api/chargers/{id}/slots", auth(a.getSlots))
	mux.HandleFunc("GET /api/chargers/{id}/estimate", auth(a.getEstimate))
	mux.HandleFunc("GET /api/chargers/{id}/reviews", auth(a.chargerReviews))
	mux.HandleFunc("GET /api/route", auth(a.planRoute))
	mux.HandleFunc("GET /api/geocode", auth(a.geocodeSearch))

	mux.HandleFunc("POST /api/bookings", auth(a.createBooking))
	mux.HandleFunc("GET /api/bookings", auth(a.listMyBookings))
	mux.HandleFunc("GET /api/bookings/{id}", auth(a.getBooking))
	mux.HandleFunc("POST /api/bookings/{id}/review", auth(a.reviewBooking))
	mux.HandleFunc("POST /api/bookings/{id}/support", auth(a.supportCase))
	mux.HandleFunc("POST /api/bookings/{id}/{action}", auth(a.transitionBooking))

	mux.HandleFunc("POST /api/payments/order", auth(a.createPaymentOrder))
	mux.HandleFunc("POST /api/payments/verify", auth(a.verifyPayment))

	mux.HandleFunc("GET /api/owner/chargers", auth(a.ownerChargers))
	mux.HandleFunc("POST /api/owner/chargers", auth(a.createCharger))
	mux.HandleFunc("PATCH /api/owner/chargers/{id}", auth(a.updateCharger))
	mux.HandleFunc("POST /api/owner/chargers/{id}/{action}", auth(a.pauseResumeCharger))
	mux.HandleFunc("GET /api/owner/bookings", auth(a.ownerBookings))
	mux.HandleFunc("GET /api/owner/payouts", auth(a.ownerPayouts))

	mux.HandleFunc("GET /api/notifications", auth(a.listNotifications))
	mux.HandleFunc("POST /api/notifications/read", auth(a.markNotificationsRead))
	mux.HandleFunc("POST /api/reports", auth(a.createReport))

	mux.HandleFunc("GET /api/admin/stats", admin(a.adminStats))
	mux.HandleFunc("GET /api/admin/chargers", admin(a.adminChargers))
	mux.HandleFunc("POST /api/admin/chargers/{id}/{decision}", admin(a.reviewCharger))
	mux.HandleFunc("GET /api/admin/reports", admin(a.adminReports))
	mux.HandleFunc("POST /api/admin/reports/{id}/resolve", admin(a.resolveReport))
	mux.HandleFunc("GET /api/admin/risk", admin(a.adminRisk))
	mux.HandleFunc("GET /api/admin/audit-logs", admin(a.adminAuditLogs))

	mux.HandleFunc("POST /api/agent/chat", auth(a.agentChat))
	mux.HandleFunc("POST /api/agent/confirm", auth(a.agentConfirm))

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, 404, "NOT_FOUND", "No such endpoint")
	})
	mux.Handle("/", spa(a.cfg.StaticDir))

	a.handler = logRequests(securityHeaders(cors(a.cfg.CORSOrigins, mux)))
	return a.handler
}

// ---- auth: password login, signed expiring token "base64(userID|expiry).base64(hmac)" ----

const tokenTTL = 7 * 24 * time.Hour

func (a *App) mac(payload string) string {
	m := hmac.New(sha256.New, []byte(a.cfg.AuthSecret))
	m.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func (a *App) sign(userID string) string {
	payload := base64.RawURLEncoding.EncodeToString([]byte(userID + "|" + strconv.FormatInt(a.now().Add(tokenTTL).Unix(), 10)))
	return payload + "." + a.mac(payload)
}

func (a *App) verify(token string) (string, bool) {
	payload, sig, ok := strings.Cut(token, ".")
	if !ok || !hmac.Equal([]byte(a.mac(payload)), []byte(sig)) {
		return "", false
	}
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return "", false
	}
	id, expStr, ok := strings.Cut(string(raw), "|")
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if !ok || err != nil || a.now().Unix() > exp {
		return "", false
	}
	return id, true
}

type ctxKey struct{}

func (a *App) withUser(h func(http.ResponseWriter, *http.Request, *User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		id, valid := a.verify(token)
		if !ok || !valid {
			writeError(w, 401, "UNAUTHORIZED", "Log in first")
			return
		}
		u, err := loadUser(a.db, id)
		if err != nil {
			serverError(w, err)
			return
		}
		if u == nil {
			writeError(w, 401, "UNAUTHORIZED", "Unknown user")
			return
		}
		h(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, u)), u)
	}
}

// demoUsers lists the seeded demo accounts (emails ending in @amply.test) for the one-click demo login.
// Disabled with DEMO_MODE=false.
func (a *App) demoUsers(w http.ResponseWriter, r *http.Request) {
	users := []*User{}
	if !a.cfg.DemoMode {
		writeJSON(w, 200, users)
		return
	}
	rows, err := a.db.Query(`SELECT id FROM users WHERE email LIKE '%@amply.test'
		ORDER BY CASE WHEN roles LIKE 'driver%' THEN 0 WHEN roles LIKE 'owner%' THEN 1 ELSE 2 END, seq`)
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
	for _, id := range ids {
		u, err := loadUser(a.db, id)
		if err != nil {
			serverError(w, err)
			return
		}
		users = append(users, u)
	}
	writeJSON(w, 200, users)
}

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

func (a *App) register(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string   `json:"name"`
		Email    string   `json:"email"`
		Password string   `json:"password"`
		Roles    []string `json:"roles"`
	}
	if !readBody(w, r, &body) {
		return
	}
	body.Name, body.Email = strings.TrimSpace(body.Name), strings.ToLower(strings.TrimSpace(body.Email))
	switch {
	case body.Name == "" || len(body.Name) > 80:
		writeError(w, 422, "VALIDATION_ERROR", "Enter your name")
		return
	case !emailRe.MatchString(body.Email):
		writeError(w, 422, "VALIDATION_ERROR", "Enter a valid email")
		return
	case len(body.Password) < 8 || len(body.Password) > 72:
		writeError(w, 422, "VALIDATION_ERROR", "Password must be 8 to 72 characters")
		return
	}
	var roles []string
	for _, role := range body.Roles {
		if (role == "driver" || role == "owner") && !slices.Contains(roles, role) {
			roles = append(roles, role)
		}
	}
	if len(roles) == 0 {
		writeError(w, 422, "VALIDATION_ERROR", "Choose driver, owner, or both")
		return
	}
	hash, err := hashPassword(body.Password)
	if err != nil {
		serverError(w, err)
		return
	}
	id := uuid.NewString()
	now := a.now().Unix()
	_, err = a.db.Exec(`INSERT INTO users (id, name, email, password_hash, roles, created_at) VALUES (?,?,?,?,?,?)`,
		id, body.Name, body.Email, hash, strings.Join(roles, ","), now)
	if pgCode(err) == codeUniqueViolation {
		writeError(w, 409, "EMAIL_TAKEN", "An account with this email already exists")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	audit(a.db, id, "user.registered", "user", id, map[string]any{"roles": roles}, now)
	u, err := loadUser(a.db, id)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"access_token": a.sign(id), "user": u})
}

func (a *App) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !readBody(w, r, &body) {
		return
	}
	var id, hash string
	err := a.db.QueryRow(`SELECT id, password_hash FROM users WHERE email = ?`, strings.ToLower(strings.TrimSpace(body.Email))).Scan(&id, &hash)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.Password)) != nil {
		writeError(w, 401, "UNAUTHORIZED", "Wrong email or password")
		return
	}
	u, err := loadUser(a.db, id)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"access_token": a.sign(id), "user": u})
}

// rateLimiter allows `limit` requests per client per minute (PRD §10: rate-limit authentication).
type rateLimiter struct {
	mu     sync.Mutex
	limit  int
	window map[string][]time.Time
}

func newRateLimiter(limit int) *rateLimiter {
	return &rateLimiter{limit: limit, window: map[string][]time.Time{}}
}

func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		ip, _, _ := strings.Cut(fwd, ",")
		return strings.TrimSpace(ip)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (l *rateLimiter) wrap(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip, now := clientIP(r), time.Now()
		l.mu.Lock()
		recent := l.window[ip][:0]
		for _, t := range l.window[ip] {
			if now.Sub(t) < time.Minute {
				recent = append(recent, t)
			}
		}
		allowed := len(recent) < l.limit
		if allowed {
			recent = append(recent, now)
		}
		l.window[ip] = recent
		l.mu.Unlock()
		if !allowed {
			writeError(w, 429, "RATE_LIMITED", "Too many attempts. Wait a minute and try again.")
			return
		}
		h(w, r)
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

// ---- frontend: serve the built React app (frontend/dist) with SPA fallback to index.html ----

func spa(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := os.Stat(filepath.Join(dir, filepath.Clean("/"+r.URL.Path))); err != nil {
			index := filepath.Join(dir, "index.html")
			if _, err := os.Stat(index); err != nil {
				http.Error(w, "Frontend not built. Run: cd frontend && npm run build", 404)
				return
			}
			http.ServeFile(w, r, index)
			return
		}
		files.ServeHTTP(w, r)
	})
}

// ---- helpers ----

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]apiError{"error": {code, msg}})
}

func serverError(w http.ResponseWriter, err error) {
	log.Printf("ERROR: %v", err)
	writeError(w, 500, "SERVER_ERROR", "Something went wrong")
}

func readBody(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := dec.Decode(v); err != nil {
		writeError(w, 422, "VALIDATION_ERROR", "Invalid JSON body: "+err.Error())
		return false
	}
	return true
}

func cors(origins string, next http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, o := range strings.Split(origins, ",") {
		allowed[strings.TrimSpace(o)] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if allowed["*"] {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		} else if allowed[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) { s.status = code; s.ResponseWriter.WriteHeader(code) }

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{w, 200}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s → %d (%s)", r.Method, r.URL.Path, rec.status, time.Since(start).Round(time.Millisecond))
	})
}
