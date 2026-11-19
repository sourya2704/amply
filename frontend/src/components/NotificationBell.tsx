import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BadgeCheck, Bell, CalendarX, Check, CircleAlert, CreditCard, Inbox, LifeBuoy, Star, Wallet, Zap, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  booking_requested: Inbox,
  booking_accepted: Check,
  booking_confirmed: CreditCard,
  booking_rejected: CalendarX,
  booking_cancelled: CalendarX,
  booking_expired: CalendarX,
  session_started: Zap,
  session_completed: Zap,
  payout_pending: Wallet,
  review: Star,
  listing_approved: BadgeCheck,
  listing_rejected: CircleAlert,
  case_opened: LifeBuoy,
  case_resolved: LifeBuoy,
};
import { api } from "../lib/api";
import { useFetch } from "../lib/auth";
import { formatDateTime } from "../lib/format";
import type { Notification } from "../lib/types";

export function NotificationBell() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data, reload } = useFetch(() => api.get<{ unread: number; items: Notification[] }>("/api/notifications"), [], 6000);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && data?.unread) {
      await api.post("/api/notifications/read");
      reload();
    }
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={toggle} className="relative rounded-full p-2 text-muted-2 hover:bg-surface-3 hover:text-ink" aria-label="Notifications">
        <Bell size={18} />
        {!!data?.unread && (
          <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-ink ring-2 ring-surface">
            {data.unread}
          </span>
        )}
      </button>
      {open && (
        <div className="animate-pop absolute right-0 mt-2 max-h-[70vh] w-80 overflow-y-auto rounded-2xl bg-surface text-ink shadow-xl ring-1 ring-line">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold">Notifications</div>
          {data?.items.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">You're all caught up.</p>}
          {data?.items.map((n) => {
            const Icon = ICONS[n.type] ?? Bell;
            return (
              <button
                key={n.id}
                onClick={() => {
                  setOpen(false);
                  if (n.link) nav(n.link);
                }}
                className={`flex w-full gap-3 border-b border-line px-4 py-3 text-left hover:bg-surface-2 ${n.read ? "" : "bg-primary-soft/60"}`}
              >
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${n.read ? "bg-surface-3 text-muted-2" : "bg-primary text-ink"}`}>
                  <Icon size={15} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold">{n.title}</span>
                  {n.body && <span className="mt-0.5 block text-xs text-muted-2">{n.body}</span>}
                  <span className="mt-1 block text-[11px] text-muted">{formatDateTime(n.created_at)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
