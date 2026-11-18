import { useState } from "react";
import { BatteryMedium, Clock, Info, Route as RouteIcon, TriangleAlert } from "lucide-react";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { RoutePlan } from "../lib/types";
import { MapView } from "../components/MapView";
import { Button, Card, ChargerCard, Empty, ErrorNote, PageHeader } from "../components/ui";

export const PLACES = [
  { name: "Koramangala", lat: 12.9352, lng: 77.6245 },
  { name: "HSR Layout", lat: 12.9116, lng: 77.6389 },
  { name: "Indiranagar", lat: 12.9719, lng: 77.6412 },
  { name: "BTM Layout", lat: 12.9166, lng: 77.6101 },
  { name: "Bellandur", lat: 12.9257, lng: 77.6762 },
  { name: "Jayanagar", lat: 12.925, lng: 77.5938 },
  { name: "Whitefield", lat: 12.9698, lng: 77.75 },
  { name: "MG Road", lat: 12.9756, lng: 77.6066 },
  { name: "Marathahalli", lat: 12.9591, lng: 77.6974 },
  { name: "Hebbal", lat: 13.0358, lng: 77.597 },
  { name: "Electronic City", lat: 12.8452, lng: 77.6602 },
  { name: "Kempegowda Airport", lat: 13.1986, lng: 77.7066 },
];

const select = "mt-1 w-full rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-primary";

export default function Trip() {
  const { vehicle } = useAuth();
  const [from, setFrom] = useState(PLACES[0].name);
  const [to, setTo] = useState(PLACES[6].name);
  const [battery, setBattery] = useState(40);
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    const a = PLACES.find((p) => p.name === from)!;
    const b = PLACES.find((p) => p.name === to)!;
    setBusy(true);
    setErr(null);
    try {
      setPlan(
        await api.get<RoutePlan>(
          `/api/route?${qs({ from_lat: a.lat, from_lng: a.lng, to_lat: b.lat, to_lng: b.lng, battery_pct: battery, vehicle_id: vehicle?.id })}`,
        ),
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const center = PLACES.find((p) => p.name === from)!;
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <PageHeader title="Plan a trip" subtitle="See whether your charge covers the drive, and which compatible chargers are along the way." />
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <Card className="space-y-3">
            <label className="block text-sm font-medium">
              From
              <select value={from} onChange={(e) => setFrom(e.target.value)} className={select}>
                {PLACES.map((p) => (
                  <option key={p.name}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              To
              <select value={to} onChange={(e) => setTo(e.target.value)} className={select}>
                {PLACES.map((p) => (
                  <option key={p.name}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Battery now: <b>{battery}%</b>
              <input type="range" min={1} max={100} value={battery} onChange={(e) => setBattery(Number(e.target.value))} className="mt-2 w-full accent-primary" />
            </label>
            <p className="text-xs text-muted">{vehicle ? `Using your ${vehicle.make} ${vehicle.model} (${vehicle.battery_kwh} kWh)` : "Select a vehicle on the search page for range estimates."}</p>
            <ErrorNote message={err} />
            <Button className="w-full" onClick={go} disabled={busy || from === to}>
              <RouteIcon size={16} /> {busy ? "Planning…" : "Plan route"}
            </Button>
          </Card>

          {plan && (
            <Card className="animate-pop space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted">Distance</div>
                  <div className="text-xl font-bold">{plan.distance_km} km</div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-xs text-muted">
                    <Clock size={12} /> Drive time
                  </div>
                  <div className="text-xl font-bold">{Math.round(plan.duration_min)} min</div>
                </div>
              </div>
              {plan.estimated_range_km !== null && (
                <div
                  className={`flex items-start gap-2 rounded-xl p-3 text-sm ring-1 ${plan.needs_charge ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-emerald-50 text-emerald-800 ring-emerald-200"}`}
                >
                  {plan.needs_charge ? <TriangleAlert size={18} className="shrink-0" /> : <BatteryMedium size={18} className="shrink-0" />}
                  <span>
                    Estimated range <b>{plan.estimated_range_km} km</b>.{" "}
                    {plan.needs_charge ? "You'll likely need to charge on the way." : "Should be enough, with a reserve."}
                  </span>
                </div>
              )}
              <ul className="space-y-1 text-xs text-muted">
                {plan.assumptions.map((a) => (
                  <li key={a} className="flex gap-1.5">
                    <Info size={12} className="mt-0.5 shrink-0" /> {a}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="overflow-hidden p-0">
            <MapView center={center} chargers={plan?.suggested_stops ?? []} route={plan?.polyline} zoom={12} className="h-96 w-full" />
          </Card>
          {plan &&
            (plan.suggested_stops.length === 0 ? (
              <Empty title="No compatible chargers within 2 km of this route" />
            ) : (
              <div>
                <h2 className="mb-2 font-semibold">Chargers along your route</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {plan.suggested_stops.map((c) => (
                    <ChargerCard key={c.id} c={c} />
                  ))}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
