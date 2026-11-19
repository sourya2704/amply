import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarClock, Check, IndianRupee, Inbox, MapPin, Pause, Pencil, Play, Plug, Plus, Wallet, X } from "lucide-react";
import { api } from "../lib/api";
import { useFetch } from "../lib/auth";
import { formatDate, formatINR, formatRange, KORAMANGALA, WEEKDAYS } from "../lib/format";
import type { Booking, ChargerDetail, Payout } from "../lib/types";
import { MapView } from "../components/MapView";
import { AvailabilityBadge, Button, Card, Empty, ErrorNote, Field, inputCls, ListSkeleton, Page, SectionTitle, StatCard } from "../components/ui";
import { BookingRow } from "./Bookings";

const listingStatus: Record<string, { label: string; cls: string }> = {
  approved: { label: "Live", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  submitted: { label: "In review", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  rejected: { label: "Not approved", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
  paused: { label: "Paused", cls: "bg-surface-3 text-muted-2 ring-line" },
};

function PriceEditor({ c, onSaved }: { c: ChargerDetail; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(c.price_per_kwh_paise / 100));
  const [err, setErr] = useState<string | null>(null);
  if (!editing)
    return (
      <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
        <Pencil size={13} /> Price
      </Button>
    );
  const save = async () => {
    const rupees = Number(value);
    if (!(rupees > 0)) return setErr("Enter a valid price");
    try {
      await api.patch(`/api/owner/chargers/${c.id}`, { price_per_kwh_paise: Math.round(rupees * 100) });
      setEditing(false);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="relative">
        <span className="absolute top-1/2 left-2.5 -translate-y-1/2 text-xs font-bold text-muted">₹</span>
        <input autoFocus type="number" min="1" step="0.5" value={value} onChange={(e) => setValue(e.target.value)} className="w-24 rounded-lg bg-surface-2 py-1.5 pr-2 pl-6 text-xs font-bold ring-2 ring-primary outline-none" aria-label="Price per kWh" />
      </span>
      <Button size="sm" onClick={save}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)} aria-label="Cancel">
        <X size={14} />
      </Button>
      {err && <span className="w-full text-xs font-semibold text-rose-600">{err}</span>}
    </div>
  );
}

function ChargerTile({ c, onChange }: { c: ChargerDetail; onChange: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const s = listingStatus[c.status];
  const toggle = async () => {
    try {
      await api.post(`/api/owner/chargers/${c.id}/${c.status === "paused" ? "resume" : "pause"}`);
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-extrabold">{c.name}</div>
          <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
            <MapPin size={12} /> {c.approx_area}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${s.cls}`}>{s.label}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span className="inline-flex items-center gap-1 font-bold">
          <Plug size={13} /> {c.connector} · {c.mode} · {c.power_kw} kW
        </span>
        <span className="font-extrabold">{formatINR(c.price_per_kwh_paise)}/kWh</span>
        <AvailabilityBadge availability={c.availability} />
      </div>
      {c.status === "rejected" && c.review_note && <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">Reviewer note: {c.review_note}</p>}
      {c.status === "submitted" && <p className="mt-3 text-xs text-muted">Our team is verifying this listing. You'll get a notification when it's live.</p>}
      {["approved", "paused"].includes(c.status) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <PriceEditor c={c} onSaved={onChange} />
          <Button size="sm" variant="secondary" onClick={toggle}>
            {c.status === "paused" ? (
              <>
                <Play size={13} /> Resume
              </>
            ) : (
              <>
                <Pause size={13} /> Pause bookings
              </>
            )}
          </Button>
        </div>
      )}
      <ErrorNote message={err} />
    </Card>
  );
}

export default function Owner() {
  const chargers = useFetch(() => api.get<ChargerDetail[]>("/api/owner/chargers"), [], 8000);
  const bookings = useFetch(() => api.get<Booking[]>("/api/owner/bookings"), [], 4000);
  const payouts = useFetch(() => api.get<Payout[]>("/api/owner/payouts"), [], 10000);
  const [err, setErr] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const act = async (id: string, action: "accept" | "reject") => {
    setErr(null);
    setActing(id);
    try {
      await api.post(`/api/bookings/${id}/${action}`, action === "reject" ? { reason: "Not available at that time" } : undefined);
      bookings.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setActing(null);
    }
  };

  const all = bookings.data ?? [];
  const requests = all.filter((b) => b.status === "requested");
  const upcoming = all.filter((b) => ["accepted", "confirmed", "in_progress"].includes(b.status));
  const history = all.filter((b) => ["completed", "cancelled", "rejected", "expired"].includes(b.status)).slice(0, 6);
  const earned = payouts.data?.reduce((s, p) => s + p.amount_paise, 0) ?? 0;
  const live = chargers.data?.filter((c) => c.status === "approved").length ?? 0;

  return (
    <Page
      title="Owner dashboard"
      subtitle="Approve requests, manage your chargers and track earnings. Updates live."
      actions={
        <Link to="/owner/new">
          <Button>
            <Plus size={16} /> List a charger
          </Button>
        </Link>
      }
    >
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Requests" value={requests.length} hint="waiting for you" icon={Inbox} />
        <StatCard label="Upcoming" value={upcoming.length} hint="accepted sessions" icon={CalendarClock} />
        <StatCard label="Live chargers" value={live} hint={`of ${chargers.data?.length ?? 0} listed`} icon={Plug} />
        <StatCard label="Earned" value={formatINR(earned)} hint="from completed sessions" icon={IndianRupee} />
      </div>
      <ErrorNote message={err ?? bookings.error ?? chargers.error} />

      <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-8">
          <section>
            <SectionTitle icon={Inbox}>Booking requests</SectionTitle>
            {bookings.loading && !bookings.data ? (
              <ListSkeleton rows={2} />
            ) : requests.length === 0 ? (
              <Empty icon={Inbox} title="No pending requests">
                New requests show up here instantly.
              </Empty>
            ) : (
              <div className="space-y-3">
                {requests.map((b) => (
                  <Card key={b.id} className="animate-pop p-4 ring-2 ring-primary">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-extrabold">{b.driver.name}</div>
                        <div className="text-sm text-muted">
                          {b.charger.name} · {formatRange(b.start_at, b.end_at)}
                        </div>
                        <div className="mt-1 text-sm">
                          You earn about <b>{formatINR(b.price.energy_cost_paise)}</b> for {b.price.energy_kwh} kWh
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={() => act(b.id, "accept")} disabled={acting === b.id}>
                          <Check size={16} /> Accept
                        </Button>
                        <Button variant="danger" onClick={() => act(b.id, "reject")} disabled={acting === b.id}>
                          Decline
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {upcoming.length > 0 && (
            <section>
              <SectionTitle icon={CalendarClock}>Upcoming sessions</SectionTitle>
              <div className="space-y-3">{upcoming.map((b) => <BookingRow key={b.id} b={b} to={`/bookings/${b.id}`} showDriver />)}</div>
            </section>
          )}

          {history.length > 0 && (
            <section>
              <SectionTitle>Recent activity</SectionTitle>
              <div className="space-y-3">{history.map((b) => <BookingRow key={b.id} b={b} to={`/bookings/${b.id}`} showDriver />)}</div>
            </section>
          )}
        </div>

        <div className="space-y-8">
          <section>
            <SectionTitle icon={Plug}>Your chargers</SectionTitle>
            {chargers.loading && !chargers.data ? (
              <ListSkeleton rows={2} />
            ) : chargers.data?.length === 0 ? (
              <Empty
                icon={Plug}
                title="No chargers yet"
                action={
                  <Link to="/owner/new">
                    <Button>List your first charger</Button>
                  </Link>
                }
              >
                List your charger and start earning when it's idle.
              </Empty>
            ) : (
              <div className="space-y-3">{chargers.data?.map((c) => <ChargerTile key={c.id} c={c} onChange={chargers.reload} />)}</div>
            )}
          </section>

          <section>
            <SectionTitle icon={Wallet}>Payouts</SectionTitle>
            {payouts.data && payouts.data.length > 0 ? (
              <Card className="p-0">
                <ul className="divide-y divide-line">
                  {payouts.data.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-bold">{p.charger_name}</div>
                        <div className="text-xs text-muted">{formatDate(p.created_at)}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold tabular-nums">{formatINR(p.amount_paise)}</span>
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 capitalize ring-1 ring-amber-200">{p.status}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : (
              <Empty icon={Wallet} title="No payouts yet">
                You earn the energy cost of every completed session. Amply keeps a small service fee.
              </Empty>
            )}
          </section>
        </div>
      </div>
    </Page>
  );
}

// ---- list a charger ----

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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pin) return setErr("Tap the map to place your charger.");
    if (days.length === 0) return setErr("Pick at least one day you're available.");
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

  const seg = (active: boolean) => `flex-1 rounded-lg py-2 text-sm font-bold transition ${active ? "bg-surface shadow" : "text-muted hover:text-ink"}`;

  return (
    <Page
      title="List a charger"
      subtitle="Our team verifies every listing before it goes live. Your exact address stays private until a driver pays."
      back={{ to: "/owner", label: "Owner dashboard" }}
    >
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-5">
          <Card className="space-y-4">
            <SectionTitle>Basics</SectionTitle>
            <Field label="Listing name">
              <input required value={f.name} onChange={set("name")} placeholder="Asha's Home DC Charger" className={inputCls} />
            </Field>
            <div>
              <span className="mb-1.5 block text-sm font-bold">Type</span>
              <div className="flex rounded-xl bg-surface-3 p-1">
                {[
                  ["private", "Home"],
                  ["business", "Business"],
                ].map(([v, l]) => (
                  <button type="button" key={v} onClick={() => setF({ ...f, category: v })} className={seg(f.category === v)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Area" hint="Shown publicly, e.g. Koramangala 3rd Block">
              <input required value={f.approx_area} onChange={set("approx_area")} className={inputCls} />
            </Field>
            <Field label="Full address" hint="Private. Only shared with a driver after they pay.">
              <input required value={f.address} onChange={set("address")} className={inputCls} />
            </Field>
          </Card>

          <Card className="space-y-4">
            <SectionTitle>Charger</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Connector">
                <select value={f.connector} onChange={set("connector")} className={inputCls}>
                  {["CCS2", "TYPE2", "CHADEMO", "GBT"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <div>
                <span className="mb-1.5 block text-sm font-bold">Current</span>
                <div className="flex rounded-xl bg-surface-3 p-1">
                  {["DC", "AC"].map((m) => (
                    <button type="button" key={m} onClick={() => setF({ ...f, mode: m })} className={seg(f.mode === m)}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <Field label="Power (kW)">
                <input type="number" min="1" step="0.1" required value={f.power_kw} onChange={set("power_kw")} className={inputCls} />
              </Field>
              <Field label="Price (₹ per kWh)">
                <input type="number" min="1" step="0.5" required value={f.price} onChange={set("price")} className={inputCls} />
              </Field>
            </div>
          </Card>

          <Card className="space-y-4">
            <SectionTitle>Availability</SectionTitle>
            <div className="grid grid-cols-7 gap-1.5">
              {WEEKDAYS.map((d, i) => (
                <button
                  type="button"
                  key={d}
                  onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())}
                  className={`rounded-lg py-2 text-xs font-bold transition ${days.includes(i) ? "bg-ink text-white" : "bg-surface-3 text-muted hover:bg-line"}`}
                  aria-pressed={days.includes(i)}
                >
                  {d}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">
                <input type="time" step="3600" value={f.start} onChange={set("start")} className={inputCls} />
              </Field>
              <Field label="Until">
                <input type="time" step="3600" value={f.end} onChange={set("end")} className={inputCls} />
              </Field>
            </div>
          </Card>

          <Card className="space-y-4">
            <SectionTitle>For drivers</SectionTitle>
            <Field label="Description">
              <textarea value={f.description} onChange={set("description")} rows={2} placeholder="Covered parking, quiet lane, cable included" className={inputCls} />
            </Field>
            <Field label="Access instructions" hint="Shared only after payment.">
              <textarea value={f.access_instructions} onChange={set("access_instructions")} rows={2} placeholder="Ring the bell at gate 2, park in the left bay" className={inputCls} />
            </Field>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <span className="text-sm font-bold">Charger location</span>
              <span className={`text-xs font-bold ${pin ? "text-emerald-700" : "text-muted"}`}>{pin ? "Pinned" : "Tap the map to place it"}</span>
            </div>
            <MapView center={pin ?? KORAMANGALA} onPick={(lat, lng) => setPin({ lat, lng })} picked={pin} zoom={14} className="h-96 w-full" />
          </Card>
          <ErrorNote message={err} />
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? "Submitting…" : "Submit for review"}
          </Button>
        </div>
      </form>
    </Page>
  );
}
