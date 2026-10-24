import { useState } from "react";
import { AlertTriangle, Check, Flag, ShieldAlert, X } from "lucide-react";
import { api } from "../lib/api";
import { useFetch } from "../lib/auth";
import { formatDateTime, formatINR } from "../lib/format";
import type { ChargerDetail, Report, RiskFlag } from "../lib/types";
import { MapView } from "../components/MapView";
import { Button, Card, Empty, ErrorNote, PageHeader, Spinner } from "../components/ui";

export default function Admin() {
  const stats = useFetch(() => api.get<Record<string, number>>("/api/admin/stats"), [], 5000);
  const queue = useFetch(() => api.get<ChargerDetail[]>("/api/admin/chargers?status=submitted"), [], 5000);
  const risk = useFetch(() => api.get<RiskFlag[]>("/api/admin/risk"), [], 10000);
  const reports = useFetch(() => api.get<Report[]>("/api/admin/reports"), [], 5000);
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>, after: () => void) => {
    setErr(null);
    try {
      await fn();
      after();
      stats.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const review = (id: string, decision: "approve" | "reject") =>
    run(() => api.post(`/api/admin/chargers/${id}/${decision}`, { note: decision === "approve" ? "Verified" : "Did not pass verification" }), () => {
      queue.reload();
      risk.reload();
    });

  const resolve = (id: string) => {
    const resolution = window.prompt("Resolution outcome (recorded for audit):", "Contacted owner, issue fixed");
    if (resolution?.trim()) run(() => api.post(`/api/admin/reports/${id}/resolve`, { resolution }), reports.reload);
  };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <PageHeader title="Trust & safety" subtitle="Verify listings, review risk flags and resolve reports. Humans decide; nothing is enforced automatically." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Live chargers", "chargers_live"],
          ["Pending review", "pending_listings"],
          ["Bookings", "bookings_total"],
          ["Completed sessions", "completed_sessions"],
          ["Open reports", "open_reports"],
        ].map(([label, key]) => (
          <Card key={key} className="p-4">
            <div className="text-xs text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-bold">{stats.data?.[key] ?? "–"}</div>
          </Card>
        ))}
      </div>
      <ErrorNote message={err} />

      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Check size={18} className="text-brand" /> Listings awaiting verification
        </h2>
        {queue.loading && !queue.data ? (
          <Spinner />
        ) : queue.data?.length === 0 ? (
          <Empty title="Queue is clear" />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {queue.data?.map((c) => (
              <Card key={c.id} className="animate-pop overflow-hidden p-0">
                <MapView center={{ lat: c.lat, lng: c.lng }} chargers={[c]} zoom={15} className="h-36 w-full" />
                <div className="space-y-2 p-4">
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-sm text-slate-500">
                    by {c.owner_name} · {c.address}
                  </div>
                  <div className="text-sm">
                    {c.connector} · {c.mode} · {c.power_kw} kW · {formatINR(c.price_per_kwh_paise)}/kWh
                  </div>
                  {c.description && <p className="text-sm text-slate-600">“{c.description}”</p>}
                  <ul className="list-disc pl-5 text-xs text-slate-500">
                    <li>Check owner ID and authority over the property</li>
                    <li>Check equipment photos and electrical safety evidence</li>
                  </ul>
                  <div className="flex gap-2 pt-1">
                    <Button onClick={() => review(c.id, "approve")}>
                      <Check size={16} /> Approve
                    </Button>
                    <Button variant="danger" onClick={() => review(c.id, "reject")}>
                      <X size={16} /> Reject
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <ShieldAlert size={18} className="text-amber-500" /> Risk flags
          </h2>
          <p className="mb-3 text-xs text-slate-500">Rule-based triage: duplicates, price outliers, repeated reports, cancellation spikes. Flags are for review only.</p>
          {risk.data?.length === 0 && <Empty title="No risk flags" />}
          <div className="space-y-3">
            {risk.data?.map((f) => (
              <Card key={f.target_id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-400 uppercase">{f.target_type}</div>
                    <div className="font-semibold">{f.target_label}</div>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${f.score >= 0.75 ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}>
                    risk {Math.round(f.score * 100)}
                  </span>
                </div>
                <ul className="mt-2 space-y-1">
                  {f.signals.map((s) => (
                    <li key={s} className="flex items-start gap-2 text-sm text-slate-600">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" /> {s}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Flag size={18} className="text-rose-500" /> User reports
          </h2>
          {reports.data?.length === 0 && <Empty title="No reports">Drivers can report a listing from its page.</Empty>}
          <div className="space-y-3">
            {reports.data?.map((r) => (
              <Card key={r.id} className={`p-4 ${r.status === "resolved" ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{r.target_label}</div>
                    <div className="text-xs text-slate-500">
                      by {r.reporter_name} · {formatDateTime(r.created_at)}
                    </div>
                  </div>
                  {r.status === "open" ? (
                    <Button variant="secondary" className="py-1.5 text-xs" onClick={() => resolve(r.id)}>
                      Resolve
                    </Button>
                  ) : (
                    <span className="text-xs font-semibold text-emerald-700">Resolved</span>
                  )}
                </div>
                <p className="mt-2 text-sm">“{r.reason}”</p>
                {r.resolution && <p className="mt-1 text-xs text-emerald-700">Outcome: {r.resolution}</p>}
              </Card>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
