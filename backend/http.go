package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (a *App) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/auth/demo-users", a.demoUsers)
	mux.HandleFunc("POST /api/auth/login", a.login)

	auth := func(h func(http.ResponseWriter, *http.Request, *User)) http.HandlerFunc { return a.withUser(h) }
	mux.HandleFunc("GET /api/me", auth(func(w http.ResponseWriter, r *http.Request, u *User) { writeJSON(w, 200, u) }))
	mux.HandleFunc("GET /api/vehicles", auth(a.listVehicles))
	mux.HandleFunc("POST /api/vehicles", auth(a.addVehicle))

	mux.HandleFunc("GET /api/chargers/search", auth(a.searchChargers))
	mux.HandleFunc("GET /api/chargers/{id}", auth(a.getCharger))
	mux.HandleFunc("GET /api/chargers/{id}/slots", auth(a.getSlots))
	mux.HandleFunc("GET /api/chargers/{id}/estimate", auth(a.getEstimate))

	mux.HandleFunc("POST /api/bookings", auth(a.createBooking))
	mux.HandleFunc("GET /api/bookings", auth(a.listMyBookings))
	mux.HandleFunc("GET /api/bookings/{id}", auth(a.getBooking))
	mux.HandleFunc("POST /api/bookings/{id}/{action}", auth(a.transitionBooking))

	mux.HandleFunc("GET /api/owner/chargers", auth(a.ownerChargers))
	mux.HandleFunc("GET /api/owner/bookings", auth(a.ownerBookings))
	mux.HandleFunc("POST /api/owner/chargers", auth(a.createCharger))

	mux.HandleFunc("POST /api/reports", auth(a.createReport))

	mux.HandleFunc("GET /api/admin/stats", auth(adminOnly(a.adminStats)))
	mux.HandleFunc("GET /api/admin/chargers", auth(adminOnly(a.adminChargers)))
	mux.HandleFunc("POST /api/admin/chargers/{id}/{decision}", auth(adminOnly(a.reviewCharger)))
	mux.HandleFunc("GET /api/admin/reports", auth(adminOnly(a.adminReports)))
	mux.HandleFunc("POST /api/admin/reports/{id}/resolve", auth(adminOnly(a.resolveReport)))
	mux.HandleFunc("GET /api/admin/risk", auth(adminOnly(a.adminRisk)))

	mux.HandleFunc("POST /api/agent/chat", auth(a.agentChat))
	mux.HandleFunc("POST /api/agent/confirm", auth(a.agentConfirm))

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, 404, "NOT_FOUND", "No such endpoint")
	})
	mux.Handle("/", spa(a.cfg.StaticDir))

	a.handler = logRequests(cors(a.cfg.CORSOrigins, mux))
	return a.handler
}

// ---- auth: signed token "base64(userID).base64(hmac)". Demo login, no passwords (prototype). ----

func (a *App) sign(userID string) string {
	mac := hmac.New(sha256.New, []byte(a.cfg.AuthSecret))
	mac.Write([]byte(userID))
	enc := base64.RawURLEncoding
	return enc.EncodeToString([]byte(userID)) + "." + enc.EncodeToString(mac.Sum(nil))
}

func (a *App) verify(token string) (string, bool) {
	idPart, _, ok := strings.Cut(token, ".")
	if !ok {
		return "", false
	}
	id, err := base64.RawURLEncoding.DecodeString(idPart)
	if err != nil {
		return "", false
	}
	return string(id), hmac.Equal([]byte(a.sign(string(id))), []byte(token))
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

func (a *App) demoUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(`SELECT id FROM users ORDER BY CASE WHEN roles LIKE 'driver%' THEN 0 WHEN roles LIKE 'owner%' THEN 1 ELSE 2 END, rowid`)
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
	users := []*User{}
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

func (a *App) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
	}
	if !readBody(w, r, &body) {
		return
	}
	var id string
	if err := a.db.QueryRow(`SELECT id FROM users WHERE email = ?`, strings.ToLower(strings.TrimSpace(body.Email))).Scan(&id); err != nil {
		writeError(w, 401, "UNAUTHORIZED", "No demo account with that email")
		return
	}
	u, err := loadUser(a.db, id)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"access_token": a.sign(id), "user": u})
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
