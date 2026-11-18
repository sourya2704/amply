import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
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
          {data?.items.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                setOpen(false);
                if (n.link) nav(n.link);
              }}
              className={`block w-full border-b border-line px-4 py-3 text-left hover:bg-surface-2 ${n.read ? "" : "bg-primary/10"}`}
            >
              <div className="text-sm font-semibold">{n.title}</div>
              {n.body && <div className="mt-0.5 text-xs text-muted-2">{n.body}</div>}
              <div className="mt-1 text-[11px] text-faint">{formatDateTime(n.created_at)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
