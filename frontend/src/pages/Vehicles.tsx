import { useState, type FormEvent } from "react";
import { BatteryCharging, Car, Check, Plus, Zap } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Connector } from "../lib/types";
import { Button, Card, Empty, ErrorNote, Field, IconTile, inputCls, Page, SectionTitle } from "../components/ui";

const PRESETS = [
  { make: "Tata", model: "Nexon EV", connectors: ["CCS2", "TYPE2"], max_ac_kw: 7.2, max_dc_kw: 50, battery_kwh: 40.5 },
  { make: "Tata", model: "Punch EV", connectors: ["CCS2", "TYPE2"], max_ac_kw: 7.2, max_dc_kw: 50, battery_kwh: 35 },
  { make: "MG", model: "ZS EV", connectors: ["CCS2", "TYPE2"], max_ac_kw: 7.4, max_dc_kw: 76, battery_kwh: 50.3 },
  { make: "Hyundai", model: "Creta Electric", connectors: ["CCS2", "TYPE2"], max_ac_kw: 11, max_dc_kw: 50, battery_kwh: 51.4 },
  { make: "Tata", model: "Tiago EV", connectors: ["CCS2", "TYPE2"], max_ac_kw: 3.3, max_dc_kw: 25, battery_kwh: 24 },
  { make: "MG", model: "Comet EV", connectors: ["TYPE2"], max_ac_kw: 3.3, max_dc_kw: 0, battery_kwh: 17.3 },
];

const CONNECTORS: Connector[] = ["CCS2", "TYPE2", "CHADEMO", "GBT"];

export default function Vehicles() {
  const { vehicles, vehicle, setVehicleId, reloadVehicles } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [f, setF] = useState({ make: "", model: "", connectors: ["CCS2"] as string[], max_ac_kw: "7.2", max_dc_kw: "50", battery_kwh: "40" });

  const add = async (v: { make: string; model: string; connectors: string[]; max_ac_kw: number; max_dc_kw: number; battery_kwh: number }) => {
    setErr(null);
    try {
      await api.post("/api/vehicles", { ...v, category: "car" });
      await reloadVehicles();
      setCustom(false);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const submitCustom = (e: FormEvent) => {
    e.preventDefault();
    add({ make: f.make, model: f.model, connectors: f.connectors, max_ac_kw: Number(f.max_ac_kw), max_dc_kw: Number(f.max_dc_kw), battery_kwh: Number(f.battery_kwh) });
  };
  const owned = new Set(vehicles.map((v) => `${v.make} ${v.model}`));

  return (
    <Page title="My EVs" subtitle="Amply uses your EV's plug type and charging limits to hide chargers that won't work." width="max-w-3xl">
      <ErrorNote message={err} />
      {vehicles.length === 0 ? (
        <Empty icon={Car} title="No EVs yet">
          Add your EV below so we only show chargers that fit it.
        </Empty>
      ) : (
        <div className="space-y-3">
          {vehicles.map((v) => {
            const selected = vehicle?.id === v.id;
            return (
              <Card key={v.id} className={`flex flex-wrap items-center justify-between gap-3 p-4 ${selected ? "ring-2 ring-primary" : ""}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <IconTile icon={Car} tone={selected ? "pink" : "grey"} size={44} />
                  <div className="min-w-0">
                    <div className="font-extrabold">
                      {v.make} {v.model}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-bold">
                      {v.connectors.map((c) => (
                        <span key={c} className="rounded-md bg-surface-3 px-1.5 py-0.5">
                          {c}
                        </span>
                      ))}
                      <span className="rounded-md bg-surface-3 px-1.5 py-0.5">AC {v.max_ac_kw} kW</span>
                      <span className="rounded-md bg-surface-3 px-1.5 py-0.5">{v.max_dc_kw ? `DC ${v.max_dc_kw} kW` : "No DC fast charging"}</span>
                      <span className="rounded-md bg-surface-3 px-1.5 py-0.5">{v.battery_kwh} kWh</span>
                    </div>
                  </div>
                </div>
                {selected ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-bold text-primary-ink">
                    <Check size={14} /> Selected
                  </span>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setVehicleId(v.id)}>
                    Use this EV
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-10">
        <SectionTitle
          icon={Plus}
          action={
            !custom && (
              <Button size="sm" variant="ghost" onClick={() => setCustom(true)}>
                Not listed? Add manually
              </Button>
            )
          }
        >
          Add an EV
        </SectionTitle>
        {custom ? (
          <Card>
            <form onSubmit={submitCustom} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Make">
                  <input required value={f.make} onChange={(e) => setF({ ...f, make: e.target.value })} placeholder="Mahindra" className={inputCls} />
                </Field>
                <Field label="Model">
                  <input required value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} placeholder="XUV400" className={inputCls} />
                </Field>
              </div>
              <div>
                <span className="mb-1.5 block text-sm font-bold">Plug types</span>
                <div className="flex flex-wrap gap-2">
                  {CONNECTORS.map((c) => {
                    const on = f.connectors.includes(c);
                    return (
                      <button
                        type="button"
                        key={c}
                        aria-pressed={on}
                        onClick={() => setF({ ...f, connectors: on ? f.connectors.filter((x) => x !== c) : [...f.connectors, c] })}
                        className={`rounded-full px-3.5 py-2 text-xs font-bold transition ${on ? "bg-ink text-white" : "bg-surface-3 hover:bg-line"}`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Max AC (kW)">
                  <input type="number" min="0" step="0.1" value={f.max_ac_kw} onChange={(e) => setF({ ...f, max_ac_kw: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Max DC (kW)" hint="0 if no fast charging">
                  <input type="number" min="0" step="1" value={f.max_dc_kw} onChange={(e) => setF({ ...f, max_dc_kw: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Battery (kWh)">
                  <input type="number" min="1" step="0.1" value={f.battery_kwh} onChange={(e) => setF({ ...f, battery_kwh: e.target.value })} className={inputCls} />
                </Field>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={f.connectors.length === 0}>
                  Add EV
                </Button>
                <Button type="button" variant="ghost" onClick={() => setCustom(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {PRESETS.map((p) => {
              const have = owned.has(`${p.make} ${p.model}`);
              return (
                <button
                  key={p.model}
                  disabled={have}
                  onClick={() => add(p)}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-surface p-3.5 text-left ring-1 ring-line transition hover:ring-ink disabled:opacity-50 disabled:hover:ring-line"
                >
                  <span className="min-w-0">
                    <span className="block font-extrabold">
                      {p.make} {p.model}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                      <span>{p.connectors.join(" / ")}</span>
                      <span className="inline-flex items-center gap-0.5">
                        {p.max_dc_kw ? <Zap size={11} /> : <BatteryCharging size={11} />}
                        {p.max_dc_kw ? `DC ${p.max_dc_kw} kW` : "AC only"}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-bold text-primary-ink">{have ? "Added" : "Add"}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Page>
  );
}
