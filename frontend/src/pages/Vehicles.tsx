import { useState } from "react";
import { Car, Check } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Card, ErrorNote, PageHeader } from "../components/ui";

const PRESETS = [
  { make: "Tata", model: "Nexon EV", connectors: ["CCS2", "TYPE2"], max_ac_kw: 7.2, max_dc_kw: 50, battery_kwh: 40.5 },
  { make: "MG", model: "ZS EV", connectors: ["CCS2", "TYPE2"], max_ac_kw: 7.4, max_dc_kw: 76, battery_kwh: 50.3 },
  { make: "Hyundai", model: "Creta Electric", connectors: ["CCS2", "TYPE2"], max_ac_kw: 11, max_dc_kw: 50, battery_kwh: 51.4 },
  { make: "Tata", model: "Tiago EV", connectors: ["CCS2", "TYPE2"], max_ac_kw: 3.3, max_dc_kw: 25, battery_kwh: 24 },
  { make: "MG", model: "Comet EV", connectors: ["TYPE2"], max_ac_kw: 3.3, max_dc_kw: 0, battery_kwh: 17.3 },
];

export default function Vehicles() {
  const { vehicles, vehicle, setVehicleId, reloadVehicles } = useAuth();
  const [err, setErr] = useState<string | null>(null);

  const add = async (p: (typeof PRESETS)[number]) => {
    setErr(null);
    try {
      await api.post("/api/vehicles", { ...p, category: "car" });
      await reloadVehicles();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <PageHeader title="My EVs" subtitle="Amply uses your EV's connectors and power limits to hide chargers that won't work." />
      <ErrorNote message={err} />
      <div className="space-y-3">
        {vehicles.map((v) => (
          <Card key={v.id} className="flex items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-brand">
                <Car size={20} />
              </span>
              <div>
                <div className="font-semibold">
                  {v.make} {v.model}
                </div>
                <div className="text-xs text-slate-500">
                  {v.connectors.join(" / ")} · AC {v.max_ac_kw} kW · {v.max_dc_kw ? `DC ${v.max_dc_kw} kW` : "no DC fast charging"} · {v.battery_kwh} kWh
                </div>
              </div>
            </div>
            {vehicle?.id === v.id ? (
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700">
                <Check size={16} /> Selected
              </span>
            ) : (
              <Button variant="secondary" onClick={() => setVehicleId(v.id)}>
                Use this EV
              </Button>
            )}
          </Card>
        ))}
      </div>
      <h2 className="mt-8 mb-3 font-semibold">Add an EV</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {PRESETS.map((p) => (
          <button key={p.model} onClick={() => add(p)} className="rounded-xl bg-white p-3 text-left text-sm ring-1 ring-slate-200 hover:ring-brand">
            <b>
              {p.make} {p.model}
            </b>
            <div className="text-xs text-slate-500">
              {p.connectors.join("/")} · {p.max_dc_kw ? `DC ${p.max_dc_kw} kW` : "AC only"}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
