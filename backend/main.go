package main

import (
	"bufio"
	"database/sql"
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
	DBPath      string
	SeedDir     string
	StaticDir   string
	AgentModel  string
	AuthSecret  string
	CORSOrigins string
}

type App struct {
	db      *sql.DB
	cfg     Config
	now     func() time.Time
	handler http.Handler      // set by routes(); the agent calls the API through it in-process
	llm     *anthropic.Client // nil → agent runs in offline mode
	pending pendingStore
}

func main() {
	reset := flag.Bool("reset", false, "wipe the database and reload seed data")
	flag.Parse()

	loadDotEnv(".env")
	cfg := Config{
		Port:        env("PORT", "8000"),
		DBPath:      env("DB_PATH", "amply.db"),
		SeedDir:     env("SEED_DIR", "seed"),
		StaticDir:   env("STATIC_DIR", "../frontend/dist"),
		AgentModel:  env("AGENT_MODEL", "claude-opus-5-5"),
		AuthSecret:  env("AUTH_SECRET", "dev-only-secret-change-me"),
		CORSOrigins: env("CORS_ORIGINS", "*"),
	}

	db, err := openDB(cfg.DBPath)
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

	app := &App{db: db, cfg: cfg, now: time.Now}
	mode := "offline mode (set ANTHROPIC_API_KEY for Claude)"
	if os.Getenv("ANTHROPIC_API_KEY") != "" {
		client := anthropic.NewClient()
		app.llm = &client
		mode = "Claude " + cfg.AgentModel
	}
	log.Printf("Amply listening on http://localhost:%s, AI assistant: %s", cfg.Port, mode)
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
