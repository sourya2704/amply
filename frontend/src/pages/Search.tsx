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

  const pill = "shrink-0 appearance-none rounded-full bg-surface-3 px-3.5 py-2 text-xs font-bold text-ink outline-none transition hover:bg-line focus:ring-2 focus:ring-primary";
  const count = data?.results.length ?? 0;

  return (
    <div className="relative min-h-[calc(100dvh-4rem)] pt-[calc(42dvh-1.5rem)] lg:h-[calc(100dvh-4rem)] lg:overflow-hidden lg:pt-0">
      {/* Full-bleed map, like a cab app */}
      <div className="absolute inset-x-0 top-0 h-[42dvh] lg:inset-0 lg:h-auto">
        <MapView center={center} chargers={data?.results ?? []} highlight={hover} padLeft={436} />
        <div className="absolute top-3 right-14 z-[500] hidden rounded-2xl bg-surface/95 px-3 py-2 text-[11px] font-medium shadow-lg lg:block">
          {[
            ["#10b981", "Live"],
            ["#ff7ab8", "Owner schedule"],
            ["#19C6D2", "User-reported"],
            ["#f59e0b", "Stale"],
            ["#a3a3a3", "Unconfirmed"],
          ].map(([c, l]) => (
            <span key={l} className="mr-3 inline-flex items-center gap-1 last:mr-0">
              <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: c }} /> {l}
            </span>
          ))}
        </div>
      </div>

      {/* Floating panel on desktop, bottom sheet on phones */}
      <aside className="relative z-[600] flex min-h-[60dvh] flex-col rounded-t-3xl bg-surface shadow-[0_-10px_40px_-10px_#0003] lg:absolute lg:top-4 lg:bottom-4 lg:left-4 lg:min-h-0 lg:w-[420px] lg:rounded-3xl lg:shadow-2xl">
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line lg:hidden" />
        <div className="space-y-3 border-b border-line p-5 pb-4">
          <h1 className="text-2xl">Where do you want to charge?</h1>

          {/* "pickup" style location field */}
          <div className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-ink ring-4 ring-primary/70" />
            <span className="min-w-0 flex-1 truncate text-sm font-bold">{center.name === "your location" ? "Your current location" : center.name}</span>
            <button onClick={locate} className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-xs font-bold shadow-sm hover:bg-primary-soft">
              <LocateFixed size={13} /> Near me
            </button>
          </div>
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
            {AREAS.map((a) => (
              <button
                key={a.name}
                onClick={() => setCenter(a)}
                className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-bold transition ${center.name === a.name ? "bg-ink text-white" : "bg-surface-3 text-ink hover:bg-line"}`}
              >
                {a.name}
              </button>
            ))}
          </div>

          <div className="-mx-5 flex items-center gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
            <select value={vehicle?.id ?? ""} onChange={(e) => setVehicleId(e.target.value)} className={`${pill} bg-primary hover:bg-primary-dark`} aria-label="Your EV">
              {vehicles.length === 0 && <option value="">Add your EV</option>}
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  🚗 {v.make} {v.model}
                </option>
              ))}
            </select>
            <select value={connector} onChange={(e) => setConnector(e.target.value)} className={pill} aria-label="Connector">
              <option value="">Any plug</option>
              {["CCS2", "TYPE2", "CHADEMO", "GBT"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select value={mode} onChange={(e) => setMode(e.target.value)} className={pill} aria-label="Charging speed">
              <option value="">AC or DC</option>
              <option value="DC">⚡ DC fast</option>
              <option value="AC">AC</option>
            </select>
            <select value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className={pill} aria-label="Max price">
              <option value="">Any price</option>
              {[15, 18, 20, 25].map((p) => (
                <option key={p} value={p}>
                  ≤ ₹{p}/kWh
                </option>
              ))}
            </select>
            <select value={radius} onChange={(e) => setRadius(e.target.value)} className={pill} aria-label="Distance">
              {["2", "5", "10", "20"].map((r) => (
                <option key={r} value={r}>
                  {r} km
                </option>
              ))}
            </select>
            <button onClick={() => setBookableOnly(!bookableOnly)} className={`${pill} ${bookableOnly ? "bg-ink text-white hover:bg-black" : ""}`}>
              Bookable only
            </button>
            <Link to="/vehicles" className="shrink-0 text-xs font-bold text-primary-ink">
              + EV
            </Link>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5 pt-4">
          <ErrorNote message={error ?? locError} />
          {data && data.excluded_incompatible > 0 && vehicle && (
            <div className="flex items-center gap-2 rounded-2xl bg-primary-soft px-4 py-3 text-sm">
              <EyeOff size={16} className="shrink-0 text-primary-ink" />
              <span>
                <b>{data.excluded_incompatible}</b> charger{data.excluded_incompatible > 1 ? "s" : ""} that won't fit your {vehicle.model} hidden
              </span>
            </div>
          )}
          {loading && !data ? (
            <Spinner label="Finding chargers…" />
          ) : count === 0 ? (
            <Empty title="No chargers match">Try a bigger radius or remove a filter.</Empty>
          ) : (
            <>
              <p className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-muted uppercase">
                <SlidersHorizontal size={13} /> {count} chargers near {center.name}
              </p>
              {data?.results.map((c) => <ChargerCard key={c.id} c={c} onHover={setHover} />)}
            </>
          )}
        </div>
      </aside>
      <AgentPanel location={{ lat: center.lat, lng: center.lng }} />
    </div>
  );
}
