import { useState } from "react";
import { AlertTriangle, BadgeCheck, CalendarCheck, Check, Flag, History, IndianRupee, Plug, ShieldAlert, Users, X } from "lucide-react";
import { api } from "../lib/api";
import { useFetch } from "../lib/auth";
import { formatDateTime, formatINR } from "../lib/format";
import type { AuditEntry, ChargerDetail, Report, RiskFlag } from "../lib/types";
import { MapView } from "../components/MapView";
import { Button, Card, Empty, ErrorNote, inputCls, ListSkeleton, Page, SectionTitle, StatCard } from "../components/ui";

type Tab = "verify" | "risk" | "cases" | "audit";

function ReviewCard({ c, onDone }: { c: ChargerDetail; onDone: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const decide = async (decision: "approve" | "reject") => {
    try {
      await api.post(`/api/admin/chargers/${c.id}/${decision}`, { note: decision === "approve" ? "Verified" : note });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Card className="animate-pop overflow-hidden p-0">
      <MapView center={{ lat: c.lat, lng: c.lng }} chargers={[c]} zoom={15} className="h-36 w-full" />
      <div className="space-y-3 p-5">
        <div>
          <div className="font-extrabold">{c.name}</div>
          <div className="text-sm text-muted">
            {c.owner_name} · {c.address}
          </div>
        </div>
        <div className="text-sm font-bold">
          {c.connector} · {c.mode} · {c.power_kw} kW · {formatINR(c.price_per_kwh_paise)}/kWh
        </div>
        {c.description && <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted-2">{c.description}</p>}
        <ul className="space-y-1 text-xs text-muted">
          <li className="flex items-center gap-1.5">
            <BadgeCheck size={13} /> Owner identity and authority over the property
          </li>
          <li className="flex items-center gap-1.5">
            <BadgeCheck size={13} /> Equipment photos and electrical safety evidence
          </li>
        </ul>
        {rejecting ? (
          <div className="space-y-2">
            <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Why isn't it approved? The owner will see this." className={inputCls} />
            <div className="flex gap-2">
              <Button variant="danger" disabled={!note.trim()} onClick={() => decide("reject")}>
                Reject listing
              </Button>
              <Button variant="ghost" onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 pt-1">
            <Button onClick={() => decide("approve")}>
              <Check size={16} /> Approve
            </Button>
            <Button variant="danger" onClick={() => setRejecting(true)}>
              <X size={16} /> Reject
            </Button>
          </div>
        )}
        <ErrorNote message={err} />
      </div>
    </Card>
  );
}

function CaseCard({ r, onDone }: { r: Report; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const resolve = async () => {
    try {
      await api.post(`/api/admin/reports/${r.id}/resolve`, { resolution: text });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const isSupport = r.target_type === "booking";
  return (
    <Card className={`p-4 ${r.status === "resolved" ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${isSupport ? "bg-primary-soft text-primary-ink" : "bg-rose-50 text-rose-700"}`}>
            {isSupport ? `Support · ${r.category.replace(/_/g, " ")}` : "Report"}
          </span>
          <div className="mt-1.5 font-extrabold">{r.target_label}</div>
          <div className="text-xs text-muted">
            {r.reporter_name} · {formatDateTime(r.created_at)}
          </div>
        </div>
        {r.status === "resolved" ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">Resolved</span>
        ) : (
          !open && (
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
              Resolve
            </Button>
          )
        )}
      </div>
      <p className="mt-2.5 text-sm text-muted-2">{r.reason}</p>
      {r.resolution && <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">Outcome: {r.resolution}</p>}
      {open && (
        <div className="mt-3 space-y-2">
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="What did you do? The reporter is notified." className={inputCls} />
          <div className="flex gap-2">
            <Button size="sm" disabled={!text.trim()} onClick={resolve}>
              Mark resolved
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          <ErrorNote message={err} />
        </div>
      )}
    </Card>
  );
}

export default function Admin() {
  const stats = useFetch(() => api.get<Record<string, number>>("/api/admin/stats"), [], 5000);
  const queue = useFetch(() => api.get<ChargerDetail[]>("/api/admin/chargers?status=submitted"), [], 5000);
  const risk = useFetch(() => api.get<RiskFlag[]>("/api/admin/risk"), [], 10000);
  const reports = useFetch(() => api.get<Report[]>("/api/admin/reports"), [], 5000);
  const auditLog = useFetch(() => api.get<AuditEntry[]>("/api/admin/audit-logs?limit=60"), [], 8000);
  const [tab, setTab] = useState<Tab>("verify");

  const openCases = reports.data?.filter((r) => r.status === "open").length ?? 0;
  const tabs: [Tab, string, number | undefined][] = [
    ["verify", "Verification", queue.data?.length],
    ["risk", "Risk flags", risk.data?.length],
    ["cases", "Cases", openCases || undefined],
    ["audit", "Audit log", undefined],
  ];
  const s = stats.data;

  return (
    <Page title="Trust & safety" subtitle="Verify listings, review risk and resolve cases. People decide; nothing is enforced automatically.">
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Live chargers" value={s?.chargers_live ?? "–"} hint={`${s?.pending_listings ?? 0} awaiting review`} icon={Plug} />
        <StatCard label="Users" value={s?.users ?? "–"} icon={Users} />
        <StatCard label="Bookings" value={s?.bookings_total ?? "–"} hint={`${s?.completed_sessions ?? 0} completed`} icon={CalendarCheck} />
        <StatCard label="Collected" value={s ? formatINR(s.gmv_paise) : "–"} hint={s ? `${formatINR(s.platform_fee_paise)} platform fees` : undefined} icon={IndianRupee} />
      </div>

      <div className="mb-6 flex gap-1 overflow-x-auto rounded-full bg-surface-3 p-1 text-sm font-bold [scrollbar-width:none] sm:inline-flex" role="tablist">
        {tabs.map(([key, label, n]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 transition ${tab === key ? "bg-surface shadow" : "text-muted hover:text-ink"}`}
          >
            {label}
            {!!n && <span className="rounded-full bg-primary px-1.5 text-[11px] text-ink">{n}</span>}
          </button>
        ))}
      </div>

      {tab === "verify" && (
        <section>
          <SectionTitle icon={BadgeCheck}>Listings awaiting verification</SectionTitle>
          {queue.loading && !queue.data ? (
            <ListSkeleton rows={2} height="h-64" />
          ) : queue.data?.length === 0 ? (
            <Empty icon={BadgeCheck} title="Queue is clear">
              New listings appear here for review before they go live.
            </Empty>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">{queue.data?.map((c) => <ReviewCard key={c.id} c={c} onDone={() => (queue.reload(), risk.reload(), stats.reload())} />)}</div>
          )}
        </section>
      )}

      {tab === "risk" && (
        <section>
          <SectionTitle icon={ShieldAlert}>Risk flags</SectionTitle>
          <p className="mb-4 text-sm text-muted">Rule-based triage: duplicate listings, price outliers, repeated reports and cancellation spikes. Flags are signals for review only.</p>
          {risk.data?.length === 0 ? (
            <Empty icon={ShieldAlert} title="No risk flags" />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {risk.data?.map((f) => (
                <Card key={f.target_id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold tracking-wide text-muted uppercase">{f.target_type}</div>
                      <div className="font-extrabold">{f.target_label}</div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-extrabold ${f.score >= 0.75 ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}>Risk {Math.round(f.score * 100)}</span>
                  </div>
                  <ul className="mt-2.5 space-y-1.5">
                    {f.signals.map((sig) => (
                      <li key={sig} className="flex items-start gap-2 text-sm text-muted-2">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" /> {sig}
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "cases" && (
        <section>
          <SectionTitle icon={Flag}>Reports and support cases</SectionTitle>
          {reports.data?.length === 0 ? (
            <Empty icon={Flag} title="No cases">
              Drivers can report a listing, or open a support case on a booking.
            </Empty>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">{reports.data?.map((r) => <CaseCard key={r.id} r={r} onDone={() => (reports.reload(), stats.reload())} />)}</div>
          )}
        </section>
      )}

      {tab === "audit" && (
        <section>
          <SectionTitle icon={History}>Audit log</SectionTitle>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  {["When", "Who", "Action", "Resource"].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-bold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {auditLog.data?.map((e) => (
                  <tr key={e.id} className="hover:bg-surface-2">
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted">{formatDateTime(e.created_at)}</td>
                    <td className="px-4 py-2.5 font-semibold whitespace-nowrap">{e.actor_name}</td>
                    <td className="px-4 py-2.5">
                      <code className="rounded bg-surface-3 px-1.5 py-0.5 text-xs">{e.action}</code>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">
                      {e.resource_type} · {e.resource_id.slice(0, 8)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {auditLog.data?.length === 0 && <p className="p-4 text-sm text-muted">No actions yet.</p>}
          </Card>
        </section>
      )}
    </Page>
  );
}
