import { useEffect, useState } from "react";
import { ArrowUpDown, BatteryMedium, Clock, Info, Route as RouteIcon, TriangleAlert } from "lucide-react";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLiveLocation } from "../lib/useLiveLocation";
import type { RoutePlan } from "../lib/types";
import { MapView } from "../components/MapView";
import { PlaceInput, POPULAR, type Place } from "../components/PlaceInput";
import { Button, Card, ChargerCard, Empty, ErrorNote, Page, SectionTitle, Skeleton } from "../components/ui";

export default function Trip() {
  const { vehicle } = useAuth();
  const live = useLiveLocation();
  const [from, setFrom] = useState<Place | null>(POPULAR[0]);
  const [to, setTo] = useState<Place | null>(POPULAR[5]);
  const [battery, setBattery] = useState(40);
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [wantMe, setWantMe] = useState(false);

  // When the driver asks for their location, use it as the start as soon as the first fix arrives.
  useEffect(() => {
    if (wantMe && live.position) {
      setFrom({ name: "My location", address: "Your live GPS position", lat: live.position.lat, lng: live.position.lng, me: true });
      setWantMe(false);
    }
  }, [wantMe, live.position]);

  // "My location" always uses the freshest GPS fix.
  const resolve = (p: Place | null) => (p?.me && live.position ? { ...p, lat: live.position.lat, lng: live.position.lng } : p);

  const go = async () => {
    const a = resolve(from);
    const b = resolve(to);
    if (!a || !b) return setErr("Choose where you're starting and where you're going.");
    setBusy(true);
    setErr(null);
    try {
      setPlan(await api.get<RoutePlan>(`/api/route?${qs({ from_lat: a.lat, from_lng: a.lng, to_lat: b.lat, to_lng: b.lng, battery_pct: battery, vehicle_id: vehicle?.id })}`));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const swap = () => {
    setFrom(to);
    setTo(from);
    setPlan(null);
  };
  const requestMe = () => {
    setWantMe(true);
    live.start();
  };
  const center = resolve(from) ?? POPULAR[0];
  const same = !!from && !!to && Math.abs(from.lat - to.lat) < 1e-5 && Math.abs(from.lng - to.lng) < 1e-5;

  return (
    <Page title="Plan a trip" subtitle="Check whether your charge covers the drive, and which compatible chargers are on the way.">
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <Card className="space-y-4">
            {/* pickup / drop-off box */}
            <div className="relative rounded-2xl bg-surface-2 p-1.5">
              <PlaceInput
                label="From"
                value={from}
                onChange={(p) => {
                  setFrom(p);
                  setPlan(null);
                }}
                marker={<span className="h-2.5 w-2.5 rounded-full bg-ink ring-4 ring-primary/60" />}
                placeholder="Search a starting point"
                myLocation={live.position}
                onRequestLocation={requestMe}
                locating={live.status === "asking"}
              />
              <div className="ml-[19px] h-3 border-l-2 border-dashed border-line" />
              <PlaceInput
                label="To"
                value={to}
                onChange={(p) => {
                  setTo(p);
                  setPlan(null);
                }}
                marker={<span className="h-2.5 w-2.5 rounded-sm bg-primary-dark" />}
                placeholder="Where are you going?"
                myLocation={live.position}
                onRequestLocation={requestMe}
                locating={live.status === "asking"}
              />
              <button
                onClick={swap}
                className="absolute top-1/2 right-3 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-surface shadow ring-1 ring-line transition hover:rotate-180 hover:bg-surface-3"
                aria-label="Swap start and destination"
              >
                <ArrowUpDown size={15} />
              </button>
            </div>
            {live.status === "denied" && <p className="text-xs font-semibold text-rose-600">Location is blocked in your browser settings.</p>}

            <div>
              <div className="mb-1.5 flex items-center justify-between text-sm font-bold">
                <span>Battery now</span>
                <span className="tabular-nums">{battery}%</span>
              </div>
              <input type="range" min={1} max={100} value={battery} onChange={(e) => setBattery(Number(e.target.value))} className="w-full accent-[#ff86bf]" aria-label="Battery percentage" />
              <p className="mt-1 text-xs text-muted">{vehicle ? `${vehicle.make} ${vehicle.model} · ${vehicle.battery_kwh} kWh battery` : "Select an EV for range estimates."}</p>
            </div>
            <ErrorNote message={err} />
            {same && <p className="text-xs font-semibold text-rose-600">Start and destination are the same place.</p>}
            <Button size="lg" className="w-full" onClick={go} disabled={busy || !from || !to || same}>
              <RouteIcon size={17} /> {busy ? "Planning…" : "Plan route"}
            </Button>
          </Card>

          {busy && !plan && <Skeleton className="h-40 w-full rounded-2xl" />}
          {plan && (
            <Card className="animate-pop space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-surface-2 p-3.5">
                  <div className="flex items-center gap-1 text-xs font-bold text-muted">
                    <RouteIcon size={13} /> Distance
                  </div>
                  <div className="mt-1 text-2xl font-extrabold">{plan.distance_km} km</div>
                </div>
                <div className="rounded-2xl bg-surface-2 p-3.5">
                  <div className="flex items-center gap-1 text-xs font-bold text-muted">
                    <Clock size={13} /> Drive time
                  </div>
                  <div className="mt-1 text-2xl font-extrabold">{Math.round(plan.duration_min)} min</div>
                </div>
              </div>
              {plan.estimated_range_km !== null && (
                <div className={`flex items-start gap-2.5 rounded-2xl p-3.5 text-sm ring-1 ${plan.needs_charge ? "bg-amber-50 text-amber-900 ring-amber-200" : "bg-emerald-50 text-emerald-900 ring-emerald-200"}`}>
                  {plan.needs_charge ? <TriangleAlert size={18} className="mt-0.5 shrink-0" /> : <BatteryMedium size={18} className="mt-0.5 shrink-0" />}
                  <div>
                    <div className="font-extrabold">{plan.needs_charge ? "Plan a charging stop" : "You should make it"}</div>
                    <div>
                      Estimated range {plan.estimated_range_km} km {plan.needs_charge ? "is less than this trip." : "covers this trip with a reserve."}
                    </div>
                  </div>
                </div>
              )}
              <ul className="space-y-1.5 text-xs text-muted">
                {plan.assumptions.map((a) => (
                  <li key={a} className="flex gap-1.5">
                    <Info size={13} className="mt-px shrink-0" /> {a}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card className="overflow-hidden p-0">
            <MapView center={center} chargers={plan?.suggested_stops ?? []} route={plan?.polyline} zoom={12} className="h-[420px] w-full" me={live.position} />
          </Card>
          {plan &&
            (plan.suggested_stops.length === 0 ? (
              <Empty icon={RouteIcon} title="No compatible chargers near this route">
                Try charging before you leave, or pick a different route.
              </Empty>
            ) : (
              <section>
                <SectionTitle>Chargers along your route</SectionTitle>
                <div className="grid gap-3 sm:grid-cols-2">
                  {plan.suggested_stops.map((c) => (
                    <ChargerCard key={c.id} c={c} />
                  ))}
                </div>
              </section>
            ))}
        </div>
      </div>
    </Page>
  );
}
