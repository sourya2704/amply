import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, Plus, X } from "lucide-react";
import { api } from "../lib/api";
import { useFetch } from "../lib/auth";
import { formatINR, formatRange, KORAMANGALA, WEEKDAYS } from "../lib/format";
import type { Booking, ChargerDetail } from "../lib/types";
import { MapView } from "../components/MapView";
import { AvailabilityBadge, Button, Card, Empty, ErrorNote, PageHeader, Spinner, StatusPill } from "../components/ui";

const statusChip: Record<string, string> = {
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  submitted: "bg-amber-50 text-amber-800 ring-amber-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
};
const statusText: Record<string, string> = { approved: "Live", submitted: "Under review", rejected: "Rejected" };

export default function Owner() {
  const chargers = useFetch(() => api.get<ChargerDetail[]>("/api/owner/chargers"), [], 8000);
  const bookings = useFetch(() => api.get<Booking[]>("/api/owner/bookings"), [], 4000);
  const [err, setErr] = useState<string | null>(null);

  const act = async (id: string, action: "accept" | "reject") => {
    setErr(null);
    try {
      await api.post(`/api/bookings/${id}/${action}`, action === "reject" ? { reason: "Not available at that time" } : undefined);
      bookings.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const requests = bookings.data?.filter((b) => b.status === "requested") ?? [];
  const others = bookings.data?.filter((b) => b.status !== "requested") ?? [];
  const earned = others.filter((b) => b.status === "completed").reduce((s, b) => s + b.price.energy_cost_paise, 0);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <PageHeader title="Owner dashboard" subtitle="Approve requests and manage your chargers. Updates live.">
        <Link to="/owner/new">
          <Button>
            <Plus size={16} /> List a charger
          </Button>
        </Link>
      </PageHeader>

      <div className="mb-6 grid grid-cols-3 gap-3">
        {[
          ["Pending requests", requests.length],
          ["Chargers", chargers.data?.length ?? 0],
          ["Earned (completed)", formatINR(earned)],
        ].map(([k, v]) => (
          <Card key={k as string} className="p-4">
            <div className="text-xs text-slate-500">{k}</div>
            <div className="mt-1 text-2xl font-bold">{v}</div>
          </Card>
        ))}
      </div>

      <ErrorNote message={err ?? bookings.error ?? chargers.error} />

      <h2 className="mb-3 font-semibold">Booking requests</h2>
      {bookings.loading && !bookings.data ? (
        <Spinner />
      ) : requests.length === 0 ? (
        <Empty title="No pending requests">New requests appear here instantly.</Empty>
      ) : (
        <div className="space-y-3">
          {requests.map((b) => (
            <Card key={b.id} className="animate-pop flex flex-wrap items-center justify-between gap-3 p-4 ring-2 ring-amber-200">
              <div>
                <div className="font-semibold">
                  {b.driver.name} wants {b.charger.name}
                </div>
                <div className="text-sm text-slate-500">
                  {formatRange(b.start_at, b.end_at)} · {b.price.energy_kwh} kWh · you earn ≈ {formatINR(b.price.energy_cost_paise)}
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => act(b.id, "accept")}>
                  <Check size={16} /> Accept
                </Button>
                <Button variant="danger" onClick={() => act(b.id, "reject")}>
                  <X size={16} /> Decline
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 font-semibold">Other bookings</h2>
          <div className="space-y-2">
            {others.map((b) => (
              <Link key={b.id} to={`/bookings/${b.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3 text-sm ring-1 ring-slate-200 hover:ring-brand/40">
                <span>
                  <b>{b.driver.name}</b> · {b.charger.name} · {formatRange(b.start_at, b.end_at)}
                </span>
                <StatusPill status={b.status} />
              </Link>
            ))}
          </div>
        </>
      )}

      <h2 className="mt-8 mb-3 font-semibold">My chargers</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {chargers.data?.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold">{c.name}</div>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${statusChip[c.status]}`}>{statusText[c.status]}</span>
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {c.connector} · {c.mode} · {c.power_kw} kW · {formatINR(c.price_per_kwh_paise)}/kWh
            </div>
            <div className="mt-2">
              <AvailabilityBadge availability={c.availability} />
            </div>
          </Card>
        ))}
        {chargers.data?.length === 0 && <Empty title="No chargers yet">List your first charger to start earning.</Empty>}
      </div>
    </div>
  );
}

const input = "mt-1 w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-brand";

export function NewCharger() {
  const nav = useNavigate();
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [days, setDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [f, setF] = useState({
    name: "",
    category: "private",
    approx_area: "",
    address: "",
    connector: "CCS2",
    mode: "DC",
    power_kw: "30",
    price: "18",
    start: "08:00",
    end: "22:00",
    description: "",
    access_instructions: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin) return setErr("Tap the map to place your charger.");
    setBusy(true);
    setErr(null);
    try {
      await api.post("/api/owner/chargers", {
        ...f,
        lat: pin.lat,
        lng: pin.lng,
        power_kw: Number(f.power_kw),
        price_per_kwh_paise: Math.round(Number(f.price) * 100),
        amenities: [],
        schedule: [{ weekdays: days, start_time: f.start, end_time: f.end }],
      });
      nav("/owner");
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <PageHeader title="List a charger" subtitle="Your listing is reviewed by the Amply team before it goes live. Your exact address stays private until a driver pays." />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4">
          <label className="block text-sm font-medium">
            Listing name
            <input required value={f.name} onChange={set("name")} placeholder="e.g. Asha's Home DC Charger" className={input} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Type
              <select value={f.category} onChange={set("category")} className={input}>
                <option value="private">Home</option>
                <option value="business">Business</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              Area (shown publicly)
              <input required value={f.approx_area} onChange={set("approx_area")} placeholder="Koramangala 3rd Block" className={input} />
            </label>
          </div>
          <label className="block text-sm font-medium">
            Full address (private)
            <input required value={f.address} onChange={set("address")} className={input} />
          </label>
          <div className="grid grid-cols-4 gap-3">
            <label className="col-span-1 block text-sm font-medium">
              Connector
              <select value={f.connector} onChange={set("connector")} className={input}>
                {["CCS2", "TYPE2", "CHADEMO", "GBT"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Mode
              <select value={f.mode} onChange={set("mode")} className={input}>
                <option>DC</option>
                <option>AC</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              kW
              <input type="number" min="1" step="0.1" required value={f.power_kw} onChange={set("power_kw")} className={input} />
            </label>
            <label className="block text-sm font-medium">
              ₹/kWh
              <input type="number" min="1" step="0.5" required value={f.price} onChange={set("price")} className={input} />
            </label>
          </div>
          <div>
            <span className="text-sm font-medium">Available days and hours</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {WEEKDAYS.map((d, i) => (
                <button
                  type="button"
                  key={d}
                  onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${days.includes(i) ? "bg-brand text-white" : "bg-slate-100 text-slate-500"}`}
                >
                  {d}
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <input type="time" step="3600" value={f.start} onChange={set("start")} className={input} />
              <input type="time" step="3600" value={f.end} onChange={set("end")} className={input} />
            </div>
          </div>
          <label className="block text-sm font-medium">
            Description
            <textarea value={f.description} onChange={set("description")} rows={2} className={input} />
          </label>
          <label className="block text-sm font-medium">
            Access instructions (shared after payment)
            <textarea value={f.access_instructions} onChange={set("access_instructions")} rows={2} className={input} />
          </label>
        </Card>
        <div className="space-y-4">
          <Card className="overflow-hidden p-0">
            <div className="p-4 pb-2 text-sm font-medium">Tap the map to place your charger</div>
            <MapView center={pin ?? KORAMANGALA} onPick={(lat, lng) => setPin({ lat, lng })} picked={pin} zoom={14} className="h-80 w-full" />
          </Card>
          <ErrorNote message={err} />
          <Button type="submit" className="w-full" disabled={busy || days.length === 0}>
            {busy ? "Submitting…" : "Submit for review"}
          </Button>
        </div>
      </form>
    </div>
  );
}
