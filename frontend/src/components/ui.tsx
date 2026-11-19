import { useEffect, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BatteryCharging, CircleAlert, CircleCheck, CircleHelp, Star, Zap, type LucideProps } from "lucide-react";
import { availabilityShort, availabilityStyle, formatINR, statusLabel, statusStyle } from "../lib/format";
import type { Availability, BookingStatus, ChargerSummary, Compatibility } from "../lib/types";

/*
  Amply design system. One primary colour (pink fills with black text, deep pink for text),
  white cards on a soft grey page, black type. Every page is built from these pieces.
*/

type Icon = ComponentType<LucideProps>;

// ---- layout ----

/** Sets the browser tab title: "Page · Amply". */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Amply` : "Amply · Charge anywhere";
  }, [title]);
}

/** Standard page container with title, optional subtitle and actions. */
export function Page({
  title,
  subtitle,
  actions,
  width = "max-w-6xl",
  back,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  width?: string;
  back?: { to: string; label: string };
  children: ReactNode;
}) {
  usePageTitle(title);
  return (
    <main className={`mx-auto w-full ${width} px-4 pt-6 pb-28 sm:px-6 md:pb-12`}>
      {back && (
        <Link to={back.to} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
          <ArrowRight size={15} className="rotate-180" /> {back.label}
        </Link>
      )}
      <PageHeader title={title} subtitle={subtitle}>
        {actions}
      </PageHeader>
      {children}
    </main>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-3xl leading-tight sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-muted sm:text-base">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function SectionTitle({ children, action, icon: IconC }: { children: ReactNode; action?: ReactNode; icon?: Icon }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-extrabold">
        {IconC && <IconC size={18} className="text-primary-ink" />}
        {children}
      </h2>
      {action}
    </div>
  );
}

// ---- primitives ----

export const inputCls =
  "w-full rounded-xl bg-surface-2 px-3.5 py-3 text-sm font-medium text-ink outline-none ring-2 ring-transparent transition placeholder:text-muted focus:bg-surface focus:ring-primary";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-bold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" | "dark"; size?: "sm" | "md" | "lg" }) {
  const styles = {
    primary: "bg-primary text-ink glow-primary hover:bg-primary-dark",
    dark: "bg-ink text-white hover:bg-black",
    secondary: "bg-surface-3 text-ink hover:bg-line",
    danger: "bg-surface text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50",
    ghost: "text-muted-2 hover:bg-surface-3 hover:text-ink",
  }[variant];
  const sizes = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2.5 text-sm", lg: "px-5 py-3.5 text-base" }[size];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-bold transition active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:active:scale-100 ${styles} ${sizes} ${className}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-surface p-5 shadow-[0_1px_2px_#0000000d,0_8px_24px_-12px_#0000001f] ring-1 ring-line ${className}`}>{children}</div>;
}

export function IconTile({ icon: IconC, tone = "pink", size = 40 }: { icon: Icon; tone?: "pink" | "grey" | "dark"; size?: number }) {
  const cls = { pink: "bg-primary-soft text-primary-ink", grey: "bg-surface-3 text-ink", dark: "bg-ink text-white" }[tone];
  return (
    <span className={`grid shrink-0 place-items-center rounded-xl ${cls}`} style={{ width: size, height: size }}>
      <IconC size={Math.round(size * 0.48)} />
    </span>
  );
}

export function StatCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: Icon }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-bold tracking-wide text-muted uppercase">{label}</div>
        {icon && <IconTile icon={icon} size={30} />}
      </div>
      <div className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} className={n <= Math.round(value) ? "fill-amber-400 text-amber-500" : "text-line"} />
      ))}
    </span>
  );
}

// ---- status ----

export function AvailabilityBadge({ availability, short = false }: { availability: Availability; short?: boolean }) {
  const s = availabilityStyle[availability.source];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${availability.source === "live" ? "animate-pulse" : ""}`} />
      {short ? availabilityShort[availability.source] : availability.label}
    </span>
  );
}

export function CompatChip({ compatibility, reason }: { compatibility: Compatibility; reason: string }) {
  const map = {
    compatible: { cls: "text-emerald-700", Icon: CircleCheck, text: "Fits your EV" },
    incompatible: { cls: "text-rose-600", Icon: CircleAlert, text: "Not compatible" },
    unknown: { cls: "text-muted", Icon: CircleHelp, text: "Compatibility unknown" },
  }[compatibility];
  return (
    <span title={reason} className={`inline-flex items-center gap-1 text-xs font-semibold ${map.cls}`}>
      <map.Icon size={14} /> {map.text}
    </span>
  );
}

export function StatusPill({ status }: { status: BookingStatus }) {
  return <span className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${statusStyle[status]}`}>{statusLabel[status]}</span>;
}

// ---- feedback ----

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 p-6 text-sm text-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" /> {label}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-surface-3 ${className}`} />;
}

/** Placeholder list while data loads. */
export function ListSkeleton({ rows = 3, height = "h-24" }: { rows?: number; height?: string }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={`${height} w-full rounded-2xl`} />
      ))}
    </div>
  );
}

export function Empty({ title, children, icon: IconC = BatteryCharging, action }: { title: string; children?: ReactNode; icon?: Icon; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-line px-6 py-10 text-center">
      <IconTile icon={IconC} size={48} />
      <p className="mt-3 font-extrabold text-ink">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="animate-pop flex items-start gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-rose-200">
      <CircleAlert size={18} className="mt-0.5 shrink-0" /> {message}
    </div>
  );
}

// ---- domain ----

const categoryLabel = { private: "Home", business: "Business", public: "Public" };

export function ChargerCard({ c, compact = false, onHover }: { c: ChargerSummary; compact?: boolean; onHover?: (id: string | null) => void }) {
  return (
    <Link
      to={`/chargers/${c.id}`}
      onMouseEnter={() => onHover?.(c.id)}
      onMouseLeave={() => onHover?.(null)}
      className="group relative block overflow-hidden rounded-2xl bg-surface p-4 ring-1 ring-line transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-14px_#0000004d] hover:ring-primary-dark focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
    >
      <span className="pointer-events-none absolute inset-y-3 left-0 w-1 rounded-r-full bg-primary opacity-0 transition group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-muted uppercase">{categoryLabel[c.category]}</span>
            {c.distance_km !== null && <span className="text-xs font-medium text-muted">{c.distance_km} km</span>}
          </div>
          <h3 className="mt-1 truncate font-extrabold">{c.name}</h3>
          <p className="truncate text-xs text-muted">{c.approx_area}</p>
        </div>
        <div className="text-right">
          <div className="text-xl font-extrabold tracking-tight">{formatINR(c.price_per_kwh_paise)}</div>
          <div className="text-[11px] text-muted">per kWh</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span className="inline-flex items-center gap-1 font-bold">
          <Zap size={14} className="fill-primary text-ink" /> {c.connector} · {c.mode} · {c.effective_power_kw ?? c.power_kw} kW
        </span>
        {!compact && c.rating > 0 && (
          <span className="inline-flex items-center gap-1 font-medium text-muted-2">
            <Star size={13} className="fill-amber-400 text-amber-500" /> {c.rating} ({c.review_count})
          </span>
        )}
        <AvailabilityBadge availability={c.availability} />
      </div>
      {!compact && (
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
          <CompatChip compatibility={c.compatibility} reason={c.compatibility_reason} />
          {c.bookable ? (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-primary-ink transition group-hover:translate-x-0.5">
              Book a slot <ArrowRight size={13} />
            </span>
          ) : (
            <span className="text-xs font-semibold text-muted">Directions only</span>
          )}
        </div>
      )}
    </Link>
  );
}
