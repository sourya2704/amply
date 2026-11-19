import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Building2, LocateFixed, MapPin, Search, X } from "lucide-react";
import { api, qs } from "../lib/api";

export interface Place {
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** True when this is the driver's live GPS position. */
  me?: boolean;
}

// Pilot areas offered before the driver types anything.
export const POPULAR: Place[] = [
  { name: "Koramangala", address: "Bengaluru", lat: 12.9352, lng: 77.6245 },
  { name: "HSR Layout", address: "Bengaluru", lat: 12.9116, lng: 77.6389 },
  { name: "Indiranagar", address: "Bengaluru", lat: 12.9719, lng: 77.6412 },
  { name: "Whitefield", address: "Bengaluru", lat: 12.9698, lng: 77.75 },
  { name: "Electronic City", address: "Bengaluru", lat: 12.8452, lng: 77.6602 },
  { name: "Kempegowda Airport", address: "Devanahalli, Bengaluru", lat: 13.1986, lng: 77.7066 },
];

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * Search-as-you-type address field (cab-app "Where to?"). Typing 3+ characters searches Bengaluru via
 * /api/geocode; before that it offers "My location" and popular areas.
 */
export function PlaceInput({
  label,
  value,
  onChange,
  marker,
  placeholder = "Search a place or address",
  myLocation,
  onRequestLocation,
  locating = false,
}: {
  label: string;
  value: Place | null;
  onChange: (p: Place) => void;
  marker: React.ReactNode;
  placeholder?: string;
  myLocation?: { lat: number; lng: number } | null;
  onRequestLocation?: () => void;
  locating?: boolean;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const q = useDebounced(query.trim(), 350);
  const searching = q.length >= 3;

  useEffect(() => {
    if (!searching) {
      setResults([]);
      return;
    }
    let alive = true;
    setLoading(true);
    api
      .get<{ results: Place[] }>(`/api/geocode?${qs({ q })}`)
      .then((r) => alive && setResults(r.results))
      .catch(() => alive && setResults([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [q, searching]);

  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const meOption: Place | null = myLocation ? { name: "My location", address: "Your live GPS position", lat: myLocation.lat, lng: myLocation.lng, me: true } : null;
  const options: Place[] = searching ? results : [...(meOption ? [meOption] : []), ...POPULAR];

  const pick = (p: Place) => {
    onChange(p);
    setQuery("");
    setOpen(false);
    input.current?.blur();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && open && options[active]) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div ref={box} className="relative">
      <div className={`flex items-center gap-3 rounded-xl px-3 py-2 transition ${open ? "bg-surface ring-2 ring-primary" : "hover:bg-surface"}`}>
        <span className="flex w-4 shrink-0 justify-center">{marker}</span>
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="block text-[11px] font-bold tracking-wide text-muted uppercase">
            {label}
          </label>
          <input
            ref={input}
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            autoComplete="off"
            value={open ? query : value?.name ?? ""}
            placeholder={open ? placeholder : value ? "" : placeholder}
            onFocus={() => {
              setOpen(true);
              setActive(0);
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            className="w-full truncate bg-transparent text-sm font-bold outline-none placeholder:font-medium placeholder:text-muted"
          />
          {!open && value && value.address && <div className="truncate text-xs text-muted">{value.address}</div>}
        </div>
        {open && query && (
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => setQuery("")} className="rounded-full p-1 text-muted hover:bg-surface-3" aria-label="Clear">
            <X size={15} />
          </button>
        )}
      </div>

      {open && (
        <div id={`${id}-list`} role="listbox" className="animate-pop absolute inset-x-0 top-full z-[700] mt-2 max-h-80 overflow-y-auto rounded-2xl bg-surface p-1.5 shadow-[0_20px_50px_-15px_#0005] ring-1 ring-line">
          {!searching && (
            <>
              {!meOption && onRequestLocation && (
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={onRequestLocation}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-2"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-ink">
                    <LocateFixed size={16} />
                  </span>
                  <span>
                    <span className="block text-sm font-bold">{locating ? "Finding you…" : "Use my current location"}</span>
                    <span className="block text-xs text-muted">Shared only for this trip</span>
                  </span>
                </button>
              )}
              <div className="px-3 pt-2 pb-1 text-[11px] font-bold tracking-wide text-muted uppercase">{meOption ? "Suggestions" : "Popular in Bengaluru"}</div>
            </>
          )}

          {searching && loading && (
            <div className="space-y-1 p-1.5" aria-label="Searching">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl p-1.5">
                  <span className="h-9 w-9 animate-pulse rounded-full bg-surface-3" />
                  <span className="flex-1 space-y-1.5">
                    <span className="block h-3 w-2/5 animate-pulse rounded bg-surface-3" />
                    <span className="block h-2.5 w-4/5 animate-pulse rounded bg-surface-3" />
                  </span>
                </div>
              ))}
            </div>
          )}

          {searching && !loading && results.length === 0 && (
            <div className="flex items-center gap-3 px-3 py-4 text-sm text-muted">
              <Search size={16} /> No places found in Bengaluru for “{q}”.
            </div>
          )}

          {!(searching && loading) &&
            options.map((p, i) => {
              const Icon = p.me ? LocateFixed : searching ? MapPin : Building2;
              return (
                <button
                  key={`${p.name}-${p.lat}-${p.lng}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(p)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${i === active ? "bg-primary-soft" : ""}`}
                >
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${p.me ? "bg-primary text-ink" : "bg-surface-3 text-ink"}`}>
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{p.name}</span>
                    <span className="block truncate text-xs text-muted">{p.address}</span>
                  </span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
