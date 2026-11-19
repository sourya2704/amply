import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Car, ChevronDown, EyeOff, LocateFixed, Navigation, Plus, SlidersHorizontal, X } from "lucide-react";
import { api, qs } from "../lib/api";
import { useAuth, useFetch } from "../lib/auth";
import { KORAMANGALA } from "../lib/format";
import type { ChargerSummary } from "../lib/types";
import { metresBetween, useLiveLocation } from "../lib/useLiveLocation";
import { MapView } from "../components/MapView";
import { AgentPanel } from "../components/AgentPanel";
import { activeFilterChips, DEFAULT_FILTERS, FiltersPanel, type Filters } from "../components/FiltersPanel";
import { Button, ChargerCard, Empty, ErrorNote, ListSkeleton, usePageTitle } from "../components/ui";

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
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const chips = activeFilterChips(filters);
  const [hover, setHover] = useState<string | null>(null);
  usePageTitle("Find chargers");
  const live = useLiveLocation();
  // "Following" = the search centre tracks the driver's live position (cab-app style).
  const [following, setFollowing] = useState(false);

  useEffect(() => {
    if (live.status === "on" && live.position && !following && center.name !== "your location") setFollowing(true);
    // only on the first fix after turning location on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.status]);

  // Re-search only after a meaningful move, so the list doesn't flicker with every GPS update.
  useEffect(() => {
    const p = live.position;
    if (!following || !p) return;
    if (center.name !== "your location" || metresBetween(center, p) > 200) setCenter({ name: "your location", lat: p.lat, lng: p.lng });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.position, following]);

  const goToMyLocation = () => {
    setFollowing(true);
    if (live.status === "on" && live.position) setCenter({ name: "your location", lat: live.position.lat, lng: live.position.lng });
    else live.start();
  };
  const pickArea = (a: (typeof AREAS)[number]) => {
    setFollowing(false);
    setCenter(a);
  };
  const locError =
    live.status === "denied"
      ? "Location is blocked. Allow it in your browser's site settings, or pick an area below."
      : live.status === "unavailable"
        ? "Couldn't get your location right now. Pick an area below."
        : null;

  const query = qs({
    lat: center.lat,
    lng: center.lng,
    radius_km: filters.radius,
    vehicle_id: vehicle?.id,
    connector: filters.connector,
    mode: filters.mode,
    min_power_kw: filters.minPower || undefined,
    max_price_paise: filters.maxPrice ? filters.maxPrice * 100 : undefined,
    bookable_only: filters.bookableOnly || undefined,
  });
  const { data, error, loading } = useFetch(
    () => api.get<{ results: ChargerSummary[]; excluded_incompatible: number }>(`/api/chargers/search?${query}`),
    [query],
  );

  const count = data?.results.length ?? 0;

  return (
    <div className="relative min-h-[calc(100dvh-4rem)] pt-[calc(42dvh-1.5rem)] lg:h-[calc(100dvh-4rem)] lg:overflow-hidden lg:pt-0">
      {/* Full-bleed map, like a cab app */}
      <div className="absolute inset-x-0 top-0 h-[42dvh] lg:inset-0 lg:h-auto">
        <MapView center={center} chargers={data?.results ?? []} highlight={hover} padLeft={436} me={live.position} />
        {live.position && !following && (
          <button
            onClick={goToMyLocation}
            className="absolute right-3 bottom-24 z-[500] grid h-11 w-11 place-items-center rounded-full bg-surface shadow-lg ring-1 ring-line hover:bg-primary-soft lg:bottom-24"
            aria-label="Back to my location"
            title="Back to my location"
          >
            <Navigation size={18} className="fill-primary text-ink" />
          </button>
        )}
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
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${following && live.status === "on" ? "animate-pulse bg-primary-dark ring-primary/50" : "bg-ink ring-primary/70"}`} />
            <span className="min-w-0 flex-1 truncate text-sm font-bold">
              {following && live.status === "asking"
                ? "Finding you…"
                : following && live.position
                  ? "Your live location"
                  : center.name === "your location"
                    ? "Your last location"
                    : center.name}
              {following && live.position && <span className="ml-1.5 text-xs font-medium text-muted">±{Math.round(live.position.accuracy)} m</span>}
            </span>
            {following && live.status === "on" ? (
              <button
                onClick={() => {
                  setFollowing(false);
                  live.stop();
                }}
                className="rounded-full bg-surface px-2.5 py-1 text-xs font-bold shadow-sm hover:bg-surface-3"
              >
                Stop
              </button>
            ) : (
              <button onClick={goToMyLocation} className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-bold shadow-sm hover:bg-primary-dark">
                <LocateFixed size={13} /> {live.status === "asking" ? "Locating…" : "Use my location"}
              </button>
            )}
          </div>
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
            {AREAS.map((a) => (
              <button
                key={a.name}
                onClick={() => pickArea(a)}
                className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-bold transition ${center.name === a.name ? "bg-ink text-white" : "bg-surface-3 text-ink hover:bg-line"}`}
              >
                {a.name}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Your EV</span>
              <Car size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
              <select
                value={vehicle?.id ?? ""}
                onChange={(e) => setVehicleId(e.target.value)}
                className="w-full appearance-none truncate rounded-xl bg-primary py-2.5 pr-8 pl-9 text-sm font-bold outline-none hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-ink"
              >
                {vehicles.length === 0 && <option value="">Add your EV</option>}
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.make} {v.model}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2" />
            </label>
            <button
              onClick={() => setShowFilters(true)}
              className={`relative inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-bold transition ${chips.length ? "bg-ink text-white" : "bg-surface-3 hover:bg-line"}`}
              aria-haspopup="dialog"
            >
              <SlidersHorizontal size={15} /> Filters
              {chips.length > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] text-ink">{chips.length}</span>}
            </button>
            <Link to="/vehicles" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-3 hover:bg-line" title="Manage your EVs" aria-label="Manage your EVs">
              <Plus size={16} />
            </Link>
          </div>
          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setFilters({ ...filters, [c.key]: DEFAULT_FILTERS[c.key] })}
                  className="inline-flex items-center gap-1 rounded-full bg-primary-soft py-1 pr-2 pl-3 text-xs font-bold text-primary-ink hover:bg-primary/40"
                  aria-label={`Remove filter ${c.label}`}
                >
                  {c.label} <X size={12} />
                </button>
              ))}
              <button onClick={() => setFilters(DEFAULT_FILTERS)} className="px-1.5 text-xs font-bold text-muted hover:text-ink">
                Clear all
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5 pt-4 pb-28 lg:pb-5">
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
            <ListSkeleton rows={4} height="h-32" />
          ) : count === 0 ? (
            <Empty
              title="No chargers match"
              action={
                chips.length > 0 && (
                  <Button variant="secondary" onClick={() => setFilters(DEFAULT_FILTERS)}>
                    Clear filters
                  </Button>
                )
              }
            >
              Try a bigger radius, another area, or fewer filters.
            </Empty>
          ) : (
            <>
              <p className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-muted uppercase">
                <SlidersHorizontal size={13} /> {count} chargers near {center.name === "your location" ? "you" : center.name}
              </p>
              {data?.results.map((c, i) => (
                <div key={c.id}>
                  {i === 0 && center.name === "your location" && c.distance_km !== null && (
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold text-primary-ink">
                      <Navigation size={12} className="fill-primary" /> Nearest to you · {c.distance_km} km · about {Math.max(1, Math.round((c.distance_km / 25) * 60))} min drive
                    </p>
                  )}
                  <ChargerCard c={c} onHover={setHover} />
                </div>
              ))}
            </>
          )}
        </div>
      </aside>
      <AgentPanel location={{ lat: center.lat, lng: center.lng }} />
      {showFilters && <FiltersPanel value={filters} onApply={setFilters} onClose={() => setShowFilters(false)} />}
    </div>
  );
}
