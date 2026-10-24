package main

import (
	"fmt"
	"math"
	"slices"
	"time"
)

// ---- availability ----

const staleAfter = 24 * time.Hour

func availabilityFor(source string, lastUpdated, now time.Time) Availability {
	if source != "unknown" && source != "live" && now.Sub(lastUpdated) > staleAfter {
		source = "stale"
	}
	label := map[string]string{
		"live":     "Live",
		"schedule": "Schedule-based (owner hours)",
		"stale":    "Stale — may be outdated",
		"unknown":  "Availability unconfirmed",
	}[source]
	if source == "reported" {
		label = fmt.Sprintf("Reported %d min ago", int(now.Sub(lastUpdated).Minutes()))
	}
	return Availability{Source: source, LastUpdatedAt: lastUpdated.In(IST).Format(time.RFC3339), Label: label}
}

// ---- compatibility (hard filter; the AI never decides this) ----

func compatibility(v *Vehicle, c *charger) (status, reason string, effective *float64) {
	if v == nil {
		return "unknown", "Select a vehicle to check compatibility", nil
	}
	name := v.Make + " " + v.Model
	if len(v.Connectors) == 0 {
		return "unknown", "Connector specs missing for " + name, nil
	}
	if !slices.Contains(v.Connectors, c.Connector) {
		return "incompatible", fmt.Sprintf("%s does not support %s", name, c.Connector), nil
	}
	vehicleMax := v.MaxACKW
	if c.Mode == "DC" {
		vehicleMax = v.MaxDCKW
	}
	if vehicleMax <= 0 {
		return "incompatible", fmt.Sprintf("%s does not accept %s charging", name, c.Mode), nil
	}
	eff := math.Min(c.PowerKW, vehicleMax)
	return "compatible", fmt.Sprintf("%s %s supported by %s (max %g kW)", c.Connector, c.Mode, name, vehicleMax), &eff
}

// ---- pricing ----

func priceFor(pricePerKWhPaise int64, kwh float64) PriceBreakdown {
	energy := int64(math.Round(kwh * float64(pricePerKWhPaise)))
	fee := max(energy/10, 1000)
	tax := int64(math.Round(float64(fee) * 0.18))
	return PriceBreakdown{
		EnergyKWh: kwh, EnergyCostPaise: energy, ServiceFeePaise: fee, TaxPaise: tax,
		TotalPaise: energy + fee + tax,
		Assumptions: []string{
			fmt.Sprintf("Estimate assumes %g kWh delivered", kwh),
			"Service fee is 10% of energy cost (min ₹10), GST 18% on the fee",
			"Final charge may differ from the estimate",
		},
	}
}

// ---- distance ----

func haversineKM(lat1, lng1, lat2, lng2 float64) float64 {
	const r = 6371.0
	toRad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat, dLng := toRad(lat2-lat1), toRad(lng2-lng1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(toRad(lat1))*math.Cos(toRad(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return r * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func round1(f float64) float64 { return math.Round(f*10) / 10 }
func round3(f float64) float64 { return math.Round(f*1000) / 1000 }

// ---- slots ----

const slotMinutes = 60

// weekdayIndex returns 0 for Monday … 6 for Sunday.
func weekdayIndex(t time.Time) int { return (int(t.Weekday()) + 6) % 7 }

type span struct{ start, end int64 }

func overlaps(a, b span) bool { return a.start < b.end && b.start < a.end }

// buildSlots returns hourly slots for one IST date, marking past or booked slots unavailable.
func buildSlots(day time.Time, rules []scheduleRule, taken []span, now time.Time) []Slot {
	midnight := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, IST)
	slots := []Slot{}
	for _, r := range rules {
		if r.Weekday != weekdayIndex(midnight) {
			continue
		}
		for m := r.StartMin; m+slotMinutes <= r.EndMin; m += slotMinutes {
			s := midnight.Add(time.Duration(m) * time.Minute)
			e := s.Add(slotMinutes * time.Minute)
			free := s.After(now)
			for _, t := range taken {
				if overlaps(span{s.Unix(), e.Unix()}, t) {
					free = false
					break
				}
			}
			slots = append(slots, Slot{StartAt: s.Format(time.RFC3339), EndAt: e.Format(time.RFC3339), Available: free})
		}
	}
	slices.SortFunc(slots, func(a, b Slot) int {
		if a.StartAt < b.StartAt {
			return -1
		}
		if a.StartAt > b.StartAt {
			return 1
		}
		return 0
	})
	return slots
}

// fitsSchedule reports whether [start,end) lies inside one schedule rule on its IST day.
func fitsSchedule(start, end time.Time, rules []scheduleRule) bool {
	s, e := start.In(IST), end.In(IST)
	if s.YearDay() != e.Add(-time.Second).YearDay() {
		return false
	}
	startMin := s.Hour()*60 + s.Minute()
	endMin := startMin + int(e.Sub(s).Minutes())
	for _, r := range rules {
		if r.Weekday == weekdayIndex(s) && startMin >= r.StartMin && endMin <= r.EndMin {
			return true
		}
	}
	return false
}

// ---- booking state machine ----

// Statuses that hold a charger's time slot.
var blockingStatuses = []string{"requested", "accepted", "confirmed"}

var transitions = map[string]struct {
	from []string
	to   string
}{
	"accept":   {[]string{"requested"}, "accepted"},
	"reject":   {[]string{"requested"}, "rejected"},
	"cancel":   {[]string{"requested", "accepted", "confirmed"}, "cancelled"},
	"pay":      {[]string{"accepted"}, "confirmed"},
	"complete": {[]string{"confirmed"}, "completed"},
}

func revealsAddress(status string) bool { return status == "confirmed" || status == "completed" }
