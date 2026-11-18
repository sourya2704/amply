import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, CreditCard, KeyRound, LifeBuoy, Lock, MapPin, Play, Star, Timer } from "lucide-react";
import { api } from "../lib/api";
import { useAuth, useFetch } from "../lib/auth";
import { payForBooking } from "../lib/payments";
import { formatDateTime, formatINR, formatRange, formatTime } from "../lib/format";
import type { Booking } from "../lib/types";
import { Button, Card, Empty, ErrorNote, PageHeader, Spinner, StatusPill } from "../components/ui";
import { PriceTable } from "./ChargerDetail";

export function BookingRow({ b, to }: { b: Booking; to: string }) {
  return (
    <Link to={to} className="block rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-line transition hover:ring-primary/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">{b.charger.name}</div>
          <div className="text-sm text-muted">{formatRange(b.start_at, b.end_at)}</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-semibold">{formatINR(b.price.total_paise)}</span>
          <StatusPill status={b.status} />
        </div>
      </div>
    </Link>
  );
}

export function BookingList() {
  const { data, error, loading } = useFetch(() => api.get<Booking[]>("/api/bookings"), [], 5000);
  const active = data?.filter((b) => ["requested", "accepted", "confirmed", "in_progress"].includes(b.status)) ?? [];
  const past = data?.filter((b) => !active.includes(b)) ?? [];
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <PageHeader title="My bookings" subtitle="Updates live when the owner responds." />
      <ErrorNote message={error} />
      {loading && !data ? (
        <Spinner />
      ) : data?.length === 0 ? (
        <Empty title="No bookings yet">
          <Link to="/" className="font-semibold text-primary-ink">
            Find a charger →
          </Link>
        </Empty>
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted">Upcoming & active</h2>
              {active.map((b) => <BookingRow key={b.id} b={b} to={`/bookings/${b.id}`} />)}
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted">Past</h2>
              {past.map((b) => <BookingRow key={b.id} b={b} to={`/bookings/${b.id}`} />)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

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

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = new Date(until).getTime() - now;
  if (ms <= 0) return <span>expiring…</span>;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return (
    <span>
      {m}:{String(s).padStart(2, "0")}
    </span>
  );
}

const SUPPORT = [
  ["charger_not_working", "Charger not working"],
  ["access_issue", "Couldn't get in"],
  ["billing", "Billing problem"],
  ["safety", "Safety concern"],
  ["other", "Something else"],
];

function ReviewForm({ id, onDone }: { id: string; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    try {
      await api.post(`/api/bookings/${id}/review`, { rating, comment });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Card>
      <h2 className="font-semibold">How was your charge?</h2>
      <div className="mt-3 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} aria-label={`${n} stars`}>
            <Star size={28} className={n <= rating ? "fill-amber-400 text-amber-600" : "text-muted-2"} />
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder="Optional: access, charging speed, the host…"
        className="mt-3 w-full rounded-xl px-3 py-2 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-primary"
      />
      <ErrorNote message={err} />
      <Button className="mt-2" disabled={rating === 0} onClick={submit}>
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
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <LifeBuoy size={15} /> Get help with this booking
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
    <Card className="space-y-3">
      <h2 className="font-semibold">Get help</h2>
      <div className="flex flex-wrap gap-1.5">
        {SUPPORT.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setCategory(k)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${category === k ? "bg-navy text-white" : "bg-surface-3 text-muted-2"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Tell us what happened"
        className="w-full rounded-xl px-3 py-2 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-primary"
      />
      <ErrorNote message={err} />
      <div className="flex gap-2">
        <Button disabled={!text.trim()} onClick={submit}>
          Send to Amply support
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

export function BookingDetail() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const { data: b, error, setData, reload } = useFetch(() => api.get<Booking>(`/api/bookings/${id}`), [id], 4000);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (error) return <div className="mx-auto max-w-3xl p-6"><ErrorNote message={error} /></div>;
  if (!b || !user) return <Spinner />;

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

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Link to={isDriver ? "/bookings" : "/owner"} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft size={16} /> Back
      </Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold">{b.charger.name}</h1>
                <p className="text-sm text-muted">{b.charger.approx_area}</p>
                <p className="mt-2 font-semibold">{formatRange(b.start_at, b.end_at)}</p>
                {!isDriver && <p className="text-sm text-muted">Driver: {b.driver.name}</p>}
              </div>
              <StatusPill status={b.status} />
            </div>

            {b.expires_at && (
              <p className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
                <Timer size={15} />
                {b.status === "requested" ? "Waiting for the owner. The slot is held for " : "Pay to confirm. The slot is held for "}
                <b>
                  <Countdown until={b.expires_at} />
                </b>
              </p>
            )}

            {b.address ? (
              <div className="mt-5 space-y-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-200">
                <p className="flex items-start gap-2">
                  <MapPin size={16} className="mt-0.5 shrink-0" /> {b.address}
                </p>
                <p className="flex items-start gap-2">
                  <KeyRound size={16} className="mt-0.5 shrink-0" /> {b.access_instructions}
                </p>
              </div>
            ) : (
              ["requested", "accepted"].includes(b.status) && (
                <p className="mt-5 flex items-center gap-2 rounded-xl bg-surface-2 p-3 text-sm text-muted">
                  <Lock size={15} /> Exact address and access instructions are revealed after payment.
                </p>
              )
            )}

            <ErrorNote message={err} />
            <div className="mt-5 flex flex-wrap gap-2">
              {isDriver && b.status === "accepted" && (
                <Button onClick={() => run("pay", () => payForBooking(b.id, { name: user.name, email: user.email }))} disabled={!!busy}>
                  <CreditCard size={16} /> {busy === "pay" ? "Processing payment…" : `Pay ${formatINR(b.price.total_paise)}`}
                </Button>
              )}
              {!isDriver && b.status === "requested" && (
                <>
                  <Button onClick={() => act("accept")} disabled={!!busy}>
                    Accept
                  </Button>
                  <Button variant="danger" onClick={() => act("reject", { reason: "Not available" })} disabled={!!busy}>
                    Decline
                  </Button>
                </>
              )}
              {b.status === "confirmed" && (
                <Button variant="primary" onClick={() => act("start")} disabled={!!busy || startsIn > 15 * 60000} title="Available from 15 minutes before your slot">
                  <Play size={16} /> Start charging
                </Button>
              )}
              {["confirmed", "in_progress"].includes(b.status) && (
                <Button variant={b.status === "in_progress" ? "primary" : "secondary"} onClick={() => act("complete")} disabled={!!busy}>
                  <CheckCircle2 size={16} /> Mark session complete
                </Button>
              )}
              {isDriver && ["requested", "accepted", "confirmed"].includes(b.status) && (
                <Button
                  variant="danger"
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
            {b.status === "confirmed" && startsIn > 15 * 60000 && (
              <p className="mt-2 text-xs text-muted">You can start the session from 15 minutes before your slot.</p>
            )}
          </Card>

          {isDriver && b.status === "completed" && !b.reviewed && <ReviewForm id={b.id} onDone={reload} />}

          <Card>
            <h2 className="font-semibold">Timeline</h2>
            <ol className="mt-4 space-y-4 border-l-2 border-line pl-5">
              {b.events.map((e, i) => (
                <li key={i} className="relative">
                  <span className="absolute top-1 -left-[27px] h-3 w-3 rounded-full bg-primary ring-4 ring-surface" />
                  <div className="text-sm font-medium">{eventText[e.event_type] ?? e.event_type}</div>
                  <div className="text-xs text-muted">
                    {formatDateTime(e.created_at)}
                    {e.metadata?.payment_ref ? ` · payment ${String(e.metadata.payment_ref)}` : ""}
                    {e.metadata?.refund_ref ? ` · refunded ${formatINR(Number(e.metadata.refund_paise))} (${String(e.metadata.refund_ref)})` : ""}
                    {e.metadata?.reason ? ` · ${String(e.metadata.reason)}` : ""}
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          {b.has_open_issue ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <LifeBuoy size={15} /> Support case open. We'll notify you when it's resolved.
            </p>
          ) : (
            !["requested", "expired", "rejected"].includes(b.status) && <SupportForm id={b.id} onDone={reload} />
          )}
        </div>
        <Card className="h-fit">
          <h2 className="mb-3 font-semibold">Price</h2>
          <PriceTable p={b.price} />
          <p className="mt-3 text-xs text-muted">
            Payment: {b.payment_status === "paid" ? "Paid" : b.payment_status === "refunded" ? "Refunded in full" : "Not paid yet"} · booked{" "}
            {formatTime(b.created_at)}
          </p>
        </Card>
      </div>
    </div>
  );
}
