import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CircleAlert, CircleCheck, Clock, Flag, Gauge, KeyRound, Lock, MapPin, Navigation, Plug, User, Zap } from "lucide-react";
import { api, ApiError, qs } from "../lib/api";
import { useAuth, useFetch } from "../lib/auth";
import { formatDate, formatINR, formatTime, todayIST, WEEKDAYS } from "../lib/format";
import type { Booking, ChargerDetail as Detail, PriceBreakdown, Review, Slot } from "../lib/types";
import { MapView } from "../components/MapView";
import { PriceTable } from "../components/PriceTable";
import { AvailabilityBadge, Button, Card, ErrorNote, SectionTitle, Skeleton, Stars, usePageTitle } from "../components/ui";

const KWH_OPTIONS = [5, 10, 20, 30, 40];
const categoryLabel = { private: "Home charger", business: "Business", public: "Public station" };

function Spec({ icon: Icon, label, value }: { icon: typeof Zap; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-3.5">
      <div className="flex items-center gap-1.5 text-xs font-bold text-muted">
        <Icon size={14} /> {label}
      </div>
      <div className="mt-1 font-extrabold">{value}</div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 pt-8 sm:px-6 lg:grid-cols-[1fr_400px]">
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
      <Skeleton className="h-[480px] w-full rounded-2xl" />
    </main>
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
  const reviews = useFetch(() => api.get<Review[]>(`/api/chargers/${id}/reviews`), [id]);
  usePageTitle(charger.data?.name ?? "Charger");

  if (charger.error)
    return (
      <main className="mx-auto max-w-3xl px-4 pt-8 sm:px-6">
        <ErrorNote message={charger.error} />
      </main>
    );
  const c = charger.data;
  if (!c) return <DetailSkeleton />;

  const list = slots.data?.slots ?? [];
  const chosen = start !== null ? list.slice(start, start + count) : [];
  const canBook = c.bookable && c.compatibility === "compatible";
  const days = [0, 1, 2, 3].map((d) => todayIST(d));

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
      setErr(ae.code === "SLOT_TAKEN" ? "Someone just booked that slot. We've refreshed the times, pick another." : ae.message);
      setStart(null);
      slots.reload();
    } finally {
      setBusy(false);
    }
  };

  const report = async () => {
    const reason = window.prompt("What's wrong with this listing? For example: charger broken, unsafe, wrong details.");
    if (!reason?.trim()) return;
    try {
      await api.post("/api/reports", { target_type: "charger", target_id: c.id, reason });
      setReported(true);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const compatTone =
    c.compatibility === "compatible"
      ? { cls: "bg-emerald-50 text-emerald-800 ring-emerald-200", Icon: CircleCheck, title: `Fits your ${vehicle?.model ?? "EV"}` }
      : c.compatibility === "incompatible"
        ? { cls: "bg-rose-50 text-rose-700 ring-rose-200", Icon: CircleAlert, title: "Won't work with your EV" }
        : { cls: "bg-surface-2 text-muted-2 ring-line", Icon: CircleAlert, title: "Compatibility unknown" };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-6 md:pb-12">
      <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft size={16} /> Back to map
      </Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-5">
          {/* hero */}
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <span className="rounded-md bg-surface-3 px-2 py-0.5 text-[11px] font-bold tracking-wide text-muted uppercase">{categoryLabel[c.category]}</span>
                <h1 className="mt-2 text-3xl leading-tight">{c.name}</h1>
                <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted">
                  <MapPin size={15} className="mt-0.5 shrink-0" />
                  <span>
                    {c.address ?? c.approx_area}
                    {!c.address && c.category === "private" && <span className="block text-xs">Exact address is shared after payment.</span>}
                  </span>
                </p>
                {c.rating > 0 && (
                  <div className="mt-2 flex items-center gap-2 text-sm">
                    <Stars value={c.rating} />
                    <span className="font-bold">{c.rating}</span>
                    <span className="text-muted">({c.review_count} reviews)</span>
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="text-4xl font-extrabold tracking-tight">{formatINR(c.price_per_kwh_paise)}</div>
                <div className="text-xs font-semibold text-muted">per kWh</div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Spec icon={Plug} label="Connector" value={c.connector} />
              <Spec icon={Zap} label="Type" value={c.mode === "DC" ? "DC fast" : "AC"} />
              <Spec icon={Gauge} label="Power" value={c.effective_power_kw && c.effective_power_kw < c.power_kw ? `${c.effective_power_kw} of ${c.power_kw} kW` : `${c.power_kw} kW`} />
              <div className="rounded-2xl bg-surface-2 p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-muted">
                  <Clock size={14} /> Availability
                </div>
                <div className="mt-1.5">
                  <AvailabilityBadge availability={c.availability} short />
                </div>
              </div>
            </div>

            <div className={`mt-4 flex items-start gap-2.5 rounded-2xl p-3.5 text-sm ring-1 ${compatTone.cls}`}>
              <compatTone.Icon size={18} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-extrabold">{compatTone.title}</div>
                <div className="opacity-80">{c.compatibility_reason}</div>
              </div>
            </div>
          </Card>

          {/* about */}
          <Card>
            <SectionTitle>About this charger</SectionTitle>
            {/* Owner-written text: rendered as plain text only. */}
            <p className="text-sm whitespace-pre-line text-muted-2">{c.description || "No description yet."}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {c.owner_name && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-bold">
                  <User size={13} /> Hosted by {c.owner_name}
                </span>
              )}
              {c.amenities.map((a) => (
                <span key={a} className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold capitalize text-muted-2">
                  {a}
                </span>
              ))}
            </div>

            {c.schedule.length > 0 && (
              <>
                <h3 className="mt-6 mb-2 text-xs font-bold tracking-wide text-muted uppercase">Host's available hours</h3>
                <div className="grid grid-cols-7 gap-1.5 text-center text-[11px]">
                  {WEEKDAYS.map((d, i) => {
                    const r = c.schedule.filter((s) => s.weekday === i);
                    return (
                      <div key={d} className={`rounded-xl px-1 py-2 ${r.length ? "bg-primary-soft" : "bg-surface-2 text-muted"}`}>
                        <div className="font-extrabold">{d}</div>
                        {r.length ? (
                          r.map((s) => (
                            <div key={s.start_time} className="mt-0.5 font-semibold text-primary-ink">
                              {s.start_time}
                              <br />
                              {s.end_time}
                            </div>
                          ))
                        ) : (
                          <div className="mt-0.5">Closed</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {c.access_instructions && (
              <div className="mt-4 flex items-start gap-2 rounded-2xl bg-emerald-50 p-3.5 text-sm text-emerald-900 ring-1 ring-emerald-200">
                <KeyRound size={16} className="mt-0.5 shrink-0" /> {c.access_instructions}
              </div>
            )}
            <button onClick={report} disabled={reported} className="mt-5 inline-flex items-center gap-1.5 text-xs font-bold text-muted hover:text-rose-600 disabled:hover:text-muted">
              <Flag size={13} /> {reported ? "Reported. Our team will review it." : "Report this listing"}
            </button>
          </Card>

          {reviews.data && reviews.data.length > 0 && (
            <Card>
              <SectionTitle>Reviews</SectionTitle>
              <div className="divide-y divide-line">
                {reviews.data.map((r, i) => (
                  <div key={i} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-3 text-xs font-extrabold">{r.author_name[0]}</span>
                      <span className="font-bold">{r.author_name}</span>
                      <Stars value={r.rating} size={13} />
                      <span className="text-xs text-muted">{formatDate(r.created_at)}</span>
                    </div>
                    {/* Review text is user content: plain text only. */}
                    {r.comment && <p className="mt-1.5 pl-9 text-sm text-muted-2">{r.comment}</p>}
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="overflow-hidden p-0">
            <MapView center={{ lat: c.lat, lng: c.lng }} chargers={[c]} zoom={15} className="h-64 w-full" />
          </Card>
        </div>

        {/* booking panel */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card className="p-5">
            {!c.bookable ? (
              <div className="space-y-3">
                <SectionTitle>Directions only</SectionTitle>
                <p className="text-sm text-muted">This operator doesn't take bookings through Amply yet, and availability isn't confirmed. Check on arrival.</p>
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`} target="_blank" rel="noreferrer" className="block">
                  <Button size="lg" className="w-full">
                    <Navigation size={17} /> Get directions
                  </Button>
                </a>
              </div>
            ) : (
              <div className="space-y-5">
                <SectionTitle>Book a slot</SectionTitle>
                <div className="grid grid-cols-4 gap-1.5">
                  {days.map((d, i) => (
                    <button
                      key={d}
                      onClick={() => {
                        setDate(d);
                        setStart(null);
                      }}
                      className={`rounded-xl px-1 py-2 text-xs font-bold transition ${d === date ? "bg-ink text-white" : "bg-surface-3 hover:bg-line"}`}
                    >
                      {i === 0 ? "Today" : i === 1 ? "Tomorrow" : formatDate(d + "T12:00:00+05:30").replace(",", "")}
                    </button>
                  ))}
                </div>

                <div>
                  {slots.loading && !slots.data ? (
                    <div className="grid grid-cols-4 gap-1.5">
                      {Array.from({ length: 8 }, (_, i) => (
                        <Skeleton key={i} className="h-9" />
                      ))}
                    </div>
                  ) : list.length === 0 ? (
                    <p className="rounded-xl bg-surface-2 p-4 text-center text-sm text-muted">The host isn't available this day.</p>
                  ) : (
                    <>
                      <div className="grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto">
                        {list.map((s, i) => {
                          const sel = start !== null && i >= start && i < start + count;
                          return (
                            <button
                              key={s.start_at}
                              disabled={!s.available}
                              onClick={() => clickSlot(i)}
                              className={`rounded-lg py-2 text-xs font-bold transition ${sel ? "bg-primary ring-2 ring-ink" : s.available ? "bg-surface ring-1 ring-line hover:ring-ink" : "bg-surface-2 text-faint line-through"}`}
                            >
                              {formatTime(s.start_at)}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-xs text-muted">Tap a start time, then the next slots to extend (up to 4 hours).</p>
                    </>
                  )}
                </div>

                <div>
                  <div className="mb-1.5 text-sm font-bold">Energy you need</div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {KWH_OPTIONS.map((k) => (
                      <button key={k} onClick={() => setKwh(k)} className={`rounded-lg py-2 text-xs font-bold transition ${kwh === k ? "bg-ink text-white" : "bg-surface-3 hover:bg-line"}`}>
                        {k} kWh
                      </button>
                    ))}
                  </div>
                </div>

                {estimate.data && <PriceTable p={estimate.data} />}
                <ErrorNote message={err} />
                {!vehicle && <ErrorNote message="Add your EV first so we can check this charger fits it." />}
                <Button size="lg" className="w-full" disabled={!canBook || chosen.length === 0 || busy} onClick={book}>
                  {busy ? "Sending request…" : chosen.length ? `Request ${formatTime(chosen[0].start_at)} – ${formatTime(chosen[chosen.length - 1].end_at)}` : "Pick a time"}
                </Button>
                <p className="flex items-start gap-1.5 text-xs text-muted">
                  <Lock size={13} className="mt-0.5 shrink-0" /> The host approves first. You pay only after they accept, and can cancel free before your slot.
                </p>
              </div>
            )}
          </Card>
        </aside>
      </div>
    </main>
  );
}
