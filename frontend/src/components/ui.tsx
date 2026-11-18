import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { BatteryCharging, CircleAlert, CircleCheck, CircleHelp, Star, Zap } from "lucide-react";
import { availabilityStyle, formatINR, statusLabel, statusStyle } from "../lib/format";
import type { Availability, BookingStatus, ChargerSummary, Compatibility } from "../lib/types";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" | "dark" }) {
  const styles = {
    primary: "bg-primary text-ink glow-primary hover:bg-primary-dark active:scale-[0.98]",
    dark: "bg-ink text-white hover:bg-black active:scale-[0.98]",
    secondary: "bg-surface-3 text-ink hover:bg-line",
    danger: "bg-surface text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50",
    ghost: "text-muted-2 hover:bg-surface-3",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none ${styles} ${className}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-surface p-5 shadow-[0_1px_2px_#0000000d,0_8px_24px_-12px_#0000001f] ring-1 ring-line ${className}`}>{children}</div>;
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
    compatible: { cls: "text-primary-ink", Icon: CircleCheck, text: "Fits your EV" },
    incompatible: { cls: "text-rose-600", Icon: CircleAlert, text: "Not compatible" },
    unknown: { cls: "text-muted", Icon: CircleHelp, text: "Compatibility unknown" },
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
    <div className="flex items-center gap-3 p-6 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" /> {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-line p-8 text-center">
      <BatteryCharging className="animate-float mx-auto mb-2 text-primary" size={32} />
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
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
      className="group relative block overflow-hidden rounded-2xl bg-surface p-4 ring-1 ring-line transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-14px_#0000004d] hover:ring-primary-dark"
    >
      {/* neon edge that lights up on hover */}
      <span className="pointer-events-none absolute inset-y-3 left-0 w-1 rounded-r-full bg-primary opacity-0 transition group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
              {categoryLabel[c.category]}
            </span>
            {c.distance_km !== null && <span className="text-xs text-muted">{c.distance_km} km</span>}
          </div>
          <h3 className="mt-1 truncate font-semibold">{c.name}</h3>
          <p className="truncate text-xs text-muted">{c.approx_area}</p>
        </div>
        <div className="text-right">
          <div className="font-display text-xl font-bold">{formatINR(c.price_per_kwh_paise)}</div>
          <div className="text-[11px] text-muted">per kWh</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span className="inline-flex items-center gap-1 font-semibold">
          <Zap size={14} className="text-primary-ink" /> {c.connector} · {c.mode} · {c.effective_power_kw ?? c.power_kw} kW
        </span>
        {!compact && c.rating > 0 && (
          <span className="inline-flex items-center gap-1 text-muted-2">
            <Star size={13} className="fill-amber-400 text-amber-600" /> {c.rating} ({c.review_count})
          </span>
        )}
        <AvailabilityBadge availability={c.availability} />
      </div>
      {!compact && (
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
          <CompatChip compatibility={c.compatibility} reason={c.compatibility_reason} />
          {c.bookable ? (
            <span className="text-xs font-semibold text-primary-ink transition group-hover:translate-x-0.5">Book a slot →</span>
          ) : (
            <span className="text-xs font-medium text-muted">Directions only</span>
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
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
