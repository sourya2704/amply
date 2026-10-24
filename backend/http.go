package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
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

	mux.Handle("/api/agent/", a.agentProxy())

	return logRequests(cors(a.cfg.CORSOrigins, mux))
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
	rows, err := a.db.Query(`SELECT id FROM users ORDER BY email`)
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

// ---- agent proxy: P3's Python service lives behind /api/agent/* so the frontend uses one base URL ----

func (a *App) agentProxy() http.Handler {
	target, err := url.Parse(a.cfg.AgentURL)
	if err != nil {
		log.Fatalf("bad AGENT_URL: %v", err)
	}
	p := httputil.NewSingleHostReverseProxy(target)
	p.ModifyResponse = func(res *http.Response) error {
		for k := range res.Header {
			if strings.HasPrefix(k, "Access-Control-") {
				res.Header.Del(k) // CORS is handled here, not by the agent
			}
		}
		return nil
	}
	p.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("agent proxy: %v", err)
		writeError(w, 502, "AGENT_UNAVAILABLE", "The AI assistant is not running right now")
	}
	return p
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
