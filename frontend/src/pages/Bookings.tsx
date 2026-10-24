import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, CreditCard, KeyRound, Lock, MapPin } from "lucide-react";
import { api } from "../lib/api";
import { useAuth, useFetch } from "../lib/auth";
import { formatDateTime, formatINR, formatRange, formatTime } from "../lib/format";
import type { Booking } from "../lib/types";
import { Button, Card, Empty, ErrorNote, PageHeader, Spinner, StatusPill } from "../components/ui";
import { PriceTable } from "./ChargerDetail";

export function BookingRow({ b, to }: { b: Booking; to: string }) {
  return (
    <Link to={to} className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 transition hover:ring-brand/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">{b.charger.name}</div>
          <div className="text-sm text-slate-500">{formatRange(b.start_at, b.end_at)}</div>
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
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <PageHeader title="My bookings" subtitle="Updates live when the owner responds." />
      <ErrorNote message={error} />
      {loading && !data ? (
        <Spinner />
      ) : data?.length === 0 ? (
        <Empty title="No bookings yet">
          <Link to="/" className="font-semibold text-brand">
            Find a charger →
          </Link>
        </Empty>
      ) : (
        <div className="space-y-3">{data?.map((b) => <BookingRow key={b.id} b={b} to={`/bookings/${b.id}`} />)}</div>
      )}
    </div>
  );
}

const eventText: Record<string, string> = {
  requested: "Booking requested",
  accepted: "Owner accepted",
  rejected: "Owner declined",
  confirmed: "Payment received, booking confirmed",
  cancelled: "Booking cancelled",
  completed: "Charging session completed",
};

export function BookingDetail() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const { data: b, error, setData } = useFetch(() => api.get<Booking>(`/api/bookings/${id}`), [id], 4000);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  if (error) return <div className="mx-auto max-w-3xl p-6"><ErrorNote message={error} /></div>;
  if (!b) return <Spinner />;

  const isDriver = b.driver.id === user?.id;
  const act = async (action: string, body?: unknown) => {
    setBusy(action);
    setErr(null);
    try {
      setData(await api.post<Booking>(`/api/bookings/${b.id}/${action}`, body));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const pay = async () => {
    setPaying(true);
    await new Promise((r) => setTimeout(r, 1200)); // mock payment gateway
    await act("pay");
    setPaying(false);
  };

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Link to={isDriver ? "/bookings" : "/owner"} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-navy">
        <ArrowLeft size={16} /> Back
      </Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold">{b.charger.name}</h1>
                <p className="text-sm text-slate-500">{b.charger.approx_area}</p>
                <p className="mt-2 font-semibold">{formatRange(b.start_at, b.end_at)}</p>
                {!isDriver && <p className="text-sm text-slate-500">Driver: {b.driver.name}</p>}
              </div>
              <StatusPill status={b.status} />
            </div>

            {b.address ? (
              <div className="mt-5 space-y-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-200">
                <p className="flex items-start gap-2">
                  <MapPin size={16} className="mt-0.5 shrink-0" /> {b.address}
                </p>
                <p className="flex items-start gap-2">
                  <KeyRound size={16} className="mt-0.5 shrink-0" /> {b.access_instructions}
                </p>
              </div>
            ) : (
              <p className="mt-5 flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
                <Lock size={15} /> Exact address and access instructions are revealed after payment.
              </p>
            )}

            <ErrorNote message={err} />
            <div className="mt-5 flex flex-wrap gap-2">
              {isDriver && b.status === "accepted" && (
                <Button onClick={pay} disabled={paying}>
                  <CreditCard size={16} /> {paying ? "Processing payment…" : `Pay ${formatINR(b.price.total_paise)}`}
                </Button>
              )}
              {!isDriver && b.status === "requested" && (
                <>
                  <Button onClick={() => act("accept")} disabled={!!busy}>Accept</Button>
                  <Button variant="danger" onClick={() => act("reject", { reason: "Not available" })} disabled={!!busy}>Decline</Button>
                </>
              )}
              {b.status === "confirmed" && (
                <Button variant="volt" onClick={() => act("complete")} disabled={!!busy}>
                  <CheckCircle2 size={16} /> Mark session complete
                </Button>
              )}
              {isDriver && ["requested", "accepted", "confirmed"].includes(b.status) && (
                <Button variant="danger" onClick={() => act("cancel", { reason: "Driver cancelled" })} disabled={!!busy}>
                  Cancel booking
                </Button>
              )}
            </div>
            {b.status === "requested" && isDriver && <p className="mt-3 text-xs text-slate-500">Waiting for the owner to accept. This page updates automatically.</p>}
          </Card>

          <Card>
            <h2 className="font-semibold">Timeline</h2>
            <ol className="mt-4 space-y-4 border-l-2 border-slate-100 pl-5">
              {b.events.map((e, i) => (
                <li key={i} className="relative">
                  <span className="absolute top-1 -left-[27px] h-3 w-3 rounded-full bg-brand ring-4 ring-white" />
                  <div className="text-sm font-medium">{eventText[e.event_type] ?? e.event_type}</div>
                  <div className="text-xs text-slate-500">
                    {formatDateTime(e.created_at)}
                    {e.metadata?.payment_ref ? ` · ref ${String(e.metadata.payment_ref)}` : ""}
                    {e.metadata?.reason ? ` · ${String(e.metadata.reason)}` : ""}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <Card className="h-fit">
          <h2 className="mb-3 font-semibold">Price</h2>
          <PriceTable p={b.price} />
          <p className="mt-3 text-xs text-slate-500">
            Payment: {b.payment_status === "paid" ? "Paid (demo payment)" : "Not paid yet"} · booked {formatTime(b.created_at)}
          </p>
        </Card>
      </div>
    </div>
  );
}
