package main

import (
	"bufio"
	"flag"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
)

// IST is used for all slot math and API output. Fixed offset avoids needing tzdata on the server.
var IST = time.FixedZone("IST", 5*3600+30*60)

type Config struct {
	Port        string
	DatabaseURL string
	SeedDir     string
	StaticDir   string
	AgentModel  string
	AuthSecret  string
	CORSOrigins string
	RouteURL    string // OSRM server; empty disables road routing (straight-line estimate)
	DemoMode    bool   // one-click demo accounts on the login page
}

type App struct {
	db          *DB
	cfg         Config
	now         func() time.Time
	handler     http.Handler      // set by routes(); the agent calls the API through it in-process
	llm         *anthropic.Client // nil → assistant runs in offline mode
	pending     pendingStore
	rzp         *razorpay
	authLimiter *rateLimiter
}

func main() {
	reset := flag.Bool("reset", false, "wipe the database and reload seed data")
	flag.Parse()

	loadDotEnv(".env")
	cfg := Config{
		Port:        env("PORT", "8000"),
		DatabaseURL: env("DATABASE_URL", "postgres://amply:amply@localhost:5433/amply?sslmode=disable"),
		SeedDir:     env("SEED_DIR", "seed"),
		StaticDir:   env("STATIC_DIR", "../frontend/dist"),
		AgentModel:  env("AGENT_MODEL", "claude-opus-5-5"),
		AuthSecret:  env("AUTH_SECRET", "dev-only-secret-change-me"),
		CORSOrigins: env("CORS_ORIGINS", "*"),
		RouteURL:    env("ROUTE_URL", "https://router.project-osrm.org"),
		DemoMode:    env("DEMO_MODE", "true") == "true",
	}
	if cfg.AuthSecret == "dev-only-secret-change-me" {
		log.Printf("WARNING: AUTH_SECRET is not set; using an insecure development secret")
	}

	db, err := openDB(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	if *reset {
		if err := resetDB(db); err != nil {
			log.Fatalf("reset db: %v", err)
		}
	}
	if err := migrate(db); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	if empty, err := isEmpty(db); err != nil {
		log.Fatalf("check db: %v", err)
	} else if empty {
		if err := seed(db, cfg.SeedDir); err != nil {
			log.Fatalf("seed: %v", err)
		}
		log.Printf("seeded database from %s/", cfg.SeedDir)
	}

	app := &App{db: db, cfg: cfg, now: time.Now, authLimiter: newRateLimiter(10),
		rzp: newRazorpay(os.Getenv("RAZORPAY_KEY_ID"), os.Getenv("RAZORPAY_KEY_SECRET"))}
	mode := "offline mode (set ANTHROPIC_API_KEY to enable the AI model)"
	if os.Getenv("ANTHROPIC_API_KEY") != "" {
		client := anthropic.NewClient()
		app.llm = &client
		mode = "AI model " + cfg.AgentModel
	}
	payments := "mock (set RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET for Razorpay test mode)"
	if app.rzp.enabled() {
		payments = "Razorpay"
	}
	log.Printf("Amply listening on http://localhost:%s · assistant: %s · payments: %s", cfg.Port, mode, payments)
	log.Fatal(http.ListenAndServe(":"+cfg.Port, app.routes()))
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// loadDotEnv reads KEY=VALUE lines without overriding variables already set.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k, v = strings.TrimSpace(k), strings.Trim(strings.TrimSpace(v), `"'`)
		if os.Getenv(k) == "" {
			os.Setenv(k, v)
		}
	}
}
