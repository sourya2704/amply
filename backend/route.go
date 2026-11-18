package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Route planning (PRD Journey C): road route from OSRM when reachable, otherwise a clearly labelled estimate.
// Charging stops are found with PostGIS: approved chargers within 2 km of the route line, in route order.

type RoutePlan struct {
	DistanceKM       float64          `json:"distance_km"`
	DurationMin      float64          `json:"duration_min"`
	Polyline         [][2]float64     `json:"polyline"` // [lat, lng]
	EstimatedRangeKM *float64         `json:"estimated_range_km"`
	NeedsCharge      *bool            `json:"needs_charge"`
	SuggestedStops   []ChargerSummary `json:"suggested_stops"`
	Assumptions      []string         `json:"assumptions"`
	Source           string           `json:"source"` // "osrm" or "estimate"
}

const routeCorridorMeters = 2000

func (a *App) osrmRoute(fromLat, fromLng, toLat, toLng float64) (distKM, durMin float64, line [][2]float64, err error) {
	if a.cfg.RouteURL == "" {
		return 0, 0, nil, fmt.Errorf("routing disabled")
	}
	url := fmt.Sprintf("%s/route/v1/driving/%f,%f;%f,%f?overview=full&geometries=geojson", a.cfg.RouteURL, fromLng, fromLat, toLng, toLat)
	client := &http.Client{Timeout: 8 * time.Second}
	res, err := client.Get(url)
	if err != nil {
		return 0, 0, nil, err
	}
	defer res.Body.Close()
	var out struct {
		Code   string `json:"code"`
		Routes []struct {
			Distance float64 `json:"distance"`
			Duration float64 `json:"duration"`
			Geometry struct {
				Coordinates [][2]float64 `json:"coordinates"` // [lng, lat]
			} `json:"geometry"`
		} `json:"routes"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return 0, 0, nil, err
	}
	if out.Code != "Ok" || len(out.Routes) == 0 {
		return 0, 0, nil, fmt.Errorf("osrm: %s", out.Code)
	}
	r := out.Routes[0]
	for _, c := range r.Geometry.Coordinates {
		line = append(line, [2]float64{c[1], c[0]})
	}
	return r.Distance / 1000, r.Duration / 60, line, nil
}

func (a *App) planRoute(w http.ResponseWriter, r *http.Request, u *User) {
	q := r.URL.Query()
	fromLat, fromLng := floatParam(q.Get("from_lat"), 999), floatParam(q.Get("from_lng"), 999)
	toLat, toLng := floatParam(q.Get("to_lat"), 999), floatParam(q.Get("to_lng"), 999)
	for _, v := range []float64{fromLat, toLat} {
		if v < -90 || v > 90 {
			writeError(w, 422, "VALIDATION_ERROR", "from_lat, from_lng, to_lat, to_lng are required")
			return
		}
	}
	for _, v := range []float64{fromLng, toLng} {
		if v < -180 || v > 180 {
			writeError(w, 422, "VALIDATION_ERROR", "from_lat, from_lng, to_lat, to_lng are required")
			return
		}
	}
	v, ok := a.optionalVehicle(w, r, u)
	if !ok {
		return
	}
	battery := floatParam(q.Get("battery_pct"), -1)
	plan, err := a.buildRoute(fromLat, fromLng, toLat, toLng, v, battery)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, 200, plan)
}

func (a *App) buildRoute(fromLat, fromLng, toLat, toLng float64, v *Vehicle, battery float64) (*RoutePlan, error) {
	plan := &RoutePlan{Source: "osrm", Assumptions: []string{}, SuggestedStops: []ChargerSummary{}}
	dist, dur, line, err := a.osrmRoute(fromLat, fromLng, toLat, toLng)
	if err != nil {
		straight := haversineKM(fromLat, fromLng, toLat, toLng)
		dist, dur = straight*1.3, straight*1.3/25*60
		line = [][2]float64{{fromLat, fromLng}, {toLat, toLng}}
		plan.Source = "estimate"
		plan.Assumptions = append(plan.Assumptions, "Road routing unavailable: distance estimated as 1.3× straight line at 25 km/h city speed")
	}
	plan.DistanceKM, plan.DurationMin, plan.Polyline = round1(dist), float64(int(dur+0.5)), line

	if v != nil && v.BatteryKWh > 0 {
		if battery < 0 || battery > 100 {
			battery = 50
			plan.Assumptions = append(plan.Assumptions, "Battery level not given: assumed 50%")
		}
		eff := 6.0 // km per kWh, conservative for a car in city traffic
		if v.Category == "two_wheeler" {
			eff = 25
		}
		rng := round1(v.BatteryKWh * battery / 100 * eff * 0.9)
		needs := rng < plan.DistanceKM
		plan.EstimatedRangeKM, plan.NeedsCharge = &rng, &needs
		plan.Assumptions = append(plan.Assumptions,
			fmt.Sprintf("Range assumes %g km/kWh and keeps a 10%% reserve; real range varies with speed, AC use and traffic", eff))
	} else {
		plan.Assumptions = append(plan.Assumptions, "No vehicle selected: range and compatibility unknown")
	}

	// Simplify the line to at most ~300 points, then ask PostGIS for chargers near it, in route order.
	step := max(1, len(line)/300)
	var pts []string
	for i := 0; i < len(line); i += step {
		pts = append(pts, fmt.Sprintf("%f %f", line[i][1], line[i][0]))
	}
	last := line[len(line)-1]
	pts = append(pts, fmt.Sprintf("%f %f", last[1], last[0]))
	wkt := "SRID=4326;LINESTRING(" + strings.Join(pts, ",") + ")"
	chargers, err := loadChargers(a.db, `c.status = 'approved' AND ST_DWithin(c.location, ST_GeogFromText(?), ?)
		ORDER BY ST_LineLocatePoint(ST_GeomFromEWKT(?), c.location::geometry)`, wkt, routeCorridorMeters, wkt)
	if err != nil {
		return nil, err
	}
	from := &[2]float64{fromLat, fromLng}
	for _, c := range chargers {
		s := a.summary(c, v, from, false)
		if s.Compatibility == "incompatible" {
			continue
		}
		plan.SuggestedStops = append(plan.SuggestedStops, s)
		if len(plan.SuggestedStops) == 8 {
			break
		}
	}
	return plan, nil
}
