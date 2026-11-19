import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bot, CircleCheck, CircleX, Send, ShieldCheck, Sparkles, Wrench, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatINR, formatRange } from "../lib/format";
import type { AgentResponse, Booking, PendingAction } from "../lib/types";
import { Button, ChargerCard } from "./ui";

type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; history: string; res: AgentResponse }
  | { role: "booked"; booking: Booking }
  | { role: "error"; content: string };

const SUGGESTIONS = [
  "Find a compatible charger near Koramangala under ₹20/kWh and book it for 6 PM",
  "Fastest DC charger in HSR Layout?",
  "I'm at 15% battery. Can I drive from Koramangala to Whitefield?",
];

/** Renders the assistant's light markdown (bold + bullets) as React nodes. No HTML injection. */
function Markdown({ text }: { text: string }) {
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>,
    );
  const out: ReactNode[] = [];
  let bullets: ReactNode[] = [];
  const flush = () => {
    if (bullets.length) out.push(<ul key={out.length} className="my-1 list-disc space-y-1 pl-5">{bullets}</ul>);
    bullets = [];
  };
  text.split("\n").forEach((line, i) => {
    const m = line.match(/^\s*[-•*]\s+(.*)/);
    if (m) bullets.push(<li key={i}>{inline(m[1])}</li>);
    else {
      flush();
      if (line.trim()) out.push(<p key={`p${i}`} className="my-1">{inline(line)}</p>);
    }
  });
  flush();
  return <div className="text-sm leading-relaxed">{out}</div>;
}

function ConfirmCard({ pa, onBooked }: { pa: PendingAction; onBooked: (b: Booking) => void }) {
  const [state, setState] = useState<"idle" | "busy" | "dismissed">("idle");
  const [error, setError] = useState<string | null>(null);
  const s = pa.summary;
  const confirm = async () => {
    setState("busy");
    setError(null);
    try {
      onBooked(await api.post<Booking>("/api/agent/confirm", { confirmation_id: pa.confirmation_id }));
    } catch (e) {
      setError(e instanceof ApiError && e.code === "SLOT_TAKEN" ? "Someone just booked that slot. Ask me for another time." : (e as Error).message);
      setState("idle");
    }
  };
  if (state === "dismissed") return <p className="text-xs text-muted">Booking suggestion dismissed.</p>;
  return (
    <div className="animate-pop rounded-2xl bg-surface p-4 text-ink shadow-lg ring-2 ring-primary">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary-ink">
        <ShieldCheck size={14} /> Needs your confirmation
      </div>
      <div className="mt-2 font-semibold">{s.charger_name}</div>
      <div className="text-xs text-muted">
        {s.approx_area} · {s.vehicle}
      </div>
      <div className="mt-2 text-sm">{formatRange(s.start_at, s.end_at)}</div>
      <div className="mt-3 space-y-1 rounded-xl bg-surface-2 p-3 text-xs">
        <Row k={`Energy (${s.price.energy_kwh} kWh est.)`} v={formatINR(s.price.energy_cost_paise)} />
        <Row k="Service fee" v={formatINR(s.price.service_fee_paise)} />
        <Row k="GST on fee" v={formatINR(s.price.tax_paise)} />
        <div className="flex justify-between border-t border-line pt-1 text-sm font-bold">
          <span>Estimated total</span>
          <span>{formatINR(s.price.total_paise)}</span>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted">{s.cancellation_policy}. Nothing is booked until you press Confirm.</p>
      {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button variant="primary" className="flex-1" onClick={confirm} disabled={state === "busy"}>
          <CircleCheck size={16} /> {state === "busy" ? "Booking…" : "Confirm booking"}
        </Button>
        <Button variant="ghost" onClick={() => setState("dismissed")}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between text-muted-2">
    <span>{k}</span>
    <span>{v}</span>
  </div>
);

export function AgentPanel({ location }: { location?: { lat: number; lng: number } }) {
  const { vehicle } = useAuth();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: text.trim() }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    const history = next.flatMap((m) =>
      m.role === "user" ? [{ role: "user", content: m.content }] : m.role === "assistant" ? [{ role: "assistant", content: m.history }] : [],
    );
    try {
      const res = await api.post<AgentResponse>("/api/agent/chat", { messages: history, vehicle_id: vehicle?.id, location });
      setMsgs((m) => [...m, { role: "assistant", content: res.reply, history: res.history_content, res }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "error", content: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`fixed right-4 bottom-20 z-[1000] md:bottom-6 flex items-center gap-2 rounded-full bg-primary py-3 pr-5 pl-4 font-bold text-ink shadow-xl shadow-primary-dark/40 transition hover:scale-105 sm:right-6 ${open ? "hidden" : ""}`}
      >
        <Sparkles size={18} className="text-ink" /> Ask Amply AI
      </button>

      {open && (
        <div className="fixed inset-0 z-[1200] flex flex-col bg-surface shadow-2xl sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[min(720px,calc(100vh-6rem))] sm:w-[420px] sm:rounded-3xl sm:ring-1 sm:ring-line">
          <div className="flex items-center justify-between bg-navy px-5 py-4 text-white sm:rounded-t-3xl">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-navy">
                <Bot size={20} />
              </div>
              <div>
                <div className="font-extrabold">Amply AI</div>
                <div className="text-xs text-white/60">{vehicle ? `For your ${vehicle.make} ${vehicle.model}` : "No vehicle selected"}</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 hover:bg-white/10" aria-label="Close">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {msgs.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-2">
                  I search real Amply listings, hide chargers that don't fit your EV, explain my picks, and only book after you confirm.
                </p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="block w-full rounded-xl bg-surface-2 px-3.5 py-3 text-left text-sm font-semibold text-ink transition hover:bg-primary-soft"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {msgs.map((m, i) => {
              if (m.role === "user")
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-ink">{m.content}</div>
                  </div>
                );
              if (m.role === "error")
                return (
                  <div key={i} className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    <CircleX size={16} className="mt-0.5" /> {m.content}
                  </div>
                );
              if (m.role === "booked")
                return (
                  <div key={i} className="animate-pop rounded-2xl bg-emerald-50 p-4 text-sm ring-1 ring-emerald-200">
                    <div className="flex items-center gap-2 font-semibold text-emerald-700">
                      <CircleCheck size={18} /> Request sent to the owner
                    </div>
                    <p className="mt-1 text-emerald-800">
                      {m.booking.charger.name}, {formatRange(m.booking.start_at, m.booking.end_at)}. You'll pay once they accept.
                    </p>
                    <Link to={`/bookings/${m.booking.id}`} className="mt-2 inline-block font-semibold text-emerald-700 underline">
                      Track booking →
                    </Link>
                  </div>
                );
              const { res } = m;
              return (
                <div key={i} className="animate-pop space-y-3">
                  {res.tool_trace.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {res.tool_trace.map((t, j) => (
                        <span
                          key={j}
                          title={t.summary}
                          className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2.5 py-1 text-[11px] font-medium ${t.ok ? "bg-surface-3 text-muted-2" : "bg-amber-50 text-amber-700"}`}
                        >
                          <Wrench size={11} /> {t.tool}: {t.summary}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="rounded-2xl rounded-bl-md bg-surface-2 px-4 py-3 ring-1 ring-line">
                    <Markdown text={m.content} />
                    {res.mode === "offline" && (
                      <p className="mt-2 text-[11px] text-faint">Offline demo mode: rule-based planner using the same tools (no AI key set).</p>
                    )}
                  </div>
                  {res.cards.length > 0 && !res.pending_action && (
                    <div className="space-y-2">
                      {res.cards.map((c) => (
                        <ChargerCard key={c.id} c={c} compact />
                      ))}
                    </div>
                  )}
                  {res.pending_action && (
                    <ConfirmCard pa={res.pending_action} onBooked={(b) => setMsgs((ms) => [...ms, { role: "booked", booking: b }])} />
                  )}
                </div>
              );
            })}

            {busy && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <span className="flex gap-1">
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-primary" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </span>
                Checking real listings…
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2 border-t border-line p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about chargers, prices, or book a slot…"
              className="flex-1 rounded-xl bg-surface-2 px-4 py-2.5 text-sm ring-1 ring-line outline-none focus:ring-2 focus:ring-primary"
            />
            <Button type="submit" disabled={busy || !input.trim()} aria-label="Send">
              <Send size={16} />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
