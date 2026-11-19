import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CalendarCheck, Check, CheckCircle2, CreditCard, KeyRound, LifeBuoy, Lock, MapPin, Navigation, Play, Star, Timer, X } from "lucide-react";
import { api } from "../lib/api";
import { useAuth, useFetch } from "../lib/auth";
import { payForBooking } from "../lib/payments";
import { formatDateTime, formatINR, formatRange, formatTime } from "../lib/format";
import type { Booking, BookingStatus } from "../lib/types";
import { Button, Card, Empty, ErrorNote, inputCls, ListSkeleton, Page, SectionTitle, Skeleton, StatusPill, usePageTitle } from "../components/ui";
import { PriceTable } from "../components/PriceTable";

const ACTIVE: BookingStatus[] = ["requested", "accepted", "confirmed", "in_progress"];
const tz = { timeZone: "Asia/Kolkata" } as const;

function DateTile({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <div className="grid h-14 w-14 shrink-0 place-content-center rounded-2xl bg-primary-soft text-center">
      <div className="text-lg leading-none font-extrabold">{d.toLocaleDateString("en-IN", { ...tz, day: "numeric" })}</div>
      <div className="mt-0.5 text-[10px] font-bold tracking-wide text-primary-ink uppercase">{d.toLocaleDateString("en-IN", { ...tz, month: "short" })}</div>
    </div>
  );
}

export function BookingRow({ b, to, showDriver = false }: { b: Booking; to: string; showDriver?: boolean }) {
  return (
    <Link to={to} className="flex items-center gap-4 rounded-2xl bg-surface p-3.5 ring-1 ring-line transition hover:-translate-y-0.5 hover:shadow-md hover:ring-primary-dark">
      <DateTile iso={b.start_at} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-extrabold">{b.charger.name}</div>
        <div className="truncate text-sm text-muted">
          {formatTime(b.start_at)} – {formatTime(b.end_at)}
          {showDriver ? ` · ${b.driver.name}` : b.charger.approx_area ? ` · ${b.charger.approx_area}` : ""}
        </div>
        <div className="mt-1.5 sm:hidden">
          <StatusPill status={b.status} />
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="font-extrabold tabular-nums">{formatINR(b.price.total_paise)}</span>
        <span className="hidden sm:block">
          <StatusPill status={b.status} />
        </span>
      </div>
    </Link>
  );
}

export function BookingList() {
  const { data, error, loading } = useFetch(() => api.get<Booking[]>("/api/bookings"), [], 5000);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const upcoming = data?.filter((b) => ACTIVE.includes(b.status)) ?? [];
  const past = data?.filter((b) => !ACTIVE.includes(b.status)) ?? [];
  const list = tab === "upcoming" ? upcoming : past;

  return (
    <Page title="Your bookings" subtitle="Updates live as owners respond." width="max-w-3xl">
      <div className="mb-5 inline-flex rounded-full bg-surface-3 p-1 text-sm font-bold" role="tablist">
        {(
          [
            ["upcoming", `Upcoming${upcoming.length ? ` (${upcoming.length})` : ""}`],
            ["past", "Past"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`rounded-full px-4 py-2 transition ${tab === key ? "bg-surface shadow" : "text-muted hover:text-ink"}`}>
            {label}
          </button>
        ))}
      </div>
      <ErrorNote message={error} />
      {loading && !data ? (
        <ListSkeleton rows={4} height="h-20" />
      ) : list.length === 0 ? (
        <Empty
          icon={CalendarCheck}
          title={tab === "upcoming" ? "No upcoming bookings" : "No past bookings yet"}
          action={
            <Link to="/">
              <Button>Find a charger</Button>
            </Link>
          }
        >
          {tab === "upcoming" ? "Book a slot at a charger near you and it will show up here." : "Completed and cancelled bookings appear here."}
        </Empty>
      ) : (
        <div className="space-y-3">{list.map((b) => <BookingRow key={b.id} b={b} to={`/bookings/${b.id}`} />)}</div>
      )}
    </Page>
  );
}

// ---- detail ----

const eventText: Record<string, string> = {
  requested: "Booking requested",
  accepted: "Owner accepted",
  rejected: "Owner declined",
  confirmed: "Payment received, booking confirmed",
  in_progress: "Charging session started",
  cancelled: "Booking cancelled",
  expired: "Expired: no response or payment in time",
  completed: "Charging session completed",
};

const STEPS = ["Requested", "Accepted", "Paid", "Charging", "Done"];
const stepIndex: Partial<Record<BookingStatus, number>> = { requested: 0, accepted: 1, confirmed: 2, in_progress: 3, completed: 4 };

function headline(b: Booking, isDriver: boolean): { title: string; text: string } {
  const owner = "the owner";
  switch (b.status) {
    case "requested":
      return isDriver ? { title: `Waiting for ${owner} to accept`, text: "You'll pay only after they accept." } : { title: "New request", text: `${b.driver.name} wants this slot. Accept or decline.` };
    case "accepted":
      return isDriver ? { title: "Accepted. Pay to confirm", text: "Your slot is held for a short time." } : { title: "Waiting for payment", text: `${b.driver.name} needs to pay to confirm.` };
    case "confirmed":
      return { title: `Confirmed for ${formatTime(b.start_at)}`, text: isDriver ? "Address and access details are below." : "Payment received. Get the charger ready." };
    case "in_progress":
      return { title: "Charging now", text: "Mark the session complete when you're done." };
    case "completed":
      return { title: "Session completed", text: isDriver ? "Thanks for charging with Amply." : "Your payout is being processed." };
    case "rejected":
      return { title: "Declined", text: "The owner can't host this slot. Try another time or charger." };
    case "cancelled":
      return { title: "Cancelled", text: b.payment_status === "refunded" ? "Your payment was refunded in full." : "This booking was cancelled." };
    case "expired":
      return { title: "Expired", text: "No response or payment in time, so the slot was released." };
  }
}

function Progress({ status }: { status: BookingStatus }) {
  const at = stepIndex[status];
  if (at === undefined) return null;
  return (
    <ol className="mt-5 grid grid-cols-5 gap-1.5" aria-label="Booking progress">
      {STEPS.map((s, i) => (
        <li key={s}>
          <div className={`h-1.5 rounded-full ${i <= at ? "bg-primary-dark" : "bg-surface-3"}`} />
          <div className={`mt-1.5 text-[11px] font-bold ${i <= at ? "text-ink" : "text-muted"}`}>{s}</div>
        </li>
      ))}
    </ol>
  );
}

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = new Date(until).getTime() - now;
  if (ms <= 0) return <>expiring…</>;
  return (
    <span className="tabular-nums">
      {Math.floor(ms / 60000)}:{String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}
    </span>
  );
}

const SUPPORT = [
  ["charger_not_working", "Charger not working"],
  ["access_issue", "Couldn't get in"],
  ["billing", "Billing"],
  ["safety", "Safety concern"],
  ["other", "Something else"],
];

function ReviewForm({ id, onDone }: { id: string; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/api/bookings/${id}/review`, { rating, comment });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Card>
      <SectionTitle icon={Star}>Rate this charge</SectionTitle>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} aria-label={`${n} star${n > 1 ? "s" : ""}`} className="rounded-lg p-1 transition hover:scale-110">
            <Star size={30} className={n <= rating ? "fill-amber-400 text-amber-500" : "text-line"} />
          </button>
        ))}
      </div>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={1000} placeholder="Optional: access, charging speed, the host" className={`${inputCls} mt-3`} />
      <ErrorNote message={err} />
      <Button className="mt-3" disabled={rating === 0 || busy} onClick={submit}>
        Submit review
      </Button>
    </Card>
  );
}

function SupportForm({ id, onDone }: { id: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("charger_not_working");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-bold text-muted hover:text-ink">
        <LifeBuoy size={16} /> Get help with this booking
      </button>
    );
  const submit = async () => {
    try {
      await api.post(`/api/bookings/${id}/support`, { category, description: text });
      setOpen(false);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Card>
      <SectionTitle icon={LifeBuoy} action={<button onClick={() => setOpen(false)} aria-label="Close" className="rounded-full p-1 text-muted hover:bg-surface-3"><X size={18} /></button>}>
        Get help
      </SectionTitle>
      <div className="flex flex-wrap gap-2">
        {SUPPORT.map(([k, label]) => (
          <button key={k} onClick={() => setCategory(k)} className={`rounded-full px-3.5 py-2 text-xs font-bold transition ${category === k ? "bg-ink text-white" : "bg-surface-3 hover:bg-line"}`}>
            {label}
          </button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} placeholder="Tell us what happened" className={`${inputCls} mt-3`} />
      <ErrorNote message={err} />
      <Button className="mt-3" disabled={!text.trim()} onClick={submit}>
        Send to Amply support
      </Button>
    </Card>
  );
}

export function BookingDetail() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const { data: b, error, setData, reload } = useFetch(() => api.get<Booking>(`/api/bookings/${id}`), [id], 4000);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  usePageTitle(b ? b.charger.name : "Booking");

  if (error) return <Page title="Booking" width="max-w-3xl"><ErrorNote message={error} /></Page>;
  if (!b || !user)
    return (
      <main className="mx-auto max-w-5xl space-y-4 px-4 pt-8 sm:px-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </main>
    );

  const isDriver = b.driver.id === user.id;
  const run = async (key: string, fn: () => Promise<Booking>) => {
    setBusy(key);
    setErr(null);
    try {
      setData(await fn());
    } catch (e) {
      setErr((e as Error).message);
      reload();
    } finally {
      setBusy(null);
    }
  };
  const act = (action: string, body?: unknown) => run(action, () => api.post<Booking>(`/api/bookings/${b.id}/${action}`, body));
  const startsIn = new Date(b.start_at).getTime() - Date.now();
  const h = headline(b, isDriver);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-28 sm:px-6 md:pb-12">
      <Link to={isDriver ? "/bookings" : "/owner"} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <Navigation size={14} className="-rotate-90" /> {isDriver ? "Your bookings" : "Owner dashboard"}
      </Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <StatusPill status={b.status} />
                <h1 className="mt-3 text-2xl leading-tight sm:text-3xl">{h.title}</h1>
                <p className="mt-1 text-muted">{h.text}</p>
              </div>
            </div>
            <Progress status={b.status} />

            <div className="mt-6 flex items-center gap-4 rounded-2xl bg-surface-2 p-4">
              <DateTile iso={b.start_at} />
              <div className="min-w-0">
                <div className="truncate font-extrabold">{b.charger.name}</div>
                <div className="text-sm text-muted">{formatRange(b.start_at, b.end_at)}</div>
                {!isDriver && <div className="text-sm text-muted">Driver: {b.driver.name}</div>}
              </div>
            </div>

            {b.expires_at && (
              <p className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-200">
                <Timer size={16} /> Slot held for <Countdown until={b.expires_at} />
              </p>
            )}

            {b.address ? (
              <div className="mt-4 space-y-2.5 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-200">
                <p className="flex items-start gap-2 font-semibold">
                  <MapPin size={16} className="mt-0.5 shrink-0" /> {b.address}
                </p>
                <p className="flex items-start gap-2">
                  <KeyRound size={16} className="mt-0.5 shrink-0" /> {b.access_instructions}
                </p>
              </div>
            ) : (
              ["requested", "accepted"].includes(b.status) && (
                <p className="mt-4 flex items-center gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
                  <Lock size={15} /> Exact address and access instructions appear after payment.
                </p>
              )
            )}

            <ErrorNote message={err} />
            <div className="mt-5 flex flex-wrap gap-2">
              {isDriver && b.status === "accepted" && (
                <Button size="lg" onClick={() => run("pay", () => payForBooking(b.id, { name: user.name, email: user.email }))} disabled={!!busy}>
                  <CreditCard size={18} /> {busy === "pay" ? "Processing…" : `Pay ${formatINR(b.price.total_paise)}`}
                </Button>
              )}
              {!isDriver && b.status === "requested" && (
                <>
                  <Button size="lg" onClick={() => act("accept")} disabled={!!busy}>
                    <Check size={18} /> Accept
                  </Button>
                  <Button size="lg" variant="danger" onClick={() => act("reject", { reason: "Not available" })} disabled={!!busy}>
                    Decline
                  </Button>
                </>
              )}
              {b.status === "confirmed" && (
                <Button size="lg" variant="dark" onClick={() => act("start")} disabled={!!busy || startsIn > 15 * 60000}>
                  <Play size={17} /> Start charging
                </Button>
              )}
              {["confirmed", "in_progress"].includes(b.status) && (
                <Button size="lg" variant={b.status === "in_progress" ? "primary" : "secondary"} onClick={() => act("complete")} disabled={!!busy}>
                  <CheckCircle2 size={18} /> Mark complete
                </Button>
              )}
              {isDriver && ["requested", "accepted", "confirmed"].includes(b.status) && (
                <Button
                  size="lg"
                  variant="ghost"
                  onClick={() => {
                    const msg = b.payment_status === "paid" ? `Cancel and get a full refund of ${formatINR(b.price.total_paise)}?` : "Cancel this booking?";
                    if (window.confirm(msg)) act("cancel", { reason: "Driver cancelled" });
                  }}
                  disabled={!!busy}
                >
                  Cancel booking
                </Button>
              )}
            </div>
            {b.status === "confirmed" && startsIn > 15 * 60000 && <p className="mt-2 text-xs text-muted">Charging can start from 15 minutes before your slot.</p>}
          </Card>

          {isDriver && b.status === "completed" && !b.reviewed && <ReviewForm id={b.id} onDone={reload} />}

          <Card>
            <SectionTitle>Timeline</SectionTitle>
            <ol className="relative space-y-4 border-l-2 border-line pl-5">
              {b.events.map((e, i) => (
                <li key={i} className="relative">
                  <span className={`absolute top-1 -left-[27px] h-3 w-3 rounded-full ring-4 ring-surface ${i === b.events.length - 1 ? "bg-primary-dark" : "bg-ink"}`} />
                  <div className="text-sm font-bold">{eventText[e.event_type] ?? e.event_type}</div>
                  <div className="text-xs text-muted">
                    {formatDateTime(e.created_at)}
                    {e.metadata?.payment_ref ? ` · payment ${String(e.metadata.payment_ref)}` : ""}
                    {e.metadata?.refund_ref ? ` · refunded ${formatINR(Number(e.metadata.refund_paise))}` : ""}
                    {e.metadata?.reason ? ` · ${String(e.metadata.reason)}` : ""}
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          {b.has_open_issue ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-muted">
              <LifeBuoy size={16} /> Support case open. You'll be notified when it's resolved.
            </p>
          ) : (
            !["requested", "expired", "rejected"].includes(b.status) && <SupportForm id={b.id} onDone={reload} />
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <SectionTitle>Price</SectionTitle>
            <PriceTable p={b.price} />
            <div className="mt-4 flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm">
              <span className="text-muted">Payment</span>
              <span className="font-bold">{b.payment_status === "paid" ? "Paid" : b.payment_status === "refunded" ? "Refunded" : "Not paid yet"}</span>
            </div>
            <p className="mt-3 text-xs text-muted">Booked {formatDateTime(b.created_at)}</p>
          </Card>
        </aside>
      </div>
    </main>
  );
}
