import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Flag, Lock, MapPin, Navigation, Star, User, Zap } from "lucide-react";
import { api, ApiError, qs } from "../lib/api";
import { useAuth, useFetch } from "../lib/auth";
import { formatDate, formatINR, formatTime, todayIST, WEEKDAYS } from "../lib/format";
import type { Booking, ChargerDetail as Detail, PriceBreakdown, Slot } from "../lib/types";
import { MapView } from "../components/MapView";
import { AvailabilityBadge, Button, Card, CompatChip, ErrorNote, Spinner } from "../components/ui";

export function PriceTable({ p }: { p: PriceBreakdown }) {
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex justify-between text-slate-600">
        <span>Energy ({p.energy_kwh} kWh est.)</span>
        <span>{formatINR(p.energy_cost_paise)}</span>
      </div>
      <div className="flex justify-between text-slate-600">
        <span>Service fee</span>
        <span>{formatINR(p.service_fee_paise)}</span>
      </div>
      <div className="flex justify-between text-slate-600">
        <span>GST (18% on fee)</span>
        <span>{formatINR(p.tax_paise)}</span>
      </div>
      <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-bold">
        <span>Estimated total</span>
        <span>{formatINR(p.total_paise)}</span>
      </div>
      <p className="text-[11px] text-slate-400">Estimate only. Final charge depends on energy actually delivered.</p>
    </div>
  );
}

export default function ChargerDetail() {
  const { id = "" } = useParams();
  const { vehicle } = useAuth();
  const nav = useNavigate();
  const [date, setDate] = useState(todayIST());
  const [start, setStart] = useState<number | null>(null);
  const [count, setCount] = useState(1);
  const [kwh, setKwh] = useState(20);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reported, setReported] = useState(false);

  const charger = useFetch(() => api.get<Detail>(`/api/chargers/${id}?${qs({ vehicle_id: vehicle?.id })}`), [id, vehicle?.id]);
  const slots = useFetch(() => api.get<{ slots: Slot[]; bookable: boolean }>(`/api/chargers/${id}/slots?date=${date}`), [id, date]);
  const estimate = useFetch(() => api.get<PriceBreakdown>(`/api/chargers/${id}/estimate?kwh=${kwh}`), [id, kwh]);

  if (charger.error) return <div className="mx-auto max-w-5xl p-6"><ErrorNote message={charger.error} /></div>;
  const c = charger.data;
  if (!c) return <Spinner />;

  const list = slots.data?.slots ?? [];
  const chosen = start !== null ? list.slice(start, start + count) : [];

  const clickSlot = (i: number) => {
    setErr(null);
    if (start !== null && i === start + count && count < 4 && list[i]?.available && list[i].start_at === list[i - 1].end_at) setCount(count + 1);
    else {
      setStart(i);
      setCount(1);
    }
  };

  const book = async () => {
    if (!vehicle || chosen.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const b = await api.post<Booking>(
        "/api/bookings",
        { charger_id: c.id, vehicle_id: vehicle.id, start_at: chosen[0].start_at, end_at: chosen[chosen.length - 1].end_at, estimated_kwh: kwh },
        { "Idempotency-Key": crypto.randomUUID() },
      );
      nav(`/bookings/${b.id}`);
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.code === "SLOT_TAKEN" ? "Someone just booked that slot. The slot list has been refreshed. Pick another time." : ae.message);
      setStart(null);
      slots.reload();
    } finally {
      setBusy(false);
    }
  };

  const report = async () => {
    const reason = window.prompt("What's wrong with this listing? (e.g. charger broken, unsafe, wrong details)");
    if (!reason?.trim()) return;
    await api.post("/api/reports", { target_type: "charger", target_id: c.id, reason });
    setReported(true);
  };

  const days = [0, 1, 2, 3].map((d) => todayIST(d));
  const canBook = c.bookable && c.compatibility === "compatible";

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-navy">
        <ArrowLeft size={16} /> Back to search
      </Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold tracking-wide text-slate-500 uppercase">
                  {c.category === "private" ? "Home charger" : c.category === "business" ? "Business" : "Public station"}
                </span>
                <h1 className="mt-2 text-2xl font-bold tracking-tight">{c.name}</h1>
                <p className="mt-1 flex items-center gap-1 text-sm text-slate-500">
                  <MapPin size={14} /> {c.address ?? c.approx_area}
                  {!c.address && c.category === "private" && <span className="text-xs">(exact address after payment)</span>}
                </p>
              </div>
              <div className="text-right">
                <div className="text-3xl font-extrabold">{formatINR(c.price_per_kwh_paise)}</div>
                <div className="text-xs text-slate-500">per kWh</div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-brand">
                <Zap size={15} /> {c.connector} · {c.mode} · {c.power_kw} kW
              </span>
              <AvailabilityBadge availability={c.availability} />
              {c.rating > 0 && (
                <span className="inline-flex items-center gap-1 text-sm text-slate-600">
                  <Star size={15} className="fill-amber-400 text-amber-400" /> {c.rating} · {c.review_count} reviews
                </span>
              )}
            </div>
            <div className="mt-4 rounded-xl bg-slate-50 p-3">
              <CompatChip compatibility={c.compatibility} reason={c.compatibility_reason} />
              <p className="mt-1 text-xs text-slate-500">
                {c.compatibility_reason}
                {c.effective_power_kw && c.effective_power_kw < c.power_kw && ` · your car will charge at up to ${c.effective_power_kw} kW`}
              </p>
            </div>
          </Card>

          <Card>
            <h2 className="font-semibold">About this charger</h2>
            {/* Owner-written text: rendered as plain text only. */}
            <p className="mt-2 text-sm whitespace-pre-line text-slate-600">{c.description || "No description."}</p>
            {c.owner_name && (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-500">
                <User size={14} /> Listed by {c.owner_name}
              </p>
            )}
            {c.amenities.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {c.amenities.map((a) => (
                  <span key={a} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                    {a}
                  </span>
                ))}
              </div>
            )}
            {c.schedule.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Owner's available hours</h3>
                <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[11px]">
                  {WEEKDAYS.map((d, i) => {
                    const r = c.schedule.filter((s) => s.weekday === i);
                    return (
                      <div key={d} className={`rounded-lg p-1.5 ${r.length ? "bg-blue-50 text-brand" : "bg-slate-50 text-slate-400"}`}>
                        <div className="font-bold">{d}</div>
                        {r.length ? r.map((s) => <div key={s.start_time}>{s.start_time}–{s.end_time}</div>) : <div>closed</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {c.access_instructions && (
              <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
                <b>Access:</b> {c.access_instructions}
              </div>
            )}
            <button onClick={report} disabled={reported} className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-rose-600">
              <Flag size={13} /> {reported ? "Reported. Our team will review it." : "Report this listing"}
            </button>
          </Card>

          <Card className="overflow-hidden p-0">
            <MapView center={{ lat: c.lat, lng: c.lng }} chargers={[c]} zoom={15} className="h-64 w-full" />
          </Card>
        </div>

        <div>
          <Card className="sticky top-20">
            {!c.bookable ? (
              <div className="space-y-3">
                <h2 className="font-semibold">Public station: directions only</h2>
                <p className="text-sm text-slate-500">
                  This operator doesn't support booking through Amply yet, and its availability is not confirmed. Check on arrival.
                </p>
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`} target="_blank" rel="noreferrer">
                  <Button className="w-full">
                    <Navigation size={16} /> Get directions
                  </Button>
                </a>
              </div>
            ) : (
              <div className="space-y-4">
                <h2 className="font-semibold">Book a slot</h2>
                <div className="flex gap-1.5">
                  {days.map((d) => (
                    <button
                      key={d}
                      onClick={() => {
                        setDate(d);
                        setStart(null);
                      }}
                      className={`flex-1 rounded-xl px-2 py-2 text-xs font-semibold ${d === date ? "bg-navy text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                    >
                      {d === days[0] ? "Today" : formatDate(d + "T12:00:00+05:30")}
                    </button>
                  ))}
                </div>
                {slots.loading && !slots.data ? (
                  <Spinner label="Loading slots…" />
                ) : list.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500">Owner isn't available this day.</p>
                ) : (
                  <div>
                    <div className="grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto">
                      {list.map((s, i) => {
                        const sel = start !== null && i >= start && i < start + count;
                        return (
                          <button
                            key={s.start_at}
                            disabled={!s.available}
                            onClick={() => clickSlot(i)}
                            className={`rounded-lg py-2 text-xs font-semibold transition ${sel ? "bg-brand text-white" : s.available ? "bg-white ring-1 ring-slate-200 hover:ring-brand" : "bg-slate-100 text-slate-300 line-through"}`}
                          >
                            {formatTime(s.start_at)}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[11px] text-slate-400">Tap a start time, then tap the next slots to extend (up to 4 hours).</p>
                  </div>
                )}
                <label className="block text-sm">
                  <span className="font-medium">Energy you need</span>
                  <select value={kwh} onChange={(e) => setKwh(Number(e.target.value))} className="mt-1 w-full rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
                    {[5, 10, 20, 30, 40].map((k) => (
                      <option key={k} value={k}>
                        {k} kWh
                      </option>
                    ))}
                  </select>
                </label>
                {estimate.data && <PriceTable p={estimate.data} />}
                <ErrorNote message={err} />
                {!vehicle && <ErrorNote message="Add a vehicle first to book." />}
                {vehicle && c.compatibility !== "compatible" && <ErrorNote message={`Can't book: ${c.compatibility_reason}`} />}
                <Button className="w-full" disabled={!canBook || chosen.length === 0 || busy} onClick={book}>
                  {busy ? "Sending…" : chosen.length ? `Request ${formatTime(chosen[0].start_at)} – ${formatTime(chosen[chosen.length - 1].end_at)}` : "Pick a time"}
                </Button>
                <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Lock size={12} /> The owner approves first. You pay only after they accept.
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
