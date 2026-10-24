import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { BatteryCharging, CircleAlert, CircleCheck, CircleHelp, Star, Zap } from "lucide-react";
import { availabilityStyle, formatINR, statusLabel, statusStyle } from "../lib/format";
import type { Availability, BookingStatus, ChargerSummary, Compatibility } from "../lib/types";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" | "volt" }) {
  const styles = {
    primary: "bg-brand text-white hover:bg-brand-dark shadow-sm shadow-brand/20",
    volt: "bg-volt text-navy hover:brightness-95 shadow-sm",
    secondary: "bg-white text-navy ring-1 ring-slate-200 hover:bg-slate-50",
    danger: "bg-white text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50",
    ghost: "text-slate-600 hover:bg-slate-100",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 ${className}`}>{children}</div>;
}

export function AvailabilityBadge({ availability }: { availability: Availability }) {
  const s = availabilityStyle[availability.source];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${availability.source === "live" ? "animate-pulse" : ""}`} />
      {availability.label}
    </span>
  );
}

export function CompatChip({ compatibility, reason }: { compatibility: Compatibility; reason: string }) {
  const map = {
    compatible: { cls: "text-emerald-700", Icon: CircleCheck, text: "Fits your EV" },
    incompatible: { cls: "text-rose-600", Icon: CircleAlert, text: "Not compatible" },
    unknown: { cls: "text-slate-500", Icon: CircleHelp, text: "Compatibility unknown" },
  }[compatibility];
  return (
    <span title={reason} className={`inline-flex items-center gap-1 text-xs font-medium ${map.cls}`}>
      <map.Icon size={14} /> {map.text}
    </span>
  );
}

export function StatusPill({ status }: { status: BookingStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${statusStyle[status]}`}>{statusLabel[status]}</span>;
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 p-6 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" /> {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center">
      <BatteryCharging className="mx-auto mb-2 text-slate-300" size={32} />
      <p className="font-semibold text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="animate-pop flex items-start gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 ring-1 ring-rose-200">
      <CircleAlert size={18} className="mt-0.5 shrink-0" /> {message}
    </div>
  );
}

const categoryLabel = { private: "Home", business: "Business", public: "Public" };

export function ChargerCard({ c, compact = false, onHover }: { c: ChargerSummary; compact?: boolean; onHover?: (id: string | null) => void }) {
  return (
    <Link
      to={`/chargers/${c.id}`}
      onMouseEnter={() => onHover?.(c.id)}
      onMouseLeave={() => onHover?.(null)}
      className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-brand/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              {categoryLabel[c.category]}
            </span>
            {c.distance_km !== null && <span className="text-xs text-slate-500">{c.distance_km} km</span>}
          </div>
          <h3 className="mt-1 truncate font-semibold">{c.name}</h3>
          <p className="truncate text-xs text-slate-500">{c.approx_area}</p>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">{formatINR(c.price_per_kwh_paise)}</div>
          <div className="text-[11px] text-slate-500">per kWh</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span className="inline-flex items-center gap-1 font-semibold">
          <Zap size={14} className="text-brand" /> {c.connector} · {c.mode} · {c.effective_power_kw ?? c.power_kw} kW
        </span>
        {!compact && c.rating > 0 && (
          <span className="inline-flex items-center gap-1 text-slate-600">
            <Star size={13} className="fill-amber-400 text-amber-400" /> {c.rating} ({c.review_count})
          </span>
        )}
        <AvailabilityBadge availability={c.availability} />
      </div>
      {!compact && (
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
          <CompatChip compatibility={c.compatibility} reason={c.compatibility_reason} />
          {c.bookable ? (
            <span className="text-xs font-semibold text-brand">Book a slot →</span>
          ) : (
            <span className="text-xs font-medium text-slate-500">Directions only</span>
          )}
        </div>
      )}
    </Link>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
