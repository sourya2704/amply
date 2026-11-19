import type { AvailabilitySource, BookingStatus } from "./types";

export const formatINR = (paise: number) =>
  "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });

const tz = { timeZone: "Asia/Kolkata" } as const;

export const formatTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { ...tz, hour: "numeric", minute: "2-digit" });

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { ...tz, weekday: "short", day: "numeric", month: "short" });

export const formatDateTime = (iso: string) => `${formatDate(iso)}, ${formatTime(iso)}`;

export const formatRange = (start: string, end: string) => `${formatDate(start)} · ${formatTime(start)} – ${formatTime(end)}`;

/** Today's date in IST as YYYY-MM-DD. */
export function todayIST(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toLocaleDateString("en-CA", tz);
}

export const availabilityStyle: Record<AvailabilitySource, { dot: string; chip: string; pin: string }> = {
  live: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", pin: "#10b981" },
  schedule: { dot: "bg-primary-dark", chip: "bg-primary-soft text-primary-ink ring-primary/60", pin: "#ff7ab8" },
  reported: { dot: "bg-cyan", chip: "bg-cyan-50 text-cyan-700 ring-cyan-200", pin: "#19C6D2" },
  stale: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700 ring-amber-200", pin: "#f59e0b" },
  unknown: { dot: "bg-faint", chip: "bg-surface-3 text-muted-2 ring-line", pin: "#a3a3a3" },
};

/** Short availability names for tight spaces (badges elsewhere use the API's full label). */
export const availabilityShort: Record<AvailabilitySource, string> = {
  live: "Live",
  schedule: "Owner schedule",
  reported: "User-reported",
  stale: "Stale",
  unknown: "Unconfirmed",
};

export const statusStyle: Record<BookingStatus, string> = {
  requested: "bg-amber-50 text-amber-700 ring-amber-200",
  accepted: "bg-primary-soft text-primary-ink ring-primary/60",
  confirmed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  in_progress: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  completed: "bg-ink text-white ring-ink",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
  cancelled: "bg-surface-3 text-muted ring-line",
  expired: "bg-surface-3 text-muted ring-line",
};

export const statusLabel: Record<BookingStatus, string> = {
  requested: "Waiting for owner",
  accepted: "bg-primary-soft text-primary-ink ring-primary/60",
  confirmed: "Confirmed",
  in_progress: "Charging now",
  completed: "bg-ink text-white ring-ink",
  rejected: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
};

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const KORAMANGALA = { lat: 12.9352, lng: 77.6245 };
