import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./ui";

export interface Filters {
  mode: "" | "AC" | "DC";
  minPower: number; // kW, 0 = any
  connector: string; // "" = any
  maxPrice: number; // ₹ per kWh, 0 = any
  radius: number; // km
  bookableOnly: boolean;
}

export const DEFAULT_FILTERS: Filters = { mode: "", minPower: 0, connector: "", maxPrice: 0, radius: 5, bookableOnly: false };

const CONNECTOR_LABEL: Record<string, string> = { CCS2: "CCS2", TYPE2: "Type 2", CHADEMO: "CHAdeMO", GBT: "GB/T" };

/** Removable chips for the filters that differ from the defaults. */
export function activeFilterChips(f: Filters): { key: keyof Filters; label: string }[] {
  const chips: { key: keyof Filters; label: string }[] = [];
  if (f.mode) chips.push({ key: "mode", label: f.mode === "DC" ? "DC fast" : "AC" });
  if (f.minPower) chips.push({ key: "minPower", label: `${f.minPower} kW+` });
  if (f.connector) chips.push({ key: "connector", label: CONNECTOR_LABEL[f.connector] ?? f.connector });
  if (f.maxPrice) chips.push({ key: "maxPrice", label: `Up to ₹${f.maxPrice}/kWh` });
  if (f.radius !== DEFAULT_FILTERS.radius) chips.push({ key: "radius", label: `Within ${f.radius} km` });
  if (f.bookableOnly) chips.push({ key: "bookableOnly", label: "Bookable only" });
  return chips;
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-b border-line py-5 last:border-0">
      <h3 className="text-sm font-extrabold">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Choice<T extends string | number>({ options, value, onChange }: { options: { value: T; label: string; sub?: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`rounded-xl px-3.5 py-2 text-left text-sm font-bold transition ${on ? "bg-ink text-white" : "bg-surface-3 text-ink hover:bg-line"}`}
          >
            {o.label}
            {o.sub && <span className={`block text-[11px] font-medium ${on ? "text-white/70" : "text-muted"}`}>{o.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function FiltersPanel({ value, onApply, onClose }: { value: Filters; onApply: (f: Filters) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(value);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((d) => ({ ...d, [k]: v }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // AC chargers top out around 22 kW, so higher minimums only make sense for DC.
  const powerOptions = [
    { value: 0, label: "Any" },
    { value: 7, label: "7 kW+", sub: "Home AC" },
    { value: 22, label: "22 kW+", sub: "Fast AC" },
    ...(draft.mode !== "AC"
      ? [
          { value: 30, label: "30 kW+", sub: "DC fast" },
          { value: 50, label: "50 kW+", sub: "DC rapid" },
        ]
      : []),
  ];

  return (
    <div className="fixed inset-0 z-[1300] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="filters-title"
        onClick={(e) => e.stopPropagation()}
        className="animate-pop flex max-h-[88dvh] w-full flex-col rounded-t-3xl bg-surface shadow-2xl sm:max-w-lg sm:rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 id="filters-title" className="text-xl">
            Filters
          </h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-surface-3 hover:text-ink" aria-label="Close filters">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto px-6">
          <Group title="Charging type" hint="AC is slower and cheaper; DC fast charges most EVs in under an hour.">
            <Choice
              options={[
                { value: "", label: "Any" },
                { value: "AC", label: "AC", sub: "3–22 kW" },
                { value: "DC", label: "DC fast", sub: "25 kW+" },
              ]}
              value={draft.mode}
              onChange={(m) => setDraft((d) => ({ ...d, mode: m as Filters["mode"], minPower: m === "AC" && d.minPower > 22 ? 0 : d.minPower }))}
            />
          </Group>

          <Group title="Minimum power" hint="Your EV may charge slower than the charger's maximum.">
            <Choice options={powerOptions} value={draft.minPower} onChange={(v) => set("minPower", v)} />
          </Group>

          <Group title="Plug type">
            <Choice
              options={[{ value: "", label: "Any" }, ...Object.entries(CONNECTOR_LABEL).map(([value, label]) => ({ value, label }))]}
              value={draft.connector}
              onChange={(v) => set("connector", v)}
            />
          </Group>

          <Group title="Max price per kWh">
            <Choice
              options={[
                { value: 0, label: "Any" },
                { value: 15, label: "₹15" },
                { value: 18, label: "₹18" },
                { value: 20, label: "₹20" },
                { value: 25, label: "₹25" },
              ]}
              value={draft.maxPrice}
              onChange={(v) => set("maxPrice", v)}
            />
          </Group>

          <Group title="Distance">
            <Choice options={[2, 5, 10, 20].map((km) => ({ value: km, label: `${km} km` }))} value={draft.radius} onChange={(v) => set("radius", v)} />
          </Group>

          <Group title="Booking">
            <label className="flex cursor-pointer items-center justify-between gap-4">
              <span>
                <span className="block text-sm font-bold">Bookable only</span>
                <span className="block text-xs text-muted">Hide public stations that are directions-only</span>
              </span>
              <input type="checkbox" checked={draft.bookableOnly} onChange={(e) => set("bookableOnly", e.target.checked)} className="peer sr-only" />
              <span className="relative h-7 w-12 shrink-0 rounded-full bg-line transition peer-checked:bg-ink peer-focus-visible:ring-2 peer-focus-visible:ring-primary after:absolute after:top-1 after:left-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5" />
            </label>
          </Group>
        </div>

        <div className="flex items-center gap-3 border-t border-line px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button variant="ghost" onClick={() => setDraft(DEFAULT_FILTERS)}>
            Reset
          </Button>
          <Button
            size="lg"
            className="flex-1"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            Show results
          </Button>
        </div>
      </div>
    </div>
  );
}
