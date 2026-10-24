import { useState } from "react";
import { Link } from "react-router-dom";
import { EyeOff, LocateFixed, SlidersHorizontal } from "lucide-react";
import { api, qs } from "../lib/api";
import { useAuth, useFetch } from "../lib/auth";
import { KORAMANGALA } from "../lib/format";
import type { ChargerSummary } from "../lib/types";
import { MapView } from "../components/MapView";
import { AgentPanel } from "../components/AgentPanel";
import { ChargerCard, Empty, ErrorNote, Spinner } from "../components/ui";

const AREAS = [
  { name: "Koramangala", ...KORAMANGALA },
  { name: "HSR Layout", lat: 12.9116, lng: 77.6389 },
  { name: "Indiranagar", lat: 12.9719, lng: 77.6412 },
  { name: "BTM Layout", lat: 12.9166, lng: 77.6101 },
  { name: "Bellandur", lat: 12.9257, lng: 77.6762 },
  { name: "Jayanagar", lat: 12.925, lng: 77.5938 },
];

const select = "rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-brand";

export default function Search() {
  const { vehicles, vehicle, setVehicleId } = useAuth();
  const [center, setCenter] = useState({ name: "Koramangala", lat: KORAMANGALA.lat, lng: KORAMANGALA.lng });
  const [connector, setConnector] = useState("");
  const [mode, setMode] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [radius, setRadius] = useState("5");
  const [bookableOnly, setBookableOnly] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [locError, setLocError] = useState<string | null>(null);

  const query = qs({
    lat: center.lat,
    lng: center.lng,
    radius_km: radius,
    vehicle_id: vehicle?.id,
    connector,
    mode,
    max_price_paise: maxPrice ? Number(maxPrice) * 100 : undefined,
    bookable_only: bookableOnly || undefined,
  });
  const { data, error, loading } = useFetch(
    () => api.get<{ results: ChargerSummary[]; excluded_incompatible: number }>(`/api/chargers/search?${query}`),
    [query],
  );

  const locate = () => {
    setLocError(null);
    navigator.geolocation?.getCurrentPosition(
      (p) => setCenter({ name: "your location", lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setLocError("Location permission denied. Pick an area instead."),
    );
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm font-semibold">
            My EV
            <select value={vehicle?.id ?? ""} onChange={(e) => setVehicleId(e.target.value)} className={select}>
              {vehicles.length === 0 && <option value="">No vehicles</option>}
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.make} {v.model} ({v.connectors.join("/")})
                </option>
              ))}
            </select>
          </label>
          <Link to="/vehicles" className="text-xs font-semibold text-brand">
            + Add EV
          </Link>
          <div className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" />
          <div className="flex flex-wrap gap-1.5">
            {AREAS.map((a) => (
              <button
                key={a.name}
                onClick={() => setCenter(a)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${center.name === a.name ? "bg-navy text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {a.name}
              </button>
            ))}
            <button onClick={locate} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200">
              <LocateFixed size={13} /> Near me
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <SlidersHorizontal size={16} className="text-slate-400" />
          <select value={connector} onChange={(e) => setConnector(e.target.value)} className={select}>
            <option value="">Any connector</option>
            {["CCS2", "TYPE2", "CHADEMO", "GBT"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={select}>
            <option value="">AC or DC</option>
            <option value="DC">DC fast</option>
            <option value="AC">AC</option>
          </select>
          <select value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className={select}>
            <option value="">Any price</option>
            {[15, 18, 20, 25].map((p) => (
              <option key={p} value={p}>
                Under ₹{p}/kWh
              </option>
            ))}
          </select>
          <select value={radius} onChange={(e) => setRadius(e.target.value)} className={select}>
            {["2", "5", "10", "20"].map((r) => (
              <option key={r} value={r}>
                Within {r} km
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm text-slate-600">
            <input type="checkbox" checked={bookableOnly} onChange={(e) => setBookableOnly(e.target.checked)} className="accent-brand" />
            Bookable only
          </label>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[440px_1fr]">
        <div className="order-2 min-h-0 overflow-y-auto p-4 lg:order-1">
          <ErrorNote message={error ?? locError} />
          {data && data.excluded_incompatible > 0 && vehicle && (
            <div className="mb-3 flex items-center gap-2 rounded-xl bg-navy px-4 py-2.5 text-sm text-white">
              <EyeOff size={16} className="text-volt" />
              <span>
                <b>{data.excluded_incompatible}</b> incompatible charger{data.excluded_incompatible > 1 ? "s" : ""} hidden for your {vehicle.model}
              </span>
            </div>
          )}
          {loading && !data ? (
            <Spinner label="Finding chargers…" />
          ) : data?.results.length === 0 ? (
            <Empty title="No chargers match">Try a bigger radius or remove a filter.</Empty>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-medium text-slate-500">
                {data?.results.length} chargers near {center.name}
              </p>
              {data?.results.map((c) => <ChargerCard key={c.id} c={c} onHover={setHover} />)}
            </div>
          )}
        </div>
        <div className="relative order-1 h-64 lg:order-2 lg:h-auto">
          <MapView center={center} chargers={data?.results ?? []} highlight={hover} />
          <div className="absolute bottom-3 left-3 z-[500] hidden rounded-xl bg-white/95 px-3 py-2 text-[11px] shadow ring-1 ring-slate-200 sm:block">
            {[
              ["#10b981", "Live"],
              ["#315CFF", "Owner schedule"],
              ["#19C6D2", "User-reported"],
              ["#f59e0b", "Stale"],
              ["#94a3b8", "Unconfirmed"],
            ].map(([c, l]) => (
              <span key={l} className="mr-3 inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} /> {l}
              </span>
            ))}
          </div>
        </div>
      </div>
      <AgentPanel location={{ lat: center.lat, lng: center.lng }} />
    </div>
  );
}
