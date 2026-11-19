package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Address search for the trip planner, backed by OpenStreetMap Nominatim.
// Nominatim's usage policy requires an identifying User-Agent, at most 1 request per second, and caching,
// so all lookups go through this endpoint instead of the browser calling Nominatim directly.
// Results are limited to the Bengaluru pilot area; if Nominatim is unreachable, known areas are matched locally.

type Place struct {
	Name    string  `json:"name"`
	Address string  `json:"address"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
}

type geocoder struct {
	baseURL   string
	userAgent string
	client    *http.Client

	mu    sync.Mutex
	last  time.Time
	cache map[string]cachedPlaces
}

type cachedPlaces struct {
	places []Place
	at     time.Time
}

const geocodeCacheTTL = 24 * time.Hour

// Bengaluru bounding box: left, top, right, bottom.
const bengaluruViewbox = "77.35,13.25,77.90,12.70"

func newGeocoder(baseURL string) *geocoder {
	return &geocoder{
		baseURL:   strings.TrimRight(baseURL, "/"),
		userAgent: "Amply/1.0 (EV charging marketplace pilot, Bengaluru)",
		client:    &http.Client{Timeout: 6 * time.Second},
		cache:     map[string]cachedPlaces{},
	}
}

func (g *geocoder) search(q string) ([]Place, error) {
	key := strings.ToLower(strings.Join(strings.Fields(q), " "))
	g.mu.Lock()
	if c, ok := g.cache[key]; ok && time.Since(c.at) < geocodeCacheTTL {
		g.mu.Unlock()
		return c.places, nil
	}
	// Respect the 1 request/second policy across all users.
	if wait := time.Second - time.Since(g.last); wait > 0 {
		time.Sleep(wait)
	}
	g.last = time.Now()
	g.mu.Unlock()

	if g.baseURL == "" {
		return nil, fmt.Errorf("geocoding disabled")
	}
	params := url.Values{
		"q": {q}, "format": {"jsonv2"}, "limit": {"6"}, "countrycodes": {"in"},
		"viewbox": {bengaluruViewbox}, "bounded": {"1"}, "accept-language": {"en"},
	}
	req, err := http.NewRequest("GET", g.baseURL+"/search?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", g.userAgent)
	res, err := g.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("nominatim: %s", res.Status)
	}
	var raw []struct {
		Name        string `json:"name"`
		DisplayName string `json:"display_name"`
		Lat         string `json:"lat"`
		Lon         string `json:"lon"`
	}
	if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
		return nil, err
	}
	places := []Place{}
	seen := map[string]bool{}
	for _, r := range raw {
		var lat, lng float64
		if _, err := fmt.Sscan(r.Lat, &lat); err != nil {
			continue
		}
		if _, err := fmt.Sscan(r.Lon, &lng); err != nil {
			continue
		}
		name, rest := r.Name, r.DisplayName
		if name == "" {
			name, rest, _ = strings.Cut(r.DisplayName, ",")
		} else {
			rest = strings.TrimPrefix(strings.TrimPrefix(rest, name), ", ")
		}
		rest = strings.TrimSuffix(strings.TrimSuffix(rest, ", India"), ", Karnataka")
		if seen[name+rest] {
			continue
		}
		seen[name+rest] = true
		places = append(places, Place{Name: strings.TrimSpace(name), Address: strings.TrimSpace(rest), Lat: lat, Lng: lng})
	}
	g.mu.Lock()
	g.cache[key] = cachedPlaces{places, time.Now()}
	g.mu.Unlock()
	return places, nil
}

// localPlaces matches the built-in pilot areas, used when Nominatim can't be reached.
func localPlaces(q string) []Place {
	q = strings.ToLower(q)
	out := []Place{}
	for _, a := range knownAreas {
		if strings.Contains(strings.ToLower(a.name), q) || strings.Contains(a.key, q) {
			out = append(out, Place{Name: a.name, Address: "Bengaluru", Lat: a.lat, Lng: a.lng})
		}
	}
	return out
}

func (a *App) geocodeSearch(w http.ResponseWriter, r *http.Request, u *User) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(q)) < 3 || len(q) > 120 {
		writeJSON(w, 200, map[string]any{"results": []Place{}, "source": "none"})
		return
	}
	places, err := a.geo.search(q)
	if err != nil {
		log.Printf("geocode: %v (using local areas)", err)
		writeJSON(w, 200, map[string]any{"results": localPlaces(q), "source": "local"})
		return
	}
	writeJSON(w, 200, map[string]any{"results": places, "source": "osm"})
}
